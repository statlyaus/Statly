import { beforeEach, describe, expect, it, vi } from 'vitest';

const { draftRepository, incCounter } = vi.hoisted(() => ({
  draftRepository: {
    transaction: vi.fn(),
    getLiveDraftPickExpirySchedule: vi.fn(),
    transitionDraftClock: vi.fn(),
  },
  incCounter: vi.fn(),
}));

vi.mock('@/server/draft/repository/DraftRepository', () => ({ draftRepository }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/server/metrics', () => ({
  METRICS: { draftClockConvergence: 'draft_clock_convergence_total' },
  incCounter,
}));

import {
  DraftClockConvergenceService,
  deriveLiveDraftClockAnchors,
  hasValidLiveDraftClockAnchors,
} from '@/server/draft/services/DraftClockConvergenceService';

const tx = {};
const baseSchedule = {
  draftId: 'draft-1',
  leagueId: 'league-1',
  currentPick: 3,
  schedulingVersion: 7,
  pickStartedAt: new Date('2026-06-14T12:00:00.000Z'),
  pickDeadlineAt: new Date('2026-06-14T12:02:00.000Z'),
  pausedRemainingSeconds: null,
  startedAt: new Date('2026-06-14T11:00:00.000Z'),
  lastPickOverall: 2,
  lastPickMadeAt: new Date('2026-06-14T12:00:00.000Z'),
  pickSeconds: 120,
  clockDurationSeconds: 120,
};

describe('DraftClockConvergenceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    draftRepository.transaction.mockImplementation((work) => work(tx));
  });

  it('leaves a valid LIVE clock unchanged, including an immediate zero-duration remainder', async () => {
    const immediate = {
      ...baseSchedule,
      pickDeadlineAt: baseSchedule.pickStartedAt,
    };
    draftRepository.getLiveDraftPickExpirySchedule.mockResolvedValue(immediate);

    await expect(new DraftClockConvergenceService().convergeDraft('draft-1')).resolves.toEqual({
      schedule: immediate,
      repaired: false,
    });
    expect(hasValidLiveDraftClockAnchors(immediate)).toBe(true);
    expect(draftRepository.transitionDraftClock).not.toHaveBeenCalled();
    expect(incCounter).toHaveBeenCalledWith('draft_clock_convergence_total', 1, {
      outcome: 'valid',
    });
  });

  it('repairs a missing deadline from the persisted turn start and returns the reloaded revision', async () => {
    const observed = { ...baseSchedule, pickDeadlineAt: null };
    const converged = { ...baseSchedule, schedulingVersion: 8 };
    draftRepository.getLiveDraftPickExpirySchedule
      .mockResolvedValueOnce(observed)
      .mockResolvedValueOnce(converged);
    draftRepository.transitionDraftClock.mockResolvedValue({ count: 1 });

    await expect(
      new DraftClockConvergenceService().convergeDraft(
        'draft-1',
        new Date('2026-06-14T12:01:00.000Z')
      )
    ).resolves.toEqual({ schedule: converged, repaired: true });
    expect(draftRepository.transitionDraftClock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        draftId: 'draft-1',
        leagueId: 'league-1',
        currentPick: 3,
        currentSchedulingVersion: 7,
        expectedPickStartedAt: observed.pickStartedAt,
        expectedPickDeadlineAt: null,
        pickStartedAt: observed.pickStartedAt,
        pickDeadlineAt: new Date('2026-06-14T12:02:00.000Z'),
        clockDurationSeconds: 120,
      })
    );
    expect(incCounter).toHaveBeenCalledWith('draft_clock_convergence_total', 1, {
      outcome: 'repaired',
    });
  });

  it('preserves an existing deadline and derives its missing start from the matching prior pick', () => {
    const deadline = new Date('2026-06-14T12:02:00.000Z');
    const latestPick = new Date('2026-06-14T12:00:37.000Z');

    expect(
      deriveLiveDraftClockAnchors(
        {
          ...baseSchedule,
          pickStartedAt: null,
          pickDeadlineAt: deadline,
          lastPickMadeAt: latestPick,
        },
        new Date('2026-06-14T12:01:00.000Z')
      )
    ).toEqual({
      pickStartedAt: latestPick,
      pickDeadlineAt: deadline,
      clockDurationSeconds: 120,
    });
  });

  it('uses durable fallbacks for a clock with no anchors without inventing a client duration', () => {
    const repairTime = new Date('2026-06-14T12:01:00.000Z');
    const latestPick = deriveLiveDraftClockAnchors(
      { ...baseSchedule, pickStartedAt: null, pickDeadlineAt: null },
      repairTime
    );
    const draftStart = deriveLiveDraftClockAnchors(
      {
        ...baseSchedule,
        currentPick: 1,
        lastPickOverall: null,
        lastPickMadeAt: null,
        pickStartedAt: null,
        pickDeadlineAt: null,
      },
      repairTime
    );
    const capturedRepairTime = deriveLiveDraftClockAnchors(
      {
        ...baseSchedule,
        currentPick: 1,
        startedAt: null,
        lastPickOverall: null,
        lastPickMadeAt: null,
        pickStartedAt: null,
        pickDeadlineAt: null,
      },
      repairTime
    );

    expect(latestPick.pickStartedAt).toEqual(baseSchedule.lastPickMadeAt);
    expect(draftStart.pickStartedAt).toEqual(baseSchedule.startedAt);
    expect(capturedRepairTime.pickStartedAt).toEqual(repairTime);
  });

  it('normalizes stale paused state and reloads a concurrent repair winner', async () => {
    const observed = { ...baseSchedule, pausedRemainingSeconds: 42 };
    const winner = {
      ...baseSchedule,
      schedulingVersion: 9,
      pickStartedAt: new Date('2026-06-14T12:01:00.000Z'),
      pickDeadlineAt: new Date('2026-06-14T12:03:00.000Z'),
    };
    draftRepository.getLiveDraftPickExpirySchedule
      .mockResolvedValueOnce(observed)
      .mockResolvedValueOnce(winner);
    draftRepository.transitionDraftClock.mockResolvedValue({ count: 0 });

    await expect(new DraftClockConvergenceService().convergeDraft('draft-1')).resolves.toEqual({
      schedule: winner,
      repaired: false,
    });
    expect(draftRepository.transaction).toHaveBeenCalledTimes(3);
    expect(incCounter).toHaveBeenCalledWith('draft_clock_convergence_total', 1, {
      outcome: 'concurrent',
    });
  });

  it('fails closed when the authoritative reload remains malformed', async () => {
    const malformed = { ...baseSchedule, pickStartedAt: null, pickDeadlineAt: null };
    draftRepository.getLiveDraftPickExpirySchedule.mockResolvedValue(malformed);
    draftRepository.transitionDraftClock.mockResolvedValue({ count: 0 });

    await expect(new DraftClockConvergenceService().convergeDraft('draft-1')).rejects.toThrow(
      'LIVE draft clock did not converge: draft-1'
    );
    expect(incCounter).toHaveBeenCalledWith('draft_clock_convergence_total', 1, {
      outcome: 'failed',
    });
  });
});
