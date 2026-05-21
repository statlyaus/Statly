import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthenticatedUserIdMock = vi.fn();
const draftFindUniqueMock = vi.fn();
const playerFindUniqueMock = vi.fn();
const preDraftQueueFindFirstMock = vi.fn();
const preDraftQueueFindManyMock = vi.fn();
const preDraftQueueDeleteMock = vi.fn();
const transactionMock = vi.fn();

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: getAuthenticatedUserIdMock,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draft: {
      findUnique: draftFindUniqueMock,
    },
    player: {
      findUnique: playerFindUniqueMock,
    },
    preDraftQueue: {
      findFirst: preDraftQueueFindFirstMock,
      findMany: preDraftQueueFindManyMock,
      delete: preDraftQueueDeleteMock,
    },
    $transaction: transactionMock,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

const routeContext = { params: Promise.resolve({ id: 'draft-1' }) };

function queueGetRequest(memberId = 'member-1') {
  return new NextRequest(`http://localhost/api/drafts/draft-1/queue?memberId=${memberId}`);
}

function queuePostRequest(memberId = 'member-1') {
  return new NextRequest('http://localhost/api/drafts/draft-1/queue', {
    method: 'POST',
    body: JSON.stringify({
      memberId,
      playerId: 'player-1',
      rank: 1,
    }),
  });
}

function queueDeleteRequest(memberId = 'member-1') {
  return new NextRequest(
    `http://localhost/api/drafts/draft-1/queue?memberId=${memberId}&playerId=player-1`,
    { method: 'DELETE' }
  );
}

function draftWithBoundMember() {
  return {
    id: 'draft-1',
    league: {
      members: [
        {
          id: 'member-1',
          userId: 'user-1',
        },
      ],
    },
    picks: [],
  };
}

function draftWithOtherUsersMember() {
  return {
    id: 'draft-1',
    league: {
      members: [
        {
          id: 'member-2',
          userId: 'other-user',
        },
      ],
    },
    picks: [],
  };
}

describe('GET /api/drafts/[id]/queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    draftFindUniqueMock.mockResolvedValue(draftWithBoundMember());
    preDraftQueueFindManyMock.mockResolvedValue([
      {
        id: 'queue-1',
        memberId: 'member-1',
        playerId: 'player-1',
        rank: 1,
      },
    ]);
  });

  it('rejects unauthenticated queue reads before queue lookup', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue(null);
    const { GET } = await import('./route');

    const response = await GET(queueGetRequest(), routeContext);

    expect(response.status).toBe(401);
    expect(preDraftQueueFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects queue reads for a member not bound to the authenticated user', async () => {
    draftFindUniqueMock.mockResolvedValue(draftWithOtherUsersMember());
    const { GET } = await import('./route');

    const response = await GET(queueGetRequest('member-2'), routeContext);

    expect(response.status).toBe(403);
    expect(preDraftQueueFindManyMock).not.toHaveBeenCalled();
  });

  it('returns the bound member queue with the existing response shape', async () => {
    const { GET } = await import('./route');

    const response = await GET(queueGetRequest(), routeContext);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data).toEqual([
      {
        id: 'queue-1',
        memberId: 'member-1',
        playerId: 'player-1',
        rank: 1,
      },
    ]);
  });
});

describe('POST /api/drafts/[id]/queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    draftFindUniqueMock.mockResolvedValue(draftWithBoundMember());
    playerFindUniqueMock.mockResolvedValue({ id: 'player-1', name: 'Test Player', active: true });
    preDraftQueueFindFirstMock.mockResolvedValue(null);
    transactionMock.mockImplementation(async (callback) =>
      callback({
        preDraftQueue: {
          findMany: vi.fn().mockResolvedValue([]),
          create: vi.fn().mockResolvedValue({
            id: 'queue-1',
            memberId: 'member-1',
            playerId: 'player-1',
            rank: 1,
          }),
        },
      })
    );
  });

  it('rejects unauthenticated queue additions before draft lookup or mutation', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue(null);
    const { POST } = await import('./route');

    const response = await POST(queuePostRequest(), routeContext);

    expect(response.status).toBe(401);
    expect(draftFindUniqueMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('rejects queue additions for a member not bound to the authenticated user before mutation', async () => {
    draftFindUniqueMock.mockResolvedValue(draftWithOtherUsersMember());
    const { POST } = await import('./route');

    const response = await POST(queuePostRequest('member-2'), routeContext);

    expect(response.status).toBe(403);
    expect(playerFindUniqueMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('adds to the bound member queue with the existing response shape', async () => {
    const { POST } = await import('./route');

    const response = await POST(queuePostRequest(), routeContext);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data).toEqual({
      id: 'queue-1',
      memberId: 'member-1',
      playerId: 'player-1',
      rank: 1,
    });
  });
});

describe('DELETE /api/drafts/[id]/queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    draftFindUniqueMock.mockResolvedValue(draftWithBoundMember());
    preDraftQueueFindFirstMock.mockResolvedValue({ id: 'queue-1' });
    preDraftQueueDeleteMock.mockResolvedValue({ id: 'queue-1' });
  });

  it('rejects unauthenticated queue removals before draft lookup or mutation', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue(null);
    const { DELETE } = await import('./route');

    const response = await DELETE(queueDeleteRequest(), routeContext);

    expect(response.status).toBe(401);
    expect(draftFindUniqueMock).not.toHaveBeenCalled();
    expect(preDraftQueueDeleteMock).not.toHaveBeenCalled();
  });

  it('rejects queue removals for a member not bound to the authenticated user before mutation', async () => {
    draftFindUniqueMock.mockResolvedValue(draftWithOtherUsersMember());
    const { DELETE } = await import('./route');

    const response = await DELETE(queueDeleteRequest('member-2'), routeContext);

    expect(response.status).toBe(403);
    expect(preDraftQueueFindFirstMock).not.toHaveBeenCalled();
    expect(preDraftQueueDeleteMock).not.toHaveBeenCalled();
  });

  it('removes from the bound member queue with the existing response shape', async () => {
    const { DELETE } = await import('./route');

    const response = await DELETE(queueDeleteRequest(), routeContext);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data).toEqual({ message: 'Player removed from queue' });
  });
});
