// src/app/api/socketio/route.ts
// Node runtime is required for Socket.IO + Redis adapter
export const runtime = 'nodejs';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

// --- Realtime types shared with client ---
type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

export type DraftLiveState = {
  onClockTeamId?: string;
  currentPick?: number;
  isYourTurn?: boolean;
};

export type DraftSnapshot = {
  draft: any | null;
  participants: any[] | Record<string, any> | Map<string, any>;
  picks: any[] | Record<string, any> | Map<string, any>;
  availablePlayers: any[] | Record<string, any> | Map<string, any>;
  liveState?: DraftLiveState | null;
  ts?: number; // server event time (ms)
};

export type DraftDelta = {
  type: 'PICK_MADE' | 'PLAYER_REMOVED' | 'PLAYER_ADDED' | 'QUEUE_UPDATED' | 'STATE_PATCH' | 'SNAPSHOT';
  payload: any;
  ts?: number;
};

// -------------------- Singleton Socket.IO server --------------------
import type { Server as IOServer, Socket } from 'socket.io';

// Avoid double init during HMR in dev
declare global {
   
  var __statly_io__: IOServer | undefined;
   
  var __statly_eventlog__: Map<string, DraftDelta[]> | undefined;
}

let io: IOServer | undefined;

// Optional Redis adapter (recommended in prod)
let useRedis = false;
let redisClientPub: any;
let redisClientSub: any;
let redis: any; // dynamic import holder
let createAdapter: any;

// In-memory ring buffer (dev fallback)
const memLog: Map<string, DraftDelta[]> =
  globalThis.__statly_eventlog__ ?? new Map<string, DraftDelta[]>();
globalThis.__statly_eventlog__ = memLog;

const LOG_CAP = 500;

async function ensureRedis() {
  if (!process.env.REDIS_URL) return false;
  if (useRedis) return true;
  const [{ createClient }, adapter] = await Promise.all([
    import('redis'),
    import('@socket.io/redis-adapter'),
  ]);
  redis = { createClient };
  createAdapter = adapter.createAdapter;

  redisClientPub = redis.createClient({ url: process.env.REDIS_URL });
  redisClientSub = redis.createClient({ url: process.env.REDIS_URL });
  await Promise.all([redisClientPub.connect(), redisClientSub.connect()]);
  useRedis = true;
  return true;
}

async function appendDelta(draftId: string, delta: DraftDelta) {
  const withTs: DraftDelta = { ...delta, ts: delta.ts ?? Date.now() };

  if (useRedis) {
    const key = `draft:${draftId}:events`;
    // store JSON lines, trim list length
    await redisClientPub.rPush(key, JSON.stringify(withTs));
    await redisClientPub.lTrim(key, -LOG_CAP, -1);
  } else {
    const list = memLog.get(draftId) ?? [];
    list.push(withTs);
    if (list.length > LOG_CAP) list.splice(0, list.length - LOG_CAP);
    memLog.set(draftId, list);
  }
}

async function getDeltasSince(draftId: string, since: number): Promise<DraftDelta[]> {
  if (useRedis) {
    const key = `draft:${draftId}:events`;
    const raw: string[] = await redisClientPub.lRange(key, 0, -1);
    const parsed = raw.map((s) => {
      try {
        return JSON.parse(s) as DraftDelta;
      } catch {
        return null;
      }
    }).filter(Boolean) as DraftDelta[];
    return parsed.filter((d) => (d.ts ?? 0) > since);
  } else {
    const list = memLog.get(draftId) ?? [];
    return list.filter((d) => (d.ts ?? 0) > since);
  }
}

// Lazily start a Socket.IO server (dev-friendly)
// In serverless/prod, prefer a dedicated long-lived server process.
async function ensureIO() {
  if (io) return io;

  const { Server } = await import('socket.io');

  // DEV: Spin up a lightweight HTTP server on a local port if not running in serverless
  // You can set SOCKETIO_PORT to an allowed port. Default 3101.
  const port = Number(process.env.SOCKETIO_PORT ?? 3101);

  // Reuse global instance in dev
  if (globalThis.__statly_io__) {
    io = globalThis.__statly_io__;
    return io;
  }

  // Create a standalone Socket.IO server (http server internally)
  io = new Server(port, {
    path: '/socket.io', // standard client default
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
  });

  // Optional Redis adapter
  if (await ensureRedis()) {
    io.adapter(createAdapter(redisClientPub, redisClientSub));
  }

  io.on('connection', (socket: Socket) => {
    // Client joins a specific draft room
    socket.on('draft:join', ({ draftId }: { draftId: string }) => {
      if (!draftId) return;
      const room = `draft:${draftId}`;
      socket.join(room);
    });

    // Client requests backfill since a timestamp
    socket.on('draft:backfill', async ({ draftId, since }: { draftId: string; since?: number }) => {
      if (!draftId) return;
      const ts = Number(since ?? 0);
      const deltas = await getDeltasSince(draftId, ts);
      socket.emit('draft:backfill', deltas);
    });

    socket.on('disconnect', () => {
      // noop
    });
  });

  globalThis.__statly_io__ = io;
   
  console.log(
    `✅ Socket.IO server listening on port ${port} (redis=${useRedis ? 'on' : 'off'})`
  );

  return io;
}

// ----------------- Public helpers (call from your APIs) -----------------
export async function publishDraftSnapshot(draftId: string, snapshot: DraftSnapshot) {
  const server = await ensureIO();
  const payload: DraftDelta = { type: 'SNAPSHOT', payload: snapshot, ts: Date.now() };
  await appendDelta(draftId, payload);
  server.to(`draft:${draftId}`).emit('draft:snapshot', snapshot);
}

export async function publishDraftDelta(draftId: string, delta: DraftDelta) {
  const server = await ensureIO();
  const withTs: DraftDelta = { ...delta, ts: delta.ts ?? Date.now() };
  await appendDelta(draftId, withTs);
  server.to(`draft:${draftId}`).emit('draft:delta', withTs);
}

// ----------------------- Minimal HTTP responders -----------------------
export async function GET(request: NextRequest) {
  // Touch the server so it boots in dev and we can report status
  await ensureIO();

  const { searchParams } = new URL(request.url);
  const op = searchParams.get('op');
  if (op === 'backfill') {
    const draftId = searchParams.get('draftId') ?? '';
    const since = Number(searchParams.get('since') ?? 0);
    if (!draftId) {
      return NextResponse.json({ ok: false, error: 'draftId required' }, { status: 400 });
    }
    const deltas = await getDeltasSince(draftId, since);
    return NextResponse.json({ ok: true, deltas, count: deltas.length });
  }

  return NextResponse.json({
    ok: true,
    socket: {
      running: !!io,
      transportPath: '/socket.io',
      redis: useRedis,
    },
    timestamp: Date.now(),
  });
}

export async function POST(_request: NextRequest) {
  // no-op; reserved for future admin ops
  return new Response('ok', {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=UTF-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
