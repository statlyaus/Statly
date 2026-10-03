import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
const schemaName = `afl_hpn_historical_scope_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl, max: 2 });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 2,
});

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await admin.end();
});

it('maps only exact 2011-2024 historical season keys and leaves the valuation scopes unchanged', async () => {
  const season = async (fn: string, key: string) =>
    (await pool.query<{ season: number | null }>(`SELECT ${fn}($1) AS season`, [key])).rows[0]!
      .season;
  expect(
    await season('outcome_hpn_pav_historical_season_scope_season', 'afl-men:hpn-pav-season-2011')
  ).toBe(2011);
  expect(
    await season('outcome_hpn_pav_historical_season_scope_season', 'afl-men:hpn-pav-season-2024')
  ).toBe(2024);
  for (const key of [
    'afl-men:hpn-pav-season-2010',
    'afl-men:hpn-pav-season-2025',
    'afl-men:hpn-pav-season-2026',
    'afl-men:hpn-pav-season-24',
    'afl-men:hpn-pav-season-2024x',
    'afl-men:2025-trades',
    ' afl-men:hpn-pav-season-2024',
  ]) {
    expect(await season('outcome_hpn_pav_historical_season_scope_season', key)).toBeNull();
  }
  // The trade-valuation scope policy is not widened.
  expect(await season('outcome_private_valuation_hpn_scope_season', 'afl-men:2025-trades')).toBe(
    2025
  );
  expect(await season('outcome_private_valuation_hpn_scope_season', 'afl-men:2026-trades')).toBe(
    2026
  );
  expect(
    await season('outcome_private_valuation_hpn_scope_season', 'afl-men:hpn-pav-season-2024')
  ).toBeNull();
});

it('binds the source-first projected-map verifier to either scope policy at the exact capture season', async () => {
  const definition = (
    await pool.query<{ definition: string }>(
      `SELECT pg_get_functiondef('outcome_hpn_source_first_projected_map_is_exact(text)'::regprocedure) AS definition`
    )
  ).rows[0]!.definition;
  expect(definition).toContain(
    "COALESCE(outcome_private_valuation_hpn_scope_season(content->>'valuationScopeKey'),outcome_hpn_pav_historical_season_scope_season(content->>'valuationScopeKey'))=source.anchor_season_year"
  );
  expect(definition).not.toContain(
    "AND outcome_private_valuation_hpn_scope_season(content->>'valuationScopeKey')=source.anchor_season_year"
  );
  // Valuation consumers keep their exact trade-scope policy.
  for (const consumer of [
    'admit_outcome_private_valuation_hpn_source',
    'outcome_private_valuation_hpn_source_authority_is_current',
  ]) {
    const source = (
      await pool.query<{ source: string }>(
        `SELECT string_agg(prosrc, ' ') AS source FROM pg_proc WHERE proname=$1 AND pronamespace=$2::regnamespace`,
        [consumer, schemaName]
      )
    ).rows[0]!.source;
    expect(source).not.toContain('outcome_hpn_pav_historical_season_scope_season');
  }
});
