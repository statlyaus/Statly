import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const pauseDraftMock = vi.fn();
const publishCommandResultMock = vi.fn();

vi.mock('@/lib/authBypass', () => ({
  getBypassUserId: () => 'owner-1',
  isAuthBypassEnabled: () => true,
}));

vi.mock('@/lib/firebaseAdmin', () => ({
  adminAuth: {
    verifySessionCookie: vi.fn(),
  },
}));

vi.mock('@/server/draft/services/DraftApplicationService', () => ({
  draftApplicationService: {
    pauseDraft: pauseDraftMock,
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
    warn: vi.fn(),
  },
}));

function pauseRequest() {
  return new NextRequest('http://localhost/api/drafts/draft-1/pause', {
    method: 'POST',
  });
}

function routeContext() {
  return {
    params: Promise.resolve({ id: 'draft-1' }),
  };
}

describe('POST /api/drafts/[id]/pause', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pauseDraftMock.mockResolvedValue({
      draftId: 'draft-1',
      leagueId: 'league-1',
      currentPick: 3,
      isComplete: false,
      data: {
        status: 'PAUSED',
        pausedAt: '2026-05-18T00:00:00.000Z',
      },
    });
    publishCommandResultMock.mockResolvedValue(undefined);
  });

  it('preserves the successful pause response shape', async () => {
    const { POST } = await import('./route');

    const response = await POST(pauseRequest(), routeContext());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(pauseDraftMock).toHaveBeenCalledWith({
      draftId: 'draft-1',
      actorUserId: 'owner-1',
    });
    expect(body).toMatchObject({
      success: true,
      data: {
        message: 'Draft paused successfully',
        draft: {
          id: 'draft-1',
          status: 'PAUSED',
          pausedAt: '2026-05-18T00:00:00.000Z',
        },
      },
    });
  });

  it.each([
    ['forbidden:Only league owners can pause drafts', 403, 'Only league owners can pause drafts'],
    ['not_found:Draft not found', 404, 'Draft not found'],
    ['bad_request:Only live drafts can be paused', 400, 'Only live drafts can be paused'],
    ['conflict:Draft state changed', 409, 'Draft state changed'],
  ])('maps %s service errors to %i', async (message, expectedStatus, expectedMessage) => {
    pauseDraftMock.mockRejectedValue(new Error(message));
    const { POST } = await import('./route');

    const response = await POST(pauseRequest(), routeContext());
    const body = await response.json();

    expect(response.status).toBe(expectedStatus);
    expect(body.error.message).toBe(expectedMessage);
    expect(publishCommandResultMock).not.toHaveBeenCalled();
  });
});
