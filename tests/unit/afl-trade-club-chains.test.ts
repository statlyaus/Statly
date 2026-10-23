import { describe, expect, it } from 'vitest';

import {
  cameronChainLines,
  cameronChainNames,
} from '@/server/aflTradeIntelligence/development/tradeStorySampleChain';
import { buildAflTradeClubChains } from '@/server/aflTradeIntelligence/valuation/clubTradeChains';
import { buildAflTradeStory } from '@/server/aflTradeIntelligence/valuation/realizedTradeStory';

const trades = cameronChainLines.structure.content.trades;
const clubIds = [...cameronChainNames.clubs.keys()];

describe('club trade chains (#1051)', () => {
  it("puts every one of a club's trades in exactly one chain or on its own", () => {
    for (const clubId of clubIds) {
      const result = buildAflTradeClubChains(cameronChainLines, clubId, cameronChainNames);
      const mine = trades.filter((trade) => trade.clubs.some((club) => club.clubId === clubId));
      const listed = [...result.chains.flatMap(({ trades: rows }) => rows), ...result.standalone];
      expect(listed.map(({ tradeId }) => tradeId).sort()).toEqual(
        mine.map(({ transactionId }) => transactionId).sort()
      );
      for (const chain of result.chains) {
        expect(chain.trades.length).toBeGreaterThan(1);
        // Additive: the chain is the sum of its trades' own nets for the club.
        expect(chain.net).toBeCloseTo(
          chain.trades.reduce((total, { net }) => total + net, 0),
          6
        );
        expect(chain.provisional).toBe(chain.trades.some(({ provisional }) => provisional));
        // Oldest first.
        expect(chain.trades.map(({ year }) => year)).toEqual(
          [...chain.trades.map(({ year }) => year)].sort((left, right) => left - right)
        );
      }
    }
  });

  it("agrees with the story's chain through each trade, when that chain has no pending line", () => {
    for (const trade of trades) {
      const story = buildAflTradeStory(cameronChainLines, trade.transactionId, cameronChainNames);
      for (const through of story.nets.withNextMoves) {
        if (through.pendingCount > 0 || through.tradeIds.length < 2) continue;
        const club = buildAflTradeClubChains(cameronChainLines, through.clubId, cameronChainNames);
        // The story follows picks forward from this trade; the club chain holds all of them.
        const chain = club.chains.find((candidate) =>
          candidate.trades.some(({ tradeId }) => tradeId === trade.transactionId)
        )!;
        for (const id of through.tradeIds)
          expect(chain.trades.some(({ tradeId }) => tradeId === id)).toBe(true);
      }
    }
  });

  it('refuses a club with no name', () => {
    expect(() =>
      buildAflTradeClubChains(cameronChainLines, 'club:unknown', cameronChainNames)
    ).toThrow(/no name for club/);
  });
});
