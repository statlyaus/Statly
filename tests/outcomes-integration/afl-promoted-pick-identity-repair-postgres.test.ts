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
 * Migration 0274 (statlyaus/Statly#853, docs/architecture/afl-draft-pick-identity-rules.md, "Repairing
 * promoted state"): a deferred candidate leaves a promoted trade to its promotion only when every pick
 * transfer keeps its promoted asset's pick id, so a trade whose pick the identity rules re-keyed is
 * written again as a superseding version; and it leaves custody already canonical with its facts to
 * the promotion that wrote it, so the second promotion of the same evidence does not collide.
 */
const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL ?? '';
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');

const MIGRATION = '0274_deferred_candidate_promoted_custody';
const admin = new Pool({ connectionString: databaseUrl, max: 2 });

/**
 * One disposable schema per case: the history deployed just before 0274, then 0274 applied as
 * `prisma migrate deploy` will, then every later migration: the repository reader these cases
 * prepare through reads functions they add (0275's current canonical transaction players). Two
 * promotions share a schema only under different namespaces.
 */
interface Workspace {
  pool: Pool;
  migrationSql: string;
  dispose: () => Promise<void>;
}
const workspaces: Workspace[] = [];
let ordinal = 0;

async function workspace(): Promise<Workspace> {
  const schemaName = `afl_promoted_pick_identity_${process.pid}_${Date.now()}_${ordinal++}`;
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
    migrationSql: history.migrationSql,
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

const SEED_EVENT = '2024-seed-alpha';
const SEED_PLAYER = 'seed-player';

/** A plain promotion of the trade: a player one way, a 2025 first-round pick back, its custody. */
const seed = (ws: Workspace) =>
  createSyntheticAcquisitionPlayerPromotion(ws.pool, {
    reciprocalFuturePickYearOffset: 1,
    fixtureNamespace: 'seed',
    providerEventId: SEED_EVENT,
    nativePlayerId: SEED_PLAYER,
  });

/**
 * A deferred candidate holding the same trade (and a second trade it always writes) with the pick
 * resolved and its custody row, already-promoted records resolved from canonical state as
 * preparation resolves them.
 */
const again = (
  ws: Workspace,
  namespace: string,
  options: {
    rekeyed?: boolean;
    recaptured?: boolean;
    sameTrade?: boolean;
    custodyAlreadyPromoted?: boolean;
  } = {}
) =>
  createSyntheticAcquisitionPlayerPromotion(ws.pool, {
    reciprocalFuturePickYearOffset: 1,
    fixtureNamespace: namespace,
    providerEventId: options.sameTrade === false ? `2024-${namespace}-alpha` : SEED_EVENT,
    nativePlayerId: options.sameTrade === false ? `${namespace}-player` : SEED_PLAYER,
    pickSideIssues: 'deferred',
    reciprocalFuturePickResolved: true,
    ...(options.sameTrade === false
      ? {}
      : {
          transactionAlreadyPromoted: true,
          resolvePromotedRecords: true,
          // The second promotion reuses the player and clubs the seed inserted.
          existingTargets: {
            playerId: 'synthetic-acquisition-player',
            playerName: 'Synthetic Player',
            fromClubId: 'club-gws',
            fromClubName: 'GWS',
            toClubId: 'club-western-bulldogs',
            toClubName: 'Western Bulldogs',
          },
        }),
    ...(options.rekeyed ? { reciprocalFuturePickRekeyed: true } : {}),
    ...(options.recaptured ? { reciprocalFuturePickCustodyRecaptured: true } : {}),
    ...(options.custodyAlreadyPromoted ? { custodyAlreadyPromoted: true } : {}),
  });

const count = async (ws: Workspace, sql: string, values: unknown[] = []) =>
  (await ws.pool.query<{ n: number }>(`SELECT count(*)::integer AS n FROM ${sql}`, values)).rows[0]!
    .n;

type Seeded = Awaited<ReturnType<typeof seed>>;
const pickTransferOf = (seeded: Seeded) =>
  seeded.candidate.content.transfers.find(({ asset }) => asset.kind === 'pick_entitlement')!;
const pickIdOf = (transfer: ReturnType<typeof pickTransferOf>) =>
  (transfer.asset as { pickId: string }).pickId;

async function tradeState(ws: Workspace, transactionId: string) {
  return {
    versions: await count(ws, 'outcome_event_version WHERE event_id=$1', [transactionId]),
    assets: await count(
      ws,
      `outcome_event_asset asset JOIN outcome_event_version version USING(event_version_id)
        WHERE version.event_id=$1`,
      [transactionId]
    ),
  };
}

describe('repairing promoted pick identity (migration 0274)', () => {
  it('reads each current trade with its promoted pick ids and each canonical custody row with its facts', async () => {
    const ws = await workspace();
    const seeded = await seed(ws);
    expect(seeded.promotion).toMatchObject({
      transactionCount: 1,
      transferCount: 2,
      pickCustodyCount: 1,
    });
    const trade = seeded.candidate.content.transactions[0]!;
    const pickTransfer = pickTransferOf(seeded);
    const custody = seeded.candidate.content.pickCustody[0]!;
    const reader = new PostgresAflTradePromotedDraftSelectionReader(
      createPgAflOutcomeSqlClient(ws.pool)
    );
    expect(await reader.loadCurrentCanonicalTransactions('AFLM')).toEqual([
      {
        transactionId: trade.transactionId,
        transferIds: [...trade.transferIds].sort(),
        reviewedLineage: false,
        transferPickIds: [{ transferId: pickTransfer.transferId, pickId: pickIdOf(pickTransfer) }],
        transferPlayerIds: [
          {
            transferId: seeded.candidate.content.transfers.find(
              ({ asset }) => asset.kind === 'player'
            )!.transferId,
            playerId: 'synthetic-acquisition-player',
          },
        ],
      },
    ]);
    expect(await reader.loadCurrentCanonicalPickCustody('AFLM')).toEqual([
      {
        custodyId: custody.custodyId,
        pickId: custody.pickId,
        observedAt: '2024-10-15T00:00:00.000Z',
        observedDate: null,
        draftSeasonYear: 2025,
        draftKind: 'national_draft',
        recordedRound: 1,
        recordedPick: null,
        originalClubId: 'club-western-bulldogs',
        currentClubId: 'club-gws',
        predecessorCustodyId: null,
      },
    ]);
    expect(await reader.loadCurrentCanonicalPickCustody('VFL')).toEqual([]);
  }, 300_000);

  it('leaves an unchanged promoted trade and its identical custody to the earlier promotion', async () => {
    const ws = await workspace();
    const seeded = await seed(ws);
    const trade = seeded.candidate.content.transactions[0]!;
    const custodyId = seeded.candidate.content.pickCustody[0]!.custodyId;
    const before = await tradeState(ws, trade.transactionId);
    expect(before).toEqual({ versions: 1, assets: 2 });
    const custodyRow = async () =>
      (
        await ws.pool.query(
          `SELECT source_import_row_id,recorded_at FROM outcome_pick_custody_observation
            WHERE custody_observation_id=$1`,
          [custodyId]
        )
      ).rows;
    const custodyBefore = await custodyRow();
    expect(custodyBefore).toHaveLength(1);

    const deferred = await again(ws, 'again');
    const deferredIssueCount = deferred.candidate.content.issues.length;
    expect(deferred.candidate.content.pickCustody.map(({ custodyId: id }) => id)).toEqual([
      custodyId,
    ]);
    expect(deferred.candidate.content.pickLineageDeferral).toEqual({
      decisionId: deferred.deferralDecisionId,
      promotedTransactions: [trade.transactionId],
      promotedCustodyIds: [custodyId],
    });
    expect(deferred.promotion.pickLineageDeferral).toEqual({
      decisionId: deferred.deferralDecisionId,
      deferredIssueCount,
      promotedTransactionCount: 1,
      promotedTransactionIds: [trade.transactionId],
      promotedCustodyCount: 1,
    });
    // Only the second trade is written: no trade version, asset or custody of the first.
    expect(deferred.promotion).toMatchObject({
      transactionCount: 1,
      transferCount: 1,
      pickCustodyCount: 0,
      pickRealizationCount: 0,
    });
    expect(await tradeState(ws, trade.transactionId)).toEqual(before);
    expect(await count(ws, 'outcome_pick_custody_observation')).toBe(1);
    expect(await custodyRow()).toEqual(custodyBefore);
    const stored = await ws.pool.query<{
      unusable: number;
      transactions: boolean;
      custody: boolean;
    }>(
      `SELECT outcome_external_candidate_unusable_record_count($1) AS unusable,
              outcome_external_candidate_promoted_transactions_current(candidate_json) AS transactions,
              outcome_external_candidate_promoted_custody_current(candidate_json) AS custody
         FROM outcome_external_reconciliation_candidate WHERE candidate_id=$1`,
      [deferred.candidate.candidateId]
    );
    expect(stored.rows).toEqual([{ unusable: 0, transactions: true, custody: true }]);
  }, 300_000);

  // The genuine repair: the order pages were re-captured, so the candidate states every promoted
  // custody observation under a new custody id. Written, each would collide with its canonical row on
  // `outcome_pick_custody_observation_key` (23505); matched by observation it is left unwritten.
  it('writes a superseding version of a trade whose pick was re-keyed, and leaves its re-captured custody', async () => {
    const ws = await workspace();
    const seeded = await seed(ws);
    const trade = seeded.candidate.content.transactions[0]!;
    const custodyId = seeded.candidate.content.pickCustody[0]!.custodyId;
    const oldPickId = pickIdOf(pickTransferOf(seeded));

    const deferred = await again(ws, 'rekeyed', { rekeyed: true, recaptured: true });
    const recapturedId = deferred.candidate.content.pickCustody[0]!.custodyId;
    expect(recapturedId).not.toBe(custodyId);
    const rekeyedTransfer = deferred.candidate.content.transfers.find(
      ({ asset }) => asset.kind === 'pick_entitlement'
    )!;
    const newPickId = pickIdOf(rekeyedTransfer);
    expect(rekeyedTransfer.transferId).toBe(pickTransferOf(seeded).transferId);
    expect(newPickId).not.toBe(oldPickId);
    // The trade is not left to the seed: its pick id changed. Its custody observation is, under
    // the candidate's own custody id.
    expect(deferred.candidate.content.pickLineageDeferral).toEqual({
      decisionId: deferred.deferralDecisionId,
      promotedCustodyIds: [recapturedId],
    });
    expect(deferred.promotion.pickLineageDeferral).toEqual({
      decisionId: deferred.deferralDecisionId,
      deferredIssueCount: deferred.candidate.content.issues.length,
      promotedCustodyCount: 1,
    });
    expect(deferred.promotion).toMatchObject({
      transactionCount: 2,
      transferCount: 3,
      pickCustodyCount: 0,
      pickRealizationCount: 0,
    });
    // A second version of the trade supersedes the seed's, carrying the new pick id.
    const versions = await ws.pool.query<{
      version: number;
      superseded: boolean;
      pick_ids: string[];
    }>(
      `SELECT version.version,
              EXISTS (SELECT 1 FROM outcome_event_version successor
                       WHERE successor.supersedes_version_id=version.event_version_id) AS superseded,
              ARRAY(SELECT asset.pick_id FROM outcome_event_asset asset
                     WHERE asset.event_version_id=version.event_version_id AND asset.pick_id IS NOT NULL
                     ORDER BY asset.pick_id) AS pick_ids
         FROM outcome_event_version version WHERE version.event_id=$1 ORDER BY version.version`,
      [trade.transactionId]
    );
    expect(versions.rows).toEqual([
      { version: 1, superseded: true, pick_ids: [oldPickId] },
      { version: 2, superseded: false, pick_ids: [newPickId] },
    ]);
    const reader = new PostgresAflTradePromotedDraftSelectionReader(
      createPgAflOutcomeSqlClient(ws.pool)
    );
    expect(
      (await reader.loadCurrentCanonicalTransactions('AFLM')).find(
        ({ transactionId }) => transactionId === trade.transactionId
      )?.transferPickIds
    ).toEqual([{ transferId: rekeyedTransfer.transferId, pickId: newPickId }]);
    // The custody observation is still the seed's one row; the re-captured id was never written.
    expect(await count(ws, 'outcome_pick_custody_observation')).toBe(1);
    expect(
      await count(ws, 'outcome_pick_custody_observation WHERE custody_observation_id=$1', [
        custodyId,
      ])
    ).toBe(1);
    expect(
      await count(
        ws,
        `outcome_external_canonical_promotion_record
          WHERE promotion_id=$1 AND record_kind='pick_custody'`,
        [deferred.promotion.promotionId]
      )
    ).toBe(0);
  }, 300_000);

  it('refuses a candidate that records custody nobody promoted', async () => {
    const ws = await workspace();
    await expect(
      again(ws, 'unpromoted-custody', { sameTrade: false, custodyAlreadyPromoted: true })
    ).rejects.toThrow(/must be canonical with the candidate's facts/);
    expect(await count(ws, 'outcome_external_reconciliation_candidate')).toBe(0);
  }, 300_000);

  it('holds a listed trade to its promoted pick ids and listed custody to its canonical facts', async () => {
    const ws = await workspace();
    const seeded = await seed(ws);
    const { content } = seeded.candidate;
    const trade = content.transactions[0]!;
    const custody = content.pickCustody[0]!;
    const pickTransfer = pickTransferOf(seeded);
    const transactionsCurrent = async (transfers: unknown) =>
      (
        await ws.pool.query<{ current: boolean }>(
          'SELECT outcome_external_candidate_promoted_transactions_current($1::jsonb) AS current',
          [
            JSON.stringify({
              content: {
                competition: 'AFLM',
                transactions: [trade],
                transfers,
                pickLineageDeferral: { promotedTransactions: [trade.transactionId] },
              },
            }),
          ]
        )
      ).rows[0]!.current;
    expect(await transactionsCurrent(content.transfers)).toBe(true);
    expect(
      await transactionsCurrent(
        content.transfers.map((transfer) =>
          transfer.transferId === pickTransfer.transferId
            ? { ...transfer, asset: { ...transfer.asset, pickId: `draft-pick:${'0'.repeat(64)}` } }
            : transfer
        )
      )
    ).toBe(false);
    // A listed trade's transfer the candidate does not hold is refused too.
    expect(
      await transactionsCurrent(
        content.transfers.filter(({ transferId }) => transferId !== pickTransfer.transferId)
      )
    ).toBe(false);

    const custodyCurrent = async (
      row: object,
      listed: unknown = [custody.custodyId],
      competition = 'AFLM'
    ) =>
      (
        await ws.pool.query<{ current: boolean }>(
          'SELECT outcome_external_candidate_promoted_custody_current($1::jsonb) AS current',
          [
            JSON.stringify({
              content: {
                competition,
                pickCustody: [row],
                pickLineageDeferral: { promotedCustodyIds: listed },
              },
            }),
          ]
        )
      ).rows[0]!.current;
    expect(await custodyCurrent(custody)).toBe(true);
    // The same instant with an offset is the same observation.
    expect(await custodyCurrent({ ...custody, observedAt: '2024-10-15T10:00:00.000+10:00' })).toBe(
      true
    );
    for (const changed of [
      { pickId: `draft-pick:${'1'.repeat(64)}` },
      { observedAt: '2024-10-16T00:00:00.000Z' },
      { observedAt: { precision: 'year', year: 2024 } },
      { draftYear: 2026 },
      { draftType: 'rookie' },
      { roundNumber: 2 },
      { recordedPickNumber: 14 },
      { originalClubId: 'club-gws' },
      { currentClubId: 'club-western-bulldogs' },
      { predecessorCustodyId: `external-pick-custody:${'2'.repeat(64)}` },
      { status: 'unresolved' },
      { draftYear: 'not a year' },
    ]) {
      expect(await custodyCurrent({ ...custody, ...changed })).toBe(false);
    }
    // An id that is not canonical, a canonical id the candidate does not hold, another competition,
    // and an empty list are all refused; no list is valid.
    // A re-captured row (new custody id, same observation and facts) is canonical; the same new id
    // with an observation nobody promoted is not, nor is a listed id the candidate does not hold.
    const unknown = `external-pick-custody:${'3'.repeat(64)}`;
    expect(await custodyCurrent({ ...custody, custodyId: unknown }, [unknown])).toBe(true);
    expect(
      await custodyCurrent(
        { ...custody, custodyId: unknown, observedAt: '2024-10-17T00:00:00.000Z' },
        [unknown]
      )
    ).toBe(false);
    expect(
      await custodyCurrent(
        { ...custody, custodyId: unknown, predecessorCustodyId: custody.custodyId },
        [unknown]
      )
    ).toBe(false);
    expect(await custodyCurrent({ ...custody, custodyId: unknown })).toBe(false);
    expect(await custodyCurrent(custody, undefined, 'VFL')).toBe(false);
    expect(await custodyCurrent(custody, [])).toBe(false);
    const absent = await ws.pool.query<{ current: boolean }>(
      'SELECT outcome_external_candidate_promoted_custody_current($1::jsonb) AS current',
      [JSON.stringify({ content: { competition: 'AFLM', pickCustody: [custody] } })]
    );
    expect(absent.rows).toEqual([{ current: true }]);
  }, 300_000);
});
