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
  /** Dates whose stats are in: before today, or today once every game is final and ingested. */
  playedDates: EasternDate[];
  /** The other dates of the week: projected. */
  remainingDates: EasternDate[];
  /** NBA team ids with a game on each date (postponed and cancelled games are not games). */
  teamsByDate: Record<EasternDate, string[]>;
  /** FINAL games on played dates: the box-score lines that count this week. */
  finalGames: { gameId: string; date: EasternDate }[];
  /** Games per NBA team id this week, and how many fall on remaining dates. */
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
  const played = new Set(
    range.dates.filter(
      (date) =>
        date < today ||
        (date === today &&
          games.some((game) => game.date === date) &&
          games.filter((game) => game.date === date).every(isDone))
    )
  );
  const remainingDates = range.dates.filter((date) => !played.has(date));

  const teamsByDate: Record<EasternDate, string[]> = Object.fromEntries(
    range.dates.map((date) => [
      date,
      games
        .filter((game) => game.date === date)
        .flatMap((game) => [game.homeTeamId, game.awayTeamId]),
    ])
  );
  const gamesByTeam: WeekSchedule['gamesByTeam'] = {};
  for (const date of range.dates) {
    for (const teamId of teamsByDate[date]) {
      const counts = (gamesByTeam[teamId] ??= { total: 0, remaining: 0 });
      counts.total += 1;
      if (!played.has(date)) counts.remaining += 1;
    }
  }

  return {
    week: range.week,
    start: range.start,
    end: range.end,
    dates: range.dates,
    today,
    playedDates: range.dates.filter((date) => played.has(date)),
    remainingDates,
    teamsByDate,
    finalGames: games
      .filter((game) => played.has(game.date) && game.status === 'FINAL')
      .map((game) => ({ gameId: game.id, date: game.date })),
    gamesByTeam,
  };
}
