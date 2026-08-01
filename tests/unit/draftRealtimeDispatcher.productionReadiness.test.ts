import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DraftRealtimeDispatcher } from '@/server/draft/services/DraftRealtimeDispatcher';
import {
  DraftRealtimeStatePayloadSchema,
  toDraftRealtimeStatePayload,
  type CanonicalLiveDraftState,
} from '@/services/realtime/draftStateWire';
import {
  DRAFT_REALTIME_EVENTS,
  draftPubSub,
  parseAndValidateEnvelope,
} from '@/services/realtime/pubsub';
import { describe, expect, it, vi } from 'vitest';

function buildLiveDraftState(): CanonicalLiveDraftState {
  const startedAt = new Date('2026-07-28T12:00:00.000Z');
  const expiresAt = new Date('2026-07-28T12:01:30.000Z');

  return {
    leagueId: 'league-1',
    draftId: 'draft-1',
    throughSequence: 4,
    clock: {
      status: 'LIVE',
      revision: 7,
      durationSeconds: 90,
      serverNow: '2026-07-28T12:00:05.000Z',
      startedAt: '2026-07-28T12:00:00.000Z',
      deadlineAt: '2026-07-28T12:01:30.000Z',
    },
    status: 'LIVE',
    currentPick: {
      userId: 'user-1',
      memberId: 'member-1',
      pickNumber: 1,
      round: 1,
      slot: 1,
      expiresAt,
      startedAt,
    },
    picks: [
      {
        playerId: 'player-1',
        userId: 'user-2',
        memberId: 'member-2',
        pickNumber: 0,
        round: 0,
        slot: 0,
        auto: false,
        timestamp: startedAt,
      },
    ],
    participants: [
      {
        userId: 'user-1',
        memberId: 'member-1',
        displayName: 'Member One',
        draftOrder: 1,
        isOnline: true,
        autoPickEnabled: false,
        lastActivity: startedAt,
      },
    ],
    timerSettings: {
      durationSeconds: 90,
      autopickAfterExpiry: true,
      pausedAt: startedAt,
      pausedTimeRemaining: 45,
    },
    draftSettings: {
      totalRounds: 22,
      totalTeams: 12,
      draftType: 'SNAKE',
      pickTimeLimit: 90,
    },
    paused: false,
    createdAt: startedAt,
    updatedAt: startedAt,
    lastActivity: startedAt,
  };
}

describe('draft realtime dispatcher production readiness', () => {
  it('does not warn for expected worker-side local emit skips', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/server/draft/services/DraftRealtimeDispatcher.ts'),
      'utf8'
    );

    expect(source).toContain('logger.debug');
    expect(source).toContain('Skipping local realtime emit without attached Socket.IO server');
    expect(source).not.toContain('Skipping realtime dispatch without attached Socket.IO server');
  });

  it('includes the authoritative pick deadline in state patch deltas', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/server/draft/services/DraftRealtimeDispatcher.ts'),
      'utf8'
    );

    expect(source).toContain(
      "pickDeadlineAt: state.clock.status === 'LIVE' ? state.clock.deadlineAt : null"
    );
    expect(source).not.toContain('pickDeadlineAt: state.currentPick.expiresAt');
  });

  it('uses one validated ISO timestamp payload for local and Redis state fanout', async () => {
    const publishSpy = vi.spyOn(draftPubSub, 'publish').mockResolvedValue();
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    const dispatcher = new DraftRealtimeDispatcher();
    dispatcher.attachSocketServer({ local: { to } } as never);

    await dispatcher.publishState(buildLiveDraftState());

    const publishedPayload = publishSpy.mock.calls[0]?.[2];
    const wirePayload = DraftRealtimeStatePayloadSchema.parse(publishedPayload);
    const jsonPayload = JSON.parse(JSON.stringify(wirePayload));
    const parsedEnvelope = parseAndValidateEnvelope(
      JSON.stringify({
        v: 1,
        event: 'draft:state',
        draftId: 'draft-1',
        payload: jsonPayload,
        instanceId: 'another-instance',
        ts: Date.now(),
      })
    );
    if (parsedEnvelope?.v !== 1) {
      throw new Error('Expected a v1 draft state envelope');
    }

    expect(wirePayload.currentPick.expiresAt).toBe('2026-07-28T12:01:30.000Z');
    expect(wirePayload.currentPick.startedAt).toBe('2026-07-28T12:00:00.000Z');
    expect(wirePayload.revision).toBe(7);
    expect(wirePayload.serverNow).toBe('2026-07-28T12:00:05.000Z');
    expect(wirePayload.clock).toEqual(buildLiveDraftState().clock);
    expect(wirePayload.picks[0]?.timestamp).toBe('2026-07-28T12:00:00.000Z');
    expect(wirePayload.participants[0]?.lastActivity).toBe('2026-07-28T12:00:00.000Z');
    expect(wirePayload.participants[0]).not.toHaveProperty('queue');
    expect(wirePayload.timerSettings.pausedAt).toBe('2026-07-28T12:00:00.000Z');
    expect(parsedEnvelope.payload).toEqual(jsonPayload);
    expect(emit).toHaveBeenCalledWith('draft:state', wirePayload);
    expect(emit).toHaveBeenCalledWith(
      'draft:delta',
      expect.objectContaining({
        payload: expect.objectContaining({
          draft: expect.objectContaining({
            pickDeadlineAt: '2026-07-28T12:01:30.000Z',
          }),
        }),
      })
    );
  });

  it('keeps private queue updates outside the shared draft event protocol', () => {
    expect(DRAFT_REALTIME_EVENTS).not.toContain('draft:queue-updated');
  });

  it('rejects draft state envelopes with invalid wire timestamps', () => {
    const payload = toDraftRealtimeStatePayload(buildLiveDraftState());

    expect(
      parseAndValidateEnvelope(
        JSON.stringify({
          v: 1,
          event: 'draft:state',
          draftId: 'draft-1',
          payload: {
            ...payload,
            currentPick: { ...payload.currentPick, expiresAt: 'not-a-timestamp' },
          },
          instanceId: 'another-instance',
          ts: Date.now(),
        })
      )
    ).toBeNull();
  });

  it('rejects draft state envelopes that route a payload to another draft', () => {
    const payload = toDraftRealtimeStatePayload(buildLiveDraftState());

    expect(
      parseAndValidateEnvelope(
        JSON.stringify({
          v: 1,
          event: 'draft:state',
          draftId: 'draft-2',
          payload,
          instanceId: 'another-instance',
          ts: Date.now(),
        })
      )
    ).toBeNull();
  });

  it('delegates pick delta construction to the shared live-and-replay contract', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/server/draft/services/DraftRealtimeDispatcher.ts'),
      'utf8'
    );

    expect(source).toContain('buildDraftPickDelta');
    expect(source).toContain('const delta = buildDraftPickDelta(pickPayload, Date.now())');
    expect(source).not.toContain('buildPickDeltaPayload');
  });

  it('keeps application pubsub fanout local when the Socket.IO adapter is installed', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/server/draft/services/DraftRealtimeDispatcher.ts'),
      'utf8'
    );

    expect(source).toContain('this.io?.local.to(draftId).emit(event, payload)');
    expect(source).toContain('this.io?.local.to(`draft:${draftId}`).emit(event, payload)');
    expect(source).not.toContain('this.io?.to(draftId).emit(event, payload)');
  });
});
