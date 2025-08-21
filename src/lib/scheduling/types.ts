// Core scheduling types for league management

export type LeagueSettings = {
  numTeams: number;                 // N
  seasonWeeks: number;              // total AFL weeks you want to use
  matchupsPerOpponent: 1 | 2;       // single or double round-robin target
  interleagueWeeks?: number;        // optional extra weeks if you want
  playoffs?: {
    enabled?: boolean;              // whether playoffs are enabled
    teams: number;                  // F (e.g., 4, 6, 8, 10…)
    legLengthWeeks: number;         // 1 (single week) or 2 (two-week aggregate)
    reseedEachRound: boolean;       // true = reseed by surviving seed
    includeConsolation: boolean;    // consolation bracket for non-qualifiers
  };
};

export type Match = { 
  id?: string;
  week?: number;
  homeTeam?: number;
  awayTeam?: number;
  homeSeed?: number | null; 
  awaySeed?: number | null; 
  round?: string;
  isPlayoff?: boolean;
  isConsolation?: boolean;
  isByeWeek?: boolean;
  roundName?: string;
};

export type WeeklySchedule = {
  week: number;
  matches: Match[];
  roundName?: string;
  isPlayoff?: boolean;
  isConsolation?: boolean;
};

export type PlayoffRound = Match[];

export type ScheduleResult = {
  success?: boolean;
  error?: string;
  regularSeason: WeeklySchedule[];
  playoffs: WeeklySchedule[];
  consolation: WeeklySchedule[];
  summary: {
    totalWeeks: number;
    regularSeasonWeeks: number;
    playoffWeeks: number;
    totalMatches: number;
  };
};

export type TeamRecord = {
  teamId: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  seed: number;
};

export enum TiebreakCriteria {
  HEAD_TO_HEAD = 'head_to_head',
  POINTS_FOR = 'points_for',
  POINTS_AGAINST = 'points_against',
  LAST_THREE_ROUNDS = 'last_three_rounds',
  COIN_TOSS = 'coin_toss'
}
