import { describe, expect, it } from 'vitest';

import {
  getWeekWindowStart,
  isCantCutPlayer,
  parseLeagueWaiverRules,
} from './leagueRules';

describe('parseLeagueWaiverRules', () => {
  it('applies defaults when settings are missing', () => {
    const rules = parseLeagueWaiverRules(undefined);
    expect(rules.system).toBe('ROLLING_LIST');
    expect(rules.minimumBid).toBe(1);
    expect(rules.waiverPeriodHours).toBe(24);
    expect(rules.cantDropList).toEqual([]);
    expect(rules.priorityMode).toBe('ROLLING');
    expect(rules.moveWinnerToBack).toBe(true);
    expect(rules.acquisitionLocked).toBe(false);
  });

  it('normalizes explicit waiver settings and aliases', () => {
    const rules = parseLeagueWaiverRules({
      waiverSettings: {
        system: 'FAAB',
        minimumBid: 7,
        waiverPeriod: 36,
        cantDropList: ['p1', 'p2'],
        maxWeekAcquisitions: 3,
        maxSeasonAcquisitions: 24,
        priorityMode: 'REVERSE_LADDER',
        movesToBack: false,
      },
      cantDropList: ['p2', 'p3'],
      lockoutSettings: { acquisitionLocked: true },
    });

    expect(rules.system).toBe('FAAB');
    expect(rules.minimumBid).toBe(7);
    expect(rules.waiverPeriodHours).toBe(36);
    expect(rules.cantDropList).toEqual(['p1', 'p2', 'p3']);
    expect(rules.maxWeekAcquisitions).toBe(3);
    expect(rules.maxSeasonAcquisitions).toBe(24);
    expect(rules.priorityMode).toBe('REVERSE_LADDER');
    expect(rules.moveWinnerToBack).toBe(false);
    expect(rules.acquisitionLocked).toBe(true);
  });
});

describe('misc rule helpers', () => {
  it('checks cant cut list membership', () => {
    const rules = parseLeagueWaiverRules({ waiverSettings: { cantDropList: ['abc'] } });
    expect(isCantCutPlayer('abc', rules)).toBe(true);
    expect(isCantCutPlayer('xyz', rules)).toBe(false);
  });

  it('returns monday utc week start', () => {
    const weekStart = getWeekWindowStart(new Date('2026-02-27T18:45:00.000Z'));
    expect(weekStart.toISOString()).toBe('2026-02-23T00:00:00.000Z');
  });
});
