import type { ActiveLineupSlot, LineupSlotSettings } from './scoringTypes';

export const ACTIVE_LINEUP_SLOTS = [
  'FWD',
  'DEF',
  'MID',
  'RUC',
  'UTIL',
] as const satisfies readonly ActiveLineupSlot[];

export const DEFAULT_ACTIVE_LINEUP_SLOTS: LineupSlotSettings = {
  FWD: 5,
  DEF: 5,
  MID: 5,
  RUC: 1,
  UTIL: 3,
};

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function normalizeLineupSlots(input: unknown): LineupSlotSettings {
  if (!input || typeof input !== 'object') return DEFAULT_ACTIVE_LINEUP_SLOTS;

  const source = input as Partial<Record<ActiveLineupSlot, unknown>>;
  const normalized: LineupSlotSettings = { ...DEFAULT_ACTIVE_LINEUP_SLOTS };
  let hasAnyValidValue = false;

  for (const slot of ACTIVE_LINEUP_SLOTS) {
    if (isPositiveInteger(source[slot])) {
      normalized[slot] = source[slot];
      hasAnyValidValue = true;
    }
  }

  return hasAnyValidValue ? normalized : DEFAULT_ACTIVE_LINEUP_SLOTS;
}

export function parseLineupSlotsJson(value: string | null | undefined): LineupSlotSettings {
  if (!value) return DEFAULT_ACTIVE_LINEUP_SLOTS;

  try {
    return normalizeLineupSlots(JSON.parse(value));
  } catch {
    return DEFAULT_ACTIVE_LINEUP_SLOTS;
  }
}

export function totalActiveLineupSlots(slots: LineupSlotSettings): number {
  return ACTIVE_LINEUP_SLOTS.reduce((total, slot) => total + slots[slot], 0);
}
