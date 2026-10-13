import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradePromotedDraftSelectionReader } from '@/server/aflTradeIntelligence/source/postgresPromotedDraftSelectionReader';
import { createSyntheticAcquisitionPlayerPromotion } from '../testUtils/acquisitionPlayerPromotionFixture';
import { deployOutcomesHistoryBefore } from './outcomesPreMigrationWorkspace';

/**
 * Migration 0277 (statlyaus/Statly#853, docs/architecture/afl-draft-pick-identity-rules.md, "Repairing
 * promoted state"): an identity repair re-targets a player's external identity decision, and the next
 * deferred candidate names the new player under unchanged transaction and transfer ids. Such a trade
 * is no longer left to its earlier promotion: it is written again as a superseding version whose
 * player asset names the new player and cites the new decision.
 */
const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL ?? '';
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');

const MIGRATION = '0277_deferred_candidate_promoted_players';
const admin = new Pool({ connectionString: databaseUrl, max: 2 });

interface Workspace {
  pool: Pool;
  dispose: () => Promise<void>;
}
const workspaces: Workspace[] = [];
let ordinal = 0;

/** One disposable schema per case: the history just before 0277, then 0277 as deploy applies it. */
async function workspace(): Promise<Workspace> {
  const schemaName = `afl_promoted_player_identity_${process.pid}_${Date.now()}_${ordinal++}`;
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
  return built;
}

afterAll(async () => {
  try {
    for (const built of workspaces) await built.dispose();
  } finally {
    await admin.end();
  }
});

const SEED_EVENT = '2024-seed-alpha';
const SEED_PLAYER = 'seed-player';
const DRAFTGURU_PLAYER = 'synthetic-acquisition-player';
const TWIN = { playerId: 'afl-tables-twin', playerName: 'Synthetic Player (AFL Tables)' };

/** A plain promotion of the trade: a player one way, a 2025 first-round pick back, its custody. */
const seed = (ws: Workspace) =>
  createSyntheticAcquisitionPlayerPromotion(ws.pool, {
    reciprocalFuturePickYearOffset: 1,
    fixtureNamespace: 'seed',
    providerEventId: SEED_EVENT,
    nativePlayerId: SEED_PLAYER,
  });

/**
 * A deferred candidate holding the same trade (and a second trade it always writes), resolved
 * against canonical state as preparation resolves it. `retargeted` makes this candidate's identity
 * decision, the next revision of the same native player's subject, name the AFL Tables twin.
 */
const again = (ws: Workspace, namespace: string, retargeted: boolean) =>
  createSyntheticAcquisitionPlayerPromotion(ws.pool, {
    reciprocalFuturePickYearOffset: 1,
    fixtureNamespace: namespace,
    providerEventId: SEED_EVENT,
    nativePlayerId: SEED_PLAYER,
    pickSideIssues: 'deferred',
    reciprocalFuturePickResolved: true,
    transactionAlreadyPromoted: true,
    resolvePromotedRecords: true,
    existingTargets: {
      playerId: DRAFTGURU_PLAYER,
      playerName: 'Synthetic Player',
      fromClubId: 'club-gws',
      fromClubName: 'GWS',
      toClubId: 'club-western-bulldogs',
      toClubName: 'Western Bulldogs',
    },
    ...(retargeted ? { retargetedPlayer: TWIN } : {}),
  });

type Seeded = Awaited<ReturnType<typeof seed>>;
const playerTransferOf = (seeded: Seeded) =>
  seeded.candidate.content.transfers.find(({ asset }) => asset.kind === 'player')!;

const reader = (ws: Workspace) =>
  new PostgresAflTradePromotedDraftSelectionReader(createPgAflOutcomeSqlClient(ws.pool));

/** Every version of the trade, oldest first, with its player assets and the decisions they cite. */
async function tradeVersions(ws: Workspace, transactionId: string) {
  return (
    await ws.pool.query<{
      version: number;
      superseded: boolean;
      players: { player_id: string; decision: string }[];
    }>(
      `SELECT version.version,
              EXISTS (SELECT 1 FROM outcome_event_version successor
                       WHERE successor.supersedes_version_id=version.event_version_id) AS superseded,
              COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                 'player_id',asset.player_id,
                                 'decision',asset.external_identity_decision_id)
                               ORDER BY asset.player_id)
                          FROM outcome_event_asset asset
                         WHERE asset.event_version_id=version.event_version_id
                           AND asset.player_id IS NOT NULL),'[]'::jsonb) AS players
         FROM outcome_event_version version WHERE version.event_id=$1 ORDER BY version.version`,
      [transactionId]
    )
  ).rows;
}

describe('repairing promoted player identity (migration 0277)', () => {
  it('reads each current trade with the player of every promoted player asset', async () => {
    const ws = await workspace();
    const seeded = await seed(ws);
    const trade = seeded.candidate.content.transactions[0]!;
    const playerTransfer = playerTransferOf(seeded);
    const [current] = await reader(ws).loadCurrentCanonicalTransactions('AFLM');
    expect(current).toMatchObject({
      transactionId: trade.transactionId,
      transferPlayerIds: [{ transferId: playerTransfer.transferId, playerId: DRAFTGURU_PLAYER }],
    });
    expect(await reader(ws).loadCurrentCanonicalTransactions('VFL')).toEqual([]);
  }, 300_000);

  it('leaves a trade whose re-reviewed player is unchanged to the earlier promotion', async () => {
    const ws = await workspace();
    const seeded = await seed(ws);
    const trade = seeded.candidate.content.transactions[0]!;
    // The second promotion advances the subject's decision revision with the same target.
    const deferred = await again(ws, 'unchanged', false);
    expect(deferred.identityDecisionId).not.toBe(seeded.identityDecisionId);
    expect(deferred.candidate.content.pickLineageDeferral?.promotedTransactions).toEqual([
      trade.transactionId,
    ]);
    expect(await tradeVersions(ws, trade.transactionId)).toEqual([
      {
        version: 1,
        superseded: false,
        players: [{ player_id: DRAFTGURU_PLAYER, decision: seeded.identityDecisionId }],
      },
    ]);
  }, 300_000);

  it('writes a superseding version of a trade whose player was re-targeted, citing the new decision', async () => {
    const ws = await workspace();
    const seeded = await seed(ws);
    const trade = seeded.candidate.content.transactions[0]!;
    const custodyId = seeded.candidate.content.pickCustody[0]!.custodyId;

    const deferred = await again(ws, 'retargeted', true);
    const playerTransfer = deferred.candidate.content.transfers.find(
      ({ asset, transactionId }) => asset.kind === 'player' && transactionId === trade.transactionId
    )!;
    // Same transaction and transfer ids: only the player shows the repair.
    expect(playerTransfer.transferId).toBe(playerTransferOf(seeded).transferId);
    expect(playerTransfer.asset).toMatchObject({ playerId: TWIN.playerId });
    expect(deferred.playerId).toBe(TWIN.playerId);
    // The trade is not left to the seed; its unchanged custody observation still is.
    expect(deferred.candidate.content.pickLineageDeferral).toEqual({
      decisionId: deferred.deferralDecisionId,
      promotedCustodyIds: [custodyId],
    });
    expect(deferred.promotion).toMatchObject({
      transactionCount: 2,
      transferCount: 3,
      pickCustodyCount: 0,
      pickRealizationCount: 0,
    });
    expect(await tradeVersions(ws, trade.transactionId)).toEqual([
      {
        version: 1,
        superseded: true,
        players: [{ player_id: DRAFTGURU_PLAYER, decision: seeded.identityDecisionId }],
      },
      {
        version: 2,
        superseded: false,
        players: [{ player_id: TWIN.playerId, decision: deferred.identityDecisionId }],
      },
    ]);
    // The new decision is the subject's next revision, superseding the one version 1 cites.
    const decisions = await ws.pool.query<{ supersedes: string | null; target: string }>(
      `SELECT supersedes_decision_id AS supersedes,canonical_record_id AS target
         FROM outcome_review_decision WHERE decision_id=$1`,
      [deferred.identityDecisionId]
    );
    expect(decisions.rows).toEqual([
      { supersedes: seeded.identityDecisionId, target: TWIN.playerId },
    ]);
    expect(
      (await reader(ws).loadCurrentCanonicalTransactions('AFLM')).find(
        ({ transactionId }) => transactionId === trade.transactionId
      )?.transferPlayerIds
    ).toEqual([{ transferId: playerTransfer.transferId, playerId: TWIN.playerId }]);
    expect(
      await ws.pool.query('SELECT 1 FROM outcome_pick_custody_observation').then((r) => r.rowCount)
    ).toBe(1);
  }, 300_000);

  it('holds a listed trade to the player of every promoted player asset', async () => {
    const ws = await workspace();
    const seeded = await seed(ws);
    const { content } = seeded.candidate;
    const trade = content.transactions[0]!;
    const playerTransfer = playerTransferOf(seeded);
    const transactionsCurrent = async (playerId: unknown) =>
      (
        await ws.pool.query<{ current: boolean }>(
          'SELECT outcome_external_candidate_promoted_transactions_current($1::jsonb) AS current',
          [
            JSON.stringify({
              content: {
                competition: 'AFLM',
                transactions: [trade],
                transfers: content.transfers.map((transfer) =>
                  transfer.transferId === playerTransfer.transferId
                    ? { ...transfer, asset: { ...transfer.asset, playerId } }
                    : transfer
                ),
                pickLineageDeferral: { promotedTransactions: [trade.transactionId] },
              },
            }),
          ]
        )
      ).rows[0]!.current;
    expect(await transactionsCurrent(DRAFTGURU_PLAYER)).toBe(true);
    expect(await transactionsCurrent(TWIN.playerId)).toBe(false);
    expect(await transactionsCurrent(null)).toBe(false);
  }, 300_000);
});
