import { describe, expect, it } from 'vitest';

import { getDraftStatSeasonOptions } from '@/server/draft/readModels/draftPlayerReadModel';
import type { Player } from '@/types/players';

function playerWithSeasons(id: string, availableStatSeasons: number[]): Player {
  return {
    id,
    name: id,
    team: 'GWS',
    position: 'MID',
    stats: {},
    availableStatSeasons,
    statsBySeason: Object.fromEntries(
      availableStatSeasons.map((season) => [
        String(season),
        {
          games: 1,
          dataThrough: `${season}-09-01`,
          stats: { goals: 1 },
          basisByStat: { goals: 'TOTAL' as const },
        },
      ])
    ),
  };
}

function playerWithStatsSeason(id: string, statsSeason: number): Player {
  return {
    id,
    name: id,
    team: 'GWS',
    position: 'MID',
    stats: {},
    statsSeason,
    statsBySeason: {
      [String(statsSeason)]: {
        games: 1,
        dataThrough: `${statsSeason}-09-01`,
        stats: { goals: 1 },
        basisByStat: { goals: 'TOTAL' },
      },
    },
  };
}

describe('getDraftStatSeasonOptions', () => {
  it('defaults to the newest season present in player stat data', () => {
    const options = getDraftStatSeasonOptions([
      playerWithSeasons('player-1', [2025]),
      playerWithSeasons('player-2', [2024, 2023]),
    ]);

    expect(options).toEqual({
      selectedSeason: 2025,
      availableSeasons: [2025, 2024, 2023],
    });
  });

  it('uses a requested season when that season is available', () => {
    const options = getDraftStatSeasonOptions([playerWithSeasons('player-1', [2025, 2024])], 2024);

    expect(options).toEqual({
      selectedSeason: 2024,
      availableSeasons: [2025, 2024],
    });
  });

  it('falls back to the newest available season when the requested season has no stats', () => {
    const options = getDraftStatSeasonOptions(
      [playerWithSeasons('player-1', [2025]), playerWithSeasons('player-2', [2025])],
      2026
    );

    expect(options).toEqual({
      selectedSeason: 2025,
      availableSeasons: [2025],
    });
  });

  it('uses statsSeason when a player does not expose availableStatSeasons', () => {
    const options = getDraftStatSeasonOptions([playerWithStatsSeason('player-1', 2025)]);

    expect(options).toEqual({
      selectedSeason: 2025,
      availableSeasons: [2025],
    });
  });
});
