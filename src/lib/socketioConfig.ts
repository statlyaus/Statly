/* eslint-disable no-console */
import type { ServerOptions } from 'socket.io';

/**
 * Build Socket.IO configuration from environment variables.
 * - SOCKET_IO_CORS_ORIGINS: comma-separated list of allowed origins
 * - NODE_ENV: 'development' allows fallback to localhost
 */
export function getSocketIoConfig(): Partial<ServerOptions> {
  let origins = (process.env.SOCKET_IO_CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (origins.length === 0 && process.env.NODE_ENV !== 'production') {
    // Dev fallback
    origins = ['http://localhost:3000'];
    console.warn('[socketioConfig] No SOCKET_IO_CORS_ORIGINS set, defaulting to localhost in dev.');
  }

  if (origins.length === 0) {
    throw new Error('Socket.IO configuration errors: At least one CORS origin must be specified');
  }

  const clientUrl = process.env.CLIENT_URL;
  if (!clientUrl && process.env.NODE_ENV === 'production') {
    throw new Error('Socket.IO configuration errors: Invalid client URL');
  }

  return {
    cors: {
      origin: origins,
      credentials: true,
    },
  };
}
