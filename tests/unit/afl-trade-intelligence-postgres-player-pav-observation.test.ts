import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_HPN_PAV_FINALIZED_CALCULATION_SCHEMA_VERSION,
  aflTradeFinalizedHpnPavCalculationSchema,
} from '@/server/aflTradeIntelligence/modeling/hpnPavCalculationService';
import { calculateAflTradeHpnPavCore } from '@/server/aflTradeIntelligence/modeling/hpnPavCore';
import { createAflTradePlayerPavPolicy } from '@/server/aflTradeIntelligence/modeling/playerPavObservationContracts';
import { PostgresAflTradePlayerPavObservationRepository } from '@/server/aflTradeIntelligence/modeling/postgresPlayerPavObservationRepository';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const addressed = (prefix: string, value: string) => `${prefix}:${sha(value)}`;
const predictionSeasons = [2000, 2004, 2008, 2012] as const;
const releaseId = addressed('outcome-release', 'released-acquisition-spells');
const methodId = addressed('hpn-pav-method', 'hpn-v1');

function policy() {
  return createAflTradePlayerPavPolicy({
    schemaVersion: 'afl-trade-player-pav-policy/v1',
    authorityBoundary:
      'private_released_acquisition_spell_exact_finalized_hpn_pav_no_grade_publication_or_fantasy_ownership',
    publicationEligible: false,
    environment: 'test_fixture',
    competition: 'AFLM',
    policyVersion: 'player-pav-postgres-fixture-v1',
    featureHistorySeasons: 1,
    fixedHorizonSeasons: 1,
    methodId,
    sourceValueUnit: 'season_pav',
    outcomeValueUnit: 'fixed_horizon_pav',
    partitions: ['train', 'calibration', 'validation', 'final_test'].map((role, index) => ({
      role: role as 'train' | 'calibration' | 'validation' | 'final_test',
      fromPredictionSeason: predictionSeasons[index]!,
      throughPredictionSeason: predictionSeasons[index]!,
    })),
    approvalDecision: {
      id: addressed('review-decision', 'player-pav-policy'),
      sha256: sha('player-pav-policy'),
    },
    createdAt: '1999-01-01T00:00:00.000Z',
  });
}

function spellRow(predictionSeason: number) {
  return {
    spell_version_id: addressed('acquisition-spell-version', `spell:${predictionSeason}`),
    spell_id: `spell:${predictionSeason}`,
    player_id: `player:${predictionSeason}`,
    club_id: `club:${predictionSeason}`,
    start_date: `${predictionSeason - 1}-01-01`,
    end_date: predictionSeason === 2012 ? '2012-12-31' : null,
    recorded_at: `${predictionSeason - 1}-01-01T00:00:00.000Z`,
    prediction_season: predictionSeason,
  };
}

const playerStats = {
  totalPoints: 10,
  hitOuts: 1,
  goalAssists: 1,
  inside50s: 2,
  marks: 3,
  marksInside50: 1,
  freeKicksFor: 2,
  freeKicksAgainst: 1,
  rebound50s: 1,
  onePercenters: 1,
  clearances: 2,
  tackles: 3,
};

function calculation(seasonYear: number, rows: ReturnType<typeof spellRow>[]) {
  const teamId = rows[0]?.club_id ?? `club:filler:${seasonYear}`;
  const players = rows.map((row, index) => ({
    spellVersionId: row.spell_version_id,
    playerId: row.player_id,
    sourceRowIds: Array.from(
      { length: 18 },
      (_, gameIndex) => `row:${seasonYear}:${index + 1}:${gameIndex + 1}`
    ),
    ...playerStats,
  }));
  const core = calculateAflTradeHpnPavCore([
    {
      teamId,
      pointsFor: 100,
      pointsAgainst: 80,
      inside50sFor: 50,
      inside50sAgainst: 40,
      players:
        players.length > 0
          ? players
          : [
              {
                spellVersionId: addressed('acquisition-spell-version', `filler:${seasonYear}`),
                playerId: `player:filler:${seasonYear}`,
                sourceRowIds: Array.from(
                  { length: 18 },
                  (_, index) => `row:${seasonYear}:filler:${index + 1}`
                ),
                ...playerStats,
              },
            ],
    },
    {
      teamId: `club:comparison:${seasonYear}`,
      pointsFor: 80,
      pointsAgainst: 100,
      inside50sFor: 40,
      inside50sAgainst: 50,
      players: [
        {
          spellVersionId: addressed('acquisition-spell-version', `comparison:${seasonYear}`),
          playerId: `player:comparison:${seasonYear}`,
          sourceRowIds: Array.from(
            { length: 18 },
            (_, index) => `row:${seasonYear}:comparison:${index + 1}`
          ),
          ...playerStats,
        },
      ],
    },
  ]);
  const content = {
    schemaVersion: AFL_TRADE_HPN_PAV_FINALIZED_CALCULATION_SCHEMA_VERSION,
    authorityBoundary:
      'private_finalized_hpn_input_exact_method_bytes_no_publication_or_fantasy_ownership' as const,
    publicationEligible: false as const,
    environment: 'test_fixture' as const,
    competition: 'AFLM' as const,
    seasonYear,
    effectiveThrough: `${seasonYear}-09-30T23:59:59.000Z`,
    calculatedAt: '2026-08-10T00:00:00.000Z',
    methodId,
    inputSetId: addressed('hpn-pav-input-set', `input:${seasonYear}`),
    inputSetSha256: sha(`input:${seasonYear}`),
    factualRunId: addressed('factual-reconciliation-run', `run:${seasonYear}`),
    factualInputSetSha256: sha(`facts:${seasonYear}`),
    primaryProviders: ['afl_tables'],
    corroboratingProviders: ['footywire'],
    resultSourceRowIds: [`row:${seasonYear}:result`],
    valueUnit: 'season_pav' as const,
    ...core,
    players: core.players.map((player) => ({
      ...player,
      source: { ...player.source, gamesPlayed: 18 },
    })),
  };
  return aflTradeFinalizedHpnPavCalculationSchema.parse({
    calculationId: createAflTradeContentAddress('hpn-pav-season', content),
    content,
  });
}

class FakePlayerPavSql implements AflOutcomeSqlClient, AflOutcomeSqlTransaction {
  readonly policy = policy();
  readonly spells = predictionSeasons.map(spellRow);
  readonly calculations = predictionSeasons.flatMap((predictionSeason) => [
    calculation(
      predictionSeason,
      this.spells.filter((row) => row.prediction_season === predictionSeason)
    ),
    calculation(
      predictionSeason + 1,
      predictionSeason === 2012
        ? []
        : this.spells.filter((row) => row.prediction_season === predictionSeason)
    ),
  ]);
  storedSet: unknown | null = null;
  finalizedAt: string | null = null;
  calculationCount = 0;
  observationCount = 0;
  trustedTimeReads = 0;

  async transaction<T>(work: (transaction: AflOutcomeSqlTransaction) => Promise<T>): Promise<T> {
    return work(this);
  }

  async query<Row>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<AflOutcomeSqlQueryResult<Row>> {
    if (sql.includes('pg_advisory_xact_lock')) return this.result([]);
    if (sql.includes('SELECT policy_json FROM outcome_player_pav_policy')) {
      return this.result([{ policy_json: this.policy }]);
    }
    if (sql.includes('JOIN outcome_review_decision decision')) {
      return this.result([
        { policy_json: this.policy, decision: 'approved', has_successor: false },
      ]);
    }
    if (sql.includes('SELECT spell.spell_version_id')) return this.result(this.spells);
    if (sql.includes('FROM outcome_hpn_pav_calculation_head head')) {
      return this.result(
        this.calculations.map((value) => ({
          calculation_json: value,
          finalized_at: value.content.calculatedAt,
          actual_team_count: value.content.teams.length,
          actual_player_count: value.content.players.length,
        }))
      );
    }
    if (sql.includes('FROM outcome_player_pav_observation_set parent')) {
      return this.result(
        this.storedSet === null
          ? []
          : [
              {
                observation_set_json: this.storedSet,
                finalized_at: this.finalizedAt,
                calculation_count: this.calculationCount,
                observation_count: this.observationCount,
                actual_calculation_count: this.calculationCount,
                actual_observation_count: this.observationCount,
              },
            ]
      );
    }
    if (sql.includes('SELECT member.calculation_id')) {
      const set = this.storedSet as { content: { calculations: Array<{ calculationId: string }> } };
      return this.result(
        set.content.calculations
          .map(({ calculationId }) => calculationId)
          .sort()
          .map((calculation_id) => ({ calculation_id }))
      );
    }
    if (sql.includes("date_trunc('milliseconds',transaction_timestamp()) AS trusted_at")) {
      this.trustedTimeReads += 1;
      return this.result([{ trusted_at: '2026-08-11T00:00:00.000Z' }]);
    }
    if (sql.includes('INSERT INTO outcome_player_pav_observation_set')) {
      this.storedSet = JSON.parse(String(parameters[10]));
      return this.result([]);
    }
    if (sql.includes('INSERT INTO outcome_player_pav_calculation_member')) {
      this.calculationCount = (JSON.parse(String(parameters[0])) as unknown[]).length;
      return this.result([]);
    }
    if (sql.includes('INSERT INTO outcome_player_pav_observation\n')) {
      this.observationCount = (JSON.parse(String(parameters[0])) as unknown[]).length;
      return this.result([]);
    }
    if (sql.includes('INSERT INTO outcome_player_pav_value')) return this.result([]);
    if (sql.includes('UPDATE outcome_player_pav_observation_set')) {
      this.finalizedAt = '2026-08-11T00:00:00.000Z';
      return { rows: [] as Row[], rowCount: 1 };
    }
    throw new Error(`Unhandled SQL in fake: ${sql}`);
  }

  private result<Row>(rows: readonly unknown[]): AflOutcomeSqlQueryResult<Row> {
    return { rows: rows as Row[], rowCount: rows.length };
  }
}

describe('PostgreSQL player-PAV observation repository', () => {
  it('derives released spell observations and replays before reading another trusted time', async () => {
    const sql = new FakePlayerPavSql();
    const repository = new PostgresAflTradePlayerPavObservationRepository(sql);
    const request = {
      environment: 'test_fixture' as const,
      competition: 'AFLM' as const,
      releaseId,
      policyId: sql.policy.policyId,
      knowledgeCutoffAt: '2026-08-10T23:59:59.999Z',
    };

    const first = await repository.materializeAndPersist(request, { environment: 'test_fixture' });
    const replay = await repository.materializeAndPersist(request, { environment: 'test_fixture' });

    expect(first.idempotentReplay).toBe(false);
    expect(replay).toEqual({ observationSet: first.observationSet, idempotentReplay: true });
    expect(sql.trustedTimeReads).toBe(1);
    expect(first.observationSet.content.observations.at(-1)?.outcome).toEqual({
      state: 'mature_observed',
      contribution: 0,
      gamesPlayed: 0,
      seasonsObserved: 1,
    });
  });
});
