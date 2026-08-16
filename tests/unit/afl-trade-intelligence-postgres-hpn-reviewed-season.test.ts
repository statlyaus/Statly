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
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';

const MIGRATION = readFileSync(
  new URL(
    '../../prisma/afl-trade-outcomes/migrations/0053_hpn_reviewed_season_universe/migration.sql',
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
  await database.exec(MIGRATION);
}

function registration() {
  const stats = {
    totalPoints: 6,
    hitOuts: 0,
    goalAssists: 0,
    inside50s: 1,
    marks: 1,
    marksInside50: 0,
    freeKicksFor: 0,
    freeKicksAgainst: 0,
    rebound50s: 0,
    onePercenters: 0,
    clearances: 0,
    tackles: 1,
  };
  const assembled = createAflTradeHpnReviewedSeasonUniverseCandidate({
    environment: 'non_production',
    competition: 'AFLM',
    seasonYear: 2025,
    captureId: 'capture:2025',
    normalizationRunId: runId,
    resultFieldMapId: resultMapId,
    playerFieldMapId: playerMapId,
    resolvedReviewSetSha256: '4'.repeat(64),
    normalizationReview: {
      status: 'needs_review',
      sourceRowCount: 2,
      acceptedRowCount: 1,
      issueCount: 1,
    },
    rows: [
      {
        providerDecodedRowId: 'provider-row:1',
        sourceRowSha256: '5'.repeat(64),
        typedPayloadSha256: '6'.repeat(64),
        matchId: 'local-afl-match:1',
        matchDate: '2025-03-01',
        homeClubId: 'local-afl-club:a',
        awayClubId: 'local-afl-club:b',
        homePoints: 80,
        awayPoints: 70,
        playingForClubId: 'local-afl-club:a',
        playerIdentity: {
          state: 'resolved',
          canonicalPlayerId: 'local-afl-player:1',
          identityDecisionId: 'identity-review:1',
        },
        stats,
      },
      {
        providerDecodedRowId: 'provider-row:2',
        sourceRowSha256: '7'.repeat(64),
        typedPayloadSha256: '8'.repeat(64),
        matchId: 'local-afl-match:1',
        matchDate: '2025-03-01',
        homeClubId: 'local-afl-club:a',
        awayClubId: 'local-afl-club:b',
        homePoints: 80,
        awayPoints: 70,
        playingForClubId: 'local-afl-club:b',
        playerIdentity: {
          state: 'quarantined',
          reason: 'missing_source_identity',
          recordedName: null,
        },
        stats,
      },
    ],
    createdAt: reviewedAt,
  });
  const decision = createAflTradeHpnReviewedSeasonDecision({
    ...assembled,
    decision: 'approved',
    reviewerId: 'local-reviewer',
    rationale: 'Approve exact private season numerics.',
    decidedAt: reviewedAt,
  });
  const reviewedSeason = sealAflTradeHpnReviewedSeasonUniverse({
    ...assembled,
    decision,
  });
  return { ...assembled, decision, reviewedSeason };
}

describe('reviewed HPN season PostgreSQL repository', () => {
  let database: PGlite | null = null;

  afterEach(async () => {
    await database?.close();
    database = null;
  });

  it('atomically registers, exact-replays, and loads the complete member set', async () => {
    database = await PGlite.create({ extensions: { pgcrypto } });
    await prepareDatabase(database);
    const repository = new PostgresAflTradeHpnReviewedSeasonUniverseRepository(
      new PgliteSqlClient(database)
    );
    const input = registration();

    await expect(repository.register(input)).resolves.toEqual(input.reviewedSeason);
    await expect(repository.register(input)).resolves.toEqual(input.reviewedSeason);
    await expect(repository.loadLatest(2025)).resolves.toEqual({
      reviewedSeason: input.reviewedSeason,
      membership: input.membership,
    });
    const count = await database.query<{ count: number }>(
      'SELECT count(*)::integer AS count FROM outcome_hpn_reviewed_season_member'
    );
    expect(count.rows[0]?.count).toBe(2);
    await expect(
      database.exec('DELETE FROM outcome_hpn_reviewed_season_member')
    ).rejects.toThrow(/append-only/i);
  });
});
