import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthenticatedUserIdMock = vi.fn();
const draftFindUniqueMock = vi.fn();
const getPreDraftQueueMock = vi.fn();
const updatePreDraftQueueMock = vi.fn();

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
  getPreDraftQueue: getPreDraftQueueMock,
  updatePreDraftQueue: updatePreDraftQueueMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

const routeContext = { params: Promise.resolve({ id: 'draft-1' }) };

function preQueueGetRequest(memberId = 'member-1') {
  return new NextRequest(`http://localhost/api/drafts/draft-1/pre-queue?memberId=${memberId}`);
}

function preQueuePutRequest(memberId = 'member-1') {
  return new NextRequest('http://localhost/api/drafts/draft-1/pre-queue', {
    method: 'PUT',
    body: JSON.stringify({
      memberId,
      queue: [{ playerId: 'player-1', rank: 1 }],
    }),
  });
}

function draftWithMember(memberId = 'member-1', userId = 'user-1') {
  return {
    id: 'draft-1',
    league: {
      members: [{ id: memberId, userId }],
    },
  };
}

describe('GET /api/drafts/[id]/pre-queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    draftFindUniqueMock.mockResolvedValue(draftWithMember());
    getPreDraftQueueMock.mockResolvedValue([
      {
        id: 'queue-1',
        playerId: 'player-1',
        rank: 1,
      },
    ]);
  });

  it('rejects unauthenticated pre-queue reads before queue lookup', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue(null);
    const { GET } = await import('./route');

    const response = await GET(preQueueGetRequest(), routeContext);

    expect(response.status).toBe(401);
    expect(draftFindUniqueMock).not.toHaveBeenCalled();
    expect(getPreDraftQueueMock).not.toHaveBeenCalled();
  });

  it('rejects pre-queue reads for a member not bound to the authenticated user', async () => {
    draftFindUniqueMock.mockResolvedValue(draftWithMember('member-2', 'other-user'));
    const { GET } = await import('./route');

    const response = await GET(preQueueGetRequest('member-2'), routeContext);

    expect(response.status).toBe(403);
    expect(getPreDraftQueueMock).not.toHaveBeenCalled();
  });

  it('returns the bound member pre-queue with the existing response shape', async () => {
    const { GET } = await import('./route');

    const response = await GET(preQueueGetRequest(), routeContext);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data).toEqual({
      queue: [
        {
          id: 'queue-1',
          playerId: 'player-1',
          rank: 1,
        },
      ],
    });
  });
});

describe('PUT /api/drafts/[id]/pre-queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    draftFindUniqueMock.mockResolvedValue(draftWithMember());
    updatePreDraftQueueMock.mockResolvedValue([
      {
        id: 'queue-1',
        playerId: 'player-1',
        rank: 1,
      },
    ]);
  });

  it('rejects unauthenticated pre-queue updates before queue mutation', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue(null);
    const { PUT } = await import('./route');

    const response = await PUT(preQueuePutRequest(), routeContext);

    expect(response.status).toBe(401);
    expect(draftFindUniqueMock).not.toHaveBeenCalled();
    expect(updatePreDraftQueueMock).not.toHaveBeenCalled();
  });

  it('rejects pre-queue updates for a member not bound to the authenticated user', async () => {
    draftFindUniqueMock.mockResolvedValue(draftWithMember('member-2', 'other-user'));
    const { PUT } = await import('./route');

    const response = await PUT(preQueuePutRequest('member-2'), routeContext);

    expect(response.status).toBe(403);
    expect(updatePreDraftQueueMock).not.toHaveBeenCalled();
  });

  it('updates the bound member pre-queue with the existing response shape', async () => {
    const { PUT } = await import('./route');

    const response = await PUT(preQueuePutRequest(), routeContext);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(updatePreDraftQueueMock).toHaveBeenCalledWith('draft-1', 'member-1', [
      { playerId: 'player-1', rank: 1 },
    ]);
    expect(payload.data).toEqual({
      queue: [
        {
          id: 'queue-1',
          playerId: 'player-1',
          rank: 1,
        },
      ],
    });
  });
});
