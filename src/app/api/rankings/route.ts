import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { QueryDocumentSnapshot, DocumentData } from 'firebase-admin/firestore';

import { computeTotalValue, defaultCategoryConfig } from '@/lib/ratings/computeTotalValue'; // NOTE: 'ratings' (lowercase)
import { adminDb } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
const CACHE_SECONDS = 600;

// ---- local types ----
type Numeric = number | null | undefined;
type PlayerBase = {
  id: string;
  name: string;
  team?: string;
  position?: string;
  games?: number;
  stats: Record<string, Numeric>;
};

// ---- small helpers ----
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
function pickGames(data: Record<string, unknown>): number | undefined {
  const candidates = ['games', 'Games', 'GP', 'played', 'matches', 'Matches'];
  for (const k of candidates) {
    const n = Number((data as Record<string, unknown>)[k]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}
function toPlayerBase(id: string, data: Record<string, unknown>): PlayerBase {
  const name = String(data.name ?? (data as Record<string, unknown>).playerName ?? id);
  const team = typeof data.team === 'string' ? data.team : undefined;
  const position =
    typeof (data as Record<string, unknown>).position === 'string'
      ? (data as Record<string, string>).position
      : undefined;
  const games = pickGames(data);

  let stats: Record<string, number | null | undefined> = {};
  if (data.stats && typeof data.stats === 'object') {
    stats = (data as { stats: Record<string, number | null | undefined> }).stats;
  } else {
    for (const [k, v] of Object.entries(data)) {
      if (['name', 'team', 'position', 'id', 'stats'].includes(k)) continue;
      const n = Number(v);
      if (Number.isFinite(n)) stats[k] = n;
    }
  }
  return { id, name, team, position, games, stats };
}

// ---- handler ----
export async function GET(req: NextRequest) {
  try {
    // Query options
    const includeDE = qBool(req, 'includeDE', false);
    const perGame = qBool(req, 'perGame', true);
    const winsorP = qNum(req, 'winsorP', 0.01);
    const categories = qList(req, 'categories');
    const invert = qList(req, 'invert');

    // Load players
    const snap = await adminDb.collection('players').get();
    const players: PlayerBase[] = [];
    snap.forEach((doc: QueryDocumentSnapshot<DocumentData>) => {
      players.push(toPlayerBase(doc.id, doc.data() as Record<string, unknown>));
    });

    // Build config (override defaults only if query provided)
    const baseCfg = {
      ...defaultCategoryConfig(includeDE),
      perGame,
      winsorP,
      ...(categories ? { categories } : {}),
      ...(invert ? { invert } : {}),
    };

    // Compute
    let result = computeTotalValue(players, baseCfg);

    // Fallback: if we somehow used 0 categories, auto-detect from data
    if (result.meta.categoriesUsed.length === 0) {
      const counts = new Map<string, number>();
      for (const p of players) {
        for (const [k, v] of Object.entries(p.stats)) {
          if (typeof v === 'number' && Number.isFinite(v)) {
            counts.set(k, (counts.get(k) ?? 0) + 1);
          }
        }
      }
      const autoCats = Array.from(counts.entries())
        .filter(([k, c]) => c >= 30 && !/^(name|team|position|games?)$/i.test(k))
        .map(([k]) => k);

      const fallbackCfg = {
        ...baseCfg,
        includeDE: true,
        categories: autoCats,
        invert: ['Clangers', 'Turnovers', 'Frees Against', 'Errors'].filter((k) =>
          autoCats.includes(k)
        ),
      };

      result = computeTotalValue(players, fallbackCfg);
    }

    // ---- build payload (position optional, no TS errors) ----
    type OutPlayer = {
      id: string;
      name: string;
      team?: string;
      position?: string;
      totalValue: number;
      rank: number;
    };

    const playersOut: OutPlayer[] = result.players.map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      position: (p as { position?: string }).position,
      totalValue: p.totalValue,
      rank: p.rank,
    }));

    return NextResponse.json(
      {
        players: playersOut,
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
      },
      {
        status: 200,
        headers: {
          'Cache-Control': `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}`,
        },
      }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[GET /api/rankings] Error:', err);
    return NextResponse.json({ error: 'Failed to compute rankings', details: msg }, { status: 500 });
  }
}