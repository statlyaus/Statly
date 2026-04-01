// src/app/api/socketio/route.ts
export const runtime = 'nodejs';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { socketIOConfig } from '@/lib/socketioConfig';
import { getRedis } from '@/server/redis';

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

const LOG_CAP = 500;

async function getDeltasSince(draftId: string, since: number): Promise<DraftDelta[]> {
  const redis = await getRedis();
  if (!redis) {
    return [];
  }

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

// --------------------------- HTTP handlers -------------------------------
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Allow HTTP backfill as well (useful for debugging)
  if (searchParams.get('op') === 'backfill') {
    const draftId = searchParams.get('draftId') ?? '';
    const since = Number(searchParams.get('since') ?? 0);
    if (!draftId)
      return NextResponse.json({ ok: false, error: 'draftId required' }, { status: 400 });
    const deltas = await getDeltasSince(draftId, since);
    return NextResponse.json({ ok: true, deltas, count: deltas.length });
  }

  const redis = await getRedis();
  const configuredUrl = process.env.SOCKET_SERVER_URL?.trim() || '';
  const port = socketIOConfig.server.port;
  const path = '/socket.io';

  return NextResponse.json({
    ok: true,
    socket: {
      running: true,
      path,
      redis: Boolean(redis),
      port,
      url: configuredUrl || undefined,
    },
    now: Date.now(),
  });
}

function getAllowedOrigin(_request: NextRequest): string {
  // In production, use environment variable or default to your domain
  if (process.env.NODE_ENV === 'production') {
    return process.env.ALLOWED_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || 'https://statly.app';
  }
  // In development, allow localhost
  return '*'; // Development only - allows localhost:3000, etc.
}

export async function POST(request: NextRequest) {
  // Engine.IO polling POST compatibility (no-op)
  const origin = request.headers.get('origin');
  const allowedOrigin = getAllowedOrigin(request);
  const corsOrigin = allowedOrigin === '*' ? '*' : origin || allowedOrigin;

  const headers: Record<string, string> = {
    'Content-Type': 'text/plain; charset=UTF-8',
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  if (corsOrigin !== '*') {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return new Response('ok', {
    status: 200,
    headers,
  });
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  const allowedOrigin = getAllowedOrigin(request);
  const corsOrigin = allowedOrigin === '*' ? '*' : origin || allowedOrigin;

  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
  if (corsOrigin !== '*') {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return new Response(null, {
    status: 200,
    headers,
  });
}
