import type { ServerOptions } from 'socket.io';

type SocketTransport = NonNullable<ServerOptions['transports']>[number];

type SocketIOCorsConfig = {
  origin: string[];
  credentials: true;
};

export interface SocketIoConfig {
  environment: string;
  server: Partial<ServerOptions> & {
    port: number;
    cors: SocketIOCorsConfig;
    transports: SocketTransport[];
    allowEIO3: boolean;
    pingTimeout: number;
    pingInterval: number;
    upgradeTimeout: number;
    maxHttpBufferSize: number;
  };
}

export type SocketIOConfig = SocketIoConfig;

function parseCommaSeparated(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseIntegerEnv(names: string[], fallback: number): number {
  for (const name of names) {
    const raw = process.env[name];
    if (!raw) continue;

    const value = Number.parseInt(raw, 10);
    if (Number.isFinite(value)) return value;
  }

  return fallback;
}

function parseBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;

  return raw === '1' || raw.toLowerCase() === 'true';
}

function parseTransports(): SocketTransport[] {
  const raw = process.env.SOCKET_IO_TRANSPORTS;
  const transports = raw ? parseCommaSeparated(raw) : ['websocket', 'polling'];
  const supportedTransports = new Set(['polling', 'websocket', 'webtransport']);

  return transports.filter((transport): transport is SocketTransport =>
    supportedTransports.has(transport)
  );
}

function getCorsOrigins(environment: string): string[] {
  const rawOrigins = process.env.SOCKET_IO_CORS_ORIGINS ?? process.env.ALLOWED_ORIGINS ?? '';
  const origins = new Set(parseCommaSeparated(rawOrigins));
  const clientUrl = process.env.CLIENT_URL?.trim();

  if (clientUrl) {
    origins.add(clientUrl);
  }

  if (origins.size === 0 && environment !== 'production') {
    origins.add('http://localhost:3000');
    console.warn('[socketioConfig] No SOCKET_IO_CORS_ORIGINS set, defaulting to localhost in dev.');
  }

  return Array.from(origins);
}

function buildSocketIOConfig(): SocketIoConfig {
  const environment = process.env.NODE_ENV || 'development';

  return {
    environment,
    server: {
      port: parseIntegerEnv(['SOCKET_PORT', 'SOCKET_IO_PORT', 'SOCKETIO_PORT', 'PORT'], 3002),
      cors: {
        origin: getCorsOrigins(environment),
        credentials: true,
      },
      transports: parseTransports(),
      allowEIO3: parseBooleanEnv('SOCKET_IO_ALLOW_EIO3', true),
      pingTimeout: parseIntegerEnv(['SOCKET_IO_PING_TIMEOUT_MS', 'SOCKET_PING_TIMEOUT_MS'], 60_000),
      pingInterval: parseIntegerEnv(
        ['SOCKET_IO_PING_INTERVAL_MS', 'SOCKET_PING_INTERVAL_MS'],
        25_000
      ),
      upgradeTimeout: parseIntegerEnv(
        ['SOCKET_IO_UPGRADE_TIMEOUT_MS', 'SOCKET_UPGRADE_TIMEOUT_MS'],
        10_000
      ),
      maxHttpBufferSize: parseIntegerEnv(
        ['SOCKET_IO_MAX_HTTP_BUFFER_SIZE', 'SOCKET_MAX_HTTP_BUFFER_SIZE'],
        1_000_000
      ),
    },
  };
}

/**
 * Build Socket.IO configuration from environment variables.
 * - SOCKET_IO_CORS_ORIGINS: comma-separated list of allowed origins
 * - NODE_ENV: 'development' allows fallback to localhost
 */
export function getSocketIoConfig(): SocketIoConfig {
  const config = buildSocketIOConfig();
  validateSocketIOConfig(config);

  return config;
}

export function validateSocketIOConfig(config: SocketIOConfig): void {
  const errors: string[] = [];
  const origins = config.server.cors.origin;

  if (origins.length === 0) {
    errors.push('At least one CORS origin must be specified');
  }

  if (!Number.isFinite(config.server.port) || config.server.port <= 0) {
    errors.push('Invalid Socket.IO port');
  }

  if (config.server.transports.length === 0) {
    errors.push('At least one Socket.IO transport must be specified');
  }

  if (errors.length > 0) {
    throw new Error(`Socket.IO configuration errors: ${errors.join('; ')}`);
  }
}

export const socketIOConfig = getSocketIoConfig();
