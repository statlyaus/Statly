import 'server-only';

import {
  dateOnlyToString,
  fantasyWeekRange,
  stringToDateOnly,
  toEasternDate,
  type EasternDate,
} from '@/lib/basketball/fantasyWeeks';
import { prisma } from '@/lib/prisma';
import type { BasketballLeagueDetail } from '@/server/basketball/leagues/basketballLeagueDto';

import type { NbaReadClient } from './playerPool';

export interface WeekSchedule {
  week: number;
  start: EasternDate;
  end: EasternDate;
  dates: EasternDate[];
  today: EasternDate;
  /** Dates with a game that counts: final with its box score in. */
  playedDates: EasternDate[];
  /**
   * Dates with a game still to count: not yet final, or final without its box score (a late tip-off
   * or ingest lag), whatever the date. A date can be in both lists.
   */
  remainingDates: EasternDate[];
  /** Dates with any game (postponed and cancelled games are not games). */
  gameDates: EasternDate[];
  /** NBA team ids with a game still to count on each date: these are projected. */
  teamsByDate: Record<EasternDate, string[]>;
  /** Final games with their box score in: the lines that count this week. */
  finalGames: { gameId: string; date: EasternDate }[];
  /** Games per NBA team id this week, and how many are still to count. */
  gamesByTeam: Record<string, { total: number; remaining: number }>;
}

/** One fantasy week's NBA games (Eastern dates), for the league's season and calendar. */
export async function loadWeekSchedule(
  league: BasketballLeagueDetail,
  week: number,
  options: { today?: EasternDate; client?: NbaReadClient } = {}
): Promise<WeekSchedule> {
  const client = options.client ?? prisma;
  const today = options.today ?? toEasternDate(new Date());
  const range = fantasyWeekRange(week, league.weekOneStartsOn, league.twoWeekMatchups);

  const rows = await client.nbaGame.findMany({
    where: {
      season: league.season,
      gameDate: { gte: stringToDateOnly(range.start), lte: stringToDateOnly(range.end) },
    },
    select: {
      id: true,
      gameDate: true,
      status: true,
      homeTeamId: true,
      awayTeamId: true,
      boxScoreIngestedAt: true,
    },
    orderBy: [{ gameDate: 'asc' }, { startsAt: 'asc' }],
  });
  const games = rows
    .map((row) => ({ ...row, date: dateOnlyToString(row.gameDate) }))
    .filter((game) => game.status !== 'POSTPONED' && game.status !== 'CANCELLED');

  const isDone = (game: (typeof games)[number]) =>
    game.status === 'FINAL' && game.boxScoreIngestedAt !== null;
  const done = games.filter(isDone);
  const toCount = games.filter((game) => !isDone(game));
  const datesOf = (list: typeof games) =>
    range.dates.filter((date) => list.some((game) => game.date === date));

  const teamsByDate: Record<EasternDate, string[]> = Object.fromEntries(
    range.dates.map((date) => [
      date,
      toCount
        .filter((game) => game.date === date)
        .flatMap((game) => [game.homeTeamId, game.awayTeamId]),
    ])
  );
  const gamesByTeam: WeekSchedule['gamesByTeam'] = {};
  for (const game of games) {
    for (const teamId of [game.homeTeamId, game.awayTeamId]) {
      const counts = (gamesByTeam[teamId] ??= { total: 0, remaining: 0 });
      counts.total += 1;
      if (!isDone(game)) counts.remaining += 1;
    }
  }

  return {
    week: range.week,
    start: range.start,
    end: range.end,
    dates: range.dates,
    today,
    playedDates: datesOf(done),
    remainingDates: datesOf(toCount),
    gameDates: datesOf(games),
    teamsByDate,
    finalGames: done.map((game) => ({ gameId: game.id, date: game.date })),
    gamesByTeam,
  };
}
