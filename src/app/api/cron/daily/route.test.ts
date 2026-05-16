import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const refreshPlayerReadModelsMock = vi.fn();
const publishPlayerRankingsMock = vi.fn();
const publishLeagueRosterSummariesMock = vi.fn();

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/server/readModels/playerReadModels', () => ({
  refreshPlayerReadModels: (...args: unknown[]) => refreshPlayerReadModelsMock(...args),
  publishPlayerRankings: (...args: unknown[]) => publishPlayerRankingsMock(...args),
  publishLeagueRosterSummaries: (...args: unknown[]) =>
    publishLeagueRosterSummariesMock(...args),
}));

describe('GET /api/cron/daily', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    refreshPlayerReadModelsMock.mockResolvedValue({
      season: 2026,
      playerSeasonSummaries: 460,
      rankingSnapshots: 458,
      rosterSummaries: 456,
      published: false,
      rankingsDirty: true,
      rostersDirty: true,
      degradedAdvancedStats: [],
      refreshedPlayerIds: 460,
      refreshedRounds: [],
    });
    publishPlayerRankingsMock.mockResolvedValue({
      season: 2026,
      scope: 'season',
      rankingSnapshots: 458,
      published: false,
      degradedAdvancedStats: [],
    });
    publishLeagueRosterSummariesMock.mockResolvedValue({
      season: 2026,
      scope: 'season',
      rosterSummaries: 456,
      published: true,
      rostersDirty: false,
      degradedAdvancedStats: [],
    });
  });

  it('runs explicit refresh, ranking publication, and roster publication in order', async () => {
    const { GET } = await import('./route');
    const response = await GET(
      new NextRequest('http://localhost/api/cron/daily?season=2026&token=cron-secret')
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(refreshPlayerReadModelsMock).toHaveBeenCalledWith({
      season: 2026,
      leagueId: undefined,
    });
    expect(publishPlayerRankingsMock).toHaveBeenCalledWith({
      season: 2026,
    });
    expect(publishLeagueRosterSummariesMock).toHaveBeenCalledWith({
      season: 2026,
      leagueId: undefined,
    });
    expect(body.ok).toBe(true);
    expect(body.refreshResult.rankingsDirty).toBe(true);
    expect(body.rankingResult.rankingSnapshots).toBe(458);
    expect(body.rosterResult.rosterSummaries).toBe(456);
  });

  it('rejects requests with an invalid token', async () => {
    const { GET } = await import('./route');
    const response = await GET(
      new NextRequest('http://localhost/api/cron/daily?season=2026&token=wrong-secret')
    );

    expect(response.status).toBe(401);
    expect(refreshPlayerReadModelsMock).not.toHaveBeenCalled();
    expect(publishPlayerRankingsMock).not.toHaveBeenCalled();
    expect(publishLeagueRosterSummariesMock).not.toHaveBeenCalled();
  });

  it('rejects requests without a configured token outside local development', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', '');

    const { GET } = await import('./route');
    const response = await GET(
      new NextRequest('http://localhost/api/cron/daily?season=2026')
    );

    expect(response.status).toBe(401);
    expect(refreshPlayerReadModelsMock).not.toHaveBeenCalled();
    expect(publishPlayerRankingsMock).not.toHaveBeenCalled();
    expect(publishLeagueRosterSummariesMock).not.toHaveBeenCalled();
  });
});
