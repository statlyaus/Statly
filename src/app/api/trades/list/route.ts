import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import {
  TRADE_VIEWS,
  TradeServiceError,
  type LeagueTradeCentreSnapshot,
  type TradeView,
} from '@/server/leagues/trades/tradeContracts';
import { loadAuthorizedLeagueTradeCentre } from '@/server/leagues/trades/tradeReadModel';
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

async function authorizeTradeListRead(
  request: NextRequest
): Promise<{ ok: true; userId: string } | { ok: false; response: NextResponse }> {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Unauthorized', code: 'UNAUTHORIZED' },
        { status: 401, headers: { 'Cache-Control': 'private, no-store' } }
      ),
    };
  }

  return { ok: true, userId };
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
    const auth = await authorizeTradeListRead(request);
    if (!auth.ok) return auth.response;

    if (leagueId) {
      const view = parseTradeView(searchParams.get('view'), status);
      const snapshot = await loadAuthorizedLeagueTradeCentre({
        leagueId,
        userId: auth.userId,
        view,
        cursor,
        pageSize: Math.min(pageSize, 50),
      });
      return NextResponse.json(toLegacyLeagueTradeList(snapshot, pageSize, sortParam, status), {
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }

    const { trades, nextCursor } = await listTradeReviews({
      pageSize,
      cursor,
      dir,
      status,
      archived,
    });

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
    if (e instanceof TradeServiceError) {
      return NextResponse.json(
        { error: e.message, code: e.code },
        { status: e.status, headers: { 'Cache-Control': 'private, no-store' } }
      );
    }
    logger.apiError('GET', '/api/trades/list', e);
    return NextResponse.json(
      { error: 'Failed to list trades', code: 'INTERNAL_ERROR' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }
}

function parseTradeView(value: string | null, legacyStatus?: string): TradeView {
  if (value && (TRADE_VIEWS as readonly string[]).includes(value)) return value as TradeView;
  if (value) throw new TradeServiceError('INVALID_INPUT', 'Unknown trade view.');
  if (legacyStatus && legacyStatus.toUpperCase() !== 'PENDING') return 'history';
  return 'inbox';
}

function toLegacyLeagueTradeList(
  snapshot: LeagueTradeCentreSnapshot,
  requestedPageSize: number,
  sort: string,
  status?: string
) {
  const trades = snapshot.trades.map((trade) => ({
    tradeId: trade.id,
    summary: {
      tradeId: trade.id,
      tradeName: trade.currentOffer.message || undefined,
      status: trade.status,
      teamCount: 2,
      playerNames: trade.currentOffer.players.map((player) => player.name).slice(0, 5),
      lastUpdated: Date.parse(trade.updatedAt),
      archived: [
        'completed',
        'declined',
        'withdrawn',
        'rejected',
        'vetoed',
        'expired',
        'invalidated',
      ].includes(trade.status),
    },
  }));

  return {
    trades,
    pageInfo: {
      nextCursor: snapshot.nextCursor,
      pageSize: Math.min(requestedPageSize, 50),
      sort,
      filters: {
        status: status ?? null,
        archived: null,
        leagueId: snapshot.leagueId,
      },
    },
  };
}
