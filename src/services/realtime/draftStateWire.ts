import type { LiveDraftState } from '@/services/liveDraftEngine';
import { z } from 'zod';

const IsoTimestampSchema = z.iso.datetime();

const DraftStatusSchema = z.enum([
  'SCHEDULED',
  'LOBBY',
  'COUNTDOWN',
  'LIVE',
  'PAUSED',
  'COMPLETED',
]);

const DraftClockBaseSchema = z.object({
  revision: z.number().int().nonnegative(),
  durationSeconds: z.number().int().positive(),
  serverNow: IsoTimestampSchema,
});

/**
 * The persisted pick deadline is the only running-clock authority exposed on the wire.
 * A LIVE clock without an absolute deadline is intentionally not representable: consumers
 * must resynchronize instead of fabricating a full-duration countdown.
 */
export const DraftClockPayloadSchema = z.discriminatedUnion('status', [
  DraftClockBaseSchema.extend({
    status: z.literal('LIVE'),
    startedAt: IsoTimestampSchema,
    deadlineAt: IsoTimestampSchema,
  }),
  DraftClockBaseSchema.extend({
    status: z.literal('PAUSED'),
    remainingSeconds: z.number().int().nonnegative(),
  }),
  DraftClockBaseSchema.extend({
    status: z.literal('SCHEDULED'),
  }),
  DraftClockBaseSchema.extend({
    status: z.literal('LOBBY'),
  }),
  DraftClockBaseSchema.extend({
    status: z.literal('COUNTDOWN'),
  }),
  DraftClockBaseSchema.extend({
    status: z.literal('COMPLETED'),
  }),
]);

const DraftRoomSnapshotParticipantSchema = z.object({
  id: z.string(),
  userId: z.string(),
  displayName: z.string(),
  teamName: z.string().optional(),
  draftOrder: z.number().int().positive(),
});

const DraftRoomSnapshotPickSchema = z.object({
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
    userId: z.string().optional(),
    displayName: z.string(),
    teamName: z.string().optional(),
  }),
  auto: z.boolean(),
  madeAt: IsoTimestampSchema,
});

/**
 * Complete live-critical state shared by HTTP hydration and Socket.IO reconnects.
 * The paginated player catalogue is deliberately outside this snapshot so a reconnect
 * cannot erase an already hydrated catalogue by sending an empty placeholder array.
 */
export const DraftRoomSnapshotPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    draftId: z.string(),
    leagueId: z.string(),
    revision: z.number().int().nonnegative(),
    throughSequence: z.number().int().nonnegative().optional(),
    serverNow: IsoTimestampSchema,
    state: z.object({
      name: z.string(),
      status: DraftStatusSchema,
      currentPick: z.number().int().positive(),
      totalPicks: z.number().int().nonnegative(),
      round: z.number().int().positive(),
      direction: z.enum(['FORWARD', 'REVERSE']),
      draftType: z.enum(['SNAKE', 'LINEAR']).optional(),
      clock: DraftClockPayloadSchema,
      onClockMemberId: z.string().nullable(),
      participants: z.array(DraftRoomSnapshotParticipantSchema),
      picks: z.array(DraftRoomSnapshotPickSchema),
    }),
  })
  .superRefine((snapshot, context) => {
    if (snapshot.revision !== snapshot.state.clock.revision) {
      context.addIssue({
        code: 'custom',
        message: 'Snapshot and clock revisions must match',
        path: ['state', 'clock', 'revision'],
      });
    }

    if (snapshot.serverNow !== snapshot.state.clock.serverNow) {
      context.addIssue({
        code: 'custom',
        message: 'Snapshot and clock server timestamps must match',
        path: ['state', 'clock', 'serverNow'],
      });
    }

    if (snapshot.state.status !== snapshot.state.clock.status) {
      context.addIssue({
        code: 'custom',
        message: 'Snapshot and clock statuses must match',
        path: ['state', 'clock', 'status'],
      });
    }
  });

export type DraftClockPayload = z.infer<typeof DraftClockPayloadSchema>;
export type DraftRoomSnapshotPayload = z.infer<typeof DraftRoomSnapshotPayloadSchema>;

export const DraftRealtimeStatePayloadSchema = z.object({
  leagueId: z.string(),
  draftId: z.string(),
  revision: z.number().int().nonnegative(),
  throughSequence: z.number().int().nonnegative().optional(),
  serverNow: IsoTimestampSchema,
  clock: DraftClockPayloadSchema,
  status: z.enum(['SCHEDULED', 'LOBBY', 'COUNTDOWN', 'LIVE', 'PAUSED', 'COMPLETED']),
  currentPick: z.object({
    userId: z.string(),
    memberId: z.string(),
    pickNumber: z.number(),
    round: z.number(),
    slot: z.number(),
    expiresAt: IsoTimestampSchema,
    startedAt: IsoTimestampSchema,
  }),
  picks: z.array(
    z.object({
      playerId: z.string(),
      userId: z.string(),
      memberId: z.string(),
      pickNumber: z.number(),
      round: z.number(),
      slot: z.number(),
      auto: z.boolean(),
      timestamp: IsoTimestampSchema,
    })
  ),
  participants: z.array(
    z.object({
      userId: z.string(),
      memberId: z.string(),
      displayName: z.string(),
      draftOrder: z.number(),
      isOnline: z.boolean(),
      autoPickEnabled: z.boolean(),
      lastActivity: IsoTimestampSchema,
    })
  ),
  timerSettings: z.object({
    durationSeconds: z.number(),
    autopickAfterExpiry: z.boolean(),
    pausedAt: IsoTimestampSchema.optional(),
    pausedTimeRemaining: z.number().optional(),
  }),
  draftSettings: z.object({
    totalRounds: z.number(),
    totalTeams: z.number(),
    draftType: z.enum(['SNAKE', 'LINEAR']),
    pickTimeLimit: z.number(),
  }),
  paused: z.boolean(),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
  lastActivity: IsoTimestampSchema,
});

export type DraftRealtimeStatePayload = z.infer<typeof DraftRealtimeStatePayloadSchema>;

type PublicDraftParticipant = Omit<LiveDraftState['participants'][number], 'queue'>;

/**
 * Shared room state is intentionally incapable of carrying a member's private queue.
 * Queue hydration uses the authenticated, member-scoped HTTP boundary instead.
 */
export type CanonicalLiveDraftState = Omit<LiveDraftState, 'participants'> & {
  participants: PublicDraftParticipant[];
  clock: DraftClockPayload;
  throughSequence: number;
};

export function toDraftRealtimeStatePayload(
  state: CanonicalLiveDraftState
): DraftRealtimeStatePayload {
  return DraftRealtimeStatePayloadSchema.parse({
    ...state,
    revision: state.clock.revision,
    serverNow: state.clock.serverNow,
    currentPick: {
      ...state.currentPick,
      expiresAt: state.currentPick.expiresAt.toISOString(),
      startedAt: state.currentPick.startedAt.toISOString(),
    },
    picks: state.picks.map((pick) => ({
      ...pick,
      timestamp: pick.timestamp.toISOString(),
    })),
    participants: state.participants.map((participant) => ({
      userId: participant.userId,
      memberId: participant.memberId,
      displayName: participant.displayName,
      draftOrder: participant.draftOrder,
      isOnline: participant.isOnline,
      autoPickEnabled: participant.autoPickEnabled,
      lastActivity: participant.lastActivity.toISOString(),
    })),
    timerSettings: {
      ...state.timerSettings,
      ...(state.timerSettings.pausedAt
        ? { pausedAt: state.timerSettings.pausedAt.toISOString() }
        : {}),
    },
    createdAt: state.createdAt.toISOString(),
    updatedAt: state.updatedAt.toISOString(),
    lastActivity: state.lastActivity.toISOString(),
  });
}
