import { describe, expect, it } from 'vitest';

import { buildTeamCategoryProfile } from './teamCategoryProfile';

function score(memberId: string, values: Record<string, number>) {
  return {
    memberId,
    categoriesJson: Object.entries(values).map(([category, homeValue]) => ({
      category,
      homeValue,
      awayValue: 0,
    })),
  };
}

describe('buildTeamCategoryProfile', () => {
  const members = [
    { id: 'you', teamName: 'Your Team' },
    { id: 'b', teamName: 'B' },
    { id: 'c', teamName: 'C' },
  ];

  it('ranks each category per round against the league and respects low-wins categories', () => {
    const profile = buildTeamCategoryProfile({
      viewerMemberId: 'you',
      members,
      categories: ['goals', 'tackles', 'clangers'],
      categoryDirections: { goals: 'HIGH_WINS', tackles: 'HIGH_WINS', clangers: 'LOW_WINS' },
      finalizedScores: [
        score('you', { goals: 10, tackles: 50, clangers: 20 }),
        score('you', { goals: 14, tackles: 70, clangers: 30 }),
        score('b', { goals: 20, tackles: 40, clangers: 40 }),
        score('b', { goals: 20, tackles: 40, clangers: 40 }),
        score('c', { goals: 6, tackles: 80, clangers: 10 }),
        score('c', { goals: 6, tackles: 80, clangers: 10 }),
      ],
    });

    expect(profile).toMatchObject({ teamName: 'Your Team', roundsPlayed: 2, teamCount: 3 });
    expect(profile?.categories).toEqual([
      { key: 'goals', label: 'Goals', average: 12, leagueAverage: 12.7, rank: 2, lowWins: false },
      { key: 'tackles', label: 'Tackles', average: 60, leagueAverage: 60, rank: 2, lowWins: false },
      {
        key: 'clangers',
        label: 'Clangers',
        average: 25,
        leagueAverage: 25,
        rank: 2,
        lowWins: true,
      },
    ]);
  });

  it('reports DE% as season effective disposals over season disposals', () => {
    const de = (memberId: string, numerator: number, denominator: number) => ({
      memberId,
      categoriesJson: [
        {
          category: 'disposalEffPct',
          homeValue: denominator > 0 ? (numerator / denominator) * 100 : null,
          awayValue: 0,
          homeRatio: { numerator, denominator },
        },
      ],
    });
    const profile = buildTeamCategoryProfile({
      viewerMemberId: 'you',
      members,
      categories: ['disposalEffPct'],
      categoryDirections: {},
      finalizedScores: [
        de('you', 18, 20),
        de('you', 30, 60),
        de('b', 35, 50),
        de('b', 35, 50),
        de('c', 0, 0),
        de('c', 0, 0),
      ],
    });

    // You: 48/80 = 60 (the mean of 90 and 50 would be 70). League: 118/180 = 65.6.
    expect(profile?.categories).toEqual([
      {
        key: 'disposalEffPct',
        label: 'Disposal Efficiency %',
        average: 60,
        leagueAverage: 65.6,
        rank: 2,
        lowWins: false,
      },
    ]);
  });

  it('gives a team with no season disposals no DE% and ranks it last', () => {
    const profile = buildTeamCategoryProfile({
      viewerMemberId: 'you',
      members,
      categories: ['disposalEffPct'],
      categoryDirections: { disposalEffPct: 'LOW_WINS' },
      finalizedScores: [
        {
          memberId: 'you',
          categoriesJson: [
            {
              category: 'disposalEffPct',
              homeValue: null,
              homeRatio: { numerator: 0, denominator: 0 },
            },
          ],
        },
        {
          memberId: 'b',
          categoriesJson: [
            {
              category: 'disposalEffPct',
              homeValue: 80,
              homeRatio: { numerator: 8, denominator: 10 },
            },
          ],
        },
      ],
    });

    expect(profile?.categories[0]).toMatchObject({ average: null, leagueAverage: 80, rank: 2 });
  });

  it('returns an empty profile before any round is final', () => {
    const profile = buildTeamCategoryProfile({
      viewerMemberId: 'you',
      members,
      categories: ['goals'],
      categoryDirections: { goals: 'HIGH_WINS' },
      finalizedScores: [],
    });

    expect(profile).toMatchObject({ roundsPlayed: 0, categories: [] });
  });

  it('returns null when the viewer has no team in the league', () => {
    expect(
      buildTeamCategoryProfile({
        viewerMemberId: 'outsider',
        members,
        categories: ['goals'],
        categoryDirections: { goals: 'HIGH_WINS' },
        finalizedScores: [],
      })
    ).toBeNull();
  });
});
