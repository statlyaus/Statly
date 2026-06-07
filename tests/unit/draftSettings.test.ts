import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DRAFT_POSITION_LIMITS,
  getBenchSizeFromPositionLimits,
  getRosterSizeFromPositionLimits,
  isValidPickSeconds,
  normalizeDraftAutoPickRules,
  normalizeDraftPickOrderMode,
  normalizeDraftPositionLimits,
  normalizePickSeconds,
} from '../../src/lib/draftSettings';

describe('draftSettings', () => {
  it('allows commissioner pick clocks down to 15 seconds', () => {
    expect(isValidPickSeconds(15)).toBe(true);
    expect(isValidPickSeconds(30)).toBe(true);
    expect(normalizePickSeconds('15')).toBe(15);
    expect(normalizePickSeconds(14)).toBeUndefined();
  });

  it('normalizes order mode, position limits, and roster totals', () => {
    expect(normalizeDraftPickOrderMode('manual')).toBe('manual');
    expect(normalizeDraftPickOrderMode('anything-else')).toBe('random');

    const limits = normalizeDraftPositionLimits({
      DEF: 6,
      MID: 8,
      RUC: 2,
      FWD: 6,
      BENCH: 4,
    });

    expect(getRosterSizeFromPositionLimits(limits)).toBe(22);
    expect(getBenchSizeFromPositionLimits(limits)).toBe(4);
  });

  it('parses persisted JSON metadata safely', () => {
    expect(normalizeDraftPositionLimits('not-json')).toEqual(DEFAULT_DRAFT_POSITION_LIMITS);
    expect(
      normalizeDraftAutoPickRules(JSON.stringify({ enabled: false, strategy: 'best-available' }))
    ).toEqual({
      enabled: false,
      strategy: 'best-available',
    });
  });
});
