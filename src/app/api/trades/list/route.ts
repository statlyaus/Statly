import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldPath, Timestamp } from 'firebase-admin/firestore';

function toTimestamp(val: unknown): FirebaseFirestore.Timestamp | undefined {
  if (val && typeof (val as { toMillis?: () => number }).toMillis === 'function') return val as FirebaseFirestore.Timestamp;
  if (val instanceof Date) return Timestamp.fromDate(val);
  if (typeof val === 'number') return Timestamp.fromMillis(val);
  if (typeof val === 'string') {
    const d = new Date(val);
    if (!Number.isNaN(d.getTime())) return Timestamp.fromDate(d);
  }
  return undefined;
}

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const pageSize = Math.min(Math.max(parseInt(searchParams.get('pageSize') || '20'), 1), 100);
    const cursor = searchParams.get('cursor') || undefined;
    const sortParam = searchParams.get('sort') || 'lastUpdated_desc';
    const dir: FirebaseFirestore.OrderByDirection = sortParam.endsWith('_asc') ? 'asc' : 'desc';
    const status = searchParams.get('status') || undefined;
    const archivedParam = searchParams.get('archived') || undefined;
    const archived = archivedParam === 'true' || archivedParam === '1' ? true : archivedParam === 'false' || archivedParam === '0' ? false : undefined;
    const leagueId = searchParams.get('leagueId') || undefined;

    let q: FirebaseFirestore.Query = adminDb.collection('tradeReviews');
    if (leagueId) q = q.where('leagueId', '==', leagueId);
    if (typeof archived === 'boolean') q = q.where('archived', '==', archived);
    if (status) q = q.where('state.status', '==', status);

    q = q.orderBy('lastUpdated', dir).orderBy(FieldPath.documentId());

    if (cursor) {
      try {
        const obj = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as { t?: number; id?: string };
        if (obj?.t && obj?.id) {
          const ts = Timestamp.fromMillis(obj.t);
          q = q.startAfter(ts, obj.id);
        }
      } catch (err) {
        console.warn('Invalid trades list cursor; ignoring', { cursor, error: err instanceof Error ? err.message : String(err) });
      }
    }

    q = q.limit(pageSize);
    const snapshot = await q.get();

    const trades = snapshot.docs.map((doc) => {
      const data = doc.data() as any;
      const lastUpdatedTS = toTimestamp(data?.lastUpdated) ?? Timestamp.fromMillis(0);
      const teamPlayers: Array<{ name?: string }> = Array.isArray(data?.teamPlayers) ? data.teamPlayers : [];
      const playerNames = teamPlayers.map((p) => p?.name).filter(Boolean).slice(0, 5) as string[];
      const s = data?.summary ?? {};
      const summary = {
        tradeId: doc.id,
        status: (typeof s.status === 'string' ? s.status : data?.state?.status) ?? 'unknown',
        teamCount: typeof s.teamCount === 'number' ? s.teamCount : teamPlayers.length,
        playerNames: Array.isArray(s.playerNames) ? s.playerNames.slice(0, 5) : playerNames,
        lastUpdated: toTimestamp(s.lastUpdated) ?? lastUpdatedTS,
        archived: Boolean(data?.archived),
      };
      return { tradeId: doc.id, summary };
    });

    let nextCursor: string | null = null;
    if (snapshot.size === pageSize && snapshot.docs.length > 0) {
      const last = snapshot.docs[snapshot.docs.length - 1];
      const lastUpdatedTS = toTimestamp((last.data() as any)?.lastUpdated) ?? Timestamp.fromMillis(0);
      nextCursor = Buffer.from(JSON.stringify({ t: lastUpdatedTS.toMillis(), id: last.id })).toString('base64');
    }

    return NextResponse.json(
      {
        trades,
        pageInfo: {
          nextCursor,
          pageSize,
          sort: sortParam,
          filters: { status: status ?? null, archived: archived ?? null, leagueId: leagueId ?? null },
        },
      },
      { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=30' } }
    );
  } catch (e) {
    console.error('Failed to list trades', e);
    return NextResponse.json({ error: 'Failed to list trades' }, { status: 500 });
  }
}


