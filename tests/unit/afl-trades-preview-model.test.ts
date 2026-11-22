import { describe, expect, it } from 'vitest';

import { clubSlug } from '@/components/aflTradeStory/tradesListQuery';
import {
  clubCounts,
  clubTotals,
  rowSides,
  samePlayerTrades,
  selectedTrade,
  yearCounts,
} from '@/components/aflTradeStory/tradesPreviewModel';
import type { AflTradeStorySampleSummary } from '@/server/aflTradeIntelligence/development/tradeStorySamples';

/** The list's preview panel: which trade it shows, the rail's counts and the "Where next" links. */

const trade = (
  tradeId: string,
  year: number,
  clubs: [string, number, string[]][]
): AflTradeStorySampleSummary => ({
  tradeId,
  year,
  clubNames: clubs.map(([name]) => name),
  clubIds: clubs.map(([name]) => `club:${clubSlug(name)}`),
  results: clubs.map(([clubName, net, received]) => ({
    clubId: `club:${clubSlug(clubName)}`,
    clubName,
    net,
    provisional: false,
    projected: false,
    received,
  })),
});

const grundyOut = trade('grundy-22', 2022, [
  ['Melbourne', -62.3, ['Brodie Grundy']],
  ['Collingwood', 62.3, ['2022 pick 13']],
]);
const grundyIn = trade('grundy-23', 2023, [
  ['Melbourne', -68.7, ['2024 round 2 (Sydney)', '2023 pick 46']],
  ['Sydney', 68.7, ['Brodie Grundy']],
]);
const pickTwice = trade('pick-23', 2023, [
  ['Hawthorn', 34.8, ['2023 pick 46', '2024 round 4 (Sydney)']],
  ['Sydney', -34.8, ['2023 pick 53']],
]);
const stories = [grundyIn, pickTwice, grundyOut];

describe('trade list preview', () => {
  it('previews the named trade when the list shows it, else the first row', () => {
    expect(selectedTrade(stories, 'pick-23')?.tradeId).toBe('pick-23');
    expect(selectedTrade(stories, 'not-shown')?.tradeId).toBe('grundy-23');
    expect(selectedTrade(stories, null)?.tradeId).toBe('grundy-23');
    expect(selectedTrade([], 'pick-23')).toBeNull();
  });

  it('finds the same player in other trades, never matching on a pick', () => {
    expect(samePlayerTrades(stories, grundyIn)).toEqual([
      { player: 'Brodie Grundy', story: grundyOut },
    ]);
    // "2023 pick 46" is in two trades, but a pick is not a player.
    expect(samePlayerTrades(stories, pickTwice)).toEqual([]);
  });

  it('counts trades per year for the chosen club, and per club for the chosen year', () => {
    expect(yearCounts(stories, null)).toEqual({
      all: 3,
      byYear: new Map([
        [2023, 2],
        [2022, 1],
      ]),
    });
    expect(yearCounts(stories, 'sydney')).toEqual({ all: 2, byYear: new Map([[2023, 2]]) });
    expect(clubCounts(stories, 2023)).toEqual({
      all: 2,
      bySlug: new Map([
        ['melbourne', 1],
        ['sydney', 2],
        ['hawthorn', 1],
      ]),
    });
    expect(clubCounts(stories, null).bySlug.get('melbourne')).toBe(2);
  });

  it("totals a club's trades and its combined result over every year", () => {
    const sydney = clubTotals(stories, 'sydney');
    expect(sydney.trades).toBe(2);
    expect(sydney.net).toBeCloseTo(33.9);
    expect(clubTotals(stories, 'fitzroy')).toEqual({ trades: 0, net: 0 });
  });

  it("leads a row with the chosen club's side, else the club ahead", () => {
    expect(rowSides(grundyIn, null)?.lead.clubName).toBe('Sydney');
    expect(rowSides(grundyIn, 'melbourne')?.lead.clubName).toBe('Melbourne');
    expect(rowSides(grundyIn, 'melbourne')?.others.map(({ clubName }) => clubName)).toEqual([
      'Sydney',
    ]);
    // A club not in the trade leaves the club ahead in front.
    expect(rowSides(pickTwice, 'melbourne')?.lead.clubName).toBe('Hawthorn');
    expect(rowSides({ ...grundyIn, results: [] }, null)).toBeNull();
  });
});
