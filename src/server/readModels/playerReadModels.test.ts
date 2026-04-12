import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: {},
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {},
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { resolveLatestProjectedSeason } from '@/server/readModels/playerReadModels';

describe('resolveLatestProjectedSeason', () => {
  it('prefers the latest published projection season', async () => {
    const prismaClient = {
      playerProjectionPublication: {
        findFirst: vi.fn().mockResolvedValue({ season: 2026 }),
      },
      playerRankingSnapshot: {
        count: vi.fn(),
        findFirst: vi.fn(),
      },
      playerSeasonSummary: {
        count: vi.fn(),
        findFirst: vi.fn(),
      },
    } as unknown as Parameters<typeof resolveLatestProjectedSeason>[0];

    await expect(resolveLatestProjectedSeason(prismaClient, 2025)).resolves.toBe(2026);
    expect(prismaClient.playerRankingSnapshot.count).not.toHaveBeenCalled();
    expect(prismaClient.playerSeasonSummary.count).not.toHaveBeenCalled();
  });

  it('does not promote a season that only has partial projected data', async () => {
    const rankingCount = vi
      .fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(422)
      .mockResolvedValueOnce(0);
    const summaryCount = vi
      .fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(422)
      .mockResolvedValueOnce(422)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    const prismaClient = {
      playerProjectionPublication: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      playerRankingSnapshot: {
        count: rankingCount,
        findFirst: vi.fn().mockResolvedValue(null),
      },
      playerSeasonSummary: {
        count: summaryCount,
        findFirst: vi.fn().mockResolvedValue({ season: 2024 }),
      },
    } as unknown as Parameters<typeof resolveLatestProjectedSeason>[0];

    await expect(resolveLatestProjectedSeason(prismaClient, 2026)).resolves.toBe(2025);
  });
});
