import { beforeEach, describe, expect, it, vi } from 'vitest';

const pool = vi.hoisted(() => ({
  listStatSeasons: vi.fn(),
  listSeasonStatPlayers: vi.fn(),
}));
vi.mock('@/server/players/playerPoolReadModel', () => pool);

import {
  loadDraftPlayerStatsLookup,
  loadDraftStatSeasonOptions,
} from '@/server/draft/readModels/draftPlayerReadModel';

beforeEach(() => {
  pool.listStatSeasons.mockReset().mockResolvedValue([2026, 2025]);
  pool.listSeasonStatPlayers.mockReset().mockResolvedValue([]);
});

describe('loadDraftStatSeasonOptions', () => {
  it('defaults to the newest stored season', async () => {
    await expect(loadDraftStatSeasonOptions()).resolves.toEqual({
      selectedSeason: 2026,
      availableSeasons: [2026, 2025],
    });
  });

  it('uses a requested season that has stored stats, and the newest otherwise', async () => {
    await expect(loadDraftStatSeasonOptions(2025)).resolves.toMatchObject({ selectedSeason: 2025 });
    await expect(loadDraftStatSeasonOptions(2019)).resolves.toMatchObject({ selectedSeason: 2026 });
  });
});

describe('loadDraftPlayerStatsLookup', () => {
  it("reads only the requested season's stored stats", async () => {
    await loadDraftPlayerStatsLookup({ season: 2025 });
    expect(pool.listSeasonStatPlayers).toHaveBeenCalledWith({ season: 2025 }, undefined);
    expect(pool.listStatSeasons).not.toHaveBeenCalled();
  });

  it('reads the newest stored season when none is requested', async () => {
    await loadDraftPlayerStatsLookup();
    expect(pool.listSeasonStatPlayers).toHaveBeenCalledWith({ season: 2026 }, undefined);
  });

  it("reads through the caller's transaction when given one", async () => {
    const tx = { playerSeasonStat: {} };
    await loadDraftPlayerStatsLookup({}, tx as never);
    expect(pool.listStatSeasons).toHaveBeenCalledWith(tx);
    expect(pool.listSeasonStatPlayers).toHaveBeenCalledWith({ season: 2026 }, tx);
  });
});
