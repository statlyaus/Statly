import { describe, expect, it } from 'vitest';

import { isInjuryListSeason } from './injuryListSchedule';

describe('isInjuryListSeason', () => {
  it('runs from New Year through 7 October, Melbourne time', () => {
    expect(isInjuryListSeason(new Date('2026-01-01T00:00:00+11:00'))).toBe(true);
    expect(isInjuryListSeason(new Date('2026-06-15T12:00:00+10:00'))).toBe(true);
    expect(isInjuryListSeason(new Date('2026-10-07T23:59:00+11:00'))).toBe(true);
  });

  it('is off from 8 October until New Year', () => {
    expect(isInjuryListSeason(new Date('2026-10-08T00:00:00+11:00'))).toBe(false);
    expect(isInjuryListSeason(new Date('2026-11-20T09:00:00+11:00'))).toBe(false);
    expect(isInjuryListSeason(new Date('2026-12-31T23:59:00+11:00'))).toBe(false);
  });

  it('decides on the Melbourne date, not the UTC date', () => {
    // 7 October 14:00 UTC is already 8 October 01:00 in Melbourne (AEDT).
    expect(isInjuryListSeason(new Date('2026-10-07T14:00:00Z'))).toBe(false);
    // 31 December 14:00 UTC is 1 January 01:00 in Melbourne.
    expect(isInjuryListSeason(new Date('2026-12-31T14:00:00Z'))).toBe(true);
  });
});
