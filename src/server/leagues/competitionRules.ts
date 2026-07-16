import type { FantasyCategoryKey } from '@/types/fantasyCategories';

import type { LeagueFixtureGenerationMode } from '@/types/leagues';

import { totalActiveLineupSlots } from './lineupSettings';
import type { LineupSlotSettings } from './scoringTypes';

export const MIN_COMPETITION_TEAMS = 4;
export const MAX_COMPETITION_TEAMS = 18;
export const MAX_CO_COMMISSIONERS = 3;
export const SUPPORTED_FINALS_TEAM_COUNTS = [0, 4, 6, 8] as const;

export type CompetitionLockPolicy = 'INDIVIDUAL_GAME_START' | 'THURSDAY_7PM_AEST';
export type CompetitionStatus = 'SETUP' | 'PUBLISHED' | 'PENDING' | 'ACTIVE' | 'COMPLETE';
export type CompetitionPhase = 'REGULAR' | 'FINALS';
export type CompetitionRoundStatus = 'SCHEDULED' | 'NO_MATCHUP' | 'PENDING' | 'LOCKED' | 'FINAL';
export type CompetitionRulesIssueCode =
  | 'TEAM_COUNT'
  | 'REGULAR_SEASON_ROUNDS'
  | 'UNBALANCED_BYES'
  | 'FINALS_TEAMS'
  | 'TIE_BREAK_CATEGORY'
  | 'INTERCHANGE_COUNT'
  | 'ROSTER_CAPACITY'
  | 'AFL_START_ROUND'
  | 'TIME_ZONE';

export interface CompetitionRules {
  seasonStartAflRound: number;
  regularSeasonRounds: number;
  finalsTeams: (typeof SUPPORTED_FINALS_TEAM_COUNTS)[number];
  fixtureGenerationMode: LeagueFixtureGenerationMode;
  lockPolicy: CompetitionLockPolicy;
  leagueTimeZone: string;
  interchangeSlots: number;
  standingsTieBreakCategory: FantasyCategoryKey;
  excludedAflRounds: number[];
}

export interface CompetitionRulesIssue {
  code: CompetitionRulesIssueCode;
  message: string;
}

export interface CompetitionRulesValidationInput {
  rules: CompetitionRules;
  teamCount: number;
  categories: readonly FantasyCategoryKey[];
  lineupSlots: LineupSlotSettings;
  rosterSize: number;
}

export const DEFAULT_COMPETITION_RULES: CompetitionRules = {
  seasonStartAflRound: 1,
  regularSeasonRounds: 11,
  finalsTeams: 0,
  fixtureGenerationMode: 'AUTOMATIC',
  lockPolicy: 'INDIVIDUAL_GAME_START',
  leagueTimeZone: 'Australia/Sydney',
  interchangeSlots: 3,
  standingsTieBreakCategory: 'goals',
  excludedAflRounds: [],
};

function asPositiveInteger(value: unknown, fallback: number) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function asNonNegativeInteger(value: unknown, fallback: number) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function isFinalsTeamCount(value: unknown): value is CompetitionRules['finalsTeams'] {
  return typeof value === 'number' && SUPPORTED_FINALS_TEAM_COUNTS.includes(value as 0 | 4 | 6 | 8);
}

function normalizeExcludedAflRounds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];

  return [
    ...new Set(
      value
        .map((round) => asPositiveInteger(round, 0))
        .filter((round): round is number => round > 0)
    ),
  ].sort((left, right) => left - right);
}

export function normalizeCompetitionRules(
  input: unknown,
  fallbackCategory: FantasyCategoryKey
): CompetitionRules {
  const source = input && typeof input === 'object' ? (input as Partial<CompetitionRules>) : {};
  const seasonStartAflRound = asPositiveInteger(
    source.seasonStartAflRound,
    DEFAULT_COMPETITION_RULES.seasonStartAflRound
  );
  const regularSeasonRounds = asPositiveInteger(
    source.regularSeasonRounds,
    DEFAULT_COMPETITION_RULES.regularSeasonRounds
  );
  const interchangeSlots = asNonNegativeInteger(
    source.interchangeSlots,
    DEFAULT_COMPETITION_RULES.interchangeSlots
  );

  return {
    seasonStartAflRound,
    regularSeasonRounds,
    finalsTeams: isFinalsTeamCount(source.finalsTeams)
      ? source.finalsTeams
      : DEFAULT_COMPETITION_RULES.finalsTeams,
    fixtureGenerationMode:
      source.fixtureGenerationMode === 'MANUAL' ? 'MANUAL' : DEFAULT_COMPETITION_RULES.fixtureGenerationMode,
    lockPolicy:
      source.lockPolicy === 'THURSDAY_7PM_AEST'
        ? 'THURSDAY_7PM_AEST'
        : DEFAULT_COMPETITION_RULES.lockPolicy,
    leagueTimeZone:
      typeof source.leagueTimeZone === 'string' && source.leagueTimeZone.trim()
        ? source.leagueTimeZone.trim()
        : DEFAULT_COMPETITION_RULES.leagueTimeZone,
    interchangeSlots,
    standingsTieBreakCategory:
      typeof source.standingsTieBreakCategory === 'string'
        ? (source.standingsTieBreakCategory as FantasyCategoryKey)
        : fallbackCategory,
    excludedAflRounds: normalizeExcludedAflRounds(source.excludedAflRounds),
  };
}

export function parseCompetitionRulesJson(
  value: string | null | undefined,
  fallbackCategory: FantasyCategoryKey
): CompetitionRules {
  if (!value) return normalizeCompetitionRules(null, fallbackCategory);

  try {
    return normalizeCompetitionRules(JSON.parse(value), fallbackCategory);
  } catch {
    return normalizeCompetitionRules(null, fallbackCategory);
  }
}

export function isBalancedByeSeason(teamCount: number, regularSeasonRounds: number) {
  return teamCount % 2 === 0 || regularSeasonRounds % teamCount === 0;
}

export function getEqualByeRoundHelp(teamCount: number) {
  return `With ${teamCount} teams, automatic fixtures need a multiple of ${teamCount} regular-season rounds so every team receives the same number of fantasy byes.`;
}

export function validateCompetitionRules({
  rules,
  teamCount,
  categories,
  lineupSlots,
  rosterSize,
}: CompetitionRulesValidationInput): CompetitionRulesIssue[] {
  const issues: CompetitionRulesIssue[] = [];

  if (teamCount < MIN_COMPETITION_TEAMS || teamCount > MAX_COMPETITION_TEAMS) {
    issues.push({
      code: 'TEAM_COUNT',
      message: `Competitions require between ${MIN_COMPETITION_TEAMS} and ${MAX_COMPETITION_TEAMS} teams.`,
    });
  }

  if (!Number.isInteger(rules.seasonStartAflRound) || rules.seasonStartAflRound < 1) {
    issues.push({
      code: 'AFL_START_ROUND',
      message: 'Choose a valid AFL round for the start of the fantasy season.',
    });
  }

  if (!Number.isInteger(rules.regularSeasonRounds) || rules.regularSeasonRounds < 1) {
    issues.push({
      code: 'REGULAR_SEASON_ROUNDS',
      message: 'Choose at least one regular-season round.',
    });
  }

  if (
    rules.fixtureGenerationMode === 'AUTOMATIC' &&
    teamCount >= MIN_COMPETITION_TEAMS &&
    !isBalancedByeSeason(teamCount, rules.regularSeasonRounds)
  ) {
    issues.push({
      code: 'UNBALANCED_BYES',
      message: getEqualByeRoundHelp(teamCount),
    });
  }

  if (!SUPPORTED_FINALS_TEAM_COUNTS.includes(rules.finalsTeams)) {
    issues.push({
      code: 'FINALS_TEAMS',
      message: 'Finals must use 0, 4, 6, or 8 teams.',
    });
  } else if (rules.finalsTeams > teamCount) {
    issues.push({
      code: 'FINALS_TEAMS',
      message: 'Finals teams cannot exceed the number of teams in the league.',
    });
  }

  if (!categories.includes(rules.standingsTieBreakCategory)) {
    issues.push({
      code: 'TIE_BREAK_CATEGORY',
      message: 'Choose one of this league’s scoring categories as the standings tie-breaker.',
    });
  }

  if (!Number.isInteger(rules.interchangeSlots) || rules.interchangeSlots < 0) {
    issues.push({
      code: 'INTERCHANGE_COUNT',
      message: 'Interchange slots must be a whole number of zero or more.',
    });
  }

  if (totalActiveLineupSlots(lineupSlots) + rules.interchangeSlots > rosterSize) {
    issues.push({
      code: 'ROSTER_CAPACITY',
      message: 'The active lineup plus interchange cannot exceed the configured roster size.',
    });
  }

  try {
    Intl.DateTimeFormat('en-AU', { timeZone: rules.leagueTimeZone });
  } catch {
    issues.push({
      code: 'TIME_ZONE',
      message: 'Choose a valid IANA timezone for the league.',
    });
  }

  return issues;
}

export function isCommissioner(input: {
  role?: string | null;
  isCoCommissioner?: boolean | null;
}) {
  return input.role === 'OWNER' || input.isCoCommissioner === true;
}
