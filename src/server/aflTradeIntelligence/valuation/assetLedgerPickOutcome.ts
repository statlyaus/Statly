import { isAflTradeUsableCustodyStatus } from '../source/pickLineageDeferral';
import type {
  AflTradeAssetLedgerPickHop,
  AflTradeAssetLedgerStatedPickOutcome,
  AflTradeAssetLedgerUnresolvedReason,
} from './assetLedgerContracts';
import type {
  AflTradeAssetLedgerPickIdentity,
  AflTradeAssetLedgerPickTrail,
} from './assetLedgerPickHops';
import {
  AFL_TRADE_ASSET_LEDGER_REVIEWED_TRADED_ON,
  type AflTradeAssetLedgerReviewedSelected,
} from './assetLedgerReviewedPickLinks';
import type { AflTradeAssetLedgerStintValue } from './assetLedgerStints';
import type { AflTradeGradingInputs } from './gradingInputs';
import { aflTradePickOrderSlotOf, type AflTradePickAsset } from './pickSlots';

type Candidate = AflTradeGradingInputs['candidate'];
type PickOutcome = NonNullable<Candidate['pickOutcomes']>[number];
type Selection = NonNullable<Candidate['draftSelections']>[number];

/** What the outcome rules read, indexed once for the whole ledger. */
export interface AflTradeAssetLedgerOutcomeSources {
  stintValue: AflTradeAssetLedgerStintValue;
  pickCustody: NonNullable<Candidate['pickCustody']>;
  outcomesByTransfer: ReadonlyMap<string, PickOutcome>;
  /** Each pick transfer's own entitlement, which a pending pick is projected from. */
  pickAssetsByTransfer: ReadonlyMap<string, AflTradePickAsset>;
  selectionsById: ReadonlyMap<string, Selection>;
  selectionsByPick: ReadonlyMap<string, readonly Selection[]>;
  /** The latest draft year the candidate holds a selection in; a later draft has not been run. */
  latestDraftYearInEvidence: number;
  /** Transfers whose stated "not used" the owner reviewed as traded on (`assetLedgerReviewedPickLinks.ts`). */
  reviewedTradedOn: ReadonlySet<string>;
}

export function createAflTradeAssetLedgerOutcomeSources(
  candidate: Candidate,
  stintValue: AflTradeAssetLedgerStintValue,
  reviewedTradedOn: readonly { transferId: string }[] = AFL_TRADE_ASSET_LEDGER_REVIEWED_TRADED_ON
): AflTradeAssetLedgerOutcomeSources {
  const selections = candidate.draftSelections ?? [];
  const selectionsByPick = new Map<string, Selection[]>();
  for (const selection of selections)
    selectionsByPick.set(selection.pickId, [
      ...(selectionsByPick.get(selection.pickId) ?? []),
      selection,
    ]);
  return {
    stintValue,
    pickCustody: candidate.pickCustody ?? [],
    outcomesByTransfer: new Map(
      (candidate.pickOutcomes ?? []).map((outcome) => [outcome.transferId, outcome])
    ),
    pickAssetsByTransfer: new Map(
      candidate.transfers.flatMap(({ transferId, asset }) =>
        asset.kind === 'pick_entitlement' ? [[transferId, asset] as const] : []
      )
    ),
    selectionsById: new Map(selections.map((selection) => [selection.selectionId, selection])),
    selectionsByPick,
    latestDraftYearInEvidence: Math.max(-Infinity, ...selections.map(({ draftYear }) => draftYear)),
    reviewedTradedOn: new Set(reviewedTradedOn.map(({ transferId }) => transferId)),
  };
}

const unresolved = (
  reason: AflTradeAssetLedgerUnresolvedReason
): AflTradeAssetLedgerStatedPickOutcome => ({
  kind: 'unresolved',
  reason,
});

/** A selected pick, with the draftee's first stint at the drafting club from the next season. */
function selected(
  sources: AflTradeAssetLedgerOutcomeSources,
  pick: AflTradeAssetLedgerPickIdentity,
  selection: Selection | undefined,
  fallback: { playerId: string | null; clubId: string | null }
): AflTradeAssetLedgerStatedPickOutcome {
  const playerId = selection?.playerId ?? fallback.playerId;
  const clubId = selection?.clubId ?? fallback.clubId;
  const draftYear = selection?.draftYear ?? pick.draftYear;
  return {
    kind: 'selected',
    selectionId: selection?.selectionId ?? null,
    playerId,
    clubId,
    selectionNumber: selection?.selectionNumber ?? null,
    firstStint:
      playerId !== null && clubId !== null
        ? sources.stintValue(playerId, clubId, draftYear + 1)
        : null,
  };
}

/**
 * A stated not-used pick the owner reviewed as used (`assetLedgerReviewedPickLinks.ts`,
 * `AFL_TRADE_ASSET_LEDGER_REVIEWED_SELECTED`): the named selection, when it is of the pick's draft, the
 * holder's, and the cited order row names the holder and the cited board row is the holder's selection.
 * Anything else is refused: a reviewed entry that the candidate no longer bears out must not stand.
 */
export function aflTradeAssetLedgerReviewedSelectedOutcome(
  sources: AflTradeAssetLedgerOutcomeSources,
  pick: AflTradeAssetLedgerPickIdentity,
  holderClubId: string | null,
  review: AflTradeAssetLedgerReviewedSelected,
  candidate: Pick<Candidate, 'pickCustody' | 'draftBoardPicks'>
): AflTradeAssetLedgerStatedPickOutcome {
  const selection = sources.selectionsById.get(review.selectionId);
  const custody = (candidate.pickCustody ?? []).find(
    ({ custodyId }) => custodyId === review.custodyId
  );
  const board = (candidate.draftBoardPicks ?? []).find(
    ({ boardPickId }) => boardPickId === review.boardPickId
  );
  if (
    !selection ||
    selection.draftYear !== pick.draftYear ||
    selection.draftType !== pick.draftType ||
    holderClubId === null ||
    selection.clubId !== holderClubId ||
    custody?.currentClubId !== holderClubId ||
    board?.status !== 'selected' ||
    board.clubId !== holderClubId
  )
    throw new Error(
      `Reviewed selected pick ${pick.pickId} cites selection ${review.selectionId}, which the candidate does not bear out for its holder.`
    );
  return selected(sources, pick, selection, { playerId: null, clubId: null });
}

const identityAsset = (pick: AflTradeAssetLedgerPickIdentity): AflTradePickAsset => ({
  kind: 'pick_entitlement',
  pickId: pick.pickId,
  draftYear: pick.draftYear,
  draftType: pick.draftType,
  nominalRound: pick.round,
  nominalPick: null,
  originalClubId: pick.originalClubId,
  recordedLabel: null,
});

/** A pick not yet drafted, at its slot in the live Official AFL order when it has one (rule v6). */
function future(
  sources: AflTradeAssetLedgerOutcomeSources,
  asset: AflTradePickAsset
): AflTradeAssetLedgerStatedPickOutcome {
  const slot = aflTradePickOrderSlotOf(sources.pickCustody, asset);
  return {
    kind: 'future',
    projectedSlot: slot
      ? {
          selectionNumber: slot.selectionNumber,
          custodyId: slot.custody.custodyId,
          orderDraftYear: slot.custody.draftYear,
          proxy: slot.proxy,
        }
      : null,
  };
}

/** A not-used pick by its nomination basis. */
function notUsed(outcome: PickOutcome): AflTradeAssetLedgerStatedPickOutcome {
  switch (outcome.nominationBasis) {
    case 'club_took_nominated_player':
      // Pending until a board bid match shares it (`assetLedgerBidMatches.ts`).
      return {
        kind: 'matched_bid',
        status: 'pending',
        basis: outcome.matchedBidBoardPickIds ? 'board_matched_bid' : 'nominee_count',
        matchedBidBoardPickIds: outcome.matchedBidBoardPickIds ?? [],
        pendingReason: 'no_bid_spend',
      };
    case 'board_pick_passed_or_removed':
      return { kind: 'passed', boardPickId: outcome.boardPickId! };
    case 'club_took_no_nominated_player':
      return { kind: 'not_used' };
    default:
      // Without access evidence the pick may have been spent matching a bid: never read as 0.
      return unresolved('not_used_no_access_evidence');
  }
}

/** The outcome a terminal hop states for the club that held the pick after it. */
function fromHopOutcome(
  sources: AflTradeAssetLedgerOutcomeSources,
  pick: AflTradeAssetLedgerPickIdentity,
  outcome: PickOutcome,
  hop: AflTradeAssetLedgerPickHop
): AflTradeAssetLedgerStatedPickOutcome {
  const asset = sources.pickAssetsByTransfer.get(hop.transferId) ?? identityAsset(pick);
  if (outcome.outcomeStatus === 'pending') return future(sources, asset);
  if (outcome.disposition === 'not_used') return notUsed(outcome);
  // A pick is drafted at or after its trade, never in an earlier draft.
  if (asset.draftYear < hop.seasonYear) return unresolved('pick_outcome_unresolved');
  const selection =
    outcome.selectionId === null ? undefined : sources.selectionsById.get(outcome.selectionId);
  return selected(sources, pick, selection, { playerId: outcome.playerId, clubId: hop.toClubId });
}

const isTradedOn = (outcome: PickOutcome) =>
  outcome.outcomeStatus === 'stated' && outcome.disposition === 'traded_on';

/** An untraded pick, or a traded one with no terminal hop outcome: its selection, else its draft. */
function fromSelections(
  sources: AflTradeAssetLedgerOutcomeSources,
  pick: AflTradeAssetLedgerPickIdentity,
  hopOutcomes: readonly PickOutcome[],
  anyTradedOn: boolean
): AflTradeAssetLedgerStatedPickOutcome {
  const usable = (sources.selectionsByPick.get(pick.pickId) ?? []).filter(({ status }) =>
    isAflTradeUsableCustodyStatus(status)
  );
  if (usable.length > 1) return unresolved('selection_conflict');
  if (usable.length === 1)
    return selected(sources, pick, usable[0], { playerId: null, clubId: null });
  if (hopOutcomes.some((outcome) => outcome.outcomeStatus === 'unresolved'))
    return unresolved('pick_outcome_unresolved');
  if (anyTradedOn) return unresolved('traded_on_unlinked');
  // Only a draft after the latest one in evidence is still to come; an earlier one is over.
  if (pick.draftYear > sources.latestDraftYearInEvidence)
    return future(sources, identityAsset(pick));
  return unresolved('no_outcome_evidence');
}

/**
 * What became of a pick. A hop's stated outcome wins: pending is a future
 * pick, not used splits into a matched bid (pending), passed, not used or unresolved, and selected
 * names its selection. Hops traded on say nothing of the end, and on an ordered trail only the last
 * hop may state one. Without a terminal hop the pick's own usable selection decides; with none, a pick
 * of a draft after the latest in evidence is a future pick and any other is unresolved.
 */
export function aflTradeAssetLedgerPickOutcome(
  sources: AflTradeAssetLedgerOutcomeSources,
  pick: AflTradeAssetLedgerPickIdentity,
  { hopOrder, hops }: AflTradeAssetLedgerPickTrail
): AflTradeAssetLedgerStatedPickOutcome {
  const stated = hops.flatMap((hop) => {
    const outcome = sources.outcomesByTransfer.get(hop.transferId);
    return outcome ? [{ hop, outcome }] : [];
  });
  // A hop the owner reviewed as traded on says nothing of the end, whatever Draftguru states.
  const tradedOn = ({ hop, outcome }: (typeof stated)[number]) =>
    isTradedOn(outcome) || sources.reviewedTradedOn.has(hop.transferId);
  const terminal = stated.filter(
    (row) => row.outcome.outcomeStatus !== 'unresolved' && !tradedOn(row)
  );
  if (terminal.length > 1) return unresolved('outcome_conflict');
  if (terminal.length === 1) {
    const { hop, outcome } = terminal[0]!;
    // A club that traded the pick on cannot also have used it.
    if (hopOrder === 'trail' && hop !== hops.at(-1)) return unresolved('outcome_conflict');
    return fromHopOutcome(sources, pick, outcome, hop);
  }
  return fromSelections(
    sources,
    pick,
    stated.map(({ outcome }) => outcome),
    stated.some(tradedOn)
  );
}
