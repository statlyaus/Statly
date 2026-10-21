import { latestPickCustodyObservation, pickCustodyDateSchema } from './pickCustodyDate';
import { isAflTradeUsableCustodyStatus } from './pickLineageDeferral';
import type { z } from 'zod';

/**
 * Where a received pick went next: the transfers of the same pick id that its receiving club made in
 * a later trade (issues 789 and 867). One rule, shared by the reconciler (a stated "not used" hop the
 * candidate shows traded on), the candidate contract (which checks that record) and the trade
 * structure (which follows a traded-on pick into its onward trade), so all three always agree.
 */
export interface AflTradeOnwardTransaction {
  transactionId: string;
  /** The provider's event id. A Draftguru pick-only trade's id ends in its season sequence. */
  providerEventId: string;
  seasonYear: number;
  occurredOn: string | null;
}

export interface AflTradeOnwardTransfer {
  transferId: string;
  transactionId: string;
  fromClubId: string | null;
  toClubId: string | null;
  asset: { kind: string; pickId?: string };
}

/** One pick custody observation, as the candidate records it (the Official AFL indicative orders). */
export interface AflTradeOnwardCustody {
  pickId: string;
  observedAt: z.infer<typeof pickCustodyDateSchema>;
  currentClubId: string | null;
  status: string;
}

export interface AflTradePickOnwardOptions {
  /** Each pick's latest usable custody holder (`aflTradePickCustodyHolders`): a trail tie-break. */
  custodyHolders?: ReadonlyMap<string, string>;
  /**
   * The rule as #952 shipped it (2026-10-16): no Draftguru pick-trade sequence, no custody tie-break,
   * each trade checked against the one before it only. Only the candidate contract reads it, so a
   * candidate reconciled before the ordering rule still parses.
   */
  unordered?: boolean;
}

// `2019-picks-melbourne-north_melbourne-8`: a Draftguru pick-only trade, the 8th of its season.
const PICK_TRADE_SEQUENCE = /^(\d{4})-picks-.+-(\d+)$/;

/**
 * Issue 789 (coordinator decision 2026-10-16, under the owner's full permission): a Draftguru
 * pick-only trade's position in its season's trade period, from the numeric suffix of its event id.
 * The suffix is unique per season and agreed with the order of 87 of 87 consecutive numbered hops
 * and with the Official AFL custody snapshots, so it is an inferred ordering rule, not a dated fact.
 * Player trades carry none. Null when the id has no suffix or names another season.
 */
export function aflTradePickTradeSequence(
  transaction: Pick<AflTradeOnwardTransaction, 'providerEventId' | 'seasonYear'>
): number | null {
  const match = PICK_TRADE_SEQUENCE.exec(transaction.providerEventId);
  if (!match || Number(match[1]) !== transaction.seasonYear) return null;
  const sequence = Number(match[2]);
  return Number.isSafeInteger(sequence) && sequence > 0 ? sequence : null;
}

/**
 * True when `later` cannot have happened before `earlier`: a later season, else within one season a
 * higher Draftguru pick-trade sequence when both have one, else a later date when both have one.
 * Anything else in the same season is unordered, so either may come first.
 */
export function aflTradeTransactionNotBefore(
  later: AflTradeOnwardTransaction,
  earlier: AflTradeOnwardTransaction,
  { unordered = false }: Pick<AflTradePickOnwardOptions, 'unordered'> = {}
) {
  if (later.seasonYear !== earlier.seasonYear) return later.seasonYear > earlier.seasonYear;
  const laterSequence = unordered ? null : aflTradePickTradeSequence(later);
  const earlierSequence = unordered ? null : aflTradePickTradeSequence(earlier);
  if (laterSequence !== null && earlierSequence !== null) return laterSequence > earlierSequence;
  if (later.occurredOn && earlier.occurredOn) return later.occurredOn > earlier.occurredOn;
  return true;
}

/**
 * Each pick's latest custody holder: the club its one latest observation names, when that row is
 * usable. A newer unusable or overlapping observation gives no holder, so an older usable row never
 * outranks what is known later.
 */
export function aflTradePickCustodyHolders(
  pickCustody: readonly AflTradeOnwardCustody[]
): Map<string, string> {
  const byPick = new Map<string, AflTradeOnwardCustody[]>();
  for (const row of pickCustody) byPick.set(row.pickId, [...(byPick.get(row.pickId) ?? []), row]);
  const holders = new Map<string, string>();
  for (const [pickId, rows] of byPick) {
    const latest = latestPickCustodyObservation(rows);
    if (latest?.currentClubId && isAflTradeUsableCustodyStatus(latest.status))
      holders.set(pickId, latest.currentClubId);
  }
  return holders;
}

// A transfer with an unknown club cannot chain, so it is never on a trail or an onward transfer.
const pickIdOf = (transfer: AflTradeOnwardTransfer) =>
  transfer.asset.kind === 'pick_entitlement' &&
  transfer.fromClubId !== null &&
  transfer.toClubId !== null
    ? (transfer.asset.pickId ?? null)
    : null;

// More orderings than this is no answer: the pick stays ambiguous.
const MAX_TRAILS = 64;

/**
 * Returns, for a pick transfer, the onward transfers the rule finds among the transfers whose
 * transaction is in `transactions` and whose clubs are known. A pick's transfers form a directed
 * trail, each handing it from sender to receiver. A trail uses every transfer once, chains club to
 * club, and never puts a trade before one it cannot precede (`aflTradeTransactionNotBefore`, against
 * every earlier trade on the trail). When exactly one trail exists, or several do and exactly one ends
 * at the pick's latest custody holder, the onward transfer is the next edge on it (none after the
 * last). Otherwise the onward transfers are those in which the receiving club gave the same pick away
 * in another trade no earlier than this one. A caller that links needs exactly one.
 */
export function createAflTradePickOnwardTransfers<Transfer extends AflTradeOnwardTransfer>(
  transactions: ReadonlyMap<string, AflTradeOnwardTransaction>,
  transfers: readonly Transfer[],
  options: AflTradePickOnwardOptions = {}
): (transfer: Transfer) => Transfer[] {
  const byPick = new Map<string, Transfer[]>();
  for (const transfer of transfers) {
    const pickId = pickIdOf(transfer);
    if (pickId !== null && transactions.has(transfer.transactionId))
      byPick.set(pickId, [...(byPick.get(pickId) ?? []), transfer]);
  }
  const notBefore = (later: Transfer, earlier: Transfer) =>
    aflTradeTransactionNotBefore(
      transactions.get(later.transactionId)!,
      transactions.get(earlier.transactionId)!,
      options
    );
  const holders = options.unordered ? undefined : options.custodyHolders;
  const trails = new Map<string, Map<string, Transfer[]> | undefined>();
  function onwardByTrail(pickId: string, transfer: Transfer): Transfer[] | undefined {
    if (!trails.has(pickId)) {
      const edges = byPick.get(pickId) ?? [];
      const found: Transfer[][] = [];
      const walk = (trail: Transfer[], used: Set<string>) => {
        if (found.length > MAX_TRAILS) return;
        if (trail.length === edges.length) return void found.push([...trail]);
        const last = trail.at(-1)!;
        for (const next of edges)
          if (
            !used.has(next.transferId) &&
            next.fromClubId === last.toClubId &&
            (options.unordered
              ? notBefore(next, last)
              : trail.every((earlier) => notBefore(next, earlier)))
          ) {
            used.add(next.transferId);
            walk([...trail, next], used);
            used.delete(next.transferId);
          }
      };
      for (const first of edges) walk([first], new Set([first.transferId]));
      const holder = holders?.get(pickId);
      const atHolder =
        found.length > 1 && found.length <= MAX_TRAILS && holder !== undefined
          ? found.filter((trail) => trail.at(-1)!.toClubId === holder)
          : found;
      const trail = atHolder.length === 1 ? atHolder[0]! : undefined;
      trails.set(
        pickId,
        trail && new Map(trail.map((edge, at) => [edge.transferId, trail.slice(at + 1, at + 2)]))
      );
    }
    return trails.get(pickId)?.get(transfer.transferId);
  }
  return (transfer) => {
    const pickId = pickIdOf(transfer);
    if (pickId === null || !transactions.has(transfer.transactionId)) return [];
    return (
      onwardByTrail(pickId, transfer) ??
      (byPick.get(pickId) ?? []).filter(
        (candidate) =>
          candidate.fromClubId === transfer.toClubId &&
          candidate.transactionId !== transfer.transactionId &&
          notBefore(candidate, transfer)
      )
    );
  };
}
