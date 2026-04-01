import { DraftDirection, DraftStatus } from '@prisma/client';

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
