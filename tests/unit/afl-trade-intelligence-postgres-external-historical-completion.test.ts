import { describe, expect, it } from 'vitest';

import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  createAflTradeExternalDiscoveryInventory,
  createAflTradeExternalHistoricalCapturePlan,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeDiscoveryContracts';
import { PostgresAflTradeExternalHistoricalCaptureCompletionRepository } from '@/server/aflTradeIntelligence/source/postgresExternalHistoricalCaptureCompletionRepository';

const sha = (character: string) => character.repeat(64);

function plan() {
  const inventory = createAflTradeExternalDiscoveryInventory({
    schemaVersion: 'afl-trade-external-discovery-inventory/v1',
    environment: 'test_fixture',
    provider: 'draftguru',
    competition: 'AFLM',
    sourceCaptureId: `source-capture:${sha('a')}`,
    sourceEvidenceBatchId: `external-evidence-batch:${sha('b')}`,
    sourceContentSha256: sha('c'),
    sourceUrl: 'https://www.draftguru.com.au/trades',
    fromYear: 2025,
    throughYear: 2025,
    links: [
      {
        ordinal: 1,
        evidenceId: `external-evidence:${sha('d')}`,
        anchorSeasonYear: 2025,
        nativeEventId: '2025-example-trade',
        sourceUrl: 'https://www.draftguru.com.au/trades/2025-example-trade',
      },
    ],
    discoveredAt: '2026-08-10T00:00:00.000Z',
    completeForCapturedIndex: true,
    publicationEligible: false,
  });
  return createAflTradeExternalHistoricalCapturePlan({
    inventory,
    plannedAt: '2026-08-10T00:01:00.000Z',
    parserVersions: { tradeDetail: 'trade/v1', yearPage: 'year/v1' },
    datasetVersions: { tradeDetail: 'trade-v1', yearPage: 'year-v1' },
    fieldManifestSha256: { tradeDetail: sha('e'), yearPage: sha('f') },
    authorities: {
      tradeDetail: {
        rightsArtifactId: `source-rights:${sha('1')}`,
        fieldUses: [{ sourceField: 'trade_id', use: 'archive_fact' }],
        cacheSeconds: 86_400,
        rawRetentionDays: 365,
      },
      yearPage: {
        rightsArtifactId: `source-rights:${sha('2')}`,
        fieldUses: [{ sourceField: 'selection_number', use: 'archive_fact' }],
        cacheSeconds: 86_400,
        rawRetentionDays: 365,
      },
    },
    execution: {
      maximumAttempts: 5,
      leaseSeconds: 300,
      retryBaseSeconds: 30,
      retryMaximumSeconds: 3_600,
      maximumLatenessSeconds: 2_592_000,
      circuitFailureThreshold: 5,
      circuitResetSeconds: 900,
    },
    maximumBytes: 2_000_000,
  });
}

function fakeClient(options?: { secondStatus?: string; replay?: boolean }) {
  const sourcePlan = plan();
  const statements: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const batchIds = [`external-evidence-batch:${sha('3')}`, `external-evidence-batch:${sha('4')}`];
  const captureIds = [`source-capture:${sha('5')}`, `source-capture:${sha('6')}`];
  const query = async (sql: string, parameters: readonly unknown[] = []) => {
    statements.push({ sql, parameters });
    if (
      sql.includes('FROM outcome_external_historical_capture_completion') &&
      sql.includes('FOR SHARE')
    ) {
      return options?.replay
        ? {
            rows: [
              {
                completion_json: JSON.parse(
                  String(
                    statements.find(({ sql: prior }) =>
                      prior.includes('INSERT INTO outcome_external_historical_capture_completion\n')
                    )?.parameters[10] ?? '{}'
                  )
                ),
                finalized_at: '2026-08-10T00:08:00.000Z',
              },
            ],
            rowCount: 1,
          }
        : { rows: [], rowCount: 0 };
    }
    if (
      sql.includes('FROM outcome_external_historical_capture_plan') &&
      sql.includes('FOR SHARE')
    ) {
      return {
        rows: [{ plan_json: sourcePlan, finalized_at: sourcePlan.content.plannedAt }],
        rowCount: 1,
      };
    }
    if (sql.includes('FROM outcome_external_capture_occurrence occurrence')) {
      const index = sourcePlan.content.targets.findIndex(
        ({ content }) => content.schedule.scheduleId === parameters[0]
      );
      const status = index === 1 ? (options?.secondStatus ?? 'not_modified') : 'completed';
      return {
        rows: [
          {
            dispatch_key: `external-capture-dispatch:${sha(index === 0 ? '7' : '8')}`,
            status,
            revision: 2,
            event_id: `external-capture-occurrence-event:${sha(index === 0 ? '9' : 'a')}`,
            event_revision: 2,
            completed_at: `2026-08-10T00:0${5 + index}:00.000Z`,
            result_id:
              status === 'completed'
                ? batchIds[index]
                : `source-capture-attempt:${sha(index === 0 ? 'b' : 'c')}`,
          },
        ],
        rowCount: 1,
      };
    }
    if (
      sql.includes('FROM outcome_external_evidence_batch batch') &&
      sql.includes('batch.batch_id=$1')
    ) {
      const index = batchIds.indexOf(String(parameters[0]));
      return {
        rows: [
          {
            batch_id: batchIds[index],
            capture_id: captureIds[index],
            evidence_count: 3 + index,
            issue_count: 0,
            status: 'finalized',
            finalized_at: `2026-08-10T00:0${5 + index}:00.000Z`,
            environment: 'test_fixture',
            provider: 'draftguru',
            competition: 'AFLM',
            anchor_season_year: 2025,
            capability_id:
              sourcePlan.content.targets[index]?.content.schedule.definition.requestTemplate
                .capabilityId,
            source_url:
              sourcePlan.content.targets[index]?.content.schedule.definition.requestTemplate
                .sourceUrl,
          },
        ],
        rowCount: 1,
      };
    }
    if (sql.includes('FROM outcome_source_capture_attempt attempt')) {
      return {
        rows: [
          {
            batch_id: batchIds[1],
            capture_id: captureIds[1],
            evidence_count: 4,
            issue_count: 0,
            status: 'finalized',
            finalized_at: '2026-08-10T00:06:00.000Z',
            environment: 'test_fixture',
            provider: 'draftguru',
            competition: 'AFLM',
            anchor_season_year: 2025,
            capability_id: 'draftguru-year-page',
            source_url: 'https://www.draftguru.com.au/years/2025',
          },
        ],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: sql.includes('INSERT') || sql.includes('UPDATE') ? 1 : 0 };
  };
  const client: AflOutcomeSqlClient = {
    query: query as AflOutcomeSqlClient['query'],
    async transaction(work) {
      return work({ query: query as AflOutcomeSqlClient['query'] });
    },
  };
  return { client, statements, sourcePlan };
}

describe('PostgreSQL external historical capture completion repository', () => {
  it('derives and atomically seals fresh and 304 evidence from durable occurrences', async () => {
    const database = fakeClient();
    const repository = new PostgresAflTradeExternalHistoricalCaptureCompletionRepository(
      database.client
    );

    await expect(repository.completePlan(database.sourcePlan.planId)).resolves.toMatchObject({
      targetCount: 2,
      sourceBatchCount: 2,
      idempotentReplay: false,
    });
    expect(
      database.statements.filter(({ sql }) =>
        sql.includes('INSERT INTO outcome_external_historical_capture_completion_result')
      )
    ).toHaveLength(2);
    expect(
      database.statements.some(({ sql }) =>
        sql.includes('UPDATE outcome_external_historical_capture_completion')
      )
    ).toBe(true);
  });

  it('fails closed before writing when any planned occurrence is not usable', async () => {
    const database = fakeClient({ secondStatus: 'dead_letter' });
    const repository = new PostgresAflTradeExternalHistoricalCaptureCompletionRepository(
      database.client
    );

    await expect(repository.completePlan(database.sourcePlan.planId)).rejects.toMatchObject({
      code: 'PLAN_INCOMPLETE',
    });
    expect(
      database.statements.some(({ sql }) =>
        sql.includes('INSERT INTO outcome_external_historical_capture_completion\n')
      )
    ).toBe(false);
  });
});
