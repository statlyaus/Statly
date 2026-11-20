import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { PLAYER_NUMERIC_FIELDS } from '../../../etl/normalizePlayerRow';
import { readPerGameValue } from '@/server/players/readModels/leaguePlayerStatReadModel';

import {
  APP_STAT_KEY,
  listPoolPlayers,
  listStatSeasons,
  toPoolPlayer,
  toSeasonStatSource,
} from './playerPoolReadModel';

const season2026 = {
  season: 2026,
  games: 10,
  totalsJson: { goals: 20, tackles: 45, disposal_efficiency: 750, contested_possessions: 90 },
  gamesByStatJson: { goals: 10, tackles: 9, disposal_efficiency: 10, contested_possessions: 10 },
};

describe('toSeasonStatSource', () => {
  it('maps ETL keys to app keys and keeps fully reported counts as totals', () => {
    const source = toSeasonStatSource(season2026);
    expect(source.games).toBe(10);
    expect(source.stats).toMatchObject({ goals: 20, contestedPossessions: 90 });
    expect(source.basisByStat).toMatchObject({ goals: 'TOTAL', contestedPossessions: 'TOTAL' });
    expect(readPerGameValue(source, 'goals')).toBe(2);
  });

  it('averages percentages and partly reported stats over the games that reported them', () => {
    const source = toSeasonStatSource(season2026);
    expect(source.stats).toMatchObject({ disposalEfficiency: 75, tackles: 50 });
    expect(source.basisByStat).toMatchObject({ disposalEfficiency: 'PER_GAME', tackles: 'TOTAL' });
    expect(readPerGameValue(source, 'tackles')).toBe(5);
  });

  it('maps every stat the ETL stores, and nothing else', () => {
    expect(Object.keys(APP_STAT_KEY).sort()).toEqual([...PLAYER_NUMERIC_FIELDS].sort());
  });

  it('drops unknown keys and malformed JSON', () => {
    expect(
      toSeasonStatSource({
        season: 2026,
        games: 1,
        totalsJson: { mystery: 3 },
        gamesByStatJson: [],
      }).stats
    ).toEqual({});
  });
});

describe('toPoolPlayer', () => {
  const player = {
    id: 'cuid-walsh',
    name: 'Sam Walsh',
    club: 'Carlton',
    position: 'MID',
    seasonStats: [{ ...season2026, season: 2025, games: 4 }, season2026],
  };

  it('uses the canonical id and shows the latest season by default', () => {
    expect(toPoolPlayer(player)).toMatchObject({
      id: 'cuid-walsh',
      team: 'Carlton',
      position: 'MID',
      games: 10,
      statsSeason: 2026,
      availableStatSeasons: [2026, 2025],
    });
  });

  it('shows the picked season, and no stats for a season the player has none in', () => {
    expect(toPoolPlayer(player, 2025)).toMatchObject({ games: 4, statsSeason: 2025 });
    expect(toPoolPlayer(player, 2024)).toMatchObject({ games: 0, stats: {}, statsSeason: 2024 });
  });
});

describe('listStatSeasons', () => {
  it('groups the stored seasons in the database, latest first', async () => {
    const groupBy = vi.fn().mockResolvedValue([{ season: 2026 }, { season: 2025 }]);
    await expect(listStatSeasons({ playerSeasonStat: { groupBy } } as never)).resolves.toEqual([
      2026, 2025,
    ]);
    expect(groupBy).toHaveBeenCalledWith({ by: ['season'], orderBy: { season: 'desc' } });
  });
});

describe('listPoolPlayers', () => {
  it('reads active Prisma players with only the shown season, filtered in the query', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await listPoolPlayers({ query: 'mid', season: 2026 }, { player: { findMany } } as never);
    const args = findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      active: true,
      OR: [
        { name: { contains: 'mid', mode: 'insensitive' } },
        { club: { contains: 'mid', mode: 'insensitive' } },
        { position: { contains: 'mid', mode: 'insensitive' } },
      ],
    });
    expect(args.select.seasonStats.where).toEqual({ season: { in: [2026] } });
    expect(args.orderBy).toEqual({ name: 'asc' });
  });

  it('lists everyone who played a past season, active or not', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await listPoolPlayers({ season: 2025, playedOnly: true }, { player: { findMany } } as never);
    expect(findMany.mock.calls[0][0].where).toEqual({ seasonStats: { some: { season: 2025 } } });
  });

  it('lists every active player, without stats, before any season is filled', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await listPoolPlayers({ season: null }, { player: { findMany } } as never);
    const args = findMany.mock.calls[0][0];
    expect(args.where).toEqual({ active: true });
    expect(args.select.seasonStats.where).toEqual({ season: { in: [] } });
  });
});
