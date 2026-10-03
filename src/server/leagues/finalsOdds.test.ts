import { describe, expect, it } from 'vitest';

import { simulateFinalsOdds, type FinalsOddsTeamInput } from './finalsOdds';

function team(
  memberId: string,
  wins: number,
  losses: number,
  games: Array<[round: number, opponentId: string, status?: 'SCHEDULED' | 'LIVE', lead?: number]> = []
): FinalsOddsTeamInput {
  return {
    memberId,
    wins,
    draws: 0,
    categoryWins: wins * 5 + losses * 4,
    categoryLosses: wins * 4 + losses * 5,
    categoryDraws: 0,
    results: games.map(([round, opponentId, status = 'SCHEDULED', lead = 0]) => ({
      round,
      phase: 'REGULAR' as const,
      status,
      opponentId,
      result: null,
      categoriesFor: Math.max(lead, 0),
      categoriesAgainst: Math.max(-lead, 0),
    })),
  };
}

describe('simulateFinalsOdds', () => {
  it('follows the ladder once the season is over', () => {
    const odds = simulateFinalsOdds({
      teams: [team('a', 3, 0), team('b', 2, 1), team('c', 2, 1), team('d', 0, 3)],
      finalsTeams: 2,
    });
    expect(odds.get('a')).toMatchObject({ chance: 1, status: 'CLINCHED', gamesLeft: 0 });
    expect(odds.get('b')?.chance).toBe(1);
    expect(odds.get('c')?.chance).toBe(0);
    expect(odds.get('d')).toMatchObject({ chance: 0, status: 'OUT', finishHigh: 4, finishLow: 4 });
  });

  it('marks clinched and out only when no result can change it', () => {
    const odds = simulateFinalsOdds({
      teams: [
        team('a', 3, 0, [[4, 'd']]),
        team('b', 1, 2, [[4, 'c']]),
        team('c', 1, 2, [[4, 'b']]),
        team('d', 0, 3, [[4, 'a']]),
      ],
      finalsTeams: 2,
    });
    expect(odds.get('a')).toMatchObject({ chance: 1, status: 'CLINCHED' });
    expect(odds.get('b')?.status).toBeNull();
    expect(odds.get('d')?.status).toBeNull();
    // d can reach 1 win and tie for second, so it is not out, but it needs help.
    expect(odds.get('d')!.chance).toBeLessThan(odds.get('b')!.chance);
  });

  it('shares the finals places out across teams and is repeatable', () => {
    const teams = [
      team('a', 2, 1, [[4, 'b'], [5, 'c']]),
      team('b', 2, 1, [[4, 'a'], [5, 'd']]),
      team('c', 1, 2, [[4, 'd'], [5, 'a']]),
      team('d', 1, 2, [[4, 'c'], [5, 'b']]),
    ];
    const odds = simulateFinalsOdds({ teams, finalsTeams: 2 });
    const total = [...odds.values()].reduce((sum, entry) => sum + entry.chance, 0);
    expect(total).toBeCloseTo(2, 5);
    expect(simulateFinalsOdds({ teams, finalsTeams: 2 })).toEqual(odds);
    const a = odds.get('a')!;
    expect(a.gamesLeft).toBe(2);
    expect(a.winsLow).toBeGreaterThanOrEqual(2);
    expect(a.winsHigh).toBeLessThanOrEqual(4);
    expect(a.projectedWins).toBeGreaterThan(2);
    expect(a.projectedWins).toBeLessThan(4);
    expect(a.finishHigh).toBeLessThanOrEqual(a.finishLow);
  });

  it('leans a live game toward the side that is ahead', () => {
    const odds = simulateFinalsOdds({
      teams: [team('a', 1, 1, [[3, 'b', 'LIVE', 4]]), team('b', 1, 1, [[3, 'a', 'LIVE', -4]])],
      finalsTeams: 1,
    });
    expect(odds.get('a')!.chance).toBeGreaterThan(0.75);
  });

  it('has nothing to say without finals', () => {
    expect(simulateFinalsOdds({ teams: [team('a', 1, 0)], finalsTeams: 0 }).size).toBe(0);
  });
});
