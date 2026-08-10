import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDraftTradeByIdMock } = vi.hoisted(() => ({
  getDraftTradeByIdMock: vi.fn(),
}));

vi.mock('@/lib/draftTrades/read', () => ({
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

  it('returns 400 without service access for invalid trade id', async () => {
    const req = new NextRequest('http://localhost/api/draft-trades/../bad');
    const res = await GET(req, { params: Promise.resolve({ tradeId: '../bad' }) });

    expect(res.status).toBe(400);
    expect(getDraftTradeByIdMock).not.toHaveBeenCalled();
  });

  it('returns trade detail for valid id', async () => {
    const tradeId = `external-transaction:${'a'.repeat(64)}`;
    getDraftTradeByIdMock.mockResolvedValue({
      trade: {
        tradeId,
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

    const req = new NextRequest(`http://localhost/api/draft-trades/${encodeURIComponent(tradeId)}`);
    const res = await GET(req, {
      params: Promise.resolve({ tradeId: encodeURIComponent(tradeId) }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(getDraftTradeByIdMock).toHaveBeenCalledWith(tradeId);
    expect(body.data.trade.tradeId).toBe(tradeId);
  });
});
