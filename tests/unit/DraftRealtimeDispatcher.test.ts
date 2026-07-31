import { beforeEach, describe, expect, it, vi } from 'vitest';

const { draftPubSub } = vi.hoisted(() => ({
  draftPubSub: {
    start: vi.fn(),
    publish: vi.fn(),
  },
}));

vi.mock('@/services/realtime/pubsub', () => ({
  draftPubSub,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { DraftRealtimeDispatcher } from '@/server/draft/services/DraftRealtimeDispatcher';

function attachSocketRecorder(dispatcher: DraftRealtimeDispatcher) {
  const emit = vi.fn();
  const to = vi.fn(() => ({ emit }));
  dispatcher.attachSocketServer({ local: { to } } as any);
  return { emit, to };
}

function emittedDeltas(emit: ReturnType<typeof vi.fn>) {
  return emit.mock.calls.filter(([event]) => event === 'draft:delta').map(([, payload]) => payload);
}

describe('DraftRealtimeDispatcher canonical clock deltas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    draftPubSub.publish.mockResolvedValue(undefined);
  });

  it('publishes authoritative state with its persisted pause clock and revision', async () => {
    const dispatcher = new DraftRealtimeDispatcher();
    const { emit } = attachSocketRecorder(dispatcher);

    await dispatcher.publishState({
      leagueId: 'league-1',
      draftId: 'draft-1',
      status: 'PAUSED',
      clock: {
        status: 'PAUSED',
        revision: 7,
        durationSeconds: 120,
        serverNow: '2026-06-07T00:01:00.000Z',
        remainingSeconds: 37,
      },
      currentPick: {
        userId: 'user-1',
        memberId: 'member-1',
        pickNumber: 3,
        round: 1,
        slot: 1,
        expiresAt: new Date('2026-06-07T00:00:30.000Z'),
        startedAt: new Date('2026-06-07T00:00:00.000Z'),
      },
      picks: [],
      participants: [
        {
          userId: 'user-1',
          memberId: 'member-1',
          displayName: 'Tester',
          draftOrder: 1,
          isOnline: true,
          autoPickEnabled: true,
          lastActivity: new Date('2026-06-07T00:01:00.000Z'),
        },
      ],
      timerSettings: {
        durationSeconds: 120,
        autopickAfterExpiry: true,
        pausedTimeRemaining: 37,
      },
      draftSettings: {
        totalRounds: 1,
        totalTeams: 1,
        draftType: 'SNAKE',
        pickTimeLimit: 120,
      },
      paused: true,
      createdAt: new Date('2026-06-07T00:00:00.000Z'),
      updatedAt: new Date('2026-06-07T00:01:00.000Z'),
      lastActivity: new Date('2026-06-07T00:01:00.000Z'),
    });

    expect(emittedDeltas(emit)[0]).toMatchObject({
      type: 'STATE_PATCH',
      revision: 7,
      ts: Date.parse('2026-06-07T00:01:00.000Z'),
      payload: {
        draft: { status: 'PAUSED' },
        liveState: {
          revision: 7,
          clock: {
            status: 'PAUSED',
            revision: 7,
            remainingSeconds: 37,
          },
        },
      },
    });
    expect(draftPubSub.publish).toHaveBeenCalledWith(
      'draft-1',
      'draft:state',
      expect.objectContaining({ revision: 7, serverNow: '2026-06-07T00:01:00.000Z' })
    );
  });

  it('turns a persisted resume payload into an immediate revisioned LIVE clock delta', async () => {
    const dispatcher = new DraftRealtimeDispatcher();
    const { emit } = attachSocketRecorder(dispatcher);

    await dispatcher.publishDraftEvent('draft-1', 'draft:resumed', {
      status: 'LIVE',
      schedulingVersion: 8,
      durationSeconds: 120,
      serverNow: '2026-06-07T00:02:00.000Z',
      pickStartedAt: '2026-06-07T00:02:00.000Z',
      pickDeadlineAt: '2026-06-07T00:02:37.000Z',
      pausedRemainingSeconds: null,
    });

    expect(emittedDeltas(emit)[0]).toEqual({
      type: 'STATE_PATCH',
      revision: 8,
      ts: Date.parse('2026-06-07T00:02:00.000Z'),
      payload: {
        draft: {
          status: 'LIVE',
          pickDeadlineAt: '2026-06-07T00:02:37.000Z',
        },
        liveState: {
          revision: 8,
          clock: {
            status: 'LIVE',
            revision: 8,
            durationSeconds: 120,
            serverNow: '2026-06-07T00:02:00.000Z',
            startedAt: '2026-06-07T00:02:00.000Z',
            deadlineAt: '2026-06-07T00:02:37.000Z',
          },
        },
      },
    });
  });
});
