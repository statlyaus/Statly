import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listDraftTradesByYearMock } = vi.hoisted(() => ({
  listDraftTradesByYearMock: vi.fn(),
}));

vi.mock('@/lib/draftTrades/firestore', () => ({
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
});
