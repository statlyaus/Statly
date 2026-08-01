import { beforeEach, describe, expect, it, vi } from 'vitest';

const metrics = vi.hoisted(() => ({
  incCounter: vi.fn(),
  observeHistogram: vi.fn(),
}));

vi.mock('@/server/metrics', () => ({
  METRICS: { draftRealtimeV2Joins: 'draft_realtime_v2_joins_total' },
  incCounter: metrics.incCounter,
  observeHistogram: metrics.observeHistogram,
}));

import { DraftSocketV2Session } from '@/server/realtime/DraftSocketV2Session';
import { DraftReadAccessError } from '@/server/draft/services/DraftAuthorizedReadService';
import type { DraftReplayResult } from '@/server/draft/services/DraftRealtimeReplayService';
import type { DraftRoomSnapshotPayload } from '@/services/realtime/draftStateWire';
import type { DraftRealtimeJoinAck } from '@/services/realtime/draftRealtimeV2';

const draftId = 'draft-1';
const leagueId = 'league-1';
const authenticatedUserId = 'user-1';

function makeSnapshot(
  sequence = 0,
  targetDraftId = draftId,
  targetLeagueId = leagueId
): DraftRoomSnapshotPayload {
  const serverNow = '2026-08-01T10:00:00.000Z';
  return {
    schemaVersion: 1,
    draftId: targetDraftId,
    leagueId: targetLeagueId,
    revision: 4,
    throughSequence: sequence,
    serverNow,
    state: {
      name: 'Test Draft',
      status: 'LIVE',
      currentPick: 3,
      totalPicks: 24,
      round: 1,
      direction: 'FORWARD',
      clock: {
        status: 'LIVE',
        revision: 4,
        durationSeconds: 120,
        serverNow,
        startedAt: serverNow,
        deadlineAt: '2026-08-01T10:02:00.000Z',
      },
      onClockMemberId: 'member-1',
      participants: [
        {
          id: 'member-1',
          userId: authenticatedUserId,
          displayName: 'Test User',
          teamName: 'Test Team',
          draftOrder: 1,
        },
      ],
      picks: [],
    },
  };
}

function readyReplay(
  sequence = 0,
  targetDraftId = draftId,
  targetLeagueId = leagueId
): Extract<DraftReplayResult, { status: 'ready' }> {
  return {
    status: 'ready',
    schemaVersion: 2,
    draftId: targetDraftId,
    leagueId: targetLeagueId,
    afterSequence: sequence,
    throughSequence: sequence,
    nextAfterSequence: sequence,
    hasMore: false,
    events: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function makeHarness() {
  const order: string[] = [];
  const socket = {
    id: 'socket-1',
    connected: true,
    data: {} as Record<string, unknown>,
    join: vi.fn(async () => {
      order.push('join');
    }),
    leave: vi.fn(async (_room: string) => undefined),
    disconnect: vi.fn(),
  };
  const authorizedReads = {
    authorizeMember: vi.fn(async () => {
      order.push('authorize');
    }),
    buildRoomSnapshot: vi.fn(async () => {
      order.push('snapshot');
      return makeSnapshot();
    }),
  };
  const replayReads = {
    replayForMember: vi.fn(async () => {
      order.push('replay');
      return readyReplay();
    }),
  };
  const rooms = {
    initRoomIfMissing: vi.fn(async () => {
      order.push('init');
      return {
        id: draftId,
        currentPick: 3,
        timeRemaining: 120,
        lastActivity: '2026-08-01T10:00:00.000Z',
        status: 'active' as const,
        maxParticipants: 12,
        timePerPick: 120,
      };
    }),
    addParticipantIfUnderLimit: vi.fn(async () => {
      order.push('reserve');
      return { accepted: true, count: 1 };
    }),
    setParticipantData: vi.fn(async () => undefined),
    getRoom: vi.fn(async () => ({
      id: draftId,
      currentPick: 3,
      timeRemaining: 120,
      lastActivity: '2026-08-01T10:00:00.000Z',
      status: 'active' as const,
      maxParticipants: 12,
      timePerPick: 120,
    })),
    saveRoom: vi.fn(async () => undefined),
    removeParticipant: vi.fn(async () => 0),
  };
  const session = new DraftSocketV2Session({
    socket,
    authenticatedUserId,
    authorizedReads,
    replayReads,
    rooms,
    now: () => new Date('2026-08-01T10:00:00.000Z'),
  });
  return { session, socket, authorizedReads, replayReads, rooms, order };
}

describe('DraftSocketV2Session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('authorizes before reservation and subscribes before its snapshot/replay baseline', async () => {
    const harness = makeHarness();
    const acknowledgements: DraftRealtimeJoinAck[] = [];

    await harness.session.join({ draftId, generation: 1 }, (ack) => acknowledgements.push(ack));

    expect(harness.order).toEqual(['authorize', 'init', 'reserve', 'join', 'snapshot', 'replay']);
    expect(acknowledgements).toMatchObject([
      {
        ok: true,
        protocol: 2,
        draftId,
        leagueId,
        generation: 1,
        snapshot: { throughSequence: 0 },
        replay: { afterSequence: 0, throughSequence: 0, events: [] },
      },
    ]);
    expect(harness.socket.join).toHaveBeenCalledWith(`draft:${draftId}`);
    expect(harness.socket.join).not.toHaveBeenCalledWith(draftId);
    expect(metrics.incCounter).toHaveBeenCalledWith('draft_realtime_v2_joins_total', 1, {
      outcome: 'success',
    });
    expect(metrics.observeHistogram).toHaveBeenCalledWith('draft_realtime_v2_baseline_attempts', 1);
    expect(metrics.observeHistogram).toHaveBeenCalledWith('draft_realtime_v2_replay_events', 0);
  });

  it('supersedes a stale async join before it can reserve a room', async () => {
    const harness = makeHarness();
    const firstAuthorization = deferred<void>();
    harness.authorizedReads.authorizeMember
      .mockImplementationOnce(() => firstAuthorization.promise)
      .mockResolvedValueOnce(undefined);
    const firstAcks: DraftRealtimeJoinAck[] = [];
    const secondAcks: DraftRealtimeJoinAck[] = [];

    const first = harness.session.join({ draftId, generation: 1 }, (ack) => firstAcks.push(ack));
    const second = harness.session.join({ draftId, generation: 2 }, (ack) => secondAcks.push(ack));
    firstAuthorization.resolve();
    await Promise.all([first, second]);

    expect(firstAcks).toMatchObject([{ ok: false, code: 'SUPERSEDED', generation: 1 }]);
    expect(secondAcks).toMatchObject([{ ok: true, protocol: 2, generation: 2 }]);
    expect(harness.rooms.addParticipantIfUnderLimit).toHaveBeenCalledTimes(1);
    expect(harness.session.getActive()).toMatchObject({ draftId, generation: 2 });
  });

  it('never removes a shared same-draft reservation when a generation is superseded', async () => {
    const harness = makeHarness();
    await harness.session.join({ draftId, generation: 1 }, () => undefined);
    const deferredSnapshot = deferred<DraftRoomSnapshotPayload>();
    harness.authorizedReads.buildRoomSnapshot
      .mockImplementationOnce(() => deferredSnapshot.promise)
      .mockResolvedValueOnce(makeSnapshot());

    const second = harness.session.join({ draftId, generation: 2 }, () => undefined);
    await vi.waitFor(() => {
      expect(harness.authorizedReads.buildRoomSnapshot).toHaveBeenCalledTimes(2);
    });
    const third = harness.session.join({ draftId, generation: 3 }, () => undefined);
    deferredSnapshot.resolve(makeSnapshot());
    await Promise.all([second, third]);

    expect(harness.rooms.removeParticipant).not.toHaveBeenCalled();
    expect(harness.socket.leave).not.toHaveBeenCalled();
    expect(harness.session.getActive()).toMatchObject({ draftId, generation: 3 });
  });

  it('leaves the acknowledged subscription when teardown cancels a pending same-draft generation', async () => {
    const harness = makeHarness();
    await harness.session.join({ draftId, generation: 1 }, () => undefined);
    const deferredSnapshot = deferred<DraftRoomSnapshotPayload>();
    harness.authorizedReads.buildRoomSnapshot.mockImplementationOnce(
      () => deferredSnapshot.promise
    );

    const rejoining = harness.session.join({ draftId, generation: 2 }, () => undefined);
    await vi.waitFor(() => {
      expect(harness.authorizedReads.buildRoomSnapshot).toHaveBeenCalledTimes(2);
    });
    const leaving = harness.session.leave({ draftId, generation: 2 });
    deferredSnapshot.resolve(makeSnapshot());
    await Promise.all([rejoining, leaving]);

    expect(harness.session.getActive()).toBeNull();
    expect(harness.socket.leave).toHaveBeenCalledWith(`draft:${draftId}`);
    expect(harness.rooms.removeParticipant).toHaveBeenCalledWith(draftId, 'socket-1');
  });

  it('ignores a stale leave without superseding the latest requested generation', async () => {
    const harness = makeHarness();
    await harness.session.join({ draftId, generation: 1 }, () => undefined);
    const deferredSnapshot = deferred<DraftRoomSnapshotPayload>();
    harness.authorizedReads.buildRoomSnapshot.mockImplementationOnce(
      () => deferredSnapshot.promise
    );

    const rejoining = harness.session.join({ draftId, generation: 2 }, () => undefined);
    await vi.waitFor(() => {
      expect(harness.authorizedReads.buildRoomSnapshot).toHaveBeenCalledTimes(2);
    });
    await harness.session.leave({ draftId, generation: 1 });
    deferredSnapshot.resolve(makeSnapshot());
    await rejoining;

    expect(harness.session.getActive()).toMatchObject({ draftId, generation: 2 });
    expect(harness.socket.leave).not.toHaveBeenCalled();
    expect(harness.rooms.removeParticipant).not.toHaveBeenCalled();
  });

  it('retries incomplete replay windows and rolls back without partial success', async () => {
    const harness = makeHarness();
    harness.replayReads.replayForMember.mockResolvedValue({
      ...readyReplay(),
      throughSequence: 1,
      hasMore: true,
    });
    const acknowledgements: DraftRealtimeJoinAck[] = [];

    await harness.session.join({ draftId, generation: 1 }, (ack) => acknowledgements.push(ack));

    expect(harness.authorizedReads.buildRoomSnapshot).toHaveBeenCalledTimes(3);
    expect(acknowledgements).toMatchObject([
      { ok: false, code: 'SYNC_UNAVAILABLE', retryable: true },
    ]);
    expect(metrics.incCounter).toHaveBeenCalledWith('draft_realtime_v2_joins_total', 1, {
      outcome: 'sync_unavailable',
    });
    expect(metrics.observeHistogram).toHaveBeenCalledWith('draft_realtime_v2_baseline_attempts', 3);
    expect(metrics.observeHistogram).not.toHaveBeenCalledWith(
      'draft_realtime_v2_replay_events',
      expect.any(Number)
    );
    expect(harness.rooms.removeParticipant).toHaveBeenCalledWith(draftId, 'socket-1');
    expect(harness.session.getActive()).toBeNull();
  });

  it('stops at capacity before subscribing or reading a baseline', async () => {
    const harness = makeHarness();
    harness.rooms.addParticipantIfUnderLimit.mockResolvedValue({ accepted: false, count: 12 });
    const acknowledgements: DraftRealtimeJoinAck[] = [];

    await harness.session.join({ draftId, generation: 1 }, (ack) => acknowledgements.push(ack));

    expect(acknowledgements).toMatchObject([{ ok: false, code: 'ROOM_FULL' }]);
    expect(harness.socket.join).not.toHaveBeenCalled();
    expect(harness.authorizedReads.buildRoomSnapshot).not.toHaveBeenCalled();
  });

  it('invalidates pending authorization immediately on disconnect', async () => {
    const harness = makeHarness();
    const authorization = deferred<void>();
    harness.authorizedReads.authorizeMember.mockImplementationOnce(() => authorization.promise);

    const joining = harness.session.join({ draftId, generation: 1 }, () => undefined);
    const disconnecting = harness.session.disconnect();
    authorization.resolve();
    await Promise.all([joining, disconnecting]);

    expect(harness.rooms.initRoomIfMissing).not.toHaveBeenCalled();
    expect(harness.session.getActive()).toBeNull();
  });

  it('drains a superseded v2 rollback before allowing a protocol fallback to continue', async () => {
    const harness = makeHarness();
    const snapshot = deferred<DraftRoomSnapshotPayload>();
    harness.authorizedReads.buildRoomSnapshot.mockImplementationOnce(() => snapshot.promise);
    harness.rooms.removeParticipant.mockImplementationOnce(async () => {
      harness.order.push('cleanup');
      return 0;
    });

    const joining = harness.session.join({ draftId, generation: 1 }, () => undefined);
    await vi.waitFor(() => {
      expect(harness.authorizedReads.buildRoomSnapshot).toHaveBeenCalledOnce();
    });

    let fallbackReleased = false;
    const abandoning = harness.session.abandon().then(() => {
      fallbackReleased = true;
      harness.order.push('v1-reserve');
    });
    await Promise.resolve();
    expect(fallbackReleased).toBe(false);

    snapshot.resolve(makeSnapshot());
    await Promise.all([joining, abandoning]);

    expect(harness.order.indexOf('cleanup')).toBeLessThan(harness.order.indexOf('v1-reserve'));
    expect(harness.rooms.removeParticipant).toHaveBeenCalledWith(draftId, 'socket-1');
    expect(harness.session.getActive()).toBeNull();
  });

  it('records one terminal outcome when the acknowledgement callback throws', async () => {
    const harness = makeHarness();

    await expect(
      harness.session.join({ draftId, generation: 1 }, () => {
        throw new Error('socket closed');
      })
    ).resolves.toBeUndefined();

    expect(metrics.incCounter).toHaveBeenCalledTimes(1);
    expect(metrics.incCounter).toHaveBeenCalledWith('draft_realtime_v2_joins_total', 1, {
      outcome: 'success',
    });
  });

  it('removes an active same-draft subscription when membership is revoked on rejoin', async () => {
    const harness = makeHarness();
    await harness.session.join({ draftId, generation: 1 }, () => undefined);
    harness.socket.leave.mockClear();
    harness.rooms.removeParticipant.mockClear();
    harness.authorizedReads.authorizeMember.mockRejectedValueOnce(new DraftReadAccessError());
    const acknowledgements: DraftRealtimeJoinAck[] = [];

    await harness.session.join({ draftId, generation: 2 }, (ack) => acknowledgements.push(ack));

    expect(acknowledgements).toMatchObject([{ ok: false, code: 'FORBIDDEN' }]);
    expect(harness.session.getActive()).toBeNull();
    expect(harness.socket.leave).toHaveBeenCalledWith(`draft:${draftId}`);
    expect(harness.rooms.removeParticipant).toHaveBeenCalledWith(draftId, 'socket-1');
    expect(harness.socket.data).not.toHaveProperty('draftRealtimeProtocol');
  });

  it('forces disconnect instead of acknowledging an unsafe cross-draft switch', async () => {
    const harness = makeHarness();
    await harness.session.join({ draftId, generation: 1 }, () => undefined);
    harness.authorizedReads.buildRoomSnapshot.mockResolvedValueOnce(
      makeSnapshot(0, 'draft-2', 'league-2')
    );
    harness.replayReads.replayForMember.mockResolvedValueOnce(
      readyReplay(0, 'draft-2', 'league-2')
    );
    harness.socket.leave.mockImplementation(async (room: string) => {
      if (room === `draft:${draftId}`) throw new Error('adapter leave failed');
    });
    const acknowledgements: DraftRealtimeJoinAck[] = [];

    await harness.session.join({ draftId: 'draft-2', generation: 2 }, (ack) =>
      acknowledgements.push(ack)
    );

    expect(acknowledgements).toMatchObject([{ ok: false, code: 'INTERNAL_ERROR' }]);
    expect(acknowledgements).not.toMatchObject([{ ok: true }]);
    expect(harness.socket.disconnect).toHaveBeenCalledWith(true);
    expect(harness.session.getActive()).toBeNull();
    expect(harness.socket.data).not.toHaveProperty('draftId');
  });

  it('forces disconnect when a failed target join cannot roll back its room subscription', async () => {
    const harness = makeHarness();
    harness.authorizedReads.buildRoomSnapshot.mockResolvedValueOnce(
      null as unknown as DraftRoomSnapshotPayload
    );
    harness.socket.leave.mockRejectedValue(new Error('adapter leave failed'));
    const acknowledgements: DraftRealtimeJoinAck[] = [];

    await harness.session.join({ draftId, generation: 1 }, (ack) => acknowledgements.push(ack));

    expect(acknowledgements).toMatchObject([{ ok: false, code: 'NOT_FOUND' }]);
    expect(harness.socket.disconnect).toHaveBeenCalledWith(true);
    expect(harness.session.getActive()).toBeNull();
  });

  it('force-closes an active socket when an explicit leave cannot clean up safely', async () => {
    const harness = makeHarness();
    await harness.session.join({ draftId, generation: 1 }, () => undefined);
    harness.socket.leave.mockRejectedValue(new Error('adapter leave failed'));

    await expect(harness.session.leave({ draftId, generation: 1 })).resolves.toBeUndefined();

    expect(harness.socket.disconnect).toHaveBeenCalledWith(true);
    expect(harness.session.getActive()).toBeNull();
    expect(harness.socket.data).not.toHaveProperty('draftId');
  });

  it('contains cleanup rejection while processing a transport disconnect', async () => {
    const harness = makeHarness();
    await harness.session.join({ draftId, generation: 1 }, () => undefined);
    harness.rooms.removeParticipant.mockRejectedValue(new Error('room store unavailable'));

    await expect(harness.session.disconnect()).resolves.toBeUndefined();

    expect(harness.socket.disconnect).toHaveBeenCalledWith(true);
    expect(harness.session.getActive()).toBeNull();
    expect(harness.socket.data).not.toHaveProperty('draftRealtimeProtocol');
  });
});
