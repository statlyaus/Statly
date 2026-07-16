import { describe, expect, it } from 'vitest';

import { generateCompetitionSchedule } from './fixtureGenerator';
import {
  DEFAULT_COMPETITION_RULES,
  getEqualByeRoundHelp,
  validateCompetitionRules,
} from './competitionRules';

const categories = ['goals', 'tackles'] as const;
const lineupSlots = { DEF: 5, MID: 5, RUC: 1, FWD: 5, UTIL: 1 };

describe('competition rules', () => {
  it('rejects an odd-team automatic season that cannot balance byes', () => {
    const issues = validateCompetitionRules({
      rules: { ...DEFAULT_COMPETITION_RULES, regularSeasonRounds: 3 },
      teamCount: 5,
      categories: [...categories],
      lineupSlots,
      rosterSize: 20,
    });

    expect(issues).toContainEqual({
      code: 'UNBALANCED_BYES',
      message: getEqualByeRoundHelp(5),
    });
  });

  it('allows a complete odd-team cycle with equal byes', () => {
    const issues = validateCompetitionRules({
      rules: { ...DEFAULT_COMPETITION_RULES, regularSeasonRounds: 5 },
      teamCount: 5,
      categories: [...categories],
      lineupSlots,
      rosterSize: 20,
    });

    expect(issues).toEqual([]);
  });
});

describe('generateCompetitionSchedule', () => {
  it('keeps excluded AFL rounds numbered as no-matchup weeks', () => {
    const schedule = generateCompetitionSchedule({
      memberIds: ['a', 'b', 'c', 'd'],
      fixtureVersion: 1,
      seasonStartAflRound: 1,
      regularSeasonRounds: 3,
      excludedAflRounds: [2],
      finalsTeams: 0,
    });

    expect(schedule).toHaveLength(4);
    expect(schedule[1]).toMatchObject({ round: 2, aflRound: 2, status: 'NO_MATCHUP', fixtures: [] });
    expect(schedule[2]?.fixtures).toHaveLength(2);
    expect(schedule[3]).toMatchObject({ round: 4, aflRound: 4, status: 'SCHEDULED' });
  });

  it('adds the approved eight-team finals bracket after regular season', () => {
    const schedule = generateCompetitionSchedule({
      memberIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      fixtureVersion: 2,
      seasonStartAflRound: 1,
      regularSeasonRounds: 1,
      excludedAflRounds: [],
      finalsTeams: 8,
    });

    const finalsRounds = schedule.filter((round) => round.phase === 'FINALS');

    expect(finalsRounds).toHaveLength(4);
    expect(finalsRounds[0]?.fixtures.map((fixture) => fixture.bracketKey)).toEqual([
      'QF_1_V_4',
      'QF_2_V_3',
      'EF_5_V_8',
      'EF_6_V_7',
    ]);
    expect(finalsRounds.at(-1)?.fixtures.map((fixture) => fixture.bracketKey)).toEqual(['GF']);
  });
});
