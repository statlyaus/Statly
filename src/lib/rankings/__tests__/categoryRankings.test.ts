import { describe, expect, it } from 'vitest';
import { REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';
import {
  RANKING_CATEGORIES,
  readCategoryStats,
  parseSeason,
  scoreCategories,
} from '../categoryRankings';

const fullStats = {
  goals: 2,
  tackles: 4,
  inside_50s: 3,
  intercepts: 1,
  contested_marks: 1,
  rebound_50s: 2,
  contested_possessions: 9,
  effective_disposals: 15,
  score_involvements: 5,
};

describe('RANKING_CATEGORIES', () => {
  it('is the default league preset', () => {
    expect(RANKING_CATEGORIES).toEqual(REAL_DATA_NINE_CATEGORY_PRESET);
  });
});

describe('readCategoryStats', () => {
  it('reads every preset category from the stats map', () => {
    expect(readCategoryStats({ stats: fullStats })).toEqual({
      goals: 2,
      tackles: 4,
      inside50s: 3,
      intercepts: 1,
      contestedMarks: 1,
      rebound50s: 2,
      contestedPossessions: 9,
      effectiveDisposals: 15,
      scoreInvolvements: 5,
    });
  });

  it('reports a missing stat as null, not zero or an estimate', () => {
    const { contested_possessions: _cp, ...withoutCp } = fullStats;
    const values = readCategoryStats({ stats: withoutCp, clearances: 6 });
    expect(values.contestedPossessions).toBeNull();
  });

  it('treats a stat the source did not provide as missing even when stats holds a zero', () => {
    // afltables rows: stats.intercepts is a zero filled in for the source's "NA"
    const values = readCategoryStats({
      stats: { ...fullStats, intercepts: 0 },
      source_provenance: { goals: 'afltables', tackles: 'afltables' },
    });
    expect(values.intercepts).toBeNull();
    expect(values.goals).toBe(2);
  });

  it('ignores non-numeric values', () => {
    expect(readCategoryStats({ stats: { ...fullStats, goals: 'NA' } }).goals).toBeNull();
  });
});

describe('scoreCategories', () => {
  const totals = (goals: number | null, games: number) =>
    Object.fromEntries(
      RANKING_CATEGORIES.map((c) => [
        c,
        c === 'goals' && goals !== null ? { sum: goals, games } : { sum: 0, games: 0 },
      ])
    ) as Parameters<typeof scoreCategories>[0][number]['categoryTotals'];

  it('leaves a category with no data as null and keeps it out of the averages', () => {
    const { players, averages } = scoreCategories([
      { id: 'a', categoryTotals: totals(10, 5) },
      { id: 'b', categoryTotals: totals(0, 5) },
      { id: 'c', categoryTotals: totals(null, 0) },
    ]);
    expect(averages.goals).toBe(1);
    expect(averages.intercepts).toBeNull();
    const c = players.find((p) => p.id === 'c')!;
    expect(c.categories.goals).toEqual({ perGame: null, zScore: null });
    expect(c.overall).toBe(0);
  });

  it('shows the real per-game average, not the shrunk one', () => {
    const { players } = scoreCategories([
      { id: 'a', categoryTotals: totals(10, 5) },
      { id: 'b', categoryTotals: totals(0, 5) },
    ]);
    expect(players.find((p) => p.id === 'a')!.categories.goals.perGame).toBe(2);
  });
});

describe('parseSeason', () => {
  it('parses a requested season', () => {
    expect(parseSeason('2024')).toBe(2024);
  });

  it('returns null when no usable season was requested', () => {
    expect(parseSeason(null)).toBeNull();
    expect(parseSeason('abc')).toBeNull();
  });
});
