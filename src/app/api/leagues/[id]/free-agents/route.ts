import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { verifyLeagueMembership } from '@/lib/leagueMembership';
import { successResponse, errorResponse } from '@/lib/apiResponse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { id: leagueId } = params;

  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    return errorResponse('Unauthorized', 401);
  }
  const membership = await verifyLeagueMembership(leagueId, userId);
  if (!membership.isMember) {
    return errorResponse('Forbidden', 403);
  }

  try {
    const snap = await adminDb
      .collection('leagues')
      .doc(leagueId)
      .collection('availablePlayers')
      .where('available', '==', true)
      .get();

    const ids = snap.docs.map((d) => d.id);
    let players: Array<{ id: string; name: string; team?: string; position?: string; injury?: string; waiverExpiresAt?: string }>
      = [];

    if (ids.length) {
      const refs = ids.map((id) => adminDb.collection('players').doc(id));
      const docs = await adminDb.getAll(...refs);
      players = docs
        .filter((d) => d.exists)
        .map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            name: data.name,
            team: data.team,
            position: data.position,
            injury: data.injury ?? data.status,
            waiverExpiresAt: data.waiverExpiresAt || data.waiverExpiry,
          };
        });
    }

    return successResponse({ players });
  } catch (err) {
    return errorResponse('Failed to load free agents');
  }
}
