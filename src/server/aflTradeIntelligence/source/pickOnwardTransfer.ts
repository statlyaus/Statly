/**
 * Where a received pick went next: the transfers of the same pick id that its receiving club made in
 * a later trade (issues 789 and 867). One rule, shared by the reconciler (a stated "not used" hop the
 * candidate shows traded on), the candidate contract (which checks that record) and the realized
 * grader (which follows a traded-on pick into its onward trade), so all three always agree.
 */
export interface AflTradeOnwardTransaction {
  transactionId: string;
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

/** True when `later` cannot have happened before `earlier`. */
export function aflTradeTransactionNotBefore(
  later: AflTradeOnwardTransaction,
  earlier: AflTradeOnwardTransaction
) {
  if (later.seasonYear !== earlier.seasonYear) return later.seasonYear > earlier.seasonYear;
  if (later.occurredOn && earlier.occurredOn) return later.occurredOn > earlier.occurredOn;
  return true;
}

// A transfer with an unknown club cannot chain, so it is never on a trail or an onward transfer.
const pickIdOf = (transfer: AflTradeOnwardTransfer) =>
  transfer.asset.kind === 'pick_entitlement' &&
  transfer.fromClubId !== null &&
  transfer.toClubId !== null
    ? (transfer.asset.pickId ?? null)
    : null;

/**
 * Returns, for a pick transfer, the onward transfers the rule finds among the transfers whose
 * transaction is in `transactions` and whose clubs are known. A pick's transfers form a directed trail, each handing it from
 * sender to receiver. When exactly one ordering uses every transfer once, chains club to club and
 * keeps consecutive trades in time order, the onward transfer is the next edge on it (none after the
 * last). Otherwise the onward transfers are those in which the receiving club gave the same pick
 * away in another trade no earlier than this one. A caller that links needs exactly one.
 */
export function createAflTradePickOnwardTransfers<Transfer extends AflTradeOnwardTransfer>(
  transactions: ReadonlyMap<string, AflTradeOnwardTransaction>,
  transfers: readonly Transfer[]
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
      transactions.get(earlier.transactionId)!
    );
  const trails = new Map<string, Map<string, Transfer[]> | undefined>();
  function onwardByTrail(pickId: string, transfer: Transfer): Transfer[] | undefined {
    if (!trails.has(pickId)) {
      const edges = byPick.get(pickId) ?? [];
      const found: Transfer[][] = [];
      const walk = (trail: Transfer[], used: Set<string>) => {
        if (found.length > 1) return;
        if (trail.length === edges.length) return void found.push([...trail]);
        const last = trail.at(-1)!;
        for (const next of edges)
          if (
            !used.has(next.transferId) &&
            next.fromClubId === last.toClubId &&
            notBefore(next, last)
          ) {
            used.add(next.transferId);
            walk([...trail, next], used);
            used.delete(next.transferId);
          }
      };
      for (const first of edges) walk([first], new Set([first.transferId]));
      trails.set(
        pickId,
        found.length === 1
          ? new Map(found[0]!.map((edge, at) => [edge.transferId, found[0]!.slice(at + 1, at + 2)]))
          : undefined
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
