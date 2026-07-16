import { describe, expect, it } from 'vitest';

import {
  DEFAULT_COMPETITION_RULES,
  MAX_AFL_SEASON_ROUND,
  normalizeCompetitionRules,
  validateCompetitionRules,
} from './competitionRules';

const categories = ['goals', 'tackles'] as const;
const lineupSlots = { DEF: 5, MID: 5, RUC: 1, FWD: 5, UTIL: 1 };

describe('competition rule boundaries', () => {
  it('normalizes external categories, integers, and excluded AFL rounds', () => {
    const rules = normalizeCompetitionRules(
      {
        seasonStartAflRound: '2junk',
        regularSeasonRounds: '4.5',
        standingsTieBreakCategory: 'not-a-category',
        excludedAflRounds: [1, 2, 2, '3junk', MAX_AFL_SEASON_ROUND + 1],
      },
      'tackles'
    );

    expect(rules.seasonStartAflRound).toBe(DEFAULT_COMPETITION_RULES.seasonStartAflRound);
    expect(rules.regularSeasonRounds).toBe(DEFAULT_COMPETITION_RULES.regularSeasonRounds);
    expect(rules.standingsTieBreakCategory).toBe('tackles');
    expect(rules.excludedAflRounds).toEqual([1, 2]);
  });

  it('enforces the documented 18-team maximum', () => {
    const validIssues = validateCompetitionRules({
      rules: { ...DEFAULT_COMPETITION_RULES, regularSeasonRounds: 18 },
      teamCount: 18,
      categories: [...categories],
      lineupSlots,
      rosterSize: 20,
    });
    const invalidIssues = validateCompetitionRules({
      rules: { ...DEFAULT_COMPETITION_RULES, regularSeasonRounds: 19 },
      teamCount: 19,
      categories: [...categories],
      lineupSlots,
      rosterSize: 20,
    });

    expect(validIssues.some((issue) => issue.code === 'TEAM_COUNT')).toBe(false);
    expect(invalidIssues).toContainEqual({
      code: 'TEAM_COUNT',
      message: 'Competitions require between 4 and 18 teams.',
    });
  });

  it('rejects a schedule that cannot fit inside the supported AFL season', () => {
    const issues = validateCompetitionRules({
      rules: {
        ...DEFAULT_COMPETITION_RULES,
        seasonStartAflRound: 20,
        regularSeasonRounds: 5,
        finalsTeams: 4,
        excludedAflRounds: [21],
      },
      teamCount: 4,
      categories: [...categories],
      lineupSlots,
      rosterSize: 20,
    });

    expect(issues).toContainEqual({
      code: 'REGULAR_SEASON_ROUNDS',
      message: `The regular season, finals, and excluded weeks must fit by AFL Round ${MAX_AFL_SEASON_ROUND}.`,
    });
  });
});
