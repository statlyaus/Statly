#!/usr/bin/env node

import { createServer } from 'http';
import { Server } from 'socket.io';

// In-memory store for draft rooms (use Redis/database in production)
const draftRooms = new Map();

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
      // Add Codespaces URLs
      /https:\/\/.*\.github\.dev/,
      /https:\/\/.*\.app\.github\.dev/
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: false,
    allowedHeaders: ['Content-Type', 'Authorization']
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true
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
  
  socket.on('join:draft', (data) => {
    const { draftId } = data;
    console.log(`👤 User ${socket.id} joining draft: ${draftId}`);
    
    socket.join(draftId);
    
    // Initialize or update draft room
    if (!draftRooms.has(draftId)) {
      draftRooms.set(draftId, {
        id: draftId,
        participants: new Set(),
        currentPick: 1,
        timeRemaining: 120,
        lastActivity: new Date()
      });
      console.log(`🏗️ Created new draft room: ${draftId}`);
    }
    
    const room = draftRooms.get(draftId);
    room.participants.add(socket.id);
    room.lastActivity = new Date();
    
    // Send current room state
    socket.emit('draft:state', {
      draftId,
      participants: Array.from(room.participants),
      currentPick: room.currentPick,
      timeRemaining: room.timeRemaining
    });
    
    // Notify others in the room
    socket.to(draftId).emit('user:joined', {
      userId: socket.id,
      participantsCount: room.participants.size
    });
    
    console.log(`📊 Draft ${draftId} now has ${room.participants.size} participants`);
  });
  
  socket.on('leave:draft', (data) => {
    const { draftId } = data;
    console.log(`👋 User ${socket.id} leaving draft: ${draftId}`);
    
    socket.leave(draftId);
    
    if (draftRooms.has(draftId)) {
      const room = draftRooms.get(draftId);
      room.participants.delete(socket.id);
      room.lastActivity = new Date();
      
      // Notify others in the room
      socket.to(draftId).emit('user:left', {
        userId: socket.id,
        participantsCount: room.participants.size
      });
      
      console.log(`📊 Draft ${draftId} now has ${room.participants.size} participants`);
      
      // Clean up empty rooms
      if (room.participants.size === 0) {
        if (room.timer) {
          clearInterval(room.timer);
        }
        draftRooms.delete(draftId);
        console.log(`🗑️ Cleaned up empty draft room: ${draftId}`);
      }
    }
  });
  
  socket.on('draft:make-pick', (data) => {
    const { draftId, playerId, memberId } = data;
    console.log(`🎯 Pick made in draft ${draftId}: Player ${playerId} by ${memberId}`);
    
    if (draftRooms.has(draftId)) {
      const room = draftRooms.get(draftId);
      room.currentPick++;
      room.timeRemaining = 120; // Reset timer
      room.lastActivity = new Date();
      
      // Broadcast pick to all participants
      io.to(draftId).emit('draft:pick-made', {
        draftId,
        playerId,
        memberId,
        pickNumber: room.currentPick - 1,
        nextPick: room.currentPick,
        timeRemaining: room.timeRemaining,
        timestamp: new Date().toISOString()
      });
      
      console.log(`📈 Draft ${draftId} advanced to pick ${room.currentPick}`);
    }
  });
  
  socket.on('draft:update-timer', (data) => {
    const { draftId, timeRemaining } = data;
    
    if (draftRooms.has(draftId)) {
      const room = draftRooms.get(draftId);
      room.timeRemaining = timeRemaining;
      room.lastActivity = new Date();
      
      // Broadcast timer update
      socket.to(draftId).emit('draft:timer-update', {
        draftId,
        timeRemaining
      });
    }
  });
  
  socket.on('disconnect', () => {
    console.log('❌ User disconnected:', socket.id);
    console.log('🔗 Active connections:', io.engine.clientsCount);
    
    // Clean up user from all draft rooms
    for (const [draftId, room] of draftRooms.entries()) {
      if (room.participants.has(socket.id)) {
        room.participants.delete(socket.id);
        room.lastActivity = new Date();
        
        // Notify others in the room
        socket.to(draftId).emit('user:left', {
          userId: socket.id,
          participantsCount: room.participants.size
        });
        
        console.log(`📊 Draft ${draftId} now has ${room.participants.size} participants after disconnect`);
        
        // Clean up empty rooms
        if (room.participants.size === 0) {
          if (room.timer) {
            clearInterval(room.timer);
          }
          draftRooms.delete(draftId);
          console.log(`🗑️ Cleaned up empty draft room after disconnect: ${draftId}`);
        }
      }
    }
  });
});

// Start the server
const PORT = 3002;
httpServer.listen(PORT, () => {
  console.log(`🚀 Socket.IO server running on port ${PORT}`);
  console.log(`📡 CORS enabled for localhost:3000-3003 and Codespaces`);
  console.log(`🔌 Transports: websocket, polling`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  httpServer.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

// Health check endpoint
httpServer.on('request', (req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      uptime: process.uptime(),
      activeConnections: io.engine.clientsCount,
      activeRooms: draftRooms.size,
      timestamp: new Date().toISOString()
    }));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});
