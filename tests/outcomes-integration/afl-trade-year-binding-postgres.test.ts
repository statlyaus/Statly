import { Pool } from 'pg';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { createSyntheticAcquisitionPlayerPromotion } from '../testUtils/acquisitionPlayerPromotionFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';
const url = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!url) throw new Error('Disposable PostgreSQL required.');
const schema = `trade_year_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: url });
const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
let fixture: Awaited<ReturnType<typeof createSyntheticAcquisitionPlayerPromotion>>;
let binding: Record<string, unknown>;
const current = async (value: unknown, player = fixture.playerId, competition = 'AFLM') =>
  (
    await pool.query(
      `SELECT outcome_acquisition_registration_event_current($1::jsonb,$2,$3,
    'test_fixture',$4,TRUE,clock_timestamp(),clock_timestamp()) AS ok`,
      [JSON.stringify(value), player, fixture.clubId, competition]
    )
  ).rows[0].ok;
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const scoped = new URL(url);
  scoped.searchParams.set('schema', schema);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  fixture = await createSyntheticAcquisitionPlayerPromotion(pool, {
    draftSessions: true,
    sessionProposalV5: true,
    partialTransactionDates: true,
  });
  binding = {
    promotionId: fixture.entry.promotionId,
    eventVersionId: fixture.entry.eventVersionId,
    assetVersionId: fixture.entry.assetVersionId,
    eventDate: null,
    evidence: fixture.entry.evidence,
    datePrecision: {
      precision: 'window',
      eventDate: null,
      earliestDate: '2024-01-01',
      latestDate: '2024-12-31',
    },
  };
}, 120000);
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});
it('authenticates the promoted full trade year without modifying the legacy event', async () => {
  const before = (
    await pool.query(
      'SELECT to_jsonb(e) AS value FROM outcome_event_version e WHERE event_version_id=$1',
      [binding.eventVersionId]
    )
  ).rows;
  expect(before[0].value.event_date).toBeNull();
  expect(before[0].value.date_precision).toBeNull();
  expect(await current(binding)).toBe(true);
  expect(await current(binding)).toBe(true);
  expect(
    (
      await pool.query(
        'SELECT to_jsonb(e) AS value FROM outcome_event_version e WHERE event_version_id=$1',
        [binding.eventVersionId]
      )
    ).rows
  ).toEqual(before);
});
it('rejects narrowed, wrong-year, exact-day and unauthenticated bindings', async () => {
  for (const change of [
    {
      datePrecision: {
        precision: 'window',
        eventDate: null,
        earliestDate: '2024-02-01',
        latestDate: '2024-12-31',
      },
    },
    {
      datePrecision: {
        precision: 'window',
        eventDate: null,
        earliestDate: '2023-01-01',
        latestDate: '2023-12-31',
      },
    },
    { datePrecision: null },
    { eventDate: '2024-10-15' },
    { promotionId: 'external-canonical-promotion:missing' },
    { evidence: [] },
    { assetVersionId: 'missing' },
  ])
    expect(await current({ ...binding, ...change })).toBe(false);
  expect(await current(binding, 'player:other')).toBe(false);
  expect(await current(binding, fixture.playerId, 'AFLW')).toBe(false);
});
