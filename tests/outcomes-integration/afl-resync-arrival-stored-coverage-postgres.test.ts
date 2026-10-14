import { Pool, type PoolClient } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { createSyntheticAcquisitionPlayerPromotion } from '../testUtils/acquisitionPlayerPromotionFixture';
import { deployOutcomesHistoryBefore } from './outcomesPreMigrationWorkspace';

/**
 * Migration 0280 (statlyaus/Statly#853, docs/architecture/afl-draft-pick-identity-rules.md,
 * "Repairing promoted draftees"): a re-synced draftee's arrival check stops re-running the
 * candidate-wide `outcome_external_draft_sessions_exact` for a deferred candidate, whose result the
 * promotion insert guard already proved from facts that cannot change. The candidate's selection
 * helpers read its lists once. On the grading database one such check took 9 min 38 s. Each case
 * seeds under the history just before 0280, records every answer, applies 0280 as deploy does, and
 * requires the same answers with no session-coverage re-validation on the arrival path.
 */
const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL ?? '';
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');

const MIGRATION = '0280_resync_arrival_stored_coverage';
const admin = new Pool({ connectionString: databaseUrl, max: 2 });

interface Workspace {
  pool: Pool;
  migrate: () => Promise<void>;
  dispose: () => Promise<void>;
}
const workspaces: Workspace[] = [];
let ordinal = 0;

/** One disposable schema per case at the history just before 0280; `migrate` applies 0280. */
async function workspace(): Promise<Workspace> {
  const schemaName = `afl_resync_arrival_coverage_${process.pid}_${Date.now()}_${ordinal++}`;
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const pool = new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schemaName}`,
    max: 4,
  });
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  const history = await deployOutcomesHistoryBefore(MIGRATION, scoped.toString(), pool);
  const built: Workspace = {
    pool,
    migrate: async () => {
      await pool.query(history.migrationSql);
    },
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

const TWIN = { playerId: 'afl-tables-twin', playerName: 'Synthetic Draftee (AFL Tables)' };
/** The draftee the seed promoted at selection 2 (the year page's one selection). */
const SEEDED_DRAFTEE = 'seed-draft-player-1';

/** A session promotion of the 2024 national draft: selection 1 in session 1, selection 2 in session 2. */
const seed = (ws: Workspace) =>
  createSyntheticAcquisitionPlayerPromotion(ws.pool, {
    draftSessions: true,
    fixtureNamespace: 'seed',
    providerEventId: '2024-seed-alpha',
    nativePlayerId: 'seed-player',
  });

/** A deferred candidate holding the year page's selection 2, after `retarget` re-reviews the draftee. */
const again = (ws: Workspace, namespace: string, retarget: typeof TWIN) =>
  createSyntheticAcquisitionPlayerPromotion(ws.pool, {
    reciprocalFuturePickYearOffset: 1,
    fixtureNamespace: namespace,
    providerEventId: `2024-${namespace}-alpha`,
    nativePlayerId: `${namespace}-player`,
    pickSideIssues: 'deferred',
    yearPageDraftAlreadyPromoted: true,
    yearPageDraftRetarget: retarget,
    resolvePromotedRecords: true,
    existingTargets: {
      playerId: 'synthetic-acquisition-player',
      playerName: 'Synthetic Player',
      fromClubId: 'club-gws',
      fromClubName: 'GWS',
      toClubId: 'club-western-bulldogs',
      toClubName: 'Western Bulldogs',
    },
  });

/**
 * Runs `work` in a rolled-back transaction with function tracking on and returns its result with
 * the number of `outcome_external_draft_sessions_exact` calls it made.
 */
async function counted<T>(ws: Workspace, work: (client: PoolClient) => Promise<T>) {
  const client = await ws.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL track_functions = 'all'");
    const value = await work(client);
    const calls = (
      await client.query<{ calls: string | null }>(
        `SELECT pg_stat_get_xact_function_calls(
                  'outcome_external_draft_sessions_exact(text,jsonb)'::regprocedure) AS calls`
      )
    ).rows[0]!.calls;
    return { value, sessionChecks: Number(calls ?? 0) };
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

const arrivalCurrent = async (client: PoolClient, entry: unknown, playerId: string) =>
  (
    await client.query<{ current: boolean }>(
      `SELECT outcome_acquisition_arrival_event_current($1::jsonb,$2,$3,'test_fixture','AFLM',TRUE,
                clock_timestamp(),clock_timestamp()) AS current`,
      [JSON.stringify(entry), playerId, 'club-western-bulldogs']
    )
  ).rows[0]!.current;

/** Every answer 0280 touches for these candidates, promotions and versions. */
async function answers(
  ws: Workspace,
  candidateIds: readonly string[],
  versionChecks: readonly { promotionId: string; eventVersionId: string }[]
) {
  const selections = [];
  for (const candidateId of candidateIds) {
    selections.push(
      (
        await ws.pool.query<{
          promotable: string[] | null;
          resynced: string[] | null;
          unusable: number;
        }>(
          `SELECT (SELECT array_agg(selection_id ORDER BY selection_id)
                     FROM outcome_external_candidate_promotable_selections($1)) AS promotable,
                  (SELECT array_agg(selection_id ORDER BY selection_id)
                     FROM outcome_external_candidate_resynced_selections($1)) AS resynced,
                  outcome_external_candidate_unusable_record_count($1) AS unusable`,
          [candidateId]
        )
      ).rows[0]!
    );
  }
  const versions = [];
  for (const { promotionId, eventVersionId } of versionChecks) {
    versions.push(
      (
        await ws.pool.query<{ resync: boolean }>(
          'SELECT outcome_external_promoted_session_resync_version($1,$2) AS resync',
          [promotionId, eventVersionId]
        )
      ).rows[0]!.resync
    );
  }
  return { selections, versions };
}

describe('a re-synced draftee arrival reads the promotion stored coverage (migration 0280)', () => {
  it('keeps every arrival and re-sync answer and stops re-validating the candidate on the arrival path', async () => {
    const ws = await workspace();
    const seeded = await seed(ws);
    const deferred = await again(ws, 'retargeted', TWIN);
    const sessionVersion = (
      await ws.pool.query<{ event_version_id: string }>(
        `SELECT version.event_version_id FROM outcome_draft_selection selection
           JOIN outcome_event_version version ON version.event_version_id=selection.event_version_id
          WHERE selection.selection_number=2 ORDER BY version.version LIMIT 1`
      )
    ).rows[0]!.event_version_id;
    const twinEntry = deferred.draftEntries.find(({ player_id }) => player_id === TWIN.playerId)!;
    const seededEntry = seeded.draftEntries.find(({ player_id }) => player_id === SEEDED_DRAFTEE)!;
    expect(twinEntry.event_version_id).not.toBe(sessionVersion);
    const versionChecks = [
      // The re-sync version of the deferred promotion.
      { promotionId: deferred.promotion.promotionId, eventVersionId: twinEntry.event_version_id },
      // The version it supersedes is not a re-sync version of that promotion.
      { promotionId: deferred.promotion.promotionId, eventVersionId: sessionVersion },
      // Nor is the session promotion's own version, or the re-sync version under another promotion.
      { promotionId: seeded.promotion.promotionId, eventVersionId: sessionVersion },
      { promotionId: seeded.promotion.promotionId, eventVersionId: twinEntry.event_version_id },
    ];
    const candidateIds = [seeded.candidate.candidateId, deferred.candidate.candidateId];
    const arrivals = (client: PoolClient) =>
      Promise.all([
        arrivalCurrent(client, twinEntry.entry, TWIN.playerId),
        arrivalCurrent(client, seededEntry.entry, SEEDED_DRAFTEE),
        // The twin's draft asset never starts an arrival at the club it did not join.
        arrivalCurrent(client, twinEntry.entry, SEEDED_DRAFTEE),
      ]);
    const twinArrival = (client: PoolClient) =>
      arrivalCurrent(client, twinEntry.entry, TWIN.playerId);

    const before = await answers(ws, candidateIds, versionChecks);
    const arrivalsBefore = await counted(ws, arrivals);
    const twinBefore = await counted(ws, twinArrival);
    expect(before.versions).toEqual([true, false, false, false]);
    expect(arrivalsBefore.value).toEqual([true, false, false]);
    expect(before.selections[1]).toEqual({
      promotable: null,
      resynced: [deferred.candidate.content.pickLineageDeferral!.resyncedSelectionIds![0]],
      unusable: 0,
    });
    expect(before.selections[0]!.promotable).toHaveLength(
      seeded.candidate.content.draftSelections.length
    );
    // Under 0278 the twin's arrival re-validates the deferred candidate's draft coverage.
    expect(twinBefore.sessionChecks).toBeGreaterThan(0);

    await ws.migrate();

    expect(await answers(ws, candidateIds, versionChecks)).toEqual(before);
    expect((await counted(ws, arrivals)).value).toEqual(arrivalsBefore.value);
    expect(await counted(ws, twinArrival)).toEqual({ value: true, sessionChecks: 0 });
  }, 600_000);

  it('keeps the promotable selections of a draft left whole to its earlier promotion', async () => {
    const ws = await workspace();
    await seed(ws);
    const displayName = (
      await ws.pool.query<{ display_name: string }>(
        'SELECT display_name FROM outcome_player WHERE player_id=$1',
        [SEEDED_DRAFTEE]
      )
    ).rows[0]!.display_name;
    const deferred = await again(ws, 'unchanged', {
      playerId: SEEDED_DRAFTEE,
      playerName: displayName,
    });
    expect(deferred.candidate.content.pickLineageDeferral).toMatchObject({
      promotedDrafts: [{ draftYear: 2024, draftType: 'national' }],
    });
    const before = await answers(ws, [deferred.candidate.candidateId], []);
    expect(before.selections).toEqual([{ promotable: null, resynced: null, unusable: 0 }]);
    const reviewProof = `SELECT outcome_external_draft_sessions_exact(candidate_id,proposal_json->'content') AS exact
                           FROM outcome_external_canonical_promotion WHERE promotion_id=$1`;
    const exactBefore = (
      await ws.pool.query<{ exact: boolean }>(reviewProof, [deferred.promotion.promotionId])
    ).rows[0]!.exact;
    expect(exactBefore).toBe(true);

    await ws.migrate();

    expect(await answers(ws, [deferred.candidate.candidateId], [])).toEqual(before);
    expect(
      (await ws.pool.query<{ exact: boolean }>(reviewProof, [deferred.promotion.promotionId]))
        .rows[0]!.exact
    ).toBe(exactBefore);
  }, 600_000);
});
