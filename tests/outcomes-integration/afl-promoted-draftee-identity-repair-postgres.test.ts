import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradePromotedDraftSelectionReader } from '@/server/aflTradeIntelligence/source/postgresPromotedDraftSelectionReader';
import { createSyntheticAcquisitionPlayerPromotion } from '../testUtils/acquisitionPlayerPromotionFixture';
import { deployOutcomesHistoryBefore } from './outcomesPreMigrationWorkspace';

/**
 * Migration 0278 (statlyaus/Statly#853, docs/architecture/afl-draft-pick-identity-rules.md,
 * "Repairing promoted players"): an identity repair re-targets a draftee's external identity
 * decision, and the next deferred candidate names the new player under the same source selection
 * id. The draft is no longer left whole to its earlier session promotion: the changed slot is
 * re-promoted alone, as a later version of its session that carries only that slot, so every other
 * draftee on the night stays current.
 */
const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL ?? '';
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');

const MIGRATION = '0278_deferred_candidate_resynced_draft_players';
const admin = new Pool({ connectionString: databaseUrl, max: 2 });

interface Workspace {
  pool: Pool;
  dispose: () => Promise<void>;
}
const workspaces: Workspace[] = [];
let ordinal = 0;

/**
 * One disposable schema per case: the history just before 0278, then 0278 as deploy applies it, then
 * every later migration (0279 makes a re-sync repair the player alone).
 */
async function workspace(): Promise<Workspace> {
  const schemaName = `afl_promoted_draftee_identity_${process.pid}_${Date.now()}_${ordinal++}`;
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
    dispose: async () => {
      await history.cleanup();
      await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    },
  };
  workspaces.push(built);
  await pool.query(history.migrationSql);
  const root = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'prisma',
    'afl-trade-outcomes',
    'migrations'
  );
  const later = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name > MIGRATION)
    .map((entry) => entry.name)
    .sort();
  for (const name of later)
    await pool.query(await readFile(join(root, name, 'migration.sql'), 'utf8'));
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

/**
 * A deferred candidate holding the year page's selection 2 (and its own trade), resolved against
 * canonical state as preparation resolves it, after `retarget` re-reviews the draftee.
 */
const again = (
  ws: Workspace,
  namespace: string,
  retarget: { playerId: string; playerName: string },
  pickUnresolved = false
) =>
  createSyntheticAcquisitionPlayerPromotion(ws.pool, {
    ...(pickUnresolved ? { yearPageSelectionPickUnresolved: true } : {}),
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

const reader = (ws: Workspace) =>
  new PostgresAflTradePromotedDraftSelectionReader(createPgAflOutcomeSqlClient(ws.pool));

/** The session-2 version the seed wrote, with the draftee at selection 2. */
async function sessionTwo(ws: Workspace) {
  return (
    await ws.pool.query<{ event_id: string; event_version_id: string }>(
      `SELECT version.event_id,version.event_version_id FROM outcome_draft_selection selection
         JOIN outcome_event_version version ON version.event_version_id=selection.event_version_id
        WHERE selection.selection_number=2 ORDER BY version.version LIMIT 1`
    )
  ).rows[0]!;
}

/**
 * Records other draftees on the seed's session-2 version, the way a draft night holds many: a
 * selection and a selected-player asset per number, for players the fixture never promoted. Only
 * their slots matter here (migration 0256 counts them), so they are written directly with the
 * insert guards off, citing the seeded draftee's identity decision rather than reviews of their own.
 */
async function addNightSlots(ws: Workspace, eventVersionId: string, numbers: readonly number[]) {
  const client = await ws.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL session_replication_role = replica');
    for (const number of numbers) {
      const player = `night-player-${number}`;
      await client.query(
        `INSERT INTO outcome_player(player_id,display_name,status) VALUES($1,$2,'approved')`,
        [player, `Night Player ${number}`]
      );
      await client.query(
        `INSERT INTO outcome_draft_selection
         SELECT * FROM jsonb_populate_record(NULL::outcome_draft_selection,
           (SELECT to_jsonb(selection) || jsonb_build_object(
              'selection_id','synthetic-night-selection:'||$2::text,'selection_number',$2::int,
              'pick_id',NULL,'player_id',$3::text)
              FROM outcome_draft_selection selection
             WHERE selection.event_version_id=$1 AND selection.selection_number=2))`,
        [eventVersionId, number, player]
      );
      await client.query(
        `INSERT INTO outcome_event_asset
         SELECT * FROM jsonb_populate_record(NULL::outcome_event_asset,
           (SELECT to_jsonb(asset) || jsonb_build_object(
              'asset_version_id','synthetic-night-asset:'||$2::text,
              'asset_key','selected-player:synthetic-night-'||$2::text,'player_id',$3::text)
              FROM outcome_event_asset asset
             WHERE asset.event_version_id=$1 AND asset.player_id=$4))`,
        [eventVersionId, number, player, SEEDED_DRAFTEE]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * A scoped later version of a night, the way the 2020 Cameron promotion re-versioned the 2019 to 2021
 * nights for two or three draftees: version 2 of the root carries copies of the given slots of
 * `originVersionId` and nothing else, so under migration 0256 it retires only those slots there.
 * Written with the insert guards off; only its slots matter here.
 */
async function scopedSuccessor(
  ws: Workspace,
  originVersionId: string,
  numbers: readonly number[]
): Promise<string> {
  const eventVersionId = 'event-version:synthetic-scoped-successor';
  const client = await ws.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL session_replication_role = replica');
    await client.query(
      `INSERT INTO outcome_event_version
         (event_version_id,event_id,version,kind,acquisition_mechanism,event_date,official_name,status,
          source_import_row_id,supersedes_version_id,recorded_at,date_precision)
       SELECT $1,event_id,version+1,kind,acquisition_mechanism,event_date,official_name,'approved',
              source_import_row_id,event_version_id,clock_timestamp(),date_precision
         FROM outcome_event_version WHERE event_version_id=$2`,
      [eventVersionId, originVersionId]
    );
    await client.query(
      `INSERT INTO outcome_draft_selection
       SELECT (jsonb_populate_record(NULL::outcome_draft_selection, to_jsonb(selection)
                || jsonb_build_object('selection_id','synthetic-scoped-selection:'||selection.selection_number,
                                      'event_version_id',$1::text))).*
         FROM outcome_draft_selection selection
        WHERE selection.event_version_id=$2 AND selection.selection_number=ANY($3::integer[])`,
      [eventVersionId, originVersionId, [...numbers]]
    );
    await client.query(
      `INSERT INTO outcome_event_asset
       SELECT (jsonb_populate_record(NULL::outcome_event_asset, to_jsonb(asset)
                || jsonb_build_object('asset_version_id','synthetic-scoped-asset:'||asset.player_id,
                                      'asset_key','selected-player:synthetic-scoped-'||asset.player_id,
                                      'event_version_id',$1::text))).*
         FROM outcome_event_asset asset
        WHERE asset.event_version_id=$2
          AND asset.player_id IN (SELECT player_id FROM outcome_draft_selection
                                   WHERE event_version_id=$2 AND selection_number=ANY($3::integer[]))`,
      [eventVersionId, originVersionId, [...numbers]]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return eventVersionId;
}

/** Every version of a draft session root, oldest first, with its selections and their decisions. */
async function sessionVersions(ws: Workspace, eventId: string) {
  return (
    await ws.pool.query<{
      version: number;
      superseded: boolean;
      selections: { number: number; player_id: string; decision: string | null }[];
      assets: string[];
    }>(
      `SELECT version.version,
              EXISTS (SELECT 1 FROM outcome_event_version successor
                       WHERE successor.supersedes_version_id=version.event_version_id) AS superseded,
              (SELECT jsonb_agg(jsonb_build_object('number',selection.selection_number,
                                 'player_id',selection.player_id,
                                 'decision',selection.external_identity_decision_id)
                                ORDER BY selection.selection_number)
                 FROM outcome_draft_selection selection
                WHERE selection.event_version_id=version.event_version_id) AS selections,
              (SELECT jsonb_agg(asset.player_id ORDER BY asset.player_id)
                 FROM outcome_event_asset asset
                WHERE asset.event_version_id=version.event_version_id) AS assets
         FROM outcome_event_version version WHERE version.event_id=$1 ORDER BY version.version`,
      [eventId]
    )
  ).rows;
}

/** Whether a selection (by number) or a player's asset on a version is retired (migration 0256). */
async function retired(
  ws: Workspace,
  eventVersionId: string,
  player: string,
  selectionNumber: number | null
) {
  return (
    await ws.pool.query<{ retired: boolean }>(
      'SELECT outcome_event_version_superseded_for($1,$2,$3) AS retired',
      [eventVersionId, player, selectionNumber]
    )
  ).rows[0]!.retired;
}

describe('re-promoting a draftee whose player identity changed (migration 0278)', () => {
  it('re-promotes only the changed slot as a later version of its session and keeps the rest of the night current', async () => {
    const ws = await workspace();
    const seeded = await seed(ws);
    const yearPageSelection = seeded.candidate.content.draftSelections.find(
      ({ selectionNumber }) => selectionNumber === 2
    )!;
    expect(yearPageSelection.playerId).toBe(SEEDED_DRAFTEE);
    const session = await sessionTwo(ws);
    await addNightSlots(ws, session.event_version_id, [3, 4, 5]);
    const sessionOne = await ws.pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM outcome_event_version version
         JOIN outcome_event root ON root.event_id=version.event_id
        WHERE root.stable_key LIKE '%:session:1'`
    );

    const deferred = await again(ws, 'retargeted', TWIN);
    expect(deferred.candidate.content.pickLineageDeferral).toEqual({
      decisionId: deferred.deferralDecisionId,
      resyncedSelectionIds: [yearPageSelection.selectionId],
    });
    expect(deferred.candidate.content.draftSelections).toEqual([
      expect.objectContaining({
        selectionId: yearPageSelection.selectionId,
        playerId: TWIN.playerId,
      }),
    ]);
    expect(deferred.proposal.content.draftEventCoverage).toEqual([
      expect.objectContaining({
        kind: 'promoted_session_resync',
        draftYear: 2024,
        draftType: 'national',
        supersedesVersionId: session.event_version_id,
        selectionIds: [yearPageSelection.selectionId],
      }),
    ]);
    expect(deferred.promotion).toMatchObject({
      draftSelectionCount: 1,
      draftPlayerAssetCount: 1,
      pickLineageDeferral: {
        decisionId: deferred.deferralDecisionId,
        resyncedSelectionCount: 1,
      },
    });

    // One later version of session 2 carrying only the changed slot, citing the twin's decision.
    const twinDecision = (
      await ws.pool.query<{ decision_id: string; supersedes: string | null }>(
        `SELECT identity.review_decision_id AS decision_id,decision.supersedes_decision_id AS supersedes
           FROM outcome_external_reconciliation_identity_resolution identity
           JOIN outcome_review_decision decision ON decision.decision_id=identity.review_decision_id
          WHERE identity.candidate_id=$1 AND identity.canonical_id=$2`,
        [deferred.candidate.candidateId, TWIN.playerId]
      )
    ).rows[0]!;
    const seedDecision = (
      await ws.pool.query<{ decision: string }>(
        `SELECT external_identity_decision_id AS decision FROM outcome_draft_selection
          WHERE event_version_id=$1 AND selection_number=2`,
        [session.event_version_id]
      )
    ).rows[0]!.decision;
    expect(twinDecision.supersedes).toBe(seedDecision);
    const versions = await sessionVersions(ws, session.event_id);
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({ version: 1, superseded: true });
    expect(versions[0]!.selections.map(({ number }) => number)).toEqual([2, 3, 4, 5]);
    expect(versions[1]).toEqual({
      version: 2,
      superseded: false,
      selections: [{ number: 2, player_id: TWIN.playerId, decision: twinDecision.decision_id }],
      assets: [TWIN.playerId],
    });

    // The old slot is retired; every other draftee's selection and asset on the night stays current.
    expect(await retired(ws, session.event_version_id, SEEDED_DRAFTEE, 2)).toBe(true);
    for (const number of [3, 4, 5]) {
      expect(await retired(ws, session.event_version_id, `night-player-${number}`, number)).toBe(
        false
      );
      expect(await retired(ws, session.event_version_id, `night-player-${number}`, null)).toBe(
        false
      );
    }
    // Session 1 is untouched, and the reader now sees the twin at selection 2.
    expect(
      (
        await ws.pool.query<{ count: number }>(
          `SELECT count(*)::integer AS count FROM outcome_event_version version
             JOIN outcome_event root ON root.event_id=version.event_id
            WHERE root.stable_key LIKE '%:session:1'`
        )
      ).rows[0]!.count
    ).toBe(sessionOne.rows[0]!.count);
    expect(
      (await reader(ws).loadCurrentCanonicalSelections('AFLM')).find(
        ({ selectionId }) => selectionId === yearPageSelection.selectionId
      )
    ).toEqual({
      selectionId: yearPageSelection.selectionId,
      selectionNumber: 2,
      playerId: TWIN.playerId,
    });

    // The twin's draft asset is session evidence for an arrival, with the session's date bounds.
    const resync = (
      await ws.pool.query<{ event_version_id: string; is_resync: boolean; same_bounds: boolean }>(
        `SELECT version.event_version_id,
                outcome_external_promoted_session_resync_version($1,version.event_version_id) AS is_resync,
                outcome_event_evidenced_date_bounds(version.event_version_id)
                  IS NOT DISTINCT FROM outcome_event_evidenced_date_bounds($2) AS same_bounds
           FROM outcome_event_version version WHERE version.supersedes_version_id=$2`,
        [deferred.promotion.promotionId, session.event_version_id]
      )
    ).rows[0]!;
    expect(resync).toMatchObject({ is_resync: true, same_bounds: true });
    expect(
      (
        await ws.pool.query<{ is_resync: boolean }>(
          'SELECT outcome_external_promoted_session_resync_version($1,$2) AS is_resync',
          [seeded.promotion.promotionId, session.event_version_id]
        )
      ).rows[0]!.is_resync
    ).toBe(false);
    // So a reviewed arrival can start at the twin's draft asset. The old draftee's asset no longer
    // can: its identity decision was superseded by one naming another player.
    const arrivalCurrent = async (entry: unknown, playerId: string) =>
      (
        await ws.pool.query<{ current: boolean }>(
          `SELECT outcome_acquisition_arrival_event_current($1::jsonb,$2,$3,'test_fixture','AFLM',TRUE,
                    clock_timestamp(),clock_timestamp()) AS current`,
          [JSON.stringify(entry), playerId, 'club-western-bulldogs']
        )
      ).rows[0]!.current;
    const twinEntry = deferred.draftEntries.find(({ player_id }) => player_id === TWIN.playerId)!;
    expect(twinEntry.event_version_id).toBe(resync.event_version_id);
    expect(await arrivalCurrent(twinEntry.entry, TWIN.playerId)).toBe(true);
    const seededEntry = seeded.draftEntries.find(({ player_id }) => player_id === SEEDED_DRAFTEE)!;
    expect(await arrivalCurrent(seededEntry.entry, SEEDED_DRAFTEE)).toBe(false);
  }, 600_000);

  // The genuine 2019-11-28, 2020-12-09 and 2021-11-25 nights: the re-targeted draftee's current row
  // is on version 1, whose root's current version is a two- or three-slot scoped version 2.
  it('re-syncs a slot on the origin version of a night whose current version is a small scoped successor', async () => {
    const ws = await workspace();
    await seed(ws);
    const session = await sessionTwo(ws);
    await addNightSlots(ws, session.event_version_id, [3, 4, 5, 6, 7]);
    const scoped = await scopedSuccessor(ws, session.event_version_id, [6, 7]);
    // Before the re-sync: version 1 keeps selection 2 to 5 current, version 2 holds 6 and 7.
    expect(await retired(ws, session.event_version_id, SEEDED_DRAFTEE, 2)).toBe(false);
    expect(await retired(ws, session.event_version_id, 'night-player-6', 6)).toBe(true);
    expect(await retired(ws, scoped, 'night-player-6', 6)).toBe(false);

    const deferred = await again(ws, 'scoped-night', TWIN);
    expect(deferred.proposal.content.draftEventCoverage).toEqual([
      expect.objectContaining({ kind: 'promoted_session_resync', supersedesVersionId: scoped }),
    ]);
    const versions = await sessionVersions(ws, session.event_id);
    expect(versions.map(({ version, superseded }) => ({ version, superseded }))).toEqual([
      { version: 1, superseded: true },
      { version: 2, superseded: true },
      { version: 3, superseded: false },
    ]);
    expect(versions[1]!.selections.map(({ number }) => number)).toEqual([6, 7]);
    expect(versions[2]).toMatchObject({
      selections: [{ number: 2, player_id: TWIN.playerId }],
      assets: [TWIN.playerId],
    });
    const resync = (
      await ws.pool.query<{ event_version_id: string }>(
        'SELECT event_version_id FROM outcome_event_version WHERE supersedes_version_id=$1',
        [scoped]
      )
    ).rows[0]!.event_version_id;

    // Only the re-synced slot is retired. Version 1's other selections and assets, and version 2's
    // selections and assets, stay current: the predicate the spells starting at them are held to.
    expect(await retired(ws, session.event_version_id, SEEDED_DRAFTEE, 2)).toBe(true);
    for (const number of [3, 4, 5]) {
      expect(await retired(ws, session.event_version_id, `night-player-${number}`, number)).toBe(
        false
      );
      expect(await retired(ws, session.event_version_id, `night-player-${number}`, null)).toBe(
        false
      );
    }
    for (const number of [6, 7]) {
      expect(await retired(ws, scoped, `night-player-${number}`, number)).toBe(false);
      expect(await retired(ws, scoped, `night-player-${number}`, null)).toBe(false);
    }
    expect(await retired(ws, resync, TWIN.playerId, 2)).toBe(false);
    expect(await retired(ws, resync, TWIN.playerId, null)).toBe(false);
    expect(
      (await reader(ws).loadCurrentCanonicalSelections('AFLM')).find(
        ({ playerId }) => playerId === TWIN.playerId
      )
    ).toMatchObject({ selectionNumber: 2 });
    const twinEntry = deferred.draftEntries.find(({ player_id }) => player_id === TWIN.playerId)!;
    expect(
      (
        await ws.pool.query<{ current: boolean }>(
          `SELECT outcome_acquisition_arrival_event_current($1::jsonb,$2,$3,'test_fixture','AFLM',TRUE,
                    clock_timestamp(),clock_timestamp()) AS current`,
          [JSON.stringify(twinEntry.entry), TWIN.playerId, 'club-western-bulldogs']
        )
      ).rows[0]!.current
    ).toBe(true);
  }, 600_000);

  // The genuine rehearsal (2026-10-14): 38 of 73 re-synced selections were `unresolved` only on the
  // pick side (player and club resolve, pick custody does not), and the review refused the candidate
  // as holding unusable records. A re-sync repairs the player alone, so it keeps the promoted row's
  // pick id and club and needs only its player and club resolved (migration 0279).
  it('reviews and promotes a re-sync whose selection is unresolved only on the pick side, keeping the promoted pick id', async () => {
    const ws = await workspace();
    await seed(ws);
    const session = await sessionTwo(ws);
    const promotedRow = (
      await ws.pool.query<{ pick_id: string | null; club_id: string }>(
        `SELECT pick_id,club_id FROM outcome_draft_selection
          WHERE event_version_id=$1 AND selection_number=2`,
        [session.event_version_id]
      )
    ).rows[0]!;
    const deferred = await again(ws, 'pick-unresolved', TWIN, true);
    const selection = deferred.candidate.content.draftSelections[0]!;
    expect(selection).toMatchObject({ status: 'unresolved', playerId: TWIN.playerId });
    expect(selection.pickId).not.toBe(promotedRow.pick_id);
    expect(deferred.candidate.content.pickLineageDeferral).toMatchObject({
      resyncedSelectionIds: [selection.selectionId],
    });
    expect(deferred.proposal.content.draftEventCoverage).toEqual([
      expect.objectContaining({
        kind: 'promoted_session_resync',
        selectionIds: [selection.selectionId],
      }),
    ]);
    expect(deferred.promotion).toMatchObject({ draftSelectionCount: 1, draftPlayerAssetCount: 1 });
    const written = (
      await ws.pool.query<{ pick_id: string | null; club_id: string; player_id: string }>(
        `SELECT selection.pick_id,selection.club_id,selection.player_id
           FROM outcome_draft_selection selection
           JOIN outcome_event_version version ON version.event_version_id=selection.event_version_id
          WHERE version.supersedes_version_id=$1`,
        [session.event_version_id]
      )
    ).rows;
    expect(written).toEqual([
      { pick_id: promotedRow.pick_id, club_id: promotedRow.club_id, player_id: TWIN.playerId },
    ]);
  }, 600_000);

  it('leaves a draft whose re-reviewed draftee is unchanged to the earlier promotion', async () => {
    const ws = await workspace();
    await seed(ws);
    const session = await sessionTwo(ws);
    const before = await sessionVersions(ws, session.event_id);
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
    expect(deferred.candidate.content.pickLineageDeferral).toEqual({
      decisionId: deferred.deferralDecisionId,
      promotedDrafts: [{ draftYear: 2024, draftType: 'national' }],
    });
    expect(deferred.promotion).toMatchObject({ draftSelectionCount: 0, draftPlayerAssetCount: 0 });
    expect(await sessionVersions(ws, session.event_id)).toEqual(before);
  }, 600_000);

  it('holds a listed draft to its players and refuses an unsound re-sync listing', async () => {
    const ws = await workspace();
    const seeded = await seed(ws);
    const selections = seeded.candidate.content.draftSelections;
    const second = selections.find(({ selectionNumber }) => selectionNumber === 2)!;
    const first = selections.find(({ selectionNumber }) => selectionNumber === 1)!;
    const candidate = (draftSelections: readonly unknown[], deferral: Record<string, unknown>) =>
      JSON.stringify({
        content: {
          competition: 'AFLM',
          draftSelections,
          pickLineageDeferral: { decisionId: `review-decision:${'d'.repeat(64)}`, ...deferral },
        },
      });
    const resyncedCurrent = async (draftSelections: readonly unknown[], ids: readonly string[]) =>
      (
        await ws.pool.query<{ current: boolean }>(
          'SELECT outcome_external_candidate_resynced_selections_current($1::jsonb) AS current',
          [candidate(draftSelections, { resyncedSelectionIds: ids })]
        )
      ).rows[0]!.current;
    const promotedCurrent = async (draftSelections: readonly unknown[]) =>
      (
        await ws.pool.query<{ current: boolean }>(
          'SELECT outcome_external_candidate_promoted_drafts_current($1::jsonb) AS current',
          [
            candidate(draftSelections, {
              promotedDrafts: [{ draftYear: 2024, draftType: 'national' }],
            }),
          ]
        )
      ).rows[0]!.current;
    const retargeted = { ...second, playerId: TWIN.playerId };

    // A listed draft must name every current player; an unresolved draftee compares its id alone.
    expect(await promotedCurrent([first, second])).toBe(true);
    expect(await promotedCurrent([first, retargeted])).toBe(false);
    expect(await promotedCurrent([first, { ...second, playerId: null }])).toBe(true);

    // A sound re-sync: the changed selection under another player, the rest of the draft unchanged.
    expect(await resyncedCurrent([first, retargeted], [second.selectionId])).toBe(true);
    // Unsound: the player did not change, another selection of the draft changed too, the listed
    // selection has no player or is not current, the list repeats, or the draft is also promoted.
    expect(await resyncedCurrent([first, second], [second.selectionId])).toBe(false);
    expect(
      await resyncedCurrent(
        [{ ...first, playerId: 'someone-else' }, retargeted],
        [second.selectionId]
      )
    ).toBe(false);
    expect(
      await resyncedCurrent([first, { ...second, playerId: null }], [second.selectionId])
    ).toBe(false);
    expect(
      await resyncedCurrent(
        [first, { ...retargeted, selectionId: 'external-draft-selection:unpromoted' }],
        ['external-draft-selection:unpromoted']
      )
    ).toBe(false);
    expect(
      await resyncedCurrent([first, retargeted], [second.selectionId, second.selectionId])
    ).toBe(false);
    expect(
      (
        await ws.pool.query<{ current: boolean }>(
          'SELECT outcome_external_candidate_resynced_selections_current($1::jsonb) AS current',
          [
            candidate([first, retargeted], {
              promotedDrafts: [{ draftYear: 2024, draftType: 'national' }],
              resyncedSelectionIds: [second.selectionId],
            }),
          ]
        )
      ).rows[0]!.current
    ).toBe(false);
  }, 600_000);

  it('refuses a re-sync that would change half or more of the other slots on the night', async () => {
    const ws = await workspace();
    await seed(ws);
    const session = await sessionTwo(ws);
    // One other draftee: carrying selection 2 re-lists half of the other selections (0256).
    await addNightSlots(ws, session.event_version_id, [3]);
    const before = await sessionVersions(ws, session.event_id);
    await expect(again(ws, 'relisting', TWIN)).rejects.toMatchObject({
      code: 'IMMUTABLE_CONFLICT',
      message: expect.stringMatching(/would retire 1 recorded slot/),
    });
    expect(await sessionVersions(ws, session.event_id)).toEqual(before);
    expect(await retired(ws, session.event_version_id, 'night-player-3', 3)).toBe(false);
  }, 600_000);
});
