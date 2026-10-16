import type { AflTradeExternalReconciliationCandidateRecord } from '../source/externalReconciliationCandidateContracts';
import { latestPickCustodyObservation } from '../source/pickCustodyDate';
import { isAflTradeUsableCustodyStatus } from '../source/pickLineageDeferral';
import {
  aflTradePickCustodyHolders,
  aflTradeTransactionNotBefore,
  createAflTradePickOnwardTransfers,
} from '../source/pickOnwardTransfer';
import { hpnDpv3ValueForPick } from '../modeling/hpnPickValueBenchmark';
import {
  AFL_TRADE_REALIZED_TRADE_GRADE_BATCH_SCHEMA_VERSION,
  AFL_TRADE_REALIZED_TRADE_GRADE_LIMITATION,
  AFL_TRADE_REALIZED_TRADE_GRADE_RULE_VERSION,
  aflTradeRealizedOnwardBundleExcluded,
  aflTradeRealizedBundleWeightTotal,
  aflTradeRealizedOnwardHybridWeights,
  aflTradeRealizedOnwardReturnExcluded,
  aflTradeRealizedOnwardSideProjected,
  createAflTradeRealizedTradeGradeBatch,
  expectedAflTradeRealizedTradeGradeClubs,
  type AflTradeRealizedGradeReason,
  type AflTradeRealizedHybridWeight,
  type AflTradeRealizedTradeGrade,
  type AflTradeRealizedTradeGradeBatch,
  type AflTradeRealizedTradeGradeBatchContent,
  type AflTradeRealizedTradeGradeLeg,
} from './realizedTradeGradeContracts';

type CandidateContent = AflTradeExternalReconciliationCandidateRecord['content'];
type Transaction = CandidateContent['transactions'][number];
type Transfer = CandidateContent['transfers'][number];
type PickOutcome = NonNullable<CandidateContent['pickOutcomes']>[number];
type Custody = CandidateContent['pickCustody'][number];
type PickAsset = Extract<Transfer['asset'], { kind: 'pick_entitlement' }>;

/** Everything the MVP grader reads, already loaded; the grader itself does no I/O. */
export interface AflTradeRealizedTradeGradeInputs {
  candidateId: string;
  /**
   * Rule v6 reads `pickCustody`, the Official AFL indicative orders, to project a pending pick; rule v8
   * also reads it, and `draftSelections`, for the slot a future pick eventually took.
   */
  candidate: Pick<CandidateContent, 'transactions' | 'transfers' | 'pickOutcomes'> &
    Partial<Pick<CandidateContent, 'draftSelections' | 'draftBoardPicks' | 'pickCustody'>>;
  /** One pinned HPN PAV calculation per season, and whether that season is official. */
  pavCalculations: readonly { season: number; calculationId: string; official: boolean }[];
  /** HPN PAV per player per season at one club, from the pinned calculations. */
  pav: readonly { playerId: string; season: number; clubId: string; value: number }[];
  /** v3 season spells: each club a player appeared for in a season. */
  seasonSpells: readonly { playerId: string; season: number; clubId: string }[];
  /** The seasons the season spells cover. A departure can only be seen in these. */
  spellSeasons: readonly number[];
  /** Current reviewed (v4) arrivals: a player's first season at a club. */
  reviewedArrivals: readonly { playerId: string; clubId: string; season: number }[];
  /**
   * Rule v7: the approved canonical special entitlement custody chain. Each row is one transfer of a
   * special draft entitlement; its successor is the row naming it as `predecessorTransferId`.
   */
  specialEntitlementCustody?: readonly {
    transferId: string;
    entitlementId: string;
    predecessorTransferId: string | null;
  }[];
  pickProjectionBenchmarkId: string;
  spellCutoffAt: string;
  gradedAt: string;
}

type Leg = AflTradeRealizedTradeGradeLeg;
type Ungraded = AflTradeRealizedTradeGradeBatchContent['ungraded'][number];
const SINGLE: AflTradeRealizedGradeReason = 'single_source_pick_outcome';
/** Rule v2: a corroborated pick leg names its second provider; any other drops nothing. */
const sourceOf = (corroborated: boolean) =>
  corroborated
    ? { corroboratedBy: 'footyinfo' as const, single: [] as AflTradeRealizedGradeReason[] }
    : { single: [SINGLE] };
const sorted = (reasons: Iterable<AflTradeRealizedGradeReason>) => [...new Set(reasons)].sort();

interface Stint {
  status: 'closed' | 'open';
  seasonsValued: number[];
  seasonsMissingPav: number[];
  /** The signed HPN PAV sum of the valued seasons (rule v4: the leg is worth it floored at 0). */
  pavSum: number;
  appearedAfter: boolean;
}

function indexInputs(inputs: AflTradeRealizedTradeGradeInputs) {
  const pav = new Map(
    inputs.pav.map((row) => [`${row.playerId}|${row.season}|${row.clubId}`, row.value])
  );
  const spells = new Map<string, Set<string>>();
  for (const row of inputs.seasonSpells) {
    const key = `${row.playerId}|${row.season}`;
    spells.set(key, (spells.get(key) ?? new Set()).add(row.clubId));
  }
  const arrivals = new Map<string, number[]>();
  for (const row of inputs.reviewedArrivals) {
    const key = `${row.playerId}|${row.clubId}`;
    arrivals.set(key, [...(arrivals.get(key) ?? []), row.season]);
  }
  const official = new Map(inputs.pavCalculations.map((row) => [row.season, row.official]));
  const spellSeasons = new Set(inputs.spellSeasons);
  const lastSeason = Math.max(
    0,
    ...inputs.pavCalculations.map(({ season }) => season),
    ...inputs.spellSeasons
  );
  return { pav, spells, arrivals, official, spellSeasons, lastSeason };
}
type Index = ReturnType<typeof indexInputs>;

/**
 * The first stint of a player at a club from `firstSeason`. It ends at the first covered season he
 * appears for another club (that season's PAV at this club still counts, since he left during it) or
 * before a later reviewed arrival at the same club (delisted and redrafted is a new stint). Uncovered
 * seasons cannot show a departure, so the stint runs through them with their PAV listed as missing. A
 * stint that never ends inside the covered seasons is open. HPN PAV is signed, so the sum may be below 0.
 */
function firstStint(
  index: Index,
  playerId: string,
  clubId: string,
  firstSeason: number,
  arrivedReviewed: boolean
): Stint {
  const stint: Stint = {
    status: 'open',
    seasonsValued: [],
    seasonsMissingPav: [],
    pavSum: 0,
    appearedAfter: false,
  };
  // A later reviewed arrival at the same club starts a new stint, but only once this move's own arrival
  // is reviewed; otherwise the later record may be this move's arrival, recorded late.
  const reArrival = arrivedReviewed
    ? Math.min(
        ...(index.arrivals.get(`${playerId}|${clubId}`) ?? []).filter(
          (season) => season > firstSeason
        )
      )
    : Infinity;
  for (let season = firstSeason; season <= index.lastSeason; season++) {
    if (season >= reArrival) {
      stint.status = 'closed';
      break;
    }
    const clubs = index.spells.get(`${playerId}|${season}`);
    if (clubs?.size) stint.appearedAfter = true;
    const departed =
      index.spellSeasons.has(season) && !!clubs && [...clubs].some((club) => club !== clubId);
    const playedHere = !!clubs?.has(clubId);
    if (!departed || playedHere) {
      if (index.official.has(season)) {
        stint.seasonsValued.push(season);
        stint.pavSum += index.pav.get(`${playerId}|${season}|${clubId}`) ?? 0;
      } else {
        stint.seasonsMissingPav.push(season);
      }
    }
    if (departed) {
      stint.status = 'closed';
      break;
    }
  }
  return stint;
}

/**
 * Rule v4: a first stint is worth its signed PAV sum floored at 0, since a player cannot return less
 * than nothing; the leg keeps the signed sum for audit.
 */
const stintLeg = (stint: Stint) => ({
  realizedValue: Math.max(0, stint.pavSum),
  stint: {
    status: stint.status,
    seasonsValued: stint.seasonsValued,
    seasonsMissingPav: stint.seasonsMissingPav,
    pavSum: stint.pavSum,
  },
});

/** A stint none of whose seasons has a pinned PAV calculation has no known value at all. */
const noPavCoverage = (stint: Stint) =>
  stint.seasonsValued.length === 0 && stint.seasonsMissingPav.length > 0;

function stintReasons(index: Index, stint: Stint): AflTradeRealizedGradeReason[] {
  const reasons: AflTradeRealizedGradeReason[] = [];
  if (stint.status === 'open') reasons.push('stint_open');
  if (stint.seasonsMissingPav.length) reasons.push('pav_seasons_missing');
  if (stint.seasonsValued.some((season) => index.official.get(season) === false))
    reasons.push('pav_season_not_official');
  if (!stint.appearedAfter && stint.status === 'open') reasons.push('no_appearances_after_trade');
  return reasons;
}

/** A reviewed arrival at the club for this move: first season there between `from` and `through`. */
function arrivalReviewed(
  index: Index,
  playerId: string,
  clubId: string,
  from: number,
  through: number
) {
  return (index.arrivals.get(`${playerId}|${clubId}`) ?? []).some(
    (season) => season >= from && season <= through
  );
}

/**
 * Rule v8 (owner direction 2026-10-16, issue 789): the slot a future national pick eventually took,
 * which no club knew at the trade. A stated selected outcome gives the selection number of its usable
 * selection; otherwise the latest usable slot in the pick's own draft order (rule v6's lookup, never a
 * proxy) gives it, and for a pending pick the rule v6 projected slot, proxy included, as its leg is
 * valued. A selection beyond HPN's 1 to 90, or no slot at all, leaves the slot unknown.
 */
interface EventualSlot {
  selectionNumber: number;
  slotSource: 'selection' | 'order' | 'projected_order';
}

function atTradeView(
  inputs: AflTradeRealizedTradeGradeInputs,
  index: Index,
  transfer: Transfer,
  tradeYear: number,
  eventualSlot: (asset: PickAsset) => EventualSlot | undefined
): Leg['atTrade'] {
  const asset = transfer.asset;
  if (asset.kind === 'player') {
    if (!index.official.has(tradeYear) || !asset.playerId)
      return { kind: 'unavailable', reason: 'trade_season_pav_missing' };
    return {
      kind: 'player_trade_season_pav',
      season: tradeYear,
      value: index.pav.get(`${asset.playerId}|${tradeYear}|${transfer.fromClubId}`) ?? 0,
    };
  }
  if (asset.kind !== 'pick_entitlement' || asset.draftType !== 'national')
    return { kind: 'unavailable', reason: 'pick_outside_projection_domain' };
  if (asset.nominalPick === null) {
    // Rule v8: hindsight, never what the clubs knew; like every at-trade view it enters no total.
    const slot = eventualSlot(asset);
    if (!slot) return { kind: 'unavailable', reason: 'future_pick_slot_unknown' };
    return {
      kind: 'pick_projection_eventual_slot',
      benchmarkId: inputs.pickProjectionBenchmarkId,
      selectionNumber: slot.selectionNumber,
      slotSource: slot.slotSource,
      value: hpnDpv3ValueForPick(slot.selectionNumber),
    };
  }
  if (asset.nominalPick > 90)
    return { kind: 'unavailable', reason: 'pick_outside_projection_domain' };
  return {
    kind: 'pick_projection',
    benchmarkId: inputs.pickProjectionBenchmarkId,
    selectionNumber: asset.nominalPick,
    value: hpnDpv3ValueForPick(asset.nominalPick),
  };
}

interface OrderSlot {
  custody: Custody;
  selectionNumber: number;
  proxy: boolean;
}

/**
 * Rule v6 (owner direction 2026-10-14): the slot a pending national pick holds in the live Official
 * AFL indicative order. Its draft's custody rows with its `pickId` or with its draft, round and
 * original club, whatever their status, give the latest observation of the pick; that row must be
 * usable and name a slot from 1 to 90, so a newer disputed or unnumbered capture is never overridden
 * by an older usable one. When its draft has no order at all, the same round and original club in the
 * previous draft's order stand in as a proxy (a 2027 pick before the 2027 order exists). A pick with no
 * original club (a compensation or assistance pick) matches only by `pickId`, so it never proxies.
 */
function orderSlotOf(custody: readonly Custody[], asset: PickAsset): OrderSlot | undefined {
  if (asset.draftType !== 'national') return undefined;
  const national = (draftYear: number) =>
    custody.filter((row) => row.draftYear === draftYear && row.draftType === 'national');
  const sameEntitlement = (row: Custody) =>
    asset.nominalRound !== null &&
    asset.originalClubId !== null &&
    row.roundNumber === asset.nominalRound &&
    row.originalClubId === asset.originalClubId;
  const own = national(asset.draftYear);
  let found: Custody | undefined;
  let proxy = false;
  if (own.length > 0) {
    // Every capture of the pick: under its `pickId`, or re-keyed under another for the same entitlement.
    found = latestPickCustodyObservation(
      own.filter((row) => row.pickId === asset.pickId || sameEntitlement(row))
    );
  } else {
    proxy = true;
    found = latestPickCustodyObservation(national(asset.draftYear - 1).filter(sameEntitlement));
  }
  const selectionNumber = found?.recordedPickNumber;
  if (
    !found ||
    !isAflTradeUsableCustodyStatus(found.status) ||
    selectionNumber == null ||
    selectionNumber > 90
  )
    return undefined;
  return { custody: found, selectionNumber, proxy };
}

// The batch's club id format (aflTradePublicIdSchema). A club the batch cannot name is unresolved.
const representableClub = (clubId: string | null): clubId is string =>
  !!clubId && clubId.length <= 160 && /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(clubId);

/**
 * Rules v11, v13 and v15: how a traded-on pick's onward return is allocated when realized weights may
 * not be: `unallocated`, the hybrid weights to split the bundle by, or null for the realized split.
 * A return whose every leg is excluded is unknown, not a known 0. In a bundle with any excluded asset
 * (the pick itself or a sibling), that asset's realized weight is unknown; through v12 an excluded
 * sibling dropped out of the total and its valued siblings absorbed its share, and v13 left the
 * bundle unallocated. Rule v14 split it by every asset's projection; from v15 each valued asset weighs
 * its realized value and each excluded one its at-trade HPN DPVC v3 projection, and the bundle stays
 * unallocated only when an excluded asset has none (a player, or a pick with no projection). A sole
 * asset takes the whole return, whatever became of the pick afterwards.
 */
function onwardHybridSplit(
  onwardLegs: readonly Leg[],
  clubId: string
): 'unallocated' | AflTradeRealizedHybridWeight[] | null {
  if (aflTradeRealizedOnwardReturnExcluded(onwardLegs, clubId)) return 'unallocated';
  if (!aflTradeRealizedOnwardBundleExcluded(onwardLegs, clubId)) return null;
  return aflTradeRealizedOnwardHybridWeights(onwardLegs, clubId) ?? 'unallocated';
}

/** The reasons a valued traded-on pick states about how it shares its club's onward return. */
function onwardReturnReasons(
  single: readonly AflTradeRealizedGradeReason[],
  allocation: 'sole_asset' | 'relative_value' | 'equal_split' | 'hybrid_weighted',
  onward: AflTradeRealizedTradeGrade,
  clubId: string
): AflTradeRealizedGradeReason[] {
  const reasons: AflTradeRealizedGradeReason[] = [...single];
  if (allocation === 'equal_split') reasons.push('equal_split_tiebreak');
  // Rule v15: an excluded asset's realized weight is unknown, so its projection stands in for it.
  if (allocation === 'hybrid_weighted') reasons.push('bundle_split_estimated_weights');
  if (onward.state === 'provisional') reasons.push('traded_on_return_provisional');
  // Rule v3: exact on the club's side, but the onward trade is blocked elsewhere.
  if (onward.state === 'blocked') reasons.push('traded_on_return_partial');
  // Rule v6: the club's side of the onward trade rests on a pick projected from an order.
  if (aflTradeRealizedOnwardSideProjected(onward.legs, clubId))
    reasons.push('traded_on_return_projected');
  return reasons;
}

/**
 * Rule v15: a traded-on pick's share of a bundle's return by its own weight over every asset's. The
 * total is positive: the bundle holds an excluded asset, and each excluded asset's projection is.
 */
function allocateByHybridWeights(
  assets: AflTradeRealizedHybridWeight[],
  onwardTransferId: string,
  benchmarkId: string
) {
  const weight = assets.find(({ transferId }) => transferId === onwardTransferId)!.value;
  const weightTotal = aflTradeRealizedBundleWeightTotal(assets);
  return {
    allocation: 'hybrid_weighted' as const,
    share: weight / weightTotal,
    weight,
    weightTotal,
    hybridWeights: { benchmarkId, onwardTransferId, assets },
  };
}

/**
 * How a traded-on pick shares its club's onward return: all of it as the sole asset given, by its
 * realized weight over the bundle's total, or evenly when everything given was worth 0.
 */
function allocateOnwardReturn(givenCount: number, givenUp: number, weight: number) {
  if (givenCount === 1)
    return { allocation: 'sole_asset' as const, share: 1, weight: null, weightTotal: null };
  if (givenUp > 0)
    return {
      allocation: 'relative_value' as const,
      share: weight / givenUp,
      weight,
      weightTotal: givenUp,
    };
  return {
    allocation: 'equal_split' as const,
    share: 1 / givenCount,
    weight: null,
    weightTotal: null,
  };
}

/** Grades every trade in the candidate into one sealed private batch. */
export function gradeAflTradesOnRealizedValue(
  inputs: AflTradeRealizedTradeGradeInputs
): AflTradeRealizedTradeGradeBatch {
  const index = indexInputs(inputs);
  const transfersByTransaction = new Map<string, Transfer[]>();
  for (const transfer of inputs.candidate.transfers)
    transfersByTransaction.set(transfer.transactionId, [
      ...(transfersByTransaction.get(transfer.transactionId) ?? []),
      transfer,
    ]);
  // A trade the batch cannot represent as legs is named, never dropped.
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
  // A pick's onward transfers among the graded trades (`createAflTradePickOnwardTransfers`). Rule v12
  // orders a season's undated pick trades by their Draftguru sequence and breaks a tie between trails
  // by the pick's latest Official AFL custody holder.
  const onwardTransfersOf = createAflTradePickOnwardTransfers(
    transactions,
    inputs.candidate.transfers,
    { custodyHolders: aflTradePickCustodyHolders(inputs.candidate.pickCustody ?? []) }
  );
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
  function onwardOfSpecial(transfer: Transfer, transaction: Transaction) {
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
  }
  const outcomes = new Map<string, PickOutcome>(
    (inputs.candidate.pickOutcomes ?? []).map((outcome) => [outcome.transferId, outcome])
  );
  // A traded-on pick follows its unique trail, else into the one later trade where its club gave it
  // away. More than one, or none, leaves it unlinked.
  function onwardTransferOf(transfer: Transfer): Transfer | undefined {
    const onwardTransfers = onwardTransfersOf(transfer);
    return onwardTransfers.length === 1 ? onwardTransfers[0] : undefined;
  }
  // Rule v3: the onward trades each trade's traded-on legs read. A leg whose onward trade leads back to
  // its own trade is blocked before any grading, so no grade depends on the order trades are graded in.
  const reads = new Map<string, string[]>();
  for (const [transactionId, transaction] of transactions)
    reads.set(
      transactionId,
      transfersByTransaction.get(transactionId)!.flatMap((transfer) => {
        const special = onwardOfSpecial(transfer, transaction);
        if (special) return [special.transfer.transactionId];
        const outcome = outcomes.get(transfer.transferId);
        const tradedOn = outcome?.outcomeStatus === 'stated' && outcome.disposition === 'traded_on';
        const onward = tradedOn ? onwardTransferOf(transfer) : undefined;
        return onward ? [onward.transactionId] : [];
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
  const selections = new Map(
    (inputs.candidate.draftSelections ?? []).map((selection) => [selection.selectionId, selection])
  );
  // Rule v2: a selected outcome is corroborated when its canonical selection is, by Draftguru and
  // Footyinfo agreeing on the player and club.
  const selectionCorroborated = (selectionId: string | null) => {
    const selection = selectionId === null ? undefined : selections.get(selectionId);
    return (
      selection?.status === 'corroborated' &&
      selection.supportingProviders.includes('draftguru') &&
      selection.supportingProviders.includes('footyinfo')
    );
  };
  /** Rule v8: the slot a future pick eventually took (`EventualSlot`). */
  const eventualSlotOf =
    (transfer: Transfer, tradeYear: number) =>
    (asset: PickAsset): EventualSlot | undefined => {
      // A pick is drafted at or after the trade; an earlier draft cannot be this pick's.
      if (asset.draftYear < tradeYear) return undefined;
      const outcome = outcomes.get(transfer.transferId);
      const selection =
        outcome?.outcomeStatus === 'stated' &&
        outcome.disposition === 'selected' &&
        outcome.selectionId !== null
          ? selections.get(outcome.selectionId)
          : undefined;
      if (
        selection &&
        isAflTradeUsableCustodyStatus(selection.status) &&
        selection.draftYear === asset.draftYear &&
        selection.draftType === asset.draftType
      )
        return selection.selectionNumber > 90
          ? undefined
          : { selectionNumber: selection.selectionNumber, slotSource: 'selection' };
      const slot = orderSlotOf(inputs.candidate.pickCustody ?? [], asset);
      if (!slot) return undefined;
      if (outcome?.outcomeStatus === 'pending')
        return { selectionNumber: slot.selectionNumber, slotSource: 'projected_order' };
      // Only a pick still waiting on its draft reads the previous draft's order as a proxy.
      return slot.proxy
        ? undefined
        : { selectionNumber: slot.selectionNumber, slotSource: 'order' };
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
  const graded = new Map<string, AflTradeRealizedTradeGrade>();

  const blocked = (
    base: Omit<Leg, 'state' | 'basis' | 'reasons'>,
    reasons: AflTradeRealizedGradeReason[]
  ): Leg => ({ ...base, state: 'blocked', basis: 'unavailable', reasons: sorted(reasons) }) as Leg;

  function gradeLeg(transfer: Transfer, transaction: Transaction): Leg {
    const asset = transfer.asset;
    const tradeYear = transaction.seasonYear;
    const receiving = transfer.toClubId!;
    const base = {
      transferId: transfer.transferId,
      assetKind: asset.kind === 'player' ? ('player' as const) : ('pick' as const),
      sendingClubId: transfer.fromClubId!,
      receivingClubId: receiving,
      atTrade: atTradeView(inputs, index, transfer, tradeYear, eventualSlotOf(transfer, tradeYear)),
    };
    if (asset.kind === 'player') {
      if (!asset.playerId) return blocked(base, ['player_identity_unresolved']);
      const reviewed = arrivalReviewed(index, asset.playerId, receiving, tradeYear, tradeYear + 1);
      const stint = firstStint(index, asset.playerId, receiving, tradeYear + 1, reviewed);
      if (noPavCoverage(stint)) return blocked(base, ['hpn_pav_head_missing']);
      const reasons = stintReasons(index, stint);
      if (!reviewed) reasons.push('arrival_unreviewed');
      return {
        ...base,
        state: 'valued',
        basis: 'player_first_stint',
        ...stintLeg(stint),
        reasons: sorted(reasons),
      };
    }
    if (asset.kind !== 'pick_entitlement') {
      // Rule v7: a special entitlement traded on as an ordinary pick, by its reviewed custody chain, is
      // worth that pick's traded-on return. Without a successor it stays unsupported.
      const special = onwardOfSpecial(transfer, transaction);
      if (!special) return blocked(base, ['special_entitlement_unsupported']);
      return tradedOnReturnLeg(base, transaction, special.transfer, false, {
        entitlementId: special.entitlementId,
        successorTransferId: special.transfer.transferId,
      });
    }
    const outcome = outcomes.get(transfer.transferId);
    if (!outcome || outcome.outcomeStatus === 'unresolved')
      return blocked(base, ['pick_outcome_unresolved']);
    if (outcome.outcomeStatus === 'pending') {
      // Rule v6: careers run on, so every grade is provisional; a pick not yet drafted is valued at
      // the HPN DPVC v3 value of its slot in the live order, never a first stint. Unknown stays blocked.
      const slot = orderSlotOf(inputs.candidate.pickCustody ?? [], asset);
      if (!slot) return blocked(base, ['pick_outcome_pending']);
      return {
        ...base,
        state: 'valued',
        basis: 'pick_projected_from_order',
        realizedValue: hpnDpv3ValueForPick(slot.selectionNumber),
        projection: {
          benchmarkId: inputs.pickProjectionBenchmarkId,
          selectionNumber: slot.selectionNumber,
          orderDraftYear: slot.custody.draftYear,
          pickDraftYear: asset.draftYear,
          custodyId: slot.custody.custodyId,
          observedAt: slot.custody.observedAt,
          proxy: slot.proxy,
        },
        reasons: [
          slot.proxy ? 'pick_projected_from_prior_order_proxy' : 'pick_projected_from_live_order',
        ],
      };
    }
    if (outcome.disposition === 'selected') {
      if (!outcome.playerId) return blocked(base, ['player_identity_unresolved']);
      // A pick is drafted at or after the trade; an earlier draft year cannot be this pick's outcome.
      if (asset.draftYear < tradeYear) return blocked(base, ['pick_outcome_unresolved']);
      const reviewed = arrivalReviewed(
        index,
        outcome.playerId,
        receiving,
        asset.draftYear,
        asset.draftYear + 1
      );
      const stint = firstStint(index, outcome.playerId, receiving, asset.draftYear + 1, reviewed);
      if (noPavCoverage(stint)) return blocked(base, ['hpn_pav_head_missing']);
      const { single, ...source } = sourceOf(selectionCorroborated(outcome.selectionId));
      const reasons = [...single, ...stintReasons(index, stint)];
      if (!reviewed) reasons.push('arrival_unreviewed');
      return {
        ...base,
        ...source,
        state: 'valued',
        basis: 'pick_selected_first_stint',
        ...stintLeg(stint),
        reasons: sorted(reasons),
      };
    }
    if (outcome.disposition === 'not_used') {
      // Rule v5: a count whose draft membership a reviewed Footyinfo board proved says so. The
      // outcome stays single-source: the board proves the draft, not this pick's fate.
      const proven =
        outcome.draftProvenBy === undefined ? {} : { draftProvenBy: outcome.draftProvenBy };
      // A board-stated passed or removed pick was not spent matching a bid: worth 0, like a pick of
      // a club that took no nominee.
      if (
        outcome.nominationBasis === 'club_took_no_nominated_player' ||
        outcome.nominationBasis === 'board_pick_passed_or_removed'
      ) {
        // Rule v2: the board's passed or removed pick corroborates Draftguru's "not used".
        const { single, ...source } = sourceOf(
          outcome.nominationBasis === 'board_pick_passed_or_removed'
        );
        return {
          ...base,
          ...source,
          ...proven,
          state: 'valued',
          basis: 'pick_not_used_no_nominee',
          realizedValue: 0,
          reasons: single,
        };
      }
      if (outcome.nominationBasis === 'club_took_nominated_player')
        return {
          ...base,
          ...proven,
          // Rule v10: a nominee only a Footyinfo board's matched bid records says so.
          ...(outcome.matchedBidBoardPickIds === undefined
            ? {}
            : { nomineeMatchedBidBy: 'footyinfo' as const }),
          state: 'excluded',
          basis: 'pick_not_used_nominee_excluded',
          reasons: sorted([SINGLE, 'not_used_nominee_excluded']),
        };
      return blocked(base, ['not_used_no_access_evidence']);
    }
    const onwardTransfer = onwardTransferOf(transfer);
    const leg = onwardTransfer
      ? tradedOnReturnLeg(
          base,
          transaction,
          onwardTransfer,
          routeCorroborated(transfer, onwardTransfer)
        )
      : blocked(base, ['traded_on_return_unlinked']);
    // Rule v9: a hop Draftguru stated "not used" that its club traded on in the candidate says so.
    return outcome.statedDisposition === 'not_used'
      ? ({ ...leg, reasons: sorted([...leg.reasons, 'stated_not_used_traded_on']) } as Leg)
      : leg;
  }

  /**
   * A pick its club traded on is worth its share of what the club got back in the onward trade. Rule
   * v7: a special entitlement reaches here through its custody chain, naming the entitlement and the
   * successor transfer.
   */
  function tradedOnReturnLeg(
    base: Omit<Leg, 'state' | 'basis' | 'reasons'>,
    transaction: Transaction,
    onwardTransfer: Transfer,
    corroborated: boolean,
    specialEntitlement?: { entitlementId: string; successorTransferId: string }
  ): Leg {
    const receiving = base.receivingClubId;
    if (leadsTo(onwardTransfer.transactionId, transaction.transactionId))
      return blocked(base, ['traded_on_return_blocked']);
    const onward = gradeTrade(onwardTransfer.transactionId);
    const pickLeg = onward.legs.find((leg) => leg.transferId === onwardTransfer.transferId)!;
    const club = onward.clubs.find(({ clubId }) => clubId === receiving)!;
    const given = onward.legs.filter((leg) => leg.sendingClubId === receiving);
    // Rule v3: the leg reads only its club's side of the onward trade. A sole asset needs what the club
    // received; a bundle also needs what it gave up (its pick's weight, or that the total is 0). That
    // side must be known even to exclude the pick, so a blocked side outranks an excluded pick.
    if (club.received === null || (given.length > 1 && club.givenUp === null))
      return blocked(base, ['traded_on_return_blocked']);
    const { single: singleSource, ...source } = sourceOf(corroborated);
    const special = specialEntitlement ? { specialEntitlement } : {};
    const single: AflTradeRealizedGradeReason[] = specialEntitlement
      ? [...singleSource, 'special_entitlement_custody_linked']
      : singleSource;
    const hybridSplit = onwardHybridSplit(onward.legs, receiving);
    if (hybridSplit === 'unallocated')
      return {
        ...base,
        ...source,
        ...special,
        state: 'excluded',
        basis: 'pick_traded_on_return_unallocated',
        onwardTransactionId: onward.transactionId,
        reasons: sorted([...single, 'traded_on_return_unallocated']),
      };
    const returnValue = club.received;
    // A sole asset's pick leg may itself be blocked or excluded there, leaving givenUp unused.
    const weight = pickLeg.state === 'valued' ? pickLeg.realizedValue : 0;
    const allocated = hybridSplit
      ? allocateByHybridWeights(
          hybridSplit,
          onwardTransfer.transferId,
          inputs.pickProjectionBenchmarkId
        )
      : allocateOnwardReturn(given.length, club.givenUp ?? 0, weight);
    const reasons = onwardReturnReasons(single, allocated.allocation, onward, receiving);
    return {
      ...base,
      ...source,
      ...special,
      state: 'valued',
      basis: 'pick_traded_on_return',
      realizedValue: allocated.share * returnValue,
      onward: {
        transactionId: onward.transactionId,
        allocation: allocated.allocation,
        returnValue,
        givenAssetCount: given.length,
        weight: allocated.weight,
        weightTotal: allocated.weightTotal,
        share: allocated.share,
        ...('hybridWeights' in allocated ? { hybridWeights: allocated.hybridWeights } : {}),
      },
      reasons: sorted(reasons),
    };
  }

  function gradeTrade(transactionId: string): AflTradeRealizedTradeGrade {
    const done = graded.get(transactionId);
    if (done) return done;
    const transaction = transactions.get(transactionId)!;
    const legs = [...transfersByTransaction.get(transactionId)!]
      .sort((left, right) => (left.transferId < right.transferId ? -1 : 1))
      .map((transfer) => gradeLeg(transfer, transaction));
    const reasons = sorted(legs.flatMap((leg) => leg.reasons));
    const trade: AflTradeRealizedTradeGrade = {
      transactionId,
      tradeYear: transaction.seasonYear,
      state: legs.some((leg) => leg.state === 'blocked')
        ? 'blocked'
        : reasons.length
          ? 'provisional'
          : 'complete',
      reasons,
      clubs: expectedAflTradeRealizedTradeGradeClubs(
        legs,
        AFL_TRADE_REALIZED_TRADE_GRADE_RULE_VERSION
      ),
      legs,
    };
    graded.set(transactionId, trade);
    return trade;
  }

  if (transactions.size === 0 && ungraded.length === 0)
    throw new Error('The candidate holds no trades to grade.');
  const trades = [...transactions.keys()].sort().map((transactionId) => gradeTrade(transactionId));
  return createAflTradeRealizedTradeGradeBatch({
    schemaVersion: AFL_TRADE_REALIZED_TRADE_GRADE_BATCH_SCHEMA_VERSION,
    ruleVersion: AFL_TRADE_REALIZED_TRADE_GRADE_RULE_VERSION,
    environment: 'non_production',
    valueUnit: 'career_pav',
    inputs: {
      candidateId: inputs.candidateId,
      pavCalculations: [...inputs.pavCalculations].sort(
        (left, right) => left.season - right.season
      ),
      pickProjectionBenchmarkId: inputs.pickProjectionBenchmarkId,
      spellCutoffAt: inputs.spellCutoffAt,
    },
    gradedAt: inputs.gradedAt,
    trades,
    ungraded: ungraded.sort((left, right) => (left.transactionId < right.transactionId ? -1 : 1)),
    summary: {
      complete: trades.filter(({ state }) => state === 'complete').length,
      provisional: trades.filter(({ state }) => state === 'provisional').length,
      blocked: trades.filter(({ state }) => state === 'blocked').length,
      ungraded: ungraded.length,
    },
    publicationEligible: false,
    publicationProhibited: true,
    limitation: AFL_TRADE_REALIZED_TRADE_GRADE_LIMITATION,
  });
}
