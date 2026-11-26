import type {
  AflTradeAssetLedgerBidLeftoverUntiedReason,
  AflTradeAssetLedgerBidLeftoverUse,
  AflTradeAssetLedgerBidMatch,
  AflTradeAssetLedgerPickOutcome,
  AflTradeAssetLedgerStint,
} from './assetLedgerContracts';
import type { AflTradeAssetLedgerStintValue } from './assetLedgerStints';
import type { AflTradeGradingInputs } from './gradingInputs';

/**
 * Matched-bid leftover picks (owner, 2026-11-26; value-line spec #964). The last pick a club spends
 * on a bid counts only for what was still owed; its remainder becomes a new pick, its own asset. That
 * pick has no trade of its own, so no line carries it: the last spent pick carries it instead, at its
 * whole value. Each leftover is tied to what it became only as the stored evidence states it, and
 * one the evidence does not settle is `untied`, which keeps the spent pick at its share alone.
 */

type Candidate = AflTradeGradingInputs['candidate'];
type Leftover = NonNullable<
  Extract<AflTradeAssetLedgerBidMatch['pricing'], { status: 'shared' }>['leftover']
>;
type Use = AflTradeAssetLedgerBidLeftoverUse;

const untied = (reason: AflTradeAssetLedgerBidLeftoverUntiedReason): Use => ({
  status: 'untied',
  reason,
});

/** One candidate selection at a number, held by the club, naming a resolved player (and that one). */
function selectionAt(
  candidate: Candidate,
  match: AflTradeAssetLedgerBidMatch,
  selectionNumber: number | null,
  playerId: string | null
) {
  if (selectionNumber === null) return null;
  const found = (candidate.draftSelections ?? []).filter(
    (selection) =>
      selection.status !== 'disputed' &&
      selection.draftYear === match.draftYear &&
      selection.draftType === match.draftType &&
      selection.selectionNumber === selectionNumber
  );
  const [selection] = found;
  if (
    found.length !== 1 ||
    !selection!.playerId ||
    selection!.clubId !== match.clubId ||
    (playerId !== null && selection!.playerId !== playerId)
  )
    return null;
  return { selectionId: selection!.selectionId, playerId: selection!.playerId, selectionNumber };
}

interface Context {
  readonly candidate: Candidate;
  readonly stintValue: AflTradeAssetLedgerStintValue;
  readonly bidMatches: readonly AflTradeAssetLedgerBidMatch[];
  /** Selections a traded ledger pick's own outcome already values, so a line carries them. */
  readonly heldSelections: ReadonlySet<string>;
}

/** A leftover pick used on a player at `selectionNumber`, when one selection says who. */
function selectedUse(
  context: Context,
  match: AflTradeAssetLedgerBidMatch,
  leftoverPickId: string,
  selectionNumber: number | null,
  playerId: string | null
): Use {
  const selection = selectionAt(context.candidate, match, selectionNumber, playerId);
  if (selection === null) return untied('leftover_selection_unresolved');
  // A selection a traded pick already values, or any bid's nominee (whose spent picks share him),
  // would count twice.
  if (
    context.heldSelections.has(selection.selectionId) ||
    context.bidMatches.some(({ nominee }) => nominee?.selectionId === selection.selectionId)
  )
    return untied('leftover_already_valued');
  return {
    status: 'selected',
    leftoverPickId,
    ...selection,
    firstStint: context.stintValue(selection.playerId, match.clubId!, match.draftYear + 1),
  };
}

/**
 * A leftover pick spent on a later bid of the same draft (the later bid lists it as a spent pick of
 * the same id): tied when the same club spent it, the spend joins no ledger pick of its own and the
 * later bid is priced with a nominee. Undefined when no later bid lists it.
 */
function spentUse(
  context: Context,
  match: AflTradeAssetLedgerBidMatch,
  leftoverPickId: string
): Use | undefined {
  const spends = context.bidMatches.filter(
    (bid) =>
      bid.source === match.source &&
      bid.draftYear === match.draftYear &&
      bid.draftType === match.draftType &&
      bid.spentPicks.some(({ nativePickId }) => nativePickId === leftoverPickId)
  );
  if (spends.length === 0) return undefined;
  if (spends.length > 1) return untied('leftover_pick_unclear');
  const [later] = spends;
  const spent = later!.spentPicks.find(({ nativePickId }) => nativePickId === leftoverPickId)!;
  if (later!.clubId !== match.clubId) return untied('leftover_traded');
  if (spent.pickId !== null) return untied('leftover_already_valued');
  if (later!.pricing.status !== 'shared' || spent.share === null || !later!.nominee?.firstStint)
    return untied('leftover_bid_unpriced');
  return { status: 'spent', leftoverPickId, bidMatchId: later!.bidMatchId };
}

/**
 * A Footyinfo board's leftover: the one listed pick that carries points (the board's points are the
 * remainder's), or the only pick listed. Spent on a later bid by its board id, else what the board's
 * own row of it says: selected at a number, passed or removed.
 */
function boardUse(context: Context, match: AflTradeAssetLedgerBidMatch): Use {
  const record = (context.candidate.draftBoardBidMatches ?? []).find(
    ({ bidMatchId }) => bidMatchId === match.bidMatchId
  );
  const listed = record?.leftoverPicks ?? [];
  if (listed.length === 0) return untied('no_leftover_pick');
  const carrying = listed.filter(({ points }) => points !== null);
  const pick = carrying.length === 1 ? carrying[0] : listed.length === 1 ? listed[0] : undefined;
  if (pick === undefined) return untied('leftover_pick_unclear');
  if (pick.holdingClubId === null) return untied('leftover_not_in_evidence');
  if (pick.holdingClubId !== match.clubId) return untied('leftover_traded');
  const spent = spentUse(context, match, pick.nativePickId);
  if (spent !== undefined) return spent;
  const row =
    pick.boardPickId === undefined
      ? undefined
      : (context.candidate.draftBoardPicks ?? []).find(
          ({ boardPickId }) => boardPickId === pick.boardPickId
        );
  if (row === undefined) return untied('leftover_not_in_evidence');
  if (row.clubId !== match.clubId) return untied('leftover_traded');
  if (row.status !== 'selected') return { status: 'not_used', leftoverPickId: pick.nativePickId };
  return selectedUse(context, match, pick.nativePickId, row.recordedPickNumber, null);
}

/**
 * A Draftguru order's leftover: its one leftover row ("Created for GWS from leftover points after
 * matching bid for Ethan Matthews | Picked Jake Eime"), spent on a later order bid, else as its row
 * states: selected (the row's number and player), or removed.
 */
function orderUse(context: Context, match: AflTradeAssetLedgerBidMatch): Use {
  const listed = match.orderLeftovers ?? [];
  if (listed.length === 0) return untied('no_leftover_pick');
  if (listed.length > 1) return untied('leftover_pick_unclear');
  const { orderPickId } = listed[0]!;
  const row = (context.candidate.draftOrderPicks ?? []).find(
    (orderRow) => orderRow.orderPickId === orderPickId
  );
  if (row === undefined) return untied('leftover_not_in_evidence');
  if (row.clubId !== match.clubId) return untied('leftover_traded');
  const spent = spentUse(context, match, orderPickId);
  if (spent !== undefined) return spent;
  if (row.outcome === 'removed') return { status: 'not_used', leftoverPickId: orderPickId };
  if (row.outcome !== 'selected') return untied('leftover_not_in_evidence');
  // The row names its player; one that does not resolve names no selection.
  if (row.playerId === null) return untied('leftover_selection_unresolved');
  return selectedUse(context, match, orderPickId, row.pickNumber, row.playerId);
}

/**
 * Every matched bid with each leftover's use recorded on its pricing. A bid with no leftover is
 * returned as it is, so its record keeps its bytes. `picks` are the ledger's settled picks: a
 * selection a traded one of them already values (so a trade's line carries it) is never tied again.
 */
export function aflTradeAssetLedgerBidLeftoverUses(
  candidate: Candidate,
  stintValue: AflTradeAssetLedgerStintValue,
  bidMatches: readonly AflTradeAssetLedgerBidMatch[],
  picks: readonly {
    readonly outcome: AflTradeAssetLedgerPickOutcome;
    readonly hops: readonly unknown[];
  }[]
): AflTradeAssetLedgerBidMatch[] {
  const context: Context = {
    candidate,
    stintValue,
    bidMatches,
    heldSelections: new Set(
      picks.flatMap(({ outcome, hops }) =>
        hops.length > 0 && outcome.kind === 'selected' && outcome.selectionId !== null
          ? [outcome.selectionId]
          : []
      )
    ),
  };
  return bidMatches.map((match) => {
    if (match.pricing.status !== 'shared' || match.pricing.leftover === null) return match;
    const leftover: Leftover = {
      ...match.pricing.leftover,
      use:
        match.clubId === null
          ? untied('leftover_not_in_evidence')
          : match.source === 'draftguru_order'
            ? orderUse(context, match)
            : boardUse(context, match),
    };
    return { ...match, pricing: { ...match.pricing, leftover } };
  });
}

/** One player line a last spent pick also carries through its leftover, at `share` of that line. */
export interface AflTradeAssetLedgerLeftoverPart {
  readonly playerId: string;
  readonly draftYear: number;
  readonly selectionNumber: number;
  /** `used_selection` for the leftover's own selection; `bid_selection` for a later bid's nominee. */
  readonly source: 'used_selection' | 'bid_selection';
  readonly firstStint: AflTradeAssetLedgerStint;
  readonly share: number;
  /** True for the leftover's own selection (the whole line); false for a share of a later nominee. */
  readonly whole: boolean;
}

/**
 * The player lines a bid's last spent pick carries beyond its share, through its leftover: the
 * leftover's selection in full, or its share of the later bid it was spent on and, when it was that
 * bid's last spent pick, that bid's leftover in turn. Empty when the leftover is untied or not used.
 */
export function aflTradeAssetLedgerLeftoverParts(
  bidMatches: readonly AflTradeAssetLedgerBidMatch[],
  match: AflTradeAssetLedgerBidMatch
): AflTradeAssetLedgerLeftoverPart[] {
  const parts: AflTradeAssetLedgerLeftoverPart[] = [];
  const seen = new Set<string>();
  let bid: AflTradeAssetLedgerBidMatch | undefined = match;
  while (bid !== undefined) {
    if (seen.has(bid.bidMatchId))
      throw new Error(`Matched bid ${bid.bidMatchId} is reached twice through leftover picks.`);
    seen.add(bid.bidMatchId);
    const use: Use | undefined =
      bid.pricing.status === 'shared' ? bid.pricing.leftover?.use : undefined;
    if (use?.status === 'selected') {
      parts.push({
        playerId: use.playerId,
        draftYear: bid.draftYear,
        selectionNumber: use.selectionNumber,
        source: 'used_selection',
        firstStint: use.firstStint,
        share: 1,
        whole: true,
      });
      return parts;
    }
    if (use?.status !== 'spent') return parts;
    const later: AflTradeAssetLedgerBidMatch | undefined = bidMatches.find(
      ({ bidMatchId }) => bidMatchId === use.bidMatchId
    );
    const spent = later?.spentPicks.find(({ nativePickId }) => nativePickId === use.leftoverPickId);
    if (!later?.nominee?.firstStint || spent?.share == null)
      throw new Error(`Leftover pick ${use.leftoverPickId} is tied to a spend the ledger lacks.`);
    parts.push({
      playerId: later.nominee.playerId,
      draftYear: later.draftYear,
      selectionNumber: later.selectionNumber,
      source: 'bid_selection',
      firstStint: later.nominee.firstStint,
      share: spent.share,
      whole: false,
    });
    const next: Leftover | null = later.pricing.status === 'shared' ? later.pricing.leftover : null;
    bid = next?.spentNativePickId === use.leftoverPickId ? later : undefined;
  }
  return parts;
}
