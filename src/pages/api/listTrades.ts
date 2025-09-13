import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import type * as FirebaseFirestore from 'firebase-admin/firestore';
import { z } from 'zod';

import { adminDb as db } from '@/lib/firebaseAdmin';

import type { NextApiRequest, NextApiResponse } from 'next';

// Query validation
const QuerySchema = z.object({
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().optional(), // base64 encoded { t: number, id: string }
  sort: z.enum(['lastUpdated_desc', 'lastUpdated_asc']).default('lastUpdated_desc'),
  status: z.string().min(1).max(64).optional(), // e.g. pending/accepted/rejected/etc
  archived: z
    .string()
    .optional()
    .transform((v) =>
      v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : undefined
    ),
  leagueId: z.string().min(1).optional(),
});

type CursorShape = { t: number; id: string };

function encodeCursor(c: CursorShape): string {
  return Buffer.from(JSON.stringify(c)).toString('base64');
}
function decodeCursor(s: string | undefined): CursorShape | undefined {
  if (!s) return undefined;
  try {
    const obj = JSON.parse(Buffer.from(s, 'base64').toString('utf8')) as CursorShape;
    if (typeof obj?.t === 'number' && typeof obj?.id === 'string') return obj;
  } catch (_e) {
    // noop
  }
  return undefined;
}

function toTimestamp(val: unknown): Timestamp | undefined {
  if (val && typeof (val as { toMillis?: () => number }).toMillis === 'function')
    return val as Timestamp;
  if (val instanceof Date) return Timestamp.fromDate(val);
  if (typeof val === 'number') return Timestamp.fromMillis(val);
  if (typeof val === 'string') {
    const d = new Date(val);
    if (!Number.isNaN(d.getTime())) return Timestamp.fromDate(d);
  }
  return undefined;
}

// Data shapes
interface TradeState {
  status?: string;
}
interface TradeSummaryInput {
  tradeId?: string;
  status?: string;
  teamCount?: number;
  playerNames?: string[];
  lastUpdated?: unknown;
}
interface TradeReviewDoc {
  summary?: TradeSummaryInput;
  state?: TradeState;
  teamPlayers?: Array<{ name?: string }>;
  lastUpdated?: unknown;
  archived?: boolean;
  leagueId?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).end();
    return;
  }

  const parsed = QuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query parameters', issues: parsed.error.issues });
    return;
  }
  const { pageSize, cursor, sort, status, archived, leagueId } = parsed.data;
  const dir: FirebaseFirestore.OrderByDirection = sort.endsWith('_asc') ? 'asc' : 'desc';

  try {
    let q: FirebaseFirestore.Query = db.collection('tradeReviews');

    if (leagueId) q = q.where('leagueId', '==', leagueId);
    if (typeof archived === 'boolean') q = q.where('archived', '==', archived);
    if (status) q = q.where('state.status', '==', status);

    // Sort by lastUpdated, then tie-break on doc id for stable pagination
    q = q.orderBy('lastUpdated', dir).orderBy(FieldPath.documentId());

    const c = decodeCursor(cursor);
    if (c) {
      const ts = Timestamp.fromMillis(c.t || 0);
      q = q.startAfter(ts, c.id);
    }

    q = q.limit(pageSize);

    const snapshot = await q.get();

    const trades = snapshot.docs.map((doc) => {
      const data = doc.data() as TradeReviewDoc;

      const lastUpdatedTS = toTimestamp(data.lastUpdated) ?? Timestamp.fromMillis(0);
      const teamPlayers: Array<{ name?: string }> = Array.isArray(data.teamPlayers)
        ? data.teamPlayers
        : [];
      const playerNames = teamPlayers
        .map((p) => p?.name)
        .filter(Boolean)
        .slice(0, 5) as string[];

      const s = data.summary ?? {};
      const summary = {
        tradeId: doc.id,
        status: (typeof s.status === 'string' ? s.status : data.state?.status) ?? 'unknown',
        teamCount: typeof s.teamCount === 'number' ? s.teamCount : teamPlayers.length,
        playerNames: Array.isArray(s.playerNames) ? s.playerNames.slice(0, 5) : playerNames,
        lastUpdated: toTimestamp(s.lastUpdated) ?? lastUpdatedTS,
        archived: Boolean(data.archived),
      };

      return { tradeId: doc.id, summary };
    });

    // Build next cursor if page full
    let nextCursor: string | null = null;
    if (snapshot.size === pageSize && snapshot.docs.length > 0) {
      const last = snapshot.docs[snapshot.docs.length - 1];
      const lastUpdatedTS = toTimestamp(last.get('lastUpdated')) ?? Timestamp.fromMillis(0);
      nextCursor = encodeCursor({ t: lastUpdatedTS.toMillis(), id: last.id });
    }

    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=30');
    res.status(200).json({
      trades,
      pageInfo: {
        nextCursor,
        pageSize,
        sort,
        filters: { status: status ?? null, archived: archived ?? null, leagueId: leagueId ?? null },
      },
    });
  } catch (_err) {
    // Fallback: try ordering only by id if lastUpdated is missing on some docs
    // Log the original error for debugging context
    console.error('[listTrades] Primary query failed, falling back to id-only ordering', {
      error: _err instanceof Error ? _err.message : String(_err),
      query: req.query,
    });
    try {
      // Use the already-parsed values instead of re-parsing req.query here
      let q: FirebaseFirestore.Query = db.collection('tradeReviews');
      if (leagueId) q = q.where('leagueId', '==', leagueId);
      if (typeof archived === 'boolean') q = q.where('archived', '==', archived);
      if (status) q = q.where('state.status', '==', status);

      q = q.orderBy(FieldPath.documentId());

      const decoded = decodeCursor(cursor);
      if (decoded) q = q.startAfter(decoded.id);

      q = q.limit(pageSize);
      const snapshot = await q.get();

      const trades = snapshot.docs.map((doc) => {
        const data = doc.data() as TradeReviewDoc;
        const lastUpdatedTS = toTimestamp(data.lastUpdated) ?? Timestamp.fromMillis(0);
        const teamPlayers: Array<{ name?: string }> = Array.isArray(data.teamPlayers)
          ? data.teamPlayers
          : [];
        const playerNames = teamPlayers
          .map((p) => p?.name)
          .filter(Boolean)
          .slice(0, 5) as string[];

        const s = data.summary ?? {};
        const summary = {
          tradeId: doc.id,
          status: (typeof s.status === 'string' ? s.status : data.state?.status) ?? 'unknown',
          teamCount: typeof s.teamCount === 'number' ? s.teamCount : teamPlayers.length,
          playerNames: Array.isArray(s.playerNames) ? s.playerNames.slice(0, 5) : playerNames,
          lastUpdated: toTimestamp(s.lastUpdated) ?? lastUpdatedTS,
          archived: Boolean(data.archived),
        };
        return { tradeId: doc.id, summary };
      });

      let nextCursor: string | null = null;
      if (snapshot.size === pageSize && snapshot.docs.length > 0) {
        const last = snapshot.docs[snapshot.docs.length - 1];
        nextCursor = encodeCursor({ t: 0, id: last.id });
      }

      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=30');
      res.status(200).json({
        trades,
        pageInfo: {
          nextCursor,
          pageSize,
          sort: 'lastUpdated_desc',
          filters: {
            status: status ?? null,
            archived: archived ?? null,
            leagueId: leagueId ?? null,
          },
          degraded: true,
        },
      });
      return;
    } catch (e) {
      res
        .status(500)
        .json({ error: 'Failed to list trades', details: (e as Error)?.message ?? String(e) });
    }
  }
}
