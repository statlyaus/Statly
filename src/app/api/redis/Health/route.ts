// src/app/api/redis/health/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

import { getRedis } from '@/server/redis';

export async function GET() {
  const redis = await getRedis();
  if (!redis) return NextResponse.json({ ok: false, error: 'no redis' }, { status: 503 });

  const key = 'statly:health';
  await redis.set(key, 'ok', { EX: 60 });
  const val = await redis.get(key);
  return NextResponse.json({ ok: val === 'ok', val });
}
