// src/app/api/rankings/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import {
  computeTotalValue,
  defaultCategoryConfig,
  type PlayerBase,
} from '@/lib/ratings/computeTotalValue';

// Ensure Node runtime (not edge)
export const runtime = 'nodejs';
const CACHE_SECONDS = 600;

/** Query helpers */
function qBool(req: NextRequest, key: string, fallback: boolean): boolean {
  const v = req.nextUrl.searchParams.get(key);
  if (v === null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}
function qNum(req: NextRequest, key: string, fallback: number): number {
  const v = req.nextUrl.searchParams.get(key);
  if (v === null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function qList(req: NextRequest, key: string): string[] | null {
  const v = req.nextUrl.searchParams.get(key);
  if (!v) return null;
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Safely coerce a Firestore document into PlayerBase */
function toPlayerBase(id: string, raw: unknown): PlayerBase {
  const data = (raw ?? {}) as Record<string, unknown>;

  const name = String(data.name ?? (data as Record<string, unknown>).playerName ?? id);

  const team =
    typeof data.team === 'string' && data.team.trim() !== '' ? data.team : undefined;

  const position =
    typeof (data as Record<string, unknown>).position === 'string' &&
    String((data as Record<string, unknown>).position).trim() !== ''
      ? (data as Record<string, string>).position
      : undefined;

  const gamesVal = (data as Record<string, unknown>).games;
  const games =
    typeof gamesVal === 'number'
      ? gamesVal
      : typeof gamesVal === 'string' && gamesVal.trim() !== '' && !Number.isNaN(Number(gamesVal))
      ? Number(gamesVal)
      : undefined;

  // Prefer nested stats object if present
  let stats: Record<string, number | null | undefined> = {};
  const maybeStats = (data as Record<string, unknown>).stats;
  if (maybeStats && typeof maybeStats === 'object') {
    stats = maybeStats as Record<string, number | null | undefined>;
  } else {
    // Fallback: collect numeric-looking top-level fields
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === 'number') stats[k] = v;
      else if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) {
        stats[k] = Number(v);
      }
    }
  }

  return { id, name, team, position, games, stats };
}

/** Response wire type (kept minimal for the client) */
type RankingsResponse = {
  players: Array<{
    id: string;
    name: string;
    team?: string;
    position?: string;
    totalValue: number;
    rank: number;
  }>;
  categoriesUsed: string[];
  generatedAt: string;
  meta: {
    excludedCategories: Record<string, { reason: string; mean: number; std: number }>;
    options: { includeDE: boolean; perGame: boolean; winsorP: number };
  };
};

export async function GET(req: NextRequest) {
  try {
    // ---- Parse options ----
    const includeDE = qBool(req, 'includeDE', false);
    const perGame = qBool(req, 'perGame', true);
    const winsorP = qNum(req, 'winsorP', 0.01);
    const debug = qBool(req, 'debug', false);
    const limit = qNum(req, 'limit', 0);

    // Base config, allow overrides via query
    const base = defaultCategoryConfig(includeDE);
    const categories = qList(req, 'categories') ?? [...base.categories];
    const invert = qList(req, 'invert') ?? [...base.invert];

    // ---- Load players from Firestore ----
    const snap = await adminDb.collection('players').get();
    const players: PlayerBase[] = snap.docs.map((doc) => toPlayerBase(doc.id, doc.data()));

    const usedPlayers = limit > 0 ? players.slice(0, limit) : players;

    if (debug && usedPlayers.length > 0) {
      console.log('[rankings] players:', players.length);
      console.log('[rankings] first:', {
        id: usedPlayers[0].id,
        name: usedPlayers[0].name,
        games: usedPlayers[0].games,
        statKeys: Object.keys(usedPlayers[0].stats ?? {}),
      });
    }

    // ---- Compute rankings ----
    const result = computeTotalValue(usedPlayers, {
      categories,
      invert,
      includeDE,
      perGame,
      winsorP,
    });

    if (debug) {
      console.log('[rankings] categoriesUsed:', result.meta.categoriesUsed);
      console.log('[rankings] excluded:', result.meta.excludedCategories);
    }

    // ---- Shape response ----
    const payload: RankingsResponse = {
      players: result.players.map((p) => ({
        id: p.id,
        name: p.name,
        team: p.team,
        // PlayerBase includes position?: string, so it flows through PlayerWithScores
        position: p.position,
        totalValue: p.totalValue,
        rank: p.rank,
      })),
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
  } catch (err) {
    const message =
      err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error';
    console.error('[GET /api/rankings] Error:', message);
    return NextResponse.json(
      { error: 'Failed to compute rankings', details: message },
      { status: 500 }
    );
  }
}