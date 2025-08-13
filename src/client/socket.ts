import { io, type Socket } from 'socket.io-client';

interface DraftPlayer {
  id: string;
  name: string;
  position: string;
  club: string;
}

interface DraftPick {
  id: string;
  overall: number;
  round: number;
  slot: number;
  player: DraftPlayer;
  member: {
    id: string;
    displayName: string;
  };
  auto: boolean;
  madeAt: string;
}

interface DraftParticipant {
  slot: number;
  member: {
    id: string;
    userId: string;
    displayName: string;
    email: string;
  };
}

interface DraftUpdate {
  draftId: string;
  currentPick: number;
  totalPicks: number;
  round: number;
  direction: string;
  status: string;
  picks: DraftPick[];
  participants: DraftParticipant[];
  completedAt?: string;
}

interface PickMadeEvent {
  draftId: string;
  pick: DraftPick;
  currentPick: number;
  isComplete: boolean;
  nextTurn?: {
    round: number;
    slot: number;
    member: {
      id: string;
      displayName: string;
    };
  };
}

interface TimerUpdate {
  draftId: string;
  timeRemaining: number;
  currentTurn: {
    round: number;
    slot: number;
    member: {
      id: string;
      displayName: string;
    };
  };
}

interface DraftStatusChange {
  draftId: string;
  status: 'ACTIVE' | 'LIVE' | 'PAUSED' | 'COMPLETED';
  timestamp: string;
}

interface QueueUpdate {
  draftId: string;
  memberId: string;
  queue: Array<{
    playerId: string;
    playerName: string;
    rank: number;
  }>;
}

interface ConnectionStatus {
  connected: boolean;
  reconnecting: boolean;
  lastHeartbeat?: string;
}

interface DraftSocketHandlers {
  onDraftUpdate?: (data: DraftUpdate) => void;
  onPickMade?: (data: PickMadeEvent) => void;
  onTimerUpdate?: (data: TimerUpdate) => void;
  onStatusChange?: (data: DraftStatusChange) => void;
  onQueueUpdate?: (data: QueueUpdate) => void;
  onParticipantJoin?: (data: { socketId: string; timestamp: string }) => void;
  onParticipantLeave?: (participantId: string) => void;
  onConnectionChange?: (status: ConnectionStatus) => void;
  onError?: (error: Error) => void;
}

export function joinDraft(
  draftId: string,
  handlers: DraftSocketHandlers = {}
): { socket: Socket; cleanup: () => void } {
  // Connect directly to Socket.IO server on port 3002
  console.log('🔌 Attempting to connect to Socket.IO server at http://localhost:3002');
  console.log('🎯 Draft ID:', draftId);
  console.log('📋 Handlers provided:', Object.keys(handlers));
  
  const socket = io('http://localhost:3002', {
    transports: ['websocket', 'polling'], // Try websocket first, then polling
    timeout: 20000,
    retries: 3,
    autoConnect: true,
    forceNew: false,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    upgrade: true,
    withCredentials: false // Disable credentials for now
  });

  console.log('💫 Socket instance created, connecting...');

  const {
    onDraftUpdate,
    onPickMade,
    onTimerUpdate,
    onStatusChange,
    onQueueUpdate,
    onParticipantJoin,
    onParticipantLeave,
    onConnectionChange,
    onError
  } = handlers;

  // Core draft events
  if (onDraftUpdate) socket.on("draft:update", onDraftUpdate);
  if (onPickMade) socket.on("draft:pick", onPickMade);
  if (onTimerUpdate) socket.on("draft:timer", onTimerUpdate);
  if (onStatusChange) socket.on("draft:status", onStatusChange);
  if (onQueueUpdate) socket.on("draft:queue", onQueueUpdate);
  
  // Participant events
  if (onParticipantJoin) socket.on("participant:join", onParticipantJoin);
  if (onParticipantLeave) socket.on("participant:leave", onParticipantLeave);
  
  // Connection events
  socket.on('connect', () => {
    console.log(`✅ Connected to draft ${draftId}`);
    onConnectionChange?.({ connected: true, reconnecting: false });
  });
  
  socket.on('disconnect', (reason) => {
    console.log(`❌ Disconnected from draft ${draftId}:`, reason);
    onConnectionChange?.({ connected: false, reconnecting: false });
  });
  
  socket.on('reconnect', () => {
    console.log(`🔄 Reconnected to draft ${draftId}`);
    onConnectionChange?.({ connected: true, reconnecting: false });
  });
  
  socket.on('reconnecting', () => {
    console.log(`🔄 Reconnecting to draft ${draftId}...`);
    onConnectionChange?.({ connected: false, reconnecting: true });
  });
  
  // Error handling
  socket.on('error', (error) => {
    console.error(`❌ Socket error for draft ${draftId}:`, error);
    onError?.(error);
  });
  
  socket.on('connect_error', (error) => {
    console.error(`❌ Connection error for draft ${draftId}:`, error);
    onError?.(error);
  });

  // Join the draft room
  socket.emit('join:draft', { draftId });

  const cleanup = () => {
    socket.emit('leave:draft', { draftId });
    socket.removeAllListeners();
    socket.disconnect();
  };

  return { socket, cleanup };
}

// Utility function to emit pick events
export function emitPick(socket: Socket, draftId: string, playerId: string, memberId: string) {
  socket.emit('draft:make-pick', {
    draftId,
    playerId,
    memberId,
    timestamp: new Date().toISOString()
  });
}

// Utility function to emit queue updates
export function emitQueueUpdate(socket: Socket, draftId: string, memberId: string, queue: Array<{ playerId: string; rank: number }>) {
  socket.emit('draft:update-queue', {
    draftId,
    memberId,
    queue,
    timestamp: new Date().toISOString()
  });
}