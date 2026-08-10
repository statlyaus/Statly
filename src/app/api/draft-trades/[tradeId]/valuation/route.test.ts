import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDraftTradeByIdMock, valueReadService } = vi.hoisted(() => ({
  getDraftTradeByIdMock: vi.fn(),
  valueReadService: { detail: vi.fn() },
}));

vi.mock('@/lib/draftTrades/read', () => ({
  getDraftTradeById: getDraftTradeByIdMock,
}));

vi.mock('@/server/aflTradeIntelligence/runtime/publicReadRuntime', () => ({
  getPublicAflTradeReadRuntime: async () => ({ valueReadService }),
}));

import { GET } from './route';
import { aflTradePrePublicationValueReadService } from '@/server/aflTradeIntelligence/publication/prePublicationValueReadService';

const context = (tradeId: string) => ({ params: Promise.resolve({ tradeId }) });
const canonicalTradeId = `external-transaction:${'a'.repeat(64)}`;

describe('GET /api/draft-trades/[tradeId]/valuation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    valueReadService.detail.mockImplementation((request) =>
      aflTradePrePublicationValueReadService.detail(request)
    );
  });

  it.each([
    ['bad id', 'http://localhost/api/draft-trades/bad/valuation', []],
    ['t1', 'http://localhost/api/draft-trades/t1/valuation?view=fantasy', []],
    ['t1', 'http://localhost/api/draft-trades/t1/valuation?view=current&view=current', []],
  ])('returns 400 before archive access for an invalid request', async (tradeId, url) => {
    const response = await GET(new NextRequest(url), context(tradeId));
    expect(response.status).toBe(400);
    expect(getDraftTradeByIdMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the public archive does not contain the trade', async () => {
    getDraftTradeByIdMock.mockResolvedValue(null);
    const response = await GET(
      new NextRequest('http://localhost/api/draft-trades/missing/valuation'),
      context('missing')
    );

    expect(response.status).toBe(404);
    expect(getDraftTradeByIdMock).toHaveBeenCalledWith('missing');
  });

  it.each([
    [[], ['at_trade', 'realized', 'remaining', 'current']],
    [
      ['at_trade', 'current'],
      ['at_trade', 'current'],
    ],
  ])(
    'returns not-calculated detail for a known archive trade',
    async (queryViews, expectedViews) => {
      getDraftTradeByIdMock.mockResolvedValue({
        trade: { tradeId: canonicalTradeId },
        parties: [],
        assets: [],
      });
      const query = queryViews.map((view) => `view=${view}`).join('&');
      const response = await GET(
        new NextRequest(
          `http://localhost/api/draft-trades/${encodeURIComponent(canonicalTradeId)}/valuation${query ? `?${query}` : ''}`
        ),
        context(encodeURIComponent(canonicalTradeId))
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toMatchObject({
        tradeId: canonicalTradeId,
        assets: [],
        lineageSummary: {
          status: 'unavailable',
          totalAssetCount: null,
          resolvedAssetCount: null,
          unresolvedAssetCount: null,
          lineageEdgeCount: null,
          maximumDepth: null,
        },
        consistency: {
          contractVersion: 'afl-trade-value/v2',
          selection: 'none',
          publication: null,
          projectionBuildId: null,
        },
      });
      expect(body.data.valuations.map((valuation: { view: string }) => valuation.view)).toEqual(
        expectedViews
      );
      expect(getDraftTradeByIdMock).toHaveBeenCalledWith(canonicalTradeId);
      expect(valueReadService.detail).toHaveBeenCalledWith(
        expect.objectContaining({ tradeId: canonicalTradeId })
      );
      expect(
        body.data.valuations.every(
          (valuation: { availability: string }) => valuation.availability === 'not_calculated'
        )
      ).toBe(true);
      expect(JSON.stringify(body.data)).not.toMatch(
        /"(userId|leagueId|rosterId|ownerId|estimate|clubValues|probabilities)"/
      );
    }
  );
});
