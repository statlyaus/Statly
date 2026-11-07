import 'server-only';

import { prisma } from '@/lib/prisma';

import { requireBasketballLeagueOwner } from './basketballLeagueAccess';
import {
  leagueDetailInclude,
  toBasketballLeagueDetail,
  type BasketballLeagueDetail,
  type BasketballLeagueSummary,
  type NbaPlayerCandidate,
  type NbaPlayerSearchResult,
  type PastedRosterLine,
} from './basketballLeagueDto';
import { BasketballLeagueError, fieldError, leagueNotFound } from './basketballLeagueErrors';
import {
  MAX_ROSTER_BATCH,
  parseInput,
  pasteSchema,
  playerSearchSchema,
} from './basketballLeagueValidation';
import { cleanPastedLine, matchPlayerNames, searchPlayersByName } from './basketballPlayerMatching';

export async function listBasketballLeagues(userId: string): Promise<BasketballLeagueSummary[]> {
  const leagues = await prisma.basketballLeague.findMany({
    where: { ownerId: userId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      name: true,
      platform: true,
      format: true,
      season: true,
      teamCount: true,
      createdAt: true,
      teams: { where: { isMine: true }, select: { name: true } },
    },
  });
  return leagues.map(({ teams, createdAt, ...league }) => ({
    ...league,
    myTeamName: teams[0]?.name ?? '',
    createdAt: createdAt.toISOString(),
  }));
}

/** The whole profile: settings, teams, roster spots with player details, and matchups. 404 unless owned. */
export async function getBasketballLeagueDetail(
  userId: string,
  leagueId: string
): Promise<BasketballLeagueDetail> {
  const league = await prisma.basketballLeague.findFirst({
    where: { id: leagueId, ownerId: userId },
    include: leagueDetailInclude,
  });
  if (!league) throw leagueNotFound();
  return toBasketballLeagueDetail(league);
}

/** For pages: the owned profile, or null for a missing or someone else's league (call `notFound()`). */
export async function loadOwnedBasketballLeague(
  userId: string,
  leagueId: string
): Promise<BasketballLeagueDetail | null> {
  try {
    return await getBasketballLeagueDetail(userId, leagueId);
  } catch (error) {
    if (error instanceof BasketballLeagueError && error.code === 'NOT_FOUND') return null;
    throw error;
  }
}

const playerSelect = {
  id: true,
  fullName: true,
  lastName: true,
  active: true,
  positions: true,
  team: { select: { code: true } },
} as const;

/** Active NBA players whose name contains the query, accents and punctuation ignored. */
export async function searchNbaPlayers(
  query: unknown,
  options: { limit?: unknown } = {}
): Promise<NbaPlayerSearchResult[]> {
  const { q, limit } = parseInput(playerSearchSchema, { q: query, limit: options.limit });
  // ponytail: loads every active player (~600 rows) per search; add a normalised-name column if
  // the player table or search traffic grows enough to matter.
  const players = await prisma.nbaPlayer.findMany({
    where: { active: true },
    select: playerSelect,
  });
  return searchPlayersByName(q, players, limit).map((player) => ({
    id: player.id,
    fullName: player.fullName,
    teamCode: player.team?.code ?? null,
    positions: player.positions,
  }));
}

/**
 * Proposes NBA players for each line of a pasted roster. Writes NOTHING: this is the review step of
 * a reviewed identity operation. The client shows each proposal, the user confirms player ids, and
 * only `addBasketballRosterSpots` with those confirmed ids saves anything.
 */
export async function matchPastedRoster(
  userId: string,
  leagueId: string,
  input: unknown
): Promise<PastedRosterLine[]> {
  const { text } = parseInput(pasteSchema, input);
  const lines = text
    .split(/\r?\n/)
    .map((raw, index) => ({ line: index + 1, text: raw.trim(), name: cleanPastedLine(raw) }))
    .filter((line) => line.name);
  if (lines.length === 0) throw fieldError('text', 'No player names found in the pasted text');
  if (lines.length > MAX_ROSTER_BATCH) {
    throw fieldError('text', `Paste at most ${MAX_ROSTER_BATCH} players at a time`);
  }

  await requireBasketballLeagueOwner(prisma, leagueId, userId);
  const [players, spots] = await Promise.all([
    prisma.nbaPlayer.findMany({ select: playerSelect }),
    prisma.basketballRosterSpot.findMany({
      where: { leagueId },
      select: { playerId: true, teamId: true, team: { select: { name: true } } },
    }),
  ]);
  const spotByPlayer = new Map(spots.map((spot) => [spot.playerId, spot]));
  const toCandidate = (player: (typeof players)[number]): NbaPlayerCandidate => {
    const spot = spotByPlayer.get(player.id);
    return {
      id: player.id,
      fullName: player.fullName,
      teamCode: player.team?.code ?? null,
      positions: player.positions,
      rostered: spot ? { teamId: spot.teamId, teamName: spot.team?.name ?? null } : null,
    };
  };

  const matches = matchPlayerNames(
    lines.map((line) => line.name),
    players
  );
  return lines.map((line, index) => ({
    ...line,
    status: matches[index].status,
    candidates: matches[index].candidates.map(toCandidate),
  }));
}
