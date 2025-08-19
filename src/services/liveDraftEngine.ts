/**
 * Live Draft Engine - Scalable Service for Managing Thousands of Concurrent Drafts
 * 
 * Features:
 * - Handles concurrent draft timers for 1000s of leagues
 * - Real-time updates via WebSockets and listeners
 * - Pause/resume, auto-pick, and queue management
 * - Persistent draft state storage
 * - Memory-efficient timer management
 * - Horizontal scaling support
 */

import { EventEmitter } from 'events';
import { Redis } from 'ioredis';
import { logger } from '@/lib/logger';
import { draftPersistence } from './draftPersistence';
import type { DraftPick } from './draftPersistence';

// Enhanced draft state interface matching your requirements
export interface LiveDraftState {
  leagueId: string;
  draftId: string;
  status: 'SCHEDULED' | 'LOBBY' | 'COUNTDOWN' | 'LIVE' | 'PAUSED' | 'COMPLETED';
  currentPick: {
    userId: string;
    memberId: string;
    pickNumber: number;
    round: number;
    slot: number;
    expiresAt: Date;
    startedAt: Date;
  };
  picks: Array<{
    playerId: string;
    userId: string;
    memberId: string;
    pickNumber: number;
    round: number;
    slot: number;
    auto: boolean;
    timestamp: Date;
  }>;
  participants: Array<{
    userId: string;
    memberId: string;
    displayName: string;
    draftOrder: number;
    isOnline: boolean;
    queue: string[];
    autoPickEnabled: boolean;
    lastActivity: Date;
  }>;
  timerSettings: {
    durationSeconds: number;
    autopickAfterExpiry: boolean;
    pausedAt?: Date;
    pausedTimeRemaining?: number;
  };
  draftSettings: {
    totalRounds: number;
    totalTeams: number;
    draftType: 'SNAKE' | 'LINEAR';
    pickTimeLimit: number;
  };
  paused: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastActivity: Date;
}

export interface DraftTimer {
  draftId: string;
  leagueId: string;
  timeRemaining: number;
  totalTime: number;
  startedAt: Date;
  expiresAt: Date;
  interval?: NodeJS.Timer;
  callbacks: Set<(timeRemaining: number) => void>;
  paused: boolean;
  pausedAt?: Date;
  pausedTimeRemaining?: number;
}

export interface DraftEngineEvents {
  'draft:created': (draft: LiveDraftState) => void;
  'draft:updated': (draft: LiveDraftState) => void;
  'draft:timer-tick': (draftId: string, timeRemaining: number) => void;
  'draft:timer-expired': (draftId: string) => void;
  'draft:pick-made': (draftId: string, pick: DraftPick) => void;
  'draft:auto-pick': (draftId: string, pick: DraftPick) => void;
  'draft:paused': (draftId: string) => void;
  'draft:resumed': (draftId: string) => void;
  'draft:completed': (draftId: string) => void;
  'draft:participant-joined': (draftId: string, userId: string) => void;
  'draft:participant-left': (draftId: string, userId: string) => void;
  'draft:queue-updated': (draftId: string, userId: string, queue: string[]) => void;
}

export class LiveDraftEngine extends EventEmitter {
  private activeDrafts = new Map<string, LiveDraftState>();
  private activeTimers = new Map<string, DraftTimer>();
  private redis: Redis;
  private cleanupInterval?: NodeJS.Timer;
  private metricsInterval?: NodeJS.Timer;
  
  // Performance metrics
  private metrics = {
    activeDrafts: 0,
    activeTimers: 0,
    totalPicks: 0,
    totalAutoPicks: 0,
    avgPickTime: 0,
    memoryUsage: 0,
    lastCleanup: new Date(),
  };

  constructor(redisConfig?: any) {
    super();
    this.setMaxListeners(10000); // Support for high concurrency
    
    // Initialize Redis for distributed state management
    this.redis = new Redis(redisConfig || {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    this.initializeCleanupJob();
    this.initializeMetricsCollection();
    
    logger.info('Live Draft Engine initialized', {
      maxListeners: this.getMaxListeners(),
      redisConfig: redisConfig || 'default',
    });
  }

  /**
   * Create a new live draft from league configuration
   */
  async createDraft(params: {
    leagueId: string;
    draftId: string;
    participants: Array<{
      userId: string;
      memberId: string;
      displayName: string;
      draftOrder: number;
    }>;
    settings: {
      totalRounds: number;
      pickTimeLimit: number;
      draftType: 'SNAKE' | 'LINEAR';
      autopickAfterExpiry: boolean;
    };
    scheduledStart?: Date;
  }): Promise<LiveDraftState> {
    const { leagueId, draftId, participants, settings, scheduledStart } = params;

    logger.info('Creating new live draft', { leagueId, draftId, participantCount: participants.length });

    const draft: LiveDraftState = {
      leagueId,
      draftId,
      status: scheduledStart ? 'SCHEDULED' : 'LOBBY',
      currentPick: {
        userId: participants[0].userId,
        memberId: participants[0].memberId,
        pickNumber: 1,
        round: 1,
        slot: 1,
        expiresAt: new Date(Date.now() + settings.pickTimeLimit * 1000),
        startedAt: new Date(),
      },
      picks: [],
      participants: participants.map(p => ({
        ...p,
        isOnline: false,
        queue: [],
        autoPickEnabled: settings.autopickAfterExpiry,
        lastActivity: new Date(),
      })),
      timerSettings: {
        durationSeconds: settings.pickTimeLimit,
        autopickAfterExpiry: settings.autopickAfterExpiry,
      },
      draftSettings: {
        totalRounds: settings.totalRounds,
        totalTeams: participants.length,
        draftType: settings.draftType,
        pickTimeLimit: settings.pickTimeLimit,
      },
      paused: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastActivity: new Date(),
    };

    // Store in memory and Redis
    this.activeDrafts.set(draftId, draft);
    await this.persistDraftState(draft);

    // Initialize in Firestore for real-time listeners
    await draftPersistence.initializeDraftState(draftId, {
      id: draftId,
      leagueId,
      status: 'PENDING',
      participants: participants.map(p => ({
        id: p.memberId,
        userId: p.userId,
        displayName: p.displayName,
        draftOrder: p.draftOrder,
        isOnline: false,
        queue: [],
        lastActivity: new Date(),
      })),
      picks: [],
      currentPick: 1,
      currentRound: 1,
      currentTurn: 0,
      totalPicks: settings.totalRounds * participants.length,
      draftOrder: participants.map(p => p.userId),
      timeRemaining: settings.pickTimeLimit,
      timerActive: false,
      settings: {
        pickTimeLimit: settings.pickTimeLimit,
        autopickEnabled: settings.autopickAfterExpiry,
        draftType: settings.draftType,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    this.metrics.activeDrafts++;
    this.emit('draft:created', draft);

    logger.info('Live draft created successfully', { 
      draftId, 
      leagueId, 
      status: draft.status,
      participantCount: participants.length 
    });

    return draft;
  }

  /**
   * Start a draft and begin the timer for the first pick
   */
  async startDraft(draftId: string): Promise<void> {
    const draft = await this.getDraft(draftId);
    if (!draft) {
      throw new Error(`Draft ${draftId} not found`);
    }

    if (draft.status !== 'LOBBY' && draft.status !== 'SCHEDULED') {
      throw new Error(`Draft ${draftId} is not in a startable state: ${draft.status}`);
    }

    logger.info('Starting draft', { draftId, previousStatus: draft.status });

    // Update draft status
    draft.status = 'LIVE';
    draft.paused = false;
    draft.updatedAt = new Date();
    draft.lastActivity = new Date();

    // Initialize first pick timer
    draft.currentPick.startedAt = new Date();
    draft.currentPick.expiresAt = new Date(Date.now() + draft.timerSettings.durationSeconds * 1000);

    // Store updated state
    this.activeDrafts.set(draftId, draft);
    await this.persistDraftState(draft);

    // Start timer
    await this.startPickTimer(draftId);

    // Update Firestore
    await draftPersistence.updateDraftStatus(draftId, 'LIVE');
    await draftPersistence.updateTimer(draftId, draft.timerSettings.durationSeconds, true);

    this.emit('draft:updated', draft);

    logger.info('Draft started successfully', { draftId, firstPicker: draft.currentPick.userId });
  }

  /**
   * Make a pick in the draft
   */
  async makePick(params: {
    draftId: string;
    userId: string;
    playerId: string;
    auto?: boolean;
  }): Promise<DraftPick> {
    const { draftId, userId, playerId, auto = false } = params;
    const draft = await this.getDraft(draftId);
    
    if (!draft) {
      throw new Error(`Draft ${draftId} not found`);
    }

    if (draft.status !== 'LIVE') {
      throw new Error(`Draft ${draftId} is not live`);
    }

    if (draft.paused) {
      throw new Error(`Draft ${draftId} is paused`);
    }

    if (draft.currentPick.userId !== userId) {
      throw new Error(`It's not ${userId}'s turn to pick`);
    }

    logger.info('Processing pick', { draftId, userId, playerId, auto, pickNumber: draft.currentPick.pickNumber });

    // Stop current timer
    await this.stopPickTimer(draftId);

    // Create pick record
    const pick: DraftPick = {
      id: `pick-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      overall: draft.currentPick.pickNumber,
      round: draft.currentPick.round,
      slot: draft.currentPick.slot,
      player: {
        id: playerId,
        name: `Player ${playerId}`, // This should come from your player service
        position: 'MID',
        club: 'TBD',
      },
      member: {
        id: draft.currentPick.memberId,
        displayName: draft.participants.find(p => p.userId === userId)?.displayName || 'Unknown',
      },
      auto,
      madeAt: new Date().toISOString(),
      timestamp: new Date(),
    };

    // Add pick to draft
    draft.picks.push({
      playerId,
      userId,
      memberId: draft.currentPick.memberId,
      pickNumber: draft.currentPick.pickNumber,
      round: draft.currentPick.round,
      slot: draft.currentPick.slot,
      auto,
      timestamp: new Date(),
    });

    // Calculate next pick
    const nextPickInfo = this.calculateNextPick(draft);
    
    if (nextPickInfo) {
      draft.currentPick = {
        userId: nextPickInfo.userId,
        memberId: nextPickInfo.memberId,
        pickNumber: nextPickInfo.pickNumber,
        round: nextPickInfo.round,
        slot: nextPickInfo.slot,
        expiresAt: new Date(Date.now() + draft.timerSettings.durationSeconds * 1000),
        startedAt: new Date(),
      };

      // Start timer for next pick
      await this.startPickTimer(draftId);
    } else {
      // Draft is complete
      draft.status = 'COMPLETED';
      this.emit('draft:completed', draftId);
    }

    draft.updatedAt = new Date();
    draft.lastActivity = new Date();

    // Update metrics
    this.metrics.totalPicks++;
    if (auto) this.metrics.totalAutoPicks++;

    // Store updated state
    this.activeDrafts.set(draftId, draft);
    await this.persistDraftState(draft);

    // Save pick to Firestore
    await draftPersistence.savePick(draftId, pick);

    // Emit events
    if (auto) {
      this.emit('draft:auto-pick', draftId, pick);
    } else {
      this.emit('draft:pick-made', draftId, pick);
    }
    this.emit('draft:updated', draft);

    logger.info('Pick processed successfully', { 
      draftId, 
      userId, 
      playerId, 
      pickNumber: pick.overall,
      auto,
      draftComplete: draft.status === 'COMPLETED'
    });

    return pick;
  }

  /**
   * Pause a draft
   */
  async pauseDraft(draftId: string): Promise<void> {
    const draft = await this.getDraft(draftId);
    if (!draft) {
      throw new Error(`Draft ${draftId} not found`);
    }

    if (draft.status !== 'LIVE') {
      throw new Error(`Draft ${draftId} is not live`);
    }

    logger.info('Pausing draft', { draftId });

    // Pause timer
    const timer = this.activeTimers.get(draftId);
    if (timer && !timer.paused) {
      timer.paused = true;
      timer.pausedAt = new Date();
      timer.pausedTimeRemaining = timer.timeRemaining;
      
      if (timer.interval) {
        clearInterval(timer.interval);
        timer.interval = undefined;
      }
    }

    // Update draft state
    draft.paused = true;
    draft.timerSettings.pausedAt = new Date();
    if (timer) {
      draft.timerSettings.pausedTimeRemaining = timer.timeRemaining;
    }
    draft.updatedAt = new Date();

    this.activeDrafts.set(draftId, draft);
    await this.persistDraftState(draft);

    // Update Firestore
    await draftPersistence.updateTimer(draftId, timer?.timeRemaining || 0, false);

    this.emit('draft:paused', draftId);

    logger.info('Draft paused successfully', { draftId });
  }

  /**
   * Resume a paused draft
   */
  async resumeDraft(draftId: string): Promise<void> {
    const draft = await this.getDraft(draftId);
    if (!draft) {
      throw new Error(`Draft ${draftId} not found`);
    }

    if (!draft.paused) {
      throw new Error(`Draft ${draftId} is not paused`);
    }

    logger.info('Resuming draft', { draftId });

    // Resume timer
    const timer = this.activeTimers.get(draftId);
    if (timer && timer.paused && timer.pausedTimeRemaining !== undefined) {
      timer.paused = false;
      timer.timeRemaining = timer.pausedTimeRemaining;
      timer.startedAt = new Date();
      timer.expiresAt = new Date(Date.now() + timer.timeRemaining * 1000);
      delete timer.pausedAt;
      delete timer.pausedTimeRemaining;

      this.startTimerInterval(timer);
    }

    // Update draft state
    draft.paused = false;
    delete draft.timerSettings.pausedAt;
    delete draft.timerSettings.pausedTimeRemaining;
    draft.currentPick.startedAt = new Date();
    draft.currentPick.expiresAt = new Date(Date.now() + (timer?.timeRemaining || draft.timerSettings.durationSeconds) * 1000);
    draft.updatedAt = new Date();

    this.activeDrafts.set(draftId, draft);
    await this.persistDraftState(draft);

    // Update Firestore
    await draftPersistence.updateTimer(draftId, timer?.timeRemaining || draft.timerSettings.durationSeconds, true);

    this.emit('draft:resumed', draftId);

    logger.info('Draft resumed successfully', { draftId });
  }

  /**
   * Update participant queue
   */
  async updateQueue(draftId: string, userId: string, queue: string[]): Promise<void> {
    const draft = await this.getDraft(draftId);
    if (!draft) {
      throw new Error(`Draft ${draftId} not found`);
    }

    const participant = draft.participants.find(p => p.userId === userId);
    if (!participant) {
      throw new Error(`Participant ${userId} not found in draft ${draftId}`);
    }

    logger.debug('Updating participant queue', { draftId, userId, queueLength: queue.length });

    participant.queue = [...queue];
    participant.lastActivity = new Date();
    draft.updatedAt = new Date();

    this.activeDrafts.set(draftId, draft);
    await this.persistDraftState(draft);

    // Update Firestore
    await draftPersistence.updateParticipant(draftId, participant.memberId, { queue });

    this.emit('draft:queue-updated', draftId, userId, queue);
  }

  /**
   * Mark participant as online/offline
   */
  async updateParticipantStatus(draftId: string, userId: string, isOnline: boolean): Promise<void> {
    const draft = await this.getDraft(draftId);
    if (!draft) {
      throw new Error(`Draft ${draftId} not found`);
    }

    const participant = draft.participants.find(p => p.userId === userId);
    if (!participant) {
      throw new Error(`Participant ${userId} not found in draft ${draftId}`);
    }

    participant.isOnline = isOnline;
    participant.lastActivity = new Date();
    draft.updatedAt = new Date();

    this.activeDrafts.set(draftId, draft);
    await this.persistDraftState(draft);

    // Update Firestore
    await draftPersistence.updateParticipant(draftId, participant.memberId, { isOnline });

    if (isOnline) {
      this.emit('draft:participant-joined', draftId, userId);
    } else {
      this.emit('draft:participant-left', draftId, userId);
    }

    logger.debug('Participant status updated', { draftId, userId, isOnline });
  }

  /**
   * Get draft state
   */
  async getDraft(draftId: string): Promise<LiveDraftState | null> {
    // Check memory first
    let draft = this.activeDrafts.get(draftId);
    
    if (!draft) {
      // Load from Redis
      draft = await this.loadDraftState(draftId);
      if (draft) {
        this.activeDrafts.set(draftId, draft);
      }
    }

    return draft;
  }

  /**
   * Get all active drafts (with pagination for memory efficiency)
   */
  async getActiveDrafts(offset = 0, limit = 100): Promise<LiveDraftState[]> {
    const drafts = Array.from(this.activeDrafts.values());
    return drafts
      .filter(draft => draft.status === 'LIVE' || draft.status === 'PAUSED')
      .slice(offset, offset + limit);
  }

  /**
   * Get engine metrics
   */
  getMetrics() {
    this.metrics.activeDrafts = this.activeDrafts.size;
    this.metrics.activeTimers = this.activeTimers.size;
    this.metrics.memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024; // MB

    return { ...this.metrics };
  }

  /**
   * Subscribe to draft events with specific event filtering
   */
  subscribeToDraft(draftId: string, eventTypes: (keyof DraftEngineEvents)[], callback: Function): () => void {
    const unsubscribers: (() => void)[] = [];

    eventTypes.forEach(eventType => {
      const handler = (...args: any[]) => {
        if (args[0] === draftId || (typeof args[0] === 'object' && args[0].draftId === draftId)) {
          callback(eventType, ...args);
        }
      };

      this.on(eventType, handler);
      unsubscribers.push(() => this.off(eventType, handler));
    });

    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }

  /**
   * Cleanup completed or abandoned drafts
   */
  private async cleanupDrafts(): Promise<void> {
    const now = new Date();
    const staleThreshold = 24 * 60 * 60 * 1000; // 24 hours
    let cleanedCount = 0;

    for (const [draftId, draft] of this.activeDrafts.entries()) {
      const isStale = now.getTime() - draft.lastActivity.getTime() > staleThreshold;
      const isCompleted = draft.status === 'COMPLETED';

      if (isStale || isCompleted) {
        // Stop any active timers
        const timer = this.activeTimers.get(draftId);
        if (timer?.interval) {
          clearInterval(timer.interval);
        }
        this.activeTimers.delete(draftId);

        // Remove from memory
        this.activeDrafts.delete(draftId);

        // Archive in Redis with TTL
        await this.archiveDraftState(draftId, draft);

        cleanedCount++;
        logger.debug('Cleaned up draft', { draftId, reason: isCompleted ? 'completed' : 'stale' });
      }
    }

    this.metrics.lastCleanup = now;
    
    if (cleanedCount > 0) {
      logger.info('Draft cleanup completed', { 
        cleanedCount, 
        remainingActive: this.activeDrafts.size,
        remainingTimers: this.activeTimers.size
      });
    }
  }

  /**
   * Calculate next pick based on draft type and current state
   */
  private calculateNextPick(draft: LiveDraftState): {
    userId: string;
    memberId: string;
    pickNumber: number;
    round: number;
    slot: number;
  } | null {
    const { totalTeams, totalRounds, draftType } = draft.draftSettings;
    const nextPickNumber = draft.currentPick.pickNumber + 1;
    const totalPicks = totalTeams * totalRounds;

    if (nextPickNumber > totalPicks) {
      return null; // Draft is complete
    }

    const nextRound = Math.ceil(nextPickNumber / totalTeams);
    let nextSlot: number;

    if (draftType === 'SNAKE') {
      // Snake draft: alternate direction each round
      const isForwardRound = (nextRound - 1) % 2 === 0;
      const positionInRound = ((nextPickNumber - 1) % totalTeams);
      
      nextSlot = isForwardRound 
        ? positionInRound + 1
        : totalTeams - positionInRound;
    } else {
      // Linear draft: same order every round
      nextSlot = ((nextPickNumber - 1) % totalTeams) + 1;
    }

    const nextParticipant = draft.participants.find(p => p.draftOrder === nextSlot);
    if (!nextParticipant) {
      throw new Error(`No participant found for draft order ${nextSlot}`);
    }

    return {
      userId: nextParticipant.userId,
      memberId: nextParticipant.memberId,
      pickNumber: nextPickNumber,
      round: nextRound,
      slot: nextSlot,
    };
  }

  /**
   * Start pick timer for current drafter
   */
  private async startPickTimer(draftId: string): Promise<void> {
    const draft = this.activeDrafts.get(draftId);
    if (!draft || draft.paused) return;

    // Stop existing timer
    await this.stopPickTimer(draftId);

    const timer: DraftTimer = {
      draftId,
      leagueId: draft.leagueId,
      timeRemaining: draft.timerSettings.durationSeconds,
      totalTime: draft.timerSettings.durationSeconds,
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + draft.timerSettings.durationSeconds * 1000),
      callbacks: new Set(),
      paused: false,
    };

    this.activeTimers.set(draftId, timer);
    this.startTimerInterval(timer);
    this.metrics.activeTimers++;

    logger.debug('Pick timer started', { 
      draftId, 
      userId: draft.currentPick.userId,
      duration: draft.timerSettings.durationSeconds 
    });
  }

  /**
   * Start the actual timer interval
   */
  private startTimerInterval(timer: DraftTimer): void {
    timer.interval = setInterval(async () => {
      if (timer.paused) return;

      timer.timeRemaining--;

      // Emit timer tick
      this.emit('draft:timer-tick', timer.draftId, timer.timeRemaining);

      // Notify callbacks
      timer.callbacks.forEach(callback => {
        try {
          callback(timer.timeRemaining);
        } catch (error) {
          logger.error('Timer callback error', { draftId: timer.draftId, error });
        }
      });

      // Check for expiry
      if (timer.timeRemaining <= 0) {
        await this.handleTimerExpiry(timer.draftId);
      }
    }, 1000);
  }

  /**
   * Stop pick timer
   */
  private async stopPickTimer(draftId: string): Promise<void> {
    const timer = this.activeTimers.get(draftId);
    if (timer?.interval) {
      clearInterval(timer.interval);
      timer.interval = undefined;
    }
    this.activeTimers.delete(draftId);
  }

  /**
   * Handle timer expiry with auto-pick
   */
  private async handleTimerExpiry(draftId: string): Promise<void> {
    const draft = this.activeDrafts.get(draftId);
    if (!draft || draft.paused) return;

    logger.info('Timer expired for draft', { 
      draftId, 
      userId: draft.currentPick.userId,
      autopickEnabled: draft.timerSettings.autopickAfterExpiry 
    });

    this.emit('draft:timer-expired', draftId);

    if (draft.timerSettings.autopickAfterExpiry) {
      // Find best available player from queue or top ranked
      const currentUser = draft.participants.find(p => p.userId === draft.currentPick.userId);
      let autoPickPlayerId: string;

      if (currentUser?.queue && currentUser.queue.length > 0) {
        // Pick from user's queue
        autoPickPlayerId = currentUser.queue[0];
      } else {
        // Pick highest ranked available player (implement your ranking logic)
        autoPickPlayerId = `auto-pick-${Date.now()}`;
      }

      try {
        await this.makePick({
          draftId,
          userId: draft.currentPick.userId,
          playerId: autoPickPlayerId,
          auto: true,
        });
      } catch (error) {
        logger.error('Auto-pick failed', { draftId, userId: draft.currentPick.userId, error });
      }
    }
  }

  /**
   * Persist draft state to Redis
   */
  private async persistDraftState(draft: LiveDraftState): Promise<void> {
    try {
      const key = `draft:${draft.draftId}`;
      await this.redis.setex(key, 86400, JSON.stringify(draft)); // 24 hour TTL
    } catch (error) {
      logger.error('Failed to persist draft state', { draftId: draft.draftId, error });
    }
  }

  /**
   * Load draft state from Redis
   */
  private async loadDraftState(draftId: string): Promise<LiveDraftState | null> {
    try {
      const key = `draft:${draftId}`;
      const data = await this.redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.error('Failed to load draft state', { draftId, error });
      return null;
    }
  }

  /**
   * Archive completed draft with longer TTL
   */
  private async archiveDraftState(draftId: string, draft: LiveDraftState): Promise<void> {
    try {
      const key = `draft:archive:${draftId}`;
      await this.redis.setex(key, 604800, JSON.stringify(draft)); // 7 day TTL for archives
      
      // Remove from active key
      await this.redis.del(`draft:${draftId}`);
    } catch (error) {
      logger.error('Failed to archive draft state', { draftId, error });
    }
  }

  /**
   * Initialize cleanup job
   */
  private initializeCleanupJob(): void {
    // Run cleanup every 30 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupDrafts().catch(error => {
        logger.error('Cleanup job failed', { error });
      });
    }, 30 * 60 * 1000);
  }

  /**
   * Initialize metrics collection
   */
  private initializeMetricsCollection(): void {
    // Log metrics every 5 minutes
    this.metricsInterval = setInterval(() => {
      const metrics = this.getMetrics();
      logger.info('Draft engine metrics', metrics);
    }, 5 * 60 * 1000);
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down Live Draft Engine...');

    // Clear all intervals
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    if (this.metricsInterval) clearInterval(this.metricsInterval);

    // Stop all active timers
    for (const timer of this.activeTimers.values()) {
      if (timer.interval) {
        clearInterval(timer.interval);
      }
    }

    // Persist all active drafts
    const persistPromises = Array.from(this.activeDrafts.values()).map(draft => 
      this.persistDraftState(draft)
    );
    await Promise.all(persistPromises);

    // Close Redis connection
    await this.redis.quit();

    logger.info('Live Draft Engine shutdown complete');
  }
}

// Singleton instance for application use
export const liveDraftEngine = new LiveDraftEngine();

// Graceful shutdown handling
process.on('SIGTERM', () => {
  liveDraftEngine.shutdown().then(() => process.exit(0));
});

process.on('SIGINT', () => {
  liveDraftEngine.shutdown().then(() => process.exit(0));
});
