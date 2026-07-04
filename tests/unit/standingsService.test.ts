import { describe, expect, it } from 'vitest';

import { calculateStandingsRows } from '@/server/leagues/standingsService';

describe('calculateStandingsRows', () => {
  it('counts every category in H2H each category mode', () => {
    const rows = calculateStandingsRows({
      scoringMode: 'H2H_EACH_CATEGORY',
      memberIds: ['home', 'away'],
      finalizedScores: [
        {
          matchupId: 'm1',
          memberId: 'home',
          categoryWins: 5,
          categoryLosses: 3,
          categoryDraws: 1,
          matchupWin: true,
          matchupLoss: false,
          matchupDraw: false,
          pointsFor: 120,
          pointsAgainst: 100,
        },
        {
          matchupId: 'm1',
          memberId: 'away',
          categoryWins: 3,
          categoryLosses: 5,
          categoryDraws: 1,
          matchupWin: false,
          matchupLoss: true,
          matchupDraw: false,
          pointsFor: 100,
          pointsAgainst: 120,
        },
      ],
    });

    expect(rows.find((row) => row.memberId === 'home')).toMatchObject({
      wins: 5,
      losses: 3,
      draws: 1,
      categoryWins: 5,
      categoryLosses: 3,
      categoryDraws: 1,
    });
  });

  it('counts one weekly result in H2H most categories mode and keeps category totals', () => {
    const rows = calculateStandingsRows({
      scoringMode: 'H2H_MOST_CATEGORIES',
      memberIds: ['home', 'away'],
      finalizedScores: [
        {
          matchupId: 'm1',
          memberId: 'home',
          categoryWins: 5,
          categoryLosses: 4,
          categoryDraws: 0,
          matchupWin: true,
          matchupLoss: false,
          matchupDraw: false,
          pointsFor: 120,
          pointsAgainst: 100,
        },
        {
          matchupId: 'm1',
          memberId: 'away',
          categoryWins: 4,
          categoryLosses: 5,
          categoryDraws: 0,
          matchupWin: false,
          matchupLoss: true,
          matchupDraw: false,
          pointsFor: 100,
          pointsAgainst: 120,
        },
      ],
    });

    expect(rows.find((row) => row.memberId === 'home')).toMatchObject({
      wins: 1,
      losses: 0,
      draws: 0,
      categoryWins: 5,
      categoryLosses: 4,
    });
  });
});
