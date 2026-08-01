/**
 * Enhanced Socket.IO Server
 * Production-ready Socket.IO server with proper error handling, logging, and configuration
 */

import 'dotenv/config';

import { createServer, type IncomingMessage } from 'http';

import express from 'express';
import { Server, type Socket as SocketIOSocket } from 'socket.io';

import { isServerDevelopmentAuthEnabled } from '@/lib/devAuth';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { redisClient } from '@/lib/redis';
import { validateAuthToken } from '@/lib/serverAuth';
import { socketIOConfig, validateSocketIOConfig } from '@/lib/socketioConfig';
import {
  METRICS,
  incCounter,
  renderPrometheus,
  registerHistogram,
  observeHistogram,
  renderHistograms,
} from '@/server/metrics';
import {
  DraftReadAccessError,
  draftAuthorizedReadService,
} from '@/server/draft/services/DraftAuthorizedReadService';
import {
  toDraftBackfillDelta,
  type DraftRealtimeDelta,
} from '@/server/draft/services/DraftRealtimeDelta';
import { draftRealtimeDispatcher } from '@/server/draft/services/DraftRealtimeDispatcher';
import { draftRealtimePublisher } from '@/server/draft/services/DraftRealtimePublisher';
import {
  DraftRealtimeJoinRequestSchema,
  DraftRealtimeJoinV2RequestSchema,
  DraftRealtimeLeaveV2RequestSchema,
  selectDraftRealtimeProtocol,
  type DraftRealtimeJoinAck,
} from '@/services/realtime/draftRealtimeV2';
import { flushSocialOutboxBatch } from '@/server/leagues/social/socialPublisher';
import {
  attachLeagueSocialSocketHandlers,
  startLeagueSocialRealtime,
} from '@/server/leagues/social/socialSocket';
import { draftRoomStore } from '@/server/roomStore';
import { DraftSocketV2Session } from '@/server/realtime/DraftSocketV2Session';
import {
  installSocketRedisAdapter,
  type SocketRedisAdapterLifecycle,
} from '@/server/socketRedisAdapter';
import { getRedisConnection, ScalableRedisConnection } from '@/server/realtime/scalableConnection';

// Validate configuration before starting
try {
  validateSocketIOConfig(socketIOConfig);
} catch (error) {
  console.error('❌ Socket.IO configuration validation failed:', error);
  process.exit(1);
}

const socketRateLimitFallback = new Map<string, number[]>();
let draftOutboxDrainInFlight = false;
let socketRedisAdapterLifecycle: SocketRedisAdapterLifecycle | null = null;

type SocketRequestDecision = {
  error: string | null;
  allowed: boolean;
};

async function evaluateSocketRequest(req: IncomingMessage): Promise<SocketRequestDecision> {
  const start = Date.now();
  const ip =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    'unknown';
  const windowSec = Number(process.env.SOCKET_RATE_LIMIT_WINDOW_SEC || 60);
  const subBucketSec = Number(process.env.SOCKET_RATE_LIMIT_SUB_BUCKET_SEC || 10);
  const maxReq = Number(process.env.SOCKET_RATE_LIMIT_MAX || 100);
  const nowMs = Date.now();
  const currentBucket = Math.floor(nowMs / (subBucketSec * 1000));
  const bucketsToCount = Math.ceil(windowSec / subBucketSec);

  try {
    const client = redisClient.getClient();
    if (!client) throw new Error('Redis not initialized');

    const curKey = `ratelimit:socketio:${ip}:${currentBucket}`;
    const inc = await client.incr(curKey);
    if (inc === 1) {
      await client.expire(curKey, windowSec);
    }

    const keys: string[] = [];
    for (let i = 0; i < bucketsToCount; i++) {
      keys.push(`ratelimit:socketio:${ip}:${currentBucket - i}`);
    }
    const vals = await client.mget(keys);
    const total = (vals || []).reduce((sum, value) => sum + (value ? parseInt(value, 10) : 0), 0);
    if (total > maxReq) {
      incCounter(METRICS.rateLimitRejections);
      observeHistogram('socketio_allow_request_duration_seconds', (Date.now() - start) / 1000, {
        outcome: 'ratelimited',
      });
      return { error: 'Rate limit exceeded', allowed: false };
    }
  } catch (error) {
    logger.warn('Redis rate limiting failed, using in-memory fallback', {
      error: error instanceof Error ? error.message : String(error),
    });

    const now = Date.now();
    const windowMs = windowSec * 1000;
    const recent = (socketRateLimitFallback.get(ip) || []).filter((time) => now - time < windowMs);
    recent.push(now);
    socketRateLimitFallback.set(ip, recent);
    if (recent.length > maxReq) {
      incCounter(METRICS.rateLimitRejections);
      observeHistogram('socketio_allow_request_duration_seconds', (Date.now() - start) / 1000, {
        outcome: 'ratelimited',
      });
      return { error: 'Rate limit exceeded', allowed: false };
    }
  }

  observeHistogram('socketio_allow_request_duration_seconds', (Date.now() - start) / 1000, {
    outcome: 'ok',
  });
  return { error: null, allowed: true };
}

async function flushDraftOutboxBatch(): Promise<void> {
  if (draftOutboxDrainInFlight) {
    return;
  }

  draftOutboxDrainInFlight = true;
  try {
    const flushedCount = await draftRealtimePublisher.flushPendingDraftEventsBatch(
      Number(process.env.DRAFT_OUTBOX_DRAIN_BATCH_SIZE || 50)
    );
    if (flushedCount > 0) {
      logger.info('Flushed pending draft outbox events', { flushedCount });
    }
  } catch (error) {
    logger.warn('Failed to flush pending draft outbox events', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    draftOutboxDrainInFlight = false;
  }
}

type SocketMiddlewareNext = (err?: Error) => void;
type DraftRealtimeJoinAckCallback = (response: DraftRealtimeJoinAck) => void;

async function getDeltasSince(draftId: string, since: number): Promise<DraftRealtimeDelta[]> {
  const deltas: DraftRealtimeDelta[] = [];
  const boundary = new Date(Number.isFinite(since) ? since : 0);
  const pageSize = 100;
  let cursorId: string | undefined;

  while (true) {
    const events = await prisma.draftEvent.findMany({
      where: { draftId, createdAt: { gte: boundary } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: pageSize,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });

    for (const event of events) {
      const delta = toDraftBackfillDelta(event);
      if (delta) deltas.push(delta);
    }

    if (events.length < pageSize) break;
    cursorId = events.at(-1)?.id;
    if (!cursorId) break;
  }

  return deltas;
}

// Express app to serve health and potential aux endpoints
const app = express();
app.get('/health', async (_req, res) => {
  try {
    const draftRoomCount = await draftRoomStore.getRoomsCount();
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      // io initialized below; safe to reference after server start too
      activeConnections: (io as any)?.engine?.clientsCount ?? 0,
      draftRooms: draftRoomCount,
      memory: process.memoryUsage(),
    });
  } catch (error) {
    logger.error('Socket.IO health room-store check failed', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      activeConnections: (io as any)?.engine?.clientsCount ?? 0,
      draftRooms: null,
      memory: process.memoryUsage(),
    });
  }
});

// Prometheus metrics endpoint
app.get('/metrics', async (_req, res) => {
  try {
    const activeConnections = (io as any)?.engine?.clientsCount ?? 0;
    const roomsCount = await draftRoomStore.getRoomsCount();
    const body =
      renderPrometheus([
        {
          name: 'socketio_active_connections',
          help: 'Active Socket.IO connections',
          type: 'gauge',
          value: activeConnections,
        },
        {
          name: 'socketio_rooms_active',
          help: 'Active draft rooms',
          type: 'gauge',
          value: roomsCount,
        },
      ]) + renderHistograms();
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(body);
  } catch (e) {
    res.status(500).send(`# ERROR metrics: ${(e as Error).message}`);
  }
});

// Create HTTP server from Express app
const httpServer = createServer(app);

// Register histograms
registerHistogram(
  'socketio_allow_request_duration_seconds',
  [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]
);
registerHistogram('socketio_join_duration_seconds', [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]);
registerHistogram(
  'socketio_pick_duration_seconds',
  [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]
);

// Create Socket.IO server with enhanced configuration
const io = new Server(httpServer, {
  cors: socketIOConfig.server.cors,
  transports: socketIOConfig.server.transports,
  allowEIO3: socketIOConfig.server.allowEIO3,
  pingTimeout: socketIOConfig.server.pingTimeout,
  pingInterval: socketIOConfig.server.pingInterval,
  upgradeTimeout: socketIOConfig.server.upgradeTimeout,
  maxHttpBufferSize: socketIOConfig.server.maxHttpBufferSize,
  // Additional production settings
  allowRequest: (req, callback) => {
    const start = Date.now();
    void evaluateSocketRequest(req)
      .then(({ error, allowed }) => callback(error, allowed))
      .catch((error) => {
        logger.error('Socket.IO request evaluation failed', error);
        incCounter(METRICS.authFailures);
        observeHistogram('socketio_allow_request_duration_seconds', (Date.now() - start) / 1000, {
          outcome: 'error',
        });
        callback('Authentication error', false);
      });
  },
});

async function configureSocketRedisAdapter(): Promise<void> {
  try {
    const redis = getRedisConnection();
    socketRedisAdapterLifecycle = await installSocketRedisAdapter(io, redis);
    logger.info('Socket.IO Redis adapter ready');
  } catch (error) {
    if (process.env.NODE_ENV === 'production') {
      throw error;
    }

    logger.warn('Socket.IO is using the in-memory adapter outside production', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function authenticateSocketConnection(
  socket: SocketIOSocket,
  next: SocketMiddlewareNext
): Promise<void> {
  const startTime = Date.now();

  // Log connection attempt
  logger.info('Socket.IO connection attempt', {
    socketId: socket.id,
    userAgent: socket.handshake.headers['user-agent'],
    ip: socket.handshake.address,
    timestamp: new Date().toISOString(),
  });

  // Add timing to socket for performance monitoring
  socket.data.connectionStartTime = startTime;

  try {
    const token =
      typeof socket.handshake.auth.token === 'string' ? socket.handshake.auth.token.trim() : '';

    if (!token) {
      incCounter(METRICS.authFailures);
      return next(new Error('Authentication required'));
    }

    if (token.startsWith('dev:')) {
      if (!isServerDevelopmentAuthEnabled()) {
        incCounter(METRICS.authFailures);
        return next(new Error('Authentication required'));
      }

      const devUserId = token.slice(4).trim();
      if (!devUserId) {
        incCounter(METRICS.authFailures);
        return next(new Error('Authentication required'));
      }

      socket.data.userId = devUserId;
      return next();
    }

    const uid = await validateAuthToken(token);
    if (!uid) {
      incCounter(METRICS.authFailures);
      return next(new Error('Authentication required'));
    }

    socket.data.userId = uid;
    return next();
  } catch (error) {
    incCounter(METRICS.authFailures);
    logger.warn('Socket.IO authentication failed', {
      socketId: socket.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return next(new Error('Authentication required'));
  }
}

// Middleware for authentication and logging
io.use((socket, next) => {
  authenticateSocketConnection(socket, next).catch((error) => {
    incCounter(METRICS.authFailures);
    logger.error('Unexpected Socket.IO authentication middleware failure', error, {
      socketId: socket.id,
    });
    next(new Error('Authentication system error'));
  });
});

attachLeagueSocialSocketHandlers(io);

draftRealtimeDispatcher.attachSocketServer(io);

const draftOutboxDrainIntervalMs = Number(process.env.DRAFT_OUTBOX_DRAIN_INTERVAL_MS || 5000);
const ensureDraftRealtimeSubscription = async (): Promise<void> => {
  try {
    await draftRealtimeDispatcher.startSubscription();
  } catch (error) {
    logger.error('❌ Failed to start draft realtime dispatcher', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
const drainDraftOutbox = async (): Promise<void> => {
  try {
    await flushDraftOutboxBatch();
  } catch (error) {
    logger.error('Failed to drain draft realtime outbox', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
void ensureDraftRealtimeSubscription();
setInterval(() => void ensureDraftRealtimeSubscription(), draftOutboxDrainIntervalMs);
void drainDraftOutbox();
setInterval(() => void drainDraftOutbox(), draftOutboxDrainIntervalMs);

const socialRealtimeReady = startLeagueSocialRealtime(io);
const drainSocialOutbox = async (): Promise<void> => {
  try {
    await socialRealtimeReady;
    await flushSocialOutboxBatch(io);
  } catch (error) {
    logger.error('Failed to drain league social outbox', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
void drainSocialOutbox();
setInterval(
  () => {
    void drainSocialOutbox();
  },
  Number(process.env.SOCIAL_OUTBOX_DRAIN_INTERVAL_MS || 1_000)
);

// Handle draft connections with enhanced error handling
io.on('connection', (socket) => {
  const draftSocketV2Session = new DraftSocketV2Session({
    socket,
    authenticatedUserId: String(socket.data.userId),
  });

  incCounter(METRICS.connections);
  logger.info('✅ User connected', {
    socketId: socket.id,
    timestamp: new Date().toISOString(),
    activeConnections: io.engine.clientsCount,
  });

  // Test handler for debugging
  socket.on('test', (data) => {
    logger.debug('📨 Test message received', { socketId: socket.id, data });
    socket.emit('test-response', {
      message: 'Hello from enhanced Socket.IO server!',
      timestamp: new Date().toISOString(),
      serverVersion: process.env.npm_package_version || '1.0.0',
    });
  });

  const removeDraftSubscription = async (draftId: string): Promise<number> => {
    const results = await Promise.allSettled([
      socket.leave(draftId),
      socket.leave(`draft:${draftId}`),
      draftRoomStore.removeParticipant(draftId, socket.id),
    ]);

    if (socket.data.draftId === draftId) {
      delete socket.data.draftId;
      delete socket.data.joinedAt;
      delete socket.data.draftRealtimeProtocol;
    }

    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') {
      throw failure.reason;
    }

    const participantResult = results[2];
    return participantResult?.status === 'fulfilled' ? participantResult.value : 0;
  };

  // Join draft room with enhanced validation
  const joinDraftRoom = async (data: unknown, acknowledge?: DraftRealtimeJoinAckCallback) => {
    const request = DraftRealtimeJoinRequestSchema.safeParse(data);
    const requestDraftId =
      typeof data === 'object' && data !== null && 'draftId' in data
        ? String(data.draftId ?? '')
        : '';
    const startJoin = Date.now();
    let acceptedDraftId: string | null = null;
    let acknowledged = false;

    const reply = (response: DraftRealtimeJoinAck): void => {
      if (acknowledged) return;
      acknowledged = true;
      acknowledge?.(response);
    };

    if (!request.success) {
      reply({
        ok: false,
        draftId: requestDraftId,
        code: 'INVALID_REQUEST',
        message: 'Invalid draft join request',
        retryable: false,
      });
      socket.emit('draft:error', {
        error: 'Invalid draftId',
        code: 'INVALID_REQUEST',
        timestamp: new Date().toISOString(),
      });
      observeHistogram('socketio_join_duration_seconds', (Date.now() - startJoin) / 1000, {
        outcome: 'invalid_request',
      });
      return;
    }

    const { draftId, realtimeProtocols } = request.data;
    const selectedProtocol = selectDraftRealtimeProtocol(realtimeProtocols, [2, 1]);
    if (selectedProtocol === null) {
      reply({
        ok: false,
        draftId,
        code: 'UNSUPPORTED_PROTOCOL',
        message: 'No mutually supported draft realtime protocol',
        retryable: false,
      });
      socket.emit('draft:error', {
        error: 'Unsupported draft realtime protocol',
        code: 'UNSUPPORTED_PROTOCOL',
        timestamp: new Date().toISOString(),
      });
      observeHistogram('socketio_join_duration_seconds', (Date.now() - startJoin) / 1000, {
        outcome: 'unsupported_protocol',
      });
      return;
    }

    try {
      const authenticatedUserId =
        typeof socket.data.userId === 'string' ? socket.data.userId : undefined;
      if (!authenticatedUserId) {
        reply({
          ok: false,
          draftId,
          code: 'UNAUTHENTICATED',
          message: 'Authentication required',
          retryable: false,
        });
        socket.emit('draft:error', {
          error: 'Authentication required',
          code: 'UNAUTHENTICATED',
          timestamp: new Date().toISOString(),
        });
        observeHistogram('socketio_join_duration_seconds', (Date.now() - startJoin) / 1000, {
          outcome: 'unauthenticated',
        });
        return;
      }

      if (selectedProtocol === 2) {
        const v2Request = DraftRealtimeJoinV2RequestSchema.safeParse({
          draftId,
          generation: request.data.generation,
        });
        if (!v2Request.success) {
          reply({
            ok: false,
            draftId,
            code: 'INVALID_REQUEST',
            message: 'A positive generation is required for draft realtime v2',
            retryable: false,
          });
          return;
        }
        await draftSocketV2Session.join(v2Request.data, reply);
        return;
      }

      // Complete any pending v2 rollback before the v1 fallback reserves the same socket.
      // Otherwise a superseded v2 join can remove the participant established below.
      await draftSocketV2Session.abandon();

      logger.info('👤 User joining draft', {
        socketId: socket.id,
        draftId,
        userId: authenticatedUserId,
        timestamp: new Date().toISOString(),
      });

      // Authorize against durable league membership before creating or mutating any room state.
      const authorizationSnapshot = await draftAuthorizedReadService.buildRoomSnapshot(
        draftId,
        authenticatedUserId
      );
      if (!authorizationSnapshot) {
        reply({
          ok: false,
          draftId,
          code: 'FORBIDDEN',
          message: 'You do not have access to this draft',
          retryable: false,
        });
        socket.emit('draft:error', {
          error: 'You do not have access to this draft',
          code: 'FORBIDDEN',
          timestamp: new Date().toISOString(),
        });
        observeHistogram('socketio_join_duration_seconds', (Date.now() - startJoin) / 1000, {
          outcome: 'forbidden',
        });
        return;
      }

      // Initialize or update draft room in Redis-backed store
      const state = await draftRoomStore.initRoomIfMissing(draftId);
      const participantResult = await draftRoomStore.addParticipantIfUnderLimit(
        draftId,
        socket.id,
        state.maxParticipants
      );

      if (!participantResult.accepted) {
        reply({
          ok: false,
          draftId,
          code: 'ROOM_FULL',
          message: 'Draft room is full',
          retryable: true,
        });
        socket.emit('draft:error', {
          error: 'Draft room is full',
          code: 'ROOM_FULL',
          timestamp: new Date().toISOString(),
        });
        observeHistogram('socketio_join_duration_seconds', (Date.now() - startJoin) / 1000, {
          outcome: 'room_full',
        });
        return;
      }

      acceptedDraftId = draftId;
      const participantCount = participantResult.count;
      incCounter(METRICS.joins);

      const previousDraftId =
        typeof socket.data.draftId === 'string' ? socket.data.draftId : undefined;
      if (previousDraftId && previousDraftId !== draftId) {
        const previousParticipantCount = await removeDraftSubscription(previousDraftId);
        socket.to(previousDraftId).emit('participant:leave', {
          socketId: socket.id,
          timestamp: new Date().toISOString(),
          participantCount: previousParticipantCount,
        });
      }

      // Join the room
      await socket.join(draftId);
      await socket.join(`draft:${draftId}`);

      // Read the canonical baseline after subscription. A transition racing this read is either in
      // the snapshot or delivered live; client revision guards prevent an older snapshot rollback.
      const snapshot = await draftAuthorizedReadService.buildRoomSnapshot(
        draftId,
        authenticatedUserId
      );
      if (!snapshot) {
        await removeDraftSubscription(draftId);
        acceptedDraftId = null;
        reply({
          ok: false,
          draftId,
          code: 'FORBIDDEN',
          message: 'You do not have access to this draft',
          retryable: false,
        });
        socket.emit('draft:error', {
          error: 'You do not have access to this draft',
          code: 'FORBIDDEN',
          timestamp: new Date().toISOString(),
        });
        observeHistogram('socketio_join_duration_seconds', (Date.now() - startJoin) / 1000, {
          outcome: 'forbidden',
        });
        return;
      }

      // Store user info in socket data
      socket.data.draftId = draftId;
      socket.data.joinedAt = new Date();
      socket.data.draftRealtimeProtocol = selectedProtocol;

      const authorizedParticipant = snapshot.state.participants.find(
        (participant) => participant.userId === authenticatedUserId
      );

      // Store only server-resolved participant metadata; join payload identity is untrusted.
      await draftRoomStore.setParticipantData(draftId, socket.id, {
        userId: authenticatedUserId,
        memberId: authorizedParticipant?.id,
        displayName: authorizedParticipant?.displayName,
        socketId: socket.id,
        joinedAt: new Date().toISOString(),
      });
      const room = await draftRoomStore.getRoom(draftId);
      if (!room) throw new Error('Room state unavailable');
      await draftRoomStore.saveRoom({ ...room, lastActivity: new Date().toISOString() });

      // Establish a complete revisioned baseline before replaying anything that raced the read.
      socket.emit('draft:snapshot', snapshot);
      const deltas = await getDeltasSince(draftId, Date.parse(snapshot.serverNow));
      socket.emit('draft:backfill', deltas);

      // Notify other participants that someone joined
      socket.to(draftId).emit('participant:join', {
        socketId: socket.id,
        userId: authenticatedUserId,
        timestamp: new Date().toISOString(),
        participantCount,
      });

      logger.info('📡 Draft update sent and participants notified', {
        draftId,
        socketId: socket.id,
        participantCount,
      });
      observeHistogram('socketio_join_duration_seconds', (Date.now() - startJoin) / 1000, {
        outcome: 'ok',
      });
      reply({ ok: true, draftId, protocol: 1 });
    } catch (error) {
      if (acceptedDraftId) {
        try {
          await removeDraftSubscription(acceptedDraftId);
        } catch (cleanupError) {
          logger.warn('Failed to clean up participant after draft join error', {
            socketId: socket.id,
            draftId: acceptedDraftId,
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          });
        }
      }

      if (error instanceof DraftReadAccessError) {
        observeHistogram('socketio_join_duration_seconds', (Date.now() - startJoin) / 1000, {
          outcome: 'forbidden',
        });
        reply({
          ok: false,
          draftId,
          code: 'FORBIDDEN',
          message: 'You do not have access to this draft',
          retryable: false,
        });
        socket.emit('draft:error', {
          error: 'You do not have access to this draft',
          code: 'FORBIDDEN',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      logger.error('❌ Error joining draft', {
        socketId: socket.id,
        draftId,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
      observeHistogram('socketio_join_duration_seconds', (Date.now() - startJoin) / 1000, {
        outcome: 'error',
      });
      reply({
        ok: false,
        draftId,
        code: 'INTERNAL_ERROR',
        message: 'Failed to join draft',
        retryable: true,
      });
      socket.emit('draft:error', {
        error: 'Failed to join draft',
        details: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }
  };

  socket.on('join:draft', joinDraftRoom);
  socket.on('draft:join', joinDraftRoom);
  socket.on('draft:join:v2', async (data: unknown, acknowledge?: DraftRealtimeJoinAckCallback) => {
    const request = DraftRealtimeJoinV2RequestSchema.safeParse(data);
    if (!request.success) {
      acknowledge?.({
        ok: false,
        draftId:
          typeof data === 'object' && data !== null && 'draftId' in data
            ? String(data.draftId ?? '')
            : '',
        code: 'INVALID_REQUEST',
        message: 'Invalid draft realtime v2 join request',
        retryable: false,
      });
      return;
    }

    try {
      await draftSocketV2Session.join(request.data, acknowledge ?? (() => undefined));
    } catch (error) {
      logger.error('Unhandled draft v2 join failure', {
        socketId: socket.id,
        draftId: request.data.draftId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  socket.on('draft:leave:v2', async (data: unknown) => {
    const request = DraftRealtimeLeaveV2RequestSchema.safeParse(data);
    if (!request.success) return;
    try {
      await draftSocketV2Session.leave(request.data);
    } catch (error) {
      logger.error('Unhandled draft v2 leave failure', {
        socketId: socket.id,
        draftId: request.data.draftId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  socket.on('draft:backfill', async ({ draftId, since }) => {
    try {
      if (!draftId || typeof draftId !== 'string') {
        throw new Error('Invalid draftId');
      }
      if (socket.data.draftId !== draftId) {
        throw new Error('Draft room membership required');
      }
      const deltas = await getDeltasSince(draftId, Number(since ?? 0));
      socket.emit('draft:backfill', deltas);
    } catch (error) {
      socket.emit('draft:backfill', []);
      logger.warn('Failed to load draft backfill', {
        socketId: socket.id,
        draftId,
        since,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Leave draft room with cleanup
  const leaveDraftRoom = async ({ draftId }: { draftId: string }) => {
    try {
      logger.info('👋 User leaving draft', { socketId: socket.id, draftId });

      const participantCount = await removeDraftSubscription(draftId);

      if (participantCount > 0) {
        socket.to(draftId).emit('participant:leave', {
          socketId: socket.id,
          timestamp: new Date().toISOString(),
          participantCount,
        });
      }
    } catch (error) {
      logger.error('❌ Error leaving draft', {
        socketId: socket.id,
        draftId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  socket.on('leave:draft', leaveDraftRoom);
  socket.on('draft:leave', leaveDraftRoom);

  // Handle disconnection with cleanup
  socket.on('disconnect', async (reason) => {
    const activeV2Subscription = draftSocketV2Session.getActive();
    const v2Cleanup = draftSocketV2Session.disconnect();
    const connectionDuration = socket.data.connectionStartTime
      ? Date.now() - socket.data.connectionStartTime
      : 0;

    logger.info('🔌 User disconnected', {
      socketId: socket.id,
      reason,
      connectionDuration,
      draftId: socket.data.draftId,
      userId: socket.data.userId,
      timestamp: new Date().toISOString(),
    });

    try {
      await v2Cleanup;
    } catch (error) {
      logger.error('Unhandled draft v2 disconnect cleanup failure', {
        socketId: socket.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Clean up any draft rooms this socket was in
    if (!activeV2Subscription && socket.data.draftId) {
      const draftId = socket.data.draftId as string;

      try {
        const participantCount = await removeDraftSubscription(draftId);

        if (participantCount > 0) {
          socket.to(draftId).emit('participant:disconnect', {
            socketId: socket.id,
            reason,
            timestamp: new Date().toISOString(),
            participantCount,
          });
        }
      } catch (error) {
        logger.error('❌ Error cleaning up draft disconnect', {
          socketId: socket.id,
          draftId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });

  // Handle draft-specific events backed by the live draft engine
  socket.on('draft:pick', async (data: { draftId: string; playerId: string; userId?: string }) => {
    incCounter(METRICS.pickFailures);
    logger.warn('Rejected socket-driven draft pick to avoid split-brain state', {
      socketId: socket.id,
      draftId: data.draftId,
      userId: socket.data.userId || 'unknown',
    });
    socket.emit('draft:error', {
      error: 'Direct socket picks are disabled. Use the Prisma-backed draft API.',
    });
  });

  // The durable draft command boundary and BullMQ worker exclusively own clock progression.
  socket.on('draft:timer:start', ({ draftId }) => {
    logger.warn('Rejected client-started draft timer to avoid split-brain state', {
      socketId: socket.id,
      draftId,
    });
    socket.emit('draft:error', {
      error: 'Direct socket timers are disabled. Use the Prisma-backed draft commands.',
      code: 'TIMER_AUTHORITY_VIOLATION',
    });
  });

  // Handle draft pause/resume
  socket.on('draft:pause', async ({ draftId }) => {
    logger.warn('Rejected socket-driven draft pause to avoid split-brain state', {
      socketId: socket.id,
      draftId,
    });
    socket.emit('draft:error', {
      error: 'Direct socket pause is disabled. Use the Prisma-backed draft API.',
    });
  });

  socket.on('draft:resume', async ({ draftId }) => {
    logger.warn('Rejected socket-driven draft resume to avoid split-brain state', {
      socketId: socket.id,
      draftId,
    });
    socket.emit('draft:error', {
      error: 'Direct socket resume is disabled. Use the Prisma-backed draft API.',
    });
  });
});

// Start the server with enhanced error handling
const PORT = socketIOConfig.server.port;

// Add comprehensive error handling
httpServer.on('error', (error) => {
  logger.error('❌ HTTP server error', {
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
  });
  process.exit(1);
});

// Graceful shutdown handling
const closeRedisConnections = async (): Promise<void> => {
  const results = await Promise.allSettled([
    socketRedisAdapterLifecycle?.close(),
    ScalableRedisConnection.shutdownInstance(),
    redisClient.disconnect(),
  ]);
  socketRedisAdapterLifecycle = null;

  const failure = results.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') {
    throw failure.reason;
  }
};

const gracefulShutdown = (signal: string) => {
  logger.info(`🔄 ${signal} received, shutting down gracefully`);

  // Close all Socket.IO connections
  void io.close(() => {
    logger.info('📡 Socket.IO server closed');

    void closeRedisConnections()
      .catch((error) => {
        logger.warn('Failed to close Redis connections cleanly', {
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        if (!httpServer.listening) {
          logger.info('🌐 HTTP server already closed');
          process.exit(0);
          return;
        }

        httpServer.close(() => {
          logger.info('🌐 HTTP server closed');
          process.exit(0);
        });
      });
  });

  // Force exit after timeout
  setTimeout(() => {
    logger.error('⏰ Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

// Handle various shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // Nodemon restart

// Enhanced uncaught exception handling
process.on('uncaughtException', (error) => {
  logger.error('❌ Uncaught Exception', {
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
  });

  // Attempt graceful shutdown
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('❌ Unhandled Rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    promise: promise.toString(),
    timestamp: new Date().toISOString(),
  });

  // Attempt graceful shutdown
  gracefulShutdown('unhandledRejection');
});

// Start the server only after the cross-instance broadcast adapter is ready.
void configureSocketRedisAdapter()
  .then(() => {
    httpServer.listen(PORT, () => {
      logger.info('🚀 Enhanced Socket.IO server started', {
        port: PORT,
        environment: socketIOConfig.environment,
        cors: socketIOConfig.server.cors.origin,
        transports: socketIOConfig.server.transports,
        timestamp: new Date().toISOString(),
      });

      console.log(`🚀 Enhanced Socket.IO server running on port ${PORT}`);
      console.log(`📡 WebSocket endpoint: ws://localhost:${PORT}`);
      console.log(`🌐 CORS enabled for: ${socketIOConfig.server.cors.origin.join(', ')}`);
      console.log(`⚙️ Environment: ${socketIOConfig.environment}`);
      console.log(`🔄 Transports: ${socketIOConfig.server.transports.join(', ')}`);
    });
  })
  .catch((error) => {
    logger.error('❌ Socket.IO startup failed', error, {
      timestamp: new Date().toISOString(),
    });
    process.exit(1);
  });

// (Health handled by Express above)

export default io;
