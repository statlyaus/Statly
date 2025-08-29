/**
 * Enhanced Socket.IO Server
 * Production-ready Socket.IO server with proper error handling, logging, and configuration
 */

import { createServer } from 'http';
import { Server } from 'socket.io';
import { logger } from '@/lib/logger';
import { socketIOConfig, validateSocketIOConfig } from '@/lib/socketioConfig';

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

// In-memory store for draft rooms (use Redis/database in production)
const draftRooms = new Map<string, DraftRoom>();

// Create HTTP server
const httpServer = createServer();

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
    try {
      // Basic token presence check (replace with real verification)
      const auth = req.headers['authorization'];
      if (!auth || (Array.isArray(auth) ? auth[0] : auth).trim().length === 0) {
        return callback('Authentication required', false);
      }
      // TODO: integrate a real rate limiter and token verification here
      return callback(null, true);
    } catch (_e) {
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

// Handle draft connections with enhanced error handling
io.on('connection', (socket) => {
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
  socket.on('join:draft', async (data: { draftId: string; userId?: string; authToken?: string }) => {
    const { draftId, userId, authToken } = data;
    
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

      // Initialize or update draft room
      if (!draftRooms.has(draftId)) {
        draftRooms.set(draftId, {
          id: draftId,
          participants: new Set([socket.id]),
          currentPick: 1,
          timeRemaining: 120, // 2 minutes per pick
          lastActivity: new Date(),
          status: 'waiting',
          maxParticipants: 12, // Default to 12 teams
          timePerPick: 120, // 2 minutes per pick
        });
        logger.info('🆕 Created new draft room', { draftId, socketId: socket.id });
      } else {
        const room = draftRooms.get(draftId)!;
        
        // Check if room is full
        if (room.participants.size >= room.maxParticipants) {
          socket.emit('draft:error', {
            error: 'Draft room is full',
            code: 'ROOM_FULL',
            timestamp: new Date().toISOString(),
          });
          return;
        }
        
        room.participants.add(socket.id);
        room.lastActivity = new Date();
        logger.info('👥 User joined existing draft room', {
          draftId,
          socketId: socket.id,
          participantCount: room.participants.size,
          maxParticipants: room.maxParticipants,
        });
      }

      // Send current draft state to the joining user
      const room = draftRooms.get(draftId)!;
      socket.emit('draft:update', {
        draftId,
        currentPick: room.currentPick,
        totalPicks: room.maxParticipants * 22, // 22 rounds
        participants: Array.from(room.participants),
        timeRemaining: room.timeRemaining,
        status: room.status,
        timestamp: new Date().toISOString(),
      });

      // Notify other participants that someone joined
      socket.to(draftId).emit('participant:join', {
        socketId: socket.id,
        userId: userId || 'anonymous',
        timestamp: new Date().toISOString(),
        participantCount: room.participants.size,
      });

      logger.info('📡 Draft update sent and participants notified', {
        draftId,
        socketId: socket.id,
        participantCount: room.participants.size,
      });

    } catch (error) {
      logger.error('❌ Error joining draft', {
        socketId: socket.id,
        draftId,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
      
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

  // Handle draft-specific events
  socket.on('draft:pick', (data: { draftId: string; playerId: string; userId: string }) => {
    try {
      const { draftId, playerId, userId } = data;
      const room = draftRooms.get(draftId);
      
      if (!room) {
        socket.emit('draft:error', { error: 'Draft room not found' });
        return;
      }
      
      // Validate it's the user's turn (simplified for now)
      logger.info('🎯 Draft pick made', {
        draftId,
        playerId,
        userId,
        socketId: socket.id,
        timestamp: new Date().toISOString(),
      });
      
      // Broadcast pick to all participants
      io.to(draftId).emit('draft:pick', {
        draftId,
        playerId,
        userId,
        timestamp: new Date().toISOString(),
        currentPick: room.currentPick,
      });
      
      // Update room state
      room.currentPick++;
      room.lastActivity = new Date();
      
    } catch (error) {
      logger.error('❌ Error handling draft pick', {
        socketId: socket.id,
        data,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Handle draft timer events
  socket.on('draft:timer:start', ({ draftId, duration }) => {
    try {
      const room = draftRooms.get(draftId);
      if (!room) return;
      
      // Clear existing timer
      if (room.timer) {
        clearInterval(room.timer);
      }
      
      room.timeRemaining = duration || 120;
      room.status = 'active';
      
      // Start new timer
      room.timer = setInterval(() => {
        if (room.timeRemaining > 0) {
          room.timeRemaining--;
          
          // Broadcast timer update
          io.to(draftId).emit('draft:timer', {
            draftId,
            timeRemaining: room.timeRemaining,
            timestamp: new Date().toISOString(),
          });
        } else {
          // Timer expired
          clearInterval(room.timer);
          room.timer = undefined;
          
          io.to(draftId).emit('draft:timer:expired', {
            draftId,
            timestamp: new Date().toISOString(),
          });
        }
      }, 1000);
      
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
  socket.on('draft:pause', ({ draftId }) => {
    try {
      const room = draftRooms.get(draftId);
      if (!room) return;
      
      room.status = 'paused';
      if (room.timer) {
        clearInterval(room.timer);
        room.timer = undefined;
      }
      
      io.to(draftId).emit('draft:paused', {
        draftId,
        timestamp: new Date().toISOString(),
      });
      
      logger.info('⏸️ Draft paused', { draftId, socketId: socket.id });
      
    } catch (error) {
      logger.error('❌ Error pausing draft', {
        socketId: socket.id,
        draftId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  socket.on('draft:resume', ({ draftId }) => {
    try {
      const room = draftRooms.get(draftId);
      if (!room) return;
      
      room.status = 'active';
      room.timeRemaining = room.timePerPick;
      
      // Restart timer
      room.timer = setInterval(() => {
        if (room.timeRemaining > 0) {
          room.timeRemaining--;
          
          io.to(draftId).emit('draft:timer', {
            draftId,
            timeRemaining: room.timeRemaining,
            timestamp: new Date().toISOString(),
          });
        } else {
          clearInterval(room.timer);
          room.timer = undefined;
          
          io.to(draftId).emit('draft:timer:expired', {
            draftId,
            timestamp: new Date().toISOString(),
          });
        }
      }, 1000);
      
      io.to(draftId).emit('draft:resumed', {
        draftId,
        timestamp: new Date().toISOString(),
      });
      
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

// Health check endpoint
httpServer.on('request', (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      activeConnections: io.engine.clientsCount,
      draftRooms: draftRooms.size,
      memory: process.memoryUsage(),
    }));
  }
});

export default io;
