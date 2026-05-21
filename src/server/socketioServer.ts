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
import { getDraftDeltasSince } from '@/server/draft/realtime/draftDeltaLog';
import { draftRoomStore, type DraftRoomState } from '@/server/roomStore';
import { createSocketAuthMiddleware } from '@/server/socketioAuth';
import { rejectSocketMutationCommand, socketMutationContext } from '@/server/socketioCommandGuards';
import { createSocketAllowRequestLimiter } from '@/server/socketioRateLimit';
import type { LiveDraftState } from '@/services/liveDraftEngine';

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

function getActiveDraftSocketIds(draftId: string): string[] {
  return Array.from(io.sockets.adapter.rooms.get(draftId) ?? []);
}

function mapRoomStatus(status: LiveDraftState['status']): DraftRoomState['status'] {
  if (status === 'LIVE') return 'active';
  if (status === 'PAUSED') return 'paused';
  if (status === 'COMPLETED') return 'completed';
  return 'waiting';
}

function buildRoomStateFromAuthoritativeState(
  state: LiveDraftState,
  existing: DraftRoomState | null
): DraftRoomState {
  return {
    id: state.draftId,
    currentPick: state.currentPick.pickNumber,
    timeRemaining:
      state.status === 'LIVE'
        ? Math.max(0, Math.floor((state.currentPick.expiresAt.getTime() - Date.now()) / 1000))
        : (state.timerSettings.pausedTimeRemaining ?? 0),
    lastActivity: new Date().toISOString(),
    status: mapRoomStatus(state.status),
    maxParticipants: state.draftSettings.totalTeams,
    timePerPick: state.timerSettings.durationSeconds,
    ...(existing ? {} : {}),
  };
}

async function reconcileDraftRoomMembership(draftId: string, participantId?: string) {
  await draftRoomStore.pruneExpiredParticipants(draftId);

  const activeSocketIds = getActiveDraftSocketIds(draftId);
  const targetIds = participantId ? [...activeSocketIds, participantId] : activeSocketIds;

  return draftRoomStore.reconcileParticipants(draftId, targetIds);
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

const allowSocketRequest = createSocketAllowRequestLimiter({
  getRedisClient: () => redisClient.getClient(),
  onRedisFallback: (error) => {
    logger.warn('Redis rate limiting failed, using in-memory fallback', {
      error: error instanceof Error ? error.message : String(error),
    });
  },
  onRateLimited: () => {
    incCounter(METRICS.rateLimitRejections);
  },
  onOutcome: (outcome, durationSeconds) => {
    observeHistogram('socketio_allow_request_duration_seconds', durationSeconds, { outcome });
  },
  onError: () => {
    incCounter(METRICS.authFailures);
  },
});

const authorizeSocketConnection = createSocketAuthMiddleware({
  environment: socketIOConfig.environment,
  validateAuthToken,
  onAuthFailure: () => {
    incCounter(METRICS.authFailures);
  },
  onObserved: (outcome, durationSeconds) => {
    observeHistogram('socketio_allow_request_duration_seconds', durationSeconds, { outcome });
  },
});

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
  allowRequest: allowSocketRequest,
});

// Middleware for authentication and logging
io.use(async (socket, next) => {
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

  return authorizeSocketConnection(socket, next);
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
    const { draftId, userId, memberId, displayName, authToken } = data;
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

      await reconcileDraftRoomMembership(draftId, socket.id);

      // Join the room
      socket.join(draftId);
      socket.join(`draft:${draftId}`);

      // Store user info in socket data
      socket.data.draftId = draftId;
      socket.data.userId = userId;
      socket.data.joinedAt = new Date();

      const [authoritativeState, legacyUpdate] = await Promise.all([
        buildAuthoritativeDraftState(draftId),
        buildLegacyDraftUpdate(draftId),
      ]);

      // Initialize or update draft room in Redis-backed store
      const existingRoom = await draftRoomStore.getRoom(draftId);
      const state = authoritativeState
        ? buildRoomStateFromAuthoritativeState(authoritativeState, existingRoom)
        : existingRoom || (await draftRoomStore.initRoomIfMissing(draftId));
      await draftRoomStore.saveRoom(state);
      await draftRoomStore.addParticipant(draftId, socket.id);
      incCounter(METRICS.joins);
      // Store richer participant metadata if available
      const authenticatedUserId = socket.data.authenticatedUserId as string | undefined;
      const participantUser = userId || authenticatedUserId || 'anonymous';
      await draftRoomStore.setParticipantData(draftId, socket.id, {
        userId: participantUser,
        memberId,
        displayName,
        socketId: socket.id,
        joinedAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      });
      const participantCount = await draftRoomStore.getActiveParticipantCount(draftId);
      if (participantCount > state.maxParticipants) {
        await draftRoomStore.removeParticipant(draftId, socket.id);
        socket.leave(draftId);
        socket.leave(`draft:${draftId}`);
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
      const room = await draftRoomStore.getRoom(draftId);
      if (!room) throw new Error('Room state unavailable');
      await draftRoomStore.saveRoom(
        authoritativeState
          ? buildRoomStateFromAuthoritativeState(authoritativeState, room)
          : { ...room, lastActivity: new Date().toISOString() }
      );

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
                pickDeadlineAt: authoritativeState.currentPick.expiresAt.toISOString(),
                settings: {
                  draftType: authoritativeState.draftSettings.draftType,
                  timePerPick: authoritativeState.draftSettings.pickTimeLimit,
                  totalRounds: authoritativeState.draftSettings.totalRounds,
                  rosterSize: 0,
                  benchSize: 0,
                  enableReminders: true,
                  leagueSize: authoritativeState.draftSettings.totalTeams,
                  leagueId: draftId,
                  name: `Draft ${legacyUpdate.draftId}`,
                  timeZone: 'Australia/Melbourne',
                  startingLineup: {},
                  allowTrades: false,
                  autoPickEnabled: true,
                  pauseOnDisconnect: false,
                  maxPauseDuration: 0,
                },
                participants: legacyUpdate.participants,
              }
            : null,
          participants: legacyUpdate?.participants ?? [],
          picks: legacyUpdate?.picks ?? [],
          availablePlayers: [],
          liveState: {
            currentPick: authoritativeState.currentPick.pickNumber,
            onClockTeamId: authoritativeState.currentPick.memberId,
            timeRemaining: Math.max(
              0,
              Math.floor((authoritativeState.currentPick.expiresAt.getTime() - Date.now()) / 1000)
            ),
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
      if (socket.data.draftId === draftId) {
        await draftRoomStore.touchParticipant(draftId, socket.id);
      }
      const deltas = await getDraftDeltasSince(draftId, Number(since ?? 0));
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

      socket.leave(draftId);
      socket.leave(`draft:${draftId}`);
      await draftRoomStore.removeParticipant(draftId, socket.id);
      await reconcileDraftRoomMembership(draftId);
      const participantCount = await draftRoomStore.getActiveParticipantCount(draftId);

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
            participantCount,
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
  socket.on('disconnect', async (reason) => {
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
      await draftRoomStore.removeParticipant(socket.data.draftId, socket.id);
      await reconcileDraftRoomMembership(socket.data.draftId);
      const participantCount = await draftRoomStore.getActiveParticipantCount(socket.data.draftId);
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
            participantCount,
          });
        }
      }
    }
  });

  // Handle draft-specific events backed by the live draft engine
  socket.on('draft:pick', async (payload: unknown) => {
    rejectSocketMutationCommand({
      socket,
      logger,
      incCounter,
      metricName: METRICS.pickFailures,
      logMessage: 'Rejected socket-driven draft pick to avoid split-brain state',
      error: 'Direct socket picks are disabled. Use the Prisma-backed draft API.',
      context: {
        ...socketMutationContext(payload, ['draftId', 'playerId', 'userId']),
        authenticatedUserId: (socket.request as any)?._uid || 'unknown',
      },
    });
  });

  // Direct socket timer starts are disabled; pick deadlines are owned by the Prisma draft API.
  socket.on('draft:timer:start', (payload: unknown) => {
    rejectSocketMutationCommand({
      socket,
      logger,
      incCounter,
      metricName: METRICS.timerStartRejected,
      logMessage: 'Rejected socket-driven draft timer start to avoid split-brain state',
      error: 'Direct socket timer starts are disabled. Use the Prisma-backed draft API.',
      context: socketMutationContext(payload, ['draftId', 'duration']),
    });
  });

  // Handle draft pause/resume
  socket.on('draft:pause', async (payload: unknown) => {
    rejectSocketMutationCommand({
      socket,
      logger,
      logMessage: 'Rejected socket-driven draft pause to avoid split-brain state',
      error: 'Direct socket pause is disabled. Use the Prisma-backed draft API.',
      context: socketMutationContext(payload, ['draftId']),
    });
  });

  socket.on('draft:resume', async (payload: unknown) => {
    rejectSocketMutationCommand({
      socket,
      logger,
      logMessage: 'Rejected socket-driven draft resume to avoid split-brain state',
      error: 'Direct socket resume is disabled. Use the Prisma-backed draft API.',
      context: socketMutationContext(payload, ['draftId']),
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

// (Health handled by Express above)

export default io;
