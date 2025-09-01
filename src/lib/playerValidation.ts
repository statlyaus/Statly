import type { Player } from '@/types/players';
import { logger } from '@/lib/logger';
import { z } from 'zod';

// Allowed AFL positions (module-scoped to avoid re-allocating per call)
const ALLOWED_POSITIONS = new Set(['DEF', 'MID', 'FWD', 'RUC']);

/**
 * Validates and sanitizes player data
 */
export function validatePlayer(data: unknown): Player | null {
  if (!data || typeof data !== 'object') return null;

  // Zod schema for coarse validation & coercion
  const RawPlayerSchema = z
    .object({
      id: z.union([z.string(), z.number()]),
      name: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1)),
      team: z.string().optional().nullable(),
      position: z.string().optional().nullable(),
      injury: z.string().optional().nullable(),
      games: z.union([z.number(), z.string()]).optional().nullable(),
      avg: z.union([z.number(), z.string()]).optional().nullable(),
      stats: z.unknown().optional().nullable(),
      summary: z.string().optional().nullable(),
    })
    .passthrough();

  const parsed = RawPlayerSchema.safeParse(data);
  if (!parsed.success) {
    logger.warn('Failed to parse raw player with schema', {
      issues: parsed.error.issues,
    });
    return null;
  }

  const obj = parsed.data as Record<string, unknown>;

  // Required fields: id must not be null/undefined; name must be a non-empty string after trim
  if (obj.id == null || typeof obj.name !== 'string' || obj.name.trim() === '') return null;

  try {
    const name = String(obj.name).replace(/\s+/g, ' ').trim();

    const player: Player = {
      id: String(obj.id),
      name,
      team: normalizeOptionalString(obj.team),
      position: normalizePosition(obj.position),
      injury: normalizeOptionalString(obj.injury),
      games: coerceNumber(obj.games) ?? undefined,
      avg: coerceNumber(obj.avg) ?? undefined,

      // Stats validation
      stats:
        obj.stats && typeof obj.stats === 'object' && !Array.isArray(obj.stats)
          ? validateStats(obj.stats)
          : undefined,

      // Other fields
      summary: normalizeOptionalString(obj.summary, false),
    };

    return player;
  } catch (error) {
    // Avoid logging raw input to prevent PII exposure; include only sanitized hints
    const safeId = (() => {
      try {
        if (data && typeof data === 'object' && 'id' in (data as Record<string, unknown>)) {
          const idVal = (data as Record<string, unknown>).id;
          if (idVal != null) return String(idVal).slice(0, 4) + '***';
        }
      } catch {
        // noop: best-effort safe id extraction
      }
      return undefined;
    })();

    logger.warn('Failed to validate player data', {
      error,
      hasId: safeId !== undefined,
      idPrefixMasked: safeId,
    });
    return null;
  }
}

/**
 * Validates and sanitizes stats object
 */
function validateStats(stats: unknown): Record<string, number | string> | undefined {
  if (!stats || typeof stats !== 'object') return undefined;
  if (Array.isArray(stats)) return undefined;

  const statsObj = stats as Record<string, unknown>;
  const validStats: Record<string, number | string> = {};

  for (const [key, raw] of Object.entries(statsObj)) {
    // Attempt numeric coercion first (handles numeric strings, commas, percentages)
    const num = coerceNumber(raw, key);
    if (num !== null && Number.isFinite(num)) {
      validStats[key] = num;
      continue;
    }

    // Keep non-empty strings as-is for UIs that display textual stats (rare)
    if (typeof raw === 'string') {
      const s = raw.trim();
      if (s) validStats[key] = s;
    }
  }

  return Object.keys(validStats).length > 0 ? validStats : undefined;
}

/**
 * Validates an array of players, filtering out invalid ones
 */
export function validatePlayers(data: unknown[]): Player[] {
  if (!Array.isArray(data)) return [];

  return data.map(validatePlayer).filter((player): player is Player => player !== null);
}

/**
 * Checks if a player has minimum required data for display
 */
export function isPlayerDisplayReady(player: Player): boolean {
  return !!(player.id && player.name && player.team);
}

/**
 * Safely gets a numeric stat value
 */
export function getPlayerStat(player: Player, statKey: string): number | null {
  if (!player.stats) return null;

  const value = player.stats[statKey];

  const num = coerceNumber(value, statKey);
  return num !== null && Number.isFinite(num) ? num : null;
}

// Cache Intl.NumberFormat instances by locale to avoid repeated allocations
const FORMATTER_CACHE = new Map<string, Intl.NumberFormat>();

function getFormatter(locale?: string | string[]): Intl.NumberFormat {
  const key = Array.isArray(locale) ? locale.join(',') : locale ?? 'default';
  let formatter = FORMATTER_CACHE.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale);
    FORMATTER_CACHE.set(key, formatter);
  }
  return formatter;
}

/**
 * Formats a stat value for display
 */
export function formatPlayerStat(
  player: Player,
  statKey: string,
  opts?: { locale?: string | string[]; formatter?: Intl.NumberFormat }
): string {
  const value = getPlayerStat(player, statKey);

  if (value === null) return '—';

  if (isPercentageKey(statKey)) {
    return `${value.toFixed(1)}%`;
  }

  // Show thousand separators for large integers
  if (Number.isInteger(value) && Math.abs(value) >= 1000) {
    if (opts?.formatter) return opts.formatter.format(value);
    try {
      return getFormatter(opts?.locale).format(value);
    } catch {
      // Fallback to runtime default locale formatting
      return value.toLocaleString();
    }
  }

  // Integer stats
  if (Number.isInteger(value)) {
    return value.toString();
  }

  // Decimal stats
  return value.toFixed(1);
}

// -------------------------
// Helpers
// -------------------------
function isPercentageKey(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.includes('percentage') || lower.includes('pct') || lower.includes('%');
}

function normalizeOptionalString(input: unknown, trimToUndefined = true): string | undefined {
  if (typeof input !== 'string') return undefined;
  const out = input.replace(/\s+/g, ' ').trim();
  return trimToUndefined && out === '' ? undefined : out;
}

function normalizePosition(input: unknown): string | undefined {
  const s = normalizeOptionalString(input);
  if (!s) return undefined;
  const upper = s.toUpperCase();
  return ALLOWED_POSITIONS.has(upper) ? upper : undefined;
}

function coerceNumber(value: unknown, key?: string): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return null;

    // Handle leading plus and parenthesized negatives, e.g., "+123", "(1,234)", "(12.5%)"
    let t = s;
    let isNegative = false;

    if (t.startsWith('+')) t = t.slice(1).trim();
    if (t.startsWith('(') && t.endsWith(')')) {
      isNegative = true;
      t = t.slice(1, -1).trim();
    }

    // strip common noise
    let cleaned = t.replace(/,/g, ''); // thousand separators

    // Handle percentages if key or value suggests so
    const looksPct = (typeof key === 'string' && isPercentageKey(key)) || cleaned.endsWith('%');
    if (looksPct) cleaned = cleaned.replace(/%$/, '');

    const num = Number(cleaned);
    if (!Number.isNaN(num)) return isNegative ? -num : num;
  }
  return null;
}
