import type { LiveDraftState } from '@/services/liveDraftEngine';
import { z } from 'zod';

const IsoTimestampSchema = z.iso.datetime();

export const DraftRealtimeStatePayloadSchema = z.object({
  leagueId: z.string(),
  draftId: z.string(),
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
      queue: z.array(z.string()),
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

export function toDraftRealtimeStatePayload(state: LiveDraftState): DraftRealtimeStatePayload {
  return DraftRealtimeStatePayloadSchema.parse({
    ...state,
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
      ...participant,
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
