import 'server-only';

import type { PrismaClient } from '@prisma/client';

import { prisma as defaultPrisma } from '@/lib/prisma';
import { leagueSeasonData, SEASON_CHANGE_LOCKED_MESSAGE } from '@/server/leagues/seasonYear';

type ChangeSeasonYearClient = Pick<PrismaClient, '$transaction'>;

export type ChangeLeagueSeasonYearResult =
  { ok: true; year: number } | { ok: false; status: 404 | 409; error: string };

/**
 * Moves the league's active season to another AFL year. Allowed only while the competition is in
 * SETUP: publication builds fixtures and round timings from the season year.
 * Callers authorize the commissioner and validate the year.
 */
export async function changeLeagueSeasonYear(
  input: { leagueId: string; year: number },
  client: ChangeSeasonYearClient = defaultPrisma
): Promise<ChangeLeagueSeasonYearResult> {
  return client.$transaction(async (tx) => {
    const league = await tx.league.findUnique({
      where: { id: input.leagueId },
      select: { activeSeasonId: true, settings: { select: { competitionStatus: true } } },
    });
    if (!league) return { ok: false, status: 404, error: 'League not found' };
    if (league.settings?.competitionStatus !== 'SETUP' || !league.activeSeasonId) {
      return { ok: false, status: 409, error: SEASON_CHANGE_LOCKED_MESSAGE };
    }

    await tx.leagueSeason.update({
      where: { id: league.activeSeasonId },
      data: leagueSeasonData(input.year),
    });
    return { ok: true, year: input.year };
  });
}
