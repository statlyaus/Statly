import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  makePick: vi.fn(),
  getAuthenticatedUserId: vi.fn(),
  isServerDevelopmentAuthEnabled: vi.fn(),
}));

vi.mock('@/server/draft/services/DraftApplicationService', () => ({
  draftApplicationService: { makePick: mocks.makePick },
}));
vi.mock('@/server/draft/services/DraftRealtimePublisher', () => ({
  draftRealtimePublisher: { publishCommandResult: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('@/server/players/playerIdentityService', () => ({
  resolveCanonicalPlayerId: vi.fn(async (id: string) => id),
}));
vi.mock('@/lib/serverAuth', () => ({ getAuthenticatedUserId: mocks.getAuthenticatedUserId }));
vi.mock('@/lib/devAuth', () => ({
  isServerDevelopmentAuthEnabled: mocks.isServerDevelopmentAuthEnabled,
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { handlePickCommand } from '@/server/draft/api/handlePickCommand';

function pickRequest(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/drafts/draft-1/pick', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ playerId: 'player-1' }),
  });
}

function actorOfLastPick(): string | undefined {
  return mocks.makePick.mock.calls.at(-1)?.[0]?.actorUserId;
}

describe('handlePickCommand development identity', () => {
  beforeEach(() => {
    mocks.makePick.mockReset();
    mocks.makePick.mockResolvedValue({
      data: { eventPick: { id: 'pick-1' }, idempotent: false },
      currentPick: 2,
      isComplete: false,
    });
    mocks.getAuthenticatedUserId.mockReset();
    mocks.isServerDevelopmentAuthEnabled.mockReset();
    mocks.isServerDevelopmentAuthEnabled.mockReturnValue(true);
  });

  it('picks as the authenticated user even when a development user header is sent', async () => {
    mocks.getAuthenticatedUserId.mockResolvedValue('signed-in-user');

    const response = await handlePickCommand(
      pickRequest({ 'x-dev-user-id': 'someone-else' }),
      Promise.resolve({ id: 'draft-1' })
    );

    expect(response.status).toBe(200);
    expect(actorOfLastPick()).toBe('signed-in-user');
  });

  it('uses the development user header only when nobody authenticated', async () => {
    mocks.getAuthenticatedUserId.mockResolvedValue(null);

    const response = await handlePickCommand(
      pickRequest({ 'x-dev-user-id': 'dev-user' }),
      Promise.resolve({ id: 'draft-1' })
    );

    expect(response.status).toBe(200);
    expect(actorOfLastPick()).toBe('dev-user');
  });

  it('ignores the development user header when development auth is off', async () => {
    mocks.isServerDevelopmentAuthEnabled.mockReturnValue(false);
    mocks.getAuthenticatedUserId.mockResolvedValue(null);

    const response = await handlePickCommand(
      pickRequest({ 'x-dev-user-id': 'dev-user' }),
      Promise.resolve({ id: 'draft-1' })
    );

    expect(response.status).toBe(401);
    expect(mocks.makePick).not.toHaveBeenCalled();
  });
});

describe('handlePickCommand request body', () => {
  it('answers 400, not 500, when the body is not JSON', async () => {
    mocks.makePick.mockReset();
    mocks.getAuthenticatedUserId.mockResolvedValue('signed-in-user');

    const response = await handlePickCommand(
      new NextRequest('http://localhost/api/drafts/draft-1/pick', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      }),
      Promise.resolve({ id: 'draft-1' })
    );

    expect(response.status).toBe(400);
    expect(mocks.makePick).not.toHaveBeenCalled();
  });
});
