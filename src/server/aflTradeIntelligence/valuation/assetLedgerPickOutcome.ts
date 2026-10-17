import { isAflTradeUsableCustodyStatus } from '../source/pickLineageDeferral';
import type {
  AflTradeAssetLedgerPickHop,
  AflTradeAssetLedgerPickOutcome,
  AflTradeAssetLedgerUnresolvedReason,
} from './assetLedgerContracts';
import type { AflTradeAssetLedgerPickIdentity } from './assetLedgerPickHops';
import type { AflTradeAssetLedgerStintValue } from './assetLedgerStints';
import type { AflTradeRealizedTradeGradeInputs } from './realizedTradeGrade';
import { aflTradeGradeOrderSlotOf } from './realizedTradeGradeAtTrade';

type Candidate = AflTradeRealizedTradeGradeInputs['candidate'];
type PickOutcome = NonNullable<Candidate['pickOutcomes']>[number];
type Selection = NonNullable<Candidate['draftSelections']>[number];

/** What the outcome rules read, indexed once for the whole ledger. */
export interface AflTradeAssetLedgerOutcomeSources {
  stintValue: AflTradeAssetLedgerStintValue;
  pickCustody: NonNullable<Candidate['pickCustody']>;
  outcomesByTransfer: ReadonlyMap<string, PickOutcome>;
  selectionsById: ReadonlyMap<string, Selection>;
  selectionsByPick: ReadonlyMap<string, readonly Selection[]>;
  /** `draftYear|draftType` of every draft the candidate holds a selection in. */
  draftsInEvidence: ReadonlySet<string>;
}

export function createAflTradeAssetLedgerOutcomeSources(
  candidate: Candidate,
  stintValue: AflTradeAssetLedgerStintValue
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
    selectionsById: new Map(selections.map((selection) => [selection.selectionId, selection])),
    selectionsByPick,
    draftsInEvidence: new Set(selections.map((row) => `${row.draftYear}|${row.draftType}`)),
  };
}

const unresolved = (
  reason: AflTradeAssetLedgerUnresolvedReason
): AflTradeAssetLedgerPickOutcome => ({
  kind: 'unresolved',
  reason,
});

/** A selected pick, with the draftee's first stint at the drafting club from the next season. */
function selected(
  sources: AflTradeAssetLedgerOutcomeSources,
  pick: AflTradeAssetLedgerPickIdentity,
  selection: Selection | undefined,
  fallback: { playerId: string | null; clubId: string | null }
): AflTradeAssetLedgerPickOutcome {
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

/** A pick not yet drafted, at its slot in the live Official AFL order when it has one (rule v6). */
function future(
  sources: AflTradeAssetLedgerOutcomeSources,
  pick: AflTradeAssetLedgerPickIdentity
): AflTradeAssetLedgerPickOutcome {
  const slot = aflTradeGradeOrderSlotOf(sources.pickCustody, {
    kind: 'pick_entitlement',
    pickId: pick.pickId,
    draftYear: pick.draftYear,
    draftType: pick.draftType,
    nominalRound: pick.round,
    nominalPick: null,
    originalClubId: pick.originalClubId,
    recordedLabel: null,
  });
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

/** A not-used pick by its nomination basis, as the grader reads it. */
function notUsed(outcome: PickOutcome): AflTradeAssetLedgerPickOutcome {
  switch (outcome.nominationBasis) {
    case 'club_took_nominated_player':
      return {
        kind: 'matched_bid',
        status: 'pending',
        matchedBidBoardPickIds: outcome.matchedBidBoardPickIds ?? [],
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
): AflTradeAssetLedgerPickOutcome {
  if (outcome.outcomeStatus === 'pending') return future(sources, pick);
  if (outcome.disposition === 'not_used') return notUsed(outcome);
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
  hopOutcomes: readonly PickOutcome[]
): AflTradeAssetLedgerPickOutcome {
  const usable = (sources.selectionsByPick.get(pick.pickId) ?? []).filter(({ status }) =>
    isAflTradeUsableCustodyStatus(status)
  );
  if (usable.length > 1) return unresolved('selection_conflict');
  if (usable.length === 1)
    return selected(sources, pick, usable[0], { playerId: null, clubId: null });
  if (hopOutcomes.some((outcome) => outcome.outcomeStatus === 'unresolved'))
    return unresolved('pick_outcome_unresolved');
  if (hopOutcomes.some(isTradedOn)) return unresolved('traded_on_unlinked');
  if (sources.draftsInEvidence.has(`${pick.draftYear}|${pick.draftType}`))
    return unresolved('no_outcome_evidence');
  return future(sources, pick);
}

/**
 * What became of a pick. A hop's stated outcome wins, as it does for the grader: pending is a future
 * pick, not used splits into a matched bid (pending), passed, not used or unresolved, and selected
 * names its selection. Hops traded on say nothing of the end. Without a terminal hop the pick's own
 * usable selection decides; with none, a draft already in evidence leaves it unresolved and a draft
 * not yet in evidence makes it a future pick.
 */
export function aflTradeAssetLedgerPickOutcome(
  sources: AflTradeAssetLedgerOutcomeSources,
  pick: AflTradeAssetLedgerPickIdentity,
  hops: readonly AflTradeAssetLedgerPickHop[]
): AflTradeAssetLedgerPickOutcome {
  const stated = hops.flatMap((hop) => {
    const outcome = sources.outcomesByTransfer.get(hop.transferId);
    return outcome ? [{ hop, outcome }] : [];
  });
  const terminal = stated.filter(
    ({ outcome }) => outcome.outcomeStatus !== 'unresolved' && !isTradedOn(outcome)
  );
  if (terminal.length > 1) return unresolved('outcome_conflict');
  if (terminal.length === 1)
    return fromHopOutcome(sources, pick, terminal[0]!.outcome, terminal[0]!.hop);
  return fromSelections(
    sources,
    pick,
    stated.map(({ outcome }) => outcome)
  );
}
