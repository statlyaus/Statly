import { z } from 'zod';

import type { AflTradeImmutableArtifactRepository } from '../artifacts/immutableArtifactRepository';
import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import { aflTradePublicationManifestV3Schema } from '../artifacts/publicationProjectionManifests';
import {
  aflTradeValuationOutputInventoryIndexVerifyInputSchema,
  verifyAflTradeValuationOutputInventoryIndex,
} from '../artifacts/valuationOutputInventoryIndex';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import type { AflTradeDecisionEnvironment } from '../governance/gateDecisionTypes';
import {
  aflTradeCompleteAssessmentV2Schema,
  verifyAflTradeCompleteAssessmentV2,
  type AflTradeCompleteAssessmentV2VerificationInput,
} from '../valuation/completeTradeAssessment';
import { createPostgresAflTradeValuationOutputCustodyOperationAuthority } from '../valuation/postgresValuationOutputCustodyOperationAuthority';
import {
  persistAflTradeValuationOutputInventory,
  type PersistAflTradeValuationOutputInventoryResult,
} from '../valuation/valuationOutputCustody';
import {
  createAflTradeValuationOutputCustodyIndex,
  type AflTradeValuationOutputCustodyIndexResult,
} from '../valuation/valuationOutputCustodyIndex';
import {
  aflTradeValuationOutputInventoryVerifyInputSchema,
  verifyAflTradeValuationOutputInventoryDerivation,
  type AflTradeValuationOutputInventoryVerifyInput,
} from '../valuation/valuationOutputInventory';
import type {
  AflTradeValuationPublicationCommandService,
  AflTradeValuationPublicationRegistrationResult,
} from './valuationPublicationCommandService';
import { aflTradeProjectionPresentationUniversalLayerSchema } from './projectionPresentationPolicy';
import { persistPostgresAflTradeValuationOutputCustodyIndex } from './postgresPublicationRepository';

const instantSchema = z.iso.datetime({ offset: true });
const requestSchema = z
  .object({
    inventoryIndexVerification: z.unknown(),
    inventoryCustodyInputs: z
      .array(
        z
          .object({
            verification: z.unknown(),
            assessmentVerification: z.unknown(),
          })
          .strict()
      )
      .min(1)
      .max(10_000),
    actor: z.string().trim().min(1).max(200),
    preparationKey: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/),
    universalLayer: aflTradeProjectionPresentationUniversalLayerSchema,
    maximumConcurrentInventories: z.number().int().min(1).max(16).optional(),
  })
  .strict();

type PreparationRequest = z.infer<typeof requestSchema>;

interface TrustedCompletionTimeRow extends Record<string, unknown> {
  matched_count: number | string;
  trusted_at: string | Date | null;
}

interface PinnedCandidateRow extends Record<string, unknown> {
  custody_index_id: string;
  environment: string;
  universal_layer: string;
  candidate_json: unknown;
}

interface VerifiedCustodyInput {
  verification: AflTradeValuationOutputInventoryVerifyInput;
  assessmentVerification: AflTradeCompleteAssessmentV2VerificationInput;
}

export type AflTradeValuationPublicationPreparationErrorCode =
  'INVALID_INPUT' | 'INCOMPLETE_SET' | 'PARENT_MISMATCH' | 'TRUSTED_TIME_FAILURE';

export class AflTradeValuationPublicationPreparationError extends Error {
  constructor(
    readonly code: AflTradeValuationPublicationPreparationErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'AflTradeValuationPublicationPreparationError';
  }
}

export interface AflTradeValuationPublicationPreparationDependencies {
  environment: AflTradeDecisionEnvironment;
  persistInventory(
    input: VerifiedCustodyInput
  ): Promise<PersistAflTradeValuationOutputInventoryResult>;
  trustedIndexTime(
    receipts: readonly PersistAflTradeValuationOutputInventoryResult[]
  ): Promise<string>;
  persistCustodyIndex(
    verification: AflTradeValuationPublicationPreparationResult['custodyIndexVerification']
  ): Promise<void>;
  preparePublicationCandidate(input: {
    inventoryIndexVerification: z.infer<
      typeof aflTradeValuationOutputInventoryIndexVerifyInputSchema
    >;
    custodyIndexVerification: AflTradeValuationPublicationPreparationResult['custodyIndexVerification'];
    universalLayer: z.infer<typeof aflTradeProjectionPresentationUniversalLayerSchema>;
    createdAt: string;
  }): Promise<unknown>;
  pinPublicationCandidate(input: {
    preparationKey: string;
    custodyIndexVerification: AflTradeValuationPublicationPreparationResult['custodyIndexVerification'];
    universalLayer: z.infer<typeof aflTradeProjectionPresentationUniversalLayerSchema>;
    publicationCandidate: z.infer<typeof aflTradePublicationManifestV3Schema>;
  }): Promise<unknown>;
  publicationCommand: Pick<AflTradeValuationPublicationCommandService, 'register'>;
}

export interface AflTradeValuationPublicationPreparationResult {
  readonly status: 'candidate_registered';
  readonly publicationEligible: false;
  readonly custodyIndexVerification: {
    readonly inventoryIndexVerification: unknown;
    readonly custodyReceipts: readonly PersistAflTradeValuationOutputInventoryResult[];
    readonly createdAt: string;
    readonly output: AflTradeValuationOutputCustodyIndexResult;
  };
  readonly custodyReceipts: readonly PersistAflTradeValuationOutputInventoryResult[];
  readonly publication: AflTradeValuationPublicationRegistrationResult['publication'];
  readonly mutation: AflTradeValuationPublicationRegistrationResult['mutation'];
}

function snapshot(value: unknown): unknown {
  return structuredClone(value);
}

function exact(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

function invalid(
  code: AflTradeValuationPublicationPreparationErrorCode,
  message: string,
  cause?: unknown
): never {
  throw new AflTradeValuationPublicationPreparationError(code, message, { cause });
}

function verifyCustodyInput(
  input: PreparationRequest['inventoryCustodyInputs'][number]
): VerifiedCustodyInput {
  const verification = aflTradeValuationOutputInventoryVerifyInputSchema.safeParse(
    input.verification
  );
  const assessmentVerification = input.assessmentVerification as
    AflTradeCompleteAssessmentV2VerificationInput | undefined;
  if (
    !verification.success ||
    !verifyAflTradeValuationOutputInventoryDerivation(verification.data) ||
    assessmentVerification === undefined ||
    !verifyAflTradeCompleteAssessmentV2(assessmentVerification)
  ) {
    return invalid(
      'INVALID_INPUT',
      'Valuation publication preparation requires exact replayable inventories and assessments.'
    );
  }
  const assessment = aflTradeCompleteAssessmentV2Schema.parse(assessmentVerification.output);
  const root = verification.data.output.valuationOutputInventory.content;
  if (
    assessment.content.tradeId !== root.tradeId ||
    assessment.content.source.valuationCaseId !== root.valuationCase.valuationCaseId ||
    assessment.content.source.valuationCalculationId !==
      root.valuationCalculation.valuationCalculationId ||
    assessment.content.valueUnit.valueUnitId !== root.valueUnitId
  ) {
    return invalid(
      'PARENT_MISMATCH',
      'A complete-trade assessment does not bind its exact valuation inventory.'
    );
  }
  return { verification: verification.data, assessmentVerification };
}

function requireExactIndexedSet(
  inputs: readonly VerifiedCustodyInput[],
  inventoryIndexVerification: z.infer<typeof aflTradeValuationOutputInventoryIndexVerifyInputSchema>
): VerifiedCustodyInput[] {
  const detachedById = new Map(
    inventoryIndexVerification.valuationOutputInventories.map((entry) => [
      entry.valuationOutputInventory.valuationOutputInventoryId,
      entry,
    ])
  );
  if (detachedById.size !== inputs.length || inputs.length !== detachedById.size) {
    return invalid(
      'INCOMPLETE_SET',
      'Inventory custody inputs must exactly cover the immutable inventory index.'
    );
  }
  const byTrade = new Map<string, VerifiedCustodyInput>();
  for (const input of inputs) {
    const root = input.verification.output.valuationOutputInventory;
    const detached = detachedById.get(root.valuationOutputInventoryId);
    if (
      detached === undefined ||
      !exact(detached.valuationOutputInventory, root) ||
      !exact(detached.artifactRef, input.verification.output.valuationOutputInventoryArtifactRef) ||
      byTrade.has(root.content.tradeId)
    ) {
      return invalid(
        'INCOMPLETE_SET',
        'Inventory custody inputs contain an omitted, duplicate, or substituted indexed output.'
      );
    }
    byTrade.set(root.content.tradeId, input);
  }
  return inventoryIndexVerification.output.valuationOutputInventoryIndex.content.entries.map(
    (entry) =>
      byTrade.get(entry.tradeId) ??
      invalid('INCOMPLETE_SET', 'An indexed trade is missing its exact custody input.')
  );
}

function assessmentLayerForPresentation(
  layer: z.infer<typeof aflTradeProjectionPresentationUniversalLayerSchema>
): 'gross' | 'listSpotAdjusted' | 'scarcityAdjusted' {
  if (layer === 'list_spot_adjusted') return 'listSpotAdjusted';
  if (layer === 'scarcity_adjusted') return 'scarcityAdjusted';
  return 'gross';
}

function requirePreparationScope(
  inputs: readonly VerifiedCustodyInput[],
  inventoryIndexVerification: z.infer<
    typeof aflTradeValuationOutputInventoryIndexVerifyInputSchema
  >,
  environment: AflTradeDecisionEnvironment,
  universalLayer: z.infer<typeof aflTradeProjectionPresentationUniversalLayerSchema>
): void {
  if (inventoryIndexVerification.valuationBundleManifest.content.environment !== environment) {
    return invalid(
      'PARENT_MISMATCH',
      'Valuation publication preparation cannot custody output for another environment.'
    );
  }
  const assessmentLayer = assessmentLayerForPresentation(universalLayer);
  for (const input of inputs) {
    const assessment = aflTradeCompleteAssessmentV2Schema.parse(
      input.assessmentVerification.output
    );
    if (assessment.content.source.selectedLayer !== assessmentLayer) {
      return invalid(
        'PARENT_MISMATCH',
        'Complete-trade assessments must use the publication presentation layer before custody.'
      );
    }
  }
}

function requireCandidateParents(
  publicationCandidate: z.infer<typeof aflTradePublicationManifestV3Schema>,
  inventoryIndexVerification: z.infer<
    typeof aflTradeValuationOutputInventoryIndexVerifyInputSchema
  >,
  custodyIndexVerification: AflTradeValuationPublicationPreparationResult['custodyIndexVerification'],
  environment: AflTradeDecisionEnvironment,
  universalLayer: z.infer<typeof aflTradeProjectionPresentationUniversalLayerSchema>
): void {
  const index = inventoryIndexVerification.output;
  const indexContent = index.valuationOutputInventoryIndex.content;
  const candidateIndex = publicationCandidate.content.valuationOutputInventoryIndex;
  if (
    publicationCandidate.content.environment !== environment ||
    publicationCandidate.content.environment !==
      inventoryIndexVerification.valuationBundleManifest.content.environment ||
    publicationCandidate.content.valuationBundleId !==
      inventoryIndexVerification.valuationBundleManifest.valuationBundleId ||
    publicationCandidate.content.scopeKey !== indexContent.scopeKey ||
    publicationCandidate.content.valueUnitId !== indexContent.valueUnitId ||
    publicationCandidate.content.entryCount !== indexContent.entryCount ||
    candidateIndex.valuationOutputInventoryIndexId !==
      index.valuationOutputInventoryIndex.valuationOutputInventoryIndexId ||
    candidateIndex.inventorySetSha256 !== indexContent.inventorySetSha256 ||
    !exact(candidateIndex.artifactRef, index.valuationOutputInventoryIndexArtifactRef) ||
    publicationCandidate.content.projectionPresentationPolicy.universalLayer !== universalLayer ||
    publicationCandidate.content.createdAt !== custodyIndexVerification.createdAt ||
    publicationCandidate.content.publicationBundleArtifact.createdAt !==
      custodyIndexVerification.createdAt
  ) {
    return invalid(
      'PARENT_MISMATCH',
      'Publication candidate does not bind the completed custody, exact inventory index, environment, and presentation layer.'
    );
  }
}

async function withBoundedConcurrency<T, R>(
  inputs: readonly T[],
  maximumConcurrent: number,
  operation: (input: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(inputs.length);
  let cursor = 0;
  let failure: unknown = null;
  const workers = Array.from({ length: Math.min(maximumConcurrent, inputs.length) }, async () => {
    while (failure === null) {
      const index = cursor++;
      const input = inputs[index];
      if (input === undefined) return;
      try {
        results[index] = await operation(input);
      } catch (error) {
        failure = error;
      }
    }
  });
  await Promise.all(workers);
  if (failure !== null) throw failure;
  return results;
}

export function createAflTradeValuationPublicationPreparationService(
  dependencies: AflTradeValuationPublicationPreparationDependencies
) {
  return Object.freeze({
    async prepare(
      unparsedRequest: unknown
    ): Promise<AflTradeValuationPublicationPreparationResult> {
      let request: PreparationRequest;
      try {
        request = requestSchema.parse(snapshot(unparsedRequest));
      } catch (error) {
        return invalid(
          'INVALID_INPUT',
          'Valuation publication preparation request is invalid.',
          error
        );
      }
      const inventoryIndexVerification =
        aflTradeValuationOutputInventoryIndexVerifyInputSchema.safeParse(
          request.inventoryIndexVerification
        );
      if (
        !inventoryIndexVerification.success ||
        !verifyAflTradeValuationOutputInventoryIndex(inventoryIndexVerification.data)
      ) {
        return invalid(
          'INVALID_INPUT',
          'Valuation publication preparation requires an exact inventory index.'
        );
      }
      const verifiedInputs = request.inventoryCustodyInputs.map(verifyCustodyInput);
      const canonicalInputs = requireExactIndexedSet(
        verifiedInputs,
        inventoryIndexVerification.data
      );
      requirePreparationScope(
        canonicalInputs,
        inventoryIndexVerification.data,
        dependencies.environment,
        request.universalLayer
      );

      const custodyReceipts = await withBoundedConcurrency(
        canonicalInputs,
        request.maximumConcurrentInventories ?? 4,
        dependencies.persistInventory
      );
      let createdAt: string;
      try {
        createdAt = instantSchema.parse(await dependencies.trustedIndexTime(custodyReceipts));
      } catch (error) {
        return invalid(
          'TRUSTED_TIME_FAILURE',
          'Valuation publication custody index requires one trusted database timestamp.',
          error
        );
      }
      const custodyIndexRequest = {
        inventoryIndexVerification: inventoryIndexVerification.data,
        custodyReceipts,
        createdAt,
      };
      const custodyIndexVerification = {
        ...custodyIndexRequest,
        output: createAflTradeValuationOutputCustodyIndex(custodyIndexRequest),
      };
      await dependencies.persistCustodyIndex(custodyIndexVerification);
      const candidateInput = deepFreeze({
        inventoryIndexVerification: inventoryIndexVerification.data,
        custodyIndexVerification,
        universalLayer: request.universalLayer,
        createdAt,
      });
      const publicationCandidate = aflTradePublicationManifestV3Schema.safeParse(
        await dependencies.preparePublicationCandidate(candidateInput)
      );
      if (!publicationCandidate.success) {
        return invalid(
          'INVALID_INPUT',
          'Publication materialization did not produce one exact v3 candidate from completed custody.',
          publicationCandidate.error
        );
      }
      requireCandidateParents(
        publicationCandidate.data,
        inventoryIndexVerification.data,
        custodyIndexVerification,
        dependencies.environment,
        request.universalLayer
      );
      const pinnedCandidate = aflTradePublicationManifestV3Schema.safeParse(
        await dependencies.pinPublicationCandidate({
          preparationKey: request.preparationKey,
          custodyIndexVerification,
          universalLayer: request.universalLayer,
          publicationCandidate: publicationCandidate.data,
        })
      );
      if (!pinnedCandidate.success) {
        return invalid(
          'INVALID_INPUT',
          'Durable publication preparation did not return an exact pinned v3 candidate.',
          pinnedCandidate.error
        );
      }
      requireCandidateParents(
        pinnedCandidate.data,
        inventoryIndexVerification.data,
        custodyIndexVerification,
        dependencies.environment,
        request.universalLayer
      );
      const registration = await dependencies.publicationCommand.register({
        publicationCandidate: pinnedCandidate.data,
        custodyIndexVerification,
        actor: request.actor,
      });
      return deepFreeze({
        status: 'candidate_registered' as const,
        publicationEligible: false as const,
        custodyIndexVerification,
        custodyReceipts,
        publication: registration.publication,
        mutation: registration.mutation,
      });
    },
  });
}

async function postgresTrustedIndexTime(
  client: AflOutcomeSqlClient,
  receipts: readonly PersistAflTradeValuationOutputInventoryResult[]
): Promise<string> {
  const expected = receipts.map(({ receipt }) => ({
    operationId: receipt.content.operationId,
    receiptId: receipt.receiptId,
  }));
  if (
    new Set(expected.map(({ operationId }) => operationId)).size !== expected.length ||
    new Set(expected.map(({ receiptId }) => receiptId)).size !== expected.length
  ) {
    return invalid(
      'TRUSTED_TIME_FAILURE',
      'Valuation publication custody receipts must contain unique operations and receipts.'
    );
  }
  const result = await client.query<TrustedCompletionTimeRow>(
    `WITH expected AS (
       SELECT *
         FROM jsonb_to_recordset($1::jsonb)
           AS x(operation_id text, receipt_id text)
     )
     SELECT count(*)::int AS matched_count,
            date_trunc('milliseconds',max(operation.completed_at)) AS trusted_at
       FROM expected
       JOIN outcome_valuation_output_custody_operation operation
         ON operation.operation_id=expected.operation_id
        AND operation.receipt_id=expected.receipt_id
      WHERE operation.status='completed'`,
    [
      JSON.stringify(
        expected.map(({ operationId, receiptId }) => ({
          operation_id: operationId,
          receipt_id: receiptId,
        }))
      ),
    ]
  );
  const row = result.rows[0];
  if (
    result.rows.length !== 1 ||
    Number(row?.matched_count) !== expected.length ||
    !row.trusted_at
  ) {
    return invalid(
      'TRUSTED_TIME_FAILURE',
      'PostgreSQL did not authenticate every completed custody operation for the index.'
    );
  }
  const value = row.trusted_at;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

async function pinPostgresPublicationCandidate(
  client: AflOutcomeSqlClient,
  input: Parameters<
    AflTradeValuationPublicationPreparationDependencies['pinPublicationCandidate']
  >[0]
) {
  const candidate = aflTradePublicationManifestV3Schema.parse(input.publicationCandidate);
  const custodyIndexId =
    input.custodyIndexVerification.output.valuationOutputCustodyIndex.valuationOutputCustodyIndexId;
  return client.transaction(async (transaction) => {
    await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
      `valuation-publication-preparation:${input.preparationKey}`,
    ]);
    const stored = await transaction.query<PinnedCandidateRow>(
      `SELECT custody_index_id, environment::text AS environment,
              universal_layer, candidate_json
         FROM outcome_valuation_publication_preparation
        WHERE preparation_key=$1
        FOR UPDATE`,
      [input.preparationKey]
    );
    if (stored.rows.length > 1) {
      return invalid(
        'PARENT_MISMATCH',
        'PostgreSQL returned multiple candidates for one publication preparation key.'
      );
    }
    const existing = stored.rows[0];
    if (existing) {
      if (
        existing.custody_index_id !== custodyIndexId ||
        existing.environment !== candidate.content.environment ||
        existing.universal_layer !== input.universalLayer
      ) {
        return invalid(
          'PARENT_MISMATCH',
          'The publication preparation key is already pinned to another custody scope.'
        );
      }
      return aflTradePublicationManifestV3Schema.parse(existing.candidate_json);
    }
    await transaction.query(
      `INSERT INTO outcome_valuation_publication_preparation (
         preparation_key, custody_index_id, environment, universal_layer, candidate_id,
         candidate_content_canonical_json, candidate_canonical_json, candidate_json,
         created_at
       ) VALUES ($1,$2,$3,$4,$5,$6::text,$7::text,$7::jsonb,$8)`,
      [
        input.preparationKey,
        custodyIndexId,
        candidate.content.environment,
        input.universalLayer,
        candidate.publicationId,
        canonicalizeAflTradeJson(candidate.content),
        canonicalizeAflTradeJson(candidate),
        candidate.content.createdAt,
      ]
    );
    return candidate;
  });
}

export function createPostgresAflTradeValuationPublicationPreparationService(input: {
  client: AflOutcomeSqlClient;
  artifactRepository: AflTradeImmutableArtifactRepository;
  environment: AflTradeDecisionEnvironment;
  preparePublicationCandidate: AflTradeValuationPublicationPreparationDependencies['preparePublicationCandidate'];
  publicationCommand: Pick<AflTradeValuationPublicationCommandService, 'register'>;
  maximumConcurrentArtifacts?: number;
}) {
  const operationAuthority = createPostgresAflTradeValuationOutputCustodyOperationAuthority(
    input.client
  );
  return createAflTradeValuationPublicationPreparationService({
    environment: input.environment,
    persistInventory: (custodyInput) =>
      persistAflTradeValuationOutputInventory(custodyInput, {
        repository: input.artifactRepository,
        operationAuthority,
        maximumConcurrentArtifacts: input.maximumConcurrentArtifacts,
      }),
    trustedIndexTime: (receipts) => postgresTrustedIndexTime(input.client, receipts),
    persistCustodyIndex: (verification) =>
      persistPostgresAflTradeValuationOutputCustodyIndex(input.client, verification),
    preparePublicationCandidate: input.preparePublicationCandidate,
    pinPublicationCandidate: (candidate) =>
      pinPostgresPublicationCandidate(input.client, candidate),
    publicationCommand: input.publicationCommand,
  });
}
