import { describe, expect, it } from 'vitest';

import {
  compareTradeSelections,
  summarizeTradeComparisons,
} from '@/components/league/trades/tradeComparison';
import type { LeaguePlayerStatDatasetDto } from '@/types/leaguePlayerStats';

const dataset: LeaguePlayerStatDatasetDto = {
  context: {
    basis: 'PER_GAME',
    period: 'SEASON',
    season: 2026,
    availableSeasons: [2026],
    dataThrough: '2026-07-20',
  },
  columns: [
    {
      key: 'kicks',
      label: 'Kicks',
      shortLabel: 'K',
      format: 'number',
      direction: 'HIGH_WINS',
    },
    {
      key: 'clangers',
      label: 'Clangers',
      shortLabel: 'CL',
      format: 'number',
      direction: 'LOW_WINS',
    },
  ],
  playersById: {
    sendOne: { gamesPlayed: 10, values: { kicks: 10, clangers: 3 } },
    sendTwo: { gamesPlayed: 10, values: { kicks: 20, clangers: 1 } },
    receive: { gamesPlayed: 10, values: { kicks: 16, clangers: 0 } },
    incomplete: { gamesPlayed: 0, values: { kicks: null, clangers: 2 } },
  },
};

describe('trade comparison', () => {
  it('compares package averages instead of category totals', () => {
    const [disposals] = compareTradeSelections(['sendOne', 'sendTwo'], ['receive'], dataset);

    expect(disposals).toMatchObject({
      sendingAverage: 15,
      receivingAverage: 16,
      favourableDifference: 1,
      outcome: 'favourable',
    });
  });

  it('uses category direction and preserves real zero values', () => {
    const [, clangers] = compareTradeSelections(['sendOne', 'sendTwo'], ['receive'], dataset);

    expect(clangers).toMatchObject({
      sendingAverage: 2,
      receivingAverage: 0,
      favourableDifference: 2,
      outcome: 'favourable',
    });
  });

  it('does not fabricate a comparison when any selected value is missing', () => {
    const [disposals] = compareTradeSelections(['sendOne', 'incomplete'], ['receive'], dataset);

    expect(disposals).toMatchObject({ sendingAverage: null, outcome: 'unavailable' });
  });

  it('summarizes favourable, even, and unavailable category outcomes', () => {
    const [favourable] = compareTradeSelections(['sendOne'], ['receive'], dataset);
    const [unavailable] = compareTradeSelections(['sendOne', 'incomplete'], ['receive'], dataset);

    expect(
      summarizeTradeComparisons([
        favourable,
        favourable,
        { ...favourable, outcome: 'even' },
        unavailable,
      ])
    ).toEqual({ gained: 2, lost: 0, even: 1, unavailable: 1 });
  });

  it('counts unfavourable category outcomes as lost', () => {
    const [comparison] = compareTradeSelections(['sendOne'], ['receive'], dataset);

    expect(summarizeTradeComparisons([{ ...comparison, outcome: 'unfavourable' }])).toEqual({
      gained: 0,
      lost: 1,
      even: 0,
      unavailable: 0,
    });
  });
});
