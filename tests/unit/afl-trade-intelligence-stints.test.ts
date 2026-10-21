import { describe, expect, it } from 'vitest';

import {
  aflTradeArrivalReviewed,
  aflTradeFirstStint,
  indexAflTradeStintInputs,
} from '@/server/aflTradeIntelligence/valuation/stints';

/**
 * The first-stint rule (realized value: the whole first stint at the receiving club, no cap, return
 * stints excluded) that the asset ledger and the value lines read (statlyaus/Statly#789).
 */
const seasons = [2021, 2022, 2023, 2024, 2025];
const index = (
  rows: Array<[number, string, number?]>,
  options: {
    arrivals?: Array<[string, number]>;
    spellSeasons?: number[];
    official?: number[];
  } = {}
) =>
  indexAflTradeStintInputs({
    pav: rows.flatMap(([season, clubId, value]) =>
      value === undefined ? [] : [{ playerId: 'p', season, clubId, value }]
    ),
    seasonSpells: rows.map(([season, clubId]) => ({ playerId: 'p', season, clubId })),
    reviewedArrivals: (options.arrivals ?? []).map(([clubId, season]) => ({
      playerId: 'p',
      clubId,
      season,
    })),
    pavCalculations: (options.official ?? seasons).map((season) => ({
      season,
      calculationId: `hpn-pav-season:${season}`,
      official: true,
    })),
    spellSeasons: options.spellSeasons ?? seasons,
  });

describe('a player’s first stint at a club', () => {
  it('ends in the first covered season he plays for another club, counting that season here', () => {
    const stint = aflTradeFirstStint(
      index([
        [2022, 'carlton', 5],
        [2023, 'carlton', 3],
        [2023, 'essendon', 1],
        [2024, 'essendon', 8],
      ]),
      'p',
      'carlton',
      2022,
      false
    );
    expect(stint).toEqual({
      status: 'closed',
      seasonsValued: [2022, 2023],
      seasonsMissingPav: [],
      pavSum: 8,
      appearedAfter: true,
    });
  });

  it('keeps the signed sum and stays open while he never leaves', () => {
    const stint = aflTradeFirstStint(
      index([
        [2022, 'carlton', 2],
        [2023, 'carlton', -5],
      ]),
      'p',
      'carlton',
      2022,
      false
    );
    expect(stint).toMatchObject({ status: 'open', pavSum: -3 });
    expect(stint.seasonsValued).toEqual([2022, 2023, 2024, 2025]);
  });

  it('runs through an uncovered season, listing its PAV as missing', () => {
    const stint = aflTradeFirstStint(
      index(
        [
          [2022, 'carlton', 4],
          [2023, 'essendon', 1],
        ],
        { spellSeasons: [2022, 2024, 2025], official: [2022, 2024, 2025] }
      ),
      'p',
      'carlton',
      2022,
      false
    );
    // 2023 is not covered, so it cannot show the move; the stint closes only in a covered season.
    expect(stint.seasonsMissingPav).toEqual([2023]);
    expect(stint.status).toBe('open');
  });

  it('ends before a later reviewed arrival at the same club, once its own arrival is reviewed', () => {
    const rows: Array<[number, string, number]> = [
      [2022, 'carlton', 4],
      [2023, 'carlton', 6],
      [2024, 'carlton', 9],
    ];
    const reviewed = index(rows, {
      arrivals: [
        ['carlton', 2022],
        ['carlton', 2024],
      ],
    });
    expect(aflTradeArrivalReviewed(reviewed, 'p', 'carlton', 2021, 2022)).toBe(true);
    expect(aflTradeFirstStint(reviewed, 'p', 'carlton', 2022, true)).toMatchObject({
      status: 'closed',
      seasonsValued: [2022, 2023],
      pavSum: 10,
    });
    // Unreviewed, the later record may be this move's own arrival, recorded late.
    expect(aflTradeFirstStint(reviewed, 'p', 'carlton', 2022, false).status).toBe('open');
    expect(aflTradeArrivalReviewed(reviewed, 'p', 'essendon', 2021, 2022)).toBe(false);
  });
});
