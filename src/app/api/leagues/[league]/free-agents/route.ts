import type { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { adminDb } from '@/lib/firebaseAdmin';

export async function GET(_req: NextRequest, { params }: { params: { league: string } }) {
  try {
    const { league } = params;
    if (!league) {
      return errorResponse('League ID is required', 400);
    }

    const snap = await adminDb
      .collection('leagues')
      .doc(league)
      .collection('availablePlayers')
      .where('available', '==', true)
      .get();

    const players = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: data.name,
        team: data.team,
        position: data.position,
        injury: data.injury ?? data.status,
        waiverExpiresAt: data.waiverExpiresAt || data.waiverExpiry,
      };
    });

    return successResponse({ players });
  } catch (err) {
    console.error('Failed to fetch free agents', err);
    return errorResponse('Failed to fetch free agents');
  }
}
