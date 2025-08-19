/**
 * Live Draft WebSocket Manager
 * Integrates Live Draft Engine with Socket.IO for real-time communication
 */

import { Server as SocketIOServer, Socket } from 'socket.io';
import { liveDraftEngine, LiveDraftState } from './liveDraftEngine';
import { logger } from '@/lib/logger';
import type { DraftPick } from './draftPersistence';

export interface DraftRoom {
  draftId: string;
  leagueId: string;
  participants: Set<string>; // Socket IDs
  userSockets: Map<string, Set<string>>; // userId -> Set of socket IDs
  lastActivity: Date;
  messageCount: number;
}

export interface DraftSocketData {
  userId?: string;
  draftId?: string;
  isAuthenticated: boolean;
}

export class LiveDraftWebSocketManager {
  private io: SocketIOServer;
  private draftRooms = new Map<string, DraftRoom>();
  private socketToDraft = new Map<string, string>(); // socketId -> draftId
  private socketToUser = new Map<string, string>(); // socketId -> userId
  
  // Rate limiting
  private messageRateLimits = new Map<string, { count: number; resetTime: number }>();
  private readonly MAX_MESSAGES_PER_MINUTE = 60;

  // Connection metrics
  private metrics = {
    totalConnections: 0,
    activeRooms: 0,
    messagesPerSecond: 0,
    lastMetricsUpdate: Date.now(),
  };

  constructor(io: SocketIOServer) {
    this.io = io;
    this.setupDraftNamespace();
    this.setupEngineEventListeners();
    this.initializeMetricsTracking();
    
    logger.info('Live Draft WebSocket Manager initialized');
  }

  private setupDraftNamespace(): void {
    // Create dedicated namespace for draft communications
    const draftNamespace = this.io.of('/draft');

    draftNamespace.use(this.authenticateSocket.bind(this));
    draftNamespace.on('connection', this.handleConnection.bind(this));

    logger.info('Draft namespace configured');
  }

  private async authenticateSocket(socket: Socket & { data: DraftSocketData }, next: Function): Promise<void> {
    try {
      const { token, userId, draftId } = socket.handshake.auth;

      // Implement your authentication logic here
      // For now, we'll do basic validation
      if (!userId || !draftId) {
        return next(new Error('Missing authentication data'));
      }

      // Verify user has access to this draft
      const draft = await liveDraftEngine.getDraft(draftId);
      if (!draft) {
        return next(new Error('Draft not found'));
      }

      const hasAccess = draft.participants.some(p => p.userId === userId);
      if (!hasAccess) {
        return next(new Error('Access denied to draft'));
      }

      // Rate limiting check
      if (!this.checkRateLimit(socket.id)) {
        return next(new Error('Rate limit exceeded'));
      }

      socket.data.userId = userId;
      socket.data.draftId = draftId;
      socket.data.isAuthenticated = true;

      next();
    } catch (error) {
      logger.error('Socket authentication failed', { socketId: socket.id, error });
      next(new Error('Authentication failed'));
    }
  }

  private async handleConnection(socket: Socket & { data: DraftSocketData }): Promise<void> {
    const { userId, draftId } = socket.data;
    
    if (!userId || !draftId) {
      socket.disconnect(true);
      return;
    }

    logger.info('Draft socket connected', { socketId: socket.id, userId, draftId });

    // Track socket mappings
    this.socketToDraft.set(socket.id, draftId);
    this.socketToUser.set(socket.id, userId);
    this.metrics.totalConnections++;

    // Join draft room
    await this.joinDraftRoom(socket, draftId, userId);

    // Set up event handlers
    this.setupSocketHandlers(socket);

    // Update participant status to online
    try {
      await liveDraftEngine.updateParticipantStatus(draftId, userId, true);
    } catch (error) {
      logger.error('Failed to update participant status', { draftId, userId, error });
    }

    // Send current draft state
    const draft = await liveDraftEngine.getDraft(draftId);
    if (draft) {
      socket.emit('draft:state', this.formatDraftState(draft));
    }
  }

  private setupSocketHandlers(socket: Socket & { data: DraftSocketData }): void {
    const { userId, draftId } = socket.data;

    // Make pick
    socket.on('draft:make-pick', async (data: { playerId: string }) => {
      if (!this.checkRateLimit(socket.id)) {
        socket.emit('error', { message: 'Rate limit exceeded' });
        return;
      }

      try {
        const pick = await liveDraftEngine.makePick({
          draftId: draftId!,
          userId: userId!,
          playerId: data.playerId,
        });

        logger.info('Pick made via socket', { 
          socketId: socket.id, 
          draftId, 
          userId, 
          pickNumber: pick.overall 
        });
      } catch (error) {
        logger.error('Pick failed via socket', { socketId: socket.id, draftId, userId, error });
        socket.emit('draft:pick-error', { 
          message: error instanceof Error ? error.message : 'Pick failed' 
        });
      }
    });

    // Update queue
    socket.on('draft:update-queue', async (data: { queue: string[] }) => {
      if (!this.checkRateLimit(socket.id)) {
        socket.emit('error', { message: 'Rate limit exceeded' });
        return;
      }

      try {
        await liveDraftEngine.updateQueue(draftId!, userId!, data.queue);
        logger.debug('Queue updated via socket', { socketId: socket.id, draftId, userId });
      } catch (error) {
        logger.error('Queue update failed via socket', { socketId: socket.id, draftId, userId, error });
        socket.emit('draft:queue-error', { 
          message: error instanceof Error ? error.message : 'Queue update failed' 
        });
      }
    });

    // Pause draft (admin only)
    socket.on('draft:pause', async () => {
      try {
        // Add admin check here
        await liveDraftEngine.pauseDraft(draftId!);
        logger.info('Draft paused via socket', { socketId: socket.id, draftId, userId });
      } catch (error) {
        logger.error('Draft pause failed via socket', { socketId: socket.id, draftId, userId, error });
        socket.emit('draft:pause-error', { 
          message: error instanceof Error ? error.message : 'Pause failed' 
        });
      }
    });

    // Resume draft (admin only)
    socket.on('draft:resume', async () => {
      try {
        // Add admin check here
        await liveDraftEngine.resumeDraft(draftId!);
        logger.info('Draft resumed via socket', { socketId: socket.id, draftId, userId });
      } catch (error) {
        logger.error('Draft resume failed via socket', { socketId: socket.id, draftId, userId, error });
        socket.emit('draft:resume-error', { 
          message: error instanceof Error ? error.message : 'Resume failed' 
        });
      }
    });

    // Heartbeat for connection health
    socket.on('draft:ping', () => {
      socket.emit('draft:pong', { timestamp: Date.now() });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      this.handleDisconnection(socket);
    });
  }

  private async joinDraftRoom(socket: Socket, draftId: string, userId: string): Promise<void> {
    const roomId = `draft:${draftId}`;
    
    // Join socket.io room
    await socket.join(roomId);

    // Update room tracking
    let room = this.draftRooms.get(draftId);
    if (!room) {
      room = {
        draftId,
        leagueId: '', // Will be set when we get draft data
        participants: new Set(),
        userSockets: new Map(),
        lastActivity: new Date(),
        messageCount: 0,
      };
      this.draftRooms.set(draftId, room);
      this.metrics.activeRooms++;
    }

    room.participants.add(socket.id);
    room.lastActivity = new Date();

    // Track user sockets
    if (!room.userSockets.has(userId)) {
      room.userSockets.set(userId, new Set());
    }
    room.userSockets.get(userId)!.add(socket.id);

    // Notify room of new participant
    socket.to(roomId).emit('draft:participant-joined', { 
      userId, 
      timestamp: new Date().toISOString() 
    });

    logger.debug('Socket joined draft room', { 
      socketId: socket.id, 
      draftId, 
      userId, 
      roomSize: room.participants.size 
    });
  }

  private async handleDisconnection(socket: Socket & { data: DraftSocketData }): Promise<void> {
    const { userId, draftId } = socket.data;
    
    logger.info('Draft socket disconnected', { socketId: socket.id, userId, draftId });

    this.metrics.totalConnections--;

    // Clean up tracking
    this.socketToDraft.delete(socket.id);
    this.socketToUser.delete(socket.id);
    this.messageRateLimits.delete(socket.id);

    if (!draftId || !userId) return;

    // Update room tracking
    const room = this.draftRooms.get(draftId);
    if (room) {
      room.participants.delete(socket.id);
      
      const userSockets = room.userSockets.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        
        // If user has no more sockets, mark as offline
        if (userSockets.size === 0) {
          room.userSockets.delete(userId);
          
          try {
            await liveDraftEngine.updateParticipantStatus(draftId, userId, false);
          } catch (error) {
            logger.error('Failed to update participant status on disconnect', { draftId, userId, error });
          }

          // Notify room of participant leaving
          socket.to(`draft:${draftId}`).emit('draft:participant-left', { 
            userId, 
            timestamp: new Date().toISOString() 
          });
        }
      }

      // Clean up empty rooms
      if (room.participants.size === 0) {
        this.draftRooms.delete(draftId);
        this.metrics.activeRooms--;
      }
    }
  }

  private setupEngineEventListeners(): void {
    // Draft state updates
    liveDraftEngine.on('draft:updated', (draft: LiveDraftState) => {
      this.broadcastToDraft(draft.draftId, 'draft:state', this.formatDraftState(draft));
    });

    // Timer updates
    liveDraftEngine.on('draft:timer-tick', (draftId: string, timeRemaining: number) => {
      this.broadcastToDraft(draftId, 'draft:timer-tick', { timeRemaining });
    });

    // Timer expired
    liveDraftEngine.on('draft:timer-expired', (draftId: string) => {
      this.broadcastToDraft(draftId, 'draft:timer-expired', { timestamp: new Date().toISOString() });
    });

    // Pick made
    liveDraftEngine.on('draft:pick-made', (draftId: string, pick: DraftPick) => {
      this.broadcastToDraft(draftId, 'draft:pick-made', this.formatPick(pick));
    });

    // Auto pick
    liveDraftEngine.on('draft:auto-pick', (draftId: string, pick: DraftPick) => {
      this.broadcastToDraft(draftId, 'draft:auto-pick', this.formatPick(pick));
    });

    // Draft paused/resumed
    liveDraftEngine.on('draft:paused', (draftId: string) => {
      this.broadcastToDraft(draftId, 'draft:paused', { timestamp: new Date().toISOString() });
    });

    liveDraftEngine.on('draft:resumed', (draftId: string) => {
      this.broadcastToDraft(draftId, 'draft:resumed', { timestamp: new Date().toISOString() });
    });

    // Draft completed
    liveDraftEngine.on('draft:completed', (draftId: string) => {
      this.broadcastToDraft(draftId, 'draft:completed', { timestamp: new Date().toISOString() });
    });

    // Queue updates
    liveDraftEngine.on('draft:queue-updated', (draftId: string, userId: string, queue: string[]) => {
      this.broadcastToDraft(draftId, 'draft:queue-updated', { userId, queue });
    });

    logger.info('Draft engine event listeners configured');
  }

  private broadcastToDraft(draftId: string, event: string, data: any): void {
    const roomId = `draft:${draftId}`;
    this.io.of('/draft').to(roomId).emit(event, data);

    // Update room metrics
    const room = this.draftRooms.get(draftId);
    if (room) {
      room.messageCount++;
      room.lastActivity = new Date();
    }

    // Update global metrics
    this.metrics.messagesPerSecond++;
  }

  private formatDraftState(draft: LiveDraftState) {
    return {
      draftId: draft.draftId,
      leagueId: draft.leagueId,
      status: draft.status,
      currentPick: {
        userId: draft.currentPick.userId,
        pickNumber: draft.currentPick.pickNumber,
        round: draft.currentPick.round,
        slot: draft.currentPick.slot,
        expiresAt: draft.currentPick.expiresAt.toISOString(),
        timeRemaining: Math.max(0, Math.floor((draft.currentPick.expiresAt.getTime() - Date.now()) / 1000)),
      },
      picks: draft.picks.map(pick => ({
        playerId: pick.playerId,
        userId: pick.userId,
        pickNumber: pick.pickNumber,
        round: pick.round,
        slot: pick.slot,
        auto: pick.auto,
        timestamp: pick.timestamp.toISOString(),
      })),
      participants: draft.participants.map(p => ({
        userId: p.userId,
        displayName: p.displayName,
        draftOrder: p.draftOrder,
        isOnline: p.isOnline,
        queueSize: p.queue.length,
      })),
      settings: draft.draftSettings,
      timerSettings: draft.timerSettings,
      paused: draft.paused,
      totalPicks: draft.draftSettings.totalRounds * draft.draftSettings.totalTeams,
      picksRemaining: (draft.draftSettings.totalRounds * draft.draftSettings.totalTeams) - draft.picks.length,
      updatedAt: draft.updatedAt.toISOString(),
    };
  }

  private formatPick(pick: DraftPick) {
    return {
      id: pick.id,
      overall: pick.overall,
      round: pick.round,
      slot: pick.slot,
      player: pick.player,
      member: pick.member,
      auto: pick.auto,
      madeAt: pick.madeAt,
    };
  }

  private checkRateLimit(socketId: string): boolean {
    const now = Date.now();
    const minute = 60 * 1000;
    
    let limit = this.messageRateLimits.get(socketId);
    if (!limit || now > limit.resetTime) {
      limit = { count: 0, resetTime: now + minute };
      this.messageRateLimits.set(socketId, limit);
    }

    limit.count++;
    return limit.count <= this.MAX_MESSAGES_PER_MINUTE;
  }

  private initializeMetricsTracking(): void {
    // Reset message counter every second for accurate rate calculation
    setInterval(() => {
      this.metrics.messagesPerSecond = 0;
    }, 1000);

    // Log metrics every 5 minutes
    setInterval(() => {
      logger.info('Draft WebSocket metrics', {
        ...this.metrics,
        activeRooms: this.draftRooms.size,
        totalConnections: this.metrics.totalConnections,
      });
    }, 5 * 60 * 1000);
  }

  /**
   * Get current WebSocket metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      activeRooms: this.draftRooms.size,
      roomDetails: Array.from(this.draftRooms.entries()).map(([draftId, room]) => ({
        draftId,
        participants: room.participants.size,
        uniqueUsers: room.userSockets.size,
        messageCount: room.messageCount,
        lastActivity: room.lastActivity,
      })),
    };
  }

  /**
   * Get room information for debugging
   */
  getRoomInfo(draftId: string) {
    const room = this.draftRooms.get(draftId);
    if (!room) return null;

    return {
      draftId: room.draftId,
      participantCount: room.participants.size,
      uniqueUsers: room.userSockets.size,
      userConnections: Array.from(room.userSockets.entries()).map(([userId, sockets]) => ({
        userId,
        socketCount: sockets.size,
      })),
      lastActivity: room.lastActivity,
      messageCount: room.messageCount,
    };
  }

  /**
   * Force disconnect all sockets for a draft (admin function)
   */
  async disconnectDraft(draftId: string): Promise<void> {
    const roomId = `draft:${draftId}`;
    const sockets = await this.io.of('/draft').in(roomId).fetchSockets();
    
    for (const socket of sockets) {
      socket.disconnect(true);
    }

    this.draftRooms.delete(draftId);
    logger.info('Force disconnected all sockets for draft', { draftId, socketCount: sockets.length });
  }

  /**
   * Broadcast admin message to draft room
   */
  broadcastAdminMessage(draftId: string, message: string): void {
    this.broadcastToDraft(draftId, 'draft:admin-message', { 
      message, 
      timestamp: new Date().toISOString() 
    });
  }
}

export default LiveDraftWebSocketManager;
