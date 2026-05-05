import { describe, expect, it } from 'vitest';

import { calculateTotalValue } from './fantasyCategories';

describe('calculateTotalValue', () => {
  it('uses neutral utilization factors when time-on-ground and disposal efficiency are unknown', () => {
    const withUnknown = calculateTotalValue({
      games: 1,
      kicks: 12,
      handballs: 10,
      marks: 5,
      tackles: 4,
      goals: 1,
      hitouts: 0,
      clearances: 3,
      inside50s: 4,
      rebound50s: 2,
      clangers: 1,
      contestedPossessions: 8,
      uncontestedPossessions: 10,
      freesFor: 1,
      freesAgainst: 1,
      onePercenters: 2,
      goalAssists: 1,
      timeOnGroundPct: null,
      disposalEffPct: null,
      turnovers: 2,
      intercepts: 3,
      metresGained: 320,
      contestedMarks: 1,
      effectiveDisposals: 14,
      scoreInvolvements: 6,
    });

    const withNeutralNumbers = calculateTotalValue({
      games: 1,
      kicks: 12,
      handballs: 10,
      marks: 5,
      tackles: 4,
      goals: 1,
      hitouts: 0,
      clearances: 3,
      inside50s: 4,
      rebound50s: 2,
      clangers: 1,
      contestedPossessions: 8,
      uncontestedPossessions: 10,
      freesFor: 1,
      freesAgainst: 1,
      onePercenters: 2,
      goalAssists: 1,
      timeOnGroundPct: 60,
      disposalEffPct: 70,
      turnovers: 2,
      intercepts: 3,
      metresGained: 320,
      contestedMarks: 1,
      effectiveDisposals: 14,
      scoreInvolvements: 6,
    });

    expect(withUnknown).toBe(withNeutralNumbers);
  });
});
