// Unified Draft Types - Single source of truth for all draft data
export type DraftStatus = 'SCHEDULED' | 'LOBBY' | 'COUNTDOWN' | 'LIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
export type DraftDirection = 'FORWARD' | 'REVERSE';
export type DraftType = 'SNAKE' | 'LINEAR';
export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'reconnecting';

// Core draft entities
export interface DraftPlayer {
  id: string;
  name: string;
  position: string;
  club: string;
  fantasyPoints?: number;
  avgPoints?: number;
  tier?: number;
  adp?: number; // Average Draft Position
  injuryStatus?: 'healthy' | 'questionable' | 'injured' | 'out';
  isAvailable: boolean;
  draftedBy?: string;
  pickNumber?: number;
}

export interface DraftParticipant {
  id: string;
  userId: string;
  displayName: string;
  teamName?: string;
  draftOrder: number;
  isOnline: boolean;
  lastSeen: Date;
  isCurrentTurn: boolean;
  timeRemaining?: number;
  queue?: string[]; // Player IDs in priority order
  autoPickSettings?: {
    enabled: boolean;
    strategy: 'BALANCED' | 'AGGRESSIVE' | 'CONSERVATIVE';
    priorityPositions: string[];
  };
  connectionHealth?: {
    lastPing: Date;
    missedPings: number;
    connectionQuality: 'EXCELLENT' | 'GOOD' | 'POOR' | 'UNSTABLE';
  };
}

// Wire-facing types for API serialization
export interface DraftParticipantWire {
  id: string;
  userId: string;
  displayName: string;
  teamName?: string;
  draftOrder: number;
  isOnline: boolean;
  lastSeen: string; // ISO string
  isCurrentTurn: boolean;
  timeRemaining?: number;
  queue?: string[];
  autoPickSettings?: {
    enabled: boolean;
    strategy: 'BALANCED' | 'AGGRESSIVE' | 'CONSERVATIVE';
    priorityPositions: string[];
  };
  connectionHealth?: {
    lastPing: string; // ISO string
    missedPings: number;
    connectionQuality: 'EXCELLENT' | 'GOOD' | 'POOR' | 'UNSTABLE';
  };
}

export interface DraftPick {
  id: string;
  overall: number;
  round: number;
  slot: number;
  player: DraftPlayer;
  member: {
    id: string;
    userId: string;
    displayName: string;
    teamName: string;
  };
  auto: boolean;
  madeAt: Date;
  timeToMake?: number; // Seconds taken to make pick
}

// Wire-facing types for API serialization
export interface DraftPickWire {
  id: string;
  overall: number;
  round: number;
  slot: number;
  player: DraftPlayer;
  member: {
    id: string;
    userId: string;
    displayName: string;
    teamName: string;
  };
  auto: boolean;
  madeAt: string; // ISO string
  timeToMake?: number;
}

export interface DraftSettings {
  name: string;
  leagueId: string;
  leagueSize: number;
  draftType: DraftType;
  timePerPick: number;
  timeZone: string;
  enableReminders: boolean;
  totalRounds: number;
  rosterSize: number;
  startingLineup: Record<string, number>;
  benchSize: number;
  allowTrades: boolean;
  autoPickEnabled: boolean;
  pauseOnDisconnect: boolean;
  maxPauseDuration: number;
}

export interface DraftState {
  id: string;
  leagueId: string;
  name: string;
  status: DraftStatus;
  currentPick: number;
  totalPicks: number;
  round: number;
  direction: DraftDirection;
  participants: DraftParticipant[];
  picks: DraftPick[];
  availablePlayers: DraftPlayer[];
  settings: DraftSettings;
  createdAt: Date;
  updatedAt: Date;
  lastActivity: Date;
  scheduledStart?: Date;
  startedAt?: Date;
  completedAt?: Date;
  pausedAt?: Date;
  pausedBy?: string;
}

// Wire-facing types for API serialization
export interface DraftStateWire {
  id: string;
  leagueId: string;
  name: string;
  status: DraftStatus;
  currentPick: number;
  totalPicks: number;
  round: number;
  direction: DraftDirection;
  participants: DraftParticipantWire[];
  picks: DraftPickWire[];
  availablePlayers: DraftPlayer[];
  settings: DraftSettings;
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
  lastActivity: string; // ISO string
  scheduledStart?: string; // ISO string
  startedAt?: string; // ISO string
  completedAt?: string; // ISO string
  pausedAt?: string; // ISO string
  pausedBy?: string;
}

// Real-time state interfaces
export interface ConnectionState {
  status: ConnectionStatus;
  lastUpdate?: Date;
  error?: string;
  reconnectAttempts: number;
  latency: number;
}

export interface TimerState {
  timeRemaining: number;
  isActive: boolean;
  isExpired: boolean;
  autoPickEnabled: boolean;
  autoPickTime: number;
}

export interface LiveDraftState {
  currentTurn?: {
    round: number;
    slot: number;
    member: DraftParticipant;
  };
  nextTurn?: {
    round: number;
    slot: number;
    member: DraftParticipant;
  };
  picksUntilYourTurn: number;
  isYourTurn: boolean;
}

// Draft context interfaces
export interface DraftContextValue {
  // Core state
  draft: DraftState | null;
  participants: DraftParticipant[];
  picks: DraftPick[];
  availablePlayers: DraftPlayer[];
  
  // Real-time state
  connection: ConnectionState;
  timer: TimerState;
  liveState: LiveDraftState;
  
  // Computed values
  isLive: boolean;
  isPaused: boolean;
  isComplete: boolean;
  canMakePick: boolean;
  draftProgress: number;
  
  // Actions
  makePick: (playerId: string) => Promise<void>;
  updateQueue: (queue: string[]) => Promise<void>;
  pauseDraft: () => Promise<void>;
  resumeDraft: () => Promise<void>;
  forceRefresh: () => Promise<void>;
  
  // Loading states
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
}

// Draft events for real-time updates
export type DraftEvent = 
  | { type: 'pick:made'; data: { pick: DraftPick }; timestamp: Date; draftId: string }
  | { type: 'pick:auto'; data: { pick: DraftPick; reason: string }; timestamp: Date; draftId: string }
  | { type: 'draft:paused'; data: { pausedBy: string; pausedAt: string }; timestamp: Date; draftId: string }
  | { type: 'draft:resumed'; data: { resumedBy: string; resumedAt: string }; timestamp: Date; draftId: string }
  | { type: 'draft:completed'; data: { completedAt: string }; timestamp: Date; draftId: string }
  | { type: 'participant:joined'; data: { participant: DraftParticipant }; timestamp: Date; draftId: string }
  | { type: 'participant:left'; data: { participantId: string; reason: string }; timestamp: Date; draftId: string }
  | { type: 'participant:update'; data: { participantId: string; updates: Partial<DraftParticipant> } ; timestamp: Date; draftId: string }
  | { type: 'timer:update'; data: { remainingMs: number; isExpired: boolean }; timestamp: Date; draftId: string }
  // Heartbeat/latency support
  | { type: 'pong'; data: { timestamp?: number }; timestamp: Date; draftId: string };

// Draft actions
export type DraftAction = 
  | { type: 'SET_DRAFT'; payload: { draft: DraftState; participants: DraftParticipant[]; picks: DraftPick[]; availablePlayers: DraftPlayer[] } }
  | { type: 'UPDATE_PICK'; payload: { pick: DraftPick; currentPick: number; round: number; direction: DraftDirection; lastActivity: Date } }
  | { type: 'UPDATE_PARTICIPANT'; payload: { participantId: string; updates: Partial<DraftParticipant> } }
  | { type: 'SET_CONNECTION'; payload: Partial<ConnectionState> }
  | { type: 'SET_TIMER'; payload: Partial<TimerState> }
  | { type: 'SET_ERROR'; payload: { error: string } }
  | { type: 'CLEAR_ERROR'; payload: Record<string, never> }
  | { type: 'SET_LOADING'; payload: { isLoading: boolean; isSaving?: boolean } };

// Draft queue management
export interface DraftQueueItem {
  playerId: string;
  rank: number;
  notes?: string;
  player: DraftPlayer;
}

// Draft analytics
export interface DraftAnalytics {
  totalPicks: number;
  averagePickTime: number;
  autoPickCount: number;
  pauseCount: number;
  totalDuration: number;
  participantEngagement: Record<string, number>;
}
