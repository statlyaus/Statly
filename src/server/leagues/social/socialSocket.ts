import type { Server as SocketIOServer, Socket as SocketIOSocket } from 'socket.io';

import { logger } from '@/lib/logger';
import { getLeagueMembershipAccess } from '@/server/leagues/membership';
import type { SocialRealtimeEnvelope } from '@/types/social';

import { socialPubSub } from './socialPubSub';

const SOCIAL_ROOM_PREFIX = 'social:league:';
const SOCIAL_JOIN_RATE_LIMIT_WINDOW_MS = 60_000;
const SOCIAL_JOIN_RATE_LIMIT_MAX_ATTEMPTS = 10;
const SOCIAL_LEAGUE_ID_MAX_LENGTH = 128;

type SocialRoomRequest = {
  leagueId?: unknown;
};

type SocialSocketErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'VALIDATION'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export type SocialSocketAcknowledgement =
  | {
      ok: true;
      leagueId: string;
      room: string;
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

function parseLeagueId(request: SocialRoomRequest | null | undefined): string | null {
  if (typeof request?.leagueId !== 'string') return null;

  const leagueId = request.leagueId.trim();
  if (!leagueId || leagueId.length > SOCIAL_LEAGUE_ID_MAX_LENGTH) return null;

  return leagueId;
}

export function getLeagueSocialRoom(leagueId: string): string {
  return `${SOCIAL_ROOM_PREFIX}${leagueId}`;
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
      if (!leagueId) {
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

        const room = getLeagueSocialRoom(leagueId);
        await socket.join(room);
        acknowledge(callback, { ok: true, leagueId, room });
      } catch (error) {
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

      const room = getLeagueSocialRoom(leagueId);
      try {
        await socket.leave(room);
        acknowledge(callback, { ok: true, leagueId, room });
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

export async function broadcastLeagueSocialEvent(
  io: SocketIOServer,
  envelope: SocialRealtimeEnvelope
): Promise<void> {
  const room = getLeagueSocialRoom(envelope.leagueId);
  const sockets = await io.in(room).fetchSockets();
  await Promise.all(
    sockets.map(async (socket) => {
      const userId =
        typeof socket.data.userId === 'string' && socket.data.userId.trim()
          ? socket.data.userId.trim()
          : null;
      if (!userId) {
        await socket.leave(room);
        return;
      }

      const access = await getLeagueMembershipAccess(envelope.leagueId, userId);
      if (!access.isMember) {
        await socket.leave(room);
        return;
      }
      socket.emit(envelope.event, envelope);
    })
  );
}

export async function startLeagueSocialRealtime(io: SocketIOServer): Promise<void> {
  await socialPubSub.start((envelope) => broadcastLeagueSocialEvent(io, envelope));
}

export async function publishLeagueSocialRealtimeEvent(
  io: SocketIOServer,
  envelope: SocialRealtimeEnvelope
): Promise<void> {
  await broadcastLeagueSocialEvent(io, envelope);
  await socialPubSub.publish(envelope);
}
