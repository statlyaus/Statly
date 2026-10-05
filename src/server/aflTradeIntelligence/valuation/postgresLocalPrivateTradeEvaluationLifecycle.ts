import {
  aflTradeArtifactRefSchema,
  doAflTradeArtifactRefsExactlyMatch,
} from '../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import {
  parseAnyLocalPrivateTradeEvaluationGeneration,
} from './localPrivateTradeEvaluationContracts';
import { LOCAL_PRIVATE_TRADE_EVALUATION_GENERATION_V3_SCHEMA_VERSION } from './localPrivateTradeEvaluationGenerationV3';
import type { LocalPrivateTradeEvaluationLifecycle } from './localPrivateTradeEvaluationModule';

interface GenerationRow {
  generation_json: unknown;
  artifact_json: unknown;
}

interface HeadRow {
  trade_id: string;
  generation_id: string | null;
  revision: number;
  withdrawal_reason: string | null;
}

interface ActivationHistoryRow {
  was_active: boolean;
}

export class PostgresLocalPrivateTradeEvaluationLifecycle implements LocalPrivateTradeEvaluationLifecycle {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async loadHead(tradeId: string) {
    const result = await this.client.query<HeadRow>(
      `SELECT trade_id,generation_id,revision,withdrawal_reason
         FROM outcome_local_private_trade_evaluation_head
        WHERE trade_id=$1`,
      [tradeId]
    );
    if (result.rows.length === 0) return null;
    if (result.rows.length !== 1 || result.rows[0]?.trade_id !== tradeId) {
      throw new TypeError('Local private trade evaluation head is not unique.');
    }
    return {
      tradeId,
      generationId: result.rows[0].generation_id,
      revision: result.rows[0].revision,
      withdrawalReason: result.rows[0].withdrawal_reason,
    };
  }

  async loadGeneration(generationId: string) {
    const result = await this.client.query<GenerationRow>(
      `SELECT generation_json,artifact_json
         FROM outcome_local_private_trade_evaluation_generation
        WHERE generation_id=$1`,
      [generationId]
    );
    if (result.rows.length === 0) return null;
    if (result.rows.length !== 1) {
      throw new TypeError('Local private trade evaluation generation is not unique.');
    }
    return {
      generation: parseAnyLocalPrivateTradeEvaluationGeneration(result.rows[0]!.generation_json),
      artifact: aflTradeArtifactRefSchema.parse(result.rows[0]!.artifact_json),
    };
  }

  async saveGeneration(
    input: Parameters<LocalPrivateTradeEvaluationLifecycle['saveGeneration']>[0]
  ) {
    const generation = parseAnyLocalPrivateTradeEvaluationGeneration(input.generation);
    const artifact = aflTradeArtifactRefSchema.parse(input.artifact);
    const v3Ancestry =
      generation.content.schemaVersion ===
      LOCAL_PRIVATE_TRADE_EVALUATION_GENERATION_V3_SCHEMA_VERSION
        ? {
            authoritySnapshotId: generation.content.authorityReview.authoritySnapshotId,
            inspectionReceiptId: generation.content.authorityReview.inspectionReceiptId,
            transitionIntentId: generation.content.authorityReview.transitionIntentId,
            derivationFingerprint: generation.content.derivationFingerprint,
          }
        : null;
    await this.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `local-private-trade-evaluation-generation:${generation.generationId}`,
      ]);
      await transaction.query(
        `INSERT INTO outcome_local_private_trade_evaluation_generation
          (generation_id,valuation_scope_key,trade_id,workbook_sha256,
           dependency_fingerprint,generated_at,generation_content_sha256,
           artifact_sha256,authority_snapshot_id,inspection_receipt_id,
           transition_intent_id,derivation_fingerprint,generation_json,artifact_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb)
         ON CONFLICT (generation_id) DO NOTHING`,
        [
          generation.generationId,
          generation.content.valuationScopeKey,
          generation.content.tradeId,
          generation.content.workbookSha256,
          generation.content.dependencyFingerprint,
          generation.content.generatedAt,
          generation.generationId.slice('local-private-trade-evaluation-generation:'.length),
          artifact.contentSha256,
          v3Ancestry?.authoritySnapshotId ?? null,
          v3Ancestry?.inspectionReceiptId ?? null,
          v3Ancestry?.transitionIntentId ?? null,
          v3Ancestry?.derivationFingerprint ?? null,
          generation,
          artifact,
        ]
      );
      const retained = await transaction.query<GenerationRow>(
        `SELECT generation_json,artifact_json
           FROM outcome_local_private_trade_evaluation_generation
          WHERE generation_id=$1 FOR SHARE`,
        [generation.generationId]
      );
      const retainedArtifact = aflTradeArtifactRefSchema.parse(retained.rows[0]?.artifact_json);
      if (
        retained.rows.length !== 1 ||
        canonicalizeAflTradeJson(retained.rows[0]?.generation_json) !==
          canonicalizeAflTradeJson(generation) ||
        !doAflTradeArtifactRefsExactlyMatch(retainedArtifact, artifact)
      ) {
        throw new TypeError('Local private trade evaluation generation replay conflicts.');
      }
    });
  }

  async compareAndSetHead(
    input: Parameters<LocalPrivateTradeEvaluationLifecycle['compareAndSetHead']>[0]
  ) {
    return this.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `local-private-trade-evaluation-head:${input.tradeId}`,
      ]);
      const retained = await transaction.query<HeadRow>(
        `SELECT trade_id,generation_id,revision,withdrawal_reason
           FROM outcome_local_private_trade_evaluation_head
          WHERE trade_id=$1 FOR UPDATE`,
        [input.tradeId]
      );
      if (retained.rows.length > 1) {
        throw new TypeError('Local private trade evaluation head is not unique.');
      }
      const currentGenerationId = retained.rows[0]?.generation_id ?? null;
      const currentRevision = retained.rows[0]?.revision ?? null;
      if (
        currentGenerationId !== input.expectedGenerationId ||
        currentRevision !== input.expectedRevision
      ) {
        return { state: 'conflict' as const, currentGenerationId, currentRevision };
      }
      if (input.generationId !== null) {
        const target = await transaction.query<{ trade_id: string }>(
          `SELECT trade_id
             FROM outcome_local_private_trade_evaluation_generation
            WHERE generation_id=$1 FOR SHARE`,
          [input.generationId]
        );
        if (target.rows.length !== 1 || target.rows[0]?.trade_id !== input.tradeId) {
          throw new TypeError('Local private evaluation head target belongs to another trade.');
        }
      }
      if (input.action === 'rollback') {
        if (input.generationId === currentGenerationId) {
          return { state: 'invalid_rollback' as const, reason: 'target_is_current' as const };
        }
        const history = await transaction.query<ActivationHistoryRow>(
          `SELECT EXISTS (
             SELECT 1
               FROM outcome_local_private_trade_evaluation_transition transition
              WHERE transition.trade_id=$1
                AND transition.to_generation_id=$2
                AND transition.action IN ('activate','rollback')
           ) AS was_active`,
          [input.tradeId, input.generationId]
        );
        if (history.rows.length !== 1 || history.rows[0]?.was_active !== true) {
          return {
            state: 'invalid_rollback' as const,
            reason: 'target_was_not_previously_active' as const,
          };
        }
      }
      await transaction.query(
        `INSERT INTO outcome_local_private_trade_evaluation_head
          (trade_id,generation_id,revision,status,withdrawal_reason,updated_at)
         VALUES ($1,$2,1,$3,$4,transaction_timestamp())
         ON CONFLICT (trade_id) DO UPDATE
           SET generation_id=EXCLUDED.generation_id,
               revision=outcome_local_private_trade_evaluation_head.revision+1,
               status=EXCLUDED.status,
               withdrawal_reason=EXCLUDED.withdrawal_reason,
               updated_at=transaction_timestamp()`,
        [
          input.tradeId,
          input.generationId,
          input.generationId === null ? 'withdrawn' : 'active',
          input.withdrawalReason,
        ]
      );
      await transaction.query(
        `INSERT INTO outcome_local_private_trade_evaluation_transition
          (trade_id,from_generation_id,to_generation_id,action,reason,changed_at)
         VALUES ($1,$2,$3,$4,$5,transaction_timestamp())`,
        [
          input.tradeId,
          currentGenerationId,
          input.generationId,
          input.action,
          input.withdrawalReason,
        ]
      );
      return { state: 'updated' as const };
    });
  }
}
