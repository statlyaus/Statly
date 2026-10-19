import { z } from 'zod';

import type { AflTradeExternalEvidenceContent } from './externalDraftTradeEvidenceContracts';

type Claim = AflTradeExternalEvidenceContent['claim'];
export type FootyinfoBoardBidMatchClaim = Extract<Claim, { kind: 'draft_board_bid_match' }>;
type SpentPick = FootyinfoBoardBidMatchClaim['consumedPicks'][number];
type LeftoverPick = FootyinfoBoardBidMatchClaim['leftoverPicks'][number];
type Failure = { error: string };

/** The board's bid reasons and the basis each states. */
export const FOOTYINFO_BID_BASIS = {
  father_son: 'father_son',
  academy_club: 'academy',
  academy_nga: 'next_generation_academy',
} as const;

const team = z.object({ name: z.string().min(1), abbrev: z.string().regex(/^[A-Z]{2,4}$/) });
const points = z.number().int().min(0);
const spentPickSchema = z.object({
  id: z.number().int().positive(),
  label: z.string().min(1),
  number: z.null(),
  original_number: z.number().int().positive().nullable(),
  points_used: points,
  team,
  original_team: team,
});
// Only the fields a matched bid's points are read from; the board pick itself is read by the adapter.
const bidPickSchema = z.object({
  id: z.number().int().positive(),
  number: z.number().int().positive().optional(),
  round: z.number().int().positive().optional(),
  team,
  player: z.object({ known_as: z.string().min(1), slug: z.string().min(1) }).optional(),
  status: z.object({ id: z.string() }),
  origin: z.object({ id: z.string() }),
  points: points.optional(),
  points_used: points.optional(),
  consumed_picks: z.array(spentPickSchema).optional(),
  purchased_from: z.object({ pick_id: z.number().int().positive() }).optional(),
  original: z.object({ team: team.optional() }).optional(),
  original_number: z.number().int().positive().optional(),
  bid: z.object({ team: team.optional(), match_reason: z.string() }).optional(),
  lineage: z
    .array(
      z.object({
        type: z.object({ id: z.string() }),
        related_pick: z.object({ id: z.number().int().positive() }).optional(),
      })
    )
    .optional(),
});
type BidPick = z.infer<typeof bidPickSchema>;

function entity(value: z.infer<typeof team>) {
  return { nativeId: value.abbrev, recordedName: value.name };
}

/** The label the board prints for a spent pick: `R2 (GEE) - Pick 34`, or `R4 (COL)` unnumbered. */
function spentPickLabel(round: number, entry: z.infer<typeof spentPickSchema>): string {
  const number = entry.original_number === null ? '' : ` - Pick ${entry.original_number}`;
  return `R${round} (${entry.original_team.abbrev})${number}`;
}

type SpentEntry = z.infer<typeof spentPickSchema>;

/** The board records this pick as spent on the nominee, and held by the club that matched. */
function spentOnNominee(board: BidPick | undefined, nominee: BidPick): board is BidPick {
  return (
    board !== undefined &&
    board.status.id === 'points_used' &&
    board.purchased_from?.pick_id === nominee.id &&
    board.team.abbrev === nominee.team.abbrev
  );
}

/** The bid's entry repeats the board's record: points, holder, original club, number and label. */
function entryMatchesBoard(entry: SpentEntry, board: BidPick): boolean {
  const sameOrigin =
    board.original?.team?.abbrev === entry.original_team.abbrev &&
    (board.original_number ?? null) === entry.original_number;
  const sameLabel = board.round !== undefined && entry.label === spentPickLabel(board.round, entry);
  return (
    board.points_used === entry.points_used &&
    board.team.abbrev === entry.team.abbrev &&
    sameOrigin &&
    sameLabel
  );
}

/**
 * The picks a matched bid lists as spent, each checked against the board's own record of that pick:
 * spent on this nominee, held by its club, with the same points, original club, original number
 * and label. A pick listed twice refuses.
 */
function readSpentPicks(
  nominee: BidPick,
  picks: ReadonlyMap<number, BidPick>
): SpentPick[] | Failure {
  const spent: SpentPick[] = [];
  for (const entry of nominee.consumed_picks ?? []) {
    const board = picks.get(entry.id);
    if (spent.some(({ nativePickId }) => nativePickId === String(entry.id))) {
      return { error: `Matched bid ${nominee.id} lists spent pick ${entry.id} twice.` };
    }
    if (!spentOnNominee(board, nominee) || !entryMatchesBoard(entry, board)) {
      return {
        error: `Matched bid ${nominee.id} lists spent pick ${entry.id}, which the board does not record as spent on it.`,
      };
    }
    spent.push({
      nativePickId: String(entry.id),
      label: entry.label,
      originalNumber: entry.original_number,
      originalClubCode: entry.original_team.abbrev,
      holdingClubCode: entry.team.abbrev,
      pointsUsed: entry.points_used,
    });
  }
  return spent;
}

/**
 * The leftover-points picks the board says each matched bid created: every `points_remainder` pick
 * names the one bid it was created from (`created_from_points`, `related_pick`). Any other shape,
 * or a link to a pick that is not a matched bid, refuses.
 */
function leftoversByBid(picks: readonly BidPick[]): Map<number, LeftoverPick[]> | Failure {
  const bids = new Set(picks.filter(({ bid }) => bid?.team !== undefined).map(({ id }) => id));
  const leftovers = new Map<number, LeftoverPick[]>();
  for (const pick of picks) {
    const created = (pick.lineage ?? []).filter(({ type }) => type.id === 'created_from_points');
    if (created.length === 0 && pick.origin.id !== 'points_remainder') continue;
    const bidId = created[0]?.related_pick?.id;
    if (pick.origin.id !== 'points_remainder' || created.length !== 1 || !bids.has(bidId!)) {
      return {
        error: `Leftover-points pick ${pick.id} does not name the one matched bid it came from.`,
      };
    }
    leftovers.set(bidId!, [
      ...(leftovers.get(bidId!) ?? []),
      {
        nativePickId: String(pick.id),
        holdingClubCode: pick.team.abbrev,
        points: pick.points ?? null,
      },
    ]);
  }
  return leftovers;
}

/**
 * The observed rule on every reviewed board (2019 to 2025, 54 matched bids): the spent picks never
 * hold fewer points than the bid used, and any excess is exactly the points of the one leftover pick
 * of that bid that carries points. A leftover with no points (passed, or created to fill list spots)
 * carries none of it.
 */
function leftoverMatchesExcess(
  pointsUsed: number | null,
  spent: number,
  leftovers: readonly LeftoverPick[]
) {
  const carried = leftovers.flatMap(({ points }) => (points === null ? [] : [points]));
  const excess = pointsUsed === null ? 0 : spent - pointsUsed;
  return carried.length <= 1 && (carried[0] ?? 0) === excess;
}

/** The points rules, in the order a reader checks them: presence, shortfall, then the excess. */
function pointsFailure(
  nominee: BidPick,
  spent: readonly SpentPick[],
  leftovers: readonly LeftoverPick[]
): Failure | null {
  const pointsUsed = nominee.points_used ?? null;
  const spentPoints = spent.reduce((total, pick) => total + pick.pointsUsed, 0);
  if ((pointsUsed === null) !== (spent.length === 0)) {
    return {
      error: `Matched bid ${nominee.id} states points used without spent picks, or the reverse.`,
    };
  }
  if (pointsUsed !== null && spentPoints < pointsUsed) {
    return { error: `Matched bid ${nominee.id} used more points than its spent picks hold.` };
  }
  if (!leftoverMatchesExcess(pointsUsed, spentPoints, leftovers)) {
    return {
      error: `Matched bid ${nominee.id} has spent points its leftover pick does not account for.`,
    };
  }
  return null;
}

type Nominee = BidPick & {
  number: number;
  player: NonNullable<BidPick['player']>;
  points: number;
  bid: { team: z.infer<typeof team>; match_reason: keyof typeof FOOTYINFO_BID_BASIS };
};

/** A selection the board calls a matched bid: a bidding club, a number, a player and points. */
function asNominee(pick: BidPick): Nominee | Failure | null {
  if (pick.status.id === 'points_used') return null;
  if (pick.bid?.team === undefined) {
    return pick.consumed_picks === undefined && pick.points_used === undefined
      ? null
      : { error: `Board pick ${pick.id} states points used without a matched bid.` };
  }
  const complete =
    pick.number !== undefined && pick.player !== undefined && pick.points !== undefined;
  return complete && Object.hasOwn(FOOTYINFO_BID_BASIS, pick.bid.match_reason)
    ? (pick as Nominee)
    : { error: `Matched bid ${pick.id} has no selection, points or reviewed basis.` };
}

function readBidMatch(
  pick: BidPick,
  picks: ReadonlyMap<number, BidPick>,
  leftovers: ReadonlyMap<number, LeftoverPick[]>,
  draftYear: number
): FootyinfoBoardBidMatchClaim | Failure | null {
  const nominee = asNominee(pick);
  if (nominee === null || 'error' in nominee) return nominee;
  const spent = readSpentPicks(nominee, picks);
  if ('error' in spent) return spent;
  const leftoverPicks = leftovers.get(nominee.id) ?? [];
  const failure = pointsFailure(nominee, spent, leftoverPicks);
  if (failure !== null) return failure;
  return {
    kind: 'draft_board_bid_match',
    draftYear,
    draftType: 'national',
    nativePickId: String(nominee.id),
    selectionNumber: nominee.number,
    roundNumber: nominee.round ?? null,
    club: entity(nominee.team),
    player: { nativeId: nominee.player.slug, recordedName: nominee.player.known_as },
    bid: { club: entity(nominee.bid.team), basis: FOOTYINFO_BID_BASIS[nominee.bid.match_reason] },
    points: nominee.points,
    pointsUsed: nominee.points_used ?? null,
    consumedPicks: spent,
    leftoverPicks,
  };
}

function parseBidPicks(rawPicks: readonly unknown[]): BidPick[] | Failure {
  const picks: BidPick[] = [];
  for (const raw of rawPicks) {
    const parsed = bidPickSchema.safeParse(raw);
    if (!parsed.success)
      return { error: 'A board pick’s bid points do not have the reviewed shape.' };
    picks.push(parsed.data);
  }
  return picks;
}

/** Every pick the board records as spent is listed by exactly one matched bid. */
function unaccountedSpentPick(
  picks: readonly BidPick[],
  claims: ReadonlyArray<{ claim: FootyinfoBoardBidMatchClaim }>
): Failure | null {
  const listed = claims.flatMap(({ claim }) =>
    claim.consumedPicks.map(({ nativePickId }) => nativePickId)
  );
  const spentOn = new Set(listed);
  if (spentOn.size !== listed.length) {
    return { error: 'A spent pick is listed by more than one matched bid.' };
  }
  const unlisted = picks.find(
    ({ id, status }) => status.id === 'points_used' && !spentOn.has(String(id))
  );
  return unlisted === undefined
    ? null
    : { error: `Board pick ${unlisted.id} used points for no matched bid on the board.` };
}

/**
 * Parser v2's matched bids (issue 789): one `draft_board_bid_match` per selection the board says
 * was a matched bid, in board order. Every spent pick must be one the board records as spent on that
 * nominee, and every pick the board records as spent must be listed by exactly one matched bid, so
 * the points-used picks the adapter does not emit as board rows are all accounted for here. Each
 * bid also names the leftover-points picks the board says it created.
 */
export function readFootyinfoBoardBidMatches(
  rawPicks: readonly unknown[],
  draftYear: number
): { claims: Array<{ sourceKey: string; claim: FootyinfoBoardBidMatchClaim }> } | Failure {
  const picks = parseBidPicks(rawPicks);
  if ('error' in picks) return picks;
  const byId = new Map(picks.map((pick) => [pick.id, pick]));
  const leftovers = leftoversByBid(picks);
  if ('error' in leftovers) return leftovers;
  const claims: Array<{ sourceKey: string; claim: FootyinfoBoardBidMatchClaim }> = [];
  for (const pick of picks) {
    const claim = readBidMatch(pick, byId, leftovers, draftYear);
    if (claim === null) continue;
    if ('error' in claim) return claim;
    claims.push({ sourceKey: `${draftYear}:national:pick:${pick.id}:bid_match`, claim });
  }
  return unaccountedSpentPick(picks, claims) ?? { claims };
}
