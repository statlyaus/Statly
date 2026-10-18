import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  CHAINS,
  LOCKED_SUBJECT,
  SCALE_CASES,
  SCALE_CHAIN,
  SCALE_ROWS_PER_CASE,
  caseId,
  decision,
  seedAssignmentContinuityChains,
} from '../testUtils/assignmentContinuityChains';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

// Migration 0242 evaluates provider identity-assignment continuity once per assignment case
// (outcome_provider_assignment_continuity_current_set) instead of once per row. This suite seeds
// assignment chains in every continuity state, including review subjects and heads locked by
// another session, and proves the set evaluation equals the unchanged per-origin function for
// every origin. It also measures per-row cost and advisory locks at season-like chain lengths.
// The per-origin reference is the 0128 walk, renamed _uncached when migration 0289 added a
// transaction memo to outcome_provider_assignment_continuity_current.
const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('An explicitly disposable PostgreSQL database is required.');
const schemaName = `assignment_continuity_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl });
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schemaName}` });

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  await seedAssignmentContinuityChains(pool);
}, 300_000);

afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schemaName}" CASCADE`);
  await admin.end();
});

type Evaluation = {
  results: Map<string, boolean | null>;
  advisoryLocks: number;
  milliseconds: number;
};

/** Evaluates in its own transaction, which is always rolled back so its locks are released. */
async function evaluate(sql: string, decisions: readonly string[]): Promise<Evaluation> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const started = performance.now();
    const result = await client.query<{ decision_id: string; current: boolean | null }>(sql, [
      decisions,
    ]);
    const milliseconds = performance.now() - started;
    const locks = await client.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM pg_locks
        WHERE locktype='advisory' AND pid=pg_backend_pid()`
    );
    return {
      results: new Map(result.rows.map((row) => [row.decision_id, row.current])),
      advisoryLocks: locks.rows[0]!.count,
      milliseconds,
    };
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

const perOrigin = (decisions: readonly string[]) =>
  evaluate(
    `SELECT requested AS decision_id,
       outcome_provider_assignment_continuity_current_uncached(requested) AS current
       FROM unnest($1::text[]) requested`,
    decisions
  );
const perCase = (decisions: readonly string[]) =>
  evaluate(
    `SELECT continuity_decision_id AS decision_id,continuity_current AS current
       FROM outcome_provider_assignment_continuity_current_set($1::text[])`,
    decisions
  );

it('equals the per-origin continuity for every origin in every chain state', async () => {
  const decisions = [
    ...CHAINS.flatMap((chain) => chain.links.map((_, index) => decision(chain.key, index))),
    decision('twice', 0),
    'continuity:unknown',
  ];
  const holder = await pool.connect();
  try {
    // Another session holds one review subject of the `locked` chain and the `head-locked` head.
    await holder.query('BEGIN');
    await holder.query(
      `SELECT pg_advisory_xact_lock(hashtextextended('outcome-review-subject:'||$1,0))`,
      [LOCKED_SUBJECT]
    );
    await holder.query(
      `SELECT 1 FROM outcome_provider_identity_assignment_head WHERE assignment_case_id=$1 FOR UPDATE`,
      [caseId('head-locked')]
    );
    const expected = await perOrigin(decisions);
    const actual = await perCase([
      ...decisions,
      ...decisions.slice(0, 3),
      null as unknown as string,
    ]);
    expect(actual.results.size).toBe(decisions.length);
    for (const id of decisions)
      expect({ id, current: actual.results.get(id) }).toEqual({
        id,
        current: expected.results.get(id),
      });

    // The comparison is not vacuous: each state admits exactly the origins its rules allow.
    const current = (key: string) =>
      CHAINS.find((chain) => chain.key === key)!.links.map(
        (_, index) => expected.results.get(decision(key, index)) === true
      );
    const from = (count: number, first: number) =>
      Array.from({ length: count }, (_, index) => index + 1 >= first);
    expect(current('current')).toEqual(from(10, 1));
    expect(current('superseded')).toEqual(from(8, 5));
    expect(current('confirmed')).toEqual(from(8, 1));
    expect(current('withdrawn')).toEqual(from(8, 6));
    expect(current('rejected')).toEqual(from(6, 4));
    expect(current('unreviewed')).toEqual(from(6, 5));
    expect(current('retarget')).toEqual(from(6, 4));
    expect(current('inactive-link')).toEqual(from(5, 3));
    expect(current('declined-link')).toEqual(from(5, 5));
    expect(current('null-target')).toEqual(from(5, 3));
    expect(current('gap')).toEqual([false, false, false, true, true]);
    expect(current('duplicate')).toEqual([false, false, false, true, true, true, false]);
    expect(current('broken-link')).toEqual(from(6, 4));
    expect(current('inactive-head')).toEqual(from(4, 5));
    expect(current('moved-head')).toEqual(from(6, 7));
    expect(current('behind-head')).toEqual([true, true, true, true, false, false]);
    expect(current('kind-mismatch')).toEqual(from(4, 5));
    expect(current('no-head')).toEqual(from(4, 5));
    expect(current('player-chain')).toEqual(from(7, 1));
    // A review subject another session holds fails closed for every origin whose span holds it.
    expect(current('locked')).toEqual(from(10, 7));
    expect(current('head-locked')).toEqual(from(5, 6));
    expect(expected.results.get(decision('null-revision', 3))).toBeNull();
    expect(expected.results.get('continuity:unknown')).toBe(false);
  } finally {
    await holder.query('ROLLBACK');
    holder.release();
  }
  // Once the holder releases them, the same origins are current again.
  const released = await perCase([decision('locked', 0), decision('head-locked', 0)]);
  expect([...released.results.values()]).toEqual([true, true]);
}, 120_000);

it('costs one chain walk per assignment case instead of one per row', async () => {
  // Every row references one club occurrence; rows spread over each chain's revisions.
  const decisions = Array.from({ length: SCALE_CASES }, (_, index) => index + 1).flatMap(
    (clubCase) =>
      Array.from(
        { length: SCALE_ROWS_PER_CASE },
        (_, row) => `scale:${clubCase}:${(row + 1) * (SCALE_CHAIN / SCALE_ROWS_PER_CASE)}`
      )
  );
  const before = await perOrigin(decisions);
  const after = await perCase(decisions);
  expect([...before.results.values()].every((value) => value === true)).toBe(true);
  expect(after.results).toEqual(before.results);
  const perRow = (milliseconds: number) =>
    Math.round((milliseconds / decisions.length) * 1000) / 1000;
  console.info(
    `Assignment continuity for ${decisions.length} rows over ${SCALE_CASES} ` +
      `${SCALE_CHAIN}-revision chains: per row ${perRow(before.milliseconds)} ms ` +
      `(${Math.round(before.milliseconds)} ms, ${before.advisoryLocks} advisory locks); ` +
      `per case ${perRow(after.milliseconds)} ms per row ` +
      `(${Math.round(after.milliseconds)} ms, ${after.advisoryLocks} advisory locks)`
  );
  expect(after.milliseconds * 10).toBeLessThan(before.milliseconds);
  // Both hold exactly the review subjects on the spans they read, never more.
  expect(after.advisoryLocks).toBeLessThanOrEqual(before.advisoryLocks);
}, 600_000);
