import { isAflTradeUsableCustodyStatus } from '../source/pickLineageDeferral';
import type {
  AflTradeAssetLedgerBidMatch,
  AflTradeAssetLedgerBidSpendLink,
  AflTradeAssetLedgerBidSpentPick,
  AflTradeAssetLedgerMatchedBidOutcome,
  AflTradeAssetLedgerStatedPickOutcome,
} from './assetLedgerContracts';
import {
  AFL_TRADE_ASSET_LEDGER_REVIEWED_BID_SPENDS,
  type AflTradeAssetLedgerReviewedBidSpend,
} from './assetLedgerReviewedBidSpends';
import {
  AFL_TRADE_ASSET_LEDGER_REVIEWED_PASSED,
  AFL_TRADE_ASSET_LEDGER_REVIEWED_SAME_PICKS,
  type AflTradeAssetLedgerReviewedPassed,
  type AflTradeAssetLedgerReviewedSamePick,
} from './assetLedgerReviewedPickLinks';
import type { AflTradeAssetLedgerStintValue } from './assetLedgerStints';
import {
  AFL_TRADE_MATCHED_BID_PRICE_RULES,
  aflTradeMatchedBidSlotPoints,
  type AflTradeMatchedBidPriceRule,
} from './matchedBidPriceRules';
import { aflTradeMatchedBidShares, type AflTradeMatchedBidShares } from './matchedBidShares';
import type { AflTradeGradingInputs } from './gradingInputs';

type Candidate = AflTradeGradingInputs['candidate'];
type BidMatchRecord = NonNullable<Candidate['draftBoardBidMatches']>[number];
type ConsumedPick = BidMatchRecord['consumedPicks'][number];
type OrderBidMatchRecord = NonNullable<Candidate['draftOrderBidMatches']>[number];
type NomineeBid = Pick<
  BidMatchRecord,
  'draftYear' | 'draftType' | 'selectionNumber' | 'clubId' | 'playerId'
>;

/** A pick that changed hands in exactly one trade, with the number that trade stated for it. */
export interface AflTradeAssetLedgerTradedEntitlement {
  readonly pickId: string;
  readonly draftYear: number;
  readonly draftType: string;
  readonly fromClubId: string;
  readonly toClubId: string;
  readonly nominalPick: number;
}

/**
 * Owner, 2026-10-21: a spent pick with no custody slot is the one pick traded once from its
 * original club to the bidding club, in that draft, at the number the board gives. Two such picks,
 * or none, join nothing.
 */
function linkTradedEntitlement(
  entitlements: readonly AflTradeAssetLedgerTradedEntitlement[],
  bid: BidMatchRecord,
  pick: ConsumedPick
): string | null {
  const found = entitlements.filter(
    (entitlement) =>
      entitlement.draftYear === bid.draftYear &&
      entitlement.draftType === bid.draftType &&
      entitlement.toClubId === bid.clubId &&
      entitlement.fromClubId === pick.originalClubId &&
      entitlement.nominalPick === pick.originalNumber
  );
  return found.length === 1 ? found[0]!.pickId : null;
}

/**
 * The candidate pick a board's spent pick was, by its custody slot only: the draft, the pre-draft
 * number the board's label gives and the original club, on a usable Official AFL custody row. The
 * holder is not compared: a club may acquire a pick on draft night to spend it (2021 Western
 * Bulldogs, Geelong's pick 34). Two statements of one slot join; a number alone never does.
 */
function linkSpentPick(
  custody: NonNullable<Candidate['pickCustody']>,
  entitlements: readonly AflTradeAssetLedgerTradedEntitlement[],
  holders: ReadonlyMap<string, string | null>,
  reviewedSpends: readonly AflTradeAssetLedgerReviewedBidSpend[],
  bid: BidMatchRecord,
  pick: ConsumedPick
): { pickId: string | null; link: AflTradeAssetLedgerBidSpendLink } {
  if (pick.originalNumber === null) return { pickId: null, link: 'unnumbered' };
  if (pick.originalClubId === null) return { pickId: null, link: 'club_unresolved' };
  const pickIds = new Set(
    custody
      .filter(
        (row) =>
          isAflTradeUsableCustodyStatus(row.status) &&
          row.draftYear === bid.draftYear &&
          row.draftType === bid.draftType &&
          row.recordedPickNumber === pick.originalNumber &&
          row.originalClubId === pick.originalClubId
      )
      .map(({ pickId }) => pickId)
  );
  if (pickIds.size === 1) return { pickId: [...pickIds][0]!, link: 'custody' };
  if (pickIds.size > 1) return { pickId: null, link: 'ambiguous_custody' };
  const traded = linkTradedEntitlement(entitlements, bid, pick);
  if (traded !== null) return { pickId: traded, link: 'trade_entitlement' };
  const reviewed = reviewedSpends.find(
    (row) => row.bidMatchId === bid.bidMatchId && row.nativePickId === pick.nativePickId
  );
  if (reviewed === undefined) return { pickId: null, link: 'no_custody' };
  const held = reviewed.pickIds.find((pickId) => holders.get(pickId) === bid.clubId);
  if (held === undefined)
    throw new Error(
      `Reviewed bid spend ${pick.nativePickId} names ${reviewed.pickIds.join(' or ')}, which the bidding club did not hold at the draft.`
    );
  return { pickId: held, link: 'reviewed' };
}

/**
 * The nominee: the one candidate selection at the bid's number, held by the matching club and naming
 * the player the board's nominee resolves to. An unresolved board player names no nominee. The
 * selection's status is not required to be usable: a matched-bid selection is usually `unresolved`
 * because its pick has no custody slot (the bid created it), which says nothing of who was drafted.
 * Only a `disputed` selection, whose providers disagree on the player or club, names no nominee.
 */
function nomineeOf(candidate: Candidate, bid: NomineeBid) {
  const selections = (candidate.draftSelections ?? []).filter(
    (selection) =>
      selection.status !== 'disputed' &&
      selection.draftYear === bid.draftYear &&
      selection.draftType === bid.draftType &&
      selection.selectionNumber === bid.selectionNumber
  );
  const [selection] = selections;
  if (
    selections.length !== 1 ||
    !selection!.playerId ||
    bid.clubId === null ||
    bid.playerId === null ||
    selection!.clubId !== bid.clubId ||
    bid.playerId !== selection!.playerId
  )
    return null;
  return { selectionId: selection!.selectionId, playerId: selection!.playerId };
}

/**
 * Every board matched bid the candidate carries, priced by the year's AFL rule, with each spent
 * pick's share of the nominee's first stint at the matching club (from the season after the draft).
 */
export function aflTradeAssetLedgerBidMatches(
  candidate: Candidate,
  stintValue: AflTradeAssetLedgerStintValue,
  entitlements: readonly AflTradeAssetLedgerTradedEntitlement[] = [],
  holders: ReadonlyMap<string, string | null> = new Map(),
  reviewedSpends: readonly AflTradeAssetLedgerReviewedBidSpend[] = AFL_TRADE_ASSET_LEDGER_REVIEWED_BID_SPENDS
): AflTradeAssetLedgerBidMatch[] {
  return (candidate.draftBoardBidMatches ?? []).map((bid) => {
    const shares = aflTradeMatchedBidShares(bid);
    const found = nomineeOf(candidate, bid);
    const nominee = found && {
      ...found,
      firstStint: stintValue(found.playerId, bid.clubId!, bid.draftYear + 1),
    };
    const stintWorth = nominee?.firstStint?.value ?? null;
    const spentPicks = bid.consumedPicks.map((pick, index): AflTradeAssetLedgerBidSpentPick => {
      const share = shares.status === 'shared' ? shares.picks[index]! : null;
      return {
        nativePickId: pick.nativePickId,
        label: pick.label,
        originalNumber: pick.originalNumber,
        originalClubId: pick.originalClubId,
        pointsUsed: pick.pointsUsed,
        ...linkSpentPick(
          candidate.pickCustody ?? [],
          entitlements,
          holders,
          reviewedSpends,
          bid,
          pick
        ),
        countedPoints: share?.countedPoints ?? null,
        share: share?.share ?? null,
        use: share?.use ?? null,
        value: share && stintWorth !== null ? share.share * stintWorth : null,
      };
    });
    return {
      bidMatchId: bid.bidMatchId,
      draftYear: bid.draftYear,
      draftType: bid.draftType,
      selectionNumber: bid.selectionNumber,
      clubId: bid.clubId,
      bidClubId: bid.bidClubId,
      basis: bid.basis,
      nominee,
      pricing: pricingOf(shares),
      spentPicks,
    };
  });
}

/** The pricing a ledger bid match records: the shares' price, leftover and deficit, or the refusal. */
function pricingOf(shares: AflTradeMatchedBidShares): AflTradeAssetLedgerBidMatch['pricing'] {
  return shares.status === 'shared'
    ? {
        status: 'shared',
        ruleId: shares.ruleId,
        pricePoints: shares.pricePoints,
        leftover: shares.leftover,
        deficit: shares.deficit,
      }
    : shares;
}

/**
 * Each matched bid a Draftguru post-draft order states (owner, 2026-11-24), priced by the year's AFL
 * rule at the owner's recorded ladder position, with each spent pick's share of the nominee's first
 * stint at the matching club. The order states slots, not points: the bid and every spent pick are
 * valued at the year's DVI, a spent pick at the live slot it was spent as. A spent pick is the
 * candidate pick whose transfer its order row's last hop ties (`order_row`); a row that ties none
 * names no pick (`order_row_untied`), so nothing is joined by a number.
 */
export function aflTradeAssetLedgerOrderBidMatches(
  candidate: Candidate,
  stintValue: AflTradeAssetLedgerStintValue,
  rules: readonly AflTradeMatchedBidPriceRule[] = AFL_TRADE_MATCHED_BID_PRICE_RULES
): AflTradeAssetLedgerBidMatch[] {
  const rows = new Map((candidate.draftOrderPicks ?? []).map((row) => [row.orderPickId, row]));
  const pickOfTransfer = new Map(
    candidate.transfers.flatMap(({ transferId, asset }) =>
      asset.kind === 'pick_entitlement' ? [[transferId, asset.pickId] as const] : []
    )
  );
  const pickIdOf = (orderPickId: string | null) => {
    const lastHop = orderPickId === null ? null : rows.get(orderPickId)?.hopTransferIds.at(-1);
    return lastHop ? (pickOfTransfer.get(lastHop) ?? null) : null;
  };
  return (candidate.draftOrderBidMatches ?? []).map((bid: OrderBidMatchRecord) => {
    const slotPoints = (slot: number) => aflTradeMatchedBidSlotPoints(bid.draftYear, slot, rules);
    const points = slotPoints(bid.selectionNumber);
    const spent = bid.spentPicks.map((pick, index) => ({
      ...pick,
      nativePickId: pick.orderPickId ?? `order-spent:${index}:${pick.asPick}`,
      pointsUsed: slotPoints(pick.asPick),
    }));
    const missing = [bid.selectionNumber, ...bid.spentPicks.map(({ asPick }) => asPick)].filter(
      (slot) => slotPoints(slot) === null
    );
    const shares: AflTradeMatchedBidShares =
      points === null || missing.length > 0
        ? {
            status: 'refused',
            reason: 'slot_points_missing',
            detail: `The ${bid.draftYear} DVI gives no points for pick ${missing.join(', ')}.`,
          }
        : aflTradeMatchedBidShares(
            {
              draftYear: bid.draftYear,
              selectionNumber: bid.selectionNumber,
              roundNumber: bid.roundNumber,
              points,
              ladderPosition: bid.ladderPosition,
              consumedPicks: spent.map(({ nativePickId, pointsUsed }) => ({
                nativePickId,
                pointsUsed: pointsUsed!,
              })),
              leftoverPicks: bid.leftoverPicks.map(({ orderPickId }) => ({
                nativePickId: orderPickId,
                points: null,
              })),
            },
            rules
          );
    const found = nomineeOf(candidate, bid);
    const nominee = found && {
      ...found,
      firstStint: stintValue(found.playerId, bid.clubId!, bid.draftYear + 1),
    };
    const stintWorth = nominee?.firstStint?.value ?? null;
    return {
      bidMatchId: bid.bidMatchId,
      source: 'draftguru_order' as const,
      draftYear: bid.draftYear,
      draftType: bid.draftType,
      selectionNumber: bid.selectionNumber,
      clubId: bid.clubId,
      bidClubId: bid.bidClubId,
      basis: bid.basis,
      ladderPosition: bid.ladderPosition,
      nominee,
      pricing: pricingOf(shares),
      spentPicks: spent.map((pick, index): AflTradeAssetLedgerBidSpentPick => {
        const share = shares.status === 'shared' ? shares.picks[index]! : null;
        const pickId = pickIdOf(pick.orderPickId);
        const stated = pick.originKind === 'entitlement' || pick.originKind === 'leftover_points';
        return {
          nativePickId: pick.nativePickId,
          label: `Pick ${pick.asPick}`,
          originalNumber: null,
          originalClubId: stated ? (pick.routeClubIds[0] ?? null) : null,
          pointsUsed: pick.pointsUsed ?? 0,
          pickId,
          link: pickId === null ? 'order_row_untied' : 'order_row',
          countedPoints: share?.countedPoints ?? null,
          share: share?.share ?? null,
          use: share?.use ?? null,
          value: share && stintWorth !== null ? share.share * stintWorth : null,
          asPick: pick.asPick,
          // The route is the original club, each hop's club, then the holder: the clubs between.
          viaClubIds: pick.routeClubIds.slice(1, -1),
          originKind: pick.originKind,
          ...(pick.compensationLabel === undefined
            ? {}
            : { compensationLabel: pick.compensationLabel }),
        };
      }),
      orderLeftovers: bid.leftoverPicks,
    };
  });
}

/**
 * Whether the boards show that a not-used pick was not spent on a bid (owner, 2026-10-21: "Yes, count
 * it as 0"). Only for a pick whose matched-bid reading rests on a nominee count alone, when the draft's
 * boards carry bid matches and none of the holder's bids in that draft has a spent pick that failed to
 * join and could be this one. With no known holder, it stays pending.
 */
function boardShowsNotSpent(
  outcome: Extract<AflTradeAssetLedgerMatchedBidOutcome, { status: 'pending' }>,
  pick: AflTradeAssetLedgerBidPick,
  bidMatches: readonly AflTradeAssetLedgerBidMatch[]
) {
  if (outcome.basis !== 'nominee_count' || pick.holderClubId === null) return false;
  const draft = bidMatches.filter(
    ({ draftYear, draftType }) => draftYear === pick.draftYear && draftType === pick.draftType
  );
  // An unjoined spend of the bidding club's own pick (owner, 2026-10-21) can only be a pick whose
  // trail starts at that club; any other unjoined spend could be this one.
  const couldBeThis = (bid: AflTradeAssetLedgerBidMatch, spent: AflTradeAssetLedgerBidSpentPick) =>
    spent.pickId === null &&
    (spent.originalClubId !== bid.clubId || pick.firstFromClubId === bid.clubId);
  return (
    draft.length > 0 &&
    !draft.some(
      (bid) =>
        bid.clubId === pick.holderClubId && bid.spentPicks.some((spent) => couldBeThis(bid, spent))
    )
  );
}

/** The pick a matched-bid outcome belongs to: its draft and the club holding it at the draft. */
export interface AflTradeAssetLedgerBidPick {
  readonly pickId: string;
  readonly draftYear: number;
  readonly draftType: string;
  readonly holderClubId: string | null;
  /** The club its first trade took it from; null when it was never traded. */
  readonly firstFromClubId: string | null;
}

/** Owner-reviewed links for pending matched-bid picks (#1050) and the board rows they cite. */
export interface AflTradeAssetLedgerPickReview {
  readonly samePicks: readonly AflTradeAssetLedgerReviewedSamePick[];
  readonly passed: readonly AflTradeAssetLedgerReviewedPassed[];
  readonly boardPicks: readonly { boardPickId: string; status: string; clubId: string | null }[];
}

/**
 * A pending matched-bid pick with its share of the nominee, when exactly one board bid match lists
 * it as spent (or, by owner review, lists the same physical pick under another id), prices the bid
 * and names its nominee. A pick no board lists, where the boards show it was not spent, is not used;
 * one the owner reviewed as passed by its holder is passed. Otherwise it stays pending, with the
 * reason.
 */
export function aflTradeAssetLedgerShareMatchedBid(
  outcome: Extract<AflTradeAssetLedgerMatchedBidOutcome, { status: 'pending' }>,
  pick: AflTradeAssetLedgerBidPick,
  bidMatches: readonly AflTradeAssetLedgerBidMatch[],
  review: AflTradeAssetLedgerPickReview = {
    samePicks: AFL_TRADE_ASSET_LEDGER_REVIEWED_SAME_PICKS,
    passed: AFL_TRADE_ASSET_LEDGER_REVIEWED_PASSED,
    boardPicks: [],
  }
): AflTradeAssetLedgerStatedPickOutcome {
  // A pick the order says was spent takes its share from the order's bid alone (owner, 2026-11-24).
  if (outcome.basis === 'order_bid_spent')
    return orderBidShare(
      outcome,
      pick,
      bidMatches.filter(({ source }) => source === 'draftguru_order')
    );
  // Every other pick reads the boards only, as before the order's bids were priced.
  const boards = bidMatches.filter(({ source }) => source === undefined);
  const same = review.samePicks.find((row) => row.pickId === pick.pickId);
  const spends = boards.flatMap((bid) =>
    bid.spentPicks
      .filter(
        (spent) =>
          spent.pickId !== null &&
          (spent.pickId === pick.pickId || spent.pickId === same?.samePickId)
      )
      .map((spent) => ({ bid, pick: spent }))
  );
  if (same && spends.some(({ bid }) => bid.clubId !== pick.holderClubId))
    throw new Error(
      `Reviewed same pick ${pick.pickId} takes a spend of a club that did not hold it at the draft.`
    );
  const pending = (pendingReason: typeof outcome.pendingReason) => ({ ...outcome, pendingReason });
  const passed = review.passed.find((row) => row.pickId === pick.pickId);
  if (spends.length === 0 && passed) {
    const board = review.boardPicks.find((row) => row.boardPickId === passed.boardPickId);
    if (board?.status !== 'passed' || board.clubId !== pick.holderClubId)
      throw new Error(
        `Reviewed passed pick ${pick.pickId} cites ${passed.boardPickId}, which is not its holder's pass.`
      );
    return { kind: 'passed', boardPickId: passed.boardPickId };
  }
  if (spends.length === 0)
    return boardShowsNotSpent(outcome, pick, boards)
      ? { kind: 'not_used', evidence: 'board_not_spent' }
      : pending('no_bid_spend');
  if (spends.length > 1) return pending('spent_twice');
  const { bid, pick: spent } = spends[0]!;
  if (bid.pricing.status === 'refused' || spent.share === null) return pending('bid_unpriced');
  if (bid.nominee === null) return pending('nominee_unresolved');
  return {
    kind: 'matched_bid',
    status: 'shared',
    basis: outcome.basis,
    matchedBidBoardPickIds: outcome.matchedBidBoardPickIds,
    bidMatchId: bid.bidMatchId,
    nomineePlayerId: bid.nominee.playerId,
    countedPoints: spent.countedPoints!,
    share: spent.share,
    use: spent.use!,
    value: spent.value,
  };
}

/**
 * A pick the order says was spent, with its share of the nominee when exactly one order bid lists it
 * spent by its holder, prices the bid and names its nominee. Otherwise it stays as it was (pending,
 * `bid_unpriced`), or pending with the reason when the bid is priced but cannot share it.
 */
function orderBidShare(
  outcome: Extract<AflTradeAssetLedgerMatchedBidOutcome, { status: 'pending' }>,
  pick: AflTradeAssetLedgerBidPick,
  orderBids: readonly AflTradeAssetLedgerBidMatch[]
): AflTradeAssetLedgerStatedPickOutcome {
  const spends = orderBids.flatMap((bid) =>
    bid.spentPicks.filter((spent) => spent.pickId === pick.pickId).map((spent) => ({ bid, spent }))
  );
  if (spends.length === 0) return outcome;
  if (spends.length > 1) return { ...outcome, pendingReason: 'spent_twice' };
  const { bid, spent } = spends[0]!;
  if (bid.pricing.status === 'refused' || spent.share === null) return outcome;
  if (bid.nominee === null || bid.clubId !== pick.holderClubId)
    return { ...outcome, pendingReason: 'nominee_unresolved' };
  return {
    kind: 'matched_bid',
    status: 'shared',
    basis: outcome.basis,
    matchedBidBoardPickIds: outcome.matchedBidBoardPickIds,
    bidMatchId: bid.bidMatchId,
    nomineePlayerId: bid.nominee.playerId,
    countedPoints: spent.countedPoints!,
    share: spent.share,
    use: spent.use!,
    value: spent.value,
  };
}
