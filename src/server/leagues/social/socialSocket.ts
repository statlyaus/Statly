import type { Server as SocketIOServer, Socket as SocketIOSocket } from 'socket.io';

import { logger } from '@/lib/logger';
import { getLeagueMembershipAccess } from '@/server/leagues/membership';
import { isLeagueSocialRoom, leagueSeasonSocialRoom } from '@/server/realtime/roomNames';
import type { SocialRealtimeEnvelope } from '@/types/social';

import { ensureActiveLeagueSeason } from './socialAccess';
import { SocialError } from './socialErrors';
import { socialPubSub } from './socialPubSub';

const SOCIAL_JOIN_RATE_LIMIT_WINDOW_MS = 60_000;
const SOCIAL_JOIN_RATE_LIMIT_MAX_ATTEMPTS = 10;
const SOCIAL_LEAGUE_ID_MAX_LENGTH = 128;

type SocialRoomRequest = {
  leagueId?: unknown;
  /** Optional: the season the client is showing. It is checked, never trusted. */
  seasonId?: unknown;
};

type SocialSocketErrorCode =
  'UNAUTHORIZED' | 'FORBIDDEN' | 'VALIDATION' | 'RATE_LIMITED' | 'INTERNAL';

export type SocialSocketAcknowledgement =
  | {
      ok: true;
      leagueId: string;
      seasonId: string;
      room: string;
    }
  | {
      ok: true;
      leagueId: string;
      /** Every social room of the league the socket left, one per season. */
      rooms: string[];
    }
  | {
      ok: false;
      error: {
        code: SocialSocketErrorCode;
        message: string;
        retryAfterMs?: number;
      };
    };

type SocialSocketAcknowledge = (result: SocialSocketAcknowledgement) => void;

function acknowledge(
  callback: SocialSocketAcknowledge | undefined,
  result: SocialSocketAcknowledgement
): void {
  callback?.(result);
}

function parseRoomId(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const id = value.trim();
  if (!id || id.length > SOCIAL_LEAGUE_ID_MAX_LENGTH || id.includes(':')) return null;

  return id;
}

function parseLeagueId(request: SocialRoomRequest | null | undefined): string | null {
  return parseRoomId(request?.leagueId);
}

/** `undefined` when the client named no season, `null` when it named an invalid one. */
function parseRequestedSeasonId(
  request: SocialRoomRequest | null | undefined
): string | null | undefined {
  if (request?.seasonId === undefined || request.seasonId === null) return undefined;
  return parseRoomId(request.seasonId);
}

async function leaveLeagueSocialRooms(
  socket: Pick<SocketIOSocket, 'rooms' | 'leave'>,
  leagueId: string,
  keep?: string
): Promise<string[]> {
  const left = [...socket.rooms].filter(
    (room) => room !== keep && isLeagueSocialRoom(room, leagueId)
  );
  await Promise.all(left.map((room) => socket.leave(room)));
  return left;
}

function getAuthenticatedSocketUserId(socket: SocketIOSocket): string | null {
  const userId = socket.data.userId;
  return typeof userId === 'string' && userId.trim() ? userId.trim() : null;
}

function consumeJoinAttempt(attempts: number[], now = Date.now()): number | null {
  const windowStart = now - SOCIAL_JOIN_RATE_LIMIT_WINDOW_MS;

  while (attempts.length > 0 && attempts[0] <= windowStart) {
    attempts.shift();
  }

  if (attempts.length >= SOCIAL_JOIN_RATE_LIMIT_MAX_ATTEMPTS) {
    return Math.max(1, SOCIAL_JOIN_RATE_LIMIT_WINDOW_MS - (now - (attempts[0] ?? now)));
  }

  attempts.push(now);
  return null;
}

function invalidRequestAcknowledgement(): SocialSocketAcknowledgement {
  return {
    ok: false,
    error: {
      code: 'VALIDATION',
      message: 'A valid league ID is required',
    },
  };
}

function unauthorizedAcknowledgement(): SocialSocketAcknowledgement {
  return {
    ok: false,
    error: {
      code: 'UNAUTHORIZED',
      message: 'Authentication is required',
    },
  };
}

function attachSocketHandlers(socket: SocketIOSocket): void {
  const joinAttempts: number[] = [];

  socket.on(
    'social:join',
    async (request: SocialRoomRequest | null | undefined, callback?: SocialSocketAcknowledge) => {
      const retryAfterMs = consumeJoinAttempt(joinAttempts);
      if (retryAfterMs !== null) {
        acknowledge(callback, {
          ok: false,
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many social room join attempts',
            retryAfterMs,
          },
        });
        return;
      }

      const userId = getAuthenticatedSocketUserId(socket);
      if (!userId) {
        acknowledge(callback, unauthorizedAcknowledgement());
        return;
      }

      const leagueId = parseLeagueId(request);
      const requestedSeasonId = parseRequestedSeasonId(request);
      if (!leagueId || requestedSeasonId === null) {
        acknowledge(callback, invalidRequestAcknowledgement());
        return;
      }

      try {
        const access = await getLeagueMembershipAccess(leagueId, userId);
        if (!access.isMember) {
          acknowledge(callback, {
            ok: false,
            error: {
              code: 'FORBIDDEN',
              message: 'Current league membership is required',
            },
          });
          return;
        }

        // League membership admits a member to the league's active season, the season every
        // social and trade read serves; a client-named season is checked against it, never trusted.
        const seasonId = await ensureActiveLeagueSeason(leagueId);
        if (requestedSeasonId !== undefined && requestedSeasonId !== seasonId) {
          acknowledge(callback, {
            ok: false,
            error: {
              code: 'FORBIDDEN',
              message: 'Membership of that league season is required',
            },
          });
          return;
        }

        const room = leagueSeasonSocialRoom(leagueId, seasonId);
        // A rejoin after the active season changed moves the socket rather than adding a room.
        await leaveLeagueSocialRooms(socket, leagueId, room);
        await socket.join(room);
        acknowledge(callback, { ok: true, leagueId, seasonId, room });
      } catch (error) {
        if (error instanceof SocialError && error.code === 'NOT_FOUND') {
          acknowledge(callback, {
            ok: false,
            error: { code: 'FORBIDDEN', message: 'Current league membership is required' },
          });
          return;
        }

        logger.error('Failed to authorize league social socket join', {
          socketId: socket.id,
          leagueId,
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
        acknowledge(callback, {
          ok: false,
          error: {
            code: 'INTERNAL',
            message: 'League social realtime is temporarily unavailable',
          },
        });
      }
    }
  );

  socket.on(
    'social:leave',
    async (request: SocialRoomRequest | null | undefined, callback?: SocialSocketAcknowledge) => {
      if (!getAuthenticatedSocketUserId(socket)) {
        acknowledge(callback, unauthorizedAcknowledgement());
        return;
      }

      const leagueId = parseLeagueId(request);
      if (!leagueId) {
        acknowledge(callback, invalidRequestAcknowledgement());
        return;
      }

      try {
        const rooms = await leaveLeagueSocialRooms(socket, leagueId);
        acknowledge(callback, { ok: true, leagueId, rooms });
      } catch (error) {
        logger.error('Failed to leave league social socket room', {
          socketId: socket.id,
          leagueId,
          error: error instanceof Error ? error.message : String(error),
        });
        acknowledge(callback, {
          ok: false,
          error: {
            code: 'INTERNAL',
            message: 'League social realtime is temporarily unavailable',
          },
        });
      }
    }
  );
}

export function attachLeagueSocialSocketHandlers(io: SocketIOServer): void {
  io.on('connection', attachSocketHandlers);
}

/** The member a read receipt belongs to; null when the payload does not name one. */
function readStateUserId(envelope: SocialRealtimeEnvelope): string | null {
  const payload = envelope.payload as { userId?: unknown } | null | undefined;
  return typeof payload?.userId === 'string' && payload.userId ? payload.userId : null;
}

export async function broadcastLeagueSocialEvent(
  io: SocketIOServer,
  envelope: SocialRealtimeEnvelope
): Promise<void> {
  // Season-scoped: a socket in another season's room of the same league never sees this event.
  const room = leagueSeasonSocialRoom(envelope.leagueId, envelope.seasonId);
  const sockets = await io.local.in(room).fetchSockets();
  // A read receipt belongs to one member: it goes to that member's own sockets (their other tabs
  // and devices), never to the rest of the league.
  const onlyUserId = envelope.event === 'social:read-state' ? readStateUserId(envelope) : undefined;
  if (onlyUserId === null) return;
  // One membership lookup per member per event, however many tabs they have open.
  const membership = new Map<string, Promise<boolean>>();
  const isCurrentMember = (userId: string): Promise<boolean> => {
    let lookup = membership.get(userId);
    if (!lookup) {
      lookup = getLeagueMembershipAccess(envelope.leagueId, userId).then(
        (access) => access.isMember
      );
      membership.set(userId, lookup);
    }
    return lookup;
  };
  // One socket's failed membership lookup must not stop delivery to the others.
  const results = await Promise.allSettled(
    sockets.map(async (socket) => {
      const userId =
        typeof socket.data.userId === 'string' && socket.data.userId.trim()
          ? socket.data.userId.trim()
          : null;
      if (!userId) {
        await socket.leave(room);
        return;
      }
      if (onlyUserId !== undefined && userId !== onlyUserId) return;

      if (!(await isCurrentMember(userId))) {
        await socket.leave(room);
        return;
      }
      socket.emit(envelope.event, envelope);
    })
  );
  for (const result of results) {
    if (result.status === 'rejected') {
      logger.error('Failed to deliver league social event to a socket', {
        leagueId: envelope.leagueId,
        seasonId: envelope.seasonId,
        event: envelope.event,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  }
}

export async function startLeagueSocialRealtime(io: SocketIOServer): Promise<void> {
  await socialPubSub.start((envelope) => broadcastLeagueSocialEvent(io, envelope));
}

export async function publishLeagueSocialRealtimeEvent(
  io: SocketIOServer,
  envelope: SocialRealtimeEnvelope
): Promise<void> {
  try {
    await broadcastLeagueSocialEvent(io, envelope);
  } finally {
    // Other instances must still receive the event when local delivery fails.
    await socialPubSub.publish(envelope);
  }
}
