import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  CHAINS,
  LOCKED_SUBJECT,
  SCALE_CASES,
  SCALE_CHAIN,
  caseId,
  decision,
  seedAssignmentContinuityChains,
} from '../testUtils/assignmentContinuityChains';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

// Migration 0289 lets outcome_provider_assignment_continuity_current remember, for the rest of a
// transaction, what one chain walk proved about an assignment case. This suite proves the
// remembered answers equal the unchanged 0128 walk (outcome_provider_assignment_continuity_current_uncached)
// for every origin in every chain state and in every evaluation order, that a write inside the
// transaction (including one under session_replication_role=replica) or a rolled-back savepoint
// retires them, that nothing survives the transaction, and that a fact-batch-shaped workload walks
// each case once instead of once per row.
const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('An explicitly disposable PostgreSQL database is required.');
const schemaName = `assignment_continuity_memo_${process.pid}_${Date.now()}`;
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

const ALL_DECISIONS = [
  ...CHAINS.flatMap((chain) => chain.links.map((_, index) => decision(chain.key, index))),
  decision('twice', 0),
  'continuity:unknown',
];

/** Runs work in one transaction that is always rolled back, so its locks and memo are released. */
async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    return await work(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

/** One call per origin, each its own statement, in the given order. */
async function eachOrigin(client: PoolClient, fn: string, decisions: readonly string[]) {
  const results = new Map<string, boolean | null>();
  for (const id of decisions) {
    const row = await client.query<{ current: boolean | null }>(`SELECT ${fn}($1) AS current`, [
      id,
    ]);
    results.set(id, row.rows[0]!.current);
  }
  return results;
}
const uncached = (client: PoolClient, decisions: readonly string[]) =>
  eachOrigin(client, 'outcome_provider_assignment_continuity_current_uncached', decisions);
const memoized = (client: PoolClient, decisions: readonly string[]) =>
  eachOrigin(client, 'outcome_provider_assignment_continuity_current', decisions);

/** Deterministic shuffle so a failure reproduces. */
function shuffled<T>(values: readonly T[], seed: number): T[] {
  const copy = [...values];
  let state = seed;
  for (let index = copy.length - 1; index > 0; index -= 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const other = state % (index + 1);
    [copy[index], copy[other]] = [copy[other]!, copy[index]!];
  }
  return copy;
}

async function withHolder<T>(work: () => Promise<T>): Promise<T> {
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
    return await work();
  } finally {
    await holder.query('ROLLBACK');
    holder.release();
  }
}

it('equals the per-origin walk for every origin, chain state and evaluation order', async () => {
  await withHolder(async () => {
    const expected = await inTransaction((client) => uncached(client, ALL_DECISIONS));
    const orders = [
      ALL_DECISIONS,
      [...ALL_DECISIONS].reverse(),
      shuffled(ALL_DECISIONS, 1),
      shuffled(ALL_DECISIONS, 2),
      shuffled(ALL_DECISIONS, 3),
    ];
    for (const order of orders) {
      // Every origin twice in one transaction: the second pass answers from remembered verdicts.
      const [first, second] = await inTransaction(async (client) => [
        await memoized(client, order),
        await memoized(client, shuffled(order, 7)),
      ]);
      for (const id of ALL_DECISIONS) {
        expect({ id, current: first.get(id) }).toEqual({ id, current: expected.get(id) });
        expect({ id, current: second.get(id) }).toEqual({ id, current: expected.get(id) });
      }
    }
    // The comparison is not vacuous: held locks fail closed and every rule rejects something.
    const values = [...expected.values()];
    expect(values.filter((value) => value === true).length).toBeGreaterThan(40);
    expect(values.filter((value) => value === false).length).toBeGreaterThan(40);
    expect(expected.get(decision('locked', 5))).toBe(false);
    expect(expected.get(decision('locked', 6))).toBe(true);
    expect(expected.get(decision('head-locked', 4))).toBe(false);
  });
}, 300_000);

it('never remembers a verdict across a lock another session releases', async () => {
  // A lower origin that fails on a held subject leaves the remembered verdict of a higher one
  // intact; once the holder releases it, the same transaction admits the lower origin.
  await inTransaction(async (client) => {
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(
        `SELECT pg_advisory_xact_lock(hashtextextended('outcome-review-subject:'||$1,0))`,
        [LOCKED_SUBJECT]
      );
      const held = await memoized(client, [
        decision('locked', 8),
        decision('locked', 2),
        decision('locked', 9),
      ]);
      expect([...held.values()]).toEqual([true, false, true]);
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
    const released = await memoized(client, [decision('locked', 2), decision('locked', 0)]);
    expect([...released.values()]).toEqual([true, true]);
  });
});

it('retires remembered verdicts on any write in the transaction and on savepoint rollback', async () => {
  const current = [0, 2, 5, 9].map((index) => decision('current', index));
  await inTransaction(async (client) => {
    expect([...(await memoized(client, current)).values()]).toEqual([true, true, true, true]);
    // Seeding-style writes bypass the reviewed writers but still retire the memo.
    await client.query(`SET LOCAL session_replication_role='replica'`);
    await client.query('SAVEPOINT withdrawal');
    await client.query(
      `INSERT INTO outcome_review_decision
        (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at,
         supersedes_decision_id)
       VALUES ('memo-withdrawal','provider_resolution_case','current:4','withdrawn','Synthetic',
         '{}'::jsonb,'synthetic-reviewer','2026-07-02T00:00:00.000Z',$1)`,
      [decision('current', 4)]
    );
    const withdrawn = await memoized(client, current);
    expect(withdrawn).toEqual(await uncached(client, current));
    expect([...withdrawn.values()]).toEqual([false, false, true, true]);
    await client.query('ROLLBACK TO SAVEPOINT withdrawal');
    expect([...(await memoized(client, current)).values()]).toEqual([true, true, true, true]);

    // A head moved back inside the transaction retires the memo too.
    await client.query(
      `UPDATE outcome_provider_identity_assignment_head SET revision=8,decision_id=$2
        WHERE assignment_case_id=$1`,
      [caseId('current'), decision('current', 7)]
    );
    const moved = await memoized(client, current);
    expect(moved).toEqual(await uncached(client, current));
    expect([...moved.values()]).toEqual([true, true, true, false]);
  });
});

it('keeps nothing beyond the transaction', async () => {
  const memoOf = async (client: PoolClient, key: string) =>
    (
      await client.query<{ memo: string }>(
        `SELECT COALESCE(current_setting('statly_assignment_continuity.c'||md5($1),true),'') AS memo`,
        [caseId(key)]
      )
    ).rows[0]!.memo;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await memoized(client, [decision('current', 0)]);
    expect(await memoOf(client, 'current')).toContain(caseId('current'));
    expect(await memoOf(client, 'superseded')).toBe('');
    await client.query('COMMIT');
    expect(await memoOf(client, 'current')).toBe('');
  } finally {
    client.release();
  }
});

it('walks each assignment case once for a fact-batch-shaped transaction', async () => {
  // Every row asks for one club occurrence of a long chain, in shuffled order, as a fact batch's
  // rows (sorted by decoded-row id) reach their club assignment decisions.
  const decisions = shuffled(
    Array.from({ length: SCALE_CASES }, (_, index) => index + 1).flatMap((clubCase) =>
      Array.from({ length: 75 }, (_, row) => `scale:${clubCase}:${((row * 8) % SCALE_CHAIN) + 1}`)
    ),
    11
  );
  const measure = (fn: typeof memoized) =>
    inTransaction(async (client) => {
      const started = performance.now();
      const results = await fn(client, decisions);
      const milliseconds = performance.now() - started;
      const locks = await client.query<{ count: number }>(
        `SELECT count(*)::integer AS count FROM pg_locks
          WHERE locktype='advisory' AND pid=pg_backend_pid()`
      );
      // Every case keeps its own verdict: interleaved cases never evict one another.
      const memos = await client.query<{ count: number }>(
        `SELECT count(*)::integer AS count FROM generate_series(1,$1::integer) c
          WHERE COALESCE(current_setting('statly_assignment_continuity.c'||md5(
            'provider-identity-assignment-case:'||encode(sha256(convert_to('scale:'||c,'UTF8')),'hex')),
            true),'')<>''`,
        [SCALE_CASES]
      );
      return {
        results,
        milliseconds,
        advisoryLocks: locks.rows[0]!.count,
        memos: memos.rows[0]!.count,
      };
    });
  const before = await measure(uncached);
  const after = await measure(memoized);
  expect([...before.results.values()].every((value) => value === true)).toBe(true);
  expect(after.results).toEqual(before.results);
  const perRow = (milliseconds: number) =>
    Math.round((milliseconds / decisions.length) * 1000) / 1000;
  console.info(
    `Assignment continuity for ${decisions.length} rows over ${SCALE_CASES} ` +
      `${SCALE_CHAIN}-revision chains: walk per row ${perRow(before.milliseconds)} ms ` +
      `(${Math.round(before.milliseconds)} ms, ${before.advisoryLocks} advisory locks); ` +
      `transaction memo ${perRow(after.milliseconds)} ms per row ` +
      `(${Math.round(after.milliseconds)} ms, ${after.advisoryLocks} advisory locks)`
  );
  expect(after.milliseconds * 5).toBeLessThan(before.milliseconds);
  // Both hold exactly the review subjects of the spans they walked.
  expect(after.advisoryLocks).toBe(before.advisoryLocks);
  expect(before.memos).toBe(0);
  expect(after.memos).toBe(SCALE_CASES);
}, 600_000);
