import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const autoPickMock = vi.fn();
const publishCommandResultMock = vi.fn();

vi.mock('@/server/draft/services/DraftApplicationService', () => ({
  draftApplicationService: {
    autoPick: autoPickMock,
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

function autoPickRequest(headers?: HeadersInit) {
  return new NextRequest('http://localhost/api/drafts/draft-1/auto-pick', {
    method: 'POST',
    headers,
  });
}

function routeContext() {
  return {
    params: Promise.resolve({ id: 'draft-1' }),
  };
}

describe('POST /api/drafts/[id]/auto-pick', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('STATLY_RUNTIME_ENV', 'preview');
    vi.stubEnv('CRON_SECRET', '');
    autoPickMock.mockResolvedValue({
      draftId: 'draft-1',
      leagueId: 'league-1',
      currentPick: 2,
      isComplete: false,
      data: {
        pick: {
          player: {
            id: 'player-1',
            name: 'Player 1',
          },
        },
        wasQueued: true,
        idempotent: false,
      },
    });
    publishCommandResultMock.mockResolvedValue(undefined);
  });

  it('rejects requests without a configured system token outside explicit local runtime', async () => {
    const { POST } = await import('./route');

    const response = await POST(autoPickRequest(), routeContext());

    expect(response.status).toBe(401);
    expect(autoPickMock).not.toHaveBeenCalled();
    expect(publishCommandResultMock).not.toHaveBeenCalled();
  });

  it('rejects requests without the configured system token', async () => {
    vi.stubEnv('CRON_SECRET', 'draft-worker-secret');
    const { POST } = await import('./route');

    const response = await POST(autoPickRequest(), routeContext());

    expect(response.status).toBe(401);
    expect(autoPickMock).not.toHaveBeenCalled();
    expect(publishCommandResultMock).not.toHaveBeenCalled();
  });

  it('allows authorized system-token auto-picks and preserves the success shape', async () => {
    vi.stubEnv('CRON_SECRET', 'draft-worker-secret');
    const { POST } = await import('./route');

    const response = await POST(
      autoPickRequest({
        authorization: 'Bearer draft-worker-secret',
      }),
      routeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(autoPickMock).toHaveBeenCalledWith({ draftId: 'draft-1' });
    expect(body.success).toBe(true);
    expect(body.data).toEqual({
      pick: {
        player: {
          id: 'player-1',
          name: 'Player 1',
        },
      },
      currentPick: 2,
      isComplete: false,
      nextTurn: undefined,
      wasQueued: true,
      idempotent: false,
    });
  });

  it('maps service authorization failures to forbidden', async () => {
    vi.stubEnv('CRON_SECRET', 'draft-worker-secret');
    autoPickMock.mockRejectedValue(new Error('forbidden:Only system workers can auto-pick'));
    const { POST } = await import('./route');

    const response = await POST(
      autoPickRequest({
        authorization: 'Bearer draft-worker-secret',
      }),
      routeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.message).toBe('Only system workers can auto-pick');
    expect(publishCommandResultMock).not.toHaveBeenCalled();
  });
});
