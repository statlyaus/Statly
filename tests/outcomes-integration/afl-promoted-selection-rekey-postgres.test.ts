import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import type { AflTradeDraftRootSlot } from '@/server/aflTradeIntelligence/source/pickLineageDeferral';
import { PostgresAflTradePromotedDraftSelectionReader } from '@/server/aflTradeIntelligence/source/postgresPromotedDraftSelectionReader';
import { createSyntheticAcquisitionPlayerPromotion } from '../testUtils/acquisitionPlayerPromotionFixture';
import { deployOutcomesHistoryBefore } from './outcomesPreMigrationWorkspace';

/**
 * Migration 0284 (statlyaus/Statly#853, docs/architecture/afl-draft-pick-identity-rules.md,
 * "Repairing promoted draftees"): a selection promoted before the pick-identity rules carries its
 * slot's number-only pick id. When a deferred candidate names the pick, with usable custody, the slot
 * is re-keyed: re-promoted as a later version of its session carrying only the changed slots, under
 * the candidate's pick and the same player and club, so every other draftee on the night stays
 * current.
 */
const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL ?? '';
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');

const MIGRATION = '0284_rekey_promoted_selection_picks';
const admin = new Pool({ connectionString: databaseUrl, max: 2 });

interface Workspace {
  pool: Pool;
  dispose: () => Promise<void>;
}
const workspaces: Workspace[] = [];
let ordinal = 0;

/** One disposable schema per case: the history before 0284, then 0284 and every later migration. */
async function workspace(): Promise<Workspace> {
  const schemaName = `afl_promoted_selection_rekey_${process.pid}_${Date.now()}_${ordinal++}`;
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

/** The draftee the seed promoted at selection 2 (the year page's one selection). */
const SEEDED_DRAFTEE = 'seed-draft-player-1';
const numberOnly = (selectionNumber: number) =>
  createAflTradeContentAddress('draft-pick', {
    draftYear: 2024,
    draftType: 'national',
    nominalPick: selectionNumber,
    nominalRound: null,
  });

/**
 * A session promotion of the 2024 national draft under number-only pick ids, as before the
 * pick-identity rules: selection 1 in session 1, selection 2 in session 2.
 */
const seed = (ws: Workspace) =>
  createSyntheticAcquisitionPlayerPromotion(ws.pool, {
    draftSessions: true,
    draftSelectionPicksNumberOnly: true,
    fixtureNamespace: 'seed',
    providerEventId: '2024-seed-alpha',
    nativePlayerId: 'seed-player',
  });

/**
 * A deferred candidate holding the year page's selection 2 under the same draftee, resolved against
 * canonical state as preparation resolves it. With `rekeyed` it names the selecting club's round-1
 * entitlement, with a usable custody observation, as the selection's pick.
 */
const again = (
  ws: Workspace,
  namespace: string,
  options: {
    rekeyed?: boolean;
    rekeyRootSlots?: readonly AflTradeDraftRootSlot[];
    retarget?: { playerId: string; playerName: string };
  } = {}
) =>
  createSyntheticAcquisitionPlayerPromotion(ws.pool, {
    ...(options.rekeyed ? { yearPageSelectionRekeyed: true } : {}),
    ...(options.retarget ? { yearPageDraftRetarget: options.retarget } : {}),
    ...(options.rekeyRootSlots ? { rekeyRootSlots: options.rekeyRootSlots } : {}),
    reciprocalFuturePickYearOffset: 1,
    fixtureNamespace: namespace,
    providerEventId: `2024-${namespace}-alpha`,
    nativePlayerId: `${namespace}-player`,
    pickSideIssues: 'deferred',
    yearPageDraftAlreadyPromoted: true,
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
 * selection (with no pick) and a selected-player asset per number, written with the insert guards
 * off. Only their slots matter here (migration 0256 counts them).
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

/** Every version of a draft session root, oldest first, with its selections and assets. */
async function sessionVersions(ws: Workspace, eventId: string) {
  return (
    await ws.pool.query<{
      version: number;
      superseded: boolean;
      selections: { number: number; player_id: string; pick_id: string | null; club_id: string }[];
      assets: string[];
    }>(
      `SELECT version.version,
              EXISTS (SELECT 1 FROM outcome_event_version successor
                       WHERE successor.supersedes_version_id=version.event_version_id) AS superseded,
              (SELECT jsonb_agg(jsonb_build_object('number',selection.selection_number,
                                 'player_id',selection.player_id,'pick_id',selection.pick_id,
                                 'club_id',selection.club_id)
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

async function arrivalCurrent(ws: Workspace, entry: unknown, playerId: string) {
  return (
    await ws.pool.query<{ current: boolean }>(
      `SELECT outcome_acquisition_arrival_event_current($1::jsonb,$2,$3,'test_fixture','AFLM',TRUE,
                clock_timestamp(),clock_timestamp()) AS current`,
      [JSON.stringify(entry), playerId, 'club-western-bulldogs']
    )
  ).rows[0]!.current;
}

describe('re-keying a promoted selection’s number-only pick id (migration 0284)', () => {
  it('re-keys the slot as a later version of its session and keeps the rest of the night current', async () => {
    const ws = await workspace();
    const seeded = await seed(ws);
    const session = await sessionTwo(ws);
    await addNightSlots(ws, session.event_version_id, [3, 4, 5, 6]);
    const promoted = (await sessionVersions(ws, session.event_id))[0]!.selections.find(
      ({ number }) => number === 2
    )!;
    expect(promoted).toMatchObject({ player_id: SEEDED_DRAFTEE, pick_id: numberOnly(2) });

    const deferred = await again(ws, 'rekeyed', { rekeyed: true });
    const yearPageSelection = deferred.candidate.content.draftSelections.find(
      ({ selectionNumber }) => selectionNumber === 2
    )!;
    expect(yearPageSelection).toMatchObject({
      playerId: SEEDED_DRAFTEE,
      status: 'single_source',
    });
    expect(yearPageSelection.pickId).not.toBe(numberOnly(2));
    expect(deferred.candidate.content.pickLineageDeferral).toEqual({
      decisionId: deferred.deferralDecisionId,
      rekeyedSelectionIds: [yearPageSelection.selectionId],
    });
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
        rekeyedSelectionCount: 1,
      },
    });
    expect(deferred.promotion.pickLineageDeferral).not.toHaveProperty('resyncedSelectionCount');

    // One later version of session 2 carrying only the re-keyed slot: same player and club, the
    // candidate's pick.
    const versions = await sessionVersions(ws, session.event_id);
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({ version: 1, superseded: true });
    expect(versions[0]!.selections.map(({ number }) => number)).toEqual([2, 3, 4, 5, 6]);
    expect(versions[1]).toEqual({
      version: 2,
      superseded: false,
      selections: [
        {
          number: 2,
          player_id: SEEDED_DRAFTEE,
          pick_id: yearPageSelection.pickId,
          club_id: promoted.club_id,
        },
      ],
      assets: [SEEDED_DRAFTEE],
    });

    // The old slot's selection and asset are re-versioned; every other draftee stays current.
    expect(await retired(ws, session.event_version_id, SEEDED_DRAFTEE, 2)).toBe(true);
    expect(await retired(ws, session.event_version_id, SEEDED_DRAFTEE, null)).toBe(true);
    for (const number of [3, 4, 5, 6]) {
      expect(await retired(ws, session.event_version_id, `night-player-${number}`, number)).toBe(
        false
      );
      expect(await retired(ws, session.event_version_id, `night-player-${number}`, null)).toBe(
        false
      );
    }
    expect(
      (await reader(ws).loadCurrentCanonicalSelectionPicks('AFLM')).selections.find(
        ({ selectionId }) => selectionId === yearPageSelection.selectionId
      )
    ).toMatchObject({
      selectionNumber: 2,
      playerId: SEEDED_DRAFTEE,
      pickId: yearPageSelection.pickId,
    });

    // A spell that started at the old asset is no longer current; one re-registered at the
    // re-keyed slot's asset is, with the session's date bounds.
    const seededEntry = seeded.draftEntries.find(({ player_id }) => player_id === SEEDED_DRAFTEE)!;
    expect(await arrivalCurrent(ws, seededEntry.entry, SEEDED_DRAFTEE)).toBe(false);
    const rekeyedEntry = deferred.draftEntries.find(
      ({ player_id }) => player_id === SEEDED_DRAFTEE
    )!;
    expect(rekeyedEntry.event_version_id).not.toBe(session.event_version_id);
    expect(await arrivalCurrent(ws, rekeyedEntry.entry, SEEDED_DRAFTEE)).toBe(true);
    expect(
      (
        await ws.pool.query<{ same_bounds: boolean }>(
          `SELECT outcome_event_evidenced_date_bounds($1)
                    IS NOT DISTINCT FROM outcome_event_evidenced_date_bounds($2) AS same_bounds`,
          [rekeyedEntry.event_version_id, session.event_version_id]
        )
      ).rows[0]!.same_bounds
    ).toBe(true);

    // The next preparation finds the slot under the candidate's pick: the draft is left whole.
    const rerun = await again(ws, 'rekeyed-rerun', { rekeyed: true });
    expect(rerun.candidate.content.pickLineageDeferral).toEqual({
      decisionId: rerun.deferralDecisionId,
      promotedDrafts: [{ draftYear: 2024, draftType: 'national' }],
      promotedCustodyIds: expect.any(Array),
    });
    expect(rerun.promotion).toMatchObject({ draftSelectionCount: 0, draftPlayerAssetCount: 0 });
    expect(await sessionVersions(ws, session.event_id)).toHaveLength(2);
  }, 600_000);

  it('re-keys a slot whose draftee an identity repair also re-targeted, in one version', async () => {
    const ws = await workspace();
    await seed(ws);
    const session = await sessionTwo(ws);
    await addNightSlots(ws, session.event_version_id, [3, 4, 5, 6]);
    const twin = { playerId: 'afl-tables-twin', playerName: 'Synthetic Draftee (AFL Tables)' };
    const deferred = await again(ws, 'both', { rekeyed: true, retarget: twin });
    const yearPageSelection = deferred.candidate.content.draftSelections.find(
      ({ selectionNumber }) => selectionNumber === 2
    )!;
    expect(deferred.candidate.content.pickLineageDeferral).toEqual({
      decisionId: deferred.deferralDecisionId,
      resyncedSelectionIds: [yearPageSelection.selectionId],
      rekeyedSelectionIds: [yearPageSelection.selectionId],
    });
    expect(deferred.proposal.content.draftEventCoverage).toEqual([
      expect.objectContaining({
        kind: 'promoted_session_resync',
        selectionIds: [yearPageSelection.selectionId],
      }),
    ]);
    expect(deferred.promotion).toMatchObject({
      draftSelectionCount: 1,
      pickLineageDeferral: { resyncedSelectionCount: 1, rekeyedSelectionCount: 1 },
    });
    const versions = await sessionVersions(ws, session.event_id);
    expect(versions[1]).toMatchObject({
      version: 2,
      selections: [{ number: 2, player_id: twin.playerId, pick_id: yearPageSelection.pickId }],
      assets: [twin.playerId],
    });
    for (const number of [3, 4, 5, 6]) {
      expect(await retired(ws, session.event_version_id, `night-player-${number}`, number)).toBe(
        false
      );
    }
  }, 600_000);

  it('leaves the slot on its number-only id while re-keying it would retire another draftee', async () => {
    const ws = await workspace();
    await seed(ws);
    const session = await sessionTwo(ws);
    // One other draftee: a version carrying selection 2 carries all of 3's other slots (0256).
    await addNightSlots(ws, session.event_version_id, [3]);
    const before = await sessionVersions(ws, session.event_id);
    const deferred = await again(ws, 'crowded', { rekeyed: true });
    expect(deferred.candidate.content.pickLineageDeferral).toEqual({
      decisionId: deferred.deferralDecisionId,
      promotedDrafts: [{ draftYear: 2024, draftType: 'national' }],
    });
    expect(deferred.promotion).toMatchObject({ draftSelectionCount: 0 });
    expect(await sessionVersions(ws, session.event_id)).toEqual(before);
  }, 600_000);

  it('refuses a promotion planned against a night that has since changed', async () => {
    const ws = await workspace();
    await seed(ws);
    const session = await sessionTwo(ws);
    // The plan reads a large night; the stored night holds one other draftee.
    const stale: AflTradeDraftRootSlot[] = [
      ...(await reader(ws).loadCurrentCanonicalSelectionPicks('AFLM')).rootSlots,
      ...[3, 4, 5, 6, 7].flatMap((number) => [
        {
          eventId: session.event_id,
          eventVersionId: session.event_version_id,
          kind: 'selection' as const,
          selectionNumber: number,
          playerId: `planned-player-${number}`,
          current: true,
        },
        {
          eventId: session.event_id,
          eventVersionId: session.event_version_id,
          kind: 'asset' as const,
          selectionNumber: null,
          playerId: `planned-player-${number}`,
          current: true,
        },
      ]),
    ];
    await addNightSlots(ws, session.event_version_id, [3]);
    const before = await sessionVersions(ws, session.event_id);
    await expect(
      again(ws, 'stale-plan', { rekeyed: true, rekeyRootSlots: stale })
    ).rejects.toMatchObject({
      code: 'IMMUTABLE_CONFLICT',
      // Draftee 3's selection and asset: the version carries the re-keyed slot's own player.
      message: expect.stringMatching(/would retire 2 recorded slot/),
    });
    expect(await sessionVersions(ws, session.event_id)).toEqual(before);
    expect(await retired(ws, session.event_version_id, 'night-player-3', 3)).toBe(false);
  }, 600_000);

  it('holds a re-key listing to its number-only row, usable undeferred custody and rule 4', async () => {
    const ws = await workspace();
    const seeded = await seed(ws);
    const selections = seeded.candidate.content.draftSelections;
    const first = selections.find(({ selectionNumber }) => selectionNumber === 1)!;
    const second = selections.find(({ selectionNumber }) => selectionNumber === 2)!;
    const pick = createAflTradeContentAddress('draft-pick', { entitlement: 'synthetic' });
    const rekeyed = { ...second, pickId: pick };
    const custody = (pickId: string, status = 'single_source') => ({
      custodyId: `external-pick-custody:${pickId.split(':')[1]}`,
      pickId,
      status,
    });
    const rekeyedCurrent = async (
      draftSelections: readonly unknown[],
      ids: readonly string[],
      extra: {
        pickCustody?: readonly unknown[];
        issues?: readonly unknown[];
        deferral?: Record<string, unknown>;
      } = {}
    ) =>
      (
        await ws.pool.query<{ current: boolean }>(
          'SELECT outcome_external_candidate_rekeyed_selections_current($1::jsonb) AS current',
          [
            JSON.stringify({
              content: {
                competition: 'AFLM',
                draftSelections,
                pickCustody: extra.pickCustody ?? [custody(pick)],
                transfers: [],
                issues: extra.issues ?? [],
                pickLineageDeferral: {
                  decisionId: `review-decision:${'d'.repeat(64)}`,
                  rekeyedSelectionIds: ids,
                  ...extra.deferral,
                },
              },
            }),
          ]
        )
      ).rows[0]!.current;

    // A sound listing: slot 2's current row carries its number-only id, the candidate names a
    // usable custody pick nobody else carries, and the rest of the draft is current unchanged.
    expect(await rekeyedCurrent([first, rekeyed], [second.selectionId])).toBe(true);
    // The candidate pick must not be a number-only address, must have usable custody that no
    // deferred issue defers, and the candidate selection must be usable.
    expect(
      await rekeyedCurrent([first, { ...second, pickId: numberOnly(2) }], [second.selectionId], {
        pickCustody: [custody(numberOnly(2))],
      })
    ).toBe(false);
    expect(
      await rekeyedCurrent([first, rekeyed], [second.selectionId], {
        pickCustody: [custody(pick, 'unresolved')],
      })
    ).toBe(false);
    expect(
      await rekeyedCurrent([first, rekeyed], [second.selectionId], {
        issues: [
          {
            code: 'pick_identity_conflict',
            severity: 'deferred',
            subjectKey: `pick-custody:${pick}`,
          },
        ],
      })
    ).toBe(false);
    expect(
      await rekeyedCurrent([first, { ...rekeyed, status: 'unresolved' }], [second.selectionId])
    ).toBe(false);
    // Pick-identity rule 4: selection 1's current row already carries the pick.
    expect(
      await rekeyedCurrent([first, { ...second, pickId: numberOnly(1) }], [second.selectionId], {
        pickCustody: [custody(numberOnly(1))],
      })
    ).toBe(false);
    // The player and club must be the current row's, and the slot must not be re-synced away.
    expect(
      await rekeyedCurrent([first, { ...rekeyed, playerId: 'someone-else' }], [second.selectionId])
    ).toBe(false);
    expect(
      await rekeyedCurrent([first, { ...rekeyed, clubId: 'club-gws' }], [second.selectionId])
    ).toBe(false);
    // ...unless the slot is also re-synced, when the re-sync guard holds the player.
    expect(
      await rekeyedCurrent(
        [first, { ...rekeyed, playerId: 'someone-else' }],
        [second.selectionId],
        {
          deferral: { resyncedSelectionIds: [second.selectionId] },
        }
      )
    ).toBe(true);
    // Another selection of the draft must be current unchanged; no promoted draft may hold one.
    expect(
      await rekeyedCurrent([{ ...first, playerId: 'someone-else' }, rekeyed], [second.selectionId])
    ).toBe(false);
    expect(
      await rekeyedCurrent([first, rekeyed], [second.selectionId], {
        deferral: { promotedDrafts: [{ draftYear: 2024, draftType: 'national' }] },
      })
    ).toBe(false);
    // Two re-keyed slots never take one pick, though each alone may.
    expect(await rekeyedCurrent([{ ...first, pickId: pick }, second], [first.selectionId])).toBe(
      true
    );
    expect(
      await rekeyedCurrent(
        [{ ...first, pickId: pick }, rekeyed],
        [first.selectionId, second.selectionId].sort()
      )
    ).toBe(false);
    // A malformed listing.
    expect(await rekeyedCurrent([first, rekeyed], [second.selectionId, second.selectionId])).toBe(
      false
    );
    expect(await rekeyedCurrent([first, rekeyed], [])).toBe(false);
  }, 600_000);
});
