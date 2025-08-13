import { NextRequest } from 'next/server';
import { Server as ServerIO } from 'socket.io';
import { createServer } from 'http';

interface DraftRoom {
  id: string;
  participants: Set<string>;
  currentPick: number;
  timer?: NodeJS.Timeout;
  timeRemaining: number;
}

// In-memory store for draft rooms (use Redis/database in production)
const draftRooms = new Map<string, DraftRoom>();

// Global Socket.IO server instance
let io: ServerIO | null = null;

function initializeSocketIO() {
  if (io) return io;

  // Create HTTP server for Socket.IO
  const httpServer = createServer();
  
  console.log('🔌 Initializing Socket.IO server...');
  
  io = new ServerIO(httpServer, {
    path: '/api/socketio',
    cors: {
      origin: [
        'http://localhost:3000',
        'http://localhost:3001', 
        'http://127.0.0.1:3000',
        /https:\/\/.*\.github\.dev/,
        /https:\/\/.*\.app\.github\.dev/
      ],
      methods: ['GET', 'POST'],
      credentials: false
    },
    transports: ['polling', 'websocket'],
    allowEIO3: true
  });

  // Handle draft connections
  io.on('connection', (socket) => {
    console.log('✅ Client connected:', socket.id);

    // Test handler
    socket.on('test', (data) => {
      console.log('📨 Test message received:', data);
      socket.emit('test-response', { message: 'Hello from server!', timestamp: new Date().toISOString() });
    });

    // Join draft room
    socket.on('join:draft', ({ draftId }) => {
      console.log(`👤 Client ${socket.id} joining draft ${draftId}`);
      socket.join(`draft-${draftId}`);
      
      // Initialize draft room if it doesn't exist
      if (!draftRooms.has(draftId)) {
        draftRooms.set(draftId, {
          id: draftId,
          participants: new Set(),
          currentPick: 1,
          timeRemaining: 120
        });
        console.log(`🏗️ Created new draft room: ${draftId}`);
      }

      const room = draftRooms.get(draftId)!;
      room.participants.add(socket.id);

      // Broadcast participant join
      socket.to(`draft-${draftId}`).emit('participant:join', {
        socketId: socket.id,
        timestamp: new Date().toISOString()
      });

      // Send current draft state to new participant
      socket.emit('draft:update', {
        draftId,
        currentPick: room.currentPick,
        totalPicks: 264, // 12 teams * 22 rounds
        round: Math.ceil(room.currentPick / 12),
        direction: Math.ceil(room.currentPick / 12) % 2 === 1 ? 'FORWARD' : 'REVERSE',
        status: 'LIVE',
        picks: [],
        participants: Array.from(room.participants)
      });

      console.log(`📊 Draft ${draftId} now has ${room.participants.size} participants`);
      startPickTimer(draftId);
    });

    // Leave draft room
    socket.on('leave:draft', ({ draftId }) => {
      console.log(`👋 Client ${socket.id} leaving draft ${draftId}`);
      socket.leave(`draft-${draftId}`);
      
      const room = draftRooms.get(draftId);
      if (room) {
        room.participants.delete(socket.id);
        socket.to(`draft-${draftId}`).emit('participant:leave', socket.id);
        console.log(`📊 Draft ${draftId} now has ${room.participants.size} participants`);
      }
    });

    // Handle pick submission
    socket.on('draft:make-pick', ({ draftId, playerId, memberId, timestamp }) => {
      console.log(`🎯 Pick made in draft ${draftId}: Player ${playerId} by ${memberId}`);
      
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
          club: 'Demo FC'
        },
        member: {
          id: memberId,
          displayName: `User ${memberId}`
        },
        auto: false,
        madeAt: timestamp
      };

      // Advance pick
      room.currentPick++;
      room.timeRemaining = 120; // Reset timer

      // Broadcast pick to all participants
      io!.to(`draft-${draftId}`).emit('draft:pick', {
        draftId,
        pick,
        currentPick: room.currentPick,
        isComplete: room.currentPick > 264
      });

      // Restart timer for next pick
      if (room.currentPick <= 264) {
        startPickTimer(draftId);
      }
    });

    // Handle queue updates
    socket.on('draft:update-queue', ({ draftId, memberId, queue }) => {
      console.log(`📝 Queue updated in draft ${draftId} by ${memberId}`);
      
      // Broadcast queue update
      socket.to(`draft-${draftId}`).emit('draft:queue', {
        draftId,
        memberId,
        queue,
        timestamp: new Date().toISOString()
      });
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      console.log('❌ Client disconnected:', socket.id);
      
      // Remove from all draft rooms
      draftRooms.forEach((room, draftId) => {
        if (room.participants.has(socket.id)) {
          room.participants.delete(socket.id);
          socket.to(`draft-${draftId}`).emit('participant:leave', socket.id);
          console.log(`📊 Draft ${draftId} now has ${room.participants.size} participants after disconnect`);
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
        io!.to(`draft-${draftId}`).emit('draft:timer', {
          draftId,
          timeRemaining: room.timeRemaining,
          currentTurn: {
            round: Math.ceil(room.currentPick / 12),
            slot: ((room.currentPick - 1) % 12) + 1,
            member: {
              id: 'auto-pick',
              displayName: 'Auto Pick'
            }
          }
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
            club: 'Auto FC'
          },
          member: {
            id: 'auto-pick',
            displayName: 'Auto Pick'
          },
          auto: true,
          madeAt: new Date().toISOString()
        };

        room.currentPick++;

        // Broadcast auto-pick
        io!.to(`draft-${draftId}`).emit('draft:pick', {
          draftId,
          pick: autoPick,
          currentPick: room.currentPick,
          isComplete: room.currentPick > 264
        });

        // Start next timer if draft not complete
        if (room.currentPick <= 264) {
          startPickTimer(draftId);
        }
      }
    }, 1000);
  }

  return io;
}

export async function GET(request: NextRequest) {
  try {
    // Initialize Socket.IO if not already done
    const socketIO = initializeSocketIO();
    
    const { searchParams } = new URL(request.url);
    const transport = searchParams.get('transport');
    
    console.log(`🔄 Socket.IO GET request - Transport: ${transport}`);
    
    // Handle Socket.IO polling requests
    if (transport === 'polling') {
      // This is a Socket.IO polling request
      // In a real implementation, you'd handle the polling protocol here
      // For now, return a simple response to avoid 404
      return new Response('Socket.IO polling endpoint', {
        status: 200,
        headers: {
          'Content-Type': 'text/plain',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    }

    // Health check endpoint
    return new Response(
      JSON.stringify({
        status: 'Socket.IO server running',
        timestamp: new Date().toISOString(),
        rooms: draftRooms.size,
        connections: socketIO?.engine?.clientsCount || 0
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Socket.IO GET error:', error);
    return new Response('Socket.IO error', { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Initialize Socket.IO if not already done
    initializeSocketIO();
    
    console.log('🔄 Socket.IO POST request');
    
    // Handle Socket.IO polling POST requests
    return new Response('Socket.IO POST handled', {
      status: 200,
      headers: {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  } catch (error) {
    console.error('Socket.IO POST error:', error);
    return new Response('Socket.IO error', { status: 500 });
  }
}
