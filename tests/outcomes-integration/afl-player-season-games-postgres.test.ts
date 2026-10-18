import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { loadAflTradePlayerSeasonGames } from '@/server/aflTradeIntelligence/modeling/postgresPlayerSeasonGames';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
const schemaName = `player_season_games_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl, max: 2 });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 2,
});
const client = createPgAflOutcomeSqlClient(pool);
const methodId = `hpn-pav-method:${'b'.repeat(64)}`;
const sha = (digit: string) => digit.repeat(64);

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
}, 300_000);

afterAll(async () => {
  await pool.end();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } finally {
    await admin.end();
  }
});

/**
 * Synthetic rows under replica role: the calculation, head and fact guards are covered by their own
 * repository tests. This runs the loader's SQL against the real migrated columns, types and CHECKs.
 */
async function seed() {
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query(`SET LOCAL session_replication_role='replica'`);
    const calculation = async (
      digit: string,
      season: number,
      environment: string,
      finalized: boolean
    ) => {
      const id = `hpn-pav-season:${sha(digit)}`;
      await connection.query(
        `INSERT INTO outcome_hpn_pav_calculation
          (calculation_id,calculation_sha256,schema_version,input_set_id,method_id,environment,
           competition,season_year,effective_through,calculated_at,value_unit,status,team_count,
           player_count,calculation_canonical_json,calculation_json,finalized_at)
         VALUES ($1,$2,'afl-trade-hpn-pav-season-calculation/v3',$3,$4,$5::"OutcomeEnvironment",
           'AFLM',$6,'2026-10-01T00:00:00Z','2026-10-01T00:00:00Z','season_pav',$7,2,2,'{}','{}',$8)`,
        [
          id,
          sha(digit),
          `hpn-pav-input-set:${sha(digit)}`,
          methodId,
          environment,
          season,
          finalized ? 'finalized' : 'building',
          finalized ? '2026-10-01T00:00:00Z' : null,
        ]
      );
      await connection.query(
        `INSERT INTO outcome_hpn_pav_calculation_head
          (environment,competition,season_year,method_id,calculation_id,revision,updated_at)
         VALUES ($1::"OutcomeEnvironment",'AFLM',$2,$3,$4,1,'2026-10-01T00:00:00Z')`,
        [environment, season, methodId, id]
      );
      return id;
    };
    const player = async (
      calculationId: string,
      ordinal: number,
      playerId: string,
      clubId: string,
      games: number,
      pav: number
    ) =>
      connection.query(
        `INSERT INTO outcome_hpn_pav_calculation_player
          (calculation_id,spell_version_id,player_id,team_id,ordinal,player_sha256,offensive_pav,
           midfield_pav,defensive_pav,total_pav,player_canonical_json)
         VALUES ($1,$2,$3,$4,$5,$6,0,0,0,$7,$8)`,
        [
          calculationId,
          `acquisition-spell-version:${playerId}-${clubId}`,
          playerId,
          clubId,
          ordinal,
          sha('c'),
          pav,
          JSON.stringify({ playerId, teamId: clubId, source: { gamesPlayed: games } }),
        ]
      );
    const fact = async (
      inputSetId: string,
      ordinal: number,
      playerId: string,
      clubId: string,
      matchId: string,
      availability: 'measured' | 'missing',
      appeared: boolean | null
    ) => {
      const factId = `source-fact:${playerId}-${matchId}-${ordinal}`;
      await connection.query(
        `INSERT INTO outcome_provider_player_appearance_fact
          (appearance_fact_id,fact_batch_id,normalization_run_id,provider_decoded_row_id,
           appearance_candidate_id,identity_candidate_id,match_candidate_id,
           player_resolution_decision_id,match_resolution_decision_id,match_assignment_decision_id,
           represented_club_resolution_decision_id,represented_club_assignment_decision_id,
           match_identity_id,represented_club_identity_id,player_id,match_id,represented_club_id,
           competition,season_year,availability,appeared,reason_code,effective_at,recorded_at,
           candidate_sha256,candidate_digests_json,fact_sha256,fact_json)
         VALUES ($1,'batch',$2,$1,'a','i','m','pr','mr','ma','cr','ca','mi','ci',$3,$4,$5,'AFLM',2021,
           $6::"OutcomeFactualAvailability",$7,$8,'2021-04-01T00:00:00Z','2021-04-02T00:00:00Z',$9,
           $10::jsonb,$9,'{}'::jsonb)`,
        [
          factId,
          `run-${ordinal}`,
          playerId,
          matchId,
          clubId,
          availability,
          appeared,
          availability === 'measured' ? null : 'not_listed',
          sha('d'),
          JSON.stringify({ appearance: sha('d'), identity: 'x', match: 'y' }),
        ]
      );
      await connection.query(
        `INSERT INTO outcome_hpn_pav_input_factual_appearance_member(input_set_id,fact_id,ordinal)
         VALUES ($1,$2,$3)`,
        [inputSetId, factId, ordinal]
      );
    };
    const finalized = await calculation('1', 2021, 'non_production', true);
    await player(finalized, 0, 'p1', 'carlton', 2, 4.5);
    await player(finalized, 1, 'p2', 'geelong', 1, -0.5);
    const inputSet = `hpn-pav-input-set:${sha('1')}`;
    // Two providers' facts for one appearance count once.
    await fact(inputSet, 0, 'p1', 'carlton', 'm1', 'measured', true);
    await fact(inputSet, 1, 'p1', 'carlton', 'm1', 'measured', true);
    await fact(inputSet, 2, 'p1', 'carlton', 'm2', 'measured', true);
    await fact(inputSet, 3, 'p2', 'geelong', 'm1', 'measured', true);
    // Neither a non-appearance nor a missing fact is a game.
    await fact(inputSet, 4, 'p2', 'geelong', 'm2', 'measured', false);
    await fact(inputSet, 5, 'p3', 'geelong', 'm2', 'missing', null);
    const building = await calculation('2', 2022, 'non_production', false);
    await player(building, 0, 'p1', 'carlton', 3, 9);
    await calculation('3', 2023, 'test_fixture', true);
    await connection.query('COMMIT');
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally {
    connection.release();
  }
}

it('reads games and PAV per player-season-club from finalized non-production heads only', async () => {
  await seed();

  const model = await loadAflTradePlayerSeasonGames(client, {
    methodId,
    seasons: [2021, 2022, 2023],
  });

  expect(model.seasons).toEqual([
    { season: 2021, availability: 'available', calculationId: `hpn-pav-season:${sha('1')}` },
    { season: 2022, availability: 'not_finalized', calculationId: `hpn-pav-season:${sha('2')}` },
    { season: 2023, availability: 'no_head', calculationId: null },
  ]);
  expect(model.rows).toEqual([
    {
      playerId: 'p1',
      season: 2021,
      clubId: 'carlton',
      games: 2,
      pav: 4.5,
      spellVersionId: 'acquisition-spell-version:p1-carlton',
    },
    {
      playerId: 'p2',
      season: 2021,
      clubId: 'geelong',
      games: 1,
      pav: -0.5,
      spellVersionId: 'acquisition-spell-version:p2-geelong',
    },
  ]);
  expect(model.discrepancies).toEqual([]);
});
