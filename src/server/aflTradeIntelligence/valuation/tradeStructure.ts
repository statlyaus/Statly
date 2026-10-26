import type { AflTradeExternalReconciliationCandidateRecord } from '../source/externalReconciliationCandidateContracts';
import {
  aflTradePickCustodyHolders,
  aflTradeTransactionNotBefore,
  createAflTradePickOnwardTransfers,
} from '../source/pickOnwardTransfer';
import { aflTradePickLatestOrderNumber } from './pickSlots';
import {
  AFL_TRADE_STRUCTURE_LIMITATION,
  AFL_TRADE_STRUCTURE_SCHEMA_VERSION,
  createAflTradeStructure,
  type AflTradeStructure,
  type AflTradeStructureContent,
  type AflTradeStructureLeg,
  type AflTradeStructureOnwardLink,
} from './tradeStructureContracts';

type CandidateContent = AflTradeExternalReconciliationCandidateRecord['content'];
type Transaction = CandidateContent['transactions'][number];
type Transfer = CandidateContent['transfers'][number];
type PickOutcome = NonNullable<CandidateContent['pickOutcomes']>[number];
type Ungraded = AflTradeStructureContent['ungraded'][number];
type RawOnward =
  | { kind: 'special_entitlement_successor'; transfer: Transfer; entitlementId: string }
  | { kind: 'pick_trail'; transfer: Transfer }
  | { kind: 'pick_relay'; transfer: Transfer; selectionNumber: number }
  | { kind: 'pick_relay_reviewed'; transfer: Transfer };

/**
 * Rule R1 (statlyaus/Statly#1050): a stated not-used pick the asset ledger found relayed
 * (`aflTradeAssetLedgerRelayLinks`): its last transfer, and the transfer its holder traded the same
 * number on as under a new pick id. A `reviewed` row is an owner-reviewed relay: the number is not
 * checked, the clubs, draft, pick ids and trade order still are.
 */
export interface AflTradeStructurePickRelay {
  transferId: string;
  onwardTransactionId: string;
  onwardTransferId: string;
  /** The number both trades state; absent on a reviewed relay. */
  selectionNumber?: number;
  reviewed?: true;
}

/**
 * What the trade structure reads (value-line method step 5, issue 789). The grading inputs
 * (`gradingInputs.ts`) are assignable to it.
 */
export interface AflTradeStructureInputs {
  candidateId: string;
  /** `pickCustody` breaks a tie between pick trails; `draftBoardPicks` corroborates a trail's route. */
  candidate: Pick<CandidateContent, 'transactions' | 'transfers' | 'pickOutcomes'> &
    Partial<Pick<CandidateContent, 'draftBoardPicks' | 'pickCustody'>>;
  /**
   * Rule v7: the approved canonical special entitlement custody chain. Each row is one transfer of a
   * special draft entitlement; its successor is the row naming it as `predecessorTransferId`.
   */
  specialEntitlementCustody?: readonly {
    transferId: string;
    entitlementId: string;
    predecessorTransferId: string | null;
  }[];
  /** Rule R1: the not-used picks the asset ledger relays on; each is checked before it links. */
  pickRelays?: readonly AflTradeStructurePickRelay[];
}

// The structure's club id format (aflTradePublicIdSchema). A club it cannot name is unresolved.
const representableClub = (clubId: string | null): clubId is string =>
  !!clubId && clubId.length <= 160 && /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(clubId);

/**
 * The trades the structure holds, by transaction, and the trades it names instead: a trade with no
 * transfers, or one with a club it cannot represent, is named, never dropped.
 */
export function partitionAflTradeTrades(
  inputs: Pick<AflTradeStructureInputs, 'candidate'>,
  transfersByTransaction: ReadonlyMap<string, Transfer[]>
) {
  const ungraded: Ungraded[] = [];
  const transactions = new Map<string, Transaction>();
  for (const transaction of inputs.candidate.transactions) {
    if (transaction.transactionType !== 'trade') continue;
    const transfers = transfersByTransaction.get(transaction.transactionId) ?? [];
    if (transfers.length === 0)
      ungraded.push({ transactionId: transaction.transactionId, reason: 'no_transfers' });
    else if (
      transfers.some(
        ({ fromClubId, toClubId }) =>
          !representableClub(fromClubId) || !representableClub(toClubId) || fromClubId === toClubId
      )
    )
      ungraded.push({ transactionId: transaction.transactionId, reason: 'club_unresolved' });
    else transactions.set(transaction.transactionId, transaction);
  }
  return { ungraded, transactions };
}

/** Rule v7: links a special entitlement to the transfer its reviewed custody chain names next. */
function createSpecialEntitlementLink(
  inputs: AflTradeStructureInputs,
  transactions: ReadonlyMap<string, Transaction>
) {
  // Rule v7: a special entitlement's reviewed custody chain, keyed by transfer and by predecessor.
  const custodyRows = inputs.specialEntitlementCustody ?? [];
  const specialCustody = new Map(custodyRows.map((row) => [row.transferId, row]));
  const successorOf = new Map(
    custodyRows.flatMap((row) =>
      row.predecessorTransferId === null ? [] : [[row.predecessorTransferId, row] as const]
    )
  );
  const transfersById = new Map(
    inputs.candidate.transfers.map((transfer) => [transfer.transferId, transfer])
  );
  /**
   * Rule v7: the transfer a special entitlement was traded on as. Its custody row's successor must be a
   * transfer of the same entitlement in another graded trade, given by the club that received this one,
   * no earlier than this trade. Anything else leaves it unlinked.
   */
  return function onwardOfSpecial(transfer: Transfer, transaction: Transaction) {
    const asset = transfer.asset;
    if (asset.kind === 'player' || asset.kind === 'pick_entitlement') return undefined;
    const own = specialCustody.get(transfer.transferId);
    const successor = successorOf.get(transfer.transferId);
    if (
      !own ||
      !successor ||
      successor.entitlementId !== own.entitlementId ||
      (asset.kind === 'special_entitlement' && asset.entitlementId !== own.entitlementId)
    )
      return undefined;
    const onward = transfersById.get(successor.transferId);
    if (
      !onward ||
      !transactions.has(onward.transactionId) ||
      onward.transactionId === transfer.transactionId ||
      onward.fromClubId !== transfer.toClubId ||
      !aflTradeTransactionNotBefore(transactions.get(onward.transactionId)!, transaction)
    )
      return undefined;
    return { transfer: onward, entitlementId: own.entitlementId };
  };
}

/**
 * Rule R1: the transfer a stated not-used pick was traded on as under a new pick id. The relay row's
 * onward transfer must be a pick entitlement of another pick id in the same draft, in another graded
 * trade no earlier than this one, given by the club that received this one, with both trades stating
 * the relay's number. Anything else leaves it unlinked.
 */
function createPickRelayLink(
  inputs: AflTradeStructureInputs,
  transactions: ReadonlyMap<string, Transaction>
) {
  const relays = new Map((inputs.pickRelays ?? []).map((row) => [row.transferId, row]));
  const transfersById = new Map(
    inputs.candidate.transfers.map((transfer) => [transfer.transferId, transfer])
  );
  const custody = inputs.candidate.pickCustody ?? [];
  return function onwardOfRelay(transfer: Transfer, transaction: Transaction) {
    const relay = relays.get(transfer.transferId);
    const own = transfer.asset;
    if (!relay || own.kind !== 'pick_entitlement') return undefined;
    const onward = transfersById.get(relay.onwardTransferId);
    const next = onward?.asset;
    if (
      !onward ||
      next?.kind !== 'pick_entitlement' ||
      onward.transactionId !== relay.onwardTransactionId ||
      !transactions.has(onward.transactionId) ||
      onward.transactionId === transfer.transactionId ||
      onward.fromClubId !== transfer.toClubId ||
      next.pickId === own.pickId ||
      next.draftYear !== own.draftYear ||
      next.draftType !== own.draftType ||
      !aflTradeTransactionNotBefore(transactions.get(onward.transactionId)!, transaction)
    )
      return undefined;
    if (relay.reviewed) return { transfer: onward, reviewed: true as const };
    if (
      relay.selectionNumber === undefined ||
      // R1 by order: a leg that states no number relays by its latest Official AFL order number.
      (own.nominalPick ?? aflTradePickLatestOrderNumber(custody, own)) !== relay.selectionNumber ||
      next.nominalPick !== relay.selectionNumber
    )
      return undefined;
    return { transfer: onward, selectionNumber: relay.selectionNumber };
  };
}

/**
 * The structure of every graded trade, as functions the structure artifact
 * reads: the graded and named trades, each trade's transfers, a pick's onward transfer, a special
 * entitlement's custody successor, a not-used pick's relay, the leadsTo cycle guard, and route
 * corroboration of a trail.
 */
export function createAflTradeStructureView(inputs: AflTradeStructureInputs) {
  const transfersByTransaction = new Map<string, Transfer[]>();
  for (const transfer of inputs.candidate.transfers)
    transfersByTransaction.set(transfer.transactionId, [
      ...(transfersByTransaction.get(transfer.transactionId) ?? []),
      transfer,
    ]);
  const { ungraded, transactions } = partitionAflTradeTrades(inputs, transfersByTransaction);
  // A pick's onward transfers among the graded trades (`createAflTradePickOnwardTransfers`). Rule v12
  // orders a season's undated pick trades by their Draftguru sequence and breaks a tie between trails
  // by the pick's latest Official AFL custody holder.
  const onwardTransfersOf = createAflTradePickOnwardTransfers(
    transactions,
    inputs.candidate.transfers,
    { custodyHolders: aflTradePickCustodyHolders(inputs.candidate.pickCustody ?? []) }
  );
  const onwardOfSpecial = createSpecialEntitlementLink(inputs, transactions);
  const onwardOfRelay = createPickRelayLink(inputs, transactions);
  const outcomes = new Map<string, PickOutcome>(
    (inputs.candidate.pickOutcomes ?? []).map((outcome) => [outcome.transferId, outcome])
  );
  // A traded-on pick follows its unique trail, else into the one later trade where its club gave it
  // away. More than one, or none, leaves it unlinked.
  function onwardTransferOf(transfer: Transfer): Transfer | undefined {
    const onwardTransfers = onwardTransfersOf(transfer);
    return onwardTransfers.length === 1 ? onwardTransfers[0] : undefined;
  }
  /** The transfer a leg's asset was passed on as, before the cycle guard. */
  function rawOnwardOf(transfer: Transfer, transaction: Transaction): RawOnward | undefined {
    const special = onwardOfSpecial(transfer, transaction);
    if (special)
      return {
        kind: 'special_entitlement_successor',
        transfer: special.transfer,
        entitlementId: special.entitlementId,
      };
    const outcome = outcomes.get(transfer.transferId);
    const tradedOn = outcome?.outcomeStatus === 'stated' && outcome.disposition === 'traded_on';
    const onward = tradedOn ? onwardTransferOf(transfer) : undefined;
    if (onward) return { kind: 'pick_trail', transfer: onward };
    // Rule R1: a stated not-used pick the ledger relays to the pick id its holder traded on.
    const notUsed = outcome?.outcomeStatus === 'stated' && outcome.disposition === 'not_used';
    const relay = notUsed ? onwardOfRelay(transfer, transaction) : undefined;
    if (!relay) return undefined;
    return 'reviewed' in relay
      ? { kind: 'pick_relay_reviewed', transfer: relay.transfer }
      : { kind: 'pick_relay', ...relay };
  }
  // Rule v3: the onward trades each trade's traded-on legs read. A leg whose onward trade leads back to
  // its own trade is cut before any grading, so nothing depends on the order trades are read in.
  const reads = new Map<string, string[]>();
  for (const [transactionId, transaction] of transactions)
    reads.set(
      transactionId,
      transfersByTransaction.get(transactionId)!.flatMap((transfer) => {
        const onward = rawOnwardOf(transfer, transaction);
        return onward ? [onward.transfer.transactionId] : [];
      })
    );
  const leadsTo = (from: string, to: string) => {
    const queue = [from];
    const seen = new Set(queue);
    for (let at = 0; at < queue.length; at++) {
      if (queue[at] === to) return true;
      for (const next of reads.get(queue[at]!)!) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    return false;
  };
  // Rule v2: a traded-on outcome is corroborated when exactly one board pick in its draft routes it
  // sender → receiver → onward receiver, with that hop pair once in its route.
  const routeCorroborated = (transfer: Transfer, onward: Transfer) => {
    const asset = transfer.asset;
    if (asset.kind !== 'pick_entitlement') return false;
    const boards = (inputs.candidate.draftBoardPicks ?? []).filter(
      ({ draftYear, draftType, routeClubIds }) =>
        draftYear === asset.draftYear &&
        draftType === asset.draftType &&
        routeClubIds !== null &&
        routeClubIds.filter(
          (club, at) =>
            at > 1 &&
            routeClubIds[at - 2] === transfer.fromClubId &&
            routeClubIds[at - 1] === transfer.toClubId &&
            club === onward.toClubId
        ).length === 1
    );
    return boards.length === 1;
  };
  /** A leg's onward link, emitted whatever became of the onward trade, unless it is a cycle. */
  function onwardLinkOf(
    transfer: Transfer,
    transaction: Transaction
  ): AflTradeStructureOnwardLink | undefined {
    const raw = rawOnwardOf(transfer, transaction);
    if (!raw || leadsTo(raw.transfer.transactionId, transaction.transactionId)) return undefined;
    const ids = { transactionId: raw.transfer.transactionId, transferId: raw.transfer.transferId };
    if (raw.kind === 'special_entitlement_successor')
      return { kind: raw.kind, ...ids, entitlementId: raw.entitlementId };
    if (raw.kind === 'pick_relay')
      return { kind: raw.kind, ...ids, selectionNumber: raw.selectionNumber };
    if (raw.kind === 'pick_relay_reviewed') return { kind: raw.kind, ...ids };
    return {
      kind: 'pick_trail',
      ...ids,
      ...(routeCorroborated(transfer, raw.transfer)
        ? { corroboratedBy: 'footyinfo' as const }
        : {}),
    };
  }
  return {
    transfersByTransaction,
    transactions,
    ungraded,
    outcomes,
    onwardTransferOf,
    onwardOfSpecial,
    onwardOfRelay,
    leadsTo,
    routeCorroborated,
    onwardLinkOf,
  };
}

/** Builds one candidate's sealed trade structure: its graded trades, legs and onward links. */
export function buildAflTradeStructure(inputs: AflTradeStructureInputs): AflTradeStructure {
  const view = createAflTradeStructureView(inputs);
  const trades = [...view.transactions.keys()].sort().map((transactionId) => {
    const transaction = view.transactions.get(transactionId)!;
    const legs = [...view.transfersByTransaction.get(transactionId)!]
      .sort((left, right) => (left.transferId < right.transferId ? -1 : 1))
      .map((transfer): AflTradeStructureLeg => {
        const onward = view.onwardLinkOf(transfer, transaction);
        return {
          transferId: transfer.transferId,
          assetKind: transfer.asset.kind === 'player' ? 'player' : 'pick',
          sendingClubId: transfer.fromClubId!,
          receivingClubId: transfer.toClubId!,
          ...(onward ? { onward } : {}),
        };
      });
    const clubIds = [...new Set(legs.flatMap((leg) => [leg.sendingClubId, leg.receivingClubId]))];
    return {
      transactionId,
      tradeYear: transaction.seasonYear,
      clubs: clubIds.sort().map((clubId) => ({ clubId })),
      legs,
    };
  });
  const legs = trades.flatMap((trade) => trade.legs);
  const ungraded = [...view.ungraded].sort((left, right) =>
    left.transactionId < right.transactionId ? -1 : 1
  );
  return createAflTradeStructure({
    schemaVersion: AFL_TRADE_STRUCTURE_SCHEMA_VERSION,
    environment: 'non_production',
    inputs: { candidateId: inputs.candidateId },
    trades,
    ungraded,
    summary: {
      trades: trades.length,
      legs: legs.length,
      onwardLinks: legs.filter((leg) => leg.onward).length,
      ungraded: ungraded.length,
    },
    publicationEligible: false,
    publicationProhibited: true,
    limitation: AFL_TRADE_STRUCTURE_LIMITATION,
  });
}
