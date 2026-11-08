import { describe, expect, it } from 'vitest';

import {
  normalizePlayerRow,
  REQUIRED_CATEGORY_FIELDS,
  toProcessedStats,
} from '../../etl/normalizePlayerRow';
import { REAL_DATA_NINE_CATEGORY_PRESET } from '../../src/types/fantasyCategories';

describe('Footywire row normalization', () => {
  it('converts numeric strings before identifiers, checksums, and persistence use the row', () => {
    const row = normalizePlayerRow({
      season: '2026',
      round: '7',
      team: 'Carlton',
      opposition: 'Richmond',
      player_name: 'Test Player',
      kicks: '14',
      disposals: '27',
      tog_pct: '81.5',
      goals: null,
      behinds: 0,
    });

    expect(row).toMatchObject({
      season: 2026,
      round: 7,
      kicks: 14,
      disposals: 27,
      tog_pct: 81.5,
      behinds: 0,
    });
    expect(row.goals).toBeUndefined();
    expect(row).not.toHaveProperty('goals');
    expect(row).toHaveProperty('behinds', 0);
  });

  it('rejects invalid required and numeric fields', () => {
    expect(() =>
      normalizePlayerRow({ season: ' ', round: 1, team: 'Carlton', player_name: 'Player' })
    ).toThrow('season is required');
    expect(() =>
      normalizePlayerRow({ season: 'unknown', round: 1, team: 'Carlton', player_name: 'Player' })
    ).toThrow('season must be a finite number');
    expect(() =>
      normalizePlayerRow({ season: 2026, round: 1, team: '', player_name: 'Player' })
    ).toThrow('team is required');
    expect(() =>
      normalizePlayerRow({
        season: 2026,
        round: 1,
        team: 'Carlton',
        player_name: 'Player',
        kicks: 'many',
      })
    ).toThrow('kicks must be a finite number');
  });

  const categoryStats = Object.fromEntries(REQUIRED_CATEGORY_FIELDS.map((field) => [field, 0]));

  it('keeps an unreported stat as null instead of writing a zero', () => {
    const stats = toProcessedStats(
      normalizePlayerRow({
        season: 2026,
        round: 7,
        team: 'Carlton',
        player_name: 'Test Player',
        ...categoryStats,
        kicks: 14,
      })
    );

    expect(stats.goals).toBe(0);
    expect(stats.kicks).toBe(14);
    expect(stats.clangers).toBeNull();
    expect(stats.metres_gained).toBeNull();
  });

  it('refuses a row missing a category stat rather than scoring it as zero', () => {
    const { effective_disposals: _omitted, ...withoutEd } = categoryStats;
    const row = normalizePlayerRow({
      season: 2026,
      round: 7,
      team: 'Carlton',
      player_name: 'Test Player',
      ...withoutEd,
    });

    expect(() => toProcessedStats(row)).toThrow(
      'Test Player is missing category stats: effective_disposals'
    );
  });

  it('requires exactly the default nine-category preset', () => {
    const toCamel = (field: string) =>
      field
        .replace(/_(\w)/g, (_match, letter: string) => letter.toUpperCase())
        .replace('50S', '50s');

    expect(REQUIRED_CATEGORY_FIELDS.map(toCamel)).toEqual([...REAL_DATA_NINE_CATEGORY_PRESET]);
  });
});
