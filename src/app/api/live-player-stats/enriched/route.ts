export const runtime = 'nodejs';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { adminDb } from '@/lib/firebaseAdmin';

// GET /api/live-player-stats/enriched?matchUid=...
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const matchUid = searchParams.get('matchUid');
    if (!matchUid) {
      return NextResponse.json({ error: 'matchUid parameter is required' }, { status: 400 });
    }

    // Fetch live player stats for match
    const snap = await adminDb
      .collection('player_match_stats')
      .where('match_uid', '==', matchUid)
      .get();

    const players = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        player_uid: d.player_uid ?? doc.id,
        stats: d.stats || {},
        last_seen_at: d.updated_at ?? d.last_seen_at ?? new Date().toISOString(),
      } as { player_uid: string; stats: Record<string, number | null>; last_seen_at: string };
    });

    const ids = Array.from(new Set(players.map((p) => p.player_uid)));
    let metaMap = new Map<
      string,
      { name: string; team: string; position: string; imageUrl?: string; number?: number }
    >();
    if (ids.length > 0) {
      const refs = ids.map((id) => adminDb.collection('players').doc(id));
      const docs = await adminDb.getAll(...refs);
      metaMap = new Map(
        docs
          .filter((d) => d.exists)
          .map((d) => {
            const data = d.data() as
              | {
                  name?: string;
                  team?: string;
                  position?: string;
                  imageUrl?: string;
                  number?: number;
                }
              | undefined;
            return [
              d.id,
              {
                name: data?.name || d.id,
                team: data?.team || '',
                position: data?.position || '',
                imageUrl: data?.imageUrl,
                number: typeof data?.number === 'number' ? data?.number : undefined,
              },
            ] as const;
          })
      );
    }

    const enriched = players.map((p) => {
      const meta = metaMap.get(p.player_uid);
      return {
        ...p,
        meta: {
          name: meta?.name || p.player_uid,
          team: meta?.team || '',
          position: meta?.position || '',
          imageUrl: meta?.imageUrl,
          number: meta?.number,
        },
      };
    });

    return NextResponse.json({
      matchUid,
      players: enriched,
      count: enriched.length,
      source: 'enriched',
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: 'Failed to fetch enriched live player stats', details: e?.message || String(e) },
      { status: 500 }
    );
  }
}
