/**
 * Enhanced Socket.IO Client Manager
 * Production-ready Socket.IO client with robust connection handling and error recovery
 */

import { io, type Socket } from 'socket.io-client';

import { logger } from './logger';
import { socketIOConfig, validateSocketIOConfig } from './socketioConfig';

export interface SocketIOClientConfig {
  url: string;
  autoConnect: boolean;
  reconnection: boolean;
  reconnectionAttempts: number;
  reconnectionDelay: number;
  reconnectionDelayMax: number;
  timeout: number;
  transports: string[];
  healthCheckIntervalMs?: number;
}

export interface SocketIOEventHandlers {
  onConnect?: (socket: Socket) => void;
  onDisconnect?: (reason: string) => void;
  onReconnect?: (attemptNumber: number) => void;
  onReconnectAttempt?: (attemptNumber: number) => void;
  onReconnectError?: (error: Error) => void;
  onReconnectFailed?: () => void;
  onError?: (error: Error) => void;
  onConnectError?: (error: Error) => void;
}

export interface DraftUpdateData {
  draftId: string;
  [k: string]: unknown;
}
export interface ParticipantData {
  socketId?: string;
  userId?: string;
  draftId: string;
  [k: string]: unknown;
}
export interface DraftPickData {
  draftId: string;
  playerId: string;
  pickNumber?: number;
  [k: string]: unknown;
}
export interface DraftTimerData {
  draftId: string;
  timeRemaining: number;
  timestamp?: string;
}
export interface DraftErrorData {
  error: string;
  details?: string;
  timestamp?: string;
}

export interface DraftRoomHandlers {
  onDraftUpdate?: (data: DraftUpdateData) => void;
  onParticipantJoin?: (data: ParticipantData) => void;
  onParticipantLeave?: (data: ParticipantData) => void;
  onParticipantDisconnect?: (data: ParticipantData) => void;
  onDraftPick?: (data: DraftPickData) => void;
  onDraftTimer?: (data: DraftTimerData) => void;
  onDraftTimerExpired?: (data: DraftTimerData) => void;
  onDraftPaused?: (data: DraftUpdateData) => void;
  onDraftResumed?: (data: DraftUpdateData) => void;
  onDraftError?: (data: DraftErrorData) => void;
}

export class SocketIOClientManager {
  private socket: Socket | null = null;
  private config: SocketIOClientConfig;
  private eventHandlers: SocketIOEventHandlers = {};
  private draftRoomHandlers: DraftRoomHandlers = {};
  private isConnecting = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private healthCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private connectionStartTime: number | null = null;

  constructor(config?: Partial<SocketIOClientConfig>) {
    // Runtime validation of the base configuration
    try {
      validateSocketIOConfig(socketIOConfig);
    } catch (error) {
      logger.error('Socket.IO configuration validation failed', {
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
      throw new Error(
        `Invalid Socket.IO configuration: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // Create a properly typed configuration with runtime validation
    const baseConfig: SocketIOClientConfig = { ...socketIOConfig.client };

    // Validate the merged configuration
    const mergedConfig = { ...baseConfig, ...config };

    // Runtime check to ensure all required fields are present
    if (!mergedConfig.url || typeof mergedConfig.url !== 'string') {
      throw new Error('Socket.IO client configuration missing required url field');
    }
    if (typeof mergedConfig.autoConnect !== 'boolean') {
      throw new Error('Socket.IO client configuration missing required autoConnect field');
    }
    if (typeof mergedConfig.reconnection !== 'boolean') {
      throw new Error('Socket.IO client configuration missing required reconnection field');
    }
    if (
      typeof mergedConfig.reconnectionAttempts !== 'number' ||
      mergedConfig.reconnectionAttempts < 0
    ) {
      throw new Error(
        'Socket.IO client configuration missing or invalid reconnectionAttempts field'
      );
    }
    if (typeof mergedConfig.reconnectionDelay !== 'number' || mergedConfig.reconnectionDelay < 0) {
      throw new Error('Socket.IO client configuration missing or invalid reconnectionDelay field');
    }
    if (
      typeof mergedConfig.reconnectionDelayMax !== 'number' ||
      mergedConfig.reconnectionDelayMax < 0
    ) {
      throw new Error(
        'Socket.IO client configuration missing or invalid reconnectionDelayMax field'
      );
    }
    if (typeof mergedConfig.timeout !== 'number' || mergedConfig.timeout < 0) {
      throw new Error('Socket.IO client configuration missing or invalid timeout field');
    }
    if (!Array.isArray(mergedConfig.transports) || mergedConfig.transports.length === 0) {
      throw new Error('Socket.IO client configuration missing or invalid transports field');
    }

    this.config = mergedConfig;
    this.maxReconnectAttempts = this.config.reconnectionAttempts;
  }

  /**
   * Initialize the Socket.IO connection
   */
  public async connect(): Promise<Socket> {
    if (this.socket?.connected) {
      logger.info('Socket already connected, returning existing connection');
      return this.socket;
    }

    if (this.isConnecting) {
      logger.info('Connection already in progress, waiting...');
      // Wait for existing connection attempt
      return new Promise((resolve, reject) => {
        const checkConnection = () => {
          if (this.socket?.connected) {
            resolve(this.socket);
          } else if (!this.isConnecting) {
            reject(new Error('Connection failed'));
          } else {
            setTimeout(checkConnection, 100);
          }
        };
        checkConnection();
      });
    }

    this.isConnecting = true;
    this.connectionStartTime = Date.now();

    try {
      logger.info('🔌 Initializing Socket.IO connection', {
        url: this.config.url,
        transports: this.config.transports,
        timestamp: new Date().toISOString(),
      });

      // Create Socket.IO instance
      this.socket = io(this.config.url, {
        transports: this.config.transports,
        autoConnect: false, // We'll connect manually
        reconnection: false, // We'll handle reconnection manually
        timeout: this.config.timeout,
        forceNew: true,
      });

      // Set up event handlers
      this.setupEventHandlers();
      this.setupDraftRoomHandlers();

      // Connect to the server
      await this.connectToServer();

      logger.info('✅ Socket.IO connection established successfully', {
        socketId: this.socket.id,
        connectionTime: Date.now() - (this.connectionStartTime || 0),
        timestamp: new Date().toISOString(),
      });

      this.isConnecting = false;
      return this.socket;
    } catch (error) {
      this.isConnecting = false;
      const errorMessage = error instanceof Error ? error.message : 'Unknown connection error';

      logger.error('❌ Failed to establish Socket.IO connection', {
        url: this.config.url,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      });

      // Attempt reconnection if enabled
      if (this.config.reconnection && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.scheduleReconnection();
      }

      throw new Error(`Socket.IO connection failed: ${errorMessage}`);
    }
  }

  /**
   * Connect to the Socket.IO server
   */
  private async connectToServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Socket not initialized'));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, this.config.timeout);

      this.socket.once('connect', () => {
        clearTimeout(timeout);
        this.reconnectAttempts = 0;
        this.startHealthCheck();
        resolve();
      });

      this.socket.once('connect_error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      this.socket.connect();
    });
  }

  /**
   * Set up core Socket.IO event handlers
   */
  private setupEventHandlers(): void {
    if (!this.socket) return;

    // Connection events
    this.socket.on('connect', () => {
      logger.info('🔌 Socket.IO connected', {
        socketId: this.socket?.id,
        timestamp: new Date().toISOString(),
      });
      if (this.socket) {
        this.eventHandlers.onConnect?.(this.socket);
      }
    });

    this.socket.on('disconnect', (reason) => {
      logger.info('🔌 Socket.IO disconnected', {
        reason,
        socketId: this.socket?.id,
        timestamp: new Date().toISOString(),
      });
      this.eventHandlers.onDisconnect?.(reason);
      this.stopHealthCheck();

      // Attempt reconnection if enabled
      if (this.config.reconnection && reason !== 'io client disconnect') {
        this.scheduleReconnection();
      }
    });

    // Reconnection events
    this.socket.on('reconnect', (attemptNumber) => {
      logger.info('🔄 Socket.IO reconnected', {
        attemptNumber,
        socketId: this.socket?.id,
        timestamp: new Date().toISOString(),
      });
      this.reconnectAttempts = 0;
      this.eventHandlers.onReconnect?.(attemptNumber);
      this.startHealthCheck();
    });

    this.socket.on('reconnect_attempt', (attemptNumber) => {
      logger.info('🔄 Socket.IO reconnection attempt', {
        attemptNumber,
        timestamp: new Date().toISOString(),
      });
      this.eventHandlers.onReconnectAttempt?.(attemptNumber);
    });

    this.socket.on('reconnect_error', (error) => {
      logger.error('❌ Socket.IO reconnection error', {
        error: error.message,
        attemptNumber: this.reconnectAttempts,
        timestamp: new Date().toISOString(),
      });
      this.eventHandlers.onReconnectError?.(error);
    });

    this.socket.on('reconnect_failed', () => {
      logger.error('❌ Socket.IO reconnection failed after all attempts', {
        maxAttempts: this.maxReconnectAttempts,
        timestamp: new Date().toISOString(),
      });
      this.eventHandlers.onReconnectFailed?.();
    });

    // Error events
    this.socket.on('error', (error) => {
      logger.error('❌ Socket.IO error', {
        error: error.message,
        socketId: this.socket?.id,
        timestamp: new Date().toISOString(),
      });
      this.eventHandlers.onError?.(error);
    });

    this.socket.on('connect_error', (error) => {
      logger.error('❌ Socket.IO connection error', {
        error: error.message,
        timestamp: new Date().toISOString(),
      });
      this.eventHandlers.onConnectError?.(error);
    });
  }

  /**
   * Set up draft room specific event handlers
   */
  private setupDraftRoomHandlers(): void {
    if (!this.socket) return;

    // Draft room events
    this.socket.on('draft:update', (data) => {
      logger.debug('📡 Draft update received', { data, timestamp: new Date().toISOString() });
      this.draftRoomHandlers.onDraftUpdate?.(data);
    });

    this.socket.on('participant:join', (data) => {
      logger.debug('👤 Participant joined', { data, timestamp: new Date().toISOString() });
      this.draftRoomHandlers.onParticipantJoin?.(data);
    });

    this.socket.on('participant:leave', (data) => {
      logger.debug('👋 Participant left', { data, timestamp: new Date().toISOString() });
      this.draftRoomHandlers.onParticipantLeave?.(data);
    });

    this.socket.on('participant:disconnect', (data) => {
      logger.debug('🔌 Participant disconnected', { data, timestamp: new Date().toISOString() });
      this.draftRoomHandlers.onParticipantDisconnect?.(data);
    });

    this.socket.on('draft:pick', (data) => {
      logger.debug('🎯 Draft pick made', { data, timestamp: new Date().toISOString() });
      this.draftRoomHandlers.onDraftPick?.(data);
    });

    this.socket.on('draft:timer', (data) => {
      logger.debug('⏰ Draft timer update', { data, timestamp: new Date().toISOString() });
      this.draftRoomHandlers.onDraftTimer?.(data);
    });

    this.socket.on('draft:timer:expired', (data) => {
      logger.debug('⏰ Draft timer expired', { data, timestamp: new Date().toISOString() });
      this.draftRoomHandlers.onDraftTimerExpired?.(data);
    });

    this.socket.on('draft:paused', (data) => {
      logger.debug('⏸️ Draft paused', { data, timestamp: new Date().toISOString() });
      this.draftRoomHandlers.onDraftPaused?.(data);
    });

    this.socket.on('draft:resumed', (data) => {
      logger.debug('▶️ Draft resumed', { data, timestamp: new Date().toISOString() });
      this.draftRoomHandlers.onDraftResumed?.(data);
    });

    this.socket.on('draft:error', (data) => {
      logger.error('❌ Draft error', { data, timestamp: new Date().toISOString() });
      this.draftRoomHandlers.onDraftError?.(data);
    });
  }

  /**
   * Schedule reconnection attempt
   */
  private schedulingReconnect = false;
  private scheduleReconnection(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.schedulingReconnect) return; // idempotent guard

    this.schedulingReconnect = true;
    this.reconnectAttempts = Math.min(this.reconnectAttempts + 1, this.maxReconnectAttempts);
    const delay = Math.min(
      this.config.reconnectionDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.config.reconnectionDelayMax
    );

    logger.info('🔄 Scheduling reconnection attempt', {
      attempt: this.reconnectAttempts,
      delay,
      maxAttempts: this.maxReconnectAttempts,
      timestamp: new Date().toISOString(),
    });

    this.reconnectTimer = setTimeout(async () => {
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        try {
          await this.connect();
        } catch (error) {
          logger.error('❌ Reconnection attempt failed', {
            attempt: this.reconnectAttempts,
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString(),
          });
        }
      } else {
        logger.error('❌ Max reconnection attempts reached', {
          maxAttempts: this.maxReconnectAttempts,
          timestamp: new Date().toISOString(),
        });
      }
      this.schedulingReconnect = false;
    }, delay);
  }

  /**
   * Start health check monitoring
   */
  private startHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    const intervalMs =
      typeof this.config.healthCheckIntervalMs === 'number' && this.config.healthCheckIntervalMs > 0
        ? this.config.healthCheckIntervalMs
        : 30000;

    this.healthCheckTimer = setInterval(() => {
      if (this.socket?.connected) {
        // Send ping to keep connection alive
        this.socket.emit('ping', { timestamp: Date.now() });
      }
    }, intervalMs); // Configurable
  }

  /**
   * Stop health check monitoring
   */
  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Join a draft room
   */
  public joinDraft(draftId: string, userId?: string, authToken?: string): void {
    if (!this.socket?.connected) {
      logger.error('❌ Cannot join draft: socket not connected');
      return;
    }

    logger.info('👤 Joining draft room', {
      draftId,
      userId,
      socketId: this.socket.id,
      timestamp: new Date().toISOString(),
    });
    const payload: Record<string, unknown> = { draftId };
    if (typeof userId === 'string' && userId.trim().length > 0) payload.userId = userId;
    if (typeof authToken === 'string' && authToken.trim().length > 0) {
      payload.authToken = authToken.trim();
    } else if (authToken) {
      logger.warn('joinDraft called with invalid authToken; omitting from payload');
    }
    this.socket.emit('join:draft', payload);
  }

  /**
   * Leave a draft room
   */
  public leaveDraft(draftId: string): void {
    if (!this.socket?.connected) {
      logger.error('❌ Cannot leave draft: socket not connected');
      return;
    }

    logger.info('👋 Leaving draft room', {
      draftId,
      socketId: this.socket.id,
      timestamp: new Date().toISOString(),
    });

    this.socket.emit('leave:draft', { draftId });
  }

  /**
   * Make a draft pick
   */
  public makeDraftPick(draftId: string, playerId: string, userId: string): void {
    if (!this.socket?.connected) {
      logger.error('❌ Cannot make draft pick: socket not connected');
      return;
    }

    logger.info('🎯 Making draft pick', {
      draftId,
      playerId,
      userId,
      socketId: this.socket.id,
      timestamp: new Date().toISOString(),
    });

    this.socket.emit('draft:pick', { draftId, playerId, userId });
  }

  /**
   * Start draft timer
   */
  public startDraftTimer(draftId: string, duration: number): void {
    if (!this.socket?.connected) {
      logger.error('❌ Cannot start draft timer: socket not connected');
      return;
    }

    logger.info('⏰ Starting draft timer', {
      draftId,
      duration,
      socketId: this.socket.id,
      timestamp: new Date().toISOString(),
    });

    this.socket.emit('draft:timer:start', { draftId, duration });
  }

  /**
   * Pause draft
   */
  public pauseDraft(draftId: string): void {
    if (!this.socket?.connected) {
      logger.error('❌ Cannot pause draft: socket not connected');
      return;
    }

    logger.info('⏸️ Pausing draft', {
      draftId,
      socketId: this.socket.id,
      timestamp: new Date().toISOString(),
    });

    this.socket.emit('draft:pause', { draftId });
  }

  /**
   * Resume draft
   */
  public resumeDraft(draftId: string): void {
    if (!this.socket?.connected) {
      logger.error('❌ Cannot resume draft: socket not connected');
      return;
    }

    logger.info('▶️ Resuming draft', {
      draftId,
      socketId: this.socket.id,
      timestamp: new Date().toISOString(),
    });

    this.socket.emit('draft:resume', { draftId });
  }

  /**
   * Set event handlers
   */
  public setEventHandlers(handlers: SocketIOEventHandlers): void {
    this.eventHandlers = { ...this.eventHandlers, ...handlers };
  }

  /**
   * Set draft room event handlers
   */
  public setDraftRoomHandlers(handlers: DraftRoomHandlers): void {
    this.draftRoomHandlers = { ...this.draftRoomHandlers, ...handlers };
  }

  /**
   * Get connection status
   */
  public getConnectionStatus(): {
    connected: boolean;
    connecting: boolean;
    reconnectAttempts: number;
    maxReconnectAttempts: number;
    uptime: number | null;
  } {
    return {
      connected: this.socket?.connected || false,
      connecting: this.isConnecting,
      reconnectAttempts: this.reconnectAttempts,
      maxReconnectAttempts: this.maxReconnectAttempts,
      uptime: this.connectionStartTime ? Date.now() - this.connectionStartTime : null,
    };
  }

  /**
   * Disconnect and cleanup
   */
  public disconnect(): void {
    logger.info('🔌 Disconnecting Socket.IO client', {
      timestamp: new Date().toISOString(),
    });

    // Clear timers
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    // Disconnect socket
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    // Reset state
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    this.connectionStartTime = null;
  }

  /**
   * Get the underlying Socket.IO instance
   */
  public getSocket(): Socket | null {
    return this.socket;
  }
}

/**
 * Process-wide singleton Socket.IO client.
 * Use this shared instance for app-wide operations in a single-threaded runtime.
 * For worker threads or multiple Node processes, create independent instances of
 * SocketIOClientManager to avoid sharing mutable socket state across workers.
 */
export const socketIOClient = new SocketIOClientManager();

/**
 * Exported class so callers can create isolated client instances when needed.
 * Example: prefer the exported singleton for most apps; create a custom instance
 * per worker in multi-worker scenarios for isolation.
 */
export default SocketIOClientManager;
