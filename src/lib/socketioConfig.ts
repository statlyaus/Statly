/**
 * Socket.IO Configuration
 * Centralized configuration for Socket.IO server and client
 */

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
  client: {
    url: string;
    transports: ('websocket' | 'polling')[];
    autoConnect: boolean;
    reconnection: boolean;
    reconnectionAttempts: number;
    reconnectionDelay: number;
    reconnectionDelayMax: number;
    timeout: number;
  };
  
  // Environment-specific overrides
  environment: 'development' | 'staging' | 'production';
}

// Environment detection with validation
const rawEnv = (process.env.NODE_ENV || '').toString().trim().toLowerCase();
const allowedEnvs = new Set(['development', 'production', 'test', 'staging']);
const NODE_ENV = allowedEnvs.has(rawEnv) ? (rawEnv as 'development' | 'production' | 'test' | 'staging') : 'production';
if (!allowedEnvs.has(rawEnv)) {
   
  console.warn(`Invalid NODE_ENV '${rawEnv || '(empty)'}' detected; defaulting to 'production'`);
}
const isDevelopment = NODE_ENV === 'development';
const isProduction = NODE_ENV === 'production';

// Base configuration
const baseConfig: SocketIOConfig = {
  server: {
    port: parseInt(process.env.SOCKET_PORT || '3002', 10),
    cors: {
      origin: [
        'http://localhost:3000',
        'http://localhost:3001',
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
    allowEIO3: true,
    pingTimeout: 60000, // 60 seconds
    pingInterval: 25000, // 25 seconds
    upgradeTimeout: 10000, // 10 seconds
    maxHttpBufferSize: 1e6, // 1MB
  },
  
  client: {
    url: process.env.NEXT_PUBLIC_SOCKET_URL || 
         (isDevelopment ? 'http://localhost:3002' : '/api/socketio'),
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

// Validation function
export function validateSocketIOConfig(config: SocketIOConfig): void {
  const errors: string[] = [];
  
  if (config.server.port < 1 || config.server.port > 65535) {
    errors.push('Invalid server port');
  }
  
  if (config.server.cors.origin.length === 0) {
    errors.push('At least one CORS origin must be specified');
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
  try {
    // Validate client URL format
     
    new URL(config.client.url);
  } catch {
    errors.push('Invalid client URL');
  }
  
  if (errors.length > 0) {
    throw new Error(`Socket.IO configuration errors: ${errors.join(', ')}`);
  }
}

// Export default configuration
export default socketIOConfig;
