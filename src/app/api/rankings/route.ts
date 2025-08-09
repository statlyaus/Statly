// src/app/api/rankings/route.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { QueryDocumentSnapshot, DocumentData } from 'firebase-admin/firestore';

import { computeTotalValue, defaultCategoryConfig } from '@/lib/ratings/computeTotalValue';
import type { PlayerBase, RankingsResponse } from '@/types/players';
import { DEFAULT_CATEGORIES, INVERT_CATEGORIES } from '@/types/players';

// ⚠️ Adjust this import if your admin export differs
import { adminDb } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs'; // ensure server runtime
const CACHE_SECONDS = 600; // 10 minutes

/** Parse boolean-ish query param. */
function qBool(req: NextRequest, key: string, fallback: boolean): boolean {
  const v = req.nextUrl.searchParams.get(key);
  if (v === null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

/** Parse number query param with fallback. */
function qNum(req: NextRequest, key: string, fallback: number): number {
  const v = req.nextUrl.searchParams.get(key);
  if (v === null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Parse comma-separated list param into string[]. */
function qList(req: NextRequest, key: string): string[] | null {
  const v = req.nextUrl.searchParams.get(key);
  if (!v) return null;
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Coerce an arbitrary Firestore doc into PlayerBase.
 * - Prefers a nested `stats` object; otherwise builds one from flat fields.
 */
function toPlayerBase(id: string, data: Record<string, unknown>): PlayerBase {
  const name = String(data.name ?? (data as Record<string, unknown>).playerName ?? id);
  const team = typeof data.team === 'string' ? data.team : undefined;
  const position =
    typeof (data as Record<string, unknown>).position === 'string'
      ? (data as Record<string, string>).position
      : undefined;
  const games = Number.isFinite(Number((data as Record<string, unknown>).games))
    ? Number((data as Record<string, unknown>).games)
    : undefined;

  // Prefer a nested stats map
  let stats: Record<string, number | null | undefined> = {};
  if (
    (data as Record<string, unknown>).stats &&
    typeof (data as Record<string, unknown>).stats === 'object'
  ) {
    stats = (data as { stats: Record<string, number | null | undefined> }).stats;
  } else {
    // Attempt to gather known categories from top-level fields
    for (const key of DEFAULT_CATEGORIES) {
      const raw = (data as Record<string, unknown>)[key];
      if (typeof raw === 'number') stats[key] = raw;
      else if (typeof raw === 'string' && raw.trim() !== '' && !isNaN(Number(raw))) {
        stats[key] = Number(raw);
      } // otherwise leave undefined; calculator will handle missing
    }
  }

  return { id, name, team, position, games, stats };
}

export async function GET(req: NextRequest) {
  try {
    // --- Query params / options ---
    const includeDE = qBool(req, 'includeDE', false);
    const perGame = qBool(req, 'perGame', true);
    const winsorP = qNum(req, 'winsorP', 0.01);

    const categories = qList(req, 'categories') ?? Array.from(DEFAULT_CATEGORIES);
    const invert = qList(req, 'invert') ?? Array.from(INVERT_CATEGORIES);

    // --- Load players from Firestore ---
    const snap = await adminDb.collection('players').get();
    const players: PlayerBase[] = [];

    snap.forEach((doc: QueryDocumentSnapshot<DocumentData>) => {
      const data = doc.data() as Record<string, unknown>;
      const p = toPlayerBase(doc.id, data);
      players.push(p);
    });

    // --- Compute rankings ---
    const cfg = {
      ...defaultCategoryConfig(includeDE),
      categories,
      invert,
      perGame,
      winsorP,
    };

    const result = computeTotalValue(players, cfg);

    const payload: RankingsResponse = {
      players: result.players.map((p) => ({ ...p })),
      categoriesUsed: result.meta.categoriesUsed,
      generatedAt: new Date().toISOString(),
      meta: {
        excludedCategories: Object.fromEntries(
          Object.entries(result.meta.excludedCategories).map(([k, v]) => [
            k,
            { reason: v.reason ?? 'excludedByFlag', mean: v.mean, std: v.std },
          ])
        ),
        options: {
          includeDE: result.meta.options.includeDE,
          perGame: result.meta.options.perGame,
          winsorP: result.meta.options.winsorP,
        },
      },
    };

    return NextResponse.json(payload, {
      status: 200,
      headers: {
        'Cache-Control': `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}`,
      },
    });
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error';

    console.error('[GET /api/rankings] Error:', err);

    return NextResponse.json(
      { error: 'Failed to compute rankings', details: msg },
      { status: 500 }
    );
  }
}