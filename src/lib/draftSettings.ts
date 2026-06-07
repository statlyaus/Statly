export const MIN_PICK_SECONDS = 15;
export const MAX_PICK_SECONDS = 600;

export const TIME_PER_PICK_OPTIONS = [
  { value: 15, label: '15 seconds' },
  { value: 30, label: '30 seconds' },
  { value: 60, label: '1 minute' },
  { value: 90, label: '1.5 minutes' },
  { value: 120, label: '2 minutes' },
  { value: 180, label: '3 minutes' },
  { value: 300, label: '5 minutes' },
  { value: 600, label: '10 minutes' },
] as const;

export const POSITION_LIMIT_KEYS = ['DEF', 'MID', 'RUC', 'FWD', 'BENCH'] as const;

export type PositionLimitKey = (typeof POSITION_LIMIT_KEYS)[number];

export type DraftPickOrderMode = 'random' | 'manual';

export type DraftAutoPickStrategy = 'queue-first' | 'best-available' | 'fill-positions';

export type DraftPositionLimits = Record<PositionLimitKey, number>;

export interface DraftAutoPickRules {
  enabled: boolean;
  strategy: DraftAutoPickStrategy;
}

export const DEFAULT_DRAFT_POSITION_LIMITS: DraftPositionLimits = {
  DEF: 5,
  MID: 7,
  RUC: 2,
  FWD: 4,
  BENCH: 4,
};

export const DEFAULT_DRAFT_AUTO_PICK_RULES: DraftAutoPickRules = {
  enabled: true,
  strategy: 'queue-first',
};

export function isValidPickSeconds(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_PICK_SECONDS && value <= MAX_PICK_SECONDS;
}

export function normalizePickSeconds(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && isValidPickSeconds(parsed) ? parsed : undefined;
}

export function normalizeDraftPickOrderMode(value: unknown): DraftPickOrderMode {
  return String(value ?? '')
    .trim()
    .toLowerCase() === 'manual'
    ? 'manual'
    : 'random';
}

export function normalizeDraftPositionLimits(value: unknown): DraftPositionLimits {
  if (typeof value === 'string' && value.trim()) {
    try {
      return normalizeDraftPositionLimits(JSON.parse(value));
    } catch {
      return { ...DEFAULT_DRAFT_POSITION_LIMITS };
    }
  }

  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_DRAFT_POSITION_LIMITS };
  }

  return POSITION_LIMIT_KEYS.reduce<DraftPositionLimits>((limits, key) => {
    const source = value as Partial<Record<PositionLimitKey, unknown>>;
    const parsed =
      typeof source[key] === 'number' ? source[key] : Number.parseInt(String(source[key]), 10);
    limits[key] =
      Number.isFinite(parsed) && parsed >= 0
        ? Math.min(Math.floor(parsed), key === 'BENCH' ? 20 : 30)
        : DEFAULT_DRAFT_POSITION_LIMITS[key];
    return limits;
  }, {} as DraftPositionLimits);
}

export function normalizeDraftAutoPickRules(value: unknown): DraftAutoPickRules {
  if (typeof value === 'string' && value.trim()) {
    try {
      return normalizeDraftAutoPickRules(JSON.parse(value));
    } catch {
      return { ...DEFAULT_DRAFT_AUTO_PICK_RULES };
    }
  }

  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_DRAFT_AUTO_PICK_RULES };
  }

  const source = value as Partial<DraftAutoPickRules>;
  const strategy = String(source.strategy ?? '').trim().toLowerCase();
  const normalizedStrategy: DraftAutoPickStrategy =
    strategy === 'best-available' || strategy === 'fill-positions' ? strategy : 'queue-first';

  return {
    enabled: source.enabled !== false,
    strategy: normalizedStrategy,
  };
}

export function getRosterSizeFromPositionLimits(limits: DraftPositionLimits): number {
  return limits.DEF + limits.MID + limits.RUC + limits.FWD;
}

export function getBenchSizeFromPositionLimits(limits: DraftPositionLimits): number {
  return limits.BENCH;
}
