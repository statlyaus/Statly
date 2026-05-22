/**
 * Enhanced Socket.IO Server
 * Production-ready Socket.IO server with proper error handling, logging, and configuration
 */

import 'dotenv/config';

import { createServer } from 'http';

import express from 'express';
import { Server } from 'socket.io';

import { buildAuthoritativeDraftState, buildLegacyDraftUpdate } from '@/lib/draftRealtime';
import { logger } from '@/lib/logger';
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
import { draftRealtimeDispatcher } from '@/server/draft/services/DraftRealtimeDispatcher';
import { draftRealtimePublisher } from '@/server/draft/services/DraftRealtimePublisher';
import { draftRoomStore } from '@/server/roomStore';
import { getRedis } from '@/server/redis';

// Validate configuration before starting
try {
  validateSocketIOConfig(socketIOConfig);
} catch (error) {
  console.error('❌ Socket.IO configuration validation failed:', error);
  process.exit(1);
}

// Import the persistence service (for now, we'll use in-memory storage and add Firestore later)
interface DraftRoom {
  id: string;
  participants: Set<string>;
  currentPick: number;
  timer?: ReturnType<typeof setInterval>;
  timeRemaining: number;
  lastActivity: Date;
  status: 'waiting' | 'active' | 'paused' | 'completed';
  maxParticipants: number;
  timePerPick: number;
}

// In-memory store for draft rooms (legacy/local)
const draftRooms = new Map<string, DraftRoom>();
// Timers tracked in-process; room state persists in Redis via room store
const roomTimers = new Map<string, ReturnType<typeof setInterval> | undefined>();
let draftOutboxDrainInFlight = false;

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

type DraftDelta = {
  type:
    | 'SNAPSHOT'
    | 'PICK_MADE'
    | 'PLAYER_REMOVED'
    | 'PLAYER_ADDED'
    | 'QUEUE_UPDATED'
    | 'STATE_PATCH';
  payload: any;
  ts?: number;
};

async function getDeltasSince(draftId: string, since: number): Promise<DraftDelta[]> {
  const redis = await getRedis();
  if (!redis) {
    return [];
  }

  const key = `draft:${draftId}:events`;
  const vals = await redis.zrangebyscore(key, since + 1, '+inf');
  return vals
    .map((value) => {
      try {
        return JSON.parse(value) as DraftDelta;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as DraftDelta[];
}

// Start or restart a draft timer and broadcast ticks/expiry
async function startDraftTimer(draftId: string, opts?: { duration?: number; useLeader?: boolean }) {
  const useLeader = !!opts?.useLeader;
  const duration = opts?.duration;
  // Optional leader election (for start events)
  let leaderToken: string | null = null;
  let lockKey = '';
  const client = redisClient.getClient();
  const lockMs = Number(process.env.SOCKET_TIMER_LOCK_MS || 10_000);
  if (useLeader) {
    leaderToken = `${process.pid}-${Math.random().toString(36).slice(2)}`;
    lockKey = `draftroom:${draftId}:timerlock`;
    const acquire = async (): Promise<boolean> => {
      if (!client) return true;
      const ok = await client.set(lockKey, leaderToken!, 'PX', lockMs, 'NX');
      return ok === 'OK';
    };
    const got = await acquire();
    if (!got) {
      logger.info('⏱️ Timer leadership not acquired; skipping local timer', { draftId });
      return;
    }
  }

  const state =
    (await draftRoomStore.getRoom(draftId)) || (await draftRoomStore.initRoomIfMissing(draftId));
  const updated = {
    ...state,
    timeRemaining: duration ?? state.timePerPick ?? 120,
    status: 'active' as const,
    lastActivity: new Date().toISOString(),
  };
  await draftRoomStore.saveRoom(updated);

  const existing = roomTimers.get(draftId);
  if (existing) clearInterval(existing);

  const renew = async (): Promise<boolean> => {
    if (!useLeader || !client) return true;
    // Atomic check-and-extend via Lua EVAL
    const script = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`;
    try {
      const res = await (client as any).eval(script, 1, lockKey, leaderToken!, String(lockMs));
      return res === 1 || res === '1' || res === 'OK';
    } catch {
      return false;
    }
  };

  const timer = setInterval(async () => {
    if (!(await renew())) {
      clearInterval(timer);
      roomTimers.delete(draftId);
      incCounter(METRICS.leadershipLost);
      return;
    }
    const cur = await draftRoomStore.getRoom(draftId);
    if (!cur) {
      clearInterval(timer);
      roomTimers.delete(draftId);
      return;
    }
    if (cur.timeRemaining > 0) {
      const next = {
        ...cur,
        timeRemaining: cur.timeRemaining - 1,
        lastActivity: new Date().toISOString(),
      };
      await draftRoomStore.saveRoom(next);
      incCounter(METRICS.timerTicks);
      await draftRealtimeDispatcher.publishTimerTick(draftId, next.timeRemaining);
    } else {
      clearInterval(timer);
      roomTimers.delete(draftId);
      await draftRoomStore.saveRoom({
        ...cur,
        status: 'waiting' as const,
        lastActivity: new Date().toISOString(),
      });
      incCounter(METRICS.timerExpired);
      await draftRealtimeDispatcher.publishTimerExpired(draftId);
    }
  }, 1000);
  roomTimers.set(draftId, timer);
}

// Express app to serve health and potential aux endpoints
const app = express();
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    // io initialized below; safe to reference after server start too
    activeConnections: (io as any)?.engine?.clientsCount ?? 0,
    draftRooms: draftRooms.size,
    memory: process.memoryUsage(),
  });
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
  allowRequest: async (req, callback) => {
    const start = Date.now();
    try {
      const ip =
        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
        req.socket.remoteAddress ||
        'unknown';
      const windowSec = Number(process.env.SOCKET_RATE_LIMIT_WINDOW_SEC || 60); // default 60s window
      const subBucketSec = Number(process.env.SOCKET_RATE_LIMIT_SUB_BUCKET_SEC || 10); // sub-buckets 10s
      const maxReq = Number(process.env.SOCKET_RATE_LIMIT_MAX || 100);
      const nowMs = Date.now();
      const currentBucket = Math.floor(nowMs / (subBucketSec * 1000));
      const bucketsToCount = Math.ceil(windowSec / subBucketSec);

      // Try Redis-based limiting first (cluster/scaling friendly)
      try {
        const client = redisClient.getClient();
        if (!client) throw new Error('Redis not initialized');
        // Increment current sub-bucket and set TTL
        const curKey = `ratelimit:socketio:${ip}:${currentBucket}`;
        const inc = await client.incr(curKey);
        if (inc === 1) {
          await client.expire(curKey, windowSec);
        }
        // Sum recent sub-buckets within the window
        const keys: string[] = [];
        for (let i = 0; i < bucketsToCount; i++) {
          keys.push(`ratelimit:socketio:${ip}:${currentBucket - i}`);
        }
        const vals = await client.mget(keys);
        const total = (vals || []).reduce((sum, v) => sum + (v ? parseInt(v, 10) : 0), 0);
        if (total > maxReq) {
          incCounter(METRICS.rateLimitRejections);
          observeHistogram('socketio_allow_request_duration_seconds', (Date.now() - start) / 1000, {
            outcome: 'ratelimited',
          });
          return callback('Rate limit exceeded', false);
        }
      } catch (error) {
        logger.warn('Redis rate limiting failed, using in-memory fallback', {
          error: error instanceof Error ? error.message : String(error),
        });
        // Fallback to in-memory limiter if Redis is unavailable
        const now = Date.now();
        const windowMs = windowSec * 1000;
        const store: Map<string, number[]> = (io as any)._allowReqLimiter || new Map();
        (io as any)._allowReqLimiter = store;
        const arr = store.get(ip) || [];
        const recent = arr.filter((t) => now - t < windowMs);
        recent.push(now);
        store.set(ip, recent);
        if (recent.length > maxReq) {
          incCounter(METRICS.rateLimitRejections);
          observeHistogram('socketio_allow_request_duration_seconds', (Date.now() - start) / 1000, {
            outcome: 'ratelimited',
          });
          return callback('Rate limit exceeded', false);
        }
      }

      // Bearer token check; plug in real verification as needed
      const auth = Array.isArray(req.headers['authorization'])
        ? req.headers['authorization'][0]
        : req.headers['authorization'];
      if (!auth || !auth.startsWith('Bearer ') || auth.slice(7).trim().length === 0) {
        if (socketIOConfig.environment !== 'production') {
          observeHistogram('socketio_allow_request_duration_seconds', (Date.now() - start) / 1000, {
            outcome: 'dev-noauth',
          });
          return callback(null, true);
        }
        incCounter(METRICS.authFailures);
        observeHistogram('socketio_allow_request_duration_seconds', (Date.now() - start) / 1000, {
          outcome: 'noauth',
        });
        return callback('Authentication required', false);
      }
      const token = auth.slice(7).trim();
      const uid = await validateAuthToken(token);
      if (!uid) {
        incCounter(METRICS.authFailures);
        observeHistogram('socketio_allow_request_duration_seconds', (Date.now() - start) / 1000, {
          outcome: 'invauth',
        });
        return callback('Authentication required', false);
      }
      // Optionally attach uid for later use in connection
      (req as any)._uid = uid;
      observeHistogram('socketio_allow_request_duration_seconds', (Date.now() - start) / 1000, {
        outcome: 'ok',
      });
      return callback(null, true);
    } catch (_e) {
      incCounter(METRICS.authFailures);
      observeHistogram('socketio_allow_request_duration_seconds', (Date.now() - start) / 1000, {
        outcome: 'error',
      });
      return callback('Authentication error', false);
    }
  },
});

// Middleware for authentication and logging
io.use((socket, next) => {
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

  next();
});

draftRealtimeDispatcher.attachSocketServer(io);

(async () => {
  try {
    await draftRealtimeDispatcher.startSubscription();
    await flushDraftOutboxBatch();
    setInterval(
      () => {
        void flushDraftOutboxBatch();
      },
      Number(process.env.DRAFT_OUTBOX_DRAIN_INTERVAL_MS || 5000)
    );
  } catch (e) {
    logger.error('❌ Failed to start draft realtime dispatcher', { error: (e as Error).message });
  }
})();

// Handle draft connections with enhanced error handling
io.on('connection', (socket) => {
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

  // Join draft room with enhanced validation
  const joinDraftRoom = async (data: {
    draftId: string;
    userId?: string;
    memberId?: string;
    displayName?: string;
    authToken?: string;
  }) => {
    const { draftId, userId, memberId, displayName } = data;
    const startJoin = Date.now();

    try {
      // Validate input
      if (!draftId || typeof draftId !== 'string') {
        throw new Error('Invalid draftId');
      }

      logger.info('👤 User joining draft', {
        socketId: socket.id,
        draftId,
        userId: userId || 'anonymous',
        timestamp: new Date().toISOString(),
      });

      // Initialize or update draft room in Redis-backed store
      const state = await draftRoomStore.initRoomIfMissing(draftId);
      const participantResult = await draftRoomStore.addParticipantIfUnderLimit(
        draftId,
        socket.id,
        state.maxParticipants
      );

      if (!participantResult.accepted) {
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

      incCounter(METRICS.joins);
      const participantCount = participantResult.count;

      // Join the room
      socket.join(draftId);
      socket.join(`draft:${draftId}`);

      // Store user info in socket data
      socket.data.draftId = draftId;
      socket.data.userId = userId;
      socket.data.joinedAt = new Date();

      // Store richer participant metadata if available
      const uidFromReq = (socket.request as any)?._uid as string | undefined;
      const participantUser = userId || uidFromReq || 'anonymous';
      await draftRoomStore.setParticipantData(draftId, socket.id, {
        userId: participantUser,
        memberId,
        displayName,
        socketId: socket.id,
        joinedAt: new Date().toISOString(),
      });
      const room = await draftRoomStore.getRoom(draftId);
      if (!room) throw new Error('Room state unavailable');
      await draftRoomStore.saveRoom({ ...room, lastActivity: new Date().toISOString() });

      const [authoritativeState, legacyUpdate] = await Promise.all([
        buildAuthoritativeDraftState(draftId),
        buildLegacyDraftUpdate(draftId),
      ]);

      if (authoritativeState) {
        socket.emit('draft:snapshot', {
          draft: legacyUpdate
            ? {
                id: legacyUpdate.draftId,
                name: `Draft ${legacyUpdate.draftId}`,
                leagueId: draftId,
                status: legacyUpdate.status,
                currentPick: legacyUpdate.currentPick,
                totalPicks: legacyUpdate.totalPicks,
                round: legacyUpdate.round,
                direction: legacyUpdate.direction,
                participants: legacyUpdate.participants,
              }
            : null,
          participants: legacyUpdate?.participants ?? [],
          picks: legacyUpdate?.picks ?? [],
          availablePlayers: [],
          liveState: {
            currentPick: authoritativeState.currentPick.pickNumber,
            onClockTeamId: authoritativeState.currentPick.memberId,
          },
          ts: Date.now(),
        });
        socket.emit('draft:state', authoritativeState);
        socket.emit(
          'draft:update',
          legacyUpdate ?? {
            draftId,
            currentPick: authoritativeState.currentPick.pickNumber,
            totalPicks:
              authoritativeState.draftSettings.totalRounds *
              authoritativeState.draftSettings.totalTeams,
            round: authoritativeState.currentPick.round,
            direction: authoritativeState.currentPick.round % 2 === 1 ? 'FORWARD' : 'REVERSE',
            status: authoritativeState.status,
            picks: [],
            participants: authoritativeState.participants.map((participant) => ({
              slot: participant.draftOrder,
              member: {
                id: participant.memberId,
                userId: participant.userId,
                displayName: participant.displayName,
                email: '',
              },
            })),
            completedAt:
              authoritativeState.status === 'COMPLETED'
                ? authoritativeState.updatedAt.toISOString()
                : undefined,
          }
        );
      } else {
        socket.emit('draft:update', {
          draftId,
          currentPick: room.currentPick,
          totalPicks: room.maxParticipants * 22,
          participantCount,
          timeRemaining: room.timeRemaining,
          status: room.status,
          timestamp: new Date().toISOString(),
        });
      }

      // Notify other participants that someone joined
      socket.to(draftId).emit('participant:join', {
        socketId: socket.id,
        userId: userId || 'anonymous',
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
    } catch (error) {
      logger.error('❌ Error joining draft', {
        socketId: socket.id,
        draftId,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
      observeHistogram('socketio_join_duration_seconds', (Date.now() - startJoin) / 1000, {
        outcome: 'error',
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

  socket.on('draft:backfill', async ({ draftId, since }) => {
    try {
      if (!draftId || typeof draftId !== 'string') {
        throw new Error('Invalid draftId');
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
  const leaveDraftRoom = ({ draftId }: { draftId: string }) => {
    try {
      logger.info('👋 User leaving draft', { socketId: socket.id, draftId });

      socket.leave(draftId);
      socket.leave(`draft:${draftId}`);

      // Clean up room if empty
      const room = draftRooms.get(draftId);
      if (room) {
        room.participants.delete(socket.id);

        if (room.participants.size === 0) {
          // Clean up timer if exists
          if (room.timer) {
            clearInterval(room.timer);
            room.timer = undefined;
          }
          draftRooms.delete(draftId);
          logger.info('🗑️ Draft room cleaned up', { draftId });
        } else {
          // Notify remaining participants
          socket.to(draftId).emit('participant:leave', {
            socketId: socket.id,
            timestamp: new Date().toISOString(),
            participantCount: room.participants.size,
          });
        }
      }

      // Clear socket data
      delete socket.data.draftId;
      delete socket.data.userId;
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
  socket.on('disconnect', (reason) => {
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

    // Clean up any draft rooms this socket was in
    if (socket.data.draftId) {
      const room = draftRooms.get(socket.data.draftId);
      if (room) {
        room.participants.delete(socket.id);

        if (room.participants.size === 0) {
          if (room.timer) {
            clearInterval(room.timer);
            room.timer = undefined;
          }
          draftRooms.delete(socket.data.draftId);
          logger.info('🗑️ Draft room cleaned up after disconnect', {
            draftId: socket.data.draftId,
          });
        } else {
          // Notify remaining participants
          socket.to(socket.data.draftId).emit('participant:disconnect', {
            socketId: socket.id,
            reason,
            timestamp: new Date().toISOString(),
            participantCount: room.participants.size,
          });
        }
      }
    }
  });

  // Handle draft-specific events backed by the live draft engine
  socket.on('draft:pick', async (data: { draftId: string; playerId: string; userId?: string }) => {
    incCounter(METRICS.pickFailures);
    logger.warn('Rejected socket-driven draft pick to avoid split-brain state', {
      socketId: socket.id,
      draftId: data.draftId,
      userId: data.userId || (socket.request as any)?._uid || 'unknown',
    });
    socket.emit('draft:error', {
      error: 'Direct socket picks are disabled. Use the Prisma-backed draft API.',
    });
  });

  // Handle draft timer events with leader election
  socket.on('draft:timer:start', async ({ draftId, duration }) => {
    try {
      await startDraftTimer(draftId, { duration, useLeader: true });

      logger.info('⏰ Draft timer started', { draftId, duration, socketId: socket.id });
    } catch (error) {
      logger.error('❌ Error starting draft timer', {
        socketId: socket.id,
        draftId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
const gracefulShutdown = (signal: string) => {
  logger.info(`🔄 ${signal} received, shutting down gracefully`);

  // Close all Socket.IO connections
  io.close(() => {
    logger.info('📡 Socket.IO server closed');

    // Close HTTP server
    httpServer.close(() => {
      logger.info('🌐 HTTP server closed');
      process.exit(0);
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

// Start the server
httpServer.listen(PORT, () => {
  const corsOrigins = socketIOConfig.server.cors.origin;

  logger.info('🚀 Enhanced Socket.IO server started', {
    port: PORT,
    environment: socketIOConfig.environment,
    cors: corsOrigins,
    transports: socketIOConfig.server.transports,
    timestamp: new Date().toISOString(),
  });

  console.log(`🚀 Enhanced Socket.IO server running on port ${PORT}`);
  console.log(`📡 WebSocket endpoint: ws://localhost:${PORT}`);
  console.log(`🌐 CORS enabled for: ${corsOrigins.join(', ')}`);
  console.log(`⚙️ Environment: ${socketIOConfig.environment}`);
  console.log(`🔄 Transports: ${socketIOConfig.server.transports.join(', ')}`);
});

// (Health handled by Express above)

export default io;
