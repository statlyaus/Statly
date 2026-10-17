import {
  aflTradePickCustodyHolders,
  aflTradePickTradeSequence,
  createAflTradePickOnwardTransfers,
} from '../source/pickOnwardTransfer';
import type { AflTradeAssetLedgerPickHop } from './assetLedgerContracts';
import type { AflTradeRealizedTradeGradeInputs } from './realizedTradeGrade';

type Candidate = AflTradeRealizedTradeGradeInputs['candidate'];
type Transaction = Candidate['transactions'][number];
type Transfer = Candidate['transfers'][number];

/** A pick's identity fields, as the candidate's custody, transfers and selections record them. */
export interface AflTradeAssetLedgerPickIdentity {
  pickId: string;
  draftYear: number;
  draftType: string;
  round: number | null;
  originalClubId: string | null;
}

/**
 * Every draft-pick id the candidate records, with its identity fields. Each field comes from the first
 * source that states it: the Official AFL custody rows, then the traded entitlement, then the
 * selection. Ids are never merged: pick-identity repairs are reviewed operations, not read-path ones.
 */
export function aflTradeAssetLedgerPickIdentities(
  candidate: Candidate
): Map<string, AflTradeAssetLedgerPickIdentity> {
  const sources: AflTradeAssetLedgerPickIdentity[] = [
    ...(candidate.pickCustody ?? []).map((row) => ({
      pickId: row.pickId,
      draftYear: row.draftYear,
      draftType: row.draftType,
      round: row.roundNumber,
      originalClubId: row.originalClubId,
    })),
    ...candidate.transfers.flatMap(({ asset }) =>
      asset.kind === 'pick_entitlement'
        ? [
            {
              pickId: asset.pickId,
              draftYear: asset.draftYear,
              draftType: asset.draftType,
              round: asset.nominalRound,
              originalClubId: asset.originalClubId,
            },
          ]
        : []
    ),
    ...(candidate.draftSelections ?? []).map((row) => ({
      pickId: row.pickId,
      draftYear: row.draftYear,
      draftType: row.draftType,
      round: row.roundNumber,
      originalClubId: null,
    })),
  ];
  const identities = new Map<string, AflTradeAssetLedgerPickIdentity>();
  for (const source of sources) {
    const known = identities.get(source.pickId);
    if (!known) identities.set(source.pickId, { ...source });
    else {
      known.round ??= source.round;
      known.originalClubId ??= source.originalClubId;
    }
  }
  return identities;
}

const toHop = (transfer: Transfer, transaction: Transaction): AflTradeAssetLedgerPickHop => ({
  transactionId: transfer.transactionId,
  transferId: transfer.transferId,
  seasonYear: transaction.seasonYear,
  fromClubId: transfer.fromClubId!,
  toClubId: transfer.toClubId!,
});

/** Season, then Draftguru pick-trade sequence, then date, then trade id: a stable fallback order. */
function compareUnordered(
  left: AflTradeAssetLedgerPickHop,
  right: AflTradeAssetLedgerPickHop,
  trades: ReadonlyMap<string, Transaction>
): number {
  const a = trades.get(left.transactionId)!;
  const b = trades.get(right.transactionId)!;
  if (a.seasonYear !== b.seasonYear) return a.seasonYear - b.seasonYear;
  const sequence =
    (aflTradePickTradeSequence(a) ?? Infinity) - (aflTradePickTradeSequence(b) ?? Infinity);
  if (sequence) return sequence;
  const date = (a.occurredOn ?? '').localeCompare(b.occurredOn ?? '');
  if (date) return date;
  return left.transferId < right.transferId ? -1 : left.transferId > right.transferId ? 1 : 0;
}

/** The pick's transfers as one trail, when each hop's onward transfer is unique and they chain. */
function trailOf(
  transfers: readonly Transfer[],
  onwardOf: (transfer: Transfer) => Transfer[]
): Transfer[] | undefined {
  const next = new Map<string, Transfer>();
  for (const transfer of transfers) {
    const onward = onwardOf(transfer);
    if (onward.length > 1) return undefined;
    if (onward.length === 1) next.set(transfer.transferId, onward[0]!);
  }
  const followed = new Set([...next.values()].map(({ transferId }) => transferId));
  const starts = transfers.filter(({ transferId }) => !followed.has(transferId));
  if (starts.length !== 1) return undefined;
  const trail = [starts[0]!];
  while (next.has(trail.at(-1)!.transferId) && trail.length <= transfers.length)
    trail.push(next.get(trail.at(-1)!.transferId)!);
  return trail.length === transfers.length ? trail : undefined;
}

export interface AflTradeAssetLedgerPickTrail {
  hopOrder: 'trail' | 'unordered';
  hops: AflTradeAssetLedgerPickHop[];
}

/**
 * Each pick's trades, by pick id. Only trades with both clubs known count, as for the grader. The
 * order is the grader's onward-transfer trail (`createAflTradePickOnwardTransfers`, with the latest
 * custody holder as tie-break) when that gives one trail through every hop.
 */
export function aflTradeAssetLedgerPickTrails(
  candidate: Candidate
): Map<string, AflTradeAssetLedgerPickTrail> {
  const trades = new Map(
    candidate.transactions
      .filter(({ transactionType }) => transactionType === 'trade')
      .map((transaction) => [transaction.transactionId, transaction])
  );
  const pickTransfers = candidate.transfers.filter(
    (transfer) =>
      transfer.asset.kind === 'pick_entitlement' &&
      trades.has(transfer.transactionId) &&
      transfer.fromClubId !== null &&
      transfer.toClubId !== null
  );
  const onwardOf = createAflTradePickOnwardTransfers(trades, pickTransfers, {
    custodyHolders: aflTradePickCustodyHolders(candidate.pickCustody ?? []),
  });
  const byPick = new Map<string, Transfer[]>();
  for (const transfer of pickTransfers) {
    const pickId = (transfer.asset as { pickId: string }).pickId;
    byPick.set(pickId, [...(byPick.get(pickId) ?? []), transfer]);
  }
  const trails = new Map<string, AflTradeAssetLedgerPickTrail>();
  for (const [pickId, transfers] of byPick) {
    const trail = trailOf(transfers, onwardOf);
    const hops = (trail ?? transfers).map((transfer) =>
      toHop(transfer, trades.get(transfer.transactionId)!)
    );
    if (!trail) hops.sort((left, right) => compareUnordered(left, right, trades));
    trails.set(pickId, { hopOrder: trail ? 'trail' : 'unordered', hops });
  }
  return trails;
}
