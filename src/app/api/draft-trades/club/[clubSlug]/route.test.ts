import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listDraftTradeRefsByClubMock } = vi.hoisted(() => ({
  listDraftTradeRefsByClubMock: vi.fn(),
}));

vi.mock('@/lib/draftTrades/firestore', () => ({
  listDraftTradeRefsByClub: listDraftTradeRefsByClubMock,
}));

import { GET } from './route';

describe('GET /api/draft-trades/club/[clubSlug]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes club slug and returns records', async () => {
    listDraftTradeRefsByClubMock.mockResolvedValue([
      {
        tradeId: 't1',
        clubSlug: 'carlton',
        clubName: 'Carlton',
        year: 2025,
        seqInYear: 1,
        title: 'Trade',
        assetsRaw: '',
        expected: null,
        actual: null,
      },
    ]);

    const req = new NextRequest('http://localhost/api/draft-trades/club/Carlton');
    const res = await GET(req, { params: Promise.resolve({ clubSlug: 'Carlton' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.clubSlug).toBe('carlton');
    expect(body.meta.total).toBe(1);
  });

  it('returns 400 without service access for invalid club slug', async () => {
    const req = new NextRequest('http://localhost/api/draft-trades/club/bad_slug');
    const res = await GET(req, { params: Promise.resolve({ clubSlug: 'bad_slug' }) });

    expect(res.status).toBe(400);
    expect(listDraftTradeRefsByClubMock).not.toHaveBeenCalled();
  });
});
