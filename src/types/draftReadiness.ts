export type DraftReadinessBlockerCode =
  | 'league_not_found'
  | 'settings_missing'
  | 'draft_time_missing'
  | 'insufficient_members'
  | 'draft_room_missing'
  | 'draft_order_missing'
  | 'player_pool_empty'
  | 'player_pool_shortage'
  | 'position_pool_shortage'
  | 'draft_completed';

export interface DraftReadinessBlocker {
  code: DraftReadinessBlockerCode;
  message: string;
}

export interface DraftOperationalReadiness {
  leagueId: string;
  draftId: string | null;
  status: 'not_configured' | 'blocked' | 'scheduled' | 'room_open' | 'live' | 'completed';
  scheduledStartAt: string | null;
  roomOpenedAt: string | null;
  memberCount: number;
  rosterSpots: number;
  totalPicks: number;
  playerPool: {
    availableCount: number;
    hasPlayers: boolean;
  };
  lifecycle: {
    shouldBeOpen: boolean;
    canEnterRoom: boolean;
    canStartClock: boolean;
    isRunning: boolean;
    isComplete: boolean;
  };
  blockers: DraftReadinessBlocker[];
}
