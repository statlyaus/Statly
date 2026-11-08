import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server as SocketIOServer, Socket as SocketIOSocket } from 'socket.io';

import type { SocialRealtimeEnvelope } from '@/types/social';

const mocks = vi.hoisted(() => ({
  ensureActiveLeagueSeason: vi.fn(),
  getLeagueMembershipAccess: vi.fn(),
  loggerError: vi.fn(),
  pubSubPublish: vi.fn(),
  pubSubStart: vi.fn(),
}));

vi.mock('@/server/leagues/membership', () => ({
  getLeagueMembershipAccess: mocks.getLeagueMembershipAccess,
}));

vi.mock('./socialAccess', () => ({
  ensureActiveLeagueSeason: mocks.ensureActiveLeagueSeason,
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

import { leagueSeasonSocialRoom } from '@/server/realtime/roomNames';

import {
  attachLeagueSocialSocketHandlers,
  broadcastLeagueSocialEvent,
  publishLeagueSocialRealtimeEvent,
  type SocialSocketAcknowledgement,
} from './socialSocket';

const SEASON_2026_ROOM = 'social:league:league-1:season:season-2026';

type EventHandler = (...args: any[]) => unknown;

function createSocket(userId: string | null = 'user-1', rooms: string[] = []) {
  const handlers = new Map<string, EventHandler>();
  const socket = {
    id: 'socket-1',
    data: userId ? { userId } : {},
    rooms: new Set<string>(rooms),
    on: vi.fn((event: string, handler: EventHandler) => {
      handlers.set(event, handler);
      return socket;
    }),
    join: vi.fn(async (room: string) => {
      socket.rooms.add(room);
    }),
    leave: vi.fn(async (room: string) => {
      socket.rooms.delete(room);
    }),
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

function localIo(sockets: SocketIOSocket[]) {
  return {
    local: { in: () => ({ fetchSockets: async () => sockets }) },
  } as unknown as SocketIOServer;
}

/** Like the Socket.IO adapter: a room holds exactly the sockets that joined it. */
function roomAwareIo(sockets: SocketIOSocket[]) {
  return {
    local: {
      in: (room: string) => ({
        fetchSockets: async () => sockets.filter((socket) => socket.rooms.has(room)),
      }),
    },
  } as unknown as SocketIOServer;
}

function attachSocket(socket: SocketIOSocket) {
  let connectionHandler: EventHandler | undefined;
  const emit = vi.fn();
  const to = vi.fn(() => ({ emit }));
  const inRoom = vi.fn(() => ({ fetchSockets: vi.fn(async () => [socket]) }));
  const globalInRoom = vi.fn();
  const io = {
    on: vi.fn((event: string, handler: EventHandler) => {
      if (event === 'connection') connectionHandler = handler;
      return io;
    }),
    to,
    in: globalInRoom,
    local: { in: inRoom },
  };

  attachLeagueSocialSocketHandlers(io as unknown as SocketIOServer);
  expect(connectionHandler).toBeTypeOf('function');
  connectionHandler?.(socket);

  return {
    emit,
    io: io as unknown as SocketIOServer,
    to,
    inRoom,
    globalInRoom,
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
    mocks.ensureActiveLeagueSeason.mockResolvedValue('season-2026');
    mocks.pubSubPublish.mockResolvedValue(undefined);
  });

  it('rechecks current membership on every join and joins only the active league season room', async () => {
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
    expect(mocks.ensureActiveLeagueSeason).toHaveBeenCalledWith('league-1');
    expect(socketState.join).toHaveBeenCalledTimes(2);
    expect(socketState.join).toHaveBeenCalledWith(SEASON_2026_ROOM);
    expect(first).toEqual({
      ok: true,
      leagueId: 'league-1',
      seasonId: 'season-2026',
      room: SEASON_2026_ROOM,
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

  it('accepts a client-named season only when it is the season the member belongs to', async () => {
    const socketState = createSocket();
    attachSocket(socketState.socket);

    await expect(
      invokeWithAcknowledgement(socketState.handlers.get('social:join'), {
        leagueId: 'league-1',
        seasonId: 'season-2025',
      })
    ).resolves.toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Membership of that league season is required' },
    });
    expect(socketState.join).not.toHaveBeenCalled();

    await expect(
      invokeWithAcknowledgement(socketState.handlers.get('social:join'), {
        leagueId: 'league-1',
        seasonId: 'bad:season',
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(socketState.join).not.toHaveBeenCalled();

    await expect(
      invokeWithAcknowledgement(socketState.handlers.get('social:join'), {
        leagueId: 'league-1',
        seasonId: 'season-2026',
      })
    ).resolves.toMatchObject({ ok: true, room: SEASON_2026_ROOM });
  });

  it('refuses a join for a league with no Prisma season instead of failing internally', async () => {
    const { SocialError } = await import('./socialErrors');
    mocks.ensureActiveLeagueSeason.mockRejectedValueOnce(
      new SocialError('NOT_FOUND', 'League not found')
    );
    const socketState = createSocket();
    attachSocket(socketState.socket);

    await expect(
      invokeWithAcknowledgement(socketState.handlers.get('social:join'), { leagueId: 'league-1' })
    ).resolves.toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(socketState.join).not.toHaveBeenCalled();
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });

  it('moves a rejoining socket out of an earlier season room of the same league', async () => {
    const otherLeagueRoom = leagueSeasonSocialRoom('league-2', 'season-x');
    const earlierSeasonRoom = leagueSeasonSocialRoom('league-1', 'season-2025');
    const socketState = createSocket('user-1', [earlierSeasonRoom, otherLeagueRoom]);
    attachSocket(socketState.socket);

    await invokeWithAcknowledgement(socketState.handlers.get('social:join'), {
      leagueId: 'league-1',
    });

    expect([...socketState.socket.rooms].sort()).toEqual(
      [otherLeagueRoom, SEASON_2026_ROOM].sort()
    );
  });

  it('leaves every season room of the league and exposes no socket handlers for social writes', async () => {
    const otherLeagueRoom = leagueSeasonSocialRoom('league-2', 'season-x');
    const earlierSeasonRoom = leagueSeasonSocialRoom('league-1', 'season-2025');
    const socketState = createSocket('user-1', [
      SEASON_2026_ROOM,
      earlierSeasonRoom,
      otherLeagueRoom,
      'draft:draft-1',
    ]);
    attachSocket(socketState.socket);

    const result = await invokeWithAcknowledgement(socketState.handlers.get('social:leave'), {
      leagueId: 'league-1',
    });

    expect(result).toEqual({
      ok: true,
      leagueId: 'league-1',
      rooms: [SEASON_2026_ROOM, earlierSeasonRoom],
    });
    expect([...socketState.socket.rooms].sort()).toEqual(['draft:draft-1', otherLeagueRoom].sort());
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

  it('broadcasts typed envelopes only to current members in their league season room', async () => {
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

    expect(ioState.inRoom).toHaveBeenCalledWith(SEASON_2026_ROOM);
    expect(ioState.globalInRoom).not.toHaveBeenCalled();
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

    expect(socketState.leave).toHaveBeenCalledWith(SEASON_2026_ROOM);
    expect(socketState.emit).not.toHaveBeenCalled();
  });

  it('never delivers a season A event to a socket in the season B room of the same league', async () => {
    const seasonA = createSocket('user-1', [leagueSeasonSocialRoom('league-1', 'season-a')]);
    const seasonB = createSocket('user-2', [leagueSeasonSocialRoom('league-1', 'season-b')]);
    const envelope: SocialRealtimeEnvelope = {
      id: 'event-a',
      sequence: 1,
      leagueId: 'league-1',
      seasonId: 'season-a',
      channel: 'activity',
      event: 'trade:update',
      payload: { threadId: 'thread-1' },
      occurredAt: '2026-07-19T10:00:00.000Z',
    };

    await broadcastLeagueSocialEvent(roomAwareIo([seasonA.socket, seasonB.socket]), envelope);

    expect(seasonA.emit).toHaveBeenCalledWith('trade:update', envelope);
    expect(seasonB.emit).not.toHaveBeenCalled();
  });

  it('keeps delivering to other sockets when one membership lookup fails', async () => {
    const failing = createSocket('user-1');
    const healthy = createSocket('user-2');
    mocks.getLeagueMembershipAccess
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({
        leagueId: 'league-1',
        userId: 'user-2',
        isMember: true,
        canManage: false,
      });
    const envelope: SocialRealtimeEnvelope = {
      id: 'event-3',
      sequence: 9,
      leagueId: 'league-1',
      seasonId: 'season-2026',
      channel: 'chat',
      event: 'social:message',
      payload: { messageId: 'message-3' },
      occurredAt: '2026-07-19T10:00:02.000Z',
    };

    await expect(
      broadcastLeagueSocialEvent(localIo([failing.socket, healthy.socket]), envelope)
    ).resolves.toBeUndefined();

    expect(healthy.emit).toHaveBeenCalledWith('social:message', envelope);
    expect(mocks.loggerError).toHaveBeenCalledWith(
      'Failed to deliver league social event to a socket',
      expect.objectContaining({ leagueId: 'league-1', error: 'db down' })
    );
  });

  it('publishes to other instances even when local delivery throws', async () => {
    const envelope: SocialRealtimeEnvelope = {
      id: 'event-4',
      sequence: 10,
      leagueId: 'league-1',
      seasonId: 'season-2026',
      channel: 'chat',
      event: 'social:message',
      payload: { messageId: 'message-4' },
      occurredAt: '2026-07-19T10:00:03.000Z',
    };
    const io = {
      local: {
        in: () => ({
          fetchSockets: async () => {
            throw new Error('adapter down');
          },
        }),
      },
    } as unknown as SocketIOServer;

    await expect(publishLeagueSocialRealtimeEvent(io, envelope)).rejects.toThrow('adapter down');

    expect(mocks.pubSubPublish).toHaveBeenCalledWith(envelope);
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
