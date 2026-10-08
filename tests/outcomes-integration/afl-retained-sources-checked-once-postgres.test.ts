import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSyntheticAcquisitionPlayerPromotion } from '../testUtils/acquisitionPlayerPromotionFixture';
import { deployOutcomesHistoryBefore } from './outcomesPreMigrationWorkspace';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');

const MIGRATION = '0259_retained_sources_checked_once';
// The local fitzRoy rehearsal owners only run inside a schema with this disposable naming pattern.
const schemaName = `afl_fitzroy_factual_rehearsal_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl, max: 2 });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 4,
});
const SIGNATURES = [
  'outcome_acquisition_promoted_event_current(jsonb,text,text,text,text,boolean,timestamp with time zone,timestamp with time zone)',
  'outcome_acquisition_arrival_event_current(jsonb,text,text,text,text,boolean,timestamp with time zone,timestamp with time zone)',
];
const RETAINED_CHECK = 'outcome_external_candidate_retained_sources_current(';
let cleanup: () => Promise<void> = async () => undefined;
let migrationSql = '';
let promoted: Awaited<ReturnType<typeof createSyntheticAcquisitionPlayerPromotion>>;

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  const history = await deployOutcomesHistoryBefore(MIGRATION, scoped.toString(), pool);
  cleanup = history.cleanup;
  migrationSql = history.migrationSql;
  promoted = await createSyntheticAcquisitionPlayerPromotion(pool, {
    environment: 'non_production',
    completeCaptureReceipts: true,
  });
}, 300_000);

afterAll(async () => {
  await cleanup();
  await pool.end();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } finally {
    await admin.end();
  }
});

const functionBody = async (signature: string) =>
  (
    await pool.query<{ body: string }>('SELECT pg_get_functiondef($1::regprocedure) AS body', [
      signature,
    ])
  ).rows[0]!.body;

/** Each event check for the fixture's binding, and for one naming an unknown promotion. */
const answers = async () => {
  const unknown = {
    ...promoted.entry,
    promotionId: `external-canonical-promotion:${'0'.repeat(64)}`,
  };
  const results: boolean[] = [];
  for (const name of [
    'outcome_acquisition_promoted_event_current',
    'outcome_acquisition_arrival_event_current',
  ])
    for (const binding of [promoted.entry, unknown])
      results.push(
        (
          await pool.query<{ current: boolean }>(
            `SELECT ${name}($1::jsonb,$2,$3,'non_production','AFLM',TRUE,clock_timestamp(),clock_timestamp()) AS current`,
            [JSON.stringify(binding), promoted.playerId, promoted.clubId]
          )
        ).rows[0]!.current
      );
  return results;
};

let before: boolean[] = [];

it('under the deployed rules each check tests the retained sources inside its join', async () => {
  before = await answers();
  expect(before.filter((_, index) => index % 2 === 1)).toEqual([false, false]);
  for (const signature of SIGNATURES) {
    const body = await functionBody(signature);
    expect(body).toContain(
      "AND candidate.status='finalized' AND outcome_external_candidate_retained_sources_current(candidate.candidate_id,cutoff)"
    );
  }
});

it('the migration checks them once, for the promotion the binding names, with the same answers', async () => {
  await pool.query(migrationSql);
  expect(await answers()).toEqual(before);
  for (const signature of SIGNATURES) {
    const body = await functionBody(signature);
    expect(body.split(RETAINED_CHECK)).toHaveLength(2);
    expect(body).toContain(
      " SELECT outcome_external_candidate_retained_sources_current((SELECT promotion.candidate_id FROM outcome_external_canonical_promotion promotion WHERE promotion.promotion_id=binding->>'promotionId'),cutoff) AND EXISTS ("
    );
    expect(body).not.toContain(
      'outcome_external_candidate_retained_sources_current(candidate.candidate_id'
    );
  }
});
