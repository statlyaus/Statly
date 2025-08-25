import { describe, it, expect } from 'vitest';
import { validatePlayer, getPlayerStat, formatPlayerStat } from '../playerValidation';

/**
 * Helper to build a base raw player object for tests.
 */
const baseRaw = (overrides: Record<string, unknown> = {}) => ({
  id: '1',
  name: 'Test Player',
  ...overrides,
});

describe('validatePlayer', () => {
  it('accepts id=0 (number) and id="0" (string)', () => {
    const pNum = validatePlayer(baseRaw({ id: 0 }));
    const pStr = validatePlayer(baseRaw({ id: '0' }));

    expect(pNum).not.toBeNull();
    expect(pNum!.id).toBe('0');
    expect(pStr).not.toBeNull();
    expect(pStr!.id).toBe('0');
  });

  it('trims and normalizes name whitespace; rejects names that trim to empty', () => {
    const p = validatePlayer(baseRaw({ name: '  John   Doe  ' }));
    expect(p).not.toBeNull();
    expect(p!.name).toBe('John Doe');

    const invalid = validatePlayer(baseRaw({ name: '   ' }));
    expect(invalid).toBeNull();
  });

  it('handles optional fields: null/undefined/empty strings', () => {
    const p = validatePlayer(
      baseRaw({ team: '  ', position: undefined, injury: null, summary: '  Notes  ' })
    );
    expect(p).not.toBeNull();
    // team empty string -> undefined
    expect(p!.team).toBeUndefined();
    // injury null -> undefined
    expect(p!.injury).toBeUndefined();
    // summary keeps empty string allowed (trim only, not undefined)
    expect(p!.summary).toBe('Notes');
  });

  it('normalizes position to allowed codes and rejects unknown', () => {
    const s1 = validatePlayer(baseRaw({ position: 'mid' }));
    const s2 = validatePlayer(baseRaw({ position: 'MiD' }));
    const s3 = validatePlayer(baseRaw({ position: 'XX' }));
    expect(s1!.position).toBe('MID');
    expect(s2!.position).toBe('MID');
    expect(s3!.position).toBeUndefined();
  });

  it('validates and sanitizes stats via validateStats behavior', () => {
    const raw = baseRaw({
      stats: {
        goals: '12',
        metresGained: '1,234',
        timeOnGroundPct: '75%', // contains % -> percentage
        de_pct: '75', // key includes pct
        'Disposal Efficiency %': '82', // key includes %
        textStat: 'N/A', // preserved
        empty: '   ', // dropped
        arrStat: [1, 2, 3], // ignored
        negParen: '(1,234)', // parenthesis negative
        plusPrefixed: '+1,000', // leading plus
      },
    });

    const p = validatePlayer(raw);
    expect(p).not.toBeNull();
    const s = p!.stats!;
    expect(s.goals).toBe(12);
    expect(s.metresGained).toBe(1234);
    expect(s.timeOnGroundPct).toBe(75);
    expect(s['de_pct']).toBe(75);
    expect(s['Disposal Efficiency %']).toBe(82);
    expect(s.textStat).toBe('N/A');
    expect(s).not.toHaveProperty('empty');
    expect(s).not.toHaveProperty('arrStat');
    expect(s.negParen).toBe(-1234);
    expect(s.plusPrefixed).toBe(1000);
  });
});

describe('getPlayerStat', () => {
  it('returns numeric values or null when missing/invalid', () => {
    const p = validatePlayer(
      baseRaw({
        stats: {
          kicks: 10,
          bad: 'not-a-number',
        },
      })
    )!;
    expect(getPlayerStat(p, 'kicks')).toBe(10);
    expect(getPlayerStat(p, 'bad')).toBeNull();
    expect(getPlayerStat(p, 'missing')).toBeNull();
  });
});

describe('formatPlayerStat', () => {
  it('formats percentage keys with one decimal place and %', () => {
    const p = validatePlayer(baseRaw({ stats: { de_pct: 74.94, 'Shot Percentage': '66.66' } }))!;
    expect(formatPlayerStat(p, 'de_pct')).toBe('74.9%');
    expect(formatPlayerStat(p, 'Shot Percentage')).toBe('66.7%');
    // key that literally contains '%' should also format as percent
    const p2 = validatePlayer(baseRaw({ stats: { 'Disposal Efficiency %': 82.04 } }))!;
    expect(formatPlayerStat(p2, 'Disposal Efficiency %')).toBe('82.0%');
  });

  it('formats large integers with locale separators', () => {
    const p = validatePlayer(baseRaw({ stats: { metresGained: 1234567 } }))!;
    expect(formatPlayerStat(p, 'metresGained', { locale: 'en-US' })).toBe('1,234,567');
  });

  it('rounds decimals to one place for non-percent keys', () => {
    const p = validatePlayer(baseRaw({ stats: { avg: '3.14159' } }))!;
    expect(formatPlayerStat(p, 'avg')).toBe('3.1');
  });
});
