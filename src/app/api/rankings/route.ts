// src/app/api/rankings/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { computeTotalValue, defaultCategoryConfig } from '@/lib/ratings/computeTotalValue';

export const runtime = 'nodejs';
const CACHE_SECONDS = 600;

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
    excludedCategories: Record<string, { reason: string; mean: number; std: number }>;
    options: { includeDE: boolean; perGame: boolean; winsorP: number };
  };
};

/* ------------------------------------------------------------------ */
/* 1) Map calculator labels -> your Firestore field names              */
/*    (edit right-hand side to match your actual document fields)      */
/* ------------------------------------------------------------------ */
const STAT_ALIASES: Record<string, string> = {
  'Goals':                   'goals',
  'Goal Assists':            'goalAssists',
  'Tackles':                 'tackles',
  'Clearances':              'clearances',
  'Inside 50s':              'inside50s',
  'Rebound 50s':             'rebound50s',
  'Intercepts':              'intercepts',
  'Contested Marks':         'contestedMarks',
  'Metres Gained':           'metresGained',          // change to 'metersGained' if that’s your field
  'Score Involvements':      'scoreInvolvements',
  'Effective Disposals':     'effectiveDisposals',
  'Disposal Efficiency %':   'disposalEfficiency',    // or 'disposalEfficiencyPct'
  'Clangers':                'clangers',
  'Turnovers':               'turnovers',
};

/* Pull a numeric from either top-level or stats object by label */
function readStat(doc: Record<string, unknown>, label: string): number | null {
  const key = STAT_ALIASES[label] ?? label;
  const raw = (doc as any)[key] ?? (doc as any).stats?.[key];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '' && !isNaN(Number(raw))) return Number(raw);
  return null;
}

/* Query helpers */
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

/* Coerce a Firestore doc into the PlayerBase the calculator needs */
function toPlayerBase(id: string, data: Record<string, unknown>, categoryLabels: string[]): PlayerBase {
  const name = String(data.name ?? (data as any).playerName ?? id);

  const team =
    typeof (data as any).team === 'string'
      ? ((data as any).team as string)
      : undefined;

  const position =
    typeof (data as any).position === 'string'
      ? ((data as any).position as string)
      : undefined;

  // games can be number or numeric string
  const g = (data as any).games;
  const games =
    typeof g === 'number'
      ? g
      : typeof g === 'string' && g.trim() !== '' && !isNaN(Number(g))
      ? Number(g)
      : undefined;

  // Build stats object strictly from the labels the calculator will use
  const stats: Record<string, Numeric> = {};
  for (const label of categoryLabels) {
    stats[label] = readStat(data, label);
  }

  return { id, name, team, position, games, stats };
}

/* ------------------------------------------------------------------ */
/* GET /api/rankings                                                  */
/* ------------------------------------------------------------------ */
export async function GET(req: NextRequest) {
  try {
    const includeDE = qBool(req, 'includeDE', false);
    const perGame = qBool(req, 'perGame', true);
    const winsorP = qNum(req, 'winsorP', 0.01);
    const limit = qNum(req, 'limit', 0);
    const debug = qBool(req, 'debug', false);

    // Base config from calculator (human-readable labels)
    const baseCfg = defaultCategoryConfig(includeDE);

    // Allow query-time overrides if you want them
    const categories = qList(req, 'categories') ?? [...baseCfg.categories];
    const invert = qList(req, 'invert') ?? [...baseCfg.invert];

    // Load players from Firestore
    const snap = await adminDb.collection('players').get();
    const players: PlayerBase[] = [];
    snap.forEach((doc) => {
      const data = doc.data() as Record<string, unknown>;
      players.push(toPlayerBase(doc.id, data, categories));
    });
    const sample = limit > 0 ? players.slice(0, limit) : players;

    if (debug) {
      console.log('[rankings:debug] count', players.length);
      console.log('[rankings:debug] first', {
        id: sample[0]?.id,
        name: sample[0]?.name,
        games: sample[0]?.games,
        statKeys: sample[0] ? Object.keys(sample[0].stats ?? {}) : [],
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

    const payload: RankingsResponse = {
      players: result.players.map((p) => ({
        id: p.id,
        name: p.name,
        team: p.team,
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
          ]),
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
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[GET /api/rankings] Error:', msg);
    return NextResponse.json(
      { error: 'Failed to compute rankings', details: msg },
      { status: 500 },
    );
  }
}