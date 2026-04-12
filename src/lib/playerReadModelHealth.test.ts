import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resolveLatestProjectedSeasonMock = vi.fn();

vi.mock('@/server/readModels/playerReadModels', () => ({
  resolveLatestProjectedSeason: (...args: unknown[]) => resolveLatestProjectedSeasonMock(...args),
}));

const prismaMock = {
  player: { count: vi.fn() },
  playerSeasonSummary: {
    count: vi.fn(),
    findFirst: vi.fn(),
  },
  playerProjectionPublication: { findFirst: vi.fn() },
};

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}));

describe('getPlayerReadModelHealth', () => {
  beforeEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.clearAllMocks();
    resolveLatestProjectedSeasonMock.mockResolvedValue(2026);
    prismaMock.player.count.mockResolvedValue(10);
    prismaMock.playerSeasonSummary.count.mockImplementation(
      async (args?: { where?: { season?: number } }) => {
        if (args?.where?.season === 2026) return 10;
        return 10;
      }
    );
    prismaMock.playerSeasonSummary.findFirst.mockResolvedValue({
      updatedAt: new Date('2026-01-02T00:00:00Z'),
    });
    prismaMock.playerProjectionPublication.findFirst.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns healthy when summaries exist for resolved season', async () => {
    vi.stubEnv('HEALTH_STRICT_READ_MODELS', 'true');
    const { getPlayerReadModelHealth } = await import('./playerReadModelHealth');
    const result = await getPlayerReadModelHealth();

    expect(result.status).toBe('healthy');
    expect(result.details.summaryGapDetected).toBe(false);
    expect(result.details.evaluationMode).toBe('strict');
  });

  it('returns degraded when strict and summaries missing for resolved season', async () => {
    prismaMock.playerSeasonSummary.count.mockImplementation(
      async (args?: { where?: { season?: number } }) => {
        if (args?.where?.season === 2026) return 0;
        return 0;
      }
    );

    vi.stubEnv('HEALTH_STRICT_READ_MODELS', 'true');
    const { getPlayerReadModelHealth } = await import('./playerReadModelHealth');
    const result = await getPlayerReadModelHealth();

    expect(result.status).toBe('degraded');
    expect(result.details.summaryGapDetected).toBe(true);
    expect(result.details.evaluationMode).toBe('strict');
  });

  it('returns healthy when lenient and summaries missing (typical test / dev)', async () => {
    prismaMock.playerSeasonSummary.count.mockImplementation(
      async (args?: { where?: { season?: number } }) => {
        if (args?.where?.season === 2026) return 0;
        return 0;
      }
    );

    const { getPlayerReadModelHealth } = await import('./playerReadModelHealth');
    const result = await getPlayerReadModelHealth();

    expect(result.status).toBe('healthy');
    expect(result.details.summaryGapDetected).toBe(true);
    expect(result.details.evaluationMode).toBe('lenient');
  });

  it('returns healthy when HEALTH_LENIENT_READ_MODELS overrides strict gap', async () => {
    prismaMock.playerSeasonSummary.count.mockImplementation(
      async (args?: { where?: { season?: number } }) => {
        if (args?.where?.season === 2026) return 0;
        return 0;
      }
    );

    vi.stubEnv('HEALTH_STRICT_READ_MODELS', 'true');
    vi.stubEnv('HEALTH_LENIENT_READ_MODELS', 'true');
    const { getPlayerReadModelHealth } = await import('./playerReadModelHealth');
    const result = await getPlayerReadModelHealth();

    expect(result.status).toBe('healthy');
    expect(result.details.summaryGapDetected).toBe(true);
    expect(result.details.evaluationMode).toBe('lenient');
  });
});
