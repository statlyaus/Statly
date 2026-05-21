import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUserIdFromRequestMock = vi.fn();
const resumeDraftMock = vi.fn();
const publishCommandResultMock = vi.fn();

vi.mock('@/lib/serverAuth', () => ({
  getUserIdFromRequest: getUserIdFromRequestMock,
}));

vi.mock('@/server/draft/services/DraftApplicationService', () => ({
  draftApplicationService: {
    resumeDraft: resumeDraftMock,
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

function resumeRequest() {
  return new NextRequest('http://localhost/api/drafts/draft-1/resume', {
    method: 'POST',
  });
}

function routeContext() {
  return {
    params: Promise.resolve({ id: 'draft-1' }),
  };
}

describe('POST /api/drafts/[id]/resume', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserIdFromRequestMock.mockResolvedValue('owner-1');
    resumeDraftMock.mockResolvedValue({
      draftId: 'draft-1',
      leagueId: 'league-1',
      currentPick: 3,
      isComplete: false,
      data: {
        status: 'LIVE',
        resumedAt: '2026-05-18T00:00:00.000Z',
      },
    });
    publishCommandResultMock.mockResolvedValue(undefined);
  });

  it('preserves the successful resume response shape', async () => {
    const { POST } = await import('./route');

    const response = await POST(resumeRequest(), routeContext());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(resumeDraftMock).toHaveBeenCalledWith({
      draftId: 'draft-1',
      actorUserId: 'owner-1',
    });
    expect(body).toMatchObject({
      success: true,
      data: {
        message: 'Draft resumed successfully',
        draft: {
          id: 'draft-1',
          status: 'LIVE',
          resumedAt: '2026-05-18T00:00:00.000Z',
          currentPick: 3,
        },
      },
    });
  });

  it.each([
    ['forbidden:Only league owners can resume drafts', 403, 'Only league owners can resume drafts'],
    ['not_found:Draft not found', 404, 'Draft not found'],
    ['bad_request:Only paused drafts can be resumed', 400, 'Only paused drafts can be resumed'],
    ['conflict:Draft state changed', 409, 'Draft state changed'],
  ])('maps %s service errors to %i', async (message, expectedStatus, expectedMessage) => {
    resumeDraftMock.mockRejectedValue(new Error(message));
    const { POST } = await import('./route');

    const response = await POST(resumeRequest(), routeContext());
    const body = await response.json();

    expect(response.status).toBe(expectedStatus);
    expect(body.error.message).toBe(expectedMessage);
    expect(publishCommandResultMock).not.toHaveBeenCalled();
  });
});
