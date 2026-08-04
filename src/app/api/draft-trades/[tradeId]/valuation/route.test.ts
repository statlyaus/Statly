import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDraftTradeByIdMock } = vi.hoisted(() => ({
  getDraftTradeByIdMock: vi.fn(),
}));

vi.mock('@/lib/draftTrades/firestore', () => ({
  getDraftTradeById: getDraftTradeByIdMock,
}));

import { GET } from './route';

const context = (tradeId: string) => ({ params: Promise.resolve({ tradeId }) });

describe('GET /api/draft-trades/[tradeId]/valuation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['bad id', 'http://localhost/api/draft-trades/bad/valuation', []],
    ['t1', 'http://localhost/api/draft-trades/t1/valuation?view=fantasy', []],
    [
      't1',
      'http://localhost/api/draft-trades/t1/valuation?view=current&view=current',
      [],
    ],
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
    [['at_trade', 'current'], ['at_trade', 'current']],
  ])('returns source-blocked detail for a known archive trade', async (queryViews, expectedViews) => {
    getDraftTradeByIdMock.mockResolvedValue({ trade: { tradeId: 't1' }, parties: [], assets: [] });
    const query = queryViews.map((view) => `view=${view}`).join('&');
    const response = await GET(
      new NextRequest(`http://localhost/api/draft-trades/t1/valuation${query ? `?${query}` : ''}`),
      context('t1')
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      tradeId: 't1',
      lineageStatus: 'unavailable',
      unresolvedAssetCount: 0,
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
    expect(
      body.data.valuations.every(
        (valuation: { availability: string }) => valuation.availability === 'source_blocked'
      )
    ).toBe(true);
    expect(JSON.stringify(body.data)).not.toMatch(
      /"(userId|leagueId|rosterId|ownerId|estimate|clubValues|probabilities)"/
    );
  });
});

