// Main exports for the scheduling system

export * from './types';
export * from './roundRobin';
export * from './playoffs';
export * from './scheduler';

// Re-export commonly used functions for convenience
export {
  generateCompleteSchedule,
  validateLeagueSettings,
  previewScheduleRequirements,
  LEAGUE_PRESETS,
} from './scheduler';

export {
  generateRoundRobin,
  buildRegularSeasonSchedule,
  validateScheduleFeasibility,
} from './roundRobin';

export {
  buildPlayoffs,
  expandPlayoffRounds,
  calculatePlayoffRequirements,
  generateRoundNames,
  buildConsolationBracket,
  PLAYOFF_FORMATS,
} from './playoffs';

export type {
  LeagueSettings,
  Match,
  WeeklySchedule,
  PlayoffRound,
  ScheduleResult,
  TeamRecord,
} from './types';
