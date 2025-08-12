// src/app/api/rankings/route.ts
import { type NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { commonErrors } from '@/lib/apiResponse';
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
  /** Keys are the human-readable category labels used by the calculator. */
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

/* ──────────────────────────────────────────────────────────────────────
   1) Map calculator labels → your Firestore field names
   (Edit RHS to match your actual document schema.)
   ──────────────────────────────────────────────────────────────────── */
const STAT_ALIASES: Record<string, string> = {
  'Goals':                 'goals',
  'Goal Assists':          'goalAssists',
  'Tackles':               'tackles',
  'Clearances':            'clearances',
  'Inside 50s':            'inside50s',
  'Rebound 50s':           'rebound50s',
  'Intercepts':            'intercepts',
  'Contested Marks':       'contestedMarks',
  'Metres Gained':         'metresGained',         // change if your field differs
  'Score Involvements':    'scoreInvolvements',
  'Effective Disposals':   'effectiveDisposals',
  'Disposal Efficiency %': 'disposalEfficiency',   // or 'disposalEfficiencyPct'
  'Clangers':              'clangers',
  'Turnovers':             'turnovers',
};

/* ──────────────────────────────────────────────────────────────────────
   Small safe helpers (no `any`)
   ──────────────────────────────────────────────────────────────────── */
function getProp(obj: unknown, key: string): unknown {
  return obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined;
}
function asString(u: unknown): string | undefined {
  return typeof u === 'string' ? u : undefined;
}
function asFiniteNumber(u: unknown): number | undefined {
  return typeof u === 'number' && Number.isFinite(u) ? u : undefined;
}

/** Pull a numeric for a given calculator label from either top-level or a nested `stats` object. */
function readStat(doc: Record<string, unknown>, label: string): number | null {
  const key = STAT_ALIASES[label] ?? label;

  const top = getProp(doc, key);
  const statsObj = getProp(doc, 'stats');
  const nested = statsObj && typeof statsObj === 'object'
    ? (statsObj as Record<string, unknown>)[key]
    : undefined;

  const raw = top ?? nested;

  const n = asFiniteNumber(raw);
  if (n !== undefined) return n;

  const s = asString(raw);
  if (s && s.trim() !== '' && !Number.isNaN(Number(s))) return Number(s);

  return null;
}

/* ──────────────────────────────────────────────────────────────────────
   Query helpers
   ──────────────────────────────────────────────────────────────────── */
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

/* ──────────────────────────────────────────────────────────────────────
   Coerce a Firestore doc into the PlayerBase the calculator expects
   ──────────────────────────────────────────────────────────────────── */
function toPlayerBase(
  id: string,
  data: Record<string, unknown>,
  categoryLabels: string[],
): PlayerBase {
  const name =
    asString(getProp(data, 'name')) ??
    asString(getProp(data, 'playerName')) ??
    id;

  const team = asString(getProp(data, 'team'));
  const position = asString(getProp(data, 'position'));

  const gRaw = getProp(data, 'games');
  const games =
    asFiniteNumber(gRaw) ??
    (typeof gRaw === 'string' && gRaw.trim() !== '' && !Number.isNaN(Number(gRaw))
      ? Number(gRaw)
      : undefined);

  const stats: Record<string, Numeric> = {};
  for (const label of categoryLabels) {
    stats[label] = readStat(data, label);
  }

  return { id, name, team, position, games, stats };
}

/* ──────────────────────────────────────────────────────────────────────
   GET /api/rankings
   ──────────────────────────────────────────────────────────────────── */
export async function GET(req: NextRequest) {
  try {
    // Options
    const includeDE = qBool(req, 'includeDE', false);
    const perGame = qBool(req, 'perGame', true);
    const winsorP = qNum(req, 'winsorP', 0.01);
    const limit = qNum(req, 'limit', 0);
    const debug = qBool(req, 'debug', false);

    // Calculator base config (labels)
    const baseCfg = defaultCategoryConfig(includeDE);
    const categories = qList(req, 'categories') ?? [...baseCfg.categories];
    const invert = qList(req, 'invert') ?? [...baseCfg.invert];

    // Load players
    const snap = await adminDb.collection('players').get();
    const players: PlayerBase[] = [];
    snap.forEach((doc) => {
      const data = doc.data() as Record<string, unknown>;
      players.push(toPlayerBase(doc.id, data, categories));
    });

    const sample = limit > 0 ? players.slice(0, limit) : players;

    if (debug) {
      logger.debug('Rankings debug information', {
        playerCount: players.length,
        sampleData: {
          id: sample[0]?.id,
          name: sample[0]?.name,
          games: sample[0]?.games,
          statKeys: sample[0] ? Object.keys(sample[0].stats ?? {}) : [],
        }
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
      logger.debug('Rankings computation results', {
        categoriesUsed: result.meta.categoriesUsed,
        excludedCategories: result.meta.excludedCategories
      });
    }

    // Map back name/team/position from original inputs to avoid type mismatch
    const byId = new Map(sample.map((s) => [s.id, s]));

    const payload: RankingsResponse = {
      players: result.players.map((p) => {
        const src = byId.get(p.id);
        return {
          id: p.id,
          name: src?.name ?? p.id,
          team: src?.team,
          position: src?.position,
          totalValue: p.totalValue,
          rank: p.rank,
        };
      }),
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

    return NextResponse.json(
      {
        success: true,
        data: payload,
        timestamp: new Date().toISOString(),
      },
      {
        status: 200,
        headers: {
          'Cache-Control': `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}`,
        },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Failed to compute rankings', err);
    return commonErrors.internalServerError('Failed to compute rankings', { details: message });
  }
}