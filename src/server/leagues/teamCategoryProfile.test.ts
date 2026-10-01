import { describe, expect, it } from 'vitest';

import { buildTeamCategoryProfile } from './teamCategoryProfile';

function score(memberId: string, values: Record<string, number>) {
  return {
    memberId,
    categoriesJson: JSON.stringify(
      Object.entries(values).map(([category, homeValue]) => ({ category, homeValue, awayValue: 0 }))
    ),
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
