// src/app/api/rankings/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import {
  computeTotalValue,
  defaultCategoryConfig,
} from '@/lib/ratings/computeTotalValue';

// Keep Node runtime (Firebase Admin needs Node)
export const runtime = 'nodejs';
const CACHE_SECONDS = 600;

/** Minimal player shape we need for the calculator */
type Numeric = number | null | undefined;
type PlayerBase = {
  id: string;
  name: string;
  team?: string;
  position?: string;
  games?: number;
  stats: Record<string, Numeric>;
};

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
    excludedCategories: Record<
      string,
      { reason: string; mean: number; std: number }
    >;
    options: { includeDE: boolean; perGame: boolean; winsorP: number };
  };
};

// ---------- helpers ----------
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
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Coerce Firestore doc into PlayerBase */
function toPlayerBase(id: string, data: Record<string, unknown>): PlayerBase {
  const name = String((data as any).name ?? (data as any).playerName ?? id);
  const team =
    typeof (data as any).team === 'string'
      ? ((data as any).team as string)
      : undefined;
  const position =
    typeof (data as any).position === 'string'
      ? ((data as any).position as string)
      : undefined;

  const gamesRaw = (data as any).games;
  const games =
    typeof gamesRaw === 'number'
      ? gamesRaw
      : typeof gamesRaw === 'string' &&
        gamesRaw.trim() !== '' &&
        !Number.isNaN(Number(gamesRaw))
      ? Number(gamesRaw)
      : undefined;

  // Prefer nested stats object; else build from numeric top-level fields
  let stats: Record<string, Numeric> = {};
  if (data && typeof (data as any).stats === 'object') {
    stats = (data as { stats: Record<string, Numeric> }).stats ?? {};
  } else {
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === 'number') stats[k] = v;
      else if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) {
        stats[k] = Number(v);
      }
    }
  }

  return { id, name, team, position, games, stats };
}

// ---------- GET ----------
export async function GET(req: NextRequest) {
  try {
    // Query options
    const includeDE = qBool(req, 'includeDE', false);
    const perGame = qBool(req, 'perGame', true);
    const winsorP = qNum(req, 'winsorP', 0.01);
    const limit = qNum(req, 'limit', 0); // debug/helper
    const debug = qBool(req, 'debug', false);

    // Base config + optional overrides
    const baseCfg = defaultCategoryConfig(includeDE);
    const categories = qList(req, 'categories') ?? [...baseCfg.categories];
    const invert = qList(req, 'invert') ?? [...baseCfg.invert];

    // Load players
    const snap = await adminDb.collection('players').get();
    const players: PlayerBase[] = [];
    snap.forEach((doc) => {
      players.push(toPlayerBase(doc.id, doc.data() as Record<string, unknown>));
    });

    const sample = limit > 0 ? players.slice(0, limit) : players;

    if (debug && sample.length > 0) {
      console.log('[rankings:debug] count', players.length);
      console.log('[rankings:debug] first', {
        id: sample[0].id,
        name: sample[0].name,
        games: sample[0].games,
        statKeys: Object.keys(sample[0].stats ?? {}),
      });
    }

    // Compute values
    const result = computeTotalValue(sample, {
      categories,
      invert,
      includeDE,
      perGame,
      winsorP,
    });

    if (debug) {
      console.log('[rankings:debug] categoriesUsed', result.meta.categoriesUsed);
      console.log('[rankings:debug] excluded', result.meta.excludedCategories);
    }

    // Build payload (keep position via safe cast)
    const payload: RankingsResponse = {
      players: result.players.map((p) => ({
        id: p.id,
        name: p.name,
        team: (p as any).team,
        position: (p as any).position,
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
    console.error('[GET /api/rankings] Error:', err);
    const msg =
      err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to compute rankings', details: msg },
      { status: 500 }
    );
  }
}