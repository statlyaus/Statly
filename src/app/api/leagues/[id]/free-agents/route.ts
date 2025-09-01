import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { verifyLeagueMembership } from '@/lib/leagueMembership';
import { successResponse, errorResponse } from '@/lib/apiResponse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = await params;
  try {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) return errorResponse('Unauthorized', 401);
    const membership = await verifyLeagueMembership(leagueId, userId);
    if (!membership.isMember) return errorResponse('Forbidden', 403);

    const indexSnap = await adminDb
      .collection('leagues')
      .doc(leagueId)
      .collection('availablePlayers')
      .where('available', '==', true)
      .get();

    const ids = indexSnap.docs.map((d) => d.id);
    let players: Array<{ id: string; name: string; team?: string; position?: string; injury?: string; waiverExpiresAt?: number }> = [];
    if (ids.length) {
      const refs = ids.map((id) => adminDb.collection('players').doc(id));
      const docs = await adminDb.getAll(...refs);
      players = docs
        .filter((d) => d.exists)
        .map((d) => {
          const data = d.data() as any;
          const rawExpiry = data.waiverExpiresAt || data.waiverExpiry;
          const toMs = (v: any): number | undefined => {
            if (!v) return undefined;
            if (typeof v?.toDate === 'function') return v.toDate().getTime();
            if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
            if (typeof v === 'string') {
              const ms = Date.parse(v);
              return Number.isNaN(ms) ? undefined : ms;
            }
            return undefined;
          };
          return {
            id: d.id,
            name: data.name,
            team: data.team,
            position: data.position,
            injury: data.injury ?? data.status,
            waiverExpiresAt: toMs(rawExpiry),
          };
        });
    }

    return successResponse({ players });
  } catch (err) {
    return errorResponse('Failed to load free agents', 500, undefined, {
      error: err instanceof Error ? err.message : err,
    });
  }
}
