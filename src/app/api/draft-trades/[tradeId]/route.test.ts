import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDraftTradeByIdMock } = vi.hoisted(() => ({
  getDraftTradeByIdMock: vi.fn(),
}));

vi.mock('@/lib/draftTrades/firestore', () => ({
  getDraftTradeById: getDraftTradeByIdMock,
}));

import { GET } from './route';

describe('GET /api/draft-trades/[tradeId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when trade is missing', async () => {
    getDraftTradeByIdMock.mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/draft-trades/missing');
    const res = await GET(req, { params: Promise.resolve({ tradeId: 'missing' }) });
    expect(res.status).toBe(404);
  });

  it('returns trade detail for valid id', async () => {
    getDraftTradeByIdMock.mockResolvedValue({
      trade: {
        tradeId: 't1',
        year: 1988,
        seqInYear: 1,
        title: 'Trade 1',
        clubSlugs: [],
        clubNames: [],
        partyCount: 2,
        assetCount: 3,
      },
      parties: [],
      assets: [],
    });

    const req = new NextRequest('http://localhost/api/draft-trades/t1');
    const res = await GET(req, { params: Promise.resolve({ tradeId: 't1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.trade.tradeId).toBe('t1');
  });
});
