import { describe, expect, it } from 'vitest';

import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  createAflTradeExternalDiscoveryInventory,
  createAflTradeExternalHistoricalCapturePlan,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeDiscoveryContracts';
import { PostgresAflTradeExternalDiscoveryRepository } from '@/server/aflTradeIntelligence/source/postgresExternalDraftTradeDiscoveryRepository';

const instant = '2026-08-10T00:00:00.000Z';
const sha = (character: string) => character.repeat(64);

function fixture() {
  const inventory = createAflTradeExternalDiscoveryInventory({
    schemaVersion: 'afl-trade-external-discovery-inventory/v1',
    environment: 'test_fixture',
    provider: 'draftguru',
    competition: 'AFLM',
    sourceCaptureId: `source-capture:${sha('a')}`,
    sourceEvidenceBatchId: `external-evidence-batch:${sha('b')}`,
    sourceContentSha256: sha('c'),
    sourceUrl: 'https://www.draftguru.com.au/trades',
    fromYear: 2024,
    throughYear: 2025,
    links: [
      {
        ordinal: 1,
        evidenceId: `external-evidence:${sha('1')}`,
        anchorSeasonYear: 2024,
        nativeEventId: '2024-alpha-trade',
        sourceUrl: 'https://www.draftguru.com.au/trades/2024-alpha-trade',
      },
      {
        ordinal: 2,
        evidenceId: `external-evidence:${sha('2')}`,
        anchorSeasonYear: 2025,
        nativeEventId: '2025-beta-trade',
        sourceUrl: 'https://www.draftguru.com.au/trades/2025-beta-trade',
      },
    ],
    discoveredAt: instant,
    completeForCapturedIndex: true,
    publicationEligible: false,
  });
  const plan = createAflTradeExternalHistoricalCapturePlan({
    inventory,
    plannedAt: '2026-08-10T00:01:00.000Z',
    parserVersions: {
      tradeDetail: 'draftguru-trade-detail/v1',
      yearPage: 'draftguru-year-page/v1',
    },
    datasetVersions: {
      tradeDetail: 'draftguru-2026-08-10',
      yearPage: 'draftguru-2026-08-10',
    },
    fieldManifestSha256: { tradeDetail: sha('d'), yearPage: sha('e') },
    authorities: {
      tradeDetail: {
        rightsArtifactId: `source-rights:${sha('f')}`,
        fieldUses: [{ sourceField: 'trade_id', use: 'archive_fact' }],
        cacheSeconds: 86_400,
        rawRetentionDays: 365,
      },
      yearPage: {
        rightsArtifactId: `source-rights:${sha('9')}`,
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
  return { inventory, plan };
}

function fakeClient(options?: {
  replayInventory?: boolean;
  replayPlan?: boolean;
  loadPlan?: boolean;
}) {
  const { inventory, plan } = fixture();
  const statements: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const schedules = new Map<string, unknown>();
  const query = async (sql: string, parameters: readonly unknown[] = []) => {
    statements.push({ sql, parameters });
    if (
      sql.includes('FROM outcome_external_trade_discovery_inventory') &&
      sql.includes('FOR SHARE')
    ) {
      return options?.replayInventory
        ? {
            rows: [
              {
                inventory_json: inventory,
                finalized_at: inventory.content.discoveredAt,
                link_count: inventory.content.links.length,
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
      return options?.replayPlan
        ? {
            rows: [
              {
                plan_json: plan,
                finalized_at: plan.content.plannedAt,
                target_count: plan.content.targetCount,
              },
            ],
            rowCount: 1,
          }
        : { rows: [], rowCount: 0 };
    }
    if (
      options?.loadPlan &&
      sql.includes('FROM outcome_external_historical_capture_plan') &&
      !sql.includes('FOR SHARE')
    ) {
      return {
        rows: [
          {
            plan_json: plan,
            finalized_at: plan.content.plannedAt,
            target_count: plan.content.targetCount,
          },
        ],
        rowCount: 1,
      };
    }
    if (options?.loadPlan && sql.includes('FROM outcome_external_historical_capture_target')) {
      const afterOrdinal = Number(parameters[1]);
      const maximumTargets = Number(parameters[2]);
      const targets = plan.content.targets.slice(afterOrdinal, afterOrdinal + maximumTargets);
      return {
        rows: targets.map((target) => ({
          ordinal: target.content.ordinal,
          target_id: target.targetId,
          target_json: target,
        })),
        rowCount: targets.length,
      };
    }
    if (
      sql.includes('INSERT INTO outcome_external_capture_schedule\n') &&
      !sql.includes('outcome_external_capture_schedule_event')
    ) {
      schedules.set(String(parameters[0]), JSON.parse(String(parameters[10])));
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('SELECT schedule.definition_json, head.state')) {
      return {
        rows: [{ definition_json: schedules.get(String(parameters[0])), state: null }],
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
  return { client, statements };
}

describe('PostgreSQL external trade discovery repository', () => {
  it('atomically seals an exact discovery inventory', async () => {
    const { inventory } = fixture();
    const database = fakeClient();
    const repository = new PostgresAflTradeExternalDiscoveryRepository(database.client);

    await expect(repository.persistInventory(inventory)).resolves.toEqual({
      inventoryId: inventory.inventoryId,
      linkCount: 2,
      idempotentReplay: false,
    });
    expect(
      database.statements.some(({ sql }) =>
        sql.includes('INSERT INTO outcome_external_trade_discovery_link')
      )
    ).toBe(true);
    expect(
      database.statements.some(({ sql }) =>
        sql.includes('UPDATE outcome_external_trade_discovery_inventory')
      )
    ).toBe(true);
  });

  it('registers every target schedule and seals the historical plan in one transaction', async () => {
    const { plan } = fixture();
    const database = fakeClient({ replayInventory: true });
    const repository = new PostgresAflTradeExternalDiscoveryRepository(database.client);

    await expect(repository.persistPlan(plan)).resolves.toEqual({
      planId: plan.planId,
      targetCount: 4,
      idempotentReplay: false,
    });
    expect(
      database.statements.filter(
        ({ sql }) =>
          sql.includes('INSERT INTO outcome_external_capture_schedule\n') &&
          !sql.includes('outcome_external_capture_schedule_event')
      )
    ).toHaveLength(4);
    expect(
      database.statements.some(({ sql }) =>
        sql.includes('INSERT INTO outcome_external_historical_capture_target')
      )
    ).toBe(true);
    expect(
      database.statements.some(({ sql }) =>
        sql.includes('UPDATE outcome_external_historical_capture_plan')
      )
    ).toBe(true);
    expect(database.statements.some(({ sql }) => /outcome_(release|valuation)/.test(sql))).toBe(
      false
    );
  });

  it('returns exact finalized records as idempotent replays without child writes', async () => {
    const { inventory, plan } = fixture();
    const database = fakeClient({ replayInventory: true, replayPlan: true });
    const repository = new PostgresAflTradeExternalDiscoveryRepository(database.client);

    await expect(repository.persistInventory(inventory)).resolves.toMatchObject({
      idempotentReplay: true,
    });
    await expect(repository.persistPlan(plan)).resolves.toMatchObject({ idempotentReplay: true });
    expect(
      database.statements.some(({ sql }) =>
        sql.includes('INSERT INTO outcome_external_trade_discovery_link')
      )
    ).toBe(false);
    expect(
      database.statements.some(({ sql }) =>
        sql.includes('INSERT INTO outcome_external_historical_capture_target')
      )
    ).toBe(false);
  });

  it('loads a bounded contiguous page only from the exact finalized plan', async () => {
    const { plan } = fixture();
    const database = fakeClient({ loadPlan: true });
    const repository = new PostgresAflTradeExternalDiscoveryRepository(database.client);

    await expect(
      repository.loadFinalizedPlanPage({
        planId: plan.planId,
        afterOrdinal: 1,
        maximumTargets: 2,
      })
    ).resolves.toMatchObject({
      planId: plan.planId,
      targetCount: 4,
      afterOrdinal: 1,
      nextAfterOrdinal: 3,
      targets: [{ content: { ordinal: 2 } }, { content: { ordinal: 3 } }],
    });
  });
});
