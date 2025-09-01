import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { verifyLeagueMembership } from '@/lib/leagueMembership';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toMs(v: any): number | undefined {
  if (!v) return undefined;
  if (typeof v?.toDate === 'function') return v.toDate().getTime();
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
  if (typeof v === 'string') {
    const ms = Date.parse(v);
    return Number.isNaN(ms) ? undefined : ms;
  }
  return undefined;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const leagueId = params.id;
  const membership = await verifyLeagueMembership(leagueId, userId);
  if (!membership.isMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const snap = await adminDb
      .collection('leagues').doc(leagueId).collection('availablePlayers')
      .where('available', '==', true)
      .get();

    const ids = snap.docs.map((d) => d.id);
    const players: Array<{ id: string; name?: string; team?: string; position?: string; injury?: string; waiverExpiresAt?: number }> = [];

    if (ids.length) {
      const docs = await adminDb.getAll(...ids.map((id) => adminDb.collection('players').doc(id)));
      docs.forEach((doc, idx) => {
        if (!doc.exists) return;
        const data = doc.data() as any;
        const indexData = snap.docs[idx]?.data() as any;
        const rawExpiry = indexData?.waiverExpiresAt ?? indexData?.waiverExpiry ?? data?.waiverExpiresAt ?? data?.waiverExpiry;
        players.push({
          id: doc.id,
          name: data.name,
          team: data.team,
          position: data.position,
          injury: data.injury ?? data.status,
          waiverExpiresAt: toMs(rawExpiry),
        });
      });
    }

    return NextResponse.json({ players }, { status: 200 });
  } catch (e) {
    console.error('Failed to fetch free agents', e);
    return NextResponse.json({ error: 'Failed to fetch free agents' }, { status: 500 });
  }
}
