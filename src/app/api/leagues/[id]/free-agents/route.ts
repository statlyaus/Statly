import type { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { adminDb } from '@/lib/firebaseAdmin';
import { getUserIdFromRequest } from '@/lib/serverAuth';
import { verifyLeagueMembership } from '@/lib/leagueMembership';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id: leagueId } = params;
    const userId = await getUserIdFromRequest(_req);
    if (!userId) return errorResponse('Unauthorized', 401);
    const membership = await verifyLeagueMembership(leagueId, userId);
    if (!membership.isMember) return errorResponse('Forbidden', 403);

    const snap = await adminDb
      .collection('leagues')
      .doc(leagueId)
      .collection('availablePlayers')
      .where('available', '==', true)
      .get();

    const players = snap.docs.map((doc) => {
      const data = doc.data() as any;
      const rawExpiry = data.waiverExpiresAt || data.waiverExpiry;
      return {
        id: doc.id,
        name: data.name,
        team: data.team,
        position: data.position,
        injury: data.injury ?? data.status,
        waiverExpiresAt: toMs(rawExpiry),
      };
    });

    return successResponse({ players });
  } catch (e) {
    console.error('Failed to load free agents', e);
    return errorResponse('Failed to load free agents');
  }
}
