import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthenticatedUserIdMock = vi.fn();
const updateDraftSettingsMock = vi.fn();
const getDraftSettingsMock = vi.fn();

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: getAuthenticatedUserIdMock,
}));

vi.mock('@/server/league/services/LeagueApplicationService', () => ({
  leagueApplicationService: {
    getDraftSettings: getDraftSettingsMock,
    updateDraftSettings: updateDraftSettingsMock,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

function putRequest(body: unknown) {
  return new NextRequest('http://localhost/api/leagues/league-1/draft-settings', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

describe('PUT /api/leagues/[id]/draft-settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedUserIdMock.mockResolvedValue('owner-1');
    updateDraftSettingsMock.mockResolvedValue({
      draftDate: '2026-06-01T10:00:00.000Z',
      draftType: 'snake',
      timePerPick: 120,
      allowAutoPick: true,
      enableReminders: true,
      rosterSize: 18,
      benchSize: 4,
    });
  });

  it('rejects unauthenticated updates before touching draft settings', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue(null);
    const { PUT } = await import('./route');

    const response = await PUT(putRequest({ timePerPick: 120 }), {
      params: Promise.resolve({ id: 'league-1' }),
    });

    expect(response.status).toBe(401);
    expect(updateDraftSettingsMock).not.toHaveBeenCalled();
  });

  it('does not allow test league updates to bypass authentication', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue(null);
    const { PUT } = await import('./route');

    const response = await PUT(putRequest({ timePerPick: 120 }), {
      params: Promise.resolve({ id: 'test-league-id' }),
    });

    expect(response.status).toBe(401);
    expect(updateDraftSettingsMock).not.toHaveBeenCalled();
  });

  it('maps service permission denial to forbidden', async () => {
    updateDraftSettingsMock.mockRejectedValue(
      new Error('forbidden:Only the owner or a commissioner can update draft settings')
    );
    const { PUT } = await import('./route');

    const response = await PUT(putRequest({ timePerPick: 120 }), {
      params: Promise.resolve({ id: 'league-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Only the owner or a commissioner can update draft settings');
  });

  it('passes the authenticated actor to the draft settings update', async () => {
    const { PUT } = await import('./route');

    const response = await PUT(putRequest({ timePerPick: 120, allowAutoPick: false }), {
      params: Promise.resolve({ id: 'league-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(updateDraftSettingsMock).toHaveBeenCalledWith('league-1', {
      actorUserId: 'owner-1',
      draftDate: undefined,
      draftType: undefined,
      timePerPick: 120,
      allowAutoPick: false,
      enableReminders: undefined,
      rosterSize: undefined,
      benchSize: undefined,
    });
    expect(body.success).toBe(true);
  });
});
