// src/app/api/rankings/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import {
  computeTotalValue,
  defaultCategoryConfig,
  type PlayerBase,
} from '@/lib/ratings/computeTotalValue';

export const runtime = 'nodejs';
const CACHE_SECONDS = 600;

// ---------- helpers ----------
type Numeric = number | null | undefined;

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

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return undefined;
}

/** Coerce a Firestore document data into PlayerBase (no `position` here). */
function toPlayerBase(id: string, data: Record<string, unknown>): PlayerBase {
  const name = asString(data.name) ?? asString((data as Record<string, unknown>).playerName) ?? id;
  const team = asString(data.team);
  const games = asNumber(data.games);

  // Prefer nested stats object if present
  let stats: Record<string, Numeric> = {};
  const maybeStats = (data as Record<string, unknown>).stats;
  if (maybeStats && typeof maybeStats === 'object' && !Array.isArray(maybeStats)) {
    for (const [k, v] of Object.entries(maybeStats as Record<string, unknown>)) {
      const n = asNumber(v);
      if (typeof n === 'number') stats[k] = n;
    }
  } else {
    // Fall back to any numeric top-level fields
    for (const [k, v] of Object.entries(data)) {
      const n = asNumber(v);
      if (typeof n === 'number') stats[k] = n;
    }
  }

  return { id, name, team, games, stats };
}

// ---------- response shape ----------
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

// ---------- GET ----------
export async function GET(req: NextRequest) {
  try {
    // Options (override via query params if you want):
    const includeDE = qBool(req, 'includeDE', false);
    const perGame = qBool(req, 'perGame', true);
    const winsorP = qNum(req, 'winsorP', 0.01);
    const categories = qList(req, 'categories') ?? defaultCategoryConfig(includeDE).categories;
    const invert = qList(req, 'invert') ?? defaultCategoryConfig(includeDE).invert;

    // Load players
    const snap = await adminDb.collection('players').get();

    const players: PlayerBase[] = [];
    const positionById = new Map<string, string | undefined>();

    snap.forEach((doc) => {
      const raw = doc.data() as Record<string, unknown>;
      const player = toPlayerBase(doc.id, raw);
      positionById.set(doc.id, asString(raw.position));
      players.push(player);
    });

    // Compute rankings
    const result = computeTotalValue(players, {
      categories,
      invert,
      includeDE,
      perGame,
      winsorP,
    });

    // Build payload (re-attach position here)
    const payload: RankingsResponse = {
      players: result.players.map((p) => ({
        id: p.id,
        name: p.name,
        team: p.team,
        position: positionById.get(p.id),
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
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to compute rankings', details: msg },
      { status: 500 }
    );
  }
}