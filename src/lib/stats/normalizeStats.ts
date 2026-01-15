import type { CanonicalStatKey } from '@/lib/stats/statColumns';
import { CANONICAL_STAT_KEYS, canonicalStatKeyFromRaw } from '@/lib/stats/statColumns';

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function buildEmptyStats(): Record<CanonicalStatKey, number> {
  return CANONICAL_STAT_KEYS.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {} as Record<CanonicalStatKey, number>);
}

export function normalizeStats(
  ...sources: Array<Record<string, unknown> | null | undefined>
): Record<CanonicalStatKey, number> {
  const normalized = buildEmptyStats();
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const [rawKey, rawValue] of Object.entries(source)) {
      const canonicalKey = canonicalStatKeyFromRaw(rawKey);
      if (!canonicalKey) continue;
      const numeric = toNumber(rawValue);
      if (numeric === null) continue;
      normalized[canonicalKey] = numeric;
    }
  }
  return normalized;
}
