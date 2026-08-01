import type { DraftDirection, DraftStatus } from '@prisma/client';
import type { DraftAutoPickRules, DraftPositionLimits } from '@/lib/draftSettings';

export type DraftTypeValue = 'SNAKE' | 'LINEAR';

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
  selectedCategories: string[];
  positionLimits?: DraftPositionLimits;
  autoPickRules?: DraftAutoPickRules;
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
  clockDurationSeconds: number | null;
  schedulingVersion: number;
  eventSequence: number;
  participants: DraftParticipantSnapshot[];
  settings: DraftSettingsSnapshot;
  picks: DraftPickSnapshot[];
}

interface DraftClockTokenBase {
  draftId: string;
  leagueId: string;
  currentPick: number;
  stateRevision: number;
  durationSeconds: number;
}

/**
 * Immutable durable clock state for one scheduling revision. League settings are deliberately
 * absent: once a revision is created, later settings edits cannot redefine its duration.
 */
export type DraftClockToken =
  | (DraftClockTokenBase & {
      status: 'LIVE';
      startedAt: Date;
      deadlineAt: Date;
      pausedRemainingSeconds: null;
    })
  | (DraftClockTokenBase & {
      status: 'PAUSED';
      startedAt: null;
      deadlineAt: null;
      pausedRemainingSeconds: number;
    })
  | (DraftClockTokenBase & {
      status: 'SCHEDULED' | 'COMPLETED';
      startedAt: null;
      deadlineAt: null;
      pausedRemainingSeconds: null;
    });

export type LiveDraftClockToken = Extract<DraftClockToken, { status: 'LIVE' }>;

export interface DraftClockScheduleReceipt {
  token: LiveDraftClockToken;
  jobId: string;
  acceptedAt: Date;
  repaired: boolean;
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
  currentPick?: number;
  status?: DraftStatus;
  nextRound?: number;
  nextDirection?: DraftDirection;
  pickStartedAt?: string | null;
  pickDeadlineAt?: string | null;
  schedulingVersion?: number;
  durationSeconds?: number;
  serverNow?: string;
  isComplete?: boolean;
}

export interface DraftLifecycleEventPayload {
  status: DraftStatus;
  schedulingVersion: number;
  durationSeconds: number;
  serverNow: string;
  pickStartedAt: string | null;
  pickDeadlineAt: string | null;
  pausedRemainingSeconds: number | null;
}

export type DraftCommandEventType =
  | 'draft:pick-made'
  | 'draft:auto-pick'
  | 'draft:paused'
  | 'draft:resumed'
  | 'draft:started'
  | 'draft:completed'
  | 'draft:clock-repaired'
  | 'draft:queue-updated';

export type DraftOutboxPayload = DraftPickEventPayload | DraftLifecycleEventPayload | null;

export interface DraftOutboxEventRecord {
  id: string;
  draftId: string;
  leagueId: string;
  event: DraftCommandEventType;
  payload: DraftOutboxPayload;
  publishState: boolean;
  sequence: number | null;
  clockRevision: number | null;
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
