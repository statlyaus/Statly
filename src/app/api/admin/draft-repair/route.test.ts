import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const inngestSendMock = vi.fn();

vi.mock('@/lib/inngest/client', () => ({
  DRAFT_REPAIR_EVENT: 'statly/draft.repair-requested',
  inngest: {
    send: inngestSendMock,
  },
}));

describe('POST /api/admin/draft-repair', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_API_TOKEN;
    delete process.env.CRON_SECRET;
    inngestSendMock.mockResolvedValue({ ids: ['evt-1'] });
  });

  it('queues a repair event with a valid payload', async () => {
    const { POST } = await import('./route');

    const response = await POST(
      new NextRequest('http://localhost/api/admin/draft-repair', {
        method: 'POST',
        body: JSON.stringify({
          draftId: 'draft-1',
          leagueId: 'league-1',
          season: 2026,
        }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(inngestSendMock).toHaveBeenCalledWith({
      name: 'statly/draft.repair-requested',
      data: expect.objectContaining({
        draftId: 'draft-1',
        leagueId: 'league-1',
        season: 2026,
        requestedAt: expect.any(String),
      }),
    });
    expect(body).toEqual({
      success: true,
      queued: true,
      event: {
        name: 'statly/draft.repair-requested',
        data: expect.objectContaining({
          draftId: 'draft-1',
          leagueId: 'league-1',
          season: 2026,
          requestedAt: expect.any(String),
        }),
      },
    });
  });

  it('rejects unauthorized requests when an admin token is configured', async () => {
    process.env.ADMIN_API_TOKEN = 'top-secret';
    const { POST } = await import('./route');

    const response = await POST(
      new NextRequest('http://localhost/api/admin/draft-repair', {
        method: 'POST',
        body: JSON.stringify({
          draftId: 'draft-1',
          leagueId: 'league-1',
          season: 2026,
        }),
      })
    );

    expect(response.status).toBe(403);
    expect(inngestSendMock).not.toHaveBeenCalled();
  });
});
