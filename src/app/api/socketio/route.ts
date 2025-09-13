// src/app/api/socketio/route.ts
export const runtime = 'nodejs';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getRedis, getPubSub } from '@/server/redis';

type DeltaType =
  | 'SNAPSHOT'
  | 'PICK_MADE'
  | 'PLAYER_REMOVED'
  | 'PLAYER_ADDED'
  | 'QUEUE_UPDATED'
  | 'STATE_PATCH';

export type DraftDelta = {
  type: DeltaType;
  payload: any;
  ts?: number; // epoch ms
};

declare global {
   
  var __statly_io__: import('socket.io').Server | undefined;
   
  var __statly_eventlog__: Map<string, DraftDelta[]> | undefined;
}

const LOG_CAP = 500;

// -------- Backfill storage (Redis ZSET if available, else memory) -------
async function appendDelta(draftId: string, delta: DraftDelta) {
  const ts = delta.ts ?? Date.now();
  const redis = await getRedis();

  if (redis) {
    const key = `draft:${draftId}:events`;
    const val = JSON.stringify({ ...delta, ts });
    // score = ts; keep last LOG_CAP by trimming oldest
    await redis.zAdd(key, [{ score: ts, value: val }]);
    const size = await redis.zCard(key);
    if (size > LOG_CAP) {
      await redis.zRemRangeByRank(key, 0, size - LOG_CAP - 1);
    }
    return;
  }

  const mem = (globalThis.__statly_eventlog__ ??= new Map());
  const list = mem.get(draftId) ?? [];
  list.push({ ...delta, ts });
  if (list.length > LOG_CAP) list.splice(0, list.length - LOG_CAP);
  mem.set(draftId, list);
}

async function getDeltasSince(draftId: string, since: number): Promise<DraftDelta[]> {
  const redis = await getRedis();
  if (redis) {
    const key = `draft:${draftId}:events`;
    const vals = await redis.zRangeByScore(key, (since + 1) as number, '+inf');
    return vals
      .map((v) => {
        try {
          return JSON.parse(v) as DraftDelta;
        } catch {
          return null;
        }
      })
      .filter(Boolean) as DraftDelta[];
  }

  const mem = (globalThis.__statly_eventlog__ ??= new Map());
  const list = mem.get(draftId) ?? [];
  return list.filter((d: DraftDelta) => (d.ts ?? 0) > since);
}

// ----------------- Socket.IO singleton + Redis adapter -------------------
let io: import('socket.io').Server | undefined;

async function ensureIO() {
  if (io) return io;
  if (globalThis.__statly_io__) {
    io = globalThis.__statly_io__;
    return io;
  }

  const { Server } = await import('socket.io');
  io = new Server(Number(process.env.SOCKETIO_PORT ?? 3101), {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  // Try Redis adapter (best-effort)
  const pubsub = await getPubSub();
  if (pubsub) {
    const { createAdapter } = await import('@socket.io/redis-adapter');
    io.adapter(createAdapter(pubsub.pub, pubsub.sub));
     
    console.log('🔌 Socket.IO using Redis adapter');
  } else {
     
    console.log('🔌 Socket.IO running without Redis adapter (memory-only)');
  }

  io.on('connection', (socket) => {
    socket.on('draft:join', ({ draftId }: { draftId: string }) => {
      if (!draftId) return;
      socket.join(`draft:${draftId}`);
    });

    socket.on('draft:backfill', async ({ draftId, since }: { draftId: string; since?: number }) => {
      if (!draftId) return;
      const deltas = await getDeltasSince(draftId, Number(since ?? 0));
      socket.emit('draft:backfill', deltas);
    });
  });

  globalThis.__statly_io__ = io;
   
  console.log(`✅ Socket.IO listening on :${process.env.SOCKETIO_PORT ?? 3101}`);
  return io;
}

// --------------- Helpers for your API routes to broadcast ----------------
async function publishDraftSnapshot(draftId: string, snapshot: any) {
  const server = await ensureIO();
  const delta: DraftDelta = { type: 'SNAPSHOT', payload: snapshot, ts: Date.now() };
  await appendDelta(draftId, delta);
  server.to(`draft:${draftId}`).emit('draft:snapshot', snapshot);
}

async function publishDraftDelta(draftId: string, delta: DraftDelta) {
  const server = await ensureIO();
  const withTs = { ...delta, ts: delta.ts ?? Date.now() };
  await appendDelta(draftId, withTs);
  server.to(`draft:${draftId}`).emit('draft:delta', withTs);
}

// --------------------------- HTTP handlers -------------------------------
export async function GET(request: NextRequest) {
  await ensureIO();
  const { searchParams } = new URL(request.url);

  // Allow HTTP backfill as well (useful for debugging)
  if (searchParams.get('op') === 'backfill') {
    const draftId = searchParams.get('draftId') ?? '';
    const since = Number(searchParams.get('since') ?? 0);
    if (!draftId) return NextResponse.json({ ok: false, error: 'draftId required' }, { status: 400 });
    const deltas = await getDeltasSince(draftId, since);
    return NextResponse.json({ ok: true, deltas, count: deltas.length });
  }

  const redis = await getRedis();
  return NextResponse.json({
    ok: true,
    socket: {
      running: true,
      path: '/socket.io',
      redis: Boolean(redis),
      port: Number(process.env.SOCKETIO_PORT ?? 3101),
    },
    now: Date.now(),
  });
}

export async function POST() {
  // Engine.IO polling POST compatibility (no-op)
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
