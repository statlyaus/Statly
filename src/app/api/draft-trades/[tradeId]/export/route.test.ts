import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDraftTradeByIdMock } = vi.hoisted(() => ({
  getDraftTradeByIdMock: vi.fn(),
}));

vi.mock('@/lib/draftTrades/firestore', () => ({
  getDraftTradeById: getDraftTradeByIdMock,
}));

import { GET } from './route';

describe('GET /api/draft-trades/[tradeId]/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 without service access for invalid trade id', async () => {
    const req = new NextRequest('http://localhost/api/draft-trades/../bad/export');
    const res = await GET(req, { params: Promise.resolve({ tradeId: '../bad' }) });

    expect(res.status).toBe(400);
    expect(getDraftTradeByIdMock).not.toHaveBeenCalled();
  });

  it('exports trade detail as csv for valid id', async () => {
    getDraftTradeByIdMock.mockResolvedValue({
      trade: {
        tradeId: 't1',
        year: 1988,
        seqInYear: 1,
        title: 'Trade 1',
      },
      parties: [
        {
          clubName: 'Carlton',
          rowOrder: 1,
          assetsRaw: 'Pick 1',
          expected: null,
          actual: null,
        },
      ],
      assets: [
        {
          clubName: 'Carlton',
          assetIndex: 1,
          assetType: 'pick',
          assetText: 'Pick 1',
          playerName: null,
          draftedPlayer: 'Player 1',
          games: 12,
        },
      ],
    });

    const req = new NextRequest('http://localhost/api/draft-trades/t1/export');
    const res = await GET(req, { params: Promise.resolve({ tradeId: 't1' }) });
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(body).toContain('tradeId,t1');
    expect(body).toContain('asset,Carlton,1,pick,Pick 1,Player 1,12');
  });

  it('quotes CSV fields that contain carriage returns', async () => {
    getDraftTradeByIdMock.mockResolvedValue({
      trade: {
        tradeId: 't1',
        year: 1988,
        seqInYear: 1,
        title: 'Trade\rOne',
      },
      parties: [],
      assets: [],
    });

    const req = new NextRequest('http://localhost/api/draft-trades/t1/export');
    const res = await GET(req, { params: Promise.resolve({ tradeId: 't1' }) });
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain('title,"Trade\rOne"');
  });
});
