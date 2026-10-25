import { latestPickCustodyObservation } from '../source/pickCustodyDate';
import { isAflTradeUsableCustodyStatus } from '../source/pickLineageDeferral';
import { aflTradeTransactionNotBefore } from '../source/pickOnwardTransfer';
import type {
  AflTradeAssetLedger,
  AflTradeAssetLedgerNotUsedFate,
  AflTradeAssetLedgerPickOutcome,
  AflTradeAssetLedgerStatedPickOutcome,
} from './assetLedgerContracts';
import type { AflTradeAssetLedgerPickTrail } from './assetLedgerPickHops';
import type { AflTradeGradingInputs } from './gradingInputs';
import { aflTradePickLatestOrderNumber, type AflTradePickCustody } from './pickSlots';
import type { AflTradeStructurePickRelay } from './tradeStructure';

/**
 * What a stated not-used pick is (statlyaus/Statly#1050; owner, 2026-10-25: "Yes, both" to rules R1
 * and R2, after the 24 Oct review found 109 traded pick ids valued 0 as plain "not used"). Draftguru
 * says "not used" alike of a pick its holder traded on on draft night under a new pick id, of a pick
 * consumed matching a bid at a shifted number, and of a pick that lapsed at the draft's end. R1 follows
 * the first on; R2 keeps the second pending instead of 0. Numbers alone never join: a relay needs the
 * same draft, the same stated number, the holder as the next sender, the order of trades and
 * uniqueness both ways.
 */

type Candidate = AflTradeGradingInputs['candidate'];
type Transaction = Candidate['transactions'][number];
type Transfer = Candidate['transfers'][number];
type PickAsset = Extract<Transfer['asset'], { kind: 'pick_entitlement' }>;

/** R2: a not-used pick within this many of the draft's last selection lapsed with the draft. */
export const AFL_TRADE_NOT_USED_LATE_WINDOW = 12;

/** One ledger pick with its trail and the outcome the evidence states. */
export interface AflTradeAssetLedgerNotUsedRow {
  readonly pickId: string;
  readonly draftYear: number;
  readonly draftType: string;
  readonly trail: AflTradeAssetLedgerPickTrail;
  readonly outcome: AflTradeAssetLedgerStatedPickOutcome;
}

interface Hop {
  pickId: string;
  asset: PickAsset;
  transfer: Transfer;
  transaction: Transaction;
  number: number;
}

const draftKey = (asset: PickAsset, number: number, clubId: string) =>
  `${asset.draftYear}|${asset.draftType}|${number}|${clubId}`;

/**
 * The first or last hop of a pick's ordered trail, with the number that trade states. An unordered
 * trail has no first or last hop, and a hop with an unresolved club is none. A last hop that states no
 * number (a round-only future pick) takes the pick's latest Official AFL order number under its own id
 * (R1 by order; owner, 2026-10-25); a first hop must state its number.
 */
function hopAt(
  row: AflTradeAssetLedgerNotUsedRow,
  at: 0 | -1,
  transfers: ReadonlyMap<string, Transfer>,
  transactions: ReadonlyMap<string, Transaction>,
  custody: readonly AflTradePickCustody[]
): Hop | undefined {
  if (row.trail.hopOrder !== 'trail') return undefined;
  const hop = row.trail.hops.at(at);
  const transfer = hop && transfers.get(hop.transferId);
  const transaction = hop && transactions.get(hop.transactionId);
  const asset = transfer?.asset;
  if (!transfer || !transaction || asset?.kind !== 'pick_entitlement') return undefined;
  if (transfer.fromClubId === null || transfer.toClubId === null) return undefined;
  const number =
    asset.nominalPick ?? (at === -1 ? aflTradePickLatestOrderNumber(custody, asset) : null);
  if (number === null) return undefined;
  return { pickId: row.pickId, asset, transfer, transaction, number };
}

interface Relay {
  toPickId: string;
  transactionId: string;
  transferId: string;
  selectionNumber: number;
}

/**
 * Rule R1: a not-used pick A relays to pick B when B's first trade hands the same draft's same stated
 * number from A's last holder to another club, in a different trade no earlier than A's last, and B
 * is the only such pick for A and A the only such pick for B.
 */
function relaysOf(
  rows: readonly AflTradeAssetLedgerNotUsedRow[],
  transfers: ReadonlyMap<string, Transfer>,
  transactions: ReadonlyMap<string, Transaction>,
  custody: readonly AflTradePickCustody[]
): Map<string, Relay> {
  const firstHops = new Map<string, Hop[]>();
  for (const row of rows) {
    const hop = hopAt(row, 0, transfers, transactions, custody);
    if (!hop) continue;
    const key = draftKey(hop.asset, hop.number, hop.transfer.fromClubId!);
    firstHops.set(key, [...(firstHops.get(key) ?? []), hop]);
  }
  const tentative = new Map<string, Relay>();
  const sources = new Map<string, number>();
  for (const row of rows) {
    if (row.outcome.kind !== 'not_used') continue;
    const last = hopAt(row, -1, transfers, transactions, custody);
    if (!last) continue;
    const next = (
      firstHops.get(draftKey(last.asset, last.number, last.transfer.toClubId!)) ?? []
    ).filter(
      (hop) =>
        hop.pickId !== row.pickId &&
        hop.transaction.transactionId !== last.transaction.transactionId &&
        aflTradeTransactionNotBefore(hop.transaction, last.transaction)
    );
    if (next.length !== 1) continue;
    const [hop] = next;
    tentative.set(row.pickId, {
      toPickId: hop!.pickId,
      transactionId: hop!.transaction.transactionId,
      transferId: hop!.transfer.transferId,
      selectionNumber: last.number,
    });
    sources.set(hop!.pickId, (sources.get(hop!.pickId) ?? 0) + 1);
  }
  return new Map([...tentative].filter(([, relay]) => sources.get(relay.toPickId) === 1));
}

/**
 * Each draft's last selection number in evidence, by `draftYear|draftType`. Every selection counts,
 * whatever its status: an unresolved status disputes which pick or player it was, not that it happened.
 */
function lastSelectionsOf(candidate: Candidate): Map<string, number> {
  const last = new Map<string, number>();
  for (const selection of candidate.draftSelections ?? []) {
    const key = `${selection.draftYear}|${selection.draftType}`;
    last.set(key, Math.max(last.get(key) ?? 0, selection.selectionNumber));
  }
  return last;
}

/**
 * Rule R2: where a not-used pick stood. Its latest usable Official AFL order number under its own pick
 * id, else the number its last trade stated (an unordered trail's hops must agree). Lapsed when it
 * states no number (a round-only future pick) or stood within the late window of the draft's last
 * selection; unknown otherwise, when the draft has no selection in evidence, or when its newest order
 * capture is unusable (older evidence never outranks it).
 */
function fateOf(
  candidate: Candidate,
  row: AflTradeAssetLedgerNotUsedRow,
  transfers: ReadonlyMap<string, Transfer>,
  lastSelections: ReadonlyMap<string, number>
): AflTradeAssetLedgerNotUsedFate {
  const order = latestPickCustodyObservation(
    (candidate.pickCustody ?? []).filter(
      (custody) =>
        custody.pickId === row.pickId &&
        custody.draftYear === row.draftYear &&
        custody.draftType === row.draftType
    )
  );
  const lastSelection = lastSelections.get(`${row.draftYear}|${row.draftType}`) ?? null;
  // A newer unusable order capture is never outranked by the older trade statement: unknown.
  if (order && !isAflTradeUsableCustodyStatus(order.status))
    return { fate: 'unknown', slot: null, lastSelection };
  // An ordered trail's last hop states the number; an unordered trail's hops must agree on it.
  const statedNumbers = new Set(
    (row.trail.hopOrder === 'trail' ? row.trail.hops.slice(-1) : row.trail.hops).map((hop) => {
      const asset = transfers.get(hop.transferId)?.asset;
      return asset?.kind === 'pick_entitlement' ? (asset.nominalPick ?? null) : null;
    })
  );
  if (row.trail.hopOrder !== 'trail' && statedNumbers.size > 1)
    return { fate: 'unknown', slot: null, lastSelection };
  const statedNumber = [...statedNumbers][0] ?? null;
  const slot: AflTradeAssetLedgerNotUsedFate['slot'] =
    order?.recordedPickNumber != null
      ? { selectionNumber: order.recordedPickNumber, source: 'order' }
      : statedNumber != null
        ? { selectionNumber: statedNumber, source: 'stated_at_trade' }
        : null;
  const fate =
    slot === null
      ? 'lapsed'
      : lastSelection === null
        ? 'unknown'
        : lastSelection - slot.selectionNumber <= AFL_TRADE_NOT_USED_LATE_WINDOW
          ? 'lapsed'
          : 'unknown';
  return { fate, slot, lastSelection };
}

/**
 * Settles every stated not-used pick: relayed (R1) to the pick its holder traded the number on as, else
 * not used with its fate (R2). Every other outcome is left as stated.
 */
export function aflTradeAssetLedgerSettleNotUsedPicks(
  candidate: Candidate,
  rows: readonly AflTradeAssetLedgerNotUsedRow[]
): Map<string, AflTradeAssetLedgerPickOutcome> {
  const transactions = new Map(
    candidate.transactions.map((transaction) => [transaction.transactionId, transaction])
  );
  const transfers = new Map(candidate.transfers.map((transfer) => [transfer.transferId, transfer]));
  const relays = relaysOf(rows, transfers, transactions, candidate.pickCustody ?? []);
  const lastSelections = lastSelectionsOf(candidate);
  const settled = new Map<string, AflTradeAssetLedgerPickOutcome>();
  for (const row of rows) {
    if (row.outcome.kind !== 'not_used') continue;
    const relay = relays.get(row.pickId);
    settled.set(
      row.pickId,
      relay
        ? {
            kind: 'relayed',
            pickId: relay.toPickId,
            transactionId: relay.transactionId,
            transferId: relay.transferId,
            selectionNumber: relay.selectionNumber,
          }
        : { ...row.outcome, ...fateOf(candidate, row, transfers, lastSelections) }
    );
  }
  return settled;
}

/** The relays a sealed ledger found, as the trade structure's `pickRelays` input. */
export function aflTradeAssetLedgerRelayLinks(
  ledger: AflTradeAssetLedger
): AflTradeStructurePickRelay[] {
  return ledger.content.picks.flatMap(({ hops, outcome }) =>
    outcome.kind === 'relayed'
      ? [
          {
            transferId: hops.at(-1)!.transferId,
            onwardTransactionId: outcome.transactionId,
            onwardTransferId: outcome.transferId,
            selectionNumber: outcome.selectionNumber,
          },
        ]
      : []
  );
}
