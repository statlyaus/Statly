import { z } from 'zod';

import {
  createAflTradeCanonicalJsonArtifactRef,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../../artifacts/artifactReference';
import type { AflTradeImmutableArtifactRepository } from '../../artifacts/immutableArtifactRepository';
import {
  aflTradeContentAddressedIdSchema,
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../../outcomes/postgresOutcomeReleaseRepository';
import { governedPrivateEvaluationSelectorSchema } from './governedPrivateEvaluationWorkspaceContracts';
import { loadAuthenticatedGovernedPrivateEvaluationMaterialization } from './postgresGovernedPrivateEvaluationReadRepository';

const requestSchema = z
  .object({
    selector: governedPrivateEvaluationSelectorSchema,
    inspectionId: aflTradeContentAddressedIdSchema('private-evaluation-inspection'),
    operationId: aflTradeContentAddressedIdSchema('private-evaluation-operation'),
    generationId: aflTradeContentAddressedIdSchema(
      'local-private-trade-evaluation-generation'
    ),
  })
  .strict();

interface GenerationRow {
  readonly generation_json: unknown;
}

interface TrustedTimeRow {
  readonly trusted_at: Date | string;
}

interface ExistingRow {
  readonly verification_json: unknown;
  readonly artifact_id: string;
}

interface InspectionRow {
  readonly inspection_id: string;
}

function same(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

async function trustedNow(client: AflOutcomeSqlClient): Promise<string> {
  const result = await client.query<TrustedTimeRow>(
    `SELECT date_trunc('milliseconds',clock_timestamp()) AS trusted_at`
  );
  const value = result.rows[0]?.trusted_at;
  const parsed = value instanceof Date ? value : new Date(value ?? Number.NaN);
  if (result.rows.length !== 1 || !Number.isFinite(parsed.getTime())) {
    throw new TypeError('Reconstruction verification requires trusted PostgreSQL time.');
  }
  return parsed.toISOString();
}

async function findExisting(
  client: AflOutcomeSqlClient | AflOutcomeSqlTransaction,
  operationId: string
): Promise<ExistingRow | null> {
  const result = await client.query<ExistingRow>(
    `SELECT verification_json,artifact_id
       FROM outcome_private_evaluation_reconstruction_verification
      WHERE operation_id=$1`,
    [operationId]
  );
  if (result.rows.length > 1) {
    throw new TypeError('Reconstruction operation identity is not unique.');
  }
  return result.rows[0] ?? null;
}

function replayExisting(
  existing: ExistingRow,
  request: z.output<typeof requestSchema>
) {
  const verification = structuredClone(existing.verification_json) as {
    readonly verificationId?: string;
    readonly content?: {
      readonly selector?: unknown;
      readonly inspectionId?: string;
      readonly operationId?: string;
      readonly generationId?: string;
      readonly verifiedAt?: string;
      readonly exactMatch?: boolean;
    };
  };
  const content = verification.content;
  if (
    typeof verification.verificationId !== 'string' ||
    typeof content?.verifiedAt !== 'string' ||
    content.inspectionId !== request.inspectionId ||
    content.operationId !== request.operationId ||
    content.generationId !== request.generationId ||
    content.exactMatch !== true ||
    !same(content.selector, request.selector) ||
    createAflTradeContentAddress(
      'private-evaluation-reconstruction-verification',
      content
    ) !== verification.verificationId ||
    createAflTradeCanonicalJsonArtifactRef(verification, content.verifiedAt).artifactId !==
      existing.artifact_id
  ) {
    throw new TypeError('Reconstruction operation replay conflicts with retained evidence.');
  }
  return {
    state: 'replayed' as const,
    verificationId: verification.verificationId,
    generationId: content.generationId,
    exactMatch: true as const,
    verifiedAt: content.verifiedAt,
    verification,
  };
}

export function createPostgresGovernedPrivateEvaluationReconstructionRepository(dependencies: {
  readonly client: AflOutcomeSqlClient;
  readonly artifactRepository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
  readonly retainArtifact: (artifact: {
    readonly reference: AflTradeArtifactRef;
    readonly bytes: Uint8Array;
  }) => Promise<AflTradeArtifactRef>;
}) {
  if (
    dependencies.artifactRepository.artifactClass !== 'derived_private' ||
    !Number.isSafeInteger(dependencies.maximumArtifactBytes) ||
    dependencies.maximumArtifactBytes <= 0
  ) {
    throw new TypeError('Reconstruction verification requires bounded private artifact custody.');
  }
  return {
    async verify(unparsedRequest: z.input<typeof requestSchema>) {
      const request = requestSchema.parse(unparsedRequest);
      const generationResult = await dependencies.client.query<GenerationRow>(
        `SELECT generation_json
           FROM outcome_local_private_trade_evaluation_generation
          WHERE valuation_scope_key=$1 AND trade_id=$2 AND generation_id=$3`,
        [request.selector.valuationScopeKey, request.selector.tradeId, request.generationId]
      );
      if (generationResult.rows.length !== 1) {
        throw new TypeError('Reconstruction requires one exact retained generation.');
      }
      const materialization = await loadAuthenticatedGovernedPrivateEvaluationMaterialization({
        generationJson: generationResult.rows[0]!.generation_json,
        artifactRepository: dependencies.artifactRepository,
        maximumArtifactBytes: dependencies.maximumArtifactBytes,
      });
      if (
        materialization.generation.generationId !== request.generationId ||
        !same(materialization.generation.content.selector, request.selector)
      ) {
        throw new TypeError('Reconstruction escaped its composite generation selector.');
      }
      const priorOperation = await findExisting(dependencies.client, request.operationId);
      if (priorOperation !== null) return replayExisting(priorOperation, request);
      const verifiedAt = await trustedNow(dependencies.client);
      const content = {
        schemaVersion: 'private-evaluation-reconstruction-verification/v1' as const,
        environment: 'test_fixture' as const,
        publicationProhibited: true as const,
        selector: request.selector,
        inspectionId: request.inspectionId,
        operationId: request.operationId,
        generationId: request.generationId,
        projectionManifestId: materialization.projectionManifest.projectionManifestId,
        verifiedAt,
        exactMatch: true as const,
        artifacts: materialization.artifacts.map(({ kind, reference }) => ({
          kind,
          artifact: reference,
        })),
        limitation:
          'Private test-fixture reconstruction only; it grants no factual, model, production, or publication authority.' as const,
      };
      const verification = {
        verificationId: createAflTradeContentAddress(
          'private-evaluation-reconstruction-verification',
          content
        ),
        content,
      };
      const artifact = createAflTradeCanonicalJsonArtifactRef(verification, verifiedAt);
      const bytes = new TextEncoder().encode(canonicalizeAflTradeJson(verification));
      const retained = await dependencies.retainArtifact({ reference: artifact, bytes });
      if (
        retained.artifactId !== artifact.artifactId ||
        !doesAflTradeArtifactRefMatchCanonicalJson(retained, verification)
      ) {
        throw new TypeError('Reconstruction verification bytes were not retained exactly.');
      }
      return dependencies.client.transaction(async (transaction) => {
        const replay = await findExisting(transaction, request.operationId);
        if (replay !== null) return replayExisting(replay, request);
        const inspection = await transaction.query<InspectionRow>(
          `SELECT inspection_id
             FROM outcome_private_evaluation_inspection_receipt
            WHERE inspection_id=$1 AND valuation_scope_key=$2 AND trade_id=$3
              AND state IN ('ready','unavailable') AND valid_through >= $4
            FOR KEY SHARE`,
          [
            request.inspectionId,
            request.selector.valuationScopeKey,
            request.selector.tradeId,
            verifiedAt,
          ]
        );
        const generationStillExists = await transaction.query(
          `SELECT generation_id
             FROM outcome_local_private_trade_evaluation_generation
            WHERE valuation_scope_key=$1 AND trade_id=$2 AND generation_id=$3
            FOR KEY SHARE`,
          [request.selector.valuationScopeKey, request.selector.tradeId, request.generationId]
        );
        if (inspection.rows.length !== 1 || generationStillExists.rows.length !== 1) {
          throw new TypeError('Reconstruction inspection or generation authority is stale.');
        }
        const inserted = await transaction.query(
          `INSERT INTO outcome_private_evaluation_reconstruction_verification
            (verification_id,inspection_id,operation_id,valuation_scope_key,trade_id,
             generation_id,artifact_id,verified_at,exact_match,content_sha256,
             content_canonical_json,verification_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9,$10,$11::jsonb)`,
          [
            verification.verificationId,
            request.inspectionId,
            request.operationId,
            request.selector.valuationScopeKey,
            request.selector.tradeId,
            request.generationId,
            artifact.artifactId,
            verifiedAt,
            verification.verificationId.slice(
              'private-evaluation-reconstruction-verification:'.length
            ),
            canonicalizeAflTradeJson(content),
            canonicalizeAflTradeJson(verification),
          ]
        );
        if (inserted.rowCount !== 1) {
          throw new TypeError('Reconstruction verification was not persisted exactly once.');
        }
        return {
          state: 'verified' as const,
          verificationId: verification.verificationId,
          generationId: request.generationId,
          exactMatch: true as const,
          verifiedAt,
          verification,
        };
      });
    },
  };
}
