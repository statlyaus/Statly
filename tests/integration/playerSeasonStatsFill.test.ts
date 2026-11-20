/**
 * `replacePlayerSeasonStats` on PostgreSQL: a fill replaces one season and nothing else, and a
 * failed fill leaves the season as it was. Seasons 1901 and 1902 are used only by this file.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';
import {
  replacePlayerSeasonStats,
  type PlayerSeasonStatInput,
} from '@/server/players/playerSeasonStats';

const WALSH = 'int-season-stat-walsh';
const CERRA = 'int-season-stat-cerra';

const input = (playerId: string, season: number, goals: number): PlayerSeasonStatInput => ({
  playerId,
  season,
  club: 'Carlton',
  games: 1,
  lastRound: 1,
  totals: { goals },
  gamesByStat: { goals: 1 },
});

async function cleanup() {
  // PlayerSeasonStat rows cascade with their player.
  await prisma.player.deleteMany({ where: { id: { in: [WALSH, CERRA] } } });
}

async function storedGoals(season: number) {
  const rows = await prisma.playerSeasonStat.findMany({
    where: { season, playerId: { in: [WALSH, CERRA] } },
    orderBy: { playerId: 'asc' },
  });
  return rows.map((row) => [row.playerId, (row.totalsJson as { goals: number }).goals]);
}

beforeEach(async () => {
  await cleanup();
  await prisma.player.createMany({
    data: [
      { id: WALSH, name: 'Int Walsh', club: 'Carlton', position: 'MID' },
      { id: CERRA, name: 'Int Cerra', club: 'Carlton', position: 'MID' },
    ],
  });
  await replacePlayerSeasonStats(prisma, 1901, [input(WALSH, 1901, 1), input(CERRA, 1901, 2)]);
  await replacePlayerSeasonStats(prisma, 1902, [input(WALSH, 1902, 9)]);
});

afterAll(cleanup);

describe('replacePlayerSeasonStats', () => {
  it('replaces one season and leaves the others', async () => {
    const result = await replacePlayerSeasonStats(prisma, 1901, [input(CERRA, 1901, 7)]);

    expect(result).toEqual({ deleted: 2, created: 1 });
    expect(await storedGoals(1901)).toEqual([[CERRA, 7]]);
    expect(await storedGoals(1902)).toEqual([[WALSH, 9]]);
  });

  it('keeps the old rows when the fill fails part way', async () => {
    await expect(
      replacePlayerSeasonStats(prisma, 1901, [
        input(WALSH, 1901, 5),
        input('int-season-stat-missing-player', 1901, 5),
      ])
    ).rejects.toThrow();

    expect(await storedGoals(1901)).toEqual([
      [CERRA, 2],
      [WALSH, 1],
    ]);
  });
});
