import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { valueReadService } = vi.hoisted(() => ({
  valueReadService: { list: vi.fn() },
}));

vi.mock('@/server/aflTradeIntelligence/runtime/publicReadRuntime', () => ({
  getPublicAflTradeReadRuntime: async () => ({ valueReadService }),
}));

import { GET } from './route';
import { aflTradePrePublicationValueReadService } from '@/server/aflTradeIntelligence/publication/prePublicationValueReadService';

describe('GET /api/draft-trades/valuations', () => {
  beforeEach(() => {
    valueReadService.list.mockImplementation((request) =>
      aflTradePrePublicationValueReadService.list(request)
    );
  });

  it.each([
    'http://localhost/api/draft-trades/valuations',
    'http://localhost/api/draft-trades/valuations?tradeId=t1&tradeId=t1',
    'http://localhost/api/draft-trades/valuations?tradeId=t1&view=fantasy',
    'http://localhost/api/draft-trades/valuations?tradeId=t1&limit=101',
  ])('returns 400 for an invalid bounded query: %s', async (url) => {
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(400);
  });

  it.each(['current', 'at_trade'] as const)(
    'returns a v2 not-calculated state for the %s view',
    async (view) => {
      const response = await GET(
        new NextRequest(
          `http://localhost/api/draft-trades/valuations?tradeId=t1&tradeId=t2&view=${view}`
        )
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.consistency).toMatchObject({
        contractVersion: 'afl-trade-value/v2',
        selection: 'none',
        publication: null,
        projectionBuildId: null,
        registryRevision: 0,
        freshness: 'unavailable',
      });
      expect(body.data.items).toHaveLength(2);
      expect(
        body.data.items.every(
          (item: { valuation: { availability: string; view: string } }) =>
            item.valuation.availability === 'not_calculated' && item.valuation.view === view
        )
      ).toBe(true);
      expect(JSON.stringify(body.data)).not.toMatch(
        /"(userId|leagueId|rosterId|ownerId|estimate|clubValues|probabilities)"/
      );
    }
  );
});
