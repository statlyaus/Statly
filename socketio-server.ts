#!/usr/bin/env node

import { createServer } from 'http';
import { Server } from 'socket.io';

// Import the persistence service (for now, we'll use in-memory storage and add Firestore later)
interface DraftRoom {
  id: string;
  participants: Set<string>;
  currentPick: number;
  timer?: ReturnType<typeof setInterval>;
  timeRemaining: number;
  lastActivity: Date;
}

// In-memory store for draft rooms (use Redis/database in production)
const draftRooms = new Map<string, DraftRoom>();

// Create HTTP server
const httpServer = createServer();

// Create Socket.IO server
const io = new Server(httpServer, {
  cors: {
    origin: [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
      'http://localhost:3003',
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: false, // Disable credentials for now
    allowedHeaders: ['Content-Type', 'Authorization'],
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true,
});

// Handle draft connections
io.on('connection', (socket) => {
  console.log('✅ User connected:', socket.id);
  console.log('🔗 Active connections:', io.engine.clientsCount);

  // Test handler
  socket.on('test', (data) => {
    console.log('📨 Test message received:', data);
    socket.emit('test-response', { message: 'Hello from server!' });
  });

  // Dashboard handlers
  const refreshCooldownMs = 1000;
  let lastDashboardRefresh = 0;
  let lastModuleRefresh = 0;

  socket.on('dashboard:refresh', () => {
    const now = Date.now();
    if (now - lastDashboardRefresh < refreshCooldownMs) return;
    lastDashboardRefresh = now;
    io.emit('dashboard:update', { timestamp: new Date().toISOString() });
  });

  socket.on('module:refresh', (moduleId: unknown) => {
    if (typeof moduleId !== 'string') return;
    const safeId = moduleId.trim().toLowerCase();
    if (!/^[a-z0-9-]{1,64}$/.test(safeId)) return;
    const now = Date.now();
    if (now - lastModuleRefresh < refreshCooldownMs) return;
    lastModuleRefresh = now;
    io.emit(`${safeId}:update`, { timestamp: new Date().toISOString() });
  });

  socket.on('join:draft', (data: { draftId: string }) => {
    const { draftId } = data;
    console.log(`👤 User ${socket.id} joining draft: ${draftId}`);

    socket.join(draftId);

    // Initialize or update draft room
    if (!draftRooms.has(draftId)) {
      draftRooms.set(draftId, {
        id: draftId,
        participants: new Set([socket.id]),
        currentPick: 1,
        timeRemaining: 120, // 2 minutes per pick
        lastActivity: new Date(),
      });
      console.log(`🆕 Created new draft room: ${draftId}`);
    } else {
      const room = draftRooms.get(draftId)!;
      room.participants.add(socket.id);
      room.lastActivity = new Date();
      console.log(
        `👥 User ${socket.id} joined existing draft room: ${draftId} (${room.participants.size} participants)`
      );
    }

    // Send current draft state to the joining user
    const room = draftRooms.get(draftId)!;
    socket.emit('draft:update', {
      draftId,
      currentPick: room.currentPick,
      totalPicks: 264, // 22 rounds x 12 teams
      participants: Array.from(room.participants),
      timeRemaining: room.timeRemaining,
    });

    console.log(`📡 Sent draft update to ${socket.id} for room ${draftId}`);

    // Notify other participants that someone joined
    socket.to(draftId).emit('participant:join', {
      socketId: socket.id,
      timestamp: new Date().toISOString(),
    });

    console.log(`📢 Notified other participants about ${socket.id} joining ${draftId}`);
  });

  // Leave draft room
  socket.on('leave:draft', ({ draftId }) => {
    console.log(`Client ${socket.id} leaving draft ${draftId}`);
    socket.leave(`draft-${draftId}`);

    const room = draftRooms.get(draftId);
    if (room) {
      room.participants.delete(socket.id);
      socket.to(`draft-${draftId}`).emit('participant:leave', socket.id);
    }
  });

  // Handle pick submission
  socket.on('draft:make-pick', async ({ draftId, playerId, memberId, timestamp }) => {
    console.log(`Pick made in draft ${draftId}: Player ${playerId} by ${memberId}`);

    const room = draftRooms.get(draftId);
    if (!room) return;

    // Simulate pick processing
    const pick = {
      id: `pick-${Date.now()}`,
      overall: room.currentPick,
      round: Math.ceil(room.currentPick / 12),
      slot: ((room.currentPick - 1) % 12) + 1,
      player: {
        id: playerId,
        name: `Player ${playerId}`,
        position: 'MID',
        club: 'Demo FC',
      },
      member: {
        id: memberId,
        displayName: `User ${memberId}`,
      },
      auto: false,
      madeAt: timestamp,
    };

    // Advance pick
    room.currentPick++;
    room.timeRemaining = 120; // Reset timer

    // Broadcast pick to all participants
    io.to(`draft-${draftId}`).emit('draft:pick', {
      draftId,
      pick,
      currentPick: room.currentPick,
      isComplete: room.currentPick > 264,
    });

    // Restart timer for next pick
    if (room.currentPick <= 264) {
      startPickTimer(draftId);
    }
  });

  // Handle queue updates
  socket.on('draft:update-queue', ({ draftId, memberId, queue }) => {
    console.log(`Queue updated in draft ${draftId} by ${memberId}`);

    // Broadcast queue update
    socket.to(`draft-${draftId}`).emit('draft:queue', {
      draftId,
      memberId,
      queue,
      timestamp: new Date().toISOString(),
    });
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);

    // Remove from all draft rooms
    draftRooms.forEach((room, draftId) => {
      if (room.participants.has(socket.id)) {
        room.participants.delete(socket.id);
        socket.to(`draft-${draftId}`).emit('participant:leave', socket.id);
      }
    });
  });
});

// Timer function for pick countdown
function startPickTimer(draftId: string) {
  const room = draftRooms.get(draftId);
  if (!room || !io) return;

  // Clear existing timer
  if (room.timer) {
    clearInterval(room.timer);
  }

  room.timeRemaining = 120; // 2 minutes per pick

  room.timer = setInterval(() => {
    room.timeRemaining--;

    // Broadcast timer update every 10 seconds or when under 30 seconds
    if (room.timeRemaining % 10 === 0 || room.timeRemaining <= 30) {
      io.to(`draft-${draftId}`).emit('draft:timer', {
        draftId,
        timeRemaining: room.timeRemaining,
        currentTurn: {
          round: Math.ceil(room.currentPick / 12),
          slot: ((room.currentPick - 1) % 12) + 1,
          member: {
            id: 'auto-pick',
            displayName: 'Auto Pick',
          },
        },
      });
    }

    // Auto-pick when timer expires
    if (room.timeRemaining <= 0) {
      clearInterval(room.timer!);

      // Simulate auto-pick
      const autoPick = {
        id: `pick-${Date.now()}`,
        overall: room.currentPick,
        round: Math.ceil(room.currentPick / 12),
        slot: ((room.currentPick - 1) % 12) + 1,
        player: {
          id: `auto-player-${room.currentPick}`,
          name: `Auto Pick ${room.currentPick}`,
          position: 'MID',
          club: 'Auto FC',
        },
        member: {
          id: 'auto-pick',
          displayName: 'Auto Pick',
        },
        auto: true,
        madeAt: new Date().toISOString(),
      };

      room.currentPick++;

      // Broadcast auto-pick
      io.to(`draft-${draftId}`).emit('draft:pick', {
        draftId,
        pick: autoPick,
        currentPick: room.currentPick,
        isComplete: room.currentPick > 264,
      });

      // Start next timer if draft not complete
      if (room.currentPick <= 264) {
        startPickTimer(draftId);
      }
    }
  }, 1000);
}

// Start the server
const PORT = process.env.SOCKET_PORT || 3002;

// Add error handling for server
httpServer.on('error', (error) => {
  console.error('❌ Server error:', error);
  process.exit(1);
});

// Periodic demo updates for dashboard modules
const demoInterval = setInterval(() => {
  io.emit('leaderboard:update', { timestamp: new Date().toISOString() });
  io.emit('top-picks:update', { timestamp: new Date().toISOString() });
}, 30000);

httpServer.listen(PORT, () => {
  console.log(`🚀 Socket.IO server running on port ${PORT}`);
  console.log(`📡 WebSocket endpoint: ws://localhost:${PORT}`);
  console.log(
    `🌐 CORS enabled for: http://localhost:3000, http://localhost:3001, http://localhost:3002, http://localhost:3003`
  );
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  clearInterval(demoInterval);
  httpServer.close(() => {
    console.log('Process terminated');
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  clearInterval(demoInterval);
  httpServer.close(() => {
    console.log('Process terminated');
  });
});

// Add uncaught exception handlers for debugging
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  console.error(error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});
