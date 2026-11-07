import { describe, expect, it } from 'vitest';

import {
  buildStandingsHistory,
  type StandingsLadderInput,
  type StandingsMatchupInput,
} from './standingsHistory';

function team(memberId: string, record: Partial<StandingsLadderInput> = {}): StandingsLadderInput {
  return {
    memberId,
    teamName: memberId.toUpperCase(),
    teamLogoUrl: null,
    wins: 0,
    losses: 0,
    draws: 0,
    categoryWins: 0,
    categoryLosses: 0,
    categoryDraws: 0,
    draftSlot: null,
    ...record,
  };
}

function game(
  round: number,
  home: string,
  away: string,
  homeWins: number,
  awayWins: number,
  status: StandingsMatchupInput['status'] = 'FINAL'
): StandingsMatchupInput {
  return {
    round,
    phase: 'REGULAR',
    status,
    homeMemberId: home,
    awayMemberId: away,
    byeMemberId: null,
    homeCategoryWins: homeWins,
    awayCategoryWins: awayWins,
    drawnCategories: 9 - homeWins - awayWins,
    winnerMemberId:
      status !== 'FINAL' || homeWins === awayWins ? null : homeWins > awayWins ? home : away,
  };
}

// Round 1: a beats b, c beats d. Round 2: b beats a, c draws d. Round 3 live: a v c, b v d.
const matchups = [
  game(1, 'a', 'b', 6, 3),
  game(1, 'c', 'd', 5, 4),
  game(2, 'b', 'a', 7, 2),
  game(2, 'c', 'd', 4, 4),
  game(3, 'a', 'c', 3, 2, 'LIVE'),
  game(3, 'b', 'd', 0, 0, 'LIVE'),
  game(4, 'a', 'd', 0, 0, 'SCHEDULED'),
];
// Official ladder after round 2 (already sorted).
const ladder = [
  team('c', { wins: 1, draws: 1, categoryWins: 9, categoryLosses: 8, categoryDraws: 1 }),
  team('b', { wins: 1, losses: 1, categoryWins: 10, categoryLosses: 8 }),
  team('a', { wins: 1, losses: 1, categoryWins: 8, categoryLosses: 10 }),
  team('d', { losses: 1, draws: 1, categoryWins: 8, categoryLosses: 9, categoryDraws: 1 }),
];

describe('buildStandingsHistory', () => {
  const history = buildStandingsHistory({
    ladder,
    matchups,
    finalsTeams: 2,
    scoringMode: 'H2H_MOST_CATEGORIES',
    categoryCount: 9,
  });
  const byId = new Map(history.teams.map((entry) => [entry.memberId, entry]));

  it('classifies rounds and keeps ladder order', () => {
    expect(history.rounds.map((round) => [round.round, round.status])).toEqual([
      [1, 'FINAL'],
      [2, 'FINAL'],
      [3, 'LIVE'],
      [4, 'SCHEDULED'],
    ]);
    expect(history.completedRounds).toEqual([1, 2]);
    expect(history.liveRound).toBe(3);
    expect(history.teams.map((entry) => [entry.memberId, entry.rank])).toEqual([
      ['c', 1],
      ['b', 2],
      ['a', 3],
      ['d', 4],
    ]);
    expect(history.finalsTeams).toBe(2);
  });

  it('builds rank history, ending on the official ladder, and movement', () => {
    // After round 1: a (6-3) and c (5-4) won; a has the bigger category margin.
    expect(byId.get('a')!.rankHistory).toEqual([
      { round: 1, rank: 1 },
      { round: 2, rank: 3 },
    ]);
    expect(byId.get('a')!.movement).toBe(-2);
    expect(byId.get('c')!.movement).toBe(1);
    expect(byId.get('a')!.bestRank).toBe(1);
    expect(byId.get('a')!.worstRank).toBe(3);
  });

  it('computes form, streaks, percentages and games back', () => {
    const a = byId.get('a')!;
    expect(a.form).toEqual(['W', 'L']);
    expect(a.streak).toEqual({ result: 'L', count: 1 });
    expect(byId.get('c')!.streak).toEqual({ result: 'D', count: 1 });
    expect(a.winPct).toBe(0.5);
    expect(byId.get('c')!.winPct).toBe(0.75);
    expect(byId.get('c')!.categoryWinPct).toBeCloseTo(9.5 / 18);
    expect(byId.get('c')!.gamesBack).toBe(0);
    expect(byId.get('d')!.gamesBack).toBe(1);
  });

  it('records round results and the live opponent', () => {
    const a = byId.get('a')!;
    expect(a.results.map((result) => [result.round, result.result, result.opponentId])).toEqual([
      [1, 'W', 'b'],
      [2, 'L', 'b'],
      [3, null, 'c'],
      [4, null, 'd'],
    ]);
    expect(a.results[1]).toMatchObject({ categoriesFor: 2, categoriesAgainst: 7 });
    expect(a.upcoming).toEqual({ round: 3, opponentId: 'c', status: 'LIVE' });
  });

  it('handles byes, no games and finals larger than the league', () => {
    const empty = buildStandingsHistory({
      ladder: [team('x'), team('y')],
      matchups: [
        {
          round: 1,
          phase: 'REGULAR',
          status: 'SCHEDULED',
          homeMemberId: null,
          awayMemberId: null,
          byeMemberId: 'x',
          homeCategoryWins: 0,
          awayCategoryWins: 0,
          drawnCategories: 0,
          winnerMemberId: null,
        },
      ],
      finalsTeams: 8,
      scoringMode: 'H2H_MOST_CATEGORIES',
      categoryCount: 9,
    });
    expect(empty.finalsTeams).toBe(2);
    expect(empty.teams[0]).toMatchObject({
      winPct: null,
      movement: null,
      streak: null,
      form: [],
      rankHistory: [],
    });
    expect(empty.teams[0].results).toEqual([
      expect.objectContaining({ round: 1, status: 'BYE', opponentId: null }),
    ]);
  });
});

describe('buildStandingsHistory in H2H_EACH_CATEGORY', () => {
  // Round 1: a beats b 5-4; c beats d 3-2 with 4 categories drawn. Round 2: every category drawn.
  const eachMatchups = [
    game(1, 'a', 'b', 5, 4),
    game(1, 'c', 'd', 3, 2),
    game(2, 'a', 'c', 0, 0),
    game(2, 'b', 'd', 0, 0),
  ];
  // The ladder ranks by category wins in this mode: a 5, b 4, c 3, d 2.
  const eachLadder = [
    team('a', {
      wins: 5,
      losses: 4,
      draws: 9,
      categoryWins: 5,
      categoryLosses: 4,
      categoryDraws: 9,
    }),
    team('b', {
      wins: 4,
      losses: 5,
      draws: 9,
      categoryWins: 4,
      categoryLosses: 5,
      categoryDraws: 9,
    }),
    team('c', {
      wins: 3,
      losses: 2,
      draws: 13,
      categoryWins: 3,
      categoryLosses: 2,
      categoryDraws: 13,
    }),
    team('d', {
      wins: 2,
      losses: 3,
      draws: 13,
      categoryWins: 2,
      categoryLosses: 3,
      categoryDraws: 13,
    }),
  ];
  const history = buildStandingsHistory({
    ladder: eachLadder,
    matchups: eachMatchups,
    finalsTeams: 2,
    scoringMode: 'H2H_EACH_CATEGORY',
    categoryCount: 9,
  });
  const byId = new Map(history.teams.map((entry) => [entry.memberId, entry]));

  it('ranks earlier rounds by category results, as the ladder does', () => {
    // By matchup wins b (lost round 1) would have been third after round 1, behind c.
    expect(byId.get('b')!.rankHistory).toEqual([
      { round: 1, rank: 2 },
      { round: 2, rank: 2 },
    ]);
    expect(byId.get('b')!.movement).toBe(0);
    expect(byId.get('c')!.movement).toBe(0);
  });
});
