import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { deriveAflTradeExternalCanonicalPromotionProposal } from '@/server/aflTradeIntelligence/source/externalCanonicalPromotionContracts';
import { PostgresAflTradeExternalCanonicalPromotionReviewRepository } from '@/server/aflTradeIntelligence/source/postgresExternalCanonicalPromotionReviewRepository';
import { createSyntheticAcquisitionPlayerPromotion } from '../testUtils/acquisitionPlayerPromotionFixture';
import { deployOutcomesHistoryBefore } from './outcomesPreMigrationWorkspace';

/**
 * Migration 0282 (statlyaus/Statly#853, docs/architecture/afl-draft-pick-identity-rules.md,
 * "Repairing promoted draftees"): the 2018 completion has no pick-side issue, so its candidate
 * deferred nothing and the decision, with the re-synced selections it carries, was dropped. A
 * candidate that defers nothing now keeps the decision when it lists something and writes no draft
 * whole, so a re-targeted draftee of such a completion is re-promoted alone like any other.
 */
const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL ?? '';
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');

const MIGRATION = '0282_issueless_deferral_resync';
const admin = new Pool({ connectionString: databaseUrl, max: 2 });

interface Workspace {
  pool: Pool;
  dispose: () => Promise<void>;
}
const workspaces: Workspace[] = [];
let ordinal = 0;

/** One disposable schema per case: the history before 0282, then 0282 and every later migration. */
async function workspace(): Promise<Workspace> {
  const schemaName = `afl_issueless_deferral_${process.pid}_${Date.now()}_${ordinal++}`;
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
 * A candidate of a completion with no pick-side issue: the reciprocal future pick has usable custody
 * and the year page's draftee is reviewed (re-reviewed by `retarget`), so nothing is deferred. It is
 * prepared under the completion's deferral decision and resolved against canonical state as
 * preparation resolves it, then reviewed and promoted.
 */
const issueless = (ws: Workspace, namespace: string, retarget: typeof TWIN) =>
  createSyntheticAcquisitionPlayerPromotion(ws.pool, {
    reciprocalFuturePickYearOffset: 1,
    reciprocalFuturePickResolved: true,
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
 * Other draftees on the seed's session-2 version, written directly with the insert guards off, so a
 * one-slot re-sync is additive under migration 0256 (it carries fewer than half of the other slots).
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

/** Every version of a draft session root, oldest first, with its selections' numbers and players. */
async function sessionVersions(ws: Workspace, eventId: string) {
  return (
    await ws.pool.query<{
      version: number;
      superseded: boolean;
      selections: { number: number; player_id: string }[];
    }>(
      `SELECT version.version,
              EXISTS (SELECT 1 FROM outcome_event_version successor
                       WHERE successor.supersedes_version_id=version.event_version_id) AS superseded,
              (SELECT jsonb_agg(jsonb_build_object('number',selection.selection_number,
                                 'player_id',selection.player_id) ORDER BY selection.selection_number)
                 FROM outcome_draft_selection selection
                WHERE selection.event_version_id=version.event_version_id) AS selections
         FROM outcome_event_version version WHERE version.event_id=$1 ORDER BY version.version`,
      [eventId]
    )
  ).rows;
}

async function storedDeferral(ws: Workspace, candidateId: string) {
  return (
    await ws.pool.query<{ deferred_issue_count: number; lineage_deferral_decision_id: string }>(
      `SELECT deferred_issue_count,lineage_deferral_decision_id
         FROM outcome_external_reconciliation_candidate WHERE candidate_id=$1`,
      [candidateId]
    )
  ).rows[0]!;
}

describe('re-syncing a re-targeted draftee from a completion with no pick-side issue (migration 0282)', () => {
  it('keeps the decision with the re-synced slot, reviews it with no draft events and writes the one slot', async () => {
    const ws = await workspace();
    await seed(ws);
    const session = await sessionTwo(ws);
    await addNightSlots(ws, session.event_version_id, [3, 4, 5]);

    const repaired = await issueless(ws, 'issueless', TWIN);
    const selection = repaired.candidate.content.draftSelections[0]!;
    expect(repaired.candidate.content.issues).toEqual([]);
    expect(repaired.candidate.content.pickLineageDeferral).toEqual({
      decisionId: repaired.deferralDecisionId,
      resyncedSelectionIds: [selection.selectionId],
    });
    expect(await storedDeferral(ws, repaired.candidate.candidateId)).toEqual({
      deferred_issue_count: 0,
      lineage_deferral_decision_id: repaired.deferralDecisionId,
    });
    expect(repaired.proposal.content.draftEventCoverage).toEqual([
      expect.objectContaining({
        kind: 'promoted_session_resync',
        supersedesVersionId: session.event_version_id,
        selectionIds: [selection.selectionId],
      }),
    ]);
    expect(repaired.promotion).toMatchObject({
      draftSelectionCount: 1,
      draftPlayerAssetCount: 1,
      pickLineageDeferral: {
        decisionId: repaired.deferralDecisionId,
        deferredIssueCount: 0,
        resyncedSelectionCount: 1,
      },
    });

    // One later version of session 2 carrying only the twin; the rest of the night stays current.
    const versions = await sessionVersions(ws, session.event_id);
    expect(versions).toEqual([
      expect.objectContaining({ version: 1, superseded: true }),
      { version: 2, superseded: false, selections: [{ number: 2, player_id: TWIN.playerId }] },
    ]);
    for (const number of [3, 4, 5]) {
      expect(
        (
          await ws.pool.query<{ retired: boolean }>(
            'SELECT outcome_event_version_superseded_for($1,$2,$3) AS retired',
            [session.event_version_id, `night-player-${number}`, number]
          )
        ).rows[0]!.retired
      ).toBe(false);
    }

    // The twin's draft asset is arrival evidence through the stored coverage of the re-sync.
    const twinEntry = repaired.draftEntries.find(({ player_id }) => player_id === TWIN.playerId)!;
    const checks = (
      await ws.pool.query<{ is_resync: boolean; arrival: boolean }>(
        `SELECT outcome_external_promoted_session_resync_version($1,$2) AS is_resync,
                outcome_acquisition_arrival_event_current($3::jsonb,$4,'club-western-bulldogs',
                  'test_fixture','AFLM',TRUE,clock_timestamp(),clock_timestamp()) AS arrival`,
        [
          repaired.promotion.promotionId,
          twinEntry.event_version_id,
          JSON.stringify(twinEntry.entry),
          TWIN.playerId,
        ]
      )
    ).rows[0]!;
    expect(checks).toEqual({ is_resync: true, arrival: true });

    // The review needs no draft events: no draft is written whole, only the session re-sync, which
    // it reads from canonical state. Read now, the slot is current on the re-sync version itself.
    const derived = deriveAflTradeExternalCanonicalPromotionProposal({
      candidate: repaired.candidate,
      proposedAt: repaired.proposal.content.proposedAt,
      draftEvents: [],
      promotedSessionResyncs: await new PostgresAflTradeExternalCanonicalPromotionReviewRepository(
        createPgAflOutcomeSqlClient(ws.pool)
      ).loadPromotedSessionResyncs({ competition: 'AFLM', selectionIds: [selection.selectionId] }),
    });
    expect(derived.content.draftEventCoverage).toEqual([
      {
        ...repaired.proposal.content.draftEventCoverage[0],
        supersedesVersionId: twinEntry.event_version_id,
      },
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
    const unchanged = await issueless(ws, 'same-target', {
      playerId: SEEDED_DRAFTEE,
      playerName: displayName,
    });
    expect(unchanged.candidate.content.issues).toEqual([]);
    expect(unchanged.candidate.content.pickLineageDeferral).toEqual({
      decisionId: unchanged.deferralDecisionId,
      promotedDrafts: [{ draftYear: 2024, draftType: 'national' }],
    });
    expect(unchanged.proposal.content.draftEventCoverage).toEqual([]);
    expect(unchanged.promotion).toMatchObject({
      draftSelectionCount: 0,
      draftPlayerAssetCount: 0,
      pickLineageDeferral: { deferredIssueCount: 0, promotedDraftCount: 1 },
    });
    expect(await sessionVersions(ws, session.event_id)).toEqual(before);
  }, 600_000);

  it('holds a decision with no deferred issue to a candidate that writes no draft whole', async () => {
    const ws = await workspace();
    const decisionId = `review-decision:${'d'.repeat(64)}`;
    const kept = async (deferral: Record<string, unknown>, selections: readonly unknown[]) =>
      (
        await ws.pool.query<{ kept: boolean }>(
          'SELECT outcome_external_candidate_issueless_deferral_kept($1::jsonb) AS kept',
          [
            JSON.stringify({
              content: {
                draftSelections: selections,
                pickLineageDeferral: { decisionId, ...deferral },
              },
            }),
          ]
        )
      ).rows[0]!.kept;
    const slot = (selectionId: string, draftType = 'national') => ({
      selectionId,
      draftYear: 2018,
      draftType,
    });
    const national = [slot('external-draft-selection:a'), slot('external-draft-selection:b')];
    expect(await kept({ resyncedSelectionIds: ['external-draft-selection:a'] }, national)).toBe(
      true
    );
    expect(
      await kept({ promotedDrafts: [{ draftYear: 2018, draftType: 'national' }] }, national)
    ).toBe(true);
    // Nothing listed, or another draft that would be written whole.
    expect(await kept({}, national)).toBe(false);
    expect(
      await kept({ resyncedSelectionIds: ['external-draft-selection:a'] }, [
        ...national,
        slot('external-draft-selection:c', 'rookie'),
      ])
    ).toBe(false);
    // A trade-only candidate leaving its trade to an earlier promotion writes no draft at all.
    expect(await kept({ promotedTransactions: ['external-transaction:x'] }, [])).toBe(true);
    // The candidate check: a deferred issue still needs the decision; the decision no longer needs one.
    const check = (
      await ws.pool.query<{ definition: string }>(
        `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
          WHERE conname='outcome_external_reconciliation_lineage_deferral_check'`
      )
    ).rows[0]!.definition;
    expect(check).toMatch(
      /\(deferred_issue_count = 0\) OR \(lineage_deferral_decision_id IS NOT NULL\)/
    );
  }, 600_000);
});
