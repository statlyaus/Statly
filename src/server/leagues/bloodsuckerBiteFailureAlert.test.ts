import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const prisma = vi.hoisted(() => ({
  leagueBite: { findMany: vi.fn(), updateMany: vi.fn() },
  league: { findMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
const logger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger }));

const { sweepDueBloodsuckerBites } = await import('./bloodsuckerAutoBite');

const bite = {
  id: 'bite-7',
  leagueId: 'league-3',
  seasonId: 'season-1',
  status: 'OPEN',
  deadlineAt: new Date('2026-05-01T00:00:00Z'),
  failureCount: 0,
  league: { activeSeasonId: 'season-1' },
};

describe('Bloodsucker bite failure alert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.leagueBite.findMany.mockResolvedValue([bite]);
  });

  it('names the league and bite in the alert the first failure raises', async () => {
    prisma.leagueBite.updateMany.mockResolvedValue({ count: 1 });
    const run = vi.fn().mockRejectedValue(new Error('swap failed'));

    const result = await sweepDueBloodsuckerBites(new Date('2026-05-02T00:00:00Z'), run);

    expect(result.failedLeagueIds).toEqual(['league-3']);
    expect(logger.error).toHaveBeenCalledWith(
      'Bloodsucker auto-bite failed: league league-3, bite bite-7',
      expect.objectContaining({ leagueId: 'league-3', biteId: 'bite-7', error: 'swap failed' })
    );
  });

  it('names the league and bite in the warning for a bite already alerted', async () => {
    prisma.leagueBite.updateMany.mockResolvedValue({ count: 0 });
    const run = vi.fn().mockRejectedValue(new Error('swap failed'));

    const result = await sweepDueBloodsuckerBites(new Date('2026-05-02T00:00:00Z'), run);

    expect(result.knownFailingBiteIds).toEqual(['bite-7']);
    expect(logger.warn).toHaveBeenCalledWith(
      'Bloodsucker auto-bite is still failing: league league-3, bite bite-7',
      expect.objectContaining({ biteId: 'bite-7' })
    );
  });
});
