import { describe, expect, it } from 'vitest';

import {
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
  AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
  createAflTradeExternalEvidenceBatch,
  createAflTradeExternalEvidenceEnvelope,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';
import { AFL_TRADE_EXTERNAL_HISTORICAL_CAPTURE_COMPLETION_SCHEMA_VERSION } from '@/server/aflTradeIntelligence/source/externalHistoricalCaptureCompletionContracts';
import { PostgresAflTradeExternalHistoricalReconciliationSource } from '@/server/aflTradeIntelligence/source/postgresExternalHistoricalReconciliationSource';

const digest = (character: string) => character.repeat(64);

function fixture() {
  const capture = {
    captureId: `source-capture:${digest('a')}`,
    artifactId: `artifact:${digest('b')}`,
    contentSha256: digest('b'),
    mediaType: 'text/html',
    sourceUrl: 'https://www.draftguru.com.au/years/2025',
    capturedAt: '2026-08-10T00:02:00.000Z',
    effectiveAt: '2025-11-20T00:00:00.000Z',
    parserVersion: 'year/v1',
    fieldManifestSha256: digest('c'),
  };
  const evidence = createAflTradeExternalEvidenceEnvelope({
    schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
    provider: 'draftguru',
    capture,
    sourceRow: { ordinal: 1, sourceKey: 'selection:1' },
    claim: {
      kind: 'draft_selection',
      draftYear: 2025,
      draftType: 'national',
      selectionNumber: 1,
      roundNumber: 1,
      player: { nativeId: null, recordedName: 'Example Player' },
      selectedByClub: { nativeId: null, recordedName: 'Example Club' },
    },
    publicationEligible: false,
  });
  const batch = createAflTradeExternalEvidenceBatch({
    schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
    provider: 'draftguru',
    captureId: capture.captureId,
    evidence: [evidence],
    finalizedAt: '2026-08-10T00:03:00.000Z',
    publicationEligible: false,
  });
  const result = {
    ordinal: 1,
    targetId: `external-capture-target:${digest('d')}`,
    scheduleId: `external-capture-schedule:${digest('e')}`,
    dispatchKey: `external-capture-dispatch:${digest('f')}`,
    occurrenceEventId: `external-capture-occurrence-event:${digest('1')}`,
    occurrenceRevision: 1,
    captureMode: 'captured' as const,
    resultId: batch.batchId,
    captureId: capture.captureId,
    evidenceBatchId: batch.batchId,
    evidenceBatchSha256: batch.batchId.slice('external-evidence-batch:'.length),
    evidenceCount: 1,
    finalizedAt: '2026-08-10T00:03:00.000Z',
  };
  const planId = `external-historical-capture-plan:${digest('2')}`;
  const content = {
    schemaVersion: AFL_TRADE_EXTERNAL_HISTORICAL_CAPTURE_COMPLETION_SCHEMA_VERSION,
    environment: 'test_fixture' as const,
    competition: 'AFLM' as const,
    planId,
    planSha256: digest('2'),
    targetCount: 1,
    targetSetSha256: digest('3'),
    results: [result],
    sourceBatchIds: [batch.batchId],
    resultSetSha256: sha256AflTradeCanonicalJson([result]),
    sourceBatchSetSha256: sha256AflTradeCanonicalJson([batch.batchId]),
    completedAt: '2026-08-10T00:04:00.000Z',
    status: 'complete' as const,
    reconciliationEligible: true as const,
    publicationEligible: false as const,
  };
  const completion = {
    completionId: createAflTradeContentAddress('external-historical-capture-completion', content),
    content,
  };
  return { batch, completion };
}

describe('Postgres historical reconciliation source', () => {
  it('loads the exact finalized completion and issue-free evidence batches', async () => {
    const { batch, completion } = fixture();
    const query = async (sql: string) => {
      if (sql.includes('FROM outcome_external_historical_capture_completion')) {
        return {
          rows: [
            {
              completion_json: completion,
              finalized_at: completion.content.completedAt,
              status: 'complete',
              reconciliation_eligible: true,
              plan_id: completion.content.planId,
              from_year: 2025,
              through_year: 2026,
              target_set_sha256: completion.content.targetSetSha256,
            },
          ],
          rowCount: 1,
        };
      }
      return {
        rows: [
          {
            batch_id: batch.batchId,
            status: 'finalized',
            finalized_at: batch.content.finalizedAt,
            issue_count: 0,
            environment: 'test_fixture',
            competition: 'AFLM',
            anchor_season_year: 2025,
            batch_json: batch,
          },
        ],
        rowCount: 1,
      };
    };
    const client = {
      transaction: async <T>(work: (transaction: { query: typeof query }) => Promise<T>) =>
        work({ query }),
    } as AflOutcomeSqlClient;

    const result = await new PostgresAflTradeExternalHistoricalReconciliationSource(client).load(
      completion.completionId
    );

    expect(result.anchorSeasonYear).toBe(2025);
    expect(result.sourceBatches).toEqual([batch]);
    expect(result.sourceAuthority).toMatchObject({
      completionId: completion.completionId,
      candidateSourceBatchSetSha256: sha256AflTradeCanonicalJson([batch.batchId]),
    });
  });

  it('rejects missing or issue-bearing source batches', async () => {
    const { completion } = fixture();
    const query = async (sql: string) =>
      sql.includes('FROM outcome_external_historical_capture_completion')
        ? {
            rows: [
              {
                completion_json: completion,
                finalized_at: completion.content.completedAt,
                status: 'complete',
                reconciliation_eligible: true,
                plan_id: completion.content.planId,
                from_year: 2025,
                through_year: 2025,
                target_set_sha256: completion.content.targetSetSha256,
              },
            ],
            rowCount: 1,
          }
        : { rows: [], rowCount: 0 };
    const client = {
      transaction: async <T>(work: (transaction: { query: typeof query }) => Promise<T>) =>
        work({ query }),
    } as AflOutcomeSqlClient;

    await expect(
      new PostgresAflTradeExternalHistoricalReconciliationSource(client).load(
        completion.completionId
      )
    ).rejects.toThrow(/batch/i);
  });
});
