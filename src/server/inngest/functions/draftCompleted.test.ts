import { beforeEach, describe, expect, it, vi } from 'vitest';

const ensureLeagueSeasonMaterializedMock = vi.fn();
const getComputedLeagueSeasonStateMock = vi.fn();
const getComputedLeagueRoundMock = vi.fn();
const primeLeagueMatchupSlatesMock = vi.fn();

vi.mock('@/lib/leagueSeason', () => ({
  ensureLeagueSeasonMaterialized: ensureLeagueSeasonMaterializedMock,
  getComputedLeagueSeasonState: getComputedLeagueSeasonStateMock,
  getComputedLeagueRound: getComputedLeagueRoundMock,
}));

vi.mock('@/lib/leagueMatchupPrewarm', () => ({
  primeLeagueMatchupSlates: primeLeagueMatchupSlatesMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
  },
}));

describe('processDraftCompletedWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureLeagueSeasonMaterializedMock.mockResolvedValue({
      bootstrapped: true,
      reason: 'missing_schedule',
    });
    getComputedLeagueSeasonStateMock.mockResolvedValue({
      scheduleWeeks: [{ week: 1, aflRound: 1, current: true, status: 'in_progress' }],
    });
    getComputedLeagueRoundMock.mockReturnValue(1);
    primeLeagueMatchupSlatesMock.mockResolvedValue({
      leagueCount: 3,
      primedCount: 2,
      skippedCount: 1,
    });
  });

  it('materializes league season state, resolves the round, and prewarms matchup slates', async () => {
    const { processDraftFollowUpWorkflow } = await import('./draftCompleted');

    const result = await processDraftFollowUpWorkflow({
      draftId: 'draft-1',
      leagueId: 'league-1',
      season: 2026,
      completedAt: '2026-04-03T00:00:00.000Z',
    });

    expect(ensureLeagueSeasonMaterializedMock).toHaveBeenCalledWith({
      leagueId: 'league-1',
      season: 2026,
    });
    expect(getComputedLeagueSeasonStateMock).toHaveBeenCalledWith({
      leagueId: 'league-1',
      season: 2026,
    });
    expect(primeLeagueMatchupSlatesMock).toHaveBeenCalledWith({
      season: 2026,
      round: 1,
      status: 'in_progress',
    });
    expect(result).toEqual({
      leagueId: 'league-1',
      season: 2026,
      round: 1,
      bootstrapped: true,
      reason: 'missing_schedule',
      prewarm: {
        leagueCount: 3,
        primedCount: 2,
        skippedCount: 1,
      },
    });
  });

  it('reuses the same workflow helper for repair requests', async () => {
    const { processDraftFollowUpWorkflow } = await import('./draftCompleted');

    const result = await processDraftFollowUpWorkflow({
      draftId: 'draft-1',
      leagueId: 'league-1',
      season: 2026,
      requestedAt: '2026-04-03T00:05:00.000Z',
    });

    expect(ensureLeagueSeasonMaterializedMock).toHaveBeenCalledWith({
      leagueId: 'league-1',
      season: 2026,
    });
    expect(primeLeagueMatchupSlatesMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      leagueId: 'league-1',
      season: 2026,
      round: 1,
      bootstrapped: true,
      reason: 'missing_schedule',
      prewarm: {
        leagueCount: 3,
        primedCount: 2,
        skippedCount: 1,
      },
    });
  });
});
