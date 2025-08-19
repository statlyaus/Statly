/**
 * Live Draft Engine Integration
 * Integrates the new Live Draft Engine with existing Socket.IO server
 */

import type { Server as SocketIOServer } from 'socket.io';
import { liveDraftEngine } from './liveDraftEngine';
import LiveDraftWebSocketManager from './liveDraftWebSocketManager';
import { logger } from '@/lib/logger';

interface ExistingDraftState {
  status?: string;
  settings?: {
    totalRounds?: number;
    pickTimeLimit?: number;
    draftType?: 'SNAKE' | 'LINEAR';
    autopickEnabled?: boolean;
  };
  picks?: Array<{
    playerId: string;
    userId: string;
    pickNumber: number;
  }>;
}

export class LiveDraftIntegration {
  private webSocketManager: LiveDraftWebSocketManager;
  private initialized = false;

  constructor(private io: SocketIOServer) {
    this.webSocketManager = new LiveDraftWebSocketManager(io);
  }

  /**
   * Initialize the live draft integration
   */
  initialize(): void {
    if (this.initialized) {
      logger.warn('Live Draft Integration already initialized');
      return;
    }

    this.setupEventForwarding();
    this.setupHealthChecks();
    this.initialized = true;

    logger.info('Live Draft Integration initialized successfully');
  }

  /**
   * Create a new live draft from league configuration
   */
  async createLiveDraft(params: {
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
  }) {
    logger.info('Creating live draft through integration', { 
      leagueId: params.leagueId, 
      draftId: params.draftId 
    });

    try {
      const draft = await liveDraftEngine.createDraft(params);
      
      // Notify all relevant systems
      this.io.emit('system:draft-created', {
        draftId: draft.draftId,
        leagueId: draft.leagueId,
        participantCount: draft.participants.length,
        createdAt: draft.createdAt,
      });

      return draft;
    } catch (error) {
      logger.error('Failed to create live draft', { 
        leagueId: params.leagueId, 
        draftId: params.draftId, 
        error 
      });
      throw error;
    }
  }

  /**
   * Start a live draft
   */
  async startLiveDraft(draftId: string) {
    logger.info('Starting live draft through integration', { draftId });

    try {
      await liveDraftEngine.startDraft(draftId);
      
      // Notify systems of draft start
      this.io.emit('system:draft-started', {
        draftId,
        startedAt: new Date().toISOString(),
      });

      return true;
    } catch (error) {
      logger.error('Failed to start live draft', { draftId, error });
      throw error;
    }
  }

  /**
   * Migrate existing draft to live engine
   */
  async migrateDraftToLiveEngine(params: {
    draftId: string;
    leagueId: string;
    currentState: ExistingDraftState; // Your existing draft state
    participants: Array<{
      userId: string;
      memberId: string;
      displayName: string;
      draftOrder: number;
    }>;
  }) {
    logger.info('Migrating draft to live engine', { 
      draftId: params.draftId,
      leagueId: params.leagueId 
    });

    try {
      // Create new live draft based on existing state
      const draft = await liveDraftEngine.createDraft({
        leagueId: params.leagueId,
        draftId: params.draftId,
        participants: params.participants,
        settings: {
          totalRounds: params.currentState.settings?.totalRounds || 15,
          pickTimeLimit: params.currentState.settings?.pickTimeLimit || 120,
          draftType: params.currentState.settings?.draftType || 'SNAKE',
          autopickAfterExpiry: params.currentState.settings?.autopickEnabled || true,
        },
      });

      // If the original draft was already started, start the live version
      if (params.currentState.status === 'LIVE') {
        await liveDraftEngine.startDraft(params.draftId);
      }

      // TODO: Migrate existing picks if any
      // This would require implementing a method to restore pick history

      logger.info('Draft migration completed', { draftId: params.draftId });
      return draft;

    } catch (error) {
      logger.error('Failed to migrate draft', { draftId: params.draftId, error });
      throw error;
    }
  }

  /**
   * Get comprehensive metrics for monitoring
   */
  getMetrics() {
    const engineMetrics = liveDraftEngine.getMetrics();
    const wsMetrics = this.webSocketManager.getMetrics();

    return {
      engine: engineMetrics,
      websockets: wsMetrics,
      integration: {
        initialized: this.initialized,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Handle graceful shutdown
   */
  async shutdown() {
    logger.info('Shutting down Live Draft Integration...');

    try {
      await liveDraftEngine.shutdown();
      logger.info('Live Draft Integration shutdown complete');
    } catch (error) {
      logger.error('Error during Live Draft Integration shutdown', { error });
    }
  }

  /**
   * Setup event forwarding between systems
   */
  private setupEventForwarding(): void {
    // Forward critical draft events to main Socket.IO server
    liveDraftEngine.on('draft:created', (draft) => {
      this.io.emit('draft:created', {
        draftId: draft.draftId,
        leagueId: draft.leagueId,
        status: draft.status,
      });
    });

    liveDraftEngine.on('draft:completed', (draftId) => {
      this.io.emit('draft:completed', { draftId });
    });

    // Forward system health events
    liveDraftEngine.on('error', (error) => {
      logger.error('Live Draft Engine error', { error });
      this.io.emit('system:draft-engine-error', { 
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    });

    logger.debug('Event forwarding configured');
  }

  /**
   * Setup health checks and monitoring
   */
  private setupHealthChecks(): void {
    // Health check every 30 seconds
    setInterval(() => {
      const metrics = this.getMetrics();
      
      // Log warnings for concerning metrics
      if (metrics.engine.activeDrafts > 1000) {
        logger.warn('High number of active drafts', { 
          activeDrafts: metrics.engine.activeDrafts 
        });
      }

      if (metrics.engine.memoryUsage > 500) { // 500MB
        logger.warn('High memory usage', { 
          memoryUsage: metrics.engine.memoryUsage 
        });
      }

      if (metrics.websockets.totalConnections > 5000) {
        logger.warn('High WebSocket connection count', { 
          connections: metrics.websockets.totalConnections 
        });
      }

    }, 30000);

    logger.debug('Health checks configured');
  }

  /**
   * Get room information for debugging
   */
  getRoomInfo(draftId: string) {
    return this.webSocketManager.getRoomInfo(draftId);
  }

  /**
   * Force disconnect all sockets for a draft (admin function)
   */
  async forceDisconnectDraft(draftId: string) {
    return this.webSocketManager.disconnectDraft(draftId);
  }

  /**
   * Broadcast admin message to draft room
   */
  broadcastAdminMessage(draftId: string, message: string) {
    return this.webSocketManager.broadcastAdminMessage(draftId, message);
  }
}

// Export singleton instance
export const liveDraftIntegration = new LiveDraftIntegration(
  // This will be injected when the Socket.IO server is available
  {} as SocketIOServer
);

export default LiveDraftIntegration;
