/**
 * Socket.IO Configuration
 * Centralized configuration for Socket.IO server and client
 */

import type { SocketIOClientConfig } from './socketioClient';

export interface SocketIOConfig {
  // Server configuration
  server: {
    port: number;
    cors: {
      origin: string[];
      methods: string[];
      credentials: boolean;
      allowedHeaders: string[];
    };
    transports: ('websocket' | 'polling')[];
    allowEIO3: boolean;
    pingTimeout: number;
    pingInterval: number;
    upgradeTimeout: number;
    maxHttpBufferSize: number;
  };

  // Client configuration
  client: SocketIOClientConfig;

  // Environment-specific overrides
  environment: 'development' | 'staging' | 'production';
}

// Environment detection with validation
const rawEnv = (process.env.NODE_ENV || 'development').toString().trim().toLowerCase();
const allowedEnvs = new Set(['development', 'production', 'test', 'staging']);

if (!allowedEnvs.has(rawEnv)) {
  const message = `Invalid NODE_ENV '${process.env.NODE_ENV}' detected; must be one of: ${Array.from(allowedEnvs).join(', ')}`;
  if (process.env.NODE_ENV) {
    // If explicitly set to invalid value, treat as error
    throw new Error(message);
  }
  // If not set, default to production silently
  console.info('NODE_ENV not set; defaulting to production');
}

const NODE_ENV = rawEnv as 'development' | 'production' | 'test' | 'staging';
const isDevelopment = NODE_ENV === 'development';
const isProduction = NODE_ENV === 'production';

// Base configuration
const baseConfig: SocketIOConfig = {
  server: {
    port: (() => {
      const port = parseInt(process.env.SOCKET_PORT || '3002', 10);
      if (isNaN(port)) {
        console.warn(`Invalid SOCKET_PORT '${process.env.SOCKET_PORT}'; using default 3002`);
        return 3002;
      }
      return port;
    })(),
    cors: {
      origin: [
        'http://localhost:3000',
        'http://localhost:3002',
        'http://localhost:3003',
        // Add production domains here
        ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : []),
      ],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      credentials: false,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    },
    transports: ['websocket', 'polling'],
    // Disable legacy Engine.IO v3 compatibility by default. Enable only via env when needed.
    allowEIO3: process.env.ALLOW_EIO3 === 'true',
    pingTimeout: 60000, // 60 seconds
    pingInterval: 25000, // 25 seconds
    upgradeTimeout: 10000, // 10 seconds
    maxHttpBufferSize: 1e6, // 1MB
  },

  client: {
    url:
      process.env.NEXT_PUBLIC_SOCKET_URL ||
      (isDevelopment
        ? `http://localhost:${parseInt(process.env.NEXT_PUBLIC_SOCKET_PORT || process.env.SOCKET_PORT || '3002', 10)}`
        : '/api/socketio'),
    transports: ['websocket', 'polling'],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
  },

  environment: isDevelopment ? 'development' : NODE_ENV === 'staging' ? 'staging' : 'production',
};

// Environment-specific overrides
export const socketIOConfig: SocketIOConfig = {
  ...baseConfig,
  server: {
    ...baseConfig.server,
    // Production optimizations
    ...(isProduction && {
      cors: {
        ...baseConfig.server.cors,
        origin: process.env.ALLOWED_ORIGINS?.split(',') || [],
        credentials: true,
      },
      transports: ['websocket', 'polling'], // Allow polling fallback in production
      pingTimeout: 30000, // Shorter timeout for production
      pingInterval: 15000, // More frequent pings
    }),
    // Development overrides
    ...(isDevelopment && {
      cors: {
        ...baseConfig.server.cors,
        origin: ['*'], // Allow all origins in development
      },
      transports: ['websocket', 'polling'], // Allow polling fallback
    }),
  },

  client: {
    ...baseConfig.client,
    // Production client settings
    ...(isProduction && {
      transports: ['websocket', 'polling'], // Allow fallback
      reconnectionAttempts: 10, // More reconnection attempts
      timeout: 10000, // Shorter timeout
    }),
    // Development client settings
    ...(isDevelopment && {
      transports: ['websocket', 'polling'], // Allow polling fallback
      reconnectionAttempts: 3, // Fewer reconnection attempts
    }),
  },
};

// Runtime validation for SocketIOClientConfig
function validateSocketIOClientConfig(config: unknown): asserts config is SocketIOClientConfig {
  if (!config || typeof config !== 'object') {
    throw new Error('Client configuration must be an object');
  }

  const clientConfig = config as Record<string, unknown>;
  const errors: string[] = [];

  // Required string fields
  const requiredStringFields: (keyof SocketIOClientConfig)[] = ['url'];
  for (const field of requiredStringFields) {
    if (typeof clientConfig[field] !== 'string' || !clientConfig[field]) {
      errors.push(`Client config missing or invalid ${field}`);
    }
  }

  // Required boolean fields
  const requiredBooleanFields: (keyof SocketIOClientConfig)[] = ['autoConnect', 'reconnection'];
  for (const field of requiredBooleanFields) {
    if (typeof clientConfig[field] !== 'boolean') {
      errors.push(`Client config missing or invalid ${field}`);
    }
  }

  // Required number fields
  const requiredNumberFields: (keyof SocketIOClientConfig)[] = [
    'reconnectionAttempts',
    'reconnectionDelay',
    'reconnectionDelayMax',
    'timeout'
  ];
  for (const field of requiredNumberFields) {
    if (typeof clientConfig[field] !== 'number' || clientConfig[field] < 0) {
      errors.push(`Client config missing or invalid ${field}`);
    }
  }

  // Required array fields
  if (!Array.isArray(clientConfig.transports) || clientConfig.transports.length === 0) {
    errors.push('Client config missing or invalid transports array');
  } else {
    const allowedTransports = new Set(['websocket', 'polling']);
    for (const transport of clientConfig.transports) {
      if (!allowedTransports.has(transport)) {
        errors.push(`Invalid transport: ${transport}`);
      }
    }
  }

  // Optional fields validation
  if (clientConfig.healthCheckIntervalMs !== undefined) {
    if (typeof clientConfig.healthCheckIntervalMs !== 'number' || clientConfig.healthCheckIntervalMs <= 0) {
      errors.push('Client config healthCheckIntervalMs must be a positive number');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Socket.IO client configuration errors: ${errors.join(', ')}`);
  }
}

// Validation function
export function validateSocketIOConfig(config: SocketIOConfig): void {
  const errors: string[] = [];

  if (config.server.port <= 0 || config.server.port > 65535) {
    errors.push('Invalid server port');
  }

  if (config.server.cors.origin.length === 0) {
    errors.push('At least one CORS origin must be specified');
  }

  if (
    config.server.cors.credentials &&
    config.server.cors.origin.includes('*')
  ) {
    errors.push('CORS origin "*" not allowed when credentials=true');
  }

  if (config.server.transports.length === 0) {
    errors.push('At least one transport must be specified');
  }
  
  const allowedTransports = new Set(['polling', 'websocket']);
  for (const t of config.server.transports) {
    if (!allowedTransports.has(t)) {
      errors.push(`Invalid transport: ${t}`);
    }
  }
  
  const isAbsoluteUrl = /^https?:\/\//i.test(config.client.url);
  const isRelativeUrl = config.client.url.startsWith('/');
  if (!isAbsoluteUrl && !isRelativeUrl) {
    errors.push('Invalid client URL');
  } else if (isAbsoluteUrl) {
    try {
      new URL(config.client.url);
    } catch {
      errors.push('Invalid client URL');
    }
  }

  // Validate client configuration structure
  try {
    validateSocketIOClientConfig(config.client);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Invalid client configuration');
  }

  if (errors.length > 0) {
    throw new Error(`Socket.IO configuration errors: ${errors.join(', ')}`);
  }
}

// Runtime validation of the exported configuration
try {
  validateSocketIOConfig(socketIOConfig);
} catch (error) {
  console.error('Socket.IO configuration validation failed:', error);
  throw error;
}

// Export default configuration
export default socketIOConfig;
