import { describe, expect, it } from 'vitest';

import { isWaiverRunHour } from './waiverSchedule';

describe('daily waiver run hour', () => {
  it.each([
    // Melbourne daylight saving (UTC+11): 6 am on 15 January is 19:00 UTC on the 14th.
    ['2026-01-14T18:59:59Z', false],
    ['2026-01-14T19:00:00Z', true],
    ['2026-01-14T19:59:59Z', true],
    ['2026-01-14T20:00:00Z', false],
    // Melbourne standard time (UTC+10): 6 am on 15 July is 20:00 UTC on the 14th.
    ['2026-07-14T19:00:00Z', false],
    ['2026-07-14T20:00:00Z', true],
    ['2026-07-14T21:00:00Z', false],
  ])('at %s is %s', (instant, expected) => {
    expect(isWaiverRunHour(new Date(instant))).toBe(expected);
  });
});
