import { describe, expect, it } from 'vitest';

import {
  biggestWins,
  clubSlug,
  filterTrades,
  parseTradesListQuery,
  tradesListClubs,
  tradesListHref,
  tradeLadder,
  tradesListYears,
  tradeYearSummaries,
} from '@/components/aflTradeStory/tradesListQuery';
import type { AflTradeStorySampleSummary } from '@/server/aflTradeIntelligence/development/tradeStorySamples';

/** The public trade list's filters: year and club combine, and the address says what is shown. */

const trade = (
  tradeId: string,
  year: number,
  clubs: [string, number][],
  provisional = false
): AflTradeStorySampleSummary => ({
  tradeId,
  year,
  clubNames: clubs.map(([name]) => name),
  clubIds: clubs.map(([name]) => `club:${clubSlug(name)}`),
  results: clubs.map(([clubName, net]) => ({
    clubId: `club:${clubSlug(clubName)}`,
    clubName,
    net,
    provisional,
    received: [`asset for ${clubName}`],
  })),
});

const stories = [
  trade('t1', 2025, [
    ['Geelong', 10],
    ['GWS', -10],
  ]),
  trade('t2', 2025, [
    ['Carlton', -80],
    ['Western Bulldogs', 80],
  ]),
  trade('t3', 2024, [
    ['Geelong', 40],
    ['Carlton', -40],
  ]),
  trade(
    't4',
    2024,
    [
      ['GWS', 200],
      ['Sydney', -200],
    ],
    true
  ),
];

describe('trade list query', () => {
  it('names clubs as address words and lists years newest first', () => {
    expect(clubSlug('Western Bulldogs')).toBe('western-bulldogs');
    expect(clubSlug('GWS')).toBe('gws');
    expect(tradesListYears(stories)).toEqual([2025, 2024]);
    expect(tradesListClubs(stories).map(({ slug }) => slug)).toEqual([
      'carlton',
      'geelong',
      'gws',
      'sydney',
      'western-bulldogs',
    ]);
  });

  it('shows the latest year by default, and every year once a club is chosen', () => {
    expect(parseTradesListQuery({}, stories)).toEqual({ year: 2025, club: null, sort: 'newest' });
    expect(parseTradesListQuery({ club: 'geelong' }, stories)).toEqual({
      year: null,
      club: 'geelong',
      sort: 'newest',
    });
    expect(parseTradesListQuery({ year: 'all' }, stories).year).toBeNull();
    expect(
      parseTradesListQuery({ year: '2024', club: 'Geelong', sort: 'biggest' }, stories)
    ).toEqual({ year: 2024, club: 'geelong', sort: 'biggest' });
  });

  it('ignores a year, club or sort it does not know', () => {
    expect(parseTradesListQuery({ year: '1999', club: 'fitzroy', sort: 'worst' }, stories)).toEqual(
      { year: 2025, club: null, sort: 'newest' }
    );
    expect(parseTradesListQuery({ year: ['2024', '2025'] }, stories).year).toBe(2024);
  });

  it('combines year and club, and sorts by the biggest swing', () => {
    const ids = (query: Parameters<typeof filterTrades>[1]) =>
      filterTrades(stories, query).map(({ tradeId }) => tradeId);
    expect(ids({ year: 2025, club: null, sort: 'newest' })).toEqual(['t1', 't2']);
    expect(ids({ year: null, club: 'geelong', sort: 'newest' })).toEqual(['t1', 't3']);
    expect(ids({ year: 2024, club: 'geelong', sort: 'newest' })).toEqual(['t3']);
    expect(ids({ year: 2025, club: 'sydney', sort: 'newest' })).toEqual([]);
    expect(ids({ year: null, club: null, sort: 'biggest' })).toEqual(['t4', 't2', 't3', 't1']);
  });

  it('writes an address that reads back as the same query', () => {
    for (const query of [
      { year: 2024, club: 'geelong', sort: 'biggest' },
      { year: null, club: null, sort: 'newest' },
      { year: 2025, club: 'western-bulldogs', sort: 'newest' },
    ] as const) {
      const href = tradesListHref(query);
      expect(href.startsWith('/afl/trades?')).toBe(true);
      const params = Object.fromEntries(new URLSearchParams(href.split('?')[1]));
      expect(parseTradesListQuery(params, stories)).toEqual(query);
    }
  });

  it('ranks the biggest wins, one per trade, leaving out provisional results', () => {
    expect(biggestWins(stories, 2).map(({ clubName, net }) => [clubName, net])).toEqual([
      ['Western Bulldogs', 80],
      ['Geelong', 40],
    ]);
  });
  it('ranks clubs on a ladder by their combined result, with a record', () => {
    const ladder = tradeLadder(stories);
    expect(ladder.map(({ name, net }) => [name, net])).toEqual([
      ['GWS', 190],
      ['Western Bulldogs', 80],
      ['Geelong', 50],
      ['Carlton', -120],
      ['Sydney', -200],
    ]);
    expect(ladder.reduce((sum, { net }) => sum + net, 0)).toBe(0);
    const geelong = ladder.find(({ slug }) => slug === 'geelong')!;
    expect([geelong.ahead, geelong.behind, geelong.provisional]).toEqual([2, 0, false]);
    expect(ladder.find(({ slug }) => slug === 'gws')!.provisional).toBe(true);
  });

  it('summarises each year with its trade count and biggest settled win', () => {
    expect(
      tradeYearSummaries(stories).map(({ year, trades, biggest }) => [
        year,
        trades,
        biggest?.clubName,
      ])
    ).toEqual([
      [2025, 2, 'Western Bulldogs'],
      [2024, 2, 'Geelong'],
    ]);
  });
});
