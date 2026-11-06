import { describe, expect, it } from 'vitest';

import {
  buildAvailableDraftPlayer,
  buildDraftPlayerStatsLookup,
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
    const scores = calculateStatlyZScores(
      [{ id: 'p1', stats: { goals: 3 } }],
      ['goals', 'tackles']
    );

    expect(scores.get('p1')?.missingCategories).toEqual(['tackles']);
    expect(scores.get('p1')?.score).toBe(0);
  });

  it('lowers the score of the higher value in a LOW_WINS category and keeps the raw value', () => {
    const scores = calculateStatlyZScores(
      [
        { id: 'clean', stats: { goals: 1, turnovers: 2 } },
        { id: 'loose', stats: { goals: 1, turnovers: 6 } },
      ],
      ['goals', 'turnovers'],
      { goals: 'HIGH_WINS', turnovers: 'LOW_WINS' }
    );

    expect(scores.get('clean')?.score).toBe(1);
    expect(scores.get('clean')?.breakdown[1]).toMatchObject({
      category: 'turnovers',
      value: 2,
      zScore: 1,
    });
    expect(scores.get('loose')?.score).toBe(-1);
    expect(scores.get('loose')?.breakdown[1]).toMatchObject({
      category: 'turnovers',
      value: 6,
      zScore: -1,
    });
  });

  it('applies the league direction to any category, so a LOW_WINS goals league ranks fewer goals higher', () => {
    const scores = calculateStatlyZScores(players, categories, { goals: 'LOW_WINS' });

    const p1 = scores.get('p1');
    const p2 = scores.get('p2');
    expect(p1?.breakdown[0]).toMatchObject({ category: 'goals', value: 3 });
    expect(p1?.breakdown[0]?.zScore).toBeLessThan(0);
    expect(p2?.breakdown[0]?.zScore).toBeGreaterThan(0);
    // goals flips sign, tackles and inside 50s stay HIGH_WINS.
    const highWins = calculateStatlyZScores(players, categories);
    expect(p1?.breakdown[0]?.zScore).toBe(-(highWins.get('p1')?.breakdown[0]?.zScore ?? 0));
    expect(p1?.breakdown.slice(1)).toEqual(highWins.get('p1')?.breakdown.slice(1));
    expect(p1?.score).toBeLessThan(highWins.get('p1')?.score ?? 0);
    expect(p1?.score).toBeCloseTo(
      p1?.breakdown.reduce((total, entry) => total + entry.zScore, 0) ?? NaN,
      1
    );
  });

  it('treats every category as HIGH_WINS when the league stores no direction', () => {
    const scores = calculateStatlyZScores(
      [
        { id: 'few', stats: { turnovers: 2 } },
        { id: 'many', stats: { turnovers: 6 } },
      ],
      ['turnovers']
    );

    expect(scores.get('few')?.score).toBe(-1);
    expect(scores.get('many')?.score).toBe(1);
  });

  it('gives a draft player the stats of its own club when another player shares the name', () => {
    const seasonStats = (id: string, team: string, goals: number) => ({
      id,
      name: 'Max King',
      team,
      position: 'FWD',
      games: 10,
      statsSeason: 2025,
      availableStatSeasons: [2025],
      stats: { goals },
      statsBySeason: {
        '2025': {
          games: 10,
          dataThrough: '2025-07-18',
          stats: { goals },
          basisByStat: { goals: 'TOTAL' as const },
        },
      },
    });
    const lookup = buildDraftPlayerStatsLookup(
      [seasonStats('stk-max-king', 'St Kilda', 10), seasonStats('syd-max-king', 'Sydney', 20)],
      { season: 2025 }
    );

    const player = buildAvailableDraftPlayer(
      { id: 'draft-77', name: 'Max King', club: 'St Kilda', position: 'FWD' },
      lookup
    );

    expect(player.stats?.goals).toBe(1);
  });

  it('projects season match-log totals into per-game averages for the selected season', () => {
    const lookup = buildDraftPlayerStatsLookup(
      [
        {
          id: 'tyson-stengle-geelong',
          name: 'Tyson Stengle',
          team: 'Geelong',
          position: 'MID',
          games: 16,
          statsSeason: 2025,
          availableStatSeasons: [2025],
          stats: { goals: 22, marks: 43, tackles: 54, hitouts: 0 },
          statsBySeason: {
            '2025': {
              games: 16,
              dataThrough: '2025-07-18',
              stats: { goals: 22, marks: 43, tackles: 54, hitouts: 0 },
              basisByStat: {
                goals: 'TOTAL',
                marks: 'TOTAL',
                tackles: 'TOTAL',
                hitouts: 'TOTAL',
              },
            },
          },
        },
      ],
      { season: 2025 }
    );

    const player = buildAvailableDraftPlayer(
      { id: 'tyson_stengle', name: 'Tyson Stengle', club: 'Geelong', position: 'MID' },
      lookup
    );

    expect(player.gamesPlayed).toBe(16);
    expect(player.statsSeason).toBe(2025);
    expect(player.stats?.goals).toBe(1.4);
    expect(player.stats?.marks).toBe(2.7);
    expect(player.stats?.tackles).toBe(3.4);
  });
});
