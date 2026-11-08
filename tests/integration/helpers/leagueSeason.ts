import type { PrismaClient } from '@prisma/client';

type SeasonClient = Pick<PrismaClient, 'league' | 'leagueSeason'>;

/**
 * Gives a fixture league an active season, as league creation does, and returns its id. Season-scoped
 * fantasy rows (lineups, scores, standings, waiver claims and priority) need one. The season goes
 * with the league when the league is deleted.
 */
export async function activateLeagueSeason(
  client: SeasonClient,
  leagueId: string,
  year = 2026
): Promise<string> {
  const season = await client.leagueSeason.upsert({
    where: { leagueId_year: { leagueId, year } },
    update: {},
    create: { leagueId, year, label: `${year} season` },
  });
  await client.league.update({ where: { id: leagueId }, data: { activeSeasonId: season.id } });
  return season.id;
}
