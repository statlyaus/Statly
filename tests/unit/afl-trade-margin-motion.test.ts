import { describe, expect, it } from 'vitest';

import {
  ease,
  linearAt,
  marginAt,
  leaderOf,
  marginText,
  railTop,
} from '@/components/aflTradeStory/marginMotion';

describe('margin rail motion', () => {
  const values = [22.7, 29.8, 30.7, -1.4, -55];

  it('passes through every checkpoint and ends on the last', () => {
    values.forEach((value, at) => expect(marginAt(values, at)).toBeCloseTo(value, 9));
    expect(marginAt(values, 99)).toBe(-55);
    expect(marginAt([12], 0.5)).toBe(12);
  });

  it('eases from 0 to 1 with no overshoot at the ends', () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.5, 9);
    expect(ease(2)).toBe(1);
  });

  it('reveals the lanes in straight steps between columns', () => {
    expect(linearAt([100, 200, 400], 0.5)).toBe(150);
    expect(linearAt([100, 200, 400], 1.5)).toBe(300);
  });

  it('rounds the scale to twenties and names who is ahead', () => {
    expect(railTop([{ label: 'End of 2026', value: -55, pendingCount: 0 }])).toBe(60);
    expect(railTop([{ label: 'Trade 2026', value: 0, pendingCount: 0 }])).toBe(20);
    expect(marginText(-55.04)).toBe('+55.0');
    expect(marginText(26.2, 2)).toBe('+26.2*');
    expect(marginText(0.01)).toBe('Level');
    expect(leaderOf(-55.04, 'Brisbane Lions', 'Sydney')).toBe('Sydney');
    expect(leaderOf(26.2, 'Western Bulldogs', 'North Melbourne')).toBe('Western Bulldogs');
    expect(leaderOf(0.01, 'Brisbane Lions', 'Sydney')).toBeNull();
  });
});
