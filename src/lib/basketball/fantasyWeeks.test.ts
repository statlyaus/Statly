import { describe, expect, it } from 'vitest';
import {
  addDays,
  dateOnlyToString,
  daysBetween,
  fantasyWeekOf,
  fantasyWeekRange,
  isEasternDate,
  lastFantasyWeek,
  stringToDateOnly,
  toEasternDate,
} from './fantasyWeeks';

const WEEK_ONE = '2026-10-19';

describe('toEasternDate', () => {
  it('uses the US Eastern date, not the UTC date', () => {
    // 02:30 UTC on 21 Oct is 22:30 on 20 Oct in New York (EDT).
    expect(toEasternDate(new Date('2026-10-21T02:30:00Z'))).toBe('2026-10-20');
    // After daylight saving ends, the offset is five hours.
    expect(toEasternDate(new Date('2026-11-09T04:30:00Z'))).toBe('2026-11-08');
  });
});

describe('date-only round trip', () => {
  it('converts between strings and UTC-midnight dates', () => {
    expect(stringToDateOnly('2026-10-19').toISOString()).toBe('2026-10-19T00:00:00.000Z');
    expect(dateOnlyToString(new Date('2026-10-19T00:00:00.000Z'))).toBe('2026-10-19');
  });

  it('rejects impossible dates', () => {
    expect(isEasternDate('2026-02-30')).toBe(false);
    expect(isEasternDate('2026-2-3')).toBe(false);
    expect(() => stringToDateOnly('2026-13-01')).toThrow();
  });
});

describe('addDays and daysBetween', () => {
  it('crosses month and year ends', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3);
    expect(daysBetween('2027-01-02', '2026-12-30')).toBe(-3);
  });
});

describe('fantasyWeekOf', () => {
  it('counts seven-day weeks from week one', () => {
    expect(fantasyWeekOf('2026-10-19', WEEK_ONE)).toBe(1);
    expect(fantasyWeekOf('2026-10-25', WEEK_ONE)).toBe(1);
    expect(fantasyWeekOf('2026-10-26', WEEK_ONE)).toBe(2);
    expect(fantasyWeekOf('2026-11-08', WEEK_ONE)).toBe(3);
  });

  it('puts dates before the season in week 1', () => {
    expect(fantasyWeekOf('2026-10-01', WEEK_ONE)).toBe(1);
  });
});

describe('fantasyWeekRange', () => {
  it('lists the seven dates of a week', () => {
    const range = fantasyWeekRange(3, WEEK_ONE);
    expect(range.start).toBe('2026-11-02');
    expect(range.end).toBe('2026-11-08');
    expect(range.dates).toHaveLength(7);
  });

  it('rejects week 0', () => {
    expect(() => fantasyWeekRange(0, WEEK_ONE)).toThrow();
  });
});

describe('lastFantasyWeek', () => {
  it('is the week containing the final regular-season date', () => {
    expect(lastFantasyWeek(WEEK_ONE, '2027-04-11')).toBe(25);
  });
});
