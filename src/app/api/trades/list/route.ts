import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { verifyLeagueMembership } from '@/lib/leagueMembership';
import { FieldPath, Timestamp } from 'firebase-admin/firestore';

function toTimestamp(val: unknown): FirebaseFirestore.Timestamp | undefined {
  if (val && typeof (val as any).toMillis === 'function') return val as FirebaseFirestore.Timestamp;
  if (val instanceof Date) return Timestamp.fromDate(val);
  if (typeof val === 'number' && Number.isFinite(val)) return Timestamp.fromMillis(val);
  if (typeof val === 'string') {
    const ms = Date.parse(val);
    if (Number.isFinite(ms)) return Timestamp.fromMillis(ms);
  }
  return undefined;
}

export const runtime = 'nodejs';

async function authorizeTradeListRead(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  return { userId };
}

async function authorizeLeagueTradeList(request: NextRequest, leagueId: string) {
  const auth = await authorizeTradeListRead(request);
  if ('response' in auth) {
    return auth.response;
  }

  const membership = await verifyLeagueMembership(leagueId, auth.userId);
  if (!membership.isMember) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return null;
}

function parseBooleanParam(raw?: string | null): boolean | undefined {
  if (raw == null) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return undefined;
}

function applyCursor(q: FirebaseFirestore.Query, cursor: string | undefined) {
  if (!cursor) return q;
  try {
    const obj = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as {
      t?: number;
      id?: string;
    };
    if (obj?.t && obj?.id) {
      return q.startAfter(Timestamp.fromMillis(obj.t), obj.id);
    }
  } catch (err) {
    console.warn('Invalid trades list cursor; ignoring', {
      cursor,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return q;
}

function getNextCursor(
  snapshot: FirebaseFirestore.QuerySnapshot,
  pageSize: number,
  timestampField: string
): string | null {
  if (snapshot.size !== pageSize || snapshot.docs.length === 0) return null;
  const last = snapshot.docs[snapshot.docs.length - 1];
  const lastUpdatedTS =
    toTimestamp((last.data() as any)?.[timestampField]) ?? Timestamp.fromMillis(0);
  return Buffer.from(JSON.stringify({ t: lastUpdatedTS.toMillis(), id: last.id })).toString(
    'base64'
  );
}

async function listLeagueTrades({
  leagueId,
  pageSize,
  cursor,
  dir,
  status,
}: {
  leagueId: string;
  pageSize: number;
  cursor?: string;
  dir: FirebaseFirestore.OrderByDirection;
  status?: string;
}) {
  let q: FirebaseFirestore.Query = adminDb.collection('leagues').doc(leagueId).collection('trades');
  if (status) q = q.where('status', '==', status);
  q = q.orderBy('updatedAt', dir).orderBy(FieldPath.documentId());
  q = applyCursor(q, cursor).limit(pageSize);
  const snapshot = await q.get();

  const trades = snapshot.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>;
    const lastUpdatedTS =
      toTimestamp(data.updatedAt) ?? toTimestamp(data.createdAt) ?? Timestamp.fromMillis(0);
    const playersOffered = Array.isArray(data.playersOffered) ? data.playersOffered : [];
    const playersRequested = Array.isArray(data.playersRequested) ? data.playersRequested : [];
    const playerNames = [...playersOffered, ...playersRequested]
      .filter((playerId): playerId is string => typeof playerId === 'string')
      .slice(0, 5);
    const tradeName =
      typeof data.message === 'string' && data.message.trim() ? data.message.trim() : undefined;

    return {
      tradeId: doc.id,
      summary: {
        tradeId: doc.id,
        tradeName,
        status: typeof data.status === 'string' ? data.status : 'PENDING',
        teamCount: 2,
        playerNames,
        lastUpdated: lastUpdatedTS.toMillis(),
        archived: false,
      },
    };
  });

  return {
    trades,
    nextCursor: getNextCursor(snapshot, pageSize, 'updatedAt'),
  };
}

async function listTradeReviews({
  pageSize,
  cursor,
  dir,
  status,
  archived,
}: {
  pageSize: number;
  cursor?: string;
  dir: FirebaseFirestore.OrderByDirection;
  status?: string;
  archived?: boolean;
}) {
  let q: FirebaseFirestore.Query = adminDb.collection('tradeReviews');
  if (typeof archived === 'boolean') q = q.where('archived', '==', archived);
  if (status) q = q.where('state.status', '==', status);
  q = q.orderBy('lastUpdated', dir).orderBy(FieldPath.documentId());
  q = applyCursor(q, cursor).limit(pageSize);
  const snapshot = await q.get();

  const trades = snapshot.docs.map((doc) => {
    const data = doc.data() as any;
    const lastUpdatedTS = toTimestamp(data?.lastUpdated) ?? Timestamp.fromMillis(0);
    const teamPlayers: Array<{ name?: string }> = Array.isArray(data?.teamPlayers)
      ? data.teamPlayers
      : [];
    const playerNames = teamPlayers
      .map((p) => p?.name)
      .filter(Boolean)
      .slice(0, 5) as string[];
    const s = data?.summary ?? {};
    const summary = {
      tradeId: doc.id,
      status: (typeof s.status === 'string' ? s.status : data?.state?.status) ?? 'unknown',
      teamCount: typeof s.teamCount === 'number' ? s.teamCount : teamPlayers.length,
      playerNames: Array.isArray(s.playerNames) ? s.playerNames.slice(0, 5) : playerNames,
      lastUpdated: (toTimestamp(s.lastUpdated) ?? lastUpdatedTS).toMillis(),
      archived: Boolean(data?.archived),
    };
    return { tradeId: doc.id, summary };
  });

  return {
    trades,
    nextCursor: getNextCursor(snapshot, pageSize, 'lastUpdated'),
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const pageSize = Math.min(Math.max(parseInt(searchParams.get('pageSize') || '20'), 1), 100);
    const cursor = searchParams.get('cursor') || undefined;
    const sortParam = searchParams.get('sort') || 'lastUpdated_desc';
    const dir: FirebaseFirestore.OrderByDirection = sortParam.endsWith('_asc') ? 'asc' : 'desc';
    const status = searchParams.get('status') || undefined;
    const archived = parseBooleanParam(searchParams.get('archived'));
    const leagueId = searchParams.get('leagueId') || undefined;

    if (leagueId) {
      const authError = await authorizeLeagueTradeList(request, leagueId);
      if (authError) return authError;
    } else {
      const auth = await authorizeTradeListRead(request);
      if ('response' in auth) return auth.response;
    }

    const { trades, nextCursor } = leagueId
      ? await listLeagueTrades({ leagueId, pageSize, cursor, dir, status })
      : await listTradeReviews({ pageSize, cursor, dir, status, archived });

    return NextResponse.json(
      {
        trades,
        pageInfo: {
          nextCursor,
          pageSize,
          sort: sortParam,
          filters: {
            status: status ?? null,
            archived: archived ?? null,
            leagueId: leagueId ?? null,
          },
        },
      },
      {
        headers: {
          'Cache-Control': 'private, no-store',
        },
      }
    );
  } catch (e) {
    console.error('Failed to list trades', e);
    return NextResponse.json({ error: 'Failed to list trades' }, { status: 500 });
  }
}
