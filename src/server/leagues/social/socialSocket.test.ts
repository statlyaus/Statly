import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server as SocketIOServer, Socket as SocketIOSocket } from 'socket.io';

import type { SocialRealtimeEnvelope } from '@/types/social';

const mocks = vi.hoisted(() => ({
  getLeagueMembershipAccess: vi.fn(),
  loggerError: vi.fn(),
  pubSubPublish: vi.fn(),
  pubSubStart: vi.fn(),
}));

vi.mock('@/server/leagues/membership', () => ({
  getLeagueMembershipAccess: mocks.getLeagueMembershipAccess,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: mocks.loggerError,
  },
}));

vi.mock('./socialPubSub', () => ({
  socialPubSub: {
    publish: mocks.pubSubPublish,
    start: mocks.pubSubStart,
  },
}));

import {
  attachLeagueSocialSocketHandlers,
  broadcastLeagueSocialEvent,
  getLeagueSocialRoom,
  publishLeagueSocialRealtimeEvent,
  type SocialSocketAcknowledgement,
} from './socialSocket';

type EventHandler = (...args: any[]) => unknown;

function createSocket(userId: string | null = 'user-1') {
  const handlers = new Map<string, EventHandler>();
  const socket = {
    id: 'socket-1',
    data: userId ? { userId } : {},
    on: vi.fn((event: string, handler: EventHandler) => {
      handlers.set(event, handler);
      return socket;
    }),
    join: vi.fn(async () => undefined),
    leave: vi.fn(async () => undefined),
    emit: vi.fn(),
  };

  return {
    handlers,
    socket: socket as unknown as SocketIOSocket,
    join: socket.join,
    leave: socket.leave,
    emit: socket.emit,
  };
}

function attachSocket(socket: SocketIOSocket) {
  let connectionHandler: EventHandler | undefined;
  const emit = vi.fn();
  const to = vi.fn(() => ({ emit }));
  const inRoom = vi.fn(() => ({ fetchSockets: vi.fn(async () => [socket]) }));
  const io = {
    on: vi.fn((event: string, handler: EventHandler) => {
      if (event === 'connection') connectionHandler = handler;
      return io;
    }),
    to,
    in: inRoom,
  };

  attachLeagueSocialSocketHandlers(io as unknown as SocketIOServer);
  expect(connectionHandler).toBeTypeOf('function');
  connectionHandler?.(socket);

  return {
    emit,
    io: io as unknown as SocketIOServer,
    to,
    inRoom,
  };
}

async function invokeWithAcknowledgement(
  handler: EventHandler | undefined,
  request: unknown
): Promise<SocialSocketAcknowledgement> {
  if (!handler) throw new Error('Socket handler was not registered');

  return new Promise((resolve, reject) => {
    Promise.resolve(handler(request, resolve)).catch(reject);
  });
}

describe('league social socket sidecar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLeagueMembershipAccess.mockResolvedValue({
      leagueId: 'league-1',
      userId: 'user-1',
      memberId: 'member-1',
      isMember: true,
      canManage: false,
    });
    mocks.pubSubPublish.mockResolvedValue(undefined);
  });

  it('rechecks current membership on every join and joins only the league social room', async () => {
    const socketState = createSocket();
    attachSocket(socketState.socket);

    const first = await invokeWithAcknowledgement(socketState.handlers.get('social:join'), {
      leagueId: 'league-1',
    });
    const second = await invokeWithAcknowledgement(socketState.handlers.get('social:join'), {
      leagueId: 'league-1',
    });

    expect(mocks.getLeagueMembershipAccess).toHaveBeenCalledTimes(2);
    expect(mocks.getLeagueMembershipAccess).toHaveBeenNthCalledWith(1, 'league-1', 'user-1');
    expect(mocks.getLeagueMembershipAccess).toHaveBeenNthCalledWith(2, 'league-1', 'user-1');
    expect(socketState.join).toHaveBeenCalledTimes(2);
    expect(socketState.join).toHaveBeenCalledWith('social:league:league-1');
    expect(first).toEqual({
      ok: true,
      leagueId: 'league-1',
      room: 'social:league:league-1',
    });
    expect(second).toEqual(first);
  });

  it('acknowledges unauthenticated, invalid, and non-member joins without joining', async () => {
    const unauthenticated = createSocket(null);
    attachSocket(unauthenticated.socket);

    await expect(
      invokeWithAcknowledgement(unauthenticated.handlers.get('social:join'), {
        leagueId: 'league-1',
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'UNAUTHORIZED' },
    });
    expect(mocks.getLeagueMembershipAccess).not.toHaveBeenCalled();
    expect(unauthenticated.join).not.toHaveBeenCalled();

    const authenticated = createSocket();
    attachSocket(authenticated.socket);
    await expect(
      invokeWithAcknowledgement(authenticated.handlers.get('social:join'), {
        leagueId: '   ',
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });

    mocks.getLeagueMembershipAccess.mockResolvedValueOnce({
      leagueId: 'league-1',
      userId: 'user-1',
      isMember: false,
      canManage: false,
    });
    await expect(
      invokeWithAcknowledgement(authenticated.handlers.get('social:join'), {
        leagueId: 'league-1',
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(authenticated.join).not.toHaveBeenCalled();
  });

  it('leaves the scoped room and exposes no socket handlers for social writes', async () => {
    const socketState = createSocket();
    attachSocket(socketState.socket);

    const result = await invokeWithAcknowledgement(socketState.handlers.get('social:leave'), {
      leagueId: 'league-1',
    });

    expect(socketState.leave).toHaveBeenCalledWith('social:league:league-1');
    expect(result).toEqual({
      ok: true,
      leagueId: 'league-1',
      room: 'social:league:league-1',
    });
    expect(Array.from(socketState.handlers.keys()).sort()).toEqual(['social:join', 'social:leave']);
  });

  it('rate limits repeated join attempts per socket', async () => {
    const socketState = createSocket();
    attachSocket(socketState.socket);
    const joinHandler = socketState.handlers.get('social:join');

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(
        invokeWithAcknowledgement(joinHandler, { leagueId: 'league-1' })
      ).resolves.toMatchObject({ ok: true });
    }

    await expect(
      invokeWithAcknowledgement(joinHandler, { leagueId: 'league-1' })
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'RATE_LIMITED',
        retryAfterMs: expect.any(Number),
      },
    });
    expect(mocks.getLeagueMembershipAccess).toHaveBeenCalledTimes(10);
    expect(socketState.join).toHaveBeenCalledTimes(10);
  });

  it('broadcasts typed envelopes only to current members in their league social room', async () => {
    const socketState = createSocket();
    const ioState = attachSocket(socketState.socket);
    const envelope: SocialRealtimeEnvelope = {
      id: 'event-1',
      sequence: 7,
      leagueId: 'league-1',
      seasonId: 'season-2026',
      channel: 'chat',
      event: 'social:message',
      payload: { messageId: 'message-1' },
      occurredAt: '2026-07-19T10:00:00.000Z',
    };

    await broadcastLeagueSocialEvent(ioState.io, envelope);

    expect(getLeagueSocialRoom('league-1')).toBe('social:league:league-1');
    expect(ioState.inRoom).toHaveBeenCalledWith('social:league:league-1');
    expect(socketState.emit).toHaveBeenCalledWith('social:message', envelope);
  });

  it('removes former members from the room before delivering future events', async () => {
    const socketState = createSocket();
    const ioState = attachSocket(socketState.socket);
    mocks.getLeagueMembershipAccess.mockResolvedValueOnce({
      leagueId: 'league-1',
      userId: 'user-1',
      isMember: false,
      canManage: false,
    });
    const envelope: SocialRealtimeEnvelope = {
      id: 'event-2',
      sequence: 8,
      leagueId: 'league-1',
      seasonId: 'season-2026',
      channel: 'chat',
      event: 'social:message',
      payload: { messageId: 'message-2' },
      occurredAt: '2026-07-19T10:00:01.000Z',
    };

    await broadcastLeagueSocialEvent(ioState.io, envelope);

    expect(socketState.leave).toHaveBeenCalledWith('social:league:league-1');
    expect(socketState.emit).not.toHaveBeenCalled();
  });

  it('fans published events out locally and through shared pubsub', async () => {
    const socketState = createSocket();
    const ioState = attachSocket(socketState.socket);
    const envelope: SocialRealtimeEnvelope = {
      id: 'event-3',
      sequence: 9,
      leagueId: 'league-1',
      seasonId: 'season-2026',
      channel: 'board',
      event: 'social:post',
      payload: { postId: 'post-1' },
      occurredAt: '2026-07-19T10:00:02.000Z',
    };

    await publishLeagueSocialRealtimeEvent(ioState.io, envelope);

    expect(socketState.emit).toHaveBeenCalledWith('social:post', envelope);
    expect(mocks.pubSubPublish).toHaveBeenCalledWith(envelope);
  });
});
