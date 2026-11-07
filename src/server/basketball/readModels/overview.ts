import 'server-only';

import type { PrismaClient } from '@prisma/client';

import {
  dateOnlyToString,
  fantasyWeekOf,
  fantasyWeekRange,
  lastFantasyWeek,
  stringToDateOnly,
  toEasternDate,
  type EasternDate,
  type FantasyWeekRange,
} from '@/lib/basketball/fantasyWeeks';
import { prisma as sharedPrisma } from '@/lib/prisma';
import type {
  BasketballLeagueDetail,
  BasketballPlayerInjuryDto,
} from '@/server/basketball/leagues/basketballLeagueDto';

/**
 * The basketball Overview page: this week's opponent, games left this week for the user's roster
 * and the opponent's, injuries, and how fresh the NBA data is. Takes the league detail the page
 * already loaded through the owner-scoped `loadOwnedBasketballLeague`; NBA reads are by season and
 * by the NBA teams of the players on this league's rosters.
 *
 * Games are raw NBA games (postponed and cancelled ones excluded), not games that would count under
 * the league's lineup slots: the Matchup page does that simulation.
 */

/** NBA data older than this is shown as stale. */
export const OVERVIEW_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export type OverviewClient = Pick<PrismaClient, 'nbaPlayer' | 'nbaGame' | 'nbaIngestRun'>;

export interface BasketballOverviewPlayer {
  playerId: string;
  fullName: string;
  teamCode: string | null;
  positions: string[];
  onInjuredList: boolean;
  injury: BasketballPlayerInjuryDto | null;
  /** NBA games this fantasy week. */
  gamesThisWeek: number;
  /** Games this week from today on that have not finished. */
  gamesLeft: number;
  /** False when on the injured list or ruled OUT: his games are left out of the team's total. */
  counted: boolean;
}

export interface BasketballOverviewSide {
  teamId: string;
  name: string;
  players: BasketballOverviewPlayer[];
  /** Games left this week from counted players (not on the injured list, not ruled OUT). */
  gamesLeft: number;
}

export interface BasketballDataFreshness {
  /** Finish time of the latest successful run; null when none has succeeded. */
  updatedAt: string | null;
  stale: boolean;
}

export interface BasketballOverview {
  today: EasternDate;
  phase: 'PRESEASON' | 'IN_SEASON' | 'ENDED';
  /** The current fantasy week: week 1 before the season, the last week after it. */
  week: FantasyWeekRange;
  me: BasketballOverviewSide;
  opponent: BasketballOverviewSide | null;
  stats: BasketballDataFreshness;
  injuryReport: BasketballDataFreshness;
}

export interface LoadBasketballOverviewOptions {
  prisma?: OverviewClient;
  now?: Date;
}

const UNPLAYABLE = new Set(['POSTPONED', 'CANCELLED']);
const UNFINISHED = new Set(['SCHEDULED', 'IN_PROGRESS']);

export function currentFantasyWeek(
  league: Pick<
    BasketballLeagueDetail,
    'weekOneStartsOn' | 'regularSeasonEndsOn' | 'twoWeekMatchups'
  >,
  today: EasternDate
): { phase: BasketballOverview['phase']; week: FantasyWeekRange } {
  const { weekOneStartsOn, regularSeasonEndsOn, twoWeekMatchups } = league;
  const lastWeek = lastFantasyWeek(weekOneStartsOn, regularSeasonEndsOn, twoWeekMatchups);
  const phase =
    today < weekOneStartsOn ? 'PRESEASON' : today > regularSeasonEndsOn ? 'ENDED' : 'IN_SEASON';
  const week = Math.min(fantasyWeekOf(today, weekOneStartsOn, twoWeekMatchups), lastWeek);
  return { phase, week: fantasyWeekRange(week, weekOneStartsOn, twoWeekMatchups) };
}

async function freshness(
  client: OverviewClient,
  job: 'BOX_SCORES' | 'INJURIES',
  now: Date
): Promise<BasketballDataFreshness> {
  const run = await client.nbaIngestRun.findFirst({
    where: { job, outcome: 'SUCCEEDED' },
    orderBy: { finishedAt: { sort: 'desc', nulls: 'last' } },
    select: { finishedAt: true },
  });
  const finishedAt = run?.finishedAt ?? null;
  return {
    updatedAt: finishedAt?.toISOString() ?? null,
    stale: !finishedAt || now.getTime() - finishedAt.getTime() > OVERVIEW_STALE_AFTER_MS,
  };
}

export async function loadBasketballOverview(
  league: BasketballLeagueDetail,
  { prisma = sharedPrisma, now = new Date() }: LoadBasketballOverviewOptions = {}
): Promise<BasketballOverview> {
  const today = toEasternDate(now);
  const { phase, week } = currentFantasyWeek(league, today);
  const opponentTeamId =
    league.matchups.find(
      (matchup) => matchup.week === week.week && matchup.teamId === league.myTeamId
    )?.opponentTeamId ?? null;
  const opponentTeam = league.teams.find((team) => team.id === opponentTeamId) ?? null;
  const myTeam = league.teams.find((team) => team.id === league.myTeamId);
  const sideTeams = [myTeam, opponentTeam].flatMap((team) => (team ? [team] : []));
  const spots = league.rosterSpots.filter((spot) =>
    sideTeams.some((team) => team.id === spot.teamId)
  );

  const nbaPlayers = spots.length
    ? await prisma.nbaPlayer.findMany({
        where: { id: { in: spots.map((spot) => spot.playerId) } },
        select: { id: true, teamId: true },
      })
    : [];
  const nbaTeamByPlayer = new Map(nbaPlayers.map((player) => [player.id, player.teamId]));
  const nbaTeamIds = [
    ...new Set(nbaPlayers.flatMap((player) => (player.teamId ? [player.teamId] : []))),
  ];

  const [games, stats, injuryReport] = await Promise.all([
    nbaTeamIds.length
      ? prisma.nbaGame.findMany({
          where: {
            season: league.season,
            gameDate: { gte: stringToDateOnly(week.start), lte: stringToDateOnly(week.end) },
            OR: [{ homeTeamId: { in: nbaTeamIds } }, { awayTeamId: { in: nbaTeamIds } }],
          },
          select: { gameDate: true, homeTeamId: true, awayTeamId: true, status: true },
        })
      : Promise.resolve([]),
    freshness(prisma, 'BOX_SCORES', now),
    freshness(prisma, 'INJURIES', now),
  ]);

  const gamesByTeam = new Map<string, { thisWeek: number; left: number }>();
  for (const game of games) {
    if (UNPLAYABLE.has(game.status)) continue;
    const left = UNFINISHED.has(game.status) && dateOnlyToString(game.gameDate) >= today;
    for (const teamId of [game.homeTeamId, game.awayTeamId]) {
      const counts = gamesByTeam.get(teamId) ?? { thisWeek: 0, left: 0 };
      counts.thisWeek += 1;
      if (left) counts.left += 1;
      gamesByTeam.set(teamId, counts);
    }
  }

  const toSide = (team: { id: string; name: string }): BasketballOverviewSide => {
    const players = spots
      .filter((spot) => spot.teamId === team.id)
      .map((spot): BasketballOverviewPlayer => {
        const nbaTeamId = nbaTeamByPlayer.get(spot.playerId);
        const counts = (nbaTeamId && gamesByTeam.get(nbaTeamId)) || { thisWeek: 0, left: 0 };
        return {
          playerId: spot.playerId,
          fullName: spot.player.fullName,
          teamCode: spot.player.teamCode,
          positions: spot.player.positions,
          onInjuredList: spot.onInjuredList,
          injury: spot.player.injury,
          gamesThisWeek: counts.thisWeek,
          gamesLeft: counts.left,
          counted: !spot.onInjuredList && spot.player.injury?.status !== 'OUT',
        };
      });
    return {
      teamId: team.id,
      name: team.name,
      players,
      gamesLeft: players
        .filter((player) => player.counted)
        .reduce((total, player) => total + player.gamesLeft, 0),
    };
  };

  if (!myTeam)
    throw new Error(`Basketball league ${league.id} has no team marked as the user's own`);
  return {
    today,
    phase,
    week,
    me: toSide(myTeam),
    opponent: opponentTeam ? toSide(opponentTeam) : null,
    stats,
    injuryReport,
  };
}
