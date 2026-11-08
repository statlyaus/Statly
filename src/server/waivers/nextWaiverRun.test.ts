import { describe, expect, it } from 'vitest';

import { nextWaiverRunAt } from './nextWaiverRun';

describe('nextWaiverRunAt', () => {
  it.each([
    // AEST (UTC+10): 10:00 am on 1 July runs at 6 am on 2 July.
    ['2026-07-01T00:00:00.000Z', '2026-07-01T20:00:00.000Z'],
    // 5:59 am runs the same morning.
    ['2026-07-01T19:59:00.000Z', '2026-07-01T20:00:00.000Z'],
    // Due exactly at 6 am: that run processes it.
    ['2026-07-01T20:00:00.000Z', '2026-07-01T20:00:00.000Z'],
    // 6:30 am misses that run and waits a day.
    ['2026-07-01T20:30:00.000Z', '2026-07-02T20:00:00.000Z'],
    // AEDT (UTC+11): 9 pm on 1 December runs at 6 am on 2 December.
    ['2026-12-01T10:00:00.000Z', '2026-12-01T19:00:00.000Z'],
  ])('a claim due at %s is processed at %s', (dueAt, runAt) => {
    expect(nextWaiverRunAt(new Date(dueAt)).toISOString()).toBe(runAt);
  });
});
