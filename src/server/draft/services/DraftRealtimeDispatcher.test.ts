import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DraftPickEventPayload } from '../domain/draftTypes';
import { DraftRealtimeDispatcher } from './DraftRealtimeDispatcher';

const { getRedisMock, redisMock } = vi.hoisted(() => {
  const redis = {
    zAdd: vi.fn(),
    zRemRangeByRank: vi.fn(),
    expire: vi.fn(),
  };
  return {
    redisMock: redis,
    getRedisMock: vi.fn(() => Promise.resolve(redis)),
  };
});

vi.mock('@/services/realtime/pubsub', () => ({
  draftPubSub: {
    publish: vi.fn(),
    start: vi.fn(),
  },
}));

vi.mock('@/server/redis', () => ({
  getRedis: getRedisMock,
}));

function pickPayload(): DraftPickEventPayload {
  return {
    id: 'pick-1',
    overall: 1,
    round: 1,
    slot: 1,
    player: {
      id: 'player-1',
      name: 'Player One',
      position: 'MID',
      club: 'Carlton',
    },
    member: {
      id: 'member-1',
      displayName: 'Member One',
    },
    auto: false,
    madeAt: '2026-05-18T10:00:00.000Z',
    timestamp: new Date('2026-05-18T10:00:00.000Z'),
  };
}

describe('DraftRealtimeDispatcher idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    getRedisMock.mockResolvedValue(redisMock);
  });

  it('emits one primary delta per logical pick to the canonical draft room', async () => {
    const emissions: Array<{ room: string; event: string; payload: any }> = [];
    const io = {
      to: vi.fn((room: string) => ({
        emit: vi.fn((event: string, payload: unknown) => {
          emissions.push({ room, event, payload });
        }),
      })),
    };

    const dispatcher = new DraftRealtimeDispatcher();
    dispatcher.attachSocketServer(io as never);

    await dispatcher.publishDraftEvent('draft-1', 'draft:pick-made', pickPayload());

    const deltaEmissions = emissions.filter((item) => item.event === 'draft:delta');
    expect(deltaEmissions).toHaveLength(1);
    expect(deltaEmissions[0].room).toBe('draft:draft-1');
    expect(deltaEmissions.map((item) => item.payload.eventId)).toEqual([
      'draft-1:pick:1:player-1',
    ]);
  });

  it('persists primary deltas for reconnect backfill before emitting to clients', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-20T11:00:00.000Z'));
    const emissions: Array<{ room: string; event: string; payload: any }> = [];
    const io = {
      to: vi.fn((room: string) => ({
        emit: vi.fn((event: string, payload: unknown) => {
          emissions.push({ room, event, payload });
        }),
      })),
    };

    const dispatcher = new DraftRealtimeDispatcher();
    dispatcher.attachSocketServer(io as never);

    await dispatcher.publishDraftEvent('draft-1', 'draft:pick-made', pickPayload());

    const emittedDelta = emissions.find((item) => item.event === 'draft:delta')?.payload;
    expect(redisMock.zAdd).toHaveBeenCalledWith('draft:draft-1:events', {
      score: emittedDelta.ts,
      value: expect.any(String),
    });
    const persisted = JSON.parse(redisMock.zAdd.mock.calls[0][1].value);
    expect(persisted).toMatchObject({
      type: 'PICK_MADE',
      eventId: 'draft-1:pick:1:player-1',
      ts: emittedDelta.ts,
    });
    expect(redisMock.zRemRangeByRank).toHaveBeenCalledWith('draft:draft-1:events', 0, -501);
    expect(redisMock.expire).toHaveBeenCalledWith('draft:draft-1:events', 3600);
  });

  it('emits state patch deadlines when redis-delivered draft state contains ISO date strings', async () => {
    const emissions: Array<{ room: string; event: string; payload: any }> = [];
    const io = {
      to: vi.fn((room: string) => ({
        emit: vi.fn((event: string, payload: unknown) => {
          emissions.push({ room, event, payload });
        }),
      })),
    };

    const dispatcher = new DraftRealtimeDispatcher();
    dispatcher.attachSocketServer(io as never);

    await dispatcher.publishState({
      leagueId: 'league-1',
      draftId: 'draft-1',
      status: 'LIVE',
      currentPick: {
        userId: 'user-1',
        memberId: 'member-1',
        pickNumber: 2,
        round: 1,
        slot: 2,
        expiresAt: '2026-05-20T10:02:00.000Z',
        startedAt: '2026-05-20T10:00:00.000Z',
      },
      picks: [],
      participants: [],
      timerSettings: {
        durationSeconds: 120,
        autopickAfterExpiry: true,
      },
      draftSettings: {
        totalRounds: 22,
        totalTeams: 12,
        draftType: 'SNAKE',
        pickTimeLimit: 120,
      },
      paused: false,
      createdAt: '2026-05-20T09:00:00.000Z',
      updatedAt: '2026-05-20T10:00:00.000Z',
      lastActivity: '2026-05-20T10:00:00.000Z',
    } as never);

    const delta = emissions.find((item) => item.event === 'draft:delta')?.payload;

    expect(delta?.payload?.draft?.pickDeadlineAt).toBe('2026-05-20T10:02:00.000Z');
  });
});
