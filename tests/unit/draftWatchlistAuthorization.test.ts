import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { DraftPrivateStateAccessError, draftPrivateStateService, getAuthenticatedUserId } =
  vi.hoisted(() => {
    class MockDraftPrivateStateAccessError extends Error {}

    return {
      DraftPrivateStateAccessError: MockDraftPrivateStateAccessError,
      draftPrivateStateService: {
        getWatchlist: vi.fn(),
        addToWatchlist: vi.fn(),
        removeFromWatchlist: vi.fn(),
      },
      getAuthenticatedUserId: vi.fn(),
    };
  });

vi.mock('@/lib/serverAuth', () => ({ getAuthenticatedUserId }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock('@/server/draft/services/DraftPrivateStateService', () => ({
  DraftPrivateStateAccessError,
  draftPrivateStateService,
}));

import { DELETE, GET, POST } from '@/app/api/drafts/[id]/watchlist/route';

const draftId = 'draft-1';
const actorUserId = 'user-1';
const context = { params: Promise.resolve({ id: draftId }) };

function request(path: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, init);
}

describe('draft watchlist authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects every method before private state access when authentication is missing', async () => {
    getAuthenticatedUserId.mockResolvedValue(null);

    const responses = await Promise.all([
      GET(request(`/api/drafts/${draftId}/watchlist`), context),
      POST(
        request(`/api/drafts/${draftId}/watchlist`, {
          method: 'POST',
          body: JSON.stringify({ playerId: 'player-1' }),
        }),
        context
      ),
      DELETE(
        request(`/api/drafts/${draftId}/watchlist?playerId=player-1`, { method: 'DELETE' }),
        context
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401]);
    expect(draftPrivateStateService.getWatchlist).not.toHaveBeenCalled();
    expect(draftPrivateStateService.addToWatchlist).not.toHaveBeenCalled();
    expect(draftPrivateStateService.removeFromWatchlist).not.toHaveBeenCalled();
  });

  it('maps inactive or cross-league membership failures to forbidden for every method', async () => {
    getAuthenticatedUserId.mockResolvedValue(actorUserId);
    const forbidden = () => new DraftPrivateStateAccessError('Not a member of this draft');
    draftPrivateStateService.getWatchlist.mockRejectedValueOnce(forbidden());
    draftPrivateStateService.addToWatchlist.mockRejectedValueOnce(forbidden());
    draftPrivateStateService.removeFromWatchlist.mockRejectedValueOnce(forbidden());

    const responses = await Promise.all([
      GET(request(`/api/drafts/${draftId}/watchlist`), context),
      POST(
        request(`/api/drafts/${draftId}/watchlist`, {
          method: 'POST',
          body: JSON.stringify({ playerId: 'player-1' }),
        }),
        context
      ),
      DELETE(
        request(`/api/drafts/${draftId}/watchlist?playerId=player-1`, { method: 'DELETE' }),
        context
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403]);
  });

  it('ignores spoofed legacy member IDs and preserves response contracts', async () => {
    getAuthenticatedUserId.mockResolvedValue(actorUserId);
    draftPrivateStateService.getWatchlist.mockResolvedValue([]);
    draftPrivateStateService.addToWatchlist.mockResolvedValue({
      id: 'watch-1',
      playerId: 'player-1',
      priority: 1,
      player: { id: 'player-1', name: 'Player One', position: 'MID', club: 'CAR' },
    });
    draftPrivateStateService.removeFromWatchlist.mockResolvedValue(undefined);

    const getResponse = await GET(
      request(`/api/drafts/${draftId}/watchlist?memberId=spoofed-member`),
      context
    );
    const postResponse = await POST(
      request(`/api/drafts/${draftId}/watchlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberId: 'spoofed-member',
          playerId: 'player-1',
          priority: 1,
        }),
      }),
      context
    );
    const deleteResponse = await DELETE(
      request(`/api/drafts/${draftId}/watchlist?memberId=spoofed-member&playerId=player-1`, {
        method: 'DELETE',
      }),
      context
    );

    expect(draftPrivateStateService.getWatchlist).toHaveBeenCalledWith({
      draftId,
      actorUserId,
    });
    expect(draftPrivateStateService.addToWatchlist).toHaveBeenCalledWith({
      draftId,
      actorUserId,
      playerId: 'player-1',
      priority: 1,
    });
    expect(draftPrivateStateService.removeFromWatchlist).toHaveBeenCalledWith({
      draftId,
      actorUserId,
      playerId: 'player-1',
    });
    expect(draftPrivateStateService.addToWatchlist.mock.calls[0]?.[0]).not.toHaveProperty(
      'memberId'
    );
    expect(getResponse.status).toBe(200);
    expect(getResponse.headers.get('cache-control')).toBe('private, no-store');
    expect(await getResponse.json()).toMatchObject({ success: true, data: { watchlist: [] } });
    expect(postResponse.status).toBe(201);
    expect(deleteResponse.status).toBe(200);
  });

  it('validates mutation input after authentication and before service access', async () => {
    getAuthenticatedUserId.mockResolvedValue(actorUserId);

    const postResponse = await POST(
      request(`/api/drafts/${draftId}/watchlist`, {
        method: 'POST',
        body: JSON.stringify({ memberId: 'spoofed-member', playerId: '' }),
      }),
      context
    );
    const deleteResponse = await DELETE(
      request(`/api/drafts/${draftId}/watchlist?memberId=spoofed-member`, { method: 'DELETE' }),
      context
    );

    expect(postResponse.status).toBe(422);
    expect(deleteResponse.status).toBe(422);
    expect(draftPrivateStateService.addToWatchlist).not.toHaveBeenCalled();
    expect(draftPrivateStateService.removeFromWatchlist).not.toHaveBeenCalled();
  });
});
