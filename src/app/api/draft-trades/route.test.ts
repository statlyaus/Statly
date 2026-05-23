import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listDraftTradesByYearMock, listDraftTradeYearsMock } = vi.hoisted(() => ({
  listDraftTradesByYearMock: vi.fn(),
  listDraftTradeYearsMock: vi.fn(),
}));

vi.mock('@/lib/draftTrades/firestore', () => ({
  listDraftTradesByYear: listDraftTradesByYearMock,
  listDraftTradeYears: listDraftTradeYearsMock,
}));

import { GET } from './route';

describe('GET /api/draft-trades', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 for invalid year', async () => {
    const req = new NextRequest('http://localhost/api/draft-trades?year=abc');
    const res = await GET(req);

    expect(res.status).toBe(400);
    expect(listDraftTradesByYearMock).not.toHaveBeenCalled();
    expect(listDraftTradeYearsMock).not.toHaveBeenCalled();
  });

  it('returns trades for valid year query', async () => {
    listDraftTradeYearsMock.mockResolvedValue([2025, 2024, 2023]);
    listDraftTradesByYearMock.mockResolvedValue([
      {
        tradeId: 't1',
        year: 1988,
        seqInYear: 1,
        title: 'Trade 1',
        clubSlugs: [],
        clubNames: [],
        partyCount: 2,
        assetCount: 3,
        hasPlayers: true,
        hasPicks: true,
        hasFuturePicks: false,
      },
    ]);

    const req = new NextRequest('http://localhost/api/draft-trades?year=1988');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.year).toBe(1988);
    expect(body.meta.total).toBe(1);
  });
});
