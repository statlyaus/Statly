import { z } from 'zod';

import {
  aflTradeArtifactReadbackReceiptSchema,
  type AflTradeArtifactReadbackReceipt,
  type AflTradeImmutableArtifactRepository,
  verifyAflTradeArtifactReadback,
} from '../artifacts/immutableArtifactRepository';
import {
  aflTradeArtifactRefSchema,
  createAflTradeCanonicalJsonArtifactRef,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  aflTradeCompleteAssessmentV2Schema,
  verifyAflTradeCompleteAssessmentV2,
  type AflTradeCompleteAssessmentV2,
  type AflTradeCompleteAssessmentV2VerificationInput,
} from './completeTradeAssessment';
import { compareAflTradeCodeUnits } from './deterministicProbabilityMeasure';
import {
  aflTradeValuationOutputInventoryVerifyInputSchema,
  verifyAflTradeValuationOutputInventoryDerivation,
  type AflTradeValuationOutputInventoryVerifyInput,
} from './valuationOutputInventory';

export const AFL_TRADE_VALUATION_OUTPUT_CUSTODY_SCHEMA_VERSION =
  'afl-trade-valuation-output-custody/v1' as const;

const environmentSchema = z.enum(['test_fixture', 'non_production', 'production']);
const repositoryAssuranceSchema = z.enum([
  'fixture_memory',
  'fixture_filesystem',
  'durable_object_storage',
]);

export const aflTradeValuationOutputCustodyOperationScopeSchema = z
  .object({
    environment: environmentSchema,
    valuationOutputInventoryId: aflTradeContentAddressedIdSchema('valuation-output-inventory'),
    outputSetSha256: z.string().regex(/^[a-f0-9]{64}$/),
    repositoryAssurance: repositoryAssuranceSchema,
    custodyProfileId: aflTradeContentAddressedIdSchema('artifact-custody-profile').nullable(),
    artifactCount: z.number().int().positive(),
  })
  .strict();

export const aflTradeValuationOutputCustodyOperationContentSchema =
  aflTradeValuationOutputCustodyOperationScopeSchema
    .extend({
      schemaVersion: z.literal('afl-trade-valuation-output-custody-operation/v1'),
      verifiedAt: z.iso.datetime({ offset: true }),
    })
    .strict();

export const aflTradeValuationOutputCustodyOperationSchema = z
  .object({
    operationId: aflTradeContentAddressedIdSchema('valuation-output-custody-operation'),
    content: aflTradeValuationOutputCustodyOperationContentSchema,
  })
  .strict()
  .superRefine((operation, context) => {
    addAflTradeContentAddressIssue(
      'valuation-output-custody-operation',
      operation.operationId,
      operation.content,
      context,
      ['operationId']
    );
  });

export type AflTradeValuationOutputCustodyOperationScope = z.infer<
  typeof aflTradeValuationOutputCustodyOperationScopeSchema
>;
export type AflTradeValuationOutputCustodyOperation = z.infer<
  typeof aflTradeValuationOutputCustodyOperationSchema
>;

export interface AflTradeValuationOutputCustodyOperationAuthority {
  acquire(scope: AflTradeValuationOutputCustodyOperationScope): Promise<unknown>;
  complete(input: {
    operation: AflTradeValuationOutputCustodyOperation;
    receipt: AflTradeValuationOutputCustodyReceipt;
    receiptId: string;
    receiptArtifactRef: AflTradeArtifactRef;
    receiptReadback: AflTradeArtifactReadbackReceipt;
    receiptReadbackArtifactRef: AflTradeArtifactRef;
  }): Promise<void>;
}

const commonArtifactBindingShape = {
  artifact: aflTradeArtifactRefSchema,
  readbackReceiptArtifact: aflTradeArtifactRefSchema,
} as const;

export const aflTradeValuationOutputCustodyArtifactBindingSchema = z.discriminatedUnion('role', [
  z
    .object({
      role: z.literal('valuation_bundle'),
      semanticId: aflTradeContentAddressedIdSchema('valuation-bundle'),
      ...commonArtifactBindingShape,
    })
    .strict(),
  z
    .object({
      role: z.literal('valuation_case'),
      semanticId: aflTradeContentAddressedIdSchema('valuation-case'),
      ...commonArtifactBindingShape,
    })
    .strict(),
  z
    .object({
      role: z.literal('valuation_calculation'),
      semanticId: aflTradeContentAddressedIdSchema('valuation-calculation'),
      ...commonArtifactBindingShape,
    })
    .strict(),
  z
    .object({
      role: z.literal('complete_trade_assessment'),
      semanticId: aflTradeContentAddressedIdSchema('complete-trade-assessment'),
      ...commonArtifactBindingShape,
    })
    .strict(),
  z
    .object({
      role: z.literal('valuation_distribution'),
      semanticId: aflTradeContentAddressedIdSchema('valuation-distribution'),
      ...commonArtifactBindingShape,
    })
    .strict(),
  z
    .object({
      role: z.literal('valuation_comparison'),
      semanticId: aflTradeContentAddressedIdSchema('valuation-comparison'),
      ...commonArtifactBindingShape,
    })
    .strict(),
  z
    .object({
      role: z.literal('structured_explanation'),
      semanticId: aflTradeContentAddressedIdSchema('structured-explanation'),
      ...commonArtifactBindingShape,
    })
    .strict(),
  z
    .object({
      role: z.literal('distribution_inventory_shard'),
      semanticId: aflTradeContentAddressedIdSchema('valuation-output-inventory-shard'),
      ...commonArtifactBindingShape,
    })
    .strict(),
  z
    .object({
      role: z.literal('valuation_output_inventory'),
      semanticId: aflTradeContentAddressedIdSchema('valuation-output-inventory'),
      ...commonArtifactBindingShape,
    })
    .strict(),
]);

export const aflTradeValuationOutputCustodyReceiptContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_VALUATION_OUTPUT_CUSTODY_SCHEMA_VERSION),
    environment: environmentSchema,
    operationId: aflTradeContentAddressedIdSchema('valuation-output-custody-operation'),
    operation: aflTradeValuationOutputCustodyOperationSchema,
    valuationOutputInventoryId: aflTradeContentAddressedIdSchema('valuation-output-inventory'),
    valuationBundleId: aflTradeContentAddressedIdSchema('valuation-bundle'),
    valuationCaseId: aflTradeContentAddressedIdSchema('valuation-case'),
    valuationCalculationId: aflTradeContentAddressedIdSchema('valuation-calculation'),
    tradeId: z.string().trim().min(1).max(200),
    valueUnitId: z.string().trim().min(1).max(200),
    artifactCount: z.number().int().positive(),
    artifacts: z.array(aflTradeValuationOutputCustodyArtifactBindingSchema).min(1),
    verifiedAt: z.iso.datetime({ offset: true }),
    verification: z.literal('exact_replay_then_immutable_readback'),
    publicationEligible: z.literal(false),
  })
  .strict()
  .superRefine((content, context) => {
    if (content.artifactCount !== content.artifacts.length) {
      context.addIssue({
        code: 'custom',
        path: ['artifactCount'],
        message: 'Custody artifact count must match the exact artifact bindings.',
      });
    }
    if (
      content.operationId !== content.operation.operationId ||
      content.environment !== content.operation.content.environment ||
      content.valuationOutputInventoryId !== content.operation.content.valuationOutputInventoryId ||
      content.artifactCount !== content.operation.content.artifactCount ||
      content.verifiedAt !== content.operation.content.verifiedAt
    ) {
      context.addIssue({
        code: 'custom',
        path: ['operation'],
        message: 'Custody receipt must bind the exact trusted operation scope and timestamp.',
      });
    }
    const semanticIds = new Set(content.artifacts.map(({ semanticId }) => semanticId));
    const artifactIds = new Set(content.artifacts.map(({ artifact }) => artifact.artifactId));
    if (semanticIds.size !== content.artifacts.length) {
      context.addIssue({
        code: 'custom',
        path: ['artifacts'],
        message: 'Each custody binding must name one unique semantic artifact.',
      });
    }
    if (artifactIds.size !== content.artifacts.length) {
      context.addIssue({
        code: 'custom',
        path: ['artifacts'],
        message: 'Each custody binding must authenticate one unique byte artifact.',
      });
    }
  });

export const aflTradeValuationOutputCustodyReceiptSchema = z
  .object({
    receiptId: aflTradeContentAddressedIdSchema('valuation-output-custody'),
    content: aflTradeValuationOutputCustodyReceiptContentSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    addAflTradeContentAddressIssue(
      'valuation-output-custody',
      receipt.receiptId,
      receipt.content,
      context,
      ['receiptId']
    );
  });

export type AflTradeValuationOutputCustodyReceipt = z.infer<
  typeof aflTradeValuationOutputCustodyReceiptSchema
>;

export const AFL_TRADE_VALUATION_OUTPUT_CUSTODY_ERROR_CODES = [
  'INVALID_INPUT',
  'INVALID_DERIVATION',
  'CUSTODY_POLICY_MISMATCH',
  'DUPLICATE_ARTIFACT',
  'INVALID_OPERATION_AUTHORITY',
  'CUSTODY_FAILURE',
] as const;

export type AflTradeValuationOutputCustodyErrorCode =
  (typeof AFL_TRADE_VALUATION_OUTPUT_CUSTODY_ERROR_CODES)[number];

export class AflTradeValuationOutputCustodyError extends Error {
  constructor(
    public readonly code: AflTradeValuationOutputCustodyErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AflTradeValuationOutputCustodyError';
  }
}

const persistInputSchema = z
  .object({
    verification: z.unknown(),
    assessmentVerification: z.unknown(),
  })
  .strict();

type ArtifactRole =
  | 'valuation_bundle'
  | 'valuation_case'
  | 'valuation_calculation'
  | 'complete_trade_assessment'
  | 'valuation_distribution'
  | 'valuation_comparison'
  | 'structured_explanation'
  | 'distribution_inventory_shard'
  | 'valuation_output_inventory';

interface ArtifactInput {
  role: ArtifactRole;
  semanticId: string;
  artifact: unknown;
  reference: AflTradeArtifactRef;
}

export interface AflTradeValuationOutputCustodyArtifactResult {
  role: ArtifactRole;
  semanticId: string;
  artifact: AflTradeArtifactRef;
  status: 'stored' | 'already_present';
  readback: AflTradeArtifactReadbackReceipt;
  readbackReceiptArtifact: AflTradeArtifactRef;
  readbackReceiptArtifactStatus: 'stored' | 'already_present';
}

export interface PersistAflTradeValuationOutputInventoryResult {
  receipt: AflTradeValuationOutputCustodyReceipt;
  receiptArtifactRef: AflTradeArtifactRef;
  receiptArtifactStatus: 'stored' | 'already_present';
  receiptReadback: AflTradeArtifactReadbackReceipt;
  receiptReadbackArtifactRef: AflTradeArtifactRef;
  receiptReadbackArtifactStatus: 'stored' | 'already_present';
  artifactResults: readonly AflTradeValuationOutputCustodyArtifactResult[];
}

const ROLE_ORDER: Readonly<Record<ArtifactRole, number>> = Object.freeze({
  valuation_bundle: 0,
  valuation_case: 1,
  valuation_calculation: 2,
  complete_trade_assessment: 3,
  valuation_distribution: 4,
  valuation_comparison: 5,
  structured_explanation: 6,
  distribution_inventory_shard: 7,
  valuation_output_inventory: 8,
});

function requireCustodyPolicy(
  environment: z.infer<typeof environmentSchema>,
  repository: AflTradeImmutableArtifactRepository
): void {
  if (repository.artifactClass !== 'derived_private') {
    throw new AflTradeValuationOutputCustodyError(
      'CUSTODY_POLICY_MISMATCH',
      'Valuation outputs require derived-private immutable custody.'
    );
  }
  if (repository.assurance !== 'durable_object_storage') {
    if (environment !== 'test_fixture' || repository.custodyProfile !== null) {
      throw new AflTradeValuationOutputCustodyError(
        'CUSTODY_POLICY_MISMATCH',
        'Fixture custody is permitted only for test-fixture evidence.'
      );
    }
    return;
  }
  if (
    repository.custodyProfile === null ||
    repository.custodyProfile.content.environment !== environment ||
    repository.custodyProfile.content.artifactClass !== 'derived_private'
  ) {
    throw new AflTradeValuationOutputCustodyError(
      'CUSTODY_POLICY_MISMATCH',
      'Durable custody must bind the exact environment and derived-private artifact class.'
    );
  }
}

function artifactInputs(
  verification: AflTradeValuationOutputInventoryVerifyInput,
  assessment: AflTradeCompleteAssessmentV2
): ArtifactInput[] {
  const inputs: ArtifactInput[] = [
    {
      role: 'valuation_bundle',
      semanticId: verification.valuationBundle.valuationBundleManifest.valuationBundleId,
      artifact: verification.valuationBundle.valuationBundleManifest,
      reference: verification.valuationBundle.artifactRef,
    },
    {
      role: 'valuation_case',
      semanticId: verification.valuationCase.valuationCase.valuationCaseId,
      artifact: verification.valuationCase.valuationCase,
      reference: verification.valuationCase.artifactRef,
    },
    {
      role: 'valuation_calculation',
      semanticId: verification.valuationCalculation.valuationCalculation.valuationCalculationId,
      artifact: verification.valuationCalculation.valuationCalculation,
      reference: verification.valuationCalculation.artifactRef,
    },
    {
      role: 'complete_trade_assessment',
      semanticId: assessment.assessmentId,
      artifact: assessment,
      reference: createAflTradeCanonicalJsonArtifactRef(assessment, assessment.content.assessedAt),
    },
    ...verification.valuationDistributions.map(({ valuationDistribution, artifactRef }) => ({
      role: 'valuation_distribution' as const,
      semanticId: valuationDistribution.valuationDistributionId,
      artifact: valuationDistribution,
      reference: artifactRef,
    })),
    ...verification.valuationComparisons.map(({ valuationComparison, artifactRef }) => ({
      role: 'valuation_comparison' as const,
      semanticId: valuationComparison.valuationComparisonId,
      artifact: valuationComparison,
      reference: artifactRef,
    })),
    {
      role: 'structured_explanation',
      semanticId: verification.structuredExplanation.structuredExplanation.structuredExplanationId,
      artifact: verification.structuredExplanation.structuredExplanation,
      reference: verification.structuredExplanation.artifactRef,
    },
    ...verification.output.distributionShards.map(({ shard, artifactRef }) => ({
      role: 'distribution_inventory_shard' as const,
      semanticId: shard.valuationOutputInventoryShardId,
      artifact: shard,
      reference: artifactRef,
    })),
    {
      role: 'valuation_output_inventory',
      semanticId: verification.output.valuationOutputInventory.valuationOutputInventoryId,
      artifact: verification.output.valuationOutputInventory,
      reference: verification.output.valuationOutputInventoryArtifactRef,
    },
  ];
  return inputs.sort((left, right) => {
    const roleComparison = ROLE_ORDER[left.role] - ROLE_ORDER[right.role];
    return roleComparison || compareAflTradeCodeUnits(left.semanticId, right.semanticId);
  });
}

function requireExactArtifactSet(inputs: readonly ArtifactInput[], verifiedAt: string): void {
  const semanticIds = new Set<string>();
  const artifactIds = new Set<string>();
  for (const input of inputs) {
    if (
      semanticIds.has(input.semanticId) ||
      artifactIds.has(input.reference.artifactId) ||
      Date.parse(input.reference.createdAt) > Date.parse(verifiedAt)
    ) {
      throw new AflTradeValuationOutputCustodyError(
        semanticIds.has(input.semanticId) || artifactIds.has(input.reference.artifactId)
          ? 'DUPLICATE_ARTIFACT'
          : 'INVALID_INPUT',
        'Custody requires unique artifacts whose creation does not postdate verification.'
      );
    }
    semanticIds.add(input.semanticId);
    artifactIds.add(input.reference.artifactId);
  }
}

function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalizeAflTradeJson(value));
}

async function persistArtifact(
  input: ArtifactInput,
  repository: AflTradeImmutableArtifactRepository,
  verifiedAt: string
): Promise<AflTradeValuationOutputCustodyArtifactResult> {
  const persisted = await repository.putIfAbsent(input.reference, canonicalBytes(input.artifact));
  const readback = await verifyAflTradeArtifactReadback(
    repository,
    input.reference,
    verifiedAt,
    input.reference.byteLength
  );
  const readbackReceiptArtifact = createAflTradeCanonicalJsonArtifactRef(readback, verifiedAt);
  const readbackReceiptPersistence = await repository.putIfAbsent(
    readbackReceiptArtifact,
    canonicalBytes(readback)
  );
  return {
    role: input.role,
    semanticId: input.semanticId,
    artifact: input.reference,
    status: persisted.status,
    readback,
    readbackReceiptArtifact,
    readbackReceiptArtifactStatus: readbackReceiptPersistence.status,
  };
}

async function persistArtifactsWithBoundedConcurrency(
  inputs: readonly ArtifactInput[],
  repository: AflTradeImmutableArtifactRepository,
  verifiedAt: string,
  maximumConcurrentArtifacts: number
): Promise<AflTradeValuationOutputCustodyArtifactResult[]> {
  const results = new Array<AflTradeValuationOutputCustodyArtifactResult>(inputs.length);
  let cursor = 0;
  let failure: unknown = null;
  const workers = Array.from(
    { length: Math.min(maximumConcurrentArtifacts, inputs.length) },
    async () => {
      while (failure === null) {
        const index = cursor;
        cursor += 1;
        const input = inputs[index];
        if (input === undefined) return;
        try {
          results[index] = await persistArtifact(input, repository, verifiedAt);
        } catch (error) {
          failure = error;
        }
      }
    }
  );
  await Promise.all(workers);
  if (failure !== null) throw failure;
  if (results.filter((result) => result !== undefined).length !== inputs.length) {
    throw new AflTradeValuationOutputCustodyError(
      'CUSTODY_FAILURE',
      'Bounded custody did not account for every required artifact.'
    );
  }
  return results;
}

export async function persistAflTradeValuationOutputInventory(
  input: {
    verification: AflTradeValuationOutputInventoryVerifyInput;
    assessmentVerification: AflTradeCompleteAssessmentV2VerificationInput;
  },
  dependencies: {
    repository: AflTradeImmutableArtifactRepository;
    operationAuthority: AflTradeValuationOutputCustodyOperationAuthority;
    maximumConcurrentArtifacts?: number;
  }
): Promise<PersistAflTradeValuationOutputInventoryResult> {
  const parsed = persistInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AflTradeValuationOutputCustodyError(
      'INVALID_INPUT',
      'Valuation output custody requires one exact verified inventory envelope.'
    );
  }
  const parsedVerification = aflTradeValuationOutputInventoryVerifyInputSchema.safeParse(
    parsed.data.verification
  );
  const assessmentVerification = parsed.data
    .assessmentVerification as AflTradeCompleteAssessmentV2VerificationInput;
  if (
    !parsedVerification.success ||
    !verifyAflTradeValuationOutputInventoryDerivation(parsedVerification.data) ||
    !verifyAflTradeCompleteAssessmentV2(assessmentVerification)
  ) {
    throw new AflTradeValuationOutputCustodyError(
      'INVALID_DERIVATION',
      'Valuation output custody rejected an inventory that does not replay exactly.'
    );
  }
  const verification = parsedVerification.data;
  const assessment = aflTradeCompleteAssessmentV2Schema.parse(assessmentVerification.output);
  const root = verification.output.valuationOutputInventory.content;
  if (
    assessment.content.source.valuationCaseId !== root.valuationCase.valuationCaseId ||
    assessment.content.source.valuationCalculationId !==
      root.valuationCalculation.valuationCalculationId ||
    assessment.content.tradeId !== root.tradeId ||
    assessment.content.valueUnit.valueUnitId !== root.valueUnitId
  ) {
    throw new AflTradeValuationOutputCustodyError(
      'INVALID_DERIVATION',
      'The complete-trade assessment does not bind the exact Stage-5 inventory ancestry.'
    );
  }
  const environment = verification.valuationBundle.valuationBundleManifest.content.environment;
  requireCustodyPolicy(environment, dependencies.repository);
  const artifacts = artifactInputs(verification, assessment);
  const maximumConcurrentArtifacts = z
    .number()
    .int()
    .min(1)
    .max(32)
    .safeParse(dependencies.maximumConcurrentArtifacts ?? 8);
  if (!maximumConcurrentArtifacts.success) {
    throw new AflTradeValuationOutputCustodyError(
      'INVALID_INPUT',
      'Valuation output custody concurrency must be an integer from 1 through 32.'
    );
  }
  const operationScope = aflTradeValuationOutputCustodyOperationScopeSchema.parse({
    environment,
    valuationOutputInventoryId:
      verification.output.valuationOutputInventory.valuationOutputInventoryId,
    outputSetSha256: root.outputSetSha256,
    repositoryAssurance: dependencies.repository.assurance,
    custodyProfileId: dependencies.repository.custodyProfile?.profileId ?? null,
    artifactCount: artifacts.length,
  });

  try {
    const operationResult = aflTradeValuationOutputCustodyOperationSchema.safeParse(
      await dependencies.operationAuthority.acquire(operationScope)
    );
    if (!operationResult.success) {
      throw new AflTradeValuationOutputCustodyError(
        'INVALID_OPERATION_AUTHORITY',
        'Custody operation authority returned an invalid operation.'
      );
    }
    const {
      schemaVersion: _schemaVersion,
      verifiedAt,
      ...authorizedScope
    } = operationResult.data.content;
    if (canonicalizeAflTradeJson(authorizedScope) !== canonicalizeAflTradeJson(operationScope)) {
      throw new AflTradeValuationOutputCustodyError(
        'INVALID_OPERATION_AUTHORITY',
        'Custody operation authority returned a different immutable scope.'
      );
    }
    const operation = operationResult.data;
    requireExactArtifactSet(artifacts, verifiedAt);
    const artifactResults = await persistArtifactsWithBoundedConcurrency(
      artifacts,
      dependencies.repository,
      verifiedAt,
      maximumConcurrentArtifacts.data
    );

    const receiptContent = aflTradeValuationOutputCustodyReceiptContentSchema.parse({
      schemaVersion: AFL_TRADE_VALUATION_OUTPUT_CUSTODY_SCHEMA_VERSION,
      environment,
      operationId: operation.operationId,
      operation,
      valuationOutputInventoryId:
        verification.output.valuationOutputInventory.valuationOutputInventoryId,
      valuationBundleId: root.valuationBundle.valuationBundleId,
      valuationCaseId: root.valuationCase.valuationCaseId,
      valuationCalculationId: root.valuationCalculation.valuationCalculationId,
      tradeId: root.tradeId,
      valueUnitId: root.valueUnitId,
      artifactCount: artifactResults.length,
      artifacts: artifactResults.map(({ role, semanticId, artifact, readbackReceiptArtifact }) => ({
        role,
        semanticId,
        artifact,
        readbackReceiptArtifact,
      })),
      verifiedAt,
      verification: 'exact_replay_then_immutable_readback',
      publicationEligible: false,
    });
    const receipt = aflTradeValuationOutputCustodyReceiptSchema.parse({
      receiptId: createAflTradeContentAddress('valuation-output-custody', receiptContent),
      content: receiptContent,
    });
    const receiptArtifactRef = createAflTradeCanonicalJsonArtifactRef(receipt, verifiedAt);
    const receiptPersistence = await dependencies.repository.putIfAbsent(
      receiptArtifactRef,
      canonicalBytes(receipt)
    );
    const receiptReadback = await verifyAflTradeArtifactReadback(
      dependencies.repository,
      receiptArtifactRef,
      verifiedAt,
      receiptArtifactRef.byteLength
    );
    const receiptReadbackArtifactRef = createAflTradeCanonicalJsonArtifactRef(
      receiptReadback,
      verifiedAt
    );
    const receiptReadbackPersistence = await dependencies.repository.putIfAbsent(
      receiptReadbackArtifactRef,
      canonicalBytes(receiptReadback)
    );
    await dependencies.operationAuthority.complete({
      operation,
      receipt,
      receiptId: receipt.receiptId,
      receiptArtifactRef,
      receiptReadback,
      receiptReadbackArtifactRef,
    });
    return {
      receipt,
      receiptArtifactRef,
      receiptArtifactStatus: receiptPersistence.status,
      receiptReadback: aflTradeArtifactReadbackReceiptSchema.parse(receiptReadback),
      receiptReadbackArtifactRef,
      receiptReadbackArtifactStatus: receiptReadbackPersistence.status,
      artifactResults,
    };
  } catch (error) {
    if (error instanceof AflTradeValuationOutputCustodyError) throw error;
    throw new AflTradeValuationOutputCustodyError(
      'CUSTODY_FAILURE',
      error instanceof Error
        ? `Valuation output custody failed: ${error.message}`
        : 'Valuation output custody failed.'
    );
  }
}
