import { describe, expect, it } from 'vitest';

import {
  buildLeaguePlayerStatDataset,
  buildLeaguePlayerStatDatasetForTargets,
  getLeaguePlayerStatSeasonOptions,
} from '@/server/players/readModels/leaguePlayerStatReadModel';
import type { FantasyCategoryKey } from '@/types/fantasyCategories';
import type { Player, PlayerSeasonStatSource } from '@/types/players';

const CATEGORIES = [
  'goals',
  'tackles',
  'inside50s',
  'intercepts',
  'contestedMarks',
  'rebound50s',
  'contestedPossessions',
  'effectiveDisposals',
  'scoreInvolvements',
] as const satisfies readonly FantasyCategoryKey[];

function source(
  games: number,
  dataThrough: string,
  stats: PlayerSeasonStatSource['stats'],
  basisByStat: PlayerSeasonStatSource['basisByStat']
): PlayerSeasonStatSource {
  return { games, dataThrough, stats, basisByStat };
}

function player(id: string, statsBySeason: NonNullable<Player['statsBySeason']>): Player {
  return {
    id,
    name: id,
    team: 'Adelaide',
    position: 'MID',
    stats: {},
    statsBySeason,
  };
}

describe('league player stat read model', () => {
  it('projects configured columns in order and normalizes each source value exactly once', () => {
    const dataset = buildLeaguePlayerStatDataset(
      [
        player('player-1', {
          '2025': source(
            10,
            '2025-07-18',
            {
              goals: 20,
              tackles: 0,
              inside50s: 30,
              intercepts: 4.25,
              contestedMarks: 10,
              rebound50s: 20,
              contestedPossessions: 50,
              effectiveDisposals: 80,
            },
            {
              goals: 'TOTAL',
              tackles: 'TOTAL',
              inside50s: 'TOTAL',
              intercepts: 'PER_GAME',
              contestedMarks: 'TOTAL',
              rebound50s: 'TOTAL',
              contestedPossessions: 'TOTAL',
              effectiveDisposals: 'TOTAL',
            }
          ),
        }),
      ],
      {
        categories: CATEGORIES,
        categoryDirections: { tackles: 'LOW_WINS' },
      }
    );

    expect(dataset.columns.map((column) => column.shortLabel)).toEqual([
      'G',
      'T',
      'I50',
      'I',
      'CM',
      'R50',
      'CP',
      'ED',
      'SI',
    ]);
    expect(dataset.columns.map((column) => column.key)).toEqual(CATEGORIES);
    expect(dataset.columns.find((column) => column.key === 'tackles')?.direction).toBe('LOW_WINS');
    expect(dataset.playersById['player-1']).toEqual({
      gamesPlayed: 10,
      values: {
        goals: 2,
        tackles: 0,
        inside50s: 3,
        intercepts: 4.25,
        contestedMarks: 1,
        rebound50s: 2,
        contestedPossessions: 5,
        effectiveDisposals: 8,
        scoreInvolvements: null,
      },
    });
  });

  it('keeps percentages as averages, preserves missing values, and reports data freshness', () => {
    const dataset = buildLeaguePlayerStatDataset(
      [
        player('player-1', {
          '2025': source(
            12,
            '2025-07-18',
            { disposalEfficiency: 78.4 },
            { disposalEfficiency: 'PER_GAME' }
          ),
        }),
        player('player-2', {
          '2025': source(11, '2025-07-25', {}, {}),
        }),
      ],
      { categories: ['disposalEffPct', 'goals'] }
    );

    expect(dataset.context).toEqual({
      basis: 'PER_GAME',
      period: 'SEASON',
      season: 2025,
      availableSeasons: [2025],
      dataThrough: '2025-07-25',
    });
    expect(dataset.playersById['player-1'].values).toEqual({
      disposalEffPct: 78.4,
      goals: null,
    });
    expect(dataset.playersById['player-2'].values).toEqual({
      disposalEffPct: null,
      goals: null,
    });
  });

  it('uses a requested available season and otherwise falls back to the newest valid source', () => {
    const players = [
      player('player-1', {
        '2025': source(10, '2025-07-18', { goals: 20 }, { goals: 'TOTAL' }),
        '2024': source(20, '2024-09-01', { goals: 30 }, { goals: 'TOTAL' }),
      }),
    ];

    expect(getLeaguePlayerStatSeasonOptions(players, 2024)).toEqual({
      selectedSeason: 2024,
      availableSeasons: [2025, 2024],
    });
    expect(getLeaguePlayerStatSeasonOptions(players, 2023)).toEqual({
      selectedSeason: 2025,
      availableSeasons: [2025, 2024],
    });
    expect(
      buildLeaguePlayerStatDataset(players, { categories: ['goals'], season: 2024 }).playersById[
        'player-1'
      ].values.goals
    ).toBe(1.5);
  });

  it('remaps source statistics onto authoritative league player identifiers', () => {
    const sourcePlayer = player('alex-alpha-adelaide', {
      '2025': source(10, '2025-07-18', { goals: 20 }, { goals: 'TOTAL' }),
    });
    sourcePlayer.name = 'Alex Alpha';

    const dataset = buildLeaguePlayerStatDatasetForTargets(
      [sourcePlayer],
      [
        { id: 'alex_alpha', name: 'Alex Alpha', club: 'Adelaide' },
        { id: 'missing_player', name: 'Missing Player', club: 'Brisbane' },
      ],
      { categories: ['goals'] }
    );

    expect(dataset.playersById).toEqual({
      alex_alpha: { gamesPlayed: 10, values: { goals: 2 } },
      missing_player: { gamesPlayed: 0, values: { goals: null } },
    });
  });
});
