import { isAflTradeUsableCustodyStatus } from '../source/pickLineageDeferral';
import type {
  AflTradeAssetLedgerBidMatch,
  AflTradeAssetLedgerBidSpendLink,
  AflTradeAssetLedgerBidSpentPick,
  AflTradeAssetLedgerMatchedBidOutcome,
  AflTradeAssetLedgerPickOutcome,
} from './assetLedgerContracts';
import {
  AFL_TRADE_ASSET_LEDGER_REVIEWED_BID_SPENDS,
  type AflTradeAssetLedgerReviewedBidSpend,
} from './assetLedgerReviewedBidSpends';
import type { AflTradeAssetLedgerStintValue } from './assetLedgerStints';
import { aflTradeMatchedBidShares } from './matchedBidShares';
import type { AflTradeGradingInputs } from './gradingInputs';

type Candidate = AflTradeGradingInputs['candidate'];
type BidMatchRecord = NonNullable<Candidate['draftBoardBidMatches']>[number];
type ConsumedPick = BidMatchRecord['consumedPicks'][number];

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
  if (holders.get(reviewed.pickId) !== bid.clubId)
    throw new Error(
      `Reviewed bid spend ${pick.nativePickId} names ${reviewed.pickId}, which the bidding club did not hold at the draft.`
    );
  return { pickId: reviewed.pickId, link: 'reviewed' };
}

/**
 * The nominee: the one candidate selection at the bid's number, held by the matching club and naming
 * the player the board's nominee resolves to. An unresolved board player names no nominee. The
 * selection's status is not required to be usable: a matched-bid selection is usually `unresolved`
 * because its pick has no custody slot (the bid created it), which says nothing of who was drafted.
 * Only a `disputed` selection, whose providers disagree on the player or club, names no nominee.
 */
function nomineeOf(candidate: Candidate, bid: BidMatchRecord) {
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
      pricing:
        shares.status === 'shared'
          ? {
              status: 'shared',
              ruleId: shares.ruleId,
              pricePoints: shares.pricePoints,
              leftover: shares.leftover,
              deficit: shares.deficit,
            }
          : shares,
      spentPicks,
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

/**
 * A pending matched-bid pick with its share of the nominee, when exactly one board bid match lists
 * it as spent, prices the bid and names its nominee. A pick no board lists, where the boards show it
 * was not spent, is not used. Otherwise it stays pending, with the reason.
 */
export function aflTradeAssetLedgerShareMatchedBid(
  outcome: Extract<AflTradeAssetLedgerMatchedBidOutcome, { status: 'pending' }>,
  pick: AflTradeAssetLedgerBidPick,
  bidMatches: readonly AflTradeAssetLedgerBidMatch[]
): AflTradeAssetLedgerPickOutcome {
  const spends = bidMatches.flatMap((bid) =>
    bid.spentPicks
      .filter((spent) => spent.pickId === pick.pickId)
      .map((spent) => ({ bid, pick: spent }))
  );
  const pending = (pendingReason: typeof outcome.pendingReason) => ({ ...outcome, pendingReason });
  if (spends.length === 0)
    return boardShowsNotSpent(outcome, pick, bidMatches)
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
