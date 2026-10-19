import { createAflTradeContentAddress } from '../artifacts/contentAddress';
import type {
  AflTradeExternalEvidenceBatch,
  AflTradeExternalEvidenceContent,
} from './externalDraftTradeEvidenceContracts';

type Claim = AflTradeExternalEvidenceContent['claim'];
type BidMatchClaim = Extract<Claim, { kind: 'draft_board_bid_match' }>;
type RecordedEntity = BidMatchClaim['club'];
type Evidence = AflTradeExternalEvidenceBatch['content']['evidence'][number];
type BidMatchEvidence = Evidence & { content: { claim: BidMatchClaim } };

/**
 * One matched bid a Footyinfo board states (`draft_board_bid_match`, parser v2, issue 789), its
 * clubs and nominee resolved. A null club or player has no reviewed resolution. Every bid-match row
 * is one record, so the candidate conserves it whether or not anything reads it.
 */
export interface AflTradeCanonicalDraftBoardBidMatch {
  bidMatchId: string;
  draftYear: number;
  draftType: string;
  /** Footyinfo's board id of the nominee's pick. */
  nativePickId: string;
  selectionNumber: number;
  roundNumber: number | null;
  /** The matching club, which held the nominee's pick. */
  clubId: string | null;
  /** The nominee. */
  playerId: string | null;
  bidClubId: string | null;
  basis: BidMatchClaim['bid']['basis'];
  /** The bid slot's DVI points. */
  points: number;
  /** The board's bid-level points used: a statement, never the price. */
  pointsUsed: number | null;
  /** The picks spent matching the bid, in the board's order. */
  consumedPicks: {
    nativePickId: string;
    label: string;
    originalNumber: number | null;
    originalClubId: string | null;
    holdingClubId: string | null;
    pointsUsed: number;
  }[];
  /** The leftover-points picks the board says the match created. */
  leftoverPicks: { nativePickId: string; holdingClubId: string | null; points: number | null }[];
  evidenceIds: string[];
}

type Lookup = (entityKind: 'club' | 'player', sourceIdentity: RecordedEntity) => string | null;

/**
 * Resolves a board club code. A spent or leftover pick names its clubs by code alone. The code
 * resolves to the one club that every Footyinfo club entity with that code on the same board
 * resolves to; an entity with no resolution, two entities resolving apart, or a code no entity
 * carries resolves to nothing.
 */
function createBoardCodeResolver(
  evidence: readonly Evidence[],
  lookup: Lookup,
  noteUnresolved: (club: RecordedEntity, evidenceId: string, detail?: string) => void
) {
  const entities = new Map<string, Map<string, RecordedEntity>>();
  const add = (draftYear: number, club: RecordedEntity) => {
    if (club.nativeId === null) return;
    const key = `${draftYear}|${club.nativeId}`;
    const known = entities.get(key) ?? new Map<string, RecordedEntity>();
    known.set(club.recordedName, club);
    entities.set(key, known);
  };
  for (const { content } of evidence) {
    const claim = content.claim;
    if (content.provider !== 'footyinfo') continue;
    if (claim.kind === 'draft_board_pick') {
      add(claim.draftYear, claim.club);
      claim.route.forEach((club) => add(claim.draftYear, club));
    } else if (claim.kind === 'draft_board_bid_match') {
      add(claim.draftYear, claim.club);
      add(claim.draftYear, claim.bid.club);
    }
  }
  return (draftYear: number, code: string, evidenceId: string): string | null => {
    const known = [...(entities.get(`${draftYear}|${code}`)?.values() ?? [])];
    if (known.length === 0) {
      // No review can resolve a bare code: only the board's own club entities are review subjects.
      noteUnresolved(
        { nativeId: code, recordedName: code },
        evidenceId,
        `Footyinfo club code ${code} is carried by no club the ${draftYear} board states.`
      );
      return null;
    }
    const resolved = known.map((club) => [club, lookup('club', club)] as const);
    resolved
      .filter(([, clubId]) => clubId === null)
      .forEach(([club]) => noteUnresolved(club, evidenceId));
    const clubIds = new Set(resolved.map(([, clubId]) => clubId));
    if (clubIds.size === 1 && !clubIds.has(null)) return [...clubIds][0]!;
    if (!clubIds.has(null))
      noteUnresolved(
        known[0]!,
        evidenceId,
        `Footyinfo club code ${code} resolves to more than one club on the ${draftYear} board.`
      );
    return null;
  };
}

/**
 * One record per Footyinfo `draft_board_bid_match` row: the matching and bidding clubs and the
 * nominee through their own resolutions, and each spent and leftover pick's clubs by board code. A
 * club with no resolution is reported through `noteUnresolved`, as the board picks report theirs.
 */
export function reconcileFootyinfoBoardBidMatches(input: {
  evidence: readonly Evidence[];
  lookup: Lookup;
  noteUnresolved: (club: RecordedEntity, evidenceId: string, detail?: string) => void;
}): AflTradeCanonicalDraftBoardBidMatch[] {
  const resolveCode = createBoardCodeResolver(input.evidence, input.lookup, input.noteUnresolved);
  return input.evidence
    .filter(
      (row): row is BidMatchEvidence =>
        row.content.provider === 'footyinfo' && row.content.claim.kind === 'draft_board_bid_match'
    )
    .map(({ evidenceId, content: { claim } }) => {
      const clubOf = (club: RecordedEntity) => {
        const clubId = input.lookup('club', club);
        if (clubId === null) input.noteUnresolved(club, evidenceId);
        return clubId;
      };
      const code = (value: string) => resolveCode(claim.draftYear, value, evidenceId);
      return {
        bidMatchId: createAflTradeContentAddress('external-draft-board-bid-match', { evidenceId }),
        draftYear: claim.draftYear,
        draftType: claim.draftType,
        nativePickId: claim.nativePickId,
        selectionNumber: claim.selectionNumber,
        roundNumber: claim.roundNumber,
        clubId: clubOf(claim.club),
        // The nominee is also the board's selection row, which reports an unresolved player.
        playerId: input.lookup('player', claim.player),
        bidClubId: clubOf(claim.bid.club),
        basis: claim.bid.basis,
        points: claim.points,
        pointsUsed: claim.pointsUsed,
        consumedPicks: claim.consumedPicks.map((pick) => ({
          nativePickId: pick.nativePickId,
          label: pick.label,
          originalNumber: pick.originalNumber,
          originalClubId: code(pick.originalClubCode),
          holdingClubId: code(pick.holdingClubCode),
          pointsUsed: pick.pointsUsed,
        })),
        leftoverPicks: claim.leftoverPicks.map((pick) => ({
          nativePickId: pick.nativePickId,
          holdingClubId: code(pick.holdingClubCode),
          points: pick.points,
        })),
        evidenceIds: [evidenceId],
      };
    })
    .sort((left, right) => left.bidMatchId.localeCompare(right.bidMatchId));
}
