import { describe, expect, it } from 'vitest';

import {
  generateCompetitionSchedule,
  generateManualCompetitionSchedule,
  generateRoundRobinFixtures,
} from '@/server/leagues/fixtureGenerator';

describe('generateRoundRobinFixtures', () => {
  it('generates one round-robin meeting for even team counts', () => {
    const fixtures = generateRoundRobinFixtures(['a', 'b', 'c', 'd']);

    expect(new Set(fixtures.map((fixture) => fixture.round))).toEqual(new Set([1, 2, 3]));
    expect(fixtures).toHaveLength(6);
    expect(fixtures.some((fixture) => fixture.byeMemberId)).toBe(false);
  });

  it('adds bye fixtures for odd team counts', () => {
    const fixtures = generateRoundRobinFixtures(['a', 'b', 'c']);
    const byes = fixtures.filter((fixture) => fixture.byeMemberId);

    expect(new Set(fixtures.map((fixture) => fixture.round))).toEqual(new Set([1, 2, 3]));
    expect(byes).toHaveLength(3);
    expect(new Set(byes.map((fixture) => fixture.byeMemberId))).toEqual(new Set(['a', 'b', 'c']));
  });
});

describe('generateCompetitionSchedule', () => {
  it('keeps excluded AFL rounds out of the finals bracket', () => {
    const schedule = generateCompetitionSchedule({
      memberIds: ['a', 'b', 'c', 'd'],
      fixtureVersion: 3,
      seasonStartAflRound: 1,
      regularSeasonRounds: 1,
      excludedAflRounds: [2],
      finalsTeams: 4,
    });

    expect(schedule[1]).toMatchObject({
      round: 2,
      aflRound: 2,
      phase: 'FINALS',
      status: 'NO_MATCHUP',
      fixtures: [],
    });
    expect(schedule[2]).toMatchObject({ round: 3, aflRound: 3, phase: 'FINALS' });
    expect(schedule[2]?.fixtures.map((fixture) => fixture.bracketKey)).toEqual([
      'SF_1_V_4',
      'SF_2_V_3',
    ]);
  });

  it('creates editable round shells for manual competitions', () => {
    const schedule = generateManualCompetitionSchedule({
      fixtureVersion: 4,
      seasonStartAflRound: 3,
      regularSeasonRounds: 2,
      excludedAflRounds: [4],
      finalsTeams: 4,
    });

    expect(schedule.slice(0, 3)).toEqual([
      expect.objectContaining({
        round: 1,
        aflRound: 3,
        phase: 'REGULAR',
        status: 'SCHEDULED',
        fixtures: [],
      }),
      expect.objectContaining({
        round: 2,
        aflRound: 4,
        phase: 'REGULAR',
        status: 'NO_MATCHUP',
        fixtures: [],
      }),
      expect.objectContaining({
        round: 3,
        aflRound: 5,
        phase: 'REGULAR',
        status: 'SCHEDULED',
        fixtures: [],
      }),
    ]);
    expect(schedule[3]?.fixtures.map((fixture) => fixture.bracketKey)).toEqual([
      'SF_1_V_4',
      'SF_2_V_3',
    ]);
  });
});
