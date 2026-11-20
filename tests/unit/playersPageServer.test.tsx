import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listPoolPlayers: vi.fn(),
  listStatSeasons: vi.fn(),
}));

vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock('@/server/players/playerPoolReadModel', () => mocks);
vi.mock('@/app/(app)/players/PlayersPageClient', () => ({ default: () => null }));

import PlayersPageServer, { pickStatsSeason } from '@/app/(app)/players/PlayersPageServer';

describe('pickStatsSeason', () => {
  it('keeps a requested season that has stats and falls back to the latest otherwise', () => {
    expect(pickStatsSeason('2025', [2026, 2025])).toBe(2025);
    expect(pickStatsSeason('2019', [2026, 2025])).toBe(2026);
    expect(pickStatsSeason(undefined, [2026, 2025])).toBe(2026);
    expect(pickStatsSeason('2026', [])).toBeNull();
  });
});

describe('PlayersPageServer', () => {
  beforeEach(() => {
    mocks.listPoolPlayers.mockReset().mockResolvedValue([{ id: 'cuid-1', name: 'A' }]);
    mocks.listStatSeasons.mockReset().mockResolvedValue([2026, 2025]);
  });

  it('lists the Prisma pool for the picked season and passes the seasons on', async () => {
    const element = await PlayersPageServer({ season: '2025' });

    // A past season lists who played it, active or not.
    expect(mocks.listPoolPlayers).toHaveBeenCalledWith({ season: 2025, playedOnly: true });
    expect(element.props).toMatchObject({
      players: [{ id: 'cuid-1' }],
      seasons: [2026, 2025],
      season: 2025,
    });
  });

  it('lists the active pool for the latest season', async () => {
    await PlayersPageServer({});
    expect(mocks.listPoolPlayers).toHaveBeenCalledWith({ season: 2026, playedOnly: false });
  });

  it('lists the pool without stats before any season is filled', async () => {
    mocks.listStatSeasons.mockResolvedValue([]);
    const element = await PlayersPageServer({});

    expect(mocks.listPoolPlayers).toHaveBeenCalledWith({ season: null, playedOnly: false });
    expect(element.props).toMatchObject({ seasons: [], season: null });
  });
});
