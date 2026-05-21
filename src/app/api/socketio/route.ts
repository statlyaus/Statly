// src/app/api/socketio/route.ts
export const runtime = 'nodejs';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { socketIOConfig } from '@/lib/socketioConfig';
import { getDraftDeltasSince } from '@/server/draft/realtime/draftDeltaLog';
import { getRedis } from '@/server/redis';

// --------------------------- HTTP handlers -------------------------------
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Allow HTTP backfill as well (useful for debugging)
  if (searchParams.get('op') === 'backfill') {
    const draftId = searchParams.get('draftId') ?? '';
    const since = Number(searchParams.get('since') ?? 0);
    if (!draftId)
      return NextResponse.json({ ok: false, error: 'draftId required' }, { status: 400 });
    const deltas = await getDraftDeltasSince(draftId, since);
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
