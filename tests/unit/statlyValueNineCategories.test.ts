import { describe, expect, it } from 'vitest';

import { calculateTotalValue, type PlayerStats } from '@/types/fantasyCategories';

const zero: PlayerStats = {
  games: 1,
  kicks: 0,
  handballs: 0,
  marks: 0,
  tackles: 0,
  goals: 0,
  hitouts: 0,
  clearances: 0,
  inside50s: 0,
  rebound50s: 0,
  clangers: 0,
  contestedPossessions: 0,
  uncontestedPossessions: 0,
  freesFor: 0,
  freesAgainst: 0,
  onePercenters: 0,
  goalAssists: 0,
  timeOnGroundPct: 0,
  disposalEffPct: 0,
  turnovers: 0,
  intercepts: 0,
  metresGained: 0,
  contestedMarks: 0,
  effectiveDisposals: 0,
  scoreInvolvements: 0,
};

describe('Statly value', () => {
  it('is a weighted per-game sum of the nine league categories', () => {
    const value = calculateTotalValue({
      ...zero,
      games: 2,
      goals: 4,
      tackles: 10,
      inside50s: 6,
      intercepts: 4,
      contestedMarks: 2,
      rebound50s: 2,
      contestedPossessions: 20,
      effectiveDisposals: 30,
      scoreInvolvements: 10,
    });

    // Per game: 2*6 + 5*4 + 3*2 + 2*4 + 1*4 + 1*3 + 10*3 + 15*1 + 5*2 = 108
    expect(value).toBe(108);
  });

  it('ignores time on ground, disposal efficiency and stats outside the nine', () => {
    const base = { ...zero, goals: 2, tackles: 5 };

    expect(calculateTotalValue({ ...base, timeOnGroundPct: 85, disposalEffPct: 75 })).toBe(
      calculateTotalValue(base)
    );
    expect(calculateTotalValue({ ...base, kicks: 20, clangers: 9, hitouts: 30 })).toBe(
      calculateTotalValue(base)
    );
  });
});
