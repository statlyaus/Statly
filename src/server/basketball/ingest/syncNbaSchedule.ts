import { dateOnlyToString, stringToDateOnly } from '@/lib/basketball/fantasyWeeks';

import {
  type NbaIngestJobOptions,
  type NbaIngestPrisma,
  type NbaIngestResult,
  recordNbaIngestRun,
} from './nbaIngestRun';
import { NbaIngestRejected, type NbaProviderGame } from './nbaStatsProvider';
import { fetchThirtyTeams } from './syncNbaPlayers';

/**
 * SCHEDULE job: every team's regular-season schedule for one season, upserted into NbaGame by
 * (provider, externalId). Only new or changed games are written. Rejected, writing nothing but the
 * run row, unless the season has 1,100 to 1,300 distinct games: a full season is 1,230 (82 × 30 / 2);
 * ESPN lists 1,200 until the NBA Cup knockout games are set in December. The Cup final is not a
 * regular-season game and the adapter never returns it.
 */

export const MIN_SEASON_GAMES = 1100;
export const MAX_SEASON_GAMES = 1300;

export interface NbaScheduleSummary {
  season: number;
  games: number;
  final: number;
  created: number;
  updated: number;
}

/** NbaTeam ids by code. Teams come from the PLAYERS job, so a missing code fails the run. */
export async function loadTeamIds(
  prisma: NbaIngestPrisma,
  codes: Iterable<string>
): Promise<Map<string, string>> {
  const wanted = [...new Set(codes)];
  const rows = await prisma.nbaTeam.findMany({
    where: { code: { in: wanted } },
    select: { id: true, code: true },
  });
  const ids = new Map(rows.map((row) => [row.code, row.id]));
  const missing = wanted.filter((code) => !ids.has(code));
  if (missing.length > 0) {
    throw new Error(`No NbaTeam for ${missing.join(', ')}: run the players job first`);
  }
  return ids;
}

export function nbaGameData(game: NbaProviderGame, teamIds: Map<string, string>) {
  return {
    season: game.season,
    startsAt: game.startsAt,
    gameDate: stringToDateOnly(game.gameDate),
    homeTeamId: teamIds.get(game.homeTeamCode) as string,
    awayTeamId: teamIds.get(game.awayTeamCode) as string,
    status: game.status,
    homeScore: game.homeScore,
    awayScore: game.awayScore,
  };
}

export async function syncNbaSchedule(
  options: NbaIngestJobOptions
): Promise<NbaIngestResult<NbaScheduleSummary>> {
  const { prisma, provider, season } = options;
  return recordNbaIngestRun('SCHEDULE', options, async () => {
    const teams = await fetchThirtyTeams(provider);
    const schedules = await Promise.all(
      teams.map((team) => provider.fetchTeamSchedule(team.externalId, season))
    );
    const games = new Map<string, NbaProviderGame>();
    for (const game of schedules.flat()) {
      if (game.season === season) games.set(game.externalId, game);
    }
    if (games.size < MIN_SEASON_GAMES || games.size > MAX_SEASON_GAMES) {
      throw new NbaIngestRejected(
        'out_of_bounds',
        `Expected ${MIN_SEASON_GAMES} to ${MAX_SEASON_GAMES} regular-season games for ${season}, got ${games.size}`
      );
    }

    const teamIds = await loadTeamIds(
      prisma,
      [...games.values()].flatMap((game) => [game.homeTeamCode, game.awayTeamCode])
    );
    const existing = await prisma.nbaGame.findMany({
      where: { provider: provider.id, externalId: { in: [...games.keys()] } },
      select: {
        id: true,
        externalId: true,
        season: true,
        startsAt: true,
        gameDate: true,
        homeTeamId: true,
        awayTeamId: true,
        status: true,
        homeScore: true,
        awayScore: true,
      },
    });
    const existingByExternalId = new Map(existing.map((row) => [row.externalId, row]));

    const toCreate = [];
    let updated = 0;
    for (const game of games.values()) {
      const data = nbaGameData(game, teamIds);
      const row = existingByExternalId.get(game.externalId);
      if (!row) {
        toCreate.push({ provider: provider.id, externalId: game.externalId, ...data });
        continue;
      }
      const unchanged =
        row.season === data.season &&
        row.startsAt.getTime() === data.startsAt.getTime() &&
        dateOnlyToString(row.gameDate) === game.gameDate &&
        row.homeTeamId === data.homeTeamId &&
        row.awayTeamId === data.awayTeamId &&
        row.status === data.status &&
        row.homeScore === data.homeScore &&
        row.awayScore === data.awayScore;
      if (!unchanged) {
        await prisma.nbaGame.update({ where: { id: row.id }, data });
        updated += 1;
      }
    }
    if (toCreate.length > 0) await prisma.nbaGame.createMany({ data: toCreate });

    return {
      season,
      games: games.size,
      final: [...games.values()].filter((game) => game.status === 'FINAL').length,
      created: toCreate.length,
      updated,
    };
  });
}
