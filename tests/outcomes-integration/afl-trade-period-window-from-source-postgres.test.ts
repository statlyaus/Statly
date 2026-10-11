import { Pool } from 'pg';
import { afterAll, expect, it } from 'vitest';
import { createSyntheticAcquisitionPlayerPromotion } from '../testUtils/acquisitionPlayerPromotionFixture';
import { deployOutcomesHistoryBefore } from './outcomesPreMigrationWorkspace';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL ?? '';
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');

const MIGRATION = '0263_trade_period_window_from_source';
const admin = new Pool({ connectionString: databaseUrl, max: 2 });
// The fixture's synthetic trade season is 2024; this is a reviewed trade-period window inside it.
const tradePeriodWindow = { earliestDate: '2024-10-07', latestDate: '2024-10-16' };

/**
 * One disposable schema per promotion. The synthetic promotion fixture content-addresses its
 * artifacts, captures and canonical rows, so two promotions in one schema collide on primary keys;
 * every promotion below gets its own schema with the history deployed just before the migration.
 */
interface Workspace {
  pool: Pool;
  migrationSql: string;
  dispose: () => Promise<void>;
}
const workspaces: Workspace[] = [];
let ordinal = 0;

async function workspace(): Promise<Workspace> {
  // The local fitzRoy rehearsal owners only run inside a schema with this disposable naming pattern.
  const schemaName = `afl_fitzroy_factual_rehearsal_${process.pid}_${Date.now()}_${ordinal++}`;
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const pool = new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schemaName}`,
    max: 4,
  });
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  const history = await deployOutcomesHistoryBefore(MIGRATION, scoped.toString(), pool);
  await admin.query(
    `GRANT USAGE ON SCHEMA "${schemaName}" TO afl_trade_nonproduction_governance_registry_writer`
  );
  await admin.query(
    `GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA "${schemaName}"
       TO afl_trade_nonproduction_governance_registry_writer`
  );
  const built: Workspace = {
    pool,
    migrationSql: history.migrationSql,
    dispose: async () => {
      await history.cleanup();
      await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    },
  };
  workspaces.push(built);
  return built;
}

afterAll(async () => {
  try {
    for (const built of workspaces) await built.dispose();
  } finally {
    await admin.end();
  }
});

const promote = (ws: Workspace, namespace: string, claim: boolean) =>
  createSyntheticAcquisitionPlayerPromotion(ws.pool, {
    environment: 'non_production',
    completeCaptureReceipts: true,
    draftSessions: true,
    sessionProposalV5: true,
    partialTransactionDates: true,
    tradePeriodWindow,
    tradePeriodWindowClaim: claim,
    fixtureNamespace: namespace,
    providerEventId: `2024-${namespace}-alpha`,
    nativePlayerId: `${namespace}-player`,
  });

const promotions = async (ws: Workspace) =>
  (
    await ws.pool.query<{ n: number }>(
      'SELECT count(*)::integer AS n FROM outcome_external_canonical_promotion'
    )
  ).rows[0]!.n;

// A transaction's window must be the one an approved Official AFL capture states for its season
// (statlyaus/Statly#869). Before the migration any well-formed window is accepted; after it, the
// review and the promotion both refuse a window no capture states, and admit the one a capture does.
it('accepts an unbacked window under the deployed rules, and the migration writes no row', async () => {
  const ws = await workspace();
  const unbacked = await promote(ws, 'unbacked', false);
  expect(unbacked.proposal.content.transactionDateCoverage[0]).toMatchObject({
    occurredOn: null,
    datePrecision: { precision: 'window', eventDate: null, ...tradePeriodWindow },
  });
  // The migration edits the two validators in place and writes no row.
  const before = await promotions(ws);
  await ws.pool.query(ws.migrationSql);
  expect(await promotions(ws)).toBe(before);
}, 300_000);

it('refuses a window no approved capture states once the migration is applied', async () => {
  const ws = await workspace();
  await ws.pool.query(ws.migrationSql);
  // Without a capture stating the window, the review decision is refused.
  await expect(promote(ws, 'still-unbacked', false)).rejects.toThrow(
    /transaction dates must (equal|exactly cover)/
  );
  expect(await promotions(ws)).toBe(0);
}, 300_000);

it('admits the window an approved capture states and promotes the trade with it', async () => {
  const ws = await workspace();
  await ws.pool.query(ws.migrationSql);
  // With the window on record from an approved official-afl-trade-period-dates capture, the
  // review and promotion succeed and the promoted trade event carries the window.
  const backed = await promote(ws, 'backed', true);
  const claims = await ws.pool.query<{ n: number }>(
    `SELECT count(*)::integer AS n FROM outcome_external_evidence_row row
       JOIN outcome_external_evidence_batch batch ON batch.batch_id=row.batch_id
       JOIN outcome_source_capture capture ON capture.capture_id=batch.capture_id
      WHERE row.claim_kind='trade_period_window' AND batch.status='finalized'
        AND capture.status='approved' AND capture.capability_id='official-afl-trade-period-dates'`
  );
  expect(claims.rows[0]!.n).toBe(1);
  const event = await ws.pool.query<{ event_date: string | null; date_precision: unknown }>(
    'SELECT event_date::TEXT, date_precision FROM outcome_event_version WHERE event_version_id=$1',
    [backed.entry.eventVersionId]
  );
  expect(event.rows).toEqual([
    {
      event_date: null,
      date_precision: { precision: 'window', eventDate: null, ...tradePeriodWindow },
    },
  ]);
}, 300_000);
