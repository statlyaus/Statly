import { describe, expect, it } from 'vitest';

import { DEFAULT_DRAFT_POSITION_LIMITS } from '@/lib/draftSettings';
import { calculateDraftCapacity } from '@/server/draft/domain/draftCapacity';

describe('calculateDraftCapacity', () => {
  it('derives requested picks from teams and admin roster composition', () => {
    const capacity = calculateDraftCapacity({
      teamCount: 2,
      positionLimits: DEFAULT_DRAFT_POSITION_LIMITS,
      activePlayerCount: 641,
    });

    expect(capacity.rosterSpotsPerTeam).toBe(22);
    expect(capacity.requestedTotalPicks).toBe(44);
    expect(capacity.totalPicks).toBe(44);
    expect(capacity.cappedByPlayerPool).toBe(false);
  });

  it('caps total picks at the active draftable player pool', () => {
    const capacity = calculateDraftCapacity({
      teamCount: 12,
      positionLimits: DEFAULT_DRAFT_POSITION_LIMITS,
      activePlayerCount: 200,
    });

    expect(capacity.requestedTotalPicks).toBe(264);
    expect(capacity.totalPicks).toBe(200);
    expect(capacity.cappedByPlayerPool).toBe(true);
  });

  it('reports position shortages against fixed roster slots', () => {
    const capacity = calculateDraftCapacity({
      teamCount: 10,
      positionLimits: DEFAULT_DRAFT_POSITION_LIMITS,
      activePlayerCount: 300,
      activePlayersByPosition: {
        DEF: 60,
        MID: 80,
        RUC: 6,
        FWD: 50,
      },
    });

    expect(capacity.positionShortages).toEqual([
      {
        position: 'RUC',
        required: 20,
        available: 6,
        shortage: 14,
      },
    ]);
  });

  it('does not shrink an in-progress draft below existing progress', () => {
    const capacity = calculateDraftCapacity({
      teamCount: 12,
      positionLimits: DEFAULT_DRAFT_POSITION_LIMITS,
      activePlayerCount: 10,
      existingPickCount: 12,
      currentPick: 13,
    });

    expect(capacity.totalPicks).toBe(12);
    expect(capacity.hardMinimumPicks).toBe(12);
  });
});
