/**
 * Shared constants for Statly scripts and application
 */

export const FIREBASE_COLLECTIONS = {
  PLAYERS: 'players',
  TEAMS: 'teams',
  ROOMS: 'rooms',
  MATCH_LOGS: 'matchLogs',
  LEAGUES: 'leagues',
  DRAFTS: 'drafts',
} as const;

export const DRAFT_DEFAULTS = {
  TIME_PER_PICK_SEC: 60,
  TOTAL_ROUNDS: 10,
  MIN_TEAMS: 2,
  MAX_TEAMS: 20,
  DEFAULT_TEAM_COUNT: 12,
  AVAILABLE_PICK_TIMES: [30, 45, 60, 90, 120] as const,
} as const;

export const PLAYER_POSITIONS = {
  DEF: 'DEF',
  MID: 'MID',
  FWD: 'FWD',
  RUC: 'RUC',
} as const;

export const ROOM_STATUSES = {
  PENDING: 'pending',
  ACTIVE: 'active',
  COMPLETED: 'completed',
} as const;

export const LOG_LEVELS = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error',
} as const;

export type RoomStatus = (typeof ROOM_STATUSES)[keyof typeof ROOM_STATUSES];
export type PlayerPosition = (typeof PLAYER_POSITIONS)[keyof typeof PLAYER_POSITIONS];
export type LogLevel = (typeof LOG_LEVELS)[keyof typeof LOG_LEVELS];
