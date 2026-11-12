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

  describe('a Bloodsucker league (BR-10)', () => {
    it('counts only the drafting teams in the picks', () => {
      const capacity = calculateDraftCapacity({
        teamCount: 11,
        reservedTeamCount: 1,
        positionLimits: DEFAULT_DRAFT_POSITION_LIMITS,
        activePlayerCount: 641,
      });

      expect(capacity.requestedTotalPicks).toBe(11 * 22);
      expect(capacity.totalPicks).toBe(11 * 22);
      expect(capacity.reservedPoolShortage).toBe(0);
    });

    it('reports a pool too small to fill the Bloodsucker roster after the draft', () => {
      const capacity = calculateDraftCapacity({
        teamCount: 11,
        reservedTeamCount: 1,
        positionLimits: DEFAULT_DRAFT_POSITION_LIMITS,
        activePlayerCount: 11 * 22 + 5,
      });

      expect(capacity.cappedByPlayerPool).toBe(false);
      expect(capacity.reservedPoolShortage).toBe(22 - 5);
    });

    it('needs the Bloodsucker positions in the pool too', () => {
      const capacity = calculateDraftCapacity({
        teamCount: 1,
        reservedTeamCount: 1,
        positionLimits: DEFAULT_DRAFT_POSITION_LIMITS,
        activePlayerCount: 641,
        activePlayersByPosition: {
          DEF: DEFAULT_DRAFT_POSITION_LIMITS.DEF,
          MID: 100,
          RUC: 100,
          FWD: 100,
        },
      });

      expect(capacity.positionShortages).toEqual([
        expect.objectContaining({
          position: 'DEF',
          required: DEFAULT_DRAFT_POSITION_LIMITS.DEF * 2,
        }),
      ]);
    });

    it('leaves a standard league unchanged (no reserved teams)', () => {
      const capacity = calculateDraftCapacity({
        teamCount: 12,
        positionLimits: DEFAULT_DRAFT_POSITION_LIMITS,
        activePlayerCount: 264,
      });

      expect(capacity.reservedPoolShortage).toBe(0);
      expect(capacity.totalPicks).toBe(264);
    });
  });
});
