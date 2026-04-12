import { DraftDirection, DraftStatus } from '@prisma/client';

export type DraftTypeValue = 'SNAKE' | 'LINEAR';
export type DraftTimerAuthority = 'SERVER_PICK_DEADLINE';
export type DraftQueueSelectionPolicy = 'HIGHEST_RANKED_VALID_PLAYER';
export type DraftFallbackSelectionPolicy = 'BEST_AVAILABLE';
export type DraftPauseBehavior = 'STOP_CLOCK_AND_SUPPRESS_AUTO_PICK';
export type DraftResumeBehavior = 'CREATE_FRESH_DEADLINE_AND_INCREMENT_SCHEDULING_VERSION';
export type DraftSchedulingGuard = 'SCHEDULING_VERSION_MATCH_REQUIRED';
export type DraftRealtimeDeliveryModel = 'SNAPSHOT_PLUS_DELTA';

export interface DraftActor {
  userId: string;
  memberId: string;
  role?: string;
}

export interface DraftParticipantSnapshot {
  memberId: string;
  userId: string;
  slot: number;
  displayName: string;
  role: string;
}

export interface DraftSettingsSnapshot {
  rosterSize: number;
  benchSize: number;
  pickSeconds: number;
  allowAutoPick: boolean;
  draftType: DraftTypeValue;
}

export interface DraftPickSnapshot {
  id: string;
  overall: number;
  round: number;
  slot: number;
  memberId: string;
  playerId: string;
  auto: boolean;
}

export interface DraftAggregate {
  id: string;
  leagueId: string;
  status: DraftStatus;
  currentPick: number;
  totalPicks: number;
  round: number;
  direction: DraftDirection;
  startedAt: Date | null;
  completedAt: Date | null;
  pickStartedAt: Date | null;
  pickDeadlineAt: Date | null;
  pausedRemainingSeconds: number | null;
  schedulingVersion: number;
  participants: DraftParticipantSnapshot[];
  settings: DraftSettingsSnapshot;
  picks: DraftPickSnapshot[];
}

export interface DraftTurn {
  round: number;
  slot: number;
  direction: DraftDirection;
  participant: DraftParticipantSnapshot;
}

export interface DraftPlayerSnapshot {
  id: string;
  name: string;
  position: string | null;
  club: string | null;
  active: boolean;
}

export interface DraftPickEventPayload {
  id: string;
  overall: number;
  round: number;
  slot: number;
  player: {
    id: string;
    name: string;
    position: string;
    club: string;
  };
  member: {
    id: string;
    displayName: string;
  };
  auto: boolean;
  madeAt: string;
  timestamp: Date;
}

export interface DraftStatePatchDeltaPayload {
  draft?: {
    status?: DraftStatus | 'SCHEDULED' | 'COUNTDOWN' | 'LOBBY' | 'LIVE' | 'PAUSED' | 'COMPLETED';
    currentPick?: number;
    round?: number;
    direction?: 'FORWARD' | 'REVERSE';
    pickDeadlineAt?: string | null;
  };
  liveState?: {
    currentPick?: number;
    onClockTeamId?: string;
    timeRemaining?: number;
  };
}

export interface DraftQueueUpdatedDeltaPayload {
  userId: string;
  queue: string[];
}

export interface DraftTimerExpiredDeltaPayload {
  draftId: string;
  timestamp: string;
}

export type DraftRealtimeDelta =
  | {
      type: 'PICK_MADE';
      payload: { pick: DraftPickEventPayload };
      ts: number;
    }
  | {
      type: 'QUEUE_UPDATED';
      payload: DraftQueueUpdatedDeltaPayload;
      ts: number;
    }
  | {
      type: 'STATE_PATCH';
      payload: DraftStatePatchDeltaPayload;
      ts: number;
    }
  | {
      type: 'TIMER_EXPIRED';
      payload: DraftTimerExpiredDeltaPayload;
      ts: number;
    };

export type DraftCommandEventType =
  | 'draft:pick-made'
  | 'draft:auto-pick'
  | 'draft:paused'
  | 'draft:resumed'
  | 'draft:started'
  | 'draft:completed'
  | 'draft:queue-updated';

export type DraftOutboxPayload = DraftPickEventPayload | null;

export interface DraftOutboxEventRecord {
  id: string;
  draftId: string;
  leagueId: string;
  event: DraftCommandEventType;
  payload: DraftOutboxPayload;
  publishState: boolean;
  attempts: number;
  lastError: string | null;
  lockedAt: Date | null;
  lockedBy: string | null;
  publishedAt: Date | null;
  createdAt: Date;
}

export interface DraftCommandResult<TData> {
  draftId: string;
  leagueId: string;
  isComplete: boolean;
  currentPick: number;
  events: DraftCommandEventType[];
  publishState: boolean;
  outboxEventIds: string[];
  data: TData;
}

export interface DraftAutoPickPolicy {
  queueSelection: DraftQueueSelectionPolicy;
  fallbackSelection: DraftFallbackSelectionPolicy;
  queueIsAuthoritativeWhenValid: boolean;
}

export interface DraftTimingPolicy {
  timerAuthority: DraftTimerAuthority;
  pauseBehavior: DraftPauseBehavior;
  resumeBehavior: DraftResumeBehavior;
  schedulingGuard: DraftSchedulingGuard;
}

export interface DraftRealtimePolicy {
  deliveryModel: DraftRealtimeDeliveryModel;
  statePublishesAreServerAuthored: boolean;
  clientStateMustTreatServerAsAuthoritative: boolean;
}

export interface DraftBehaviorContract {
  autoPick: DraftAutoPickPolicy;
  timing: DraftTimingPolicy;
  realtime: DraftRealtimePolicy;
}

export const DRAFT_BEHAVIOR_CONTRACT = Object.freeze({
  autoPick: {
    queueSelection: 'HIGHEST_RANKED_VALID_PLAYER',
    fallbackSelection: 'BEST_AVAILABLE',
    queueIsAuthoritativeWhenValid: true,
  },
  timing: {
    timerAuthority: 'SERVER_PICK_DEADLINE',
    pauseBehavior: 'STOP_CLOCK_AND_SUPPRESS_AUTO_PICK',
    resumeBehavior: 'CREATE_FRESH_DEADLINE_AND_INCREMENT_SCHEDULING_VERSION',
    schedulingGuard: 'SCHEDULING_VERSION_MATCH_REQUIRED',
  },
  realtime: {
    deliveryModel: 'SNAPSHOT_PLUS_DELTA',
    statePublishesAreServerAuthored: true,
    clientStateMustTreatServerAsAuthoritative: true,
  },
} as const) satisfies Readonly<DraftBehaviorContract>;
