/**
 * Socket.IO Configuration
 * Centralized configuration for Socket.IO server and client
 */

/**
 * Canonicalizes an origin string by:
 * 1. Trimming whitespace
 * 2. Converting to lowercase
 * 3. Ensuring it's a valid URL
 * 4. Returning only the origin (protocol + hostname + port)
 */
function canonicalizeOrigin(origin: string): string | null {
  try {
    const trimmed = origin.trim();
    if (trimmed === '*') return '*';
    
    const url = new URL(trimmed);
    // Return only the origin part (protocol + hostname + port)
    return url.origin;
  } catch {
    return null;
  }
}

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
        ...(process.env.ALLOWED_ORIGINS ? 
          process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean) : 
          []
        ),
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
        origin: (() => {
          const origins = process.env.ALLOWED_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean) || [];
          return origins.length > 0 ? origins : ['http://localhost:3000'];
        })(),
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
  
  // Validate CORS origins
  if (config.server.cors.origin.length === 0) {
    errors.push('At least one CORS origin must be specified');
  }
  
  // First canonicalize each origin, then deduplicate
  const canonicalizedOrigins: string[] = [];
  for (const origin of config.server.cors.origin) {
    const canonical = canonicalizeOrigin(origin);
    if (canonical === null) {
      errors.push(`Invalid CORS origin URL: '${origin}'`);
      continue;
    }
    canonicalizedOrigins.push(canonical);
  }
  
  // Deduplicate after canonicalization
  const uniqueCanonicalOrigins = [...new Set(canonicalizedOrigins)];
  
  // Check for wildcard origin with credentials enabled
  if (uniqueCanonicalOrigins.includes('*') && config.server.cors.credentials === true) {
    errors.push("Wildcard CORS origin '*' cannot be used with credentials enabled");
  }
  
  // Validate that non-wildcard canonical origins don't include path, query, or hash components
  for (const origin of uniqueCanonicalOrigins) {
    if (origin === '*') continue; // Skip wildcard origins
    
    try {
      const url = new URL(origin);
      // Reject if URL has path, query, or hash components
      if (url.pathname !== '/' || url.search || url.hash) {
        errors.push(`Invalid CORS origin: '${origin}' - origins cannot include path, query, or hash components`);
      }
    } catch {
      errors.push(`Invalid CORS origin URL: '${origin}'`);
    }
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
  
  // Only validate client URL if it's not a relative path (like '/api/socketio')
  const clientUrl = (config.client?.url || '').trim();
  if (!clientUrl.startsWith('/')) {
    try {
      // Validate client URL format
      // Handle protocol-relative URLs (//example.com) by prepending http: scheme
      const urlToValidate = clientUrl.startsWith('//') ? `http:${clientUrl}` : clientUrl;
      new URL(urlToValidate);
    } catch {
      errors.push('Invalid client URL; expected an absolute URL (including protocol) or a relative path, protocol-relative (//host) not supported');
    }
  }
  
  if (errors.length > 0) {
    throw new Error(`Socket.IO configuration errors: ${errors.join(', ')}`);
  }
}

// Export default configuration
export default socketIOConfig;
