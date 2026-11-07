import { describe, expect, it } from 'vitest';

import { formatLeagueTime } from './leagueTime';

// Perth never observes daylight saving, so 09:30 UTC is always 5:30 pm AWST, whatever zone the
// test runner is in (CI runs in UTC, this Mac in Melbourne).
const INSTANT = '2026-10-03T09:30:00.000Z';

describe('formatLeagueTime', () => {
  it('formats an instant in the league timezone with its abbreviation', () => {
    expect(formatLeagueTime(INSTANT, 'Australia/Perth')).toMatch(/^Sat,? 3 Oct,? 5:30\spm AWST$/);
  });

  it('accepts a Date', () => {
    expect(formatLeagueTime(new Date(INSTANT), 'Australia/Perth')).toMatch(/5:30\spm AWST$/);
  });

  it('formats the time of day alone when asked', () => {
    expect(formatLeagueTime(INSTANT, 'Australia/Perth', 'time')).toMatch(/^5:30\spm AWST$/);
  });

  it('falls back to UTC, labelled, for an unknown timezone', () => {
    expect(formatLeagueTime(INSTANT, 'Not/AZone')).toMatch(/9:30\sam UTC$/);
  });
});
