import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { searchDraftTradesMock } = vi.hoisted(() => ({
  searchDraftTradesMock: vi.fn(),
}));

vi.mock('@/lib/draftTrades/search', () => ({
  searchDraftTrades: searchDraftTradesMock,
}));

import { GET } from './route';

describe('GET /api/draft-trades/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 without service access for too-short query', async () => {
    const req = new NextRequest('http://localhost/api/draft-trades/search?q=a');
    const res = await GET(req);

    expect(res.status).toBe(400);
    expect(searchDraftTradesMock).not.toHaveBeenCalled();
  });
});
