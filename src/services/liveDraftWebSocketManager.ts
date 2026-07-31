/**
 * Live Draft WebSocket Manager
 * Integrates Live Draft Engine with Socket.IO for real-time communication
 */

import type { Server as SocketIOServer, Socket } from 'socket.io';
import { getLiveDraftEngine, type LiveDraftState, type LiveDraftPick } from './liveDraftEngine';
import { logger } from '@/lib/logger';
import { draftPubSub, type DraftRealtimeEventType } from '@/services/realtime/pubsub';

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

    // Start cross-instance subscriber to rebroadcast incoming events
    void draftPubSub.start((msg) => {
      try {
        // Only handle events for which we have rooms (cheap filter)
        if (!this.draftRooms.has(msg.draftId)) return;
        this.io
          .of('/draft')
          .to(`draft:${msg.draftId}`)
          .emit(msg.event, msg.payload as Record<string, unknown>);
      } catch (e) {
        logger.warn('Failed to rebroadcast pubsub event', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    });

    logger.info('Live Draft WebSocket Manager initialized');
  }

  private setupDraftNamespace(): void {
    // Create dedicated namespace for draft communications
    const draftNamespace = this.io.of('/draft');

    draftNamespace.use((socket, next) => {
      void this.authenticateSocket(socket as Socket & { data: DraftSocketData }, next);
    });
    draftNamespace.on('connection', this.handleConnection.bind(this));

    logger.info('Draft namespace configured');
  }

  private async authenticateSocket(
    socket: Socket & { data: DraftSocketData },
    next: (error?: Error) => void
  ): Promise<void> {
    try {
      const { token: _token, userId, draftId } = socket.handshake.auth;

      // Implement your authentication logic here
      // For now, we'll do basic validation
      if (!userId || !draftId) {
        return next(new Error('Missing authentication data'));
      }

      // Verify user has access to this draft
      const draft = await getLiveDraftEngine().getDraft(draftId);
      if (!draft) {
        return next(new Error('Draft not found'));
      }

      const hasAccess = draft.participants.some((p) => p.userId === userId);
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
      await getLiveDraftEngine().updateParticipantStatus(draftId, userId, true);
    } catch (error) {
      logger.error('Failed to update participant status', { draftId, userId, error });
    }

    // Send current draft state
    const draft = await getLiveDraftEngine().getDraft(draftId);
    if (draft) {
      socket.emit('draft:state', this.formatDraftState(draft));
    }
  }

  private setupSocketHandlers(socket: Socket & { data: DraftSocketData }): void {
    // Mutating draft state must go through the Prisma-backed REST APIs for atomicity.
    socket.on('draft:make-pick', () => {
      if (!this.checkRateLimit(socket.id)) {
        socket.emit('error', { message: 'Rate limit exceeded' });
        return;
      }

      this.rejectDirectMutation(socket, 'draft:make-pick', 'draft:pick-error');
    });

    socket.on('draft:update-queue', () => {
      if (!this.checkRateLimit(socket.id)) {
        socket.emit('error', { message: 'Rate limit exceeded' });
        return;
      }

      this.rejectDirectMutation(socket, 'draft:update-queue', 'draft:queue-error');
    });

    socket.on('draft:pause', () => {
      if (!this.checkRateLimit(socket.id)) {
        socket.emit('error', { message: 'Rate limit exceeded' });
        return;
      }

      this.rejectDirectMutation(socket, 'draft:pause', 'draft:pause-error');
    });

    socket.on('draft:resume', () => {
      if (!this.checkRateLimit(socket.id)) {
        socket.emit('error', { message: 'Rate limit exceeded' });
        return;
      }

      this.rejectDirectMutation(socket, 'draft:resume', 'draft:resume-error');
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

  private rejectDirectMutation(
    socket: Socket & { data: DraftSocketData },
    action: string,
    errorEvent: string
  ): void {
    logger.warn('Rejected direct socket draft mutation', {
      socketId: socket.id,
      draftId: socket.data.draftId,
      userId: socket.data.userId,
      action,
    });

    socket.emit(errorEvent, {
      message: 'Draft mutations must use the Prisma-backed draft API.',
    });
  }

  private async joinDraftRoom(socket: Socket, draftId: string, userId: string): Promise<void> {
    const roomId = `draft:${draftId}`;

    // Join socket.io room
    await socket.join(roomId);

    // Update room tracking
    let room = this.draftRooms.get(draftId);
    if (!room) {
      const newRoom: DraftRoom = {
        draftId,
        leagueId: '', // Will be set when we get draft data
        participants: new Set(),
        userSockets: new Map(),
        lastActivity: new Date(),
        messageCount: 0,
      };
      room = newRoom;
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
      timestamp: new Date().toISOString(),
    });

    logger.debug('Socket joined draft room', {
      socketId: socket.id,
      draftId,
      userId,
      roomSize: room.participants.size,
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
            await getLiveDraftEngine().updateParticipantStatus(draftId, userId, false);
          } catch (error) {
            logger.error('Failed to update participant status on disconnect', {
              draftId,
              userId,
              error,
            });
          }

          // Notify room of participant leaving
          socket.to(`draft:${draftId}`).emit('draft:participant-left', {
            userId,
            timestamp: new Date().toISOString(),
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
    getLiveDraftEngine().on('draft:updated', (draft: LiveDraftState) => {
      const payload = this.formatDraftState(draft);
      this.broadcastToDraft(draft.draftId, 'draft:state', payload);
      void this.publishWithRetry(draft.draftId, 'draft:state', payload, {
        retries: 3,
        baseDelayMs: 100,
      });
    });

    // Timer updates (high-frequency) - log errors but do not retry
    getLiveDraftEngine().on('draft:timer-tick', (draftId: string, timeRemaining: number) => {
      const payload = { timeRemaining };
      this.broadcastToDraft(draftId, 'draft:timer-tick', payload);
      this.publishFireAndForget(draftId, 'draft:timer-tick', payload);
    });

    // Timer expired (state change) - retry
    getLiveDraftEngine().on('draft:timer-expired', (draftId: string) => {
      const payload = { timestamp: new Date().toISOString() };
      this.broadcastToDraft(draftId, 'draft:timer-expired', payload);
      void this.publishWithRetry(draftId, 'draft:timer-expired', payload, {
        retries: 3,
        baseDelayMs: 100,
      });
    });

    // Pick made (critical state change) - retry
    getLiveDraftEngine().on('draft:pick-made', (draftId: string, pick: LiveDraftPick) => {
      const payload = this.formatPick(pick);
      this.broadcastToDraft(draftId, 'draft:pick-made', payload);
      void this.publishWithRetry(draftId, 'draft:pick-made', payload, {
        retries: 3,
        baseDelayMs: 100,
      });
    });

    // Auto pick (critical state change) - retry
    getLiveDraftEngine().on('draft:auto-pick', (draftId: string, pick: LiveDraftPick) => {
      const payload = this.formatPick(pick);
      this.broadcastToDraft(draftId, 'draft:auto-pick', payload);
      void this.publishWithRetry(draftId, 'draft:auto-pick', payload, {
        retries: 3,
        baseDelayMs: 100,
      });
    });

    // Draft paused/resumed/completed (state changes) - retry
    getLiveDraftEngine().on('draft:paused', (draftId: string) => {
      const payload = { timestamp: new Date().toISOString() };
      this.broadcastToDraft(draftId, 'draft:paused', payload);
      void this.publishWithRetry(draftId, 'draft:paused', payload, {
        retries: 3,
        baseDelayMs: 100,
      });
    });

    getLiveDraftEngine().on('draft:resumed', (draftId: string) => {
      const payload = { timestamp: new Date().toISOString() };
      this.broadcastToDraft(draftId, 'draft:resumed', payload);
      void this.publishWithRetry(draftId, 'draft:resumed', payload, {
        retries: 3,
        baseDelayMs: 100,
      });
    });

    getLiveDraftEngine().on('draft:completed', (draftId: string) => {
      const payload = { timestamp: new Date().toISOString() };
      this.broadcastToDraft(draftId, 'draft:completed', payload);
      void this.publishWithRetry(draftId, 'draft:completed', payload, {
        retries: 3,
        baseDelayMs: 100,
      });
    });

    logger.info('Draft engine event listeners configured');
  }

  private broadcastToDraft(draftId: string, event: string, data: Record<string, unknown>): void {
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
        timeRemaining: Math.max(
          0,
          Math.floor((draft.currentPick.expiresAt.getTime() - Date.now()) / 1000)
        ),
      },
      picks: draft.picks.map((pick) => ({
        playerId: pick.playerId,
        userId: pick.userId,
        pickNumber: pick.pickNumber,
        round: pick.round,
        slot: pick.slot,
        auto: pick.auto,
        timestamp: pick.timestamp.toISOString(),
      })),
      participants: draft.participants.map((p) => ({
        userId: p.userId,
        displayName: p.displayName,
        draftOrder: p.draftOrder,
        isOnline: p.isOnline,
      })),
      settings: draft.draftSettings,
      timerSettings: draft.timerSettings,
      paused: draft.paused,
      totalPicks: draft.draftSettings.totalRounds * draft.draftSettings.totalTeams,
      picksRemaining:
        draft.draftSettings.totalRounds * draft.draftSettings.totalTeams - draft.picks.length,
      updatedAt: draft.updatedAt.toISOString(),
    };
  }

  private formatPick(pick: LiveDraftPick) {
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
    setInterval(
      () => {
        logger.info('Draft WebSocket metrics', {
          ...this.metrics,
          activeRooms: this.draftRooms.size,
          totalConnections: this.metrics.totalConnections,
        });
      },
      5 * 60 * 1000
    );
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
    logger.info('Force disconnected all sockets for draft', {
      draftId,
      socketCount: sockets.length,
    });
  }

  /**
   * Broadcast admin message to draft room
   */
  broadcastAdminMessage(draftId: string, message: string): void {
    this.broadcastToDraft(draftId, 'draft:admin-message', {
      message,
      timestamp: new Date().toISOString(),
    });
  }

  private async publishWithRetry(
    draftId: string,
    event: DraftRealtimeEventType,
    payload: unknown,
    opts: { retries?: number; baseDelayMs?: number } = {}
  ): Promise<void> {
    const retries = opts.retries ?? 3;
    const baseDelay = opts.baseDelayMs ?? 100;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        await draftPubSub.publish(draftId, event, payload);
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt === retries) {
          logger.error('PubSub publish failed after retries', {
            draftId,
            event,
            attempt,
            error: msg,
          });
          return; // swallow to avoid crashing caller
        }
        const backoff = Math.min(2000, baseDelay * 2 ** attempt);
        logger.warn('PubSub publish failed, retrying', {
          draftId,
          event,
          attempt,
          backoff,
          error: msg,
        });
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }

  private publishFireAndForget(
    draftId: string,
    event: DraftRealtimeEventType,
    payload: unknown
  ): void {
    draftPubSub.publish(draftId, event, payload).catch((err) => {
      logger.warn('PubSub publish error (fire-and-forget)', {
        draftId,
        event,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
}

export default LiveDraftWebSocketManager;
