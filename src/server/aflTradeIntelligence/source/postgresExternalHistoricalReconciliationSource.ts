import { z } from 'zod';

import {
  aflTradeContentAddressedIdSchema,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import { parseAflTradeExternalEvidenceBatch } from './externalDraftTradeEvidenceContracts';
import type { AflTradeHistoricalReconciliationSource } from './externalHistoricalReconciliationPreparation';
import { aflTradeExternalHistoricalCaptureCompletionSchema } from './externalHistoricalCaptureCompletionContracts';
import {
  AFL_TRADE_EXTERNAL_RECONCILIATION_SOURCE_AUTHORITY_SCHEMA_VERSION,
  createAflTradeHistoricalCompletionReconciliationAuthority,
} from './externalReconciliationSourceAuthorityContracts';

export class AflTradeExternalHistoricalReconciliationSourceError extends Error {
  constructor(
    readonly code: 'COMPLETION_UNAVAILABLE' | 'SOURCE_BATCH_UNAVAILABLE',
    message: string
  ) {
    super(message);
    this.name = 'AflTradeExternalHistoricalReconciliationSourceError';
  }
}

function instant(value: string | Date): string {
  return typeof value === 'string' ? new Date(value).toISOString() : value.toISOString();
}

export class PostgresAflTradeExternalHistoricalReconciliationSource implements AflTradeHistoricalReconciliationSource {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async load(completionIdInput: string) {
    const completionId = aflTradeContentAddressedIdSchema(
      'external-historical-capture-completion'
    ).parse(completionIdInput);
    return this.client.transaction(async (transaction) => {
      const completionResult = await transaction.query<{
        completion_json: unknown;
        finalized_at: string | Date | null;
        status: string;
        reconciliation_eligible: boolean;
        plan_id: string;
        from_year: number;
        through_year: number;
        target_set_sha256: string;
      }>(
        `SELECT completion.completion_json,completion.finalized_at,completion.status,
                completion.reconciliation_eligible,plan.plan_id,plan.from_year,
                plan.through_year,plan.target_set_sha256
           FROM outcome_external_historical_capture_completion completion
           JOIN outcome_external_historical_capture_plan plan ON plan.plan_id=completion.plan_id
          WHERE completion.completion_id=$1
          FOR SHARE OF completion,plan`,
        [completionId]
      );
      const row = completionResult.rows[0];
      if (
        completionResult.rows.length !== 1 ||
        !row ||
        row.status !== 'complete' ||
        !row.reconciliation_eligible ||
        row.finalized_at === null
      ) {
        throw new AflTradeExternalHistoricalReconciliationSourceError(
          'COMPLETION_UNAVAILABLE',
          'Historical capture completion is absent, unfinalized, or not reconciliation eligible.'
        );
      }
      const completion = aflTradeExternalHistoricalCaptureCompletionSchema.parse(
        row.completion_json
      );
      if (
        completion.completionId !== completionId ||
        completion.content.planId !== row.plan_id ||
        completion.content.targetSetSha256 !== row.target_set_sha256 ||
        instant(row.finalized_at) !== completion.content.completedAt
      ) {
        throw new AflTradeExternalHistoricalReconciliationSourceError(
          'COMPLETION_UNAVAILABLE',
          'Historical capture completion does not match its durable plan or finalization.'
        );
      }

      const batchesResult = await transaction.query<{
        batch_id: string;
        status: string;
        finalized_at: string | Date | null;
        issue_count: number | string;
        environment: string;
        competition: string;
        anchor_season_year: number;
        batch_json: unknown;
      }>(
        `SELECT batch.batch_id,batch.status,batch.finalized_at,batch.issue_count,
                capture.environment,capture.competition,capture.anchor_season_year,batch.batch_json
           FROM outcome_external_evidence_batch batch
           JOIN outcome_source_capture capture ON capture.capture_id=batch.capture_id
          WHERE batch.batch_id=ANY($1::text[])
          FOR SHARE OF batch,capture`,
        [completion.content.sourceBatchIds]
      );
      const byId = new Map(batchesResult.rows.map((batch) => [batch.batch_id, batch]));
      const sourceBatches = completion.content.sourceBatchIds.map((batchId) => {
        const batchRow = byId.get(batchId);
        if (
          !batchRow ||
          batchRow.status !== 'finalized' ||
          batchRow.finalized_at === null ||
          Number(batchRow.issue_count) !== 0 ||
          batchRow.environment !== completion.content.environment ||
          batchRow.competition !== completion.content.competition ||
          batchRow.anchor_season_year < row.from_year ||
          batchRow.anchor_season_year > row.through_year ||
          Date.parse(instant(batchRow.finalized_at)) > Date.parse(completion.content.completedAt)
        ) {
          throw new AflTradeExternalHistoricalReconciliationSourceError(
            'SOURCE_BATCH_UNAVAILABLE',
            `Historical source batch ${batchId} is absent, unfinalized, issue-bearing, or out of scope.`
          );
        }
        const batch = parseAflTradeExternalEvidenceBatch(batchRow.batch_json);
        if (batch.batchId !== batchId) {
          throw new AflTradeExternalHistoricalReconciliationSourceError(
            'SOURCE_BATCH_UNAVAILABLE',
            `Historical source batch ${batchId} has mismatched canonical content.`
          );
        }
        return batch;
      });
      if (byId.size !== completion.content.sourceBatchIds.length) {
        throw new AflTradeExternalHistoricalReconciliationSourceError(
          'SOURCE_BATCH_UNAVAILABLE',
          'Historical completion source-batch membership is not exact.'
        );
      }
      const candidateSourceBatchIds = sourceBatches.map(({ batchId }) => batchId).sort();
      return {
        environment: completion.content.environment,
        competition: completion.content.competition,
        anchorSeasonYear: z.number().int().min(1897).max(2200).parse(row.through_year),
        sourceAuthority: createAflTradeHistoricalCompletionReconciliationAuthority({
          schemaVersion: AFL_TRADE_EXTERNAL_RECONCILIATION_SOURCE_AUTHORITY_SCHEMA_VERSION,
          kind: 'historical_plan_completion',
          completionId,
          completionSha256: completionId.slice('external-historical-capture-completion:'.length),
          planId: completion.content.planId,
          planSha256: completion.content.planSha256,
          targetSetSha256: completion.content.targetSetSha256,
          resultSetSha256: completion.content.resultSetSha256,
          completionSourceBatchSetSha256: completion.content.sourceBatchSetSha256,
          candidateSourceBatchSetSha256: sha256AflTradeCanonicalJson(candidateSourceBatchIds),
          completedAt: completion.content.completedAt,
        }),
        sourceBatches,
      };
    });
  }
}
