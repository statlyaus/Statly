import { isAflTradeUsableCustodyStatus } from '../source/pickLineageDeferral';
import type {
  AflTradeAssetLedgerBidMatch,
  AflTradeAssetLedgerBidSpendLink,
  AflTradeAssetLedgerBidSpentPick,
  AflTradeAssetLedgerMatchedBidOutcome,
} from './assetLedgerContracts';
import type { AflTradeAssetLedgerStintValue } from './assetLedgerStints';
import { aflTradeMatchedBidShares } from './matchedBidShares';
import type { AflTradeRealizedTradeGradeInputs } from './realizedTradeGrade';

type Candidate = AflTradeRealizedTradeGradeInputs['candidate'];
type BidMatchRecord = NonNullable<Candidate['draftBoardBidMatches']>[number];
type ConsumedPick = BidMatchRecord['consumedPicks'][number];

/**
 * The candidate pick a board's spent pick was, by its custody slot only: the draft, the pre-draft
 * number the board's label gives and the original club, on a usable Official AFL custody row. The
 * holder is not compared: a club may acquire a pick on draft night to spend it (2021 Western
 * Bulldogs, Geelong's pick 34). Two statements of one slot join; a number alone never does.
 */
function linkSpentPick(
  custody: NonNullable<Candidate['pickCustody']>,
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
  return { pickId: null, link: pickIds.size === 0 ? 'no_custody' : 'ambiguous_custody' };
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
  stintValue: AflTradeAssetLedgerStintValue
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
        ...linkSpentPick(candidate.pickCustody ?? [], bid, pick),
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
 * A pending matched-bid pick with its share of the nominee, when exactly one board bid match lists
 * it as spent, prices the bid and names its nominee. Otherwise it stays pending, with the reason.
 */
export function aflTradeAssetLedgerShareMatchedBid(
  outcome: Extract<AflTradeAssetLedgerMatchedBidOutcome, { status: 'pending' }>,
  pickId: string,
  bidMatches: readonly AflTradeAssetLedgerBidMatch[]
): AflTradeAssetLedgerMatchedBidOutcome {
  const spends = bidMatches.flatMap((bid) =>
    bid.spentPicks.filter((pick) => pick.pickId === pickId).map((pick) => ({ bid, pick }))
  );
  const pending = (pendingReason: typeof outcome.pendingReason) => ({ ...outcome, pendingReason });
  if (spends.length === 0) return pending('no_bid_spend');
  if (spends.length > 1) return pending('spent_twice');
  const { bid, pick } = spends[0]!;
  if (bid.pricing.status === 'refused' || pick.share === null) return pending('bid_unpriced');
  if (bid.nominee === null) return pending('nominee_unresolved');
  return {
    kind: 'matched_bid',
    status: 'shared',
    basis: outcome.basis,
    matchedBidBoardPickIds: outcome.matchedBidBoardPickIds,
    bidMatchId: bid.bidMatchId,
    nomineePlayerId: bid.nominee.playerId,
    countedPoints: pick.countedPoints!,
    share: pick.share,
    use: pick.use!,
    value: pick.value,
  };
}
