import type {
  ActiveLineupSlot,
  LeagueLineupSlot,
  LineupSlotSettings,
} from '@/server/leagues/scoringTypes';

export const LINEUP_BUILDER_SLOT_ORDER = [
  'FWD',
  'MID',
  'RUC',
  'DEF',
  'UTIL',
] as const satisfies readonly ActiveLineupSlot[];

export const DEFAULT_LINEUP_BUILDER_SLOTS: LineupSlotSettings = {
  FWD: 5,
  DEF: 5,
  MID: 5,
  RUC: 1,
  UTIL: 3,
};

export interface LineupRosterPlayer {
  playerId: string;
  name: string;
  position: string | null;
  club: string | null;
}

export interface LineupAssignment {
  playerId: string;
  slot: LeagueLineupSlot;
  slotIndex: number;
  lockedAt?: string | null;
}

export interface LineupFieldSpot {
  id: string;
  slot: ActiveLineupSlot;
  slotIndex: number;
  label: string;
}
