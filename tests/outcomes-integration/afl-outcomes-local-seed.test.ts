import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createPostgresDraftTradeReadRepository } from '@/lib/draftTrades/postgres';
import { seedLocalAflTradeOutcomeArchive } from '@/server/aflTradeIntelligence/development/postgresLocalOutcomeArchiveSeed';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { createPostgresAflDraftTradeOutcomeReadService } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeProjectionReadRepository';
import { PostgresAflDraftTradeOutcomeRegistrySnapshotStore } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE } from '@/server/aflTradeIntelligence/outcomes/outcomeReadService';
import { PostgresAflTradePromotionBackedGate2Repository } from '@/server/aflTradeIntelligence/outcomes/postgresPromotionBackedGate2Repository';
import { createPostgresAflTradePromotionBackedPublicArchiveReadRepository } from '@/server/aflTradeIntelligence/outcomes/postgresPromotionBackedPublicArchiveReadRepository';
import { createAflTradePromotionBackedArchiveSelector } from '@/server/aflTradeIntelligence/outcomes/promotionBackedArchiveSelection';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
  })();
const schemaName = `afl_local_seed_${process.pid}_${Date.now()}`;
const adminPool = new Pool({ connectionString: databaseUrl });
const outcomesPool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 1,
});

function scopedDatabaseUrl(): string {
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  return scoped.toString();
}

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], {
    databaseUrl: scopedDatabaseUrl(),
  });
});

afterAll(async () => {
  await outcomesPool.end();
  try {
    await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
  } finally {
    await adminPool.end();
  }
});

describe('local source-native AFL archive seed', () => {
  it('is idempotent and serves 783 local trades through the governed archive reader', async () => {
    const client = createPgAflOutcomeSqlClient(outcomesPool);
    const first = await seedLocalAflTradeOutcomeArchive(client);
    const replay = await seedLocalAflTradeOutcomeArchive(client);

    expect(first.idempotentReplay).toBe(false);
    expect(replay).toEqual({ ...first, idempotentReplay: true });

    const gateRepository = createPostgresAflTradeGateDecisionLedgerRepository(client);
    const registryStore = new PostgresAflDraftTradeOutcomeRegistrySnapshotStore(client);
    const gate2Repository = new PostgresAflTradePromotionBackedGate2Repository(client);
    const selector = createAflTradePromotionBackedArchiveSelector({
      loadRegistry: () => registryStore.load(),
      loadGateDecisionLedger: async () => (await gateRepository.load()).ledger,
      loadGate2Authority: (releaseId) => gate2Repository.loadCurrentAuthority(releaseId),
      expectedEnvironment: 'test_fixture',
      now: () => '2026-08-10T00:01:00.000Z',
    });
    const archive = createPostgresDraftTradeReadRepository({
      archiveSelector: selector,
      archiveRepository: createPostgresAflTradePromotionBackedPublicArchiveReadRepository({
        client,
      }),
    });

    const years = await archive.listYears();
    expect(years).toEqual(Array.from({ length: 38 }, (_, index) => 2025 - index));
    const tradesByYear = await Promise.all(years.map((year) => archive.listTradesByYear(year)));
    expect(tradesByYear.flat()).toHaveLength(783);
    await expect(archive.listTradesByYear(2025)).resolves.toHaveLength(21);
    await expect(archive.listTradesByYear(1988)).resolves.toHaveLength(20);
    await expect(
      archive.listTradesByYear(1988, { clubSlug: 'local-club-01', type: 'player' })
    ).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ title: 'Synthetic local trade 1988-001' })])
    );
    const syntheticMatches = await archive.searchTrades('synthetic local trade 1988-001', 10);
    expect(syntheticMatches).toEqual([
      expect.objectContaining({ title: 'Synthetic local trade 1988-001' }),
    ]);
    const syntheticDetail = await archive.getById(syntheticMatches[0]!.tradeId);
    expect(syntheticDetail).toMatchObject({
      trade: { year: 1988, title: 'Synthetic local trade 1988-001' },
      assets: [
        {
          assetType: 'player',
          playerName: 'Synthetic Player 1988-001',
          games: null,
        },
      ],
    });
    const detail = await archive.getById(first.tradeId);
    expect(detail?.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetType: 'pick',
          pick: expect.objectContaining({ numberGiven: 14, numberActual: 14 }),
          draftedPlayer: 'Harry Kyle',
        }),
        expect.objectContaining({
          assetType: 'future_pick',
          pick: expect.objectContaining({ code: '#2026R2' }),
        }),
      ])
    );

    const outcomeService = createPostgresAflDraftTradeOutcomeReadService({
      client,
      cursorSecret: Buffer.from('local-outcomes-integration-cursor-secret'),
      expectedEnvironment: 'test_fixture',
      loadSourceRightsDecisionLedger: async () => (await gateRepository.load()).ledger,
      now: () => '2026-08-09T10:00:00.000Z',
    });
    const outcomes = await outcomeService.list({
      scopeKey: AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
      year: 2025,
      club: '',
      q: '',
      metric: null,
      status: null,
      limit: 25,
      cursor: null,
    });
    expect(outcomes).toMatchObject({
      items: [],
      page: { total: null, nextCursor: null },
      consistency: { selection: 'none', freshness: 'unavailable' },
    });

    const publicationCount = await outcomesPool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM outcome_valuation_active_publication`
    );
    expect(publicationCount.rows[0]?.count).toBe('0');
    const provenance = await outcomesPool.query<{ provider: string }>(
      `SELECT DISTINCT provider FROM outcome_source_capture ORDER BY provider`
    );
    const registry = await outcomesPool.query<{ registry: string }>(
      `SELECT registry_json::text AS registry FROM outcome_registry_head`
    );
    expect(provenance.rows).toEqual([{ provider: 'statly_local_fixture' }]);
    expect(registry.rows[0]?.registry).not.toMatch(/draftguru|official_afl|workbook/i);
    expect(first).toEqual(
      expect.objectContaining({
        releaseId: expect.stringMatching(/^outcome-release:/),
        projectionId: expect.stringMatching(/^outcome-projection:/),
        publicArchiveId: expect.stringMatching(/^public-factual-archive:/),
        corpusId: expect.stringMatching(/^corpus:/),
        sourceCandidateId: expect.stringMatching(/^external-reconciliation:/),
        promotionId: expect.stringMatching(/^external-canonical-promotion:/),
        archivedTradeCount: 783,
      })
    );
  }, 120_000);
});
