import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listDraftTradesByYearMock } = vi.hoisted(() => ({
  listDraftTradesByYearMock: vi.fn(),
}));

vi.mock('@/lib/draftTrades/read', () => ({
  listDraftTradesByYear: listDraftTradesByYearMock,
}));

import { GET } from './route';

describe('GET /api/draft-trades/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 without service access for invalid year', async () => {
    const req = new NextRequest('http://localhost/api/draft-trades/export?year=abc');
    const res = await GET(req);

    expect(res.status).toBe(400);
    expect(listDraftTradesByYearMock).not.toHaveBeenCalled();
  });

  it('quotes CSV fields that contain carriage returns', async () => {
    listDraftTradesByYearMock.mockResolvedValue([
      {
        tradeId: 'trade-1',
        year: 2025,
        seqInYear: 1,
        title: 'Trade\rfor Player',
        clubNames: ['Carlton'],
        partyCount: 2,
        assetCount: 3,
        hasPlayers: true,
        hasPicks: true,
        hasFuturePicks: false,
      },
    ]);

    const req = new NextRequest('http://localhost/api/draft-trades/export?year=2025');
    const res = await GET(req);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain('trade-1,2025,1,"Trade\rfor Player",Carlton');
  });

  it('neutralizes spreadsheet formulas in string CSV fields', async () => {
    listDraftTradesByYearMock.mockResolvedValue([
      {
        tradeId: 'trade-1',
        year: 2025,
        seqInYear: 1,
        title: '=HYPERLINK("https://example.test")',
        clubNames: ['Carlton'],
        partyCount: 2,
        assetCount: 3,
        hasPlayers: true,
        hasPicks: true,
        hasFuturePicks: false,
      },
    ]);

    const req = new NextRequest('http://localhost/api/draft-trades/export?year=2025');
    const res = await GET(req);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain('trade-1,2025,1,"\'=HYPERLINK(""https://example.test"")",Carlton');
  });
});
