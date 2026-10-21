import {
  aflTradePickCustodyHolders,
  aflTradePickTradeSequence,
  createAflTradePickOnwardTransfers,
} from '../source/pickOnwardTransfer';
import type {
  AflTradeAssetLedgerPickHop,
  AflTradeAssetLedgerPickIdentityField,
} from './assetLedgerContracts';
import type { AflTradeGradingInputs } from './gradingInputs';
import { partitionAflTradeTrades } from './tradeStructure';

type Candidate = AflTradeGradingInputs['candidate'];
type Transaction = Candidate['transactions'][number];
type Transfer = Candidate['transfers'][number];

/** A pick's identity fields, as the candidate's custody, transfers and selections record them. */
export interface AflTradeAssetLedgerPickIdentity {
  pickId: string;
  draftYear: number;
  draftType: string;
  round: number | null;
  originalClubId: string | null;
  identityDisagreements: AflTradeAssetLedgerPickIdentityField[];
}

type IdentitySource = Omit<AflTradeAssetLedgerPickIdentity, 'identityDisagreements'>;
const IDENTITY_FIELDS: AflTradeAssetLedgerPickIdentityField[] = [
  'draftYear',
  'draftType',
  'round',
  'originalClubId',
];

function identitySources(candidate: Candidate): IdentitySource[] {
  return [
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
}

/** Takes each field the known identity lacks, and records each field two sources state differently. */
function mergeIdentity(known: AflTradeAssetLedgerPickIdentity, source: IdentitySource) {
  for (const field of IDENTITY_FIELDS) {
    const value = source[field];
    if (value === null) continue;
    if (known[field] === null) (known as unknown as Record<string, unknown>)[field] = value;
    else if (known[field] !== value && !known.identityDisagreements.includes(field))
      known.identityDisagreements.push(field);
  }
}

/**
 * Every draft-pick id the candidate records, with its identity fields. Each field comes from the first
 * source that states it: the Official AFL custody rows, then the traded entitlement, then the
 * selection; a field the sources state differently is listed, never silently resolved. Ids are never
 * merged: pick-identity repairs are reviewed operations, not read-path ones.
 */
export function aflTradeAssetLedgerPickIdentities(
  candidate: Candidate
): Map<string, AflTradeAssetLedgerPickIdentity> {
  const identities = new Map<string, AflTradeAssetLedgerPickIdentity>();
  for (const source of identitySources(candidate)) {
    const known = identities.get(source.pickId);
    if (!known) identities.set(source.pickId, { ...source, identityDisagreements: [] });
    else mergeIdentity(known, source);
  }
  for (const identity of identities.values())
    identity.identityDisagreements.sort(
      (left, right) => IDENTITY_FIELDS.indexOf(left) - IDENTITY_FIELDS.indexOf(right)
    );
  return identities;
}

const toHop = (transfer: Transfer, transaction: Transaction): AflTradeAssetLedgerPickHop => ({
  transactionId: transfer.transactionId,
  transferId: transfer.transferId,
  seasonYear: transaction.seasonYear,
  fromClubId: transfer.fromClubId,
  toClubId: transfer.toClubId,
});

const byCodeUnit = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

/** Season, then Draftguru pick-trade sequence, then date, then transfer id: a stable fallback order. */
function compareUnordered(
  left: AflTradeAssetLedgerPickHop,
  right: AflTradeAssetLedgerPickHop,
  trades: ReadonlyMap<string, Transaction>
): number {
  const a = trades.get(left.transactionId)!;
  const b = trades.get(right.transactionId)!;
  if (a.seasonYear !== b.seasonYear) return a.seasonYear - b.seasonYear;
  const sequenceA = aflTradePickTradeSequence(a);
  const sequenceB = aflTradePickTradeSequence(b);
  if (sequenceA !== sequenceB)
    return sequenceA === null ? 1 : sequenceB === null ? -1 : sequenceA - sequenceB;
  const date = byCodeUnit(a.occurredOn ?? '', b.occurredOn ?? '');
  return date || byCodeUnit(left.transferId, right.transferId);
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

/** The pick transfers of every trade, by pick id, including any with an unresolved club. */
function pickTransfersByPick(candidate: Candidate, trades: ReadonlyMap<string, Transaction>) {
  const byPick = new Map<string, Transfer[]>();
  for (const transfer of candidate.transfers) {
    if (transfer.asset.kind !== 'pick_entitlement' || !trades.has(transfer.transactionId)) continue;
    const pickId = transfer.asset.pickId;
    byPick.set(pickId, [...(byPick.get(pickId) ?? []), transfer]);
  }
  return byPick;
}

/**
 * Each pick's trades, by pick id. Every trade hop is listed, even one whose club the candidate could
 * not resolve. The order is the trade structure's onward-transfer trail (`createAflTradePickOnwardTransfers`
 * over its graded trades, with the latest custody holder as tie-break) when that gives one trail
 * through every hop; a hop in a trade the structure does not hold never joins one.
 */
export function aflTradeAssetLedgerPickTrails(
  inputs: AflTradeGradingInputs
): Map<string, AflTradeAssetLedgerPickTrail> {
  const { candidate } = inputs;
  const trades = new Map(
    candidate.transactions
      .filter(({ transactionType }) => transactionType === 'trade')
      .map((transaction) => [transaction.transactionId, transaction])
  );
  const transfersByTransaction = new Map<string, Transfer[]>();
  for (const transfer of candidate.transfers)
    transfersByTransaction.set(transfer.transactionId, [
      ...(transfersByTransaction.get(transfer.transactionId) ?? []),
      transfer,
    ]);
  const graded = partitionAflTradeTrades(inputs, transfersByTransaction).transactions;
  const onwardOf = createAflTradePickOnwardTransfers(graded, candidate.transfers, {
    custodyHolders: aflTradePickCustodyHolders(candidate.pickCustody ?? []),
  });
  const trails = new Map<string, AflTradeAssetLedgerPickTrail>();
  for (const [pickId, transfers] of pickTransfersByPick(candidate, trades)) {
    const trail = trailOf(transfers, onwardOf);
    const hops = (trail ?? transfers).map((transfer) =>
      toHop(transfer, trades.get(transfer.transactionId)!)
    );
    if (!trail) hops.sort((left, right) => compareUnordered(left, right, trades));
    trails.set(pickId, { hopOrder: trail ? 'trail' : 'unordered', hops });
  }
  return trails;
}
