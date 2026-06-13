import { describe, expect, it } from 'vitest';

import {
  calculateStatlyZScores,
  type StatlyZPlayerInput,
} from '@/server/draft/readModels/draftPlayerReadModel';
import type { FantasyCategoryKey } from '@/types/fantasyCategories';

const categories = ['goals', 'tackles', 'inside50s'] satisfies FantasyCategoryKey[];

const players: StatlyZPlayerInput[] = [
  { id: 'p1', stats: { goals: 3, tackles: 8, inside50s: 4 } },
  { id: 'p2', stats: { goals: 1, tackles: 4, inside50s: 2 } },
  { id: 'p3', stats: { goals: 2, tackles: 6, inside50s: 3 } },
];

describe('calculateStatlyZScores', () => {
  it('sums z scores across the league selected categories', () => {
    const scores = calculateStatlyZScores(players, categories);

    expect(scores.get('p1')?.score).toBeGreaterThan(0);
    expect(scores.get('p2')?.score).toBeLessThan(0);
    expect(scores.get('p3')?.score).toBe(0);
    expect(scores.get('p1')?.breakdown.map((entry) => entry.category)).toEqual(categories);
  });

  it('does not assume a fixed nine category set', () => {
    const scores = calculateStatlyZScores(players, ['goals']);

    expect(scores.get('p1')?.breakdown).toHaveLength(1);
    expect(scores.get('p1')?.breakdown[0]).toMatchObject({ category: 'goals' });
  });

  it('reports missing selected categories without inflating the score', () => {
    const scores = calculateStatlyZScores([{ id: 'p1', stats: { goals: 3 } }], [
      'goals',
      'tackles',
    ]);

    expect(scores.get('p1')?.missingCategories).toEqual(['tackles']);
    expect(scores.get('p1')?.score).toBe(0);
  });

  it('inverts lower-is-better categories in score and breakdown contributions', () => {
    const scores = calculateStatlyZScores(
      [
        { id: 'clean', stats: { turnovers: 2 } },
        { id: 'loose', stats: { turnovers: 6 } },
      ],
      ['turnovers']
    );

    expect(scores.get('clean')?.score).toBe(1);
    expect(scores.get('clean')?.breakdown[0]).toMatchObject({
      category: 'turnovers',
      value: 2,
      zScore: 1,
    });
    expect(scores.get('loose')?.score).toBe(-1);
    expect(scores.get('loose')?.breakdown[0]).toMatchObject({
      category: 'turnovers',
      value: 6,
      zScore: -1,
    });
  });
});
