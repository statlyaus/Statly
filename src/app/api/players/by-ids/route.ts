export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';

import { adminDb } from '@/lib/firebaseAdmin';

// Simple in-memory cache with TTL per id
const CACHE_TTL_MS = 60_000; // 60s
const cache = new Map<string, { data: { id: string; name: string; team: string; position: string; imageUrl?: string; number?: number };
  expiresAt: number }>();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const ids: unknown = body?.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'ids must be a non-empty array' }, { status: 400 });
    }
    // Sanitize IDs (basic shape like ply_...)
    const safeIds = ids
      .map((x) => (typeof x === 'string' ? x.trim() : ''))
      .filter((x) => x.length > 0)
      .slice(0, 1000); // safety cap

    if (safeIds.length === 0) {
      return NextResponse.json({ players: [] }, { status: 200 });
    }

    // Split into cache hits and misses
    const now = Date.now();
    const hits: Array<{ id: string; name: string; team: string; position: string; imageUrl?: string; number?: number }> = [];
    const misses: string[] = [];
    for (const id of safeIds) {
      const entry = cache.get(id);
      if (entry && entry.expiresAt > now) {
        hits.push(entry.data);
      } else {
        misses.push(id);
      }
    }

    let fetched: Array<{ id: string; name: string; team: string; position: string; imageUrl?: string; number?: number }> = [];
    if (misses.length > 0) {
      const refs = misses.map((id) => adminDb.collection('players').doc(id));
      const docs = await adminDb.getAll(...refs);
      fetched = docs
        .map((d) => {
          if (!d.exists) return null;
          const data = d.data() as { name?: string; team?: string; position?: string; imageUrl?: string; number?: number } | undefined;
          const item = {
            id: d.id,
            name: data?.name || d.id,
            team: data?.team || '',
            position: data?.position || '',
            imageUrl: data?.imageUrl,
            number: typeof data?.number === 'number' ? data?.number : undefined,
          };
          cache.set(d.id, { data: item, expiresAt: now + CACHE_TTL_MS });
          return item;
        })
        .filter(Boolean) as Array<{ id: string; name: string; team: string; position: string; imageUrl?: string; number?: number }>;
    }

    const players = [...hits, ...fetched];
    return NextResponse.json({ players }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { error: 'Failed to fetch players by ids', details: e?.message || String(e) },
      { status: 500 }
    );
  }
}
