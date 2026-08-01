import { z } from 'zod';

import {
  DraftClockPayloadSchema,
  type DraftClockPayload,
} from '@/services/realtime/draftStateWire';

const DraftPickEventWireSchema = z.object({
  id: z.string(),
  overall: z.number().int().positive(),
  round: z.number().int().positive(),
  slot: z.number().int().positive(),
  player: z.object({
    id: z.string(),
    name: z.string(),
    position: z.string(),
    club: z.string(),
  }),
  member: z.object({
    id: z.string(),
    displayName: z.string(),
  }),
  auto: z.boolean(),
  madeAt: z.iso.datetime(),
  timestamp: z.union([z.date().transform((value) => value.toISOString()), z.iso.datetime()]),
  currentPick: z.number().int().positive().optional(),
  status: z.enum(['SCHEDULED', 'LIVE', 'PAUSED', 'COMPLETED']).optional(),
  nextRound: z.number().int().positive().optional(),
  nextDirection: z.enum(['FORWARD', 'REVERSE']).optional(),
  pickStartedAt: z.iso.datetime().nullable().optional(),
  pickDeadlineAt: z.iso.datetime().nullable().optional(),
  schedulingVersion: z.number().int().nonnegative().optional(),
  isComplete: z.boolean().optional(),
});

const DraftLifecycleEventWireSchema = z.object({
  status: z.enum(['LIVE', 'PAUSED']),
  schedulingVersion: z.number().int().nonnegative(),
  durationSeconds: z.number().int().positive(),
  serverNow: z.iso.datetime(),
  pickStartedAt: z.iso.datetime().nullable(),
  pickDeadlineAt: z.iso.datetime().nullable(),
  pausedRemainingSeconds: z.number().int().nonnegative().nullable(),
});

export type DraftRealtimeDelta = {
  type: 'SNAPSHOT' | 'PICK_MADE' | 'PLAYER_REMOVED' | 'PLAYER_ADDED' | 'STATE_PATCH';
  payload: unknown;
  ts?: number;
  revision?: number;
};

export type DraftPickDeltaPayload = {
  pick: Pick<
    z.infer<typeof DraftPickEventWireSchema>,
    'id' | 'overall' | 'round' | 'slot' | 'player' | 'member' | 'auto' | 'madeAt' | 'timestamp'
  >;
  currentPick?: number;
  isComplete?: boolean;
  status?: 'SCHEDULED' | 'LIVE' | 'PAUSED' | 'COMPLETED';
  round?: number;
  direction?: 'FORWARD' | 'REVERSE';
  pickStartedAt?: string | null;
  pickDeadlineAt?: string | null;
  schedulingVersion?: number;
};

export function buildDraftPickDelta(payload: unknown, ts: number): DraftRealtimeDelta | null {
  const result = DraftPickEventWireSchema.safeParse(payload);
  if (!result.success) return null;

  const pick = result.data;
  const deltaPayload: DraftPickDeltaPayload = {
    pick: {
      id: pick.id,
      overall: pick.overall,
      round: pick.round,
      slot: pick.slot,
      player: pick.player,
      member: pick.member,
      auto: pick.auto,
      madeAt: pick.madeAt,
      timestamp: pick.timestamp,
    },
    currentPick: pick.currentPick,
    isComplete: pick.isComplete,
    status: pick.status,
    round: pick.nextRound,
    direction: pick.nextDirection,
    pickStartedAt: pick.pickStartedAt,
    pickDeadlineAt: pick.pickDeadlineAt,
    schedulingVersion: pick.schedulingVersion,
  };

  return {
    type: 'PICK_MADE',
    payload: deltaPayload,
    ts,
    revision: pick.schedulingVersion,
  };
}

export function buildDraftLifecycleDelta(
  payload: unknown,
  expectedStatus: 'LIVE' | 'PAUSED'
): DraftRealtimeDelta | null {
  const lifecycleResult = DraftLifecycleEventWireSchema.safeParse(payload);
  if (!lifecycleResult.success || lifecycleResult.data.status !== expectedStatus) return null;

  const lifecycle = lifecycleResult.data;
  const clockResult = DraftClockPayloadSchema.safeParse(
    expectedStatus === 'LIVE'
      ? {
          status: 'LIVE',
          revision: lifecycle.schedulingVersion,
          durationSeconds: lifecycle.durationSeconds,
          serverNow: lifecycle.serverNow,
          startedAt: lifecycle.pickStartedAt,
          deadlineAt: lifecycle.pickDeadlineAt,
        }
      : {
          status: 'PAUSED',
          revision: lifecycle.schedulingVersion,
          durationSeconds: lifecycle.durationSeconds,
          serverNow: lifecycle.serverNow,
          remainingSeconds: lifecycle.pausedRemainingSeconds,
        }
  );
  if (!clockResult.success) return null;

  const clock: DraftClockPayload = clockResult.data;
  return {
    type: 'STATE_PATCH',
    payload: {
      draft: {
        status: expectedStatus,
        pickDeadlineAt: clock.status === 'LIVE' ? clock.deadlineAt : null,
      },
      liveState: {
        clock,
        revision: clock.revision,
      },
    },
    ts: Date.parse(clock.serverNow),
    revision: clock.revision,
  };
}

function parsePersistedPayload(payload: string | null): unknown {
  if (!payload) return null;

  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

export function toDraftBackfillDelta(event: {
  event: string;
  payload: string | null;
  createdAt: Date;
}): DraftRealtimeDelta | null {
  const payload = parsePersistedPayload(event.payload);

  switch (event.event) {
    case 'draft:pick-made':
    case 'draft:auto-pick':
      return buildDraftPickDelta(payload, event.createdAt.getTime());
    case 'draft:started':
    case 'draft:resumed':
      return buildDraftLifecycleDelta(payload, 'LIVE');
    case 'draft:paused':
      return buildDraftLifecycleDelta(payload, 'PAUSED');
    case 'draft:completed':
      return {
        type: 'STATE_PATCH',
        payload: { draft: { status: 'COMPLETED' } },
        ts: event.createdAt.getTime(),
      };
    default:
      return null;
  }
}
