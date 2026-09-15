import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('An explicitly disposable PostgreSQL database is required.');
const schema = `continuity_coverage_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl });
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
const spell = {
  playerId: 'player',
  clubId: 'club',
  environment: 'non_production',
  competition: 'AFLM',
  entry: {
    eventDate: null,
    datePrecision: { earliestDate: '2010-01-01', latestDate: '2010-12-31' },
  },
  observedThrough: '2013-12-31',
  createdAt: '2026-09-15T00:00:00.000Z',
  continuityEvidence: [{ artifactId: 'a' }, { artifactId: 'b' }],
};
const claim = {
  recordedPlayer: 'Player',
  recordedClub: 'Club',
  observedThrough: '2013-12-31',
  membershipSeasons: [2011, 2012, 2013],
};
async function current(content: unknown = spell) {
  return (
    await pool.query<{ ok: boolean }>(
      'SELECT outcome_acquisition_continuity_sources_current($1::jsonb,clock_timestamp()) AS ok',
      [JSON.stringify(content)]
    )
  ).rows[0]!.ok;
}
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  // Minimal relational fixture for the production predicate. Migration deployment and
  // retained-batch governance are covered by their existing full-database suites.
  await pool.query(`
    CREATE TABLE outcome_source_capture(capture_id TEXT, source_artifact_id TEXT,
      capability_id TEXT, provider TEXT, environment TEXT, competition TEXT, manifest_json JSONB);
    CREATE TABLE outcome_external_evidence_batch(batch_id TEXT, capture_id TEXT,
      finalized_at TIMESTAMPTZ, current BOOLEAN);
    CREATE TABLE outcome_external_evidence_row(batch_id TEXT, claim_kind TEXT, evidence_json JSONB);
    CREATE TABLE outcome_player(player_id TEXT, display_name TEXT);
    CREATE TABLE outcome_club(club_id TEXT, current_name TEXT);
    INSERT INTO outcome_player VALUES ('player','Player');
    INSERT INTO outcome_club VALUES ('club','Club');
    CREATE FUNCTION outcome_external_retained_batch_is_current(id TEXT, cutoff TIMESTAMPTZ)
    RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
      SELECT current FROM outcome_external_evidence_batch WHERE batch_id=id
    $$;
  `);
  await pool.query(
    readFileSync(
      'prisma/afl-trade-outcomes/migrations/0216_all_continuity_references/migration.sql',
      'utf8'
    )
  );
});
beforeEach(async () => {
  await pool.query(
    'TRUNCATE outcome_source_capture, outcome_external_evidence_batch, outcome_external_evidence_row'
  );
  for (const id of ['a', 'b']) {
    await pool.query(
      `INSERT INTO outcome_source_capture VALUES ($1,$1,
      'official-afl-player-continuity','official_afl','non_production','AFLM',
      '{"parserVersion":"official-afl-player-continuity/v1"}')`,
      [id]
    );
    await pool.query(
      "INSERT INTO outcome_external_evidence_batch VALUES ($1,$1,'2026-09-01',true)",
      [id]
    );
    await pool.query(
      "INSERT INTO outcome_external_evidence_row VALUES ($1,'player_continuity_reference',$2::jsonb)",
      [id, JSON.stringify({ content: { claim } })]
    );
  }
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});
it('accepts two current references covering every post-trade season', async () => {
  expect(await current()).toBe(true);
});
it('does not let a current article mask a withdrawn second article', async () => {
  await pool.query("UPDATE outcome_external_evidence_batch SET current=false WHERE batch_id='b'");
  expect(await current()).toBe(false);
});
it.each([
  { recordedPlayer: 'Other Player' },
  { recordedClub: 'Other Club' },
  { observedThrough: '2012-12-31' },
  { membershipSeasons: [2011, 2013] },
  { membershipSeasons: null },
])('rejects a second reference with unsupported claims %j', async (change) => {
  await pool.query(
    "UPDATE outcome_external_evidence_row SET evidence_json=$1::jsonb WHERE batch_id='b'",
    [JSON.stringify({ content: { claim: { ...claim, ...change } } })]
  );
  expect(await current()).toBe(false);
});
it('rejects an earlier acquisition whose initial seasons are absent', async () => {
  expect(await current({ ...spell, entry: { eventDate: '2008-10-10' } })).toBe(false);
});
it('accepts the supported partial-year cutoff without requiring later seasons', async () => {
  expect(await current({ ...spell, observedThrough: '2012-11-30' })).toBe(true);
});
it('requires at least one continuity reference', async () => {
  expect(await current({ ...spell, continuityEvidence: [] })).toBe(false);
});

it('rejects an unmatched reference alongside valid continuity evidence', async () => {
  expect(
    await current({
      ...spell,
      continuityEvidence: [...spell.continuityEvidence, { artifactId: 'missing' }],
    })
  ).toBe(false);
});
it('rejects a wrong-capability capture alongside valid continuity evidence', async () => {
  await pool.query(
    "UPDATE outcome_source_capture SET capability_id='official-afl-player-departure' WHERE capture_id='b'"
  );
  expect(await current()).toBe(false);
});
it('rejects a captured reference with no staged evidence batch', async () => {
  await pool.query("DELETE FROM outcome_external_evidence_batch WHERE batch_id='b'");
  expect(await current()).toBe(false);
});
