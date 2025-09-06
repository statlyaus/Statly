'use strict';

/** Minimal, production-ready Socket.IO sidecar with optional Redis adapter. */
const http = require('http');
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const IORedis = require('ioredis');

const PORT = Number(process.env.SOCKETIO_PORT || 4001);
const APP_ORIGIN = process.env.APP_ORIGIN || 'http://localhost:3000'; // Next.js origin

const server = http.createServer();
const io = new Server(server, {
  path: '/socket.io',
  cors: {
    origin: APP_ORIGIN,
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  connectTimeout: 10000,
});

// Optional: Redis adapter for scale-out
if (process.env.REDIS_URL) {
  const pub = new IORedis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  const sub = new IORedis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  io.adapter(createAdapter(pub, sub));
}

io.on('connection', (socket) => {
  // room join API: client emits { draftId }
  socket.on('draft:join', ({ draftId }) => {
    if (!draftId) return;
    socket.join(`draft:${draftId}`);
    socket.emit('connection:status', { ok: true, draftId });
  });

  // health
  socket.emit('connection:hello', { ts: Date.now() });
});

// Example server-side broadcast helpers (use from API routes or jobs later):
globalThis.__statly_io__ = io;
globalThis.__statly_broadcast__ = {
  draftSnapshot(draftId, snapshot) {
    io.to(`draft:${draftId}`).emit('draft:snapshot', { snapshot, ts: Date.now() });
  },
  draftEvent(draftId, event) {
    io.to(`draft:${draftId}`).emit('draft:event', { event, ts: Date.now() });
  },
};

server.listen(PORT, () => {
  console.log(`[socket] listening on :${PORT} with path /socket.io (origin ${APP_ORIGIN})`);
});

