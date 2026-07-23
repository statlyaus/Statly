import { describe, expect, it } from 'vitest';

import {
  evaluateRosterExchangeCapacity,
  getLeagueRosterCapacity,
} from '@/server/rosters/rosterCapacity';

describe('roster capacity', () => {
  it('combines active roster and bench settings', () => {
    expect(getLeagueRosterCapacity({ rosterSize: 18, benchSize: 4 })).toBe(22);
  });

  it('allows exchanges that stay within total ownership capacity', () => {
    expect(
      evaluateRosterExchangeCapacity({
        currentCount: 22,
        outgoingCount: 2,
        incomingCount: 2,
        capacity: 22,
      })
    ).toMatchObject({ nextCount: 22, isAllowed: true });
  });

  it('rejects an exchange that creates new overflow', () => {
    expect(
      evaluateRosterExchangeCapacity({
        currentCount: 21,
        outgoingCount: 1,
        incomingCount: 3,
        capacity: 22,
      })
    ).toMatchObject({ nextCount: 23, isAllowed: false });
  });

  it('grandfathers only non-increasing pre-existing overflow', () => {
    expect(
      evaluateRosterExchangeCapacity({
        currentCount: 24,
        outgoingCount: 2,
        incomingCount: 2,
        capacity: 22,
      }).isAllowed
    ).toBe(true);
    expect(
      evaluateRosterExchangeCapacity({
        currentCount: 24,
        outgoingCount: 1,
        incomingCount: 2,
        capacity: 22,
      }).isAllowed
    ).toBe(false);
  });
});
