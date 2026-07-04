import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ACTIVE_LINEUP_SLOTS,
  normalizeLineupSlots,
  totalActiveLineupSlots,
} from '@/server/leagues/lineupSettings';

describe('lineup settings', () => {
  it('uses the default AFL active lineup structure', () => {
    expect(DEFAULT_ACTIVE_LINEUP_SLOTS).toEqual({
      FWD: 5,
      DEF: 5,
      MID: 5,
      RUC: 1,
      UTIL: 3,
    });
    expect(totalActiveLineupSlots(DEFAULT_ACTIVE_LINEUP_SLOTS)).toBe(19);
  });

  it('normalizes positive integer slot counts and ignores unsupported keys', () => {
    expect(normalizeLineupSlots({ FWD: 4, DEF: 4, MID: 6, RUC: 1, UTIL: 2, BENCH: 9 })).toEqual({
      FWD: 4,
      DEF: 4,
      MID: 6,
      RUC: 1,
      UTIL: 2,
    });
  });

  it('falls back to defaults for invalid values', () => {
    expect(normalizeLineupSlots({ FWD: -1, DEF: 0, MID: 1.5, RUC: 'x', UTIL: null })).toEqual(
      DEFAULT_ACTIVE_LINEUP_SLOTS
    );
  });
});
