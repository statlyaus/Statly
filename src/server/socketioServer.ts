/**
 * Enhanced Socket.IO Server
 * Production-ready Socket.IO server with proper error handling, logging, and configuration
 */

import { createServer } from 'http';
import express from 'express';
import { Server } from 'socket.io';
import { logger } from '@/lib/logger';
import { getSocketIoConfig } from '@/lib/socketioConfig';
import { redisClient } from '@/lib/redis';
import { validateAuthToken } from '@/lib/serverAuth';
import { draftRoomStore } from '@/server/roomStore';
import { METRICS, incCounter, renderPrometheus, registerHistogram, observeHistogram, renderHistograms } from '@/server/metrics';
import { draftPubSub } from '@/services/realtime/pubsub';
import { getLiveDraftEngine } from '@/services/liveDraftEngine';
import { createSafeCatch } from '../lib/errorHandling';


// Load Socket.IO server options from env with dev-safe fallbacks
import type { ServerOptions } from 'socket.io';
let sioConfig: ServerOptions;
try {
  sioConfig = getSocketIoConfig();
} catch (error) {
  console.error('❌ Socket.IO configuration creation failed:', error);
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

  const state = (await draftRoomStore.getRoom(draftId)) || (await draftRoomStore.initRoomIfMissing(draftId));
  const updated = { ...state, timeRemaining: duration ?? state.timePerPick ?? 120, status: 'active' as const, lastActivity: new Date().toISOString() };
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
      const next = { ...cur, timeRemaining: cur.timeRemaining - 1, lastActivity: new Date().toISOString() };
      await draftRoomStore.saveRoom(next);
      incCounter(METRICS.timerTicks);
      io.to(draftId).emit('draft:timer', {
        draftId,
        timeRemaining: next.timeRemaining,
        timestamp: new Date().toISOString(),
      });
      await draftPubSub.publish(draftId, 'draft:timer-tick', { timeRemaining: next.timeRemaining });
    } else {
      clearInterval(timer);
      roomTimers.delete(draftId);
      await draftRoomStore.saveRoom({ ...cur, status: 'waiting' as const, lastActivity: new Date().toISOString() });
      incCounter(METRICS.timerExpired);
      io.to(draftId).emit('draft:timer:expired', { draftId, timestamp: new Date().toISOString() });
      await draftPubSub.publish(draftId, 'draft:timer-expired', {});
    }
  }, 1000);
  roomTimers.set(draftId, timer);
}

// Express app to serve health and potential aux endpoints
const app = express();
app.get('/health', (req, res) => {
  // Check for admin access
  const isAdmin = req.headers['x-admin'] === 'true';
  
  const baseResponse = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    activeConnections: (io as any)?.engine?.clientsCount ?? 0,
    draftRooms: draftRooms.size,
  };
  
  // Include sensitive data only for admin requests
  const response = isAdmin ? {
    ...baseResponse,
    memory: process.memoryUsage(),
  } : baseResponse;
  
  res.json(response);
});

// Prometheus metrics endpoint
app.get('/metrics', async (_req, res) => {
  try {
    const activeConnections = (io as any)?.engine?.clientsCount ?? 0;
    const roomsCount = await draftRoomStore.getRoomsCount();
    const body = renderPrometheus([
      { name: 'socketio_active_connections', help: 'Active Socket.IO connections', type: 'gauge', value: activeConnections },
      { name: 'socketio_rooms_active', help: 'Active draft rooms', type: 'gauge', value: roomsCount },
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
registerHistogram('socketio_allow_request_duration_seconds', [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]);
registerHistogram('socketio_join_duration_seconds', [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]);
registerHistogram('socketio_pick_duration_seconds', [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]);

// Create Socket.IO server with enhanced configuration
const io = new Server(httpServer, {
  ...sioConfig,
  // Additional production settings
  allowRequest: async (req, callback) => {
    const start = Date.now();
    try {
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
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
          observeHistogram('socketio_allow_request_duration_seconds', (Date.now() - start) / 1000, { outcome: 'ratelimited' });
          return callback('Rate limit exceeded', false);
        }
      } catch (_e) {
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
          observeHistogram('socketio_allow_request_duration_seconds', (Date.now() - start) / 1000, { outcome: 'ratelimited' });
          return callback('Rate limit exceeded', false);
        }
      }

      // Bearer token check; plug in real verification as needed
      const auth = Array.isArray(req.headers['authorization']) ? req.headers['authorization'][0] : req.headers['authorization'];
      if (!auth || !auth.startsWith('Bearer ') || auth.slice(7).trim().length === 0) {
        incCounter(METRICS.authFailures);
        observeHistogram('socketio_allow_request_duration_seconds', (Date.now() - start) / 1000, { outcome: 'noauth' });
        return callback('Authentication required', false);
      }
      const token = auth.slice(7).trim();
      const uid = await validateAuthToken(token);
      if (!uid) {
        incCounter(METRICS.authFailures);
        observeHistogram('socketio_allow_request_duration_seconds', (Date.now() - start) / 1000, { outcome: 'invauth' });
        return callback('Authentication required', false);
      }
      // Optionally attach uid for later use in connection
      (req as any)._uid = uid;
      observeHistogram('socketio_allow_request_duration_seconds', (Date.now() - start) / 1000, { outcome: 'ok' });
      return callback(null, true);
    } catch (_e) {
      incCounter(METRICS.authFailures);
      observeHistogram('socketio_allow_request_duration_seconds', (Date.now() - start) / 1000, { outcome: 'error' });
      return callback('Authentication error', false);
    }
  },
});

// Bind live draft engine events to Socket.IO and Pub/Sub for cross-instance propagation
try {
  const engine = getLiveDraftEngine();
  engine.on('draft:updated', (draft) => {
    io.to(draft.draftId).emit('draft:update', draft);
    void draftPubSub.publish(draft.draftId, 'draft:state', draft).catch(createSafeCatch('publish draft state update', { draftId: draft.draftId }));
  });
  engine.on('draft:completed', (draftId) => {
    io.to(draftId).emit('draft:completed', { draftId });
    void draftPubSub.publish(draftId, 'draft:completed', {}).catch(createSafeCatch('publish draft completed', { draftId }));
  });
  engine.on('draft:paused', (draftId) => {
    io.to(draftId).emit('draft:paused', { draftId });
    void draftPubSub.publish(draftId, 'draft:paused', {}).catch(createSafeCatch('publish draft paused', { draftId }));
  });
  engine.on('draft:resumed', (draftId) => {
    io.to(draftId).emit('draft:resumed', { draftId });
    void draftPubSub.publish(draftId, 'draft:resumed', {}).catch(createSafeCatch('publish draft resumed', { draftId }));
  });
  engine.on('draft:timer-tick', (draftId, timeRemaining) => {
    io.to(draftId).emit('draft:timer', { draftId, timeRemaining });
    void draftPubSub.publish(draftId, 'draft:timer-tick', { timeRemaining }).catch(createSafeCatch('publish draft timer tick', { draftId, timeRemaining }));
  });
  engine.on('draft:timer-expired', (draftId) => {
    io.to(draftId).emit('draft:timer:expired', { draftId });
    void draftPubSub.publish(draftId, 'draft:timer-expired', {}).catch(createSafeCatch('publish draft timer expired', { draftId }));
  });
  engine.on('draft:pick-made', (draftId, pick) => {
    io.to(draftId).emit('pick:made', { draftId, pick });
    void draftPubSub.publish(draftId, 'draft:pick-made', { pick }).catch(createSafeCatch('publish draft pick made', { draftId, pickId: pick.id }));
  });
  engine.on('draft:auto-pick', (draftId, pick) => {
    io.to(draftId).emit('draft:auto-pick', { draftId, pick });
    void draftPubSub.publish(draftId, 'draft:auto-pick', { pick }).catch(createSafeCatch('publish draft auto pick', { draftId, pickId: pick.id }));
  });
  engine.on('draft:participant-joined', (draftId, userId) => {
    io.to(draftId).emit('participant:joined', { draftId, userId });
    void draftPubSub.publish(draftId, 'draft:admin-message', { type: 'joined', userId }).catch(createSafeCatch('publish draft participant joined', { draftId, userId }));
  });
  engine.on('draft:participant-left', (draftId, userId) => {
    io.to(draftId).emit('participant:left', { draftId, userId });
    void draftPubSub.publish(draftId, 'draft:admin-message', { type: 'left', userId }).catch(createSafeCatch('publish draft participant left', { draftId, userId }));
  });
  engine.on('draft:queue-updated', (draftId, userId, queue) => {
    io.to(draftId).emit('draft:queue-updated', { draftId, userId, queue });
    void draftPubSub.publish(draftId, 'draft:queue-updated', { userId, queue }).catch(createSafeCatch('publish draft queue updated', { draftId, userId }));
  });
  } catch (_e) {
    logger.error('Failed to bind engine events', { error: (_e as Error).message });
  }

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

// Start Redis Pub/Sub subscriber to relay events from other instances to local clients
(async () => {
  try {
    await draftPubSub.start((msg) => {
      const { event, draftId, payload } = msg;
      switch (event) {
        case 'draft:state':
          io.to(draftId).emit('draft:state', payload);
          io.to(draftId).emit('draft:update', payload);
          break;
        case 'draft:timer-tick':
          io.to(draftId).emit('draft:timer-tick', payload);
          io.to(draftId).emit('draft:timer', payload);
          break;
        case 'draft:timer-expired':
          io.to(draftId).emit('draft:timer-expired', payload);
          io.to(draftId).emit('draft:timer:expired', payload);
          break;
        case 'draft:pick-made':
          io.to(draftId).emit('draft:pick-made', payload);
          io.to(draftId).emit('pick:made', payload);
          break;
        case 'draft:auto-pick':
          io.to(draftId).emit('draft:auto-pick', payload);
          break;
        case 'draft:paused':
          io.to(draftId).emit('draft:paused', payload);
          break;
        case 'draft:resumed':
          io.to(draftId).emit('draft:resumed', payload);
          break;
        case 'draft:completed':
          io.to(draftId).emit('draft:completed', payload);
          break;
        case 'draft:queue-updated':
          io.to(draftId).emit('draft:queue-updated', payload);
          break;
        case 'draft:admin-message':
          io.to(draftId).emit('draft:admin-message', payload);
          break;
      }
    });
  } catch (e) {
    logger.error('❌ Failed to start DraftPubSub subscriber', { error: (e as Error).message });
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
  socket.on('join:draft', async (data: { draftId: string; userId?: string; memberId?: string; displayName?: string; authToken?: string }) => {
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

      // Join the room
      socket.join(draftId);
      
      // Store user info in socket data
      socket.data.draftId = draftId;
      socket.data.userId = userId;
      socket.data.joinedAt = new Date();

      // Initialize or update draft room in Redis-backed store
      const state = await draftRoomStore.initRoomIfMissing(draftId);
      const participantCount = await draftRoomStore.addParticipant(draftId, socket.id);
      incCounter(METRICS.joins);
      // Store richer participant metadata if available
      const uidFromReq = (socket.request as any)?._uid as string | undefined;
      const participantUser = userId || uidFromReq || 'anonymous';
      await draftRoomStore.setParticipantData(draftId, socket.id, { userId: participantUser, memberId, displayName, socketId: socket.id, joinedAt: new Date().toISOString() });
      if (participantCount > state.maxParticipants) {
        await draftRoomStore.removeParticipant(draftId, socket.id);
        socket.emit('draft:error', {
          error: 'Draft room is full',
          code: 'ROOM_FULL',
          timestamp: new Date().toISOString(),
        });
        observeHistogram('socketio_join_duration_seconds', (Date.now() - startJoin) / 1000, { outcome: 'room_full' });
        return;
      }
      const room = await draftRoomStore.getRoom(draftId);
      if (!room) throw new Error('Room state unavailable');
      await draftRoomStore.saveRoom({ ...room, lastActivity: new Date().toISOString() });

      // Send current draft state to the joining user
      socket.emit('draft:update', {
        draftId,
        currentPick: room.currentPick,
        totalPicks: room.maxParticipants * 22, // 22 rounds
        participantCount,
        timeRemaining: room.timeRemaining,
        status: room.status,
        timestamp: new Date().toISOString(),
      });

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
      observeHistogram('socketio_join_duration_seconds', (Date.now() - startJoin) / 1000, { outcome: 'ok' });

    } catch (error) {
      logger.error('❌ Error joining draft', {
        socketId: socket.id,
        draftId,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
      observeHistogram('socketio_join_duration_seconds', (Date.now() - startJoin) / 1000, { outcome: 'error' });
      socket.emit('draft:error', {
        error: 'Failed to join draft',
        details: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Leave draft room with cleanup
  socket.on('leave:draft', ({ draftId }) => {
    try {
      logger.info('👋 User leaving draft', { socketId: socket.id, draftId });
      
      socket.leave(draftId);
      
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
  });

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
            draftId: socket.data.draftId 
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
    const start = Date.now();
    try {
      const { draftId, playerId } = data;
      const engine = getLiveDraftEngine();

      // Engine validates turn order, availability, and updates persistence
      const result = await engine.makePick({
        draftId,
        playerId,
        userId: data.userId || (socket.request as any)?._uid || 'unknown',
      });

      io.to(draftId).emit('pick:made', { draftId, pick: result });
      // Publish to other instances via Redis Pub/Sub
      await draftPubSub.publish(draftId, 'draft:pick-made', { pick: result });

      // Bump currentPick in room store for simpler clients that rely on it
      const state = (await draftRoomStore.getRoom(draftId)) || (await draftRoomStore.initRoomIfMissing(draftId));
      await draftRoomStore.saveRoom({ ...state, currentPick: (state.currentPick || 0) + 1, lastActivity: new Date().toISOString() });

      incCounter(METRICS.picksHandled);
      observeHistogram('socketio_pick_duration_seconds', (Date.now() - start) / 1000, { outcome: 'ok' });
    } catch (error) {
      incCounter(METRICS.pickFailures);
      observeHistogram('socketio_pick_duration_seconds', (Date.now() - start) / 1000, { outcome: 'error' });
      logger.error('❌ Error handling draft pick', {
        socketId: socket.id,
        data,
        error: error instanceof Error ? error.message : String(error),
      });
      socket.emit('draft:error', { error: error instanceof Error ? error.message : 'Failed to make pick' });
    }
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
    try {
      const t = roomTimers.get(draftId);
      if (t) clearInterval(t);
      roomTimers.delete(draftId);
      const state = (await draftRoomStore.getRoom(draftId)) || (await draftRoomStore.initRoomIfMissing(draftId));
      await draftRoomStore.saveRoom({ ...state, status: 'paused' as const, lastActivity: new Date().toISOString() });
      
      io.to(draftId).emit('draft:paused', {
        draftId,
        timestamp: new Date().toISOString(),
      });
      await draftPubSub.publish(draftId, 'draft:paused', {});
      
      logger.info('⏸️ Draft paused', { draftId, socketId: socket.id });
      
    } catch (error) {
      logger.error('❌ Error pausing draft', {
        socketId: socket.id,
        draftId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  socket.on('draft:resume', async ({ draftId }) => {
    try {
      await startDraftTimer(draftId, { useLeader: false });
      
      io.to(draftId).emit('draft:resumed', {
        draftId,
        timestamp: new Date().toISOString(),
      });
      await draftPubSub.publish(draftId, 'draft:resumed', {});
      
      logger.info('▶️ Draft resumed', { draftId, socketId: socket.id });
      
    } catch (error) {
      logger.error('❌ Error resuming draft', {
        socketId: socket.id,
        draftId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
});

// Start the server with enhanced error handling
const PORT = Number(process.env.SOCKET_PORT ?? process.env.PORT ?? 4000);

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
  const env = process.env.NODE_ENV ?? 'development';
  const origins = Array.isArray(sioConfig.cors?.origin)
    ? (sioConfig.cors!.origin as string[])
    : typeof sioConfig.cors?.origin === 'string'
      ? [sioConfig.cors!.origin as string]
      : [];
  const transports = sioConfig.transports ?? ['polling', 'websocket'];

  logger.info('🚀 Enhanced Socket.IO server started', {
    port: PORT,
    environment: env,
    cors: origins,
    transports,
    timestamp: new Date().toISOString(),
  });

  console.log(`🚀 Enhanced Socket.IO server running on port ${PORT}`);
  console.log(`📡 WebSocket endpoint: ws://localhost:${PORT}`);
  console.log(`🌐 CORS enabled for: ${origins.join(', ') || '(none set)'}`);
  console.log(`⚙️ Environment: ${env}`);
  console.log(`🔄 Transports: ${transports.join(', ')}`);
});

// (Health handled by Express above)

export default io;
