import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthenticatedUserIdMock = vi.fn();
const draftFindUniqueMock = vi.fn();
const getWatchlistMock = vi.fn();
const addToWatchlistMock = vi.fn();
const removeFromWatchlistMock = vi.fn();

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: getAuthenticatedUserIdMock,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draft: {
      findUnique: draftFindUniqueMock,
    },
  },
}));

vi.mock('@/lib/draftLobby', () => ({
  getWatchlist: getWatchlistMock,
  addToWatchlist: addToWatchlistMock,
  removeFromWatchlist: removeFromWatchlistMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

const routeContext = { params: Promise.resolve({ id: 'draft-1' }) };

function watchlistGetRequest(memberId = 'member-1') {
  return new NextRequest(`http://localhost/api/drafts/draft-1/watchlist?memberId=${memberId}`);
}

function watchlistPostRequest(memberId = 'member-1') {
  return new NextRequest('http://localhost/api/drafts/draft-1/watchlist', {
    method: 'POST',
    body: JSON.stringify({
      memberId,
      playerId: 'player-1',
      priority: 2,
      notes: 'target',
    }),
  });
}

function watchlistDeleteRequest(memberId = 'member-1') {
  return new NextRequest(
    `http://localhost/api/drafts/draft-1/watchlist?memberId=${memberId}&playerId=player-1`,
    { method: 'DELETE' }
  );
}

function draftWithMember(memberId = 'member-1', userId = 'user-1') {
  return {
    id: 'draft-1',
    league: {
      members: [{ id: memberId, userId }],
    },
  };
}

describe('GET /api/drafts/[id]/watchlist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    draftFindUniqueMock.mockResolvedValue(draftWithMember());
    getWatchlistMock.mockResolvedValue([
      {
        id: 'watchlist-1',
        playerId: 'player-1',
        priority: 2,
      },
    ]);
  });

  it('rejects unauthenticated watchlist reads before watchlist lookup', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue(null);
    const { GET } = await import('./route');

    const response = await GET(watchlistGetRequest(), routeContext);

    expect(response.status).toBe(401);
    expect(draftFindUniqueMock).not.toHaveBeenCalled();
    expect(getWatchlistMock).not.toHaveBeenCalled();
  });

  it('rejects watchlist reads for a member not bound to the authenticated user', async () => {
    draftFindUniqueMock.mockResolvedValue(draftWithMember('member-2', 'other-user'));
    const { GET } = await import('./route');

    const response = await GET(watchlistGetRequest('member-2'), routeContext);

    expect(response.status).toBe(403);
    expect(getWatchlistMock).not.toHaveBeenCalled();
  });

  it('returns the bound member watchlist with the existing response shape', async () => {
    const { GET } = await import('./route');

    const response = await GET(watchlistGetRequest(), routeContext);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data).toEqual({
      watchlist: [
        {
          id: 'watchlist-1',
          playerId: 'player-1',
          priority: 2,
        },
      ],
    });
  });
});

describe('POST /api/drafts/[id]/watchlist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    draftFindUniqueMock.mockResolvedValue(draftWithMember());
    addToWatchlistMock.mockResolvedValue({
      id: 'watchlist-1',
      playerId: 'player-1',
      priority: 2,
      notes: 'target',
    });
  });

  it('rejects unauthenticated watchlist additions before watchlist mutation', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue(null);
    const { POST } = await import('./route');

    const response = await POST(watchlistPostRequest(), routeContext);

    expect(response.status).toBe(401);
    expect(draftFindUniqueMock).not.toHaveBeenCalled();
    expect(addToWatchlistMock).not.toHaveBeenCalled();
  });

  it('rejects watchlist additions for a member not bound to the authenticated user', async () => {
    draftFindUniqueMock.mockResolvedValue(draftWithMember('member-2', 'other-user'));
    const { POST } = await import('./route');

    const response = await POST(watchlistPostRequest('member-2'), routeContext);

    expect(response.status).toBe(403);
    expect(addToWatchlistMock).not.toHaveBeenCalled();
  });

  it('adds to the bound member watchlist with the existing response shape', async () => {
    const { POST } = await import('./route');

    const response = await POST(watchlistPostRequest(), routeContext);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(addToWatchlistMock).toHaveBeenCalledWith('draft-1', 'member-1', 'player-1', 2, 'target');
    expect(payload.data).toEqual({
      watchlistItem: {
        id: 'watchlist-1',
        playerId: 'player-1',
        priority: 2,
        notes: 'target',
      },
    });
  });
});

describe('DELETE /api/drafts/[id]/watchlist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    draftFindUniqueMock.mockResolvedValue(draftWithMember());
    removeFromWatchlistMock.mockResolvedValue(undefined);
  });

  it('rejects unauthenticated watchlist removals before watchlist mutation', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue(null);
    const { DELETE } = await import('./route');

    const response = await DELETE(watchlistDeleteRequest(), routeContext);

    expect(response.status).toBe(401);
    expect(draftFindUniqueMock).not.toHaveBeenCalled();
    expect(removeFromWatchlistMock).not.toHaveBeenCalled();
  });

  it('rejects watchlist removals for a member not bound to the authenticated user', async () => {
    draftFindUniqueMock.mockResolvedValue(draftWithMember('member-2', 'other-user'));
    const { DELETE } = await import('./route');

    const response = await DELETE(watchlistDeleteRequest('member-2'), routeContext);

    expect(response.status).toBe(403);
    expect(removeFromWatchlistMock).not.toHaveBeenCalled();
  });

  it('removes from the bound member watchlist with the existing response shape', async () => {
    const { DELETE } = await import('./route');

    const response = await DELETE(watchlistDeleteRequest(), routeContext);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(removeFromWatchlistMock).toHaveBeenCalledWith('draft-1', 'member-1', 'player-1');
    expect(payload.data).toEqual({ message: 'Player removed from watchlist' });
  });
});
