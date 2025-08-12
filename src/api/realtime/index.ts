import type { Server as HTTPServer } from 'http';
import { Server as IOServer } from 'socket.io';

let io: IOServer | undefined;

function parseCookies(header?: string) {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (!name) continue;
    cookies[name] = decodeURIComponent(rest.join('='));
  }
  return cookies;
}

/**
 * Initialize Socket.IO and attach it to an existing HTTP server.
 * Creates draft specific namespaces of the form `/draft/:id`.
 */
export function initRealtime(server: HTTPServer) {
  io = new IOServer(server, {
    cors: {
      origin: true,
      credentials: true,
    },
  });

  io.of(/^\/draft\/[\w-]+$/)
    .use(async (socket, next) => {
      try {
        const cookies = parseCookies(socket.handshake.headers.cookie);
        const token = cookies.token || cookies.jwt || cookies.__session;
        if (!token) throw new Error('Missing token');
        const { adminAuth } = await import('../../lib/firebaseAdmin');
        const decoded = await adminAuth.verifyIdToken(token);
        socket.data.user = decoded;
        next();
      } catch {
        next(new Error('Unauthorized'));
      }
    })
    .on('connection', () => {
      /* Namespace connection established */
    });

  return io;
}

function getNamespace(draftId: string) {
  if (!io) throw new Error('Realtime server not initialized');
  return io.of(`/draft/${draftId}`);
}

export function emitPickMade(draftId: string, payload: unknown) {
  io && getNamespace(draftId).emit('pickMade', payload);
}

export function emitClock(draftId: string, payload: unknown) {
  io && getNamespace(draftId).emit('clock', payload);
}

export function emitQueueUpdated(draftId: string, payload: unknown) {
  io && getNamespace(draftId).emit('queueUpdated', payload);
}
