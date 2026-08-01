import {
  DraftRealtimeStatePayloadSchema,
  DraftRoomSnapshotPayloadSchema,
} from '@/services/realtime/draftStateWire';

import { z } from 'zod';

const IsoTimestampSchema = z.iso.datetime();

export const DRAFT_REALTIME_PROTOCOLS = [2, 1] as const;

export const DraftRealtimeProtocolSchema = z.union([z.literal(1), z.literal(2)]);
export type DraftRealtimeProtocol = z.infer<typeof DraftRealtimeProtocolSchema>;

export const DraftRealtimeJoinRequestSchema = z
  .object({
    draftId: z.string().min(1),
    realtimeProtocols: z.array(DraftRealtimeProtocolSchema).min(1).max(2).optional(),
  })
  .passthrough();

export type DraftRealtimeJoinRequest = z.infer<typeof DraftRealtimeJoinRequestSchema>;

export const DraftRealtimeJoinV2RequestSchema = z
  .object({
    draftId: z.string().min(1),
    generation: z.number().int().positive().safe(),
  })
  .strict();

export type DraftRealtimeJoinV2Request = z.infer<typeof DraftRealtimeJoinV2RequestSchema>;

export const DraftRealtimeLeaveV2RequestSchema = DraftRealtimeJoinV2RequestSchema;
export type DraftRealtimeLeaveV2Request = DraftRealtimeJoinV2Request;

export const DraftRealtimeSnapshotV2Schema = z
  .object({
    ...DraftRoomSnapshotPayloadSchema.shape,
    schemaVersion: z.literal(2),
    throughSequence: z.number().int().nonnegative(),
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

export type DraftRealtimeSnapshotV2 = z.infer<typeof DraftRealtimeSnapshotV2Schema>;

export function selectDraftRealtimeProtocol(
  offeredProtocols: readonly DraftRealtimeProtocol[] | undefined,
  supportedProtocols: readonly DraftRealtimeProtocol[] = [1]
): DraftRealtimeProtocol | null {
  const offered = offeredProtocols ?? [1];
  const supported = new Set(supportedProtocols);
  return offered.find((protocol) => supported.has(protocol)) ?? null;
}

export const DRAFT_PUBLIC_COMMAND_EVENTS = [
  'draft:started',
  'draft:pick-made',
  'draft:auto-pick',
  'draft:paused',
  'draft:resumed',
  'draft:completed',
  'draft:clock-repaired',
] as const;

export const DraftPublicCommandEventSchema = z.enum(DRAFT_PUBLIC_COMMAND_EVENTS);
export type DraftPublicCommandEvent = z.infer<typeof DraftPublicCommandEventSchema>;

export const DraftRealtimeStatePayloadV2Schema = DraftRealtimeStatePayloadSchema.extend({
  throughSequence: z.number().int().nonnegative(),
}).superRefine((state, context) => {
  if (state.revision !== state.clock.revision) {
    context.addIssue({
      code: 'custom',
      message: 'State and clock revisions must match',
      path: ['clock', 'revision'],
    });
  }

  if (state.serverNow !== state.clock.serverNow) {
    context.addIssue({
      code: 'custom',
      message: 'State and clock server timestamps must match',
      path: ['clock', 'serverNow'],
    });
  }

  if (state.status !== state.clock.status) {
    context.addIssue({
      code: 'custom',
      message: 'State and clock statuses must match',
      path: ['clock', 'status'],
    });
  }
});

export type DraftRealtimeStatePayloadV2 = z.infer<typeof DraftRealtimeStatePayloadV2Schema>;

export const DraftPickEventPayloadV2Schema = z
  .object({
    id: z.string().min(1),
    overall: z.number().int().positive(),
    round: z.number().int().positive(),
    slot: z.number().int().positive(),
    player: z
      .object({
        id: z.string().min(1),
        name: z.string(),
        position: z.string(),
        club: z.string(),
      })
      .strict(),
    member: z
      .object({
        id: z.string().min(1),
        displayName: z.string(),
      })
      .strict(),
    auto: z.boolean(),
    madeAt: IsoTimestampSchema,
    timestamp: IsoTimestampSchema,
    currentPick: z.number().int().positive(),
    status: z.enum(['SCHEDULED', 'LIVE', 'PAUSED', 'COMPLETED']),
    nextRound: z.number().int().positive(),
    nextDirection: z.enum(['FORWARD', 'REVERSE']),
    pickStartedAt: IsoTimestampSchema.nullable(),
    pickDeadlineAt: IsoTimestampSchema.nullable(),
    schedulingVersion: z.number().int().nonnegative(),
    durationSeconds: z.number().int().positive(),
    serverNow: IsoTimestampSchema,
    isComplete: z.boolean(),
  })
  .strict();

export type DraftPickEventPayloadV2 = z.infer<typeof DraftPickEventPayloadV2Schema>;

export const DraftLifecycleEventPayloadV2Schema = z
  .object({
    status: z.enum(['LIVE', 'PAUSED']),
    schedulingVersion: z.number().int().nonnegative(),
    durationSeconds: z.number().int().positive(),
    serverNow: IsoTimestampSchema,
    pickStartedAt: IsoTimestampSchema.nullable(),
    pickDeadlineAt: IsoTimestampSchema.nullable(),
    pausedRemainingSeconds: z.number().int().nonnegative().nullable(),
  })
  .strict();

export type DraftLifecycleEventPayloadV2 = z.infer<typeof DraftLifecycleEventPayloadV2Schema>;

const DraftRealtimeV2EnvelopeBaseSchema = z.object({
  v: z.literal(2),
  kind: z.literal('event'),
  eventId: z.string().min(1),
  draftId: z.string().min(1),
  leagueId: z.string().min(1),
  sequence: z.number().int().positive(),
  stateRevision: z.number().int().nonnegative(),
  occurredAt: IsoTimestampSchema,
});

function withEventData<TEvent extends z.ZodType>(eventSchema: TEvent) {
  return z
    .object({
      event: eventSchema,
      state: DraftRealtimeStatePayloadV2Schema.optional(),
    })
    .strict();
}

const DraftPickEnvelopeDataSchema = withEventData(DraftPickEventPayloadV2Schema);
const DraftLifecycleEnvelopeDataSchema = withEventData(DraftLifecycleEventPayloadV2Schema);

export const DraftRealtimeV2EventEnvelopeSchema = z
  .discriminatedUnion('event', [
    DraftRealtimeV2EnvelopeBaseSchema.extend({
      event: z.literal('draft:pick-made'),
      data: DraftPickEnvelopeDataSchema,
    }).strict(),
    DraftRealtimeV2EnvelopeBaseSchema.extend({
      event: z.literal('draft:auto-pick'),
      data: DraftPickEnvelopeDataSchema,
    }).strict(),
    DraftRealtimeV2EnvelopeBaseSchema.extend({
      event: z.literal('draft:completed'),
      data: DraftPickEnvelopeDataSchema,
    }).strict(),
    DraftRealtimeV2EnvelopeBaseSchema.extend({
      event: z.literal('draft:started'),
      data: DraftLifecycleEnvelopeDataSchema,
    }).strict(),
    DraftRealtimeV2EnvelopeBaseSchema.extend({
      event: z.literal('draft:paused'),
      data: DraftLifecycleEnvelopeDataSchema,
    }).strict(),
    DraftRealtimeV2EnvelopeBaseSchema.extend({
      event: z.literal('draft:resumed'),
      data: DraftLifecycleEnvelopeDataSchema,
    }).strict(),
    DraftRealtimeV2EnvelopeBaseSchema.extend({
      event: z.literal('draft:clock-repaired'),
      data: DraftLifecycleEnvelopeDataSchema,
    }).strict(),
  ])
  .superRefine((envelope, context) => {
    if (
      envelope.event === 'draft:started' ||
      envelope.event === 'draft:resumed' ||
      envelope.event === 'draft:paused' ||
      envelope.event === 'draft:clock-repaired'
    ) {
      const lifecycle = envelope.data.event as DraftLifecycleEventPayloadV2;
      const expectsLive = envelope.event === 'draft:started' || envelope.event === 'draft:resumed';
      if (expectsLive && lifecycle.status !== 'LIVE') {
        context.addIssue({
          code: 'custom',
          message: 'Started and resumed events must carry a LIVE clock',
          path: ['data', 'event', 'status'],
        });
      }
      if (envelope.event === 'draft:paused' && lifecycle.status !== 'PAUSED') {
        context.addIssue({
          code: 'custom',
          message: 'Paused events must carry a PAUSED clock',
          path: ['data', 'event', 'status'],
        });
      }
      if (lifecycle.status === 'LIVE' && (!lifecycle.pickStartedAt || !lifecycle.pickDeadlineAt)) {
        context.addIssue({
          code: 'custom',
          message: 'LIVE lifecycle events require start and deadline timestamps',
          path: ['data', 'event', 'pickDeadlineAt'],
        });
      }
      if (lifecycle.status === 'PAUSED' && lifecycle.pausedRemainingSeconds === null) {
        context.addIssue({
          code: 'custom',
          message: 'PAUSED lifecycle events require persisted remaining time',
          path: ['data', 'event', 'pausedRemainingSeconds'],
        });
      }
    }
    if (envelope.event === 'draft:completed' && envelope.data.event.status !== 'COMPLETED') {
      context.addIssue({
        code: 'custom',
        message: 'Completed events must carry COMPLETED status',
        path: ['data', 'event', 'status'],
      });
    }

    if (envelope.stateRevision !== envelope.data.event.schedulingVersion) {
      context.addIssue({
        code: 'custom',
        message: 'Envelope and event state revisions must match',
        path: ['data', 'event', 'schedulingVersion'],
      });
    }

    const state = envelope.data.state;
    if (!state) return;

    if (state.draftId !== envelope.draftId) {
      context.addIssue({
        code: 'custom',
        message: 'Envelope and state draft IDs must match',
        path: ['data', 'state', 'draftId'],
      });
    }
    if (state.leagueId !== envelope.leagueId) {
      context.addIssue({
        code: 'custom',
        message: 'Envelope and state league IDs must match',
        path: ['data', 'state', 'leagueId'],
      });
    }
    if (state.revision !== envelope.stateRevision) {
      context.addIssue({
        code: 'custom',
        message: 'Envelope and state revisions must match',
        path: ['data', 'state', 'revision'],
      });
    }
    if (state.throughSequence < envelope.sequence) {
      context.addIssue({
        code: 'custom',
        message: 'State sequence boundary cannot precede its event',
        path: ['data', 'state', 'throughSequence'],
      });
    }
    if (state.status !== envelope.data.event.status) {
      context.addIssue({
        code: 'custom',
        message: 'Event and canonical state statuses must match',
        path: ['data', 'state', 'status'],
      });
    }
  });

export type DraftRealtimeV2EventEnvelope = z.infer<typeof DraftRealtimeV2EventEnvelopeSchema>;

export const DraftRealtimeReplayV2Schema = z
  .object({
    afterSequence: z.number().int().nonnegative(),
    throughSequence: z.number().int().nonnegative(),
    events: z.array(DraftRealtimeV2EventEnvelopeSchema).max(250),
  })
  .strict()
  .superRefine((replay, context) => {
    let expected = replay.afterSequence + 1;
    for (const event of replay.events) {
      if (event.sequence !== expected) {
        context.addIssue({
          code: 'custom',
          message: 'Replay events must be strictly contiguous',
          path: ['events'],
        });
        return;
      }
      expected += 1;
    }
    if (replay.throughSequence !== expected - 1) {
      context.addIssue({
        code: 'custom',
        message: 'Replay boundary must equal the final replay event sequence',
        path: ['throughSequence'],
      });
    }
  });

export type DraftRealtimeReplayV2 = z.infer<typeof DraftRealtimeReplayV2Schema>;

const DraftRealtimeJoinV1SuccessAckSchema = z
  .object({
    ok: z.literal(true),
    draftId: z.string().min(1),
    protocol: z.literal(1),
  })
  .strict();

const DraftRealtimeJoinV2SuccessAckSchema = z
  .object({
    ok: z.literal(true),
    draftId: z.string().min(1),
    leagueId: z.string().min(1),
    protocol: z.literal(2),
    generation: z.number().int().positive().safe(),
    snapshot: DraftRealtimeSnapshotV2Schema,
    replay: DraftRealtimeReplayV2Schema,
  })
  .strict()
  .superRefine((acknowledgement, context) => {
    if (acknowledgement.snapshot.draftId !== acknowledgement.draftId) {
      context.addIssue({
        code: 'custom',
        message: 'Snapshot draft ID must match its acknowledgement',
        path: ['snapshot', 'draftId'],
      });
    }
    if (acknowledgement.snapshot.leagueId !== acknowledgement.leagueId) {
      context.addIssue({
        code: 'custom',
        message: 'Snapshot league ID must match its acknowledgement',
        path: ['snapshot', 'leagueId'],
      });
    }
    if (acknowledgement.replay.afterSequence !== acknowledgement.snapshot.throughSequence) {
      context.addIssue({
        code: 'custom',
        message: 'Replay must begin at the snapshot sequence boundary',
        path: ['replay', 'afterSequence'],
      });
    }
    for (const event of acknowledgement.replay.events) {
      if (
        event.draftId !== acknowledgement.draftId ||
        event.leagueId !== acknowledgement.leagueId
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Replay event scope must match its acknowledgement',
          path: ['replay', 'events'],
        });
        return;
      }
    }
  });

const DraftRealtimeJoinFailureAckSchema = z
  .object({
    ok: z.literal(false),
    draftId: z.string(),
    generation: z.number().int().positive().safe().optional(),
    code: z.enum([
      'INVALID_REQUEST',
      'UNSUPPORTED_PROTOCOL',
      'UNAUTHENTICATED',
      'FORBIDDEN',
      'ROOM_FULL',
      'NOT_FOUND',
      'SYNC_UNAVAILABLE',
      'SUPERSEDED',
      'INTERNAL_ERROR',
    ]),
    message: z.string().min(1),
    retryable: z.boolean(),
  })
  .strict();

export const DraftRealtimeJoinAckSchema = z.union([
  DraftRealtimeJoinV1SuccessAckSchema,
  DraftRealtimeJoinV2SuccessAckSchema,
  DraftRealtimeJoinFailureAckSchema,
]);

export type DraftRealtimeJoinAck = z.infer<typeof DraftRealtimeJoinAckSchema>;

export function parseDraftRealtimeV2EventEnvelope(
  value: unknown
): DraftRealtimeV2EventEnvelope | null {
  const result = DraftRealtimeV2EventEnvelopeSchema.safeParse(value);
  return result.success ? result.data : null;
}
