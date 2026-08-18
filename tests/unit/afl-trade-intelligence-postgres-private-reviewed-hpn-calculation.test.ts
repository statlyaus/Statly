// @vitest-environment node

import { readFileSync } from 'node:fs';

import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createAflTradeHpnReviewedSeasonDecision,
  createAflTradeHpnReviewedSeasonUniverseCandidate,
  sealAflTradeHpnReviewedSeasonUniverse,
} from '@/server/aflTradeIntelligence/modeling/hpnReviewedSeasonUniverse';
import { PostgresAflTradeHpnReviewedSeasonUniverseRepository } from '@/server/aflTradeIntelligence/modeling/postgresHpnReviewedSeasonUniverseRepository';
import { PostgresAflTradePrivateReviewedHpnCalculationRepository } from '@/server/aflTradeIntelligence/modeling/postgresPrivateReviewedHpnCalculationRepository';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';

const REVIEW_MIGRATION = readFileSync(
  new URL(
    '../../prisma/afl-trade-outcomes/migrations/0053_hpn_reviewed_season_universe/migration.sql',
    import.meta.url
  ),
  'utf8'
);
const CALCULATION_MIGRATION = readFileSync(
  new URL(
    '../../prisma/afl-trade-outcomes/migrations/0054_private_reviewed_hpn_calculation/migration.sql',
    import.meta.url
  ),
  'utf8'
);
const reviewedAt = '2026-08-16T06:00:00.000Z';
const runId = `provider-normalization-run:${'1'.repeat(64)}`;
const resultMapId = `hpn-pav-field-map:${'2'.repeat(64)}`;
const playerMapId = `hpn-pav-field-map:${'3'.repeat(64)}`;

class PgliteSqlClient implements AflOutcomeSqlClient, AflOutcomeSqlTransaction {
  constructor(private readonly database: PGlite) {}

  async query<Row>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<AflOutcomeSqlQueryResult<Row>> {
    const result = await this.database.query<Row>(sql, [...parameters]);
    return {
      rows: result.rows,
      rowCount: result.rows.length > 0 ? result.rows.length : (result.affectedRows ?? 0),
    };
  }

  async transaction<T>(work: (transaction: AflOutcomeSqlTransaction) => Promise<T>): Promise<T> {
    await this.database.exec('BEGIN');
    try {
      const result = await work(this);
      await this.database.exec('COMMIT');
      return result;
    } catch (error) {
      await this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

function registration() {
  const base = {
    hitOuts: 1,
    goalAssists: 1,
    marks: 4,
    marksInside50: 1,
    freeKicksFor: 2,
    freeKicksAgainst: 1,
    rebound50s: 2,
    onePercenters: 2,
    clearances: 3,
    tackles: 4,
  };
  const rows = [
    {
      providerDecodedRowId: 'provider-row:1',
      sourceRowSha256: '4'.repeat(64),
      typedPayloadSha256: '5'.repeat(64),
      matchId: 'local-afl-match:1',
      matchDate: '2025-03-01',
      homeClubId: 'local-afl-club:a',
      awayClubId: 'local-afl-club:b',
      homePoints: 80,
      awayPoints: 70,
      playingForClubId: 'local-afl-club:a',
      playerIdentity: {
        state: 'resolved' as const,
        canonicalPlayerId: 'local-afl-player:1',
        identityDecisionId: 'identity-review:1',
      },
      stats: { ...base, totalPoints: 20, inside50s: 5 },
    },
    {
      providerDecodedRowId: 'provider-row:2',
      sourceRowSha256: '6'.repeat(64),
      typedPayloadSha256: '7'.repeat(64),
      matchId: 'local-afl-match:1',
      matchDate: '2025-03-01',
      homeClubId: 'local-afl-club:a',
      awayClubId: 'local-afl-club:b',
      homePoints: 80,
      awayPoints: 70,
      playingForClubId: 'local-afl-club:b',
      playerIdentity: {
        state: 'quarantined' as const,
        reason: 'missing_source_identity' as const,
        recordedName: null,
      },
      stats: { ...base, totalPoints: 12, inside50s: 4 },
    },
  ];
  const assembled = createAflTradeHpnReviewedSeasonUniverseCandidate({
    environment: 'non_production',
    competition: 'AFLM',
    seasonYear: 2025,
    captureId: 'capture:2025',
    normalizationRunId: runId,
    resultFieldMapId: resultMapId,
    playerFieldMapId: playerMapId,
    resolvedReviewSetSha256: '8'.repeat(64),
    normalizationReview: {
      status: 'needs_review',
      sourceRowCount: 2,
      acceptedRowCount: 1,
      issueCount: 1,
    },
    rows,
    createdAt: reviewedAt,
  });
  const decision = createAflTradeHpnReviewedSeasonDecision({
    ...assembled,
    decision: 'approved',
    reviewerId: 'local-reviewer',
    rationale: 'Approve exact private season numerics.',
    decidedAt: reviewedAt,
  });
  return {
    ...assembled,
    decision,
    reviewedSeason: sealAflTradeHpnReviewedSeasonUniverse({ ...assembled, decision }),
  };
}

async function prepareDatabase(database: PGlite): Promise<void> {
  await database.exec(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE TABLE outcome_provider_normalization_run(normalization_run_id text PRIMARY KEY);
    CREATE TABLE outcome_hpn_projected_field_map(field_map_id text PRIMARY KEY);
    CREATE TABLE outcome_provider_decoded_row(provider_decoded_row_id text PRIMARY KEY);
    INSERT INTO outcome_provider_normalization_run VALUES ('${runId}');
    INSERT INTO outcome_hpn_projected_field_map VALUES ('${resultMapId}'),('${playerMapId}');
    INSERT INTO outcome_provider_decoded_row VALUES ('provider-row:1'),('provider-row:2');
  `);
  await database.exec(REVIEW_MIGRATION);
  await database.exec(CALCULATION_MIGRATION);
}

describe('private reviewed HPN calculation PostgreSQL repository', () => {
  let database: PGlite | null = null;

  afterEach(async () => {
    await database?.close();
    database = null;
  });

  it('calculates atomically, exact-replays, and retains identity quarantine', async () => {
    database = await PGlite.create({ extensions: { pgcrypto } });
    await prepareDatabase(database);
    const client = new PgliteSqlClient(database);
    const reviewed = registration();
    await new PostgresAflTradeHpnReviewedSeasonUniverseRepository(client).register(reviewed);
    const repository = new PostgresAflTradePrivateReviewedHpnCalculationRepository(client);

    const first = await repository.calculateAndPersist(2025);
    const replay = await repository.calculateAndPersist(2025);
    expect(first.idempotentReplay).toBe(false);
    expect(replay).toEqual({ calculation: first.calculation, idempotentReplay: true });
    expect(first.calculation.content.league.totalPav).toBe(600);
    expect(first.calculation.content.counts.quarantinedAllocations).toBe(1);
    await expect(repository.loadLatest(2025)).resolves.toEqual(first.calculation);
    const counts = await database.query<{ teams: number; allocations: number }>(
      `SELECT
        (SELECT count(*)::integer FROM outcome_private_reviewed_hpn_team) AS teams,
        (SELECT count(*)::integer FROM outcome_private_reviewed_hpn_allocation) AS allocations`
    );
    expect(counts.rows[0]).toEqual({ teams: 2, allocations: 2 });
    await expect(
      database.exec('DELETE FROM outcome_private_reviewed_hpn_calculation')
    ).rejects.toThrow(/append-only/i);
  });
});
