import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthenticatedUserIdMock = vi.fn();
const startDraftMock = vi.fn();
const publishCommandResultMock = vi.fn();

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: getAuthenticatedUserIdMock,
}));

vi.mock('@/server/draft/services/DraftApplicationService', () => ({
  draftApplicationService: {
    startDraft: startDraftMock,
  },
}));

vi.mock('@/server/draft/services/DraftRealtimePublisher', () => ({
  draftRealtimePublisher: {
    publishCommandResult: publishCommandResultMock,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

function startRequest() {
  return new NextRequest('http://localhost/api/drafts/draft-1/start', {
    method: 'POST',
  });
}

function routeContext() {
  return {
    params: Promise.resolve({ id: 'draft-1' }),
  };
}

describe('POST /api/drafts/[id]/start', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedUserIdMock.mockResolvedValue('owner-1');
    startDraftMock.mockResolvedValue({
      draftId: 'draft-1',
      leagueId: 'league-1',
      currentPick: 1,
      isComplete: false,
      data: {
        status: 'LIVE',
        startedAt: '2026-05-18T00:00:00.000Z',
      },
    });
    publishCommandResultMock.mockResolvedValue({
      draftId: 'draft-1',
      status: 'LIVE',
      currentPick: {
        userId: 'user-1',
        pickNumber: 1,
        expiresAt: '2026-05-18T00:02:00.000Z',
        startedAt: '2026-05-18T00:00:00.000Z',
      },
    });
  });

  it('rejects unauthenticated draft starts before service mutation or publish', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue(null);
    const { POST } = await import('./route');

    const response = await POST(startRequest(), routeContext());

    expect(response.status).toBe(401);
    expect(startDraftMock).not.toHaveBeenCalled();
    expect(publishCommandResultMock).not.toHaveBeenCalled();
  });

  it('passes the authenticated actor to the service and preserves the success shape', async () => {
    const { POST } = await import('./route');

    const response = await POST(startRequest(), routeContext());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(startDraftMock).toHaveBeenCalledWith({
      draftId: 'draft-1',
      actorUserId: 'owner-1',
    });
    expect(body).toEqual({
      success: true,
      message: 'Draft started successfully',
      draft: {
        draftId: 'draft-1',
        status: 'LIVE',
        currentPick: {
          userId: 'user-1',
          pickNumber: 1,
          expiresAt: '2026-05-18T00:02:00.000Z',
        },
        startedAt: '2026-05-18T00:00:00.000Z',
      },
    });
  });

  it('maps service authorization failures to forbidden without publishing', async () => {
    startDraftMock.mockRejectedValue(
      new Error('forbidden:Only the owner or a commissioner can start drafts')
    );
    const { POST } = await import('./route');

    const response = await POST(startRequest(), routeContext());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Only the owner or a commissioner can start drafts');
    expect(publishCommandResultMock).not.toHaveBeenCalled();
  });
});
