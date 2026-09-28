import { describe, expect, it } from 'vitest';

import { layoutField, splitIntoLines } from './fieldLayout';
import { buildMyTeamSpots } from './myTeamLineup';

const shape = (spots: Array<{ slot: string }>) => spots.map((spot) => spot.slot).join(' ');

describe('fieldLayout', () => {
  it('splits a group into lines the way a team sheet reads', () => {
    expect(splitIntoLines(5)).toEqual([3, 2]);
    expect(splitIntoLines(4)).toEqual([2, 2]);
    expect(splitIntoLines(6)).toEqual([3, 3]);
    expect(splitIntoLines(1)).toEqual([1]);
    expect(splitIntoLines(0)).toEqual([]);
  });

  it('lays a standard lineup out from full-forward to full-back', () => {
    const layout = layoutField(buildMyTeamSpots({ DEF: 5, MID: 5, RUC: 1, FWD: 5, UTIL: 3 }, 3));

    expect(layout.lines.map((line) => line.short)).toEqual(['FF', 'HF', 'C', 'FOL', 'HB', 'FB']);
    expect(layout.lines.map((line) => [line.label, shape(line.spots)])).toEqual([
      ['Full-forward line', 'FWD FWD FWD'],
      ['Half-forward line', 'FWD FWD'],
      ['Centre line', 'MID MID MID'],
      ['Followers', 'MID RUC MID'],
      ['Half-back line', 'DEF DEF'],
      ['Full-back line', 'DEF DEF DEF'],
    ]);
    // Lines near goal sit further in, and lines of two further still.
    const inset = Object.fromEntries(layout.lines.map((line) => [line.label, line.inset]));
    expect(inset['Full-forward line']).toBeGreaterThan(inset['Centre line']);
    expect(inset['Half-forward line']).toBeGreaterThan(inset['Full-forward line']);
    expect(layout.utility).toHaveLength(3);
    expect(layout.interchange).toHaveLength(3);
  });

  it('copes with lineups without a ruck or with unusual counts', () => {
    const layout = layoutField(buildMyTeamSpots({ DEF: 2, MID: 4, RUC: 0, FWD: 7, UTIL: 0 }, 0));
    expect(layout.lines.map((line) => shape(line.spots))).toEqual([
      'FWD FWD FWD',
      'FWD FWD',
      'FWD FWD',
      'MID MID',
      'MID MID',
      'DEF DEF',
    ]);
    const placed = layout.lines.flatMap((line) => line.spots.map((spot) => spot.id));
    expect(new Set(placed).size).toBe(13);
  });
});
