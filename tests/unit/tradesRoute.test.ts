import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TradeServiceError } from '@/server/leagues/trades/tradeContracts';

const mocks = vi.hoisted(() => ({
  authorizeLeagueTradeAccess: vi.fn(),
  revalidateTag: vi.fn(),
  verifyIdToken: vi.fn(),
}));

vi.mock('@/lib/firebaseAdmin', () => ({
  adminAuth: { verifyIdToken: mocks.verifyIdToken },
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

vi.mock('@/server/leagues/trades/tradeService', () => ({
  authorizeLeagueTradeAccess: mocks.authorizeLeagueTradeAccess,
}));

vi.mock('next/cache', () => ({
  revalidateTag: mocks.revalidateTag,
}));

import { POST } from '@/app/api/trades/route';

function createRequest(leagueId = 'requested-league') {
  return new Request('http://localhost/api/trades', {
    method: 'POST',
    headers: {
      authorization: 'Bearer valid-token',
      'content-type': 'application/json',
      'x-league-id': leagueId,
    },
    body: JSON.stringify({ incoming: [], outgoing: [] }),
  });
}

describe('POST /api/trades', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyIdToken.mockResolvedValue({ uid: 'user-1' });
    mocks.authorizeLeagueTradeAccess.mockResolvedValue('authorized-league');
    mocks.revalidateTag.mockResolvedValue(undefined);
  });

  it('uses only the league identifier authorized by the trade service', async () => {
    const response = await POST(createRequest());

    expect(response.status).toBe(200);
    expect(mocks.authorizeLeagueTradeAccess).toHaveBeenCalledWith('requested-league', 'user-1');
    expect(mocks.revalidateTag).toHaveBeenCalledWith('trades-authorized-league', { expire: 0 });
    expect(mocks.revalidateTag).toHaveBeenCalledWith('league-authorized-league', { expire: 0 });
    expect(mocks.revalidateTag).not.toHaveBeenCalledWith('trades-requested-league', {
      expire: 0,
    });
  });

  it('does not invalidate cache tags when league authorization fails', async () => {
    mocks.authorizeLeagueTradeAccess.mockRejectedValue(
      new TradeServiceError('FORBIDDEN', 'League membership is required.', 403)
    );

    const response = await POST(createRequest('another-league'));

    expect(response.status).toBe(403);
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });
});
