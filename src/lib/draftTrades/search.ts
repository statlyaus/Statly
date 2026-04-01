import 'server-only';

import { adminDb } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

import { DRAFT_TRADE_COLLECTIONS, type DraftTradeDoc } from './contracts';

export interface DraftTradeSearchResult {
  tradeId: string;
  year: number;
  seqInYear: number;
  title: string;
  clubNames: string[];
  clubSlugs: string[];
}

async function resolveTradesCollectionName(): Promise<string> {
  try {
    const pointerSnap = await adminDb
      .collection(DRAFT_TRADE_COLLECTIONS.meta)
      .doc('currentVersion')
      .get();
    if (pointerSnap.exists) {
      const data = pointerSnap.data() as Record<string, unknown>;
      const collections = data.collections as { trades?: unknown } | undefined;
      if (collections && typeof collections.trades === 'string' && collections.trades.length > 0) {
        return collections.trades;
      }
    }
  } catch {
    // fallback below
  }
  return DRAFT_TRADE_COLLECTIONS.trades;
}

function localMatchScore(doc: DraftTradeSearchResult, query: string): number {
  const q = query.toLowerCase();
  let score = 0;
  if (doc.title.toLowerCase().includes(q)) score += 3;
  if (doc.clubNames.some((name) => name.toLowerCase().includes(q))) score += 2;
  if (doc.tradeId.toLowerCase().includes(q)) score += 1;
  return score;
}

async function localFallbackSearch(query: string, limit: number): Promise<DraftTradeSearchResult[]> {
  const tradesCollection = await resolveTradesCollectionName();
  const snap = await adminDb
    .collection(tradesCollection)
    .orderBy('year', 'desc')
    .orderBy('seqInYear', 'asc')
    .limit(1500)
    .get();

  const base = snap.docs.map((doc) => {
    const data = doc.data() as Partial<DraftTradeDoc>;
    return {
      tradeId: data.tradeId ?? doc.id,
      year: data.year ?? 0,
      seqInYear: data.seqInYear ?? 0,
      title: data.title ?? '',
      clubNames: Array.isArray(data.clubNames) ? data.clubNames : [],
      clubSlugs: Array.isArray(data.clubSlugs) ? data.clubSlugs : [],
    };
  });

  const q = query.trim().toLowerCase();
  return base
    .map((doc) => ({ doc, score: localMatchScore(doc, q) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.doc.year !== a.doc.year) return b.doc.year - a.doc.year;
      return a.doc.seqInYear - b.doc.seqInYear;
    })
    .slice(0, limit)
    .map((row) => row.doc);
}

async function endpointSearch(query: string, limit: number): Promise<DraftTradeSearchResult[]> {
  const endpoint = process.env.DRAFT_TRADE_SEARCH_ENDPOINT;
  if (!endpoint) {
    return localFallbackSearch(query, limit);
  }

  const apiKey = process.env.DRAFT_TRADE_SEARCH_API_KEY;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ q: query, limit }),
      cache: 'no-store',
    });

    if (!response.ok) {
      logger.warn('Draft trade search provider failed; falling back to local search', {
        status: response.status,
      });
      return localFallbackSearch(query, limit);
    }

    const payload = (await response.json()) as { hits?: DraftTradeSearchResult[] };
    if (!Array.isArray(payload.hits)) {
      return localFallbackSearch(query, limit);
    }
    return payload.hits.slice(0, limit);
  } catch (error) {
    logger.warn('Draft trade search provider unreachable; falling back to local search', {
      error: error instanceof Error ? error.message : String(error),
    });
    return localFallbackSearch(query, limit);
  }
}

export async function searchDraftTrades(
  query: string,
  limit = 50
): Promise<DraftTradeSearchResult[]> {
  const q = query.trim();
  if (q.length < 2) {
    return [];
  }

  return endpointSearch(q, Math.max(1, Math.min(limit, 200)));
}

