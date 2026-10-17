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

/**
 * One spent pick as the matched bid lists it, checked against the board's own record of that pick:
 * spent on this nominee, with the same points, holder, original club, original number and label.
 */
function readSpentPick(
  entry: z.infer<typeof spentPickSchema>,
  nominee: BidPick,
  picks: ReadonlyMap<number, BidPick>
): SpentPick | Failure {
  const board = picks.get(entry.id);
  if (
    board === undefined ||
    board.status.id !== 'points_used' ||
    board.purchased_from?.pick_id !== nominee.id ||
    board.points_used !== entry.points_used ||
    board.team.abbrev !== entry.team.abbrev ||
    board.original?.team?.abbrev !== entry.original_team.abbrev ||
    (board.original_number ?? null) !== entry.original_number ||
    board.round === undefined ||
    entry.label !== spentPickLabel(board.round, entry)
  ) {
    return {
      error: `Matched bid ${nominee.id} lists spent pick ${entry.id}, which the board does not record as spent on it.`,
    };
  }
  return {
    nativePickId: String(entry.id),
    label: entry.label,
    originalNumber: entry.original_number,
    originalClubCode: entry.original_team.abbrev,
    holdingClubCode: entry.team.abbrev,
    pointsUsed: entry.points_used,
  };
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

function readBidMatch(
  pick: BidPick,
  picks: ReadonlyMap<number, BidPick>,
  leftovers: ReadonlyMap<number, LeftoverPick[]>,
  draftYear: number
): FootyinfoBoardBidMatchClaim | Failure | null {
  if (pick.status.id === 'points_used') return null;
  const bidTeam = pick.bid?.team;
  if (bidTeam === undefined) {
    return pick.consumed_picks === undefined && pick.points_used === undefined
      ? null
      : { error: `Board pick ${pick.id} states points used without a matched bid.` };
  }
  const reason = pick.bid!.match_reason;
  if (
    pick.number === undefined ||
    pick.player === undefined ||
    pick.points === undefined ||
    !Object.hasOwn(FOOTYINFO_BID_BASIS, reason)
  ) {
    return { error: `Matched bid ${pick.id} has no selection, points or reviewed basis.` };
  }
  const spent: SpentPick[] = [];
  for (const entry of pick.consumed_picks ?? []) {
    const read = readSpentPick(entry, pick, picks);
    if ('error' in read) return read;
    spent.push(read);
  }
  const spentPoints = spent.reduce((total, { pointsUsed }) => total + pointsUsed, 0);
  if ((pick.points_used === undefined) !== (spent.length === 0)) {
    return {
      error: `Matched bid ${pick.id} states points used without spent picks, or the reverse.`,
    };
  }
  if (pick.points_used !== undefined && spentPoints < pick.points_used) {
    return { error: `Matched bid ${pick.id} used more points than its spent picks hold.` };
  }
  const leftoverPicks = leftovers.get(pick.id) ?? [];
  if (!leftoverMatchesExcess(pick.points_used ?? null, spentPoints, leftoverPicks)) {
    return {
      error: `Matched bid ${pick.id} has spent points its leftover pick does not account for.`,
    };
  }
  return {
    kind: 'draft_board_bid_match',
    draftYear,
    draftType: 'national',
    nativePickId: String(pick.id),
    selectionNumber: pick.number,
    roundNumber: pick.round ?? null,
    club: entity(pick.team),
    player: { nativeId: pick.player.slug, recordedName: pick.player.known_as },
    bid: {
      club: entity(bidTeam),
      basis: FOOTYINFO_BID_BASIS[reason as keyof typeof FOOTYINFO_BID_BASIS],
    },
    points: pick.points,
    pointsUsed: pick.points_used ?? null,
    consumedPicks: spent,
    leftoverPicks,
  };
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
  const picks: BidPick[] = [];
  for (const raw of rawPicks) {
    const parsed = bidPickSchema.safeParse(raw);
    if (!parsed.success)
      return { error: 'A board pick’s bid points do not have the reviewed shape.' };
    picks.push(parsed.data);
  }
  const byId = new Map(picks.map((pick) => [pick.id, pick]));
  const leftovers = leftoversByBid(picks);
  if ('error' in leftovers) return leftovers;
  const spentOn = new Set<string>();
  const claims: Array<{ sourceKey: string; claim: FootyinfoBoardBidMatchClaim }> = [];
  for (const pick of picks) {
    const claim = readBidMatch(pick, byId, leftovers, draftYear);
    if (claim === null) continue;
    if ('error' in claim) return claim;
    for (const { nativePickId } of claim.consumedPicks) {
      if (spentOn.has(nativePickId)) {
        return { error: `Spent pick ${nativePickId} is listed by more than one matched bid.` };
      }
      spentOn.add(nativePickId);
    }
    claims.push({ sourceKey: `${draftYear}:national:pick:${pick.id}:bid_match`, claim });
  }
  const unlisted = picks.find(
    ({ id, status }) => status.id === 'points_used' && !spentOn.has(String(id))
  );
  if (unlisted !== undefined) {
    return { error: `Board pick ${unlisted.id} used points for no matched bid on the board.` };
  }
  return { claims };
}
