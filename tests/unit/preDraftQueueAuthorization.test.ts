import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  DraftPrivateStateAccessError,
  DraftPrivateStateConflictError,
  DraftPrivateStateValidationError,
  draftPrivateStateService,
  getAuthenticatedUserId,
} = vi.hoisted(() => {
  class MockDraftPrivateStateAccessError extends Error {}
  class MockDraftPrivateStateConflictError extends Error {}
  class MockDraftPrivateStateValidationError extends Error {}

  return {
    DraftPrivateStateAccessError: MockDraftPrivateStateAccessError,
    DraftPrivateStateConflictError: MockDraftPrivateStateConflictError,
    DraftPrivateStateValidationError: MockDraftPrivateStateValidationError,
    draftPrivateStateService: {
      getPreDraftQueue: vi.fn(),
      addToPreDraftQueue: vi.fn(),
      removeFromPreDraftQueue: vi.fn(),
      replacePreDraftQueue: vi.fn(),
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
  DraftPrivateStateConflictError,
  DraftPrivateStateValidationError,
  draftPrivateStateService,
}));

import { GET as GET_PRE_QUEUE, PUT as PUT_PRE_QUEUE } from '@/app/api/drafts/[id]/pre-queue/route';
import {
  DELETE as DELETE_QUEUE,
  GET as GET_QUEUE,
  POST as POST_QUEUE,
  PUT as PUT_QUEUE,
} from '@/app/api/drafts/[id]/queue/route';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const draftId = 'draft-1';
const actorUserId = 'user-1';
const memberId = 'member-1';
const context = { params: Promise.resolve({ id: draftId }) };
const queueEntry = {
  id: 'queue-1',
  draftId,
  memberId,
  playerId: 'player-1',
  rank: 1,
  notes: undefined,
};

function request(path: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, init);
}

async function responseData(response: Response) {
  return (await response.json()).data;
}

describe('pre-draft queue authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthenticated queue reads and writes before private state access', async () => {
    getAuthenticatedUserId.mockResolvedValue(null);

    const responses = await Promise.all([
      GET_PRE_QUEUE(request(`/api/drafts/${draftId}/pre-queue`), context),
      PUT_PRE_QUEUE(
        request(`/api/drafts/${draftId}/pre-queue`, {
          method: 'PUT',
          body: JSON.stringify({ queue: [] }),
        }),
        context
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([401, 401]);
    expect(draftPrivateStateService.getPreDraftQueue).not.toHaveBeenCalled();
    expect(draftPrivateStateService.replacePreDraftQueue).not.toHaveBeenCalled();
  });

  it('maps private-state access, validation, and conflict errors to stable statuses', async () => {
    getAuthenticatedUserId.mockResolvedValue(actorUserId);
    draftPrivateStateService.getPreDraftQueue.mockRejectedValueOnce(
      new DraftPrivateStateAccessError('Not a member of this draft')
    );
    draftPrivateStateService.replacePreDraftQueue.mockRejectedValueOnce(
      new DraftPrivateStateValidationError('Queue contains an unknown player')
    );
    draftPrivateStateService.addToPreDraftQueue.mockRejectedValueOnce(
      new DraftPrivateStateConflictError('Player is no longer available')
    );

    const forbidden = await GET_PRE_QUEUE(request(`/api/drafts/${draftId}/pre-queue`), context);
    const badRequest = await PUT_PRE_QUEUE(
      request(`/api/drafts/${draftId}/pre-queue`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queue: [{ playerId: 'unknown-player', rank: 1 }] }),
      }),
      context
    );
    const conflict = await POST_QUEUE(
      request(`/api/drafts/${draftId}/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: 'picked-player' }),
      }),
      context
    );

    expect([forbidden.status, badRequest.status, conflict.status]).toEqual([403, 400, 409]);
  });

  it('delegates pre-queue replacement to the authenticated actor and returns its result privately', async () => {
    getAuthenticatedUserId.mockResolvedValue(actorUserId);
    const result = {
      memberId,
      queue: [queueEntry],
      removedPlayerIds: ['picked-player'],
    };
    draftPrivateStateService.replacePreDraftQueue.mockResolvedValue(result);

    const response = await PUT_PRE_QUEUE(
      request(`/api/drafts/${draftId}/pre-queue`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberId: 'spoofed-member',
          queue: [
            { playerId: 'player-1', rank: 2, notes: 'second' },
            { playerId: 'picked-player', rank: 1 },
          ],
        }),
      }),
      context
    );

    expect(draftPrivateStateService.replacePreDraftQueue).toHaveBeenCalledWith({
      draftId,
      actorUserId,
      unresolvedPlayerPolicy: 'reject',
      queue: [
        { playerId: 'player-1', rank: 2, notes: 'second' },
        { playerId: 'picked-player', rank: 1 },
      ],
    });
    expect(draftPrivateStateService.replacePreDraftQueue.mock.calls[0]?.[0]).not.toHaveProperty(
      'memberId'
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await responseData(response)).toEqual(result);
  });

  it('validates queue shape after authentication and before service access', async () => {
    getAuthenticatedUserId.mockResolvedValue(actorUserId);

    const responses = await Promise.all([
      PUT_PRE_QUEUE(
        request(`/api/drafts/${draftId}/pre-queue`, {
          method: 'PUT',
          body: JSON.stringify({ queue: [{ playerId: '', rank: 1 }] }),
        }),
        context
      ),
      PUT_PRE_QUEUE(
        request(`/api/drafts/${draftId}/pre-queue`, {
          method: 'PUT',
          body: JSON.stringify({ queue: [{ playerId: 'player-1', rank: 0 }] }),
        }),
        context
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([422, 422]);
    expect(draftPrivateStateService.replacePreDraftQueue).not.toHaveBeenCalled();
  });

  it('delegates every compatibility queue operation and keeps successful responses private', async () => {
    getAuthenticatedUserId.mockResolvedValue(actorUserId);
    draftPrivateStateService.addToPreDraftQueue.mockResolvedValue(queueEntry);
    draftPrivateStateService.removeFromPreDraftQueue.mockResolvedValue(true);
    draftPrivateStateService.getPreDraftQueue.mockResolvedValue([queueEntry]);
    draftPrivateStateService.replacePreDraftQueue.mockResolvedValue({
      memberId,
      queue: [queueEntry],
      removedPlayerIds: ['picked-player'],
    });

    const responses = await Promise.all([
      POST_QUEUE(
        request(`/api/drafts/${draftId}/queue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerId: 'player-1', rank: 3 }),
        }),
        context
      ),
      DELETE_QUEUE(
        request(`/api/drafts/${draftId}/queue?playerId=player-1`, { method: 'DELETE' }),
        context
      ),
      GET_QUEUE(request(`/api/drafts/${draftId}/queue`), context),
      PUT_QUEUE(
        request(`/api/drafts/${draftId}/queue`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ queue: ['player-1', 'picked-player'] }),
        }),
        context
      ),
    ]);

    expect(draftPrivateStateService.addToPreDraftQueue).toHaveBeenCalledWith({
      draftId,
      actorUserId,
      playerId: 'player-1',
      rank: 3,
    });
    expect(draftPrivateStateService.removeFromPreDraftQueue).toHaveBeenCalledWith({
      draftId,
      actorUserId,
      playerId: 'player-1',
    });
    expect(draftPrivateStateService.getPreDraftQueue).toHaveBeenCalledWith({
      draftId,
      actorUserId,
    });
    expect(draftPrivateStateService.replacePreDraftQueue).toHaveBeenCalledWith({
      draftId,
      actorUserId,
      unresolvedPlayerPolicy: 'remove',
      queue: [
        { playerId: 'player-1', rank: 1 },
        { playerId: 'picked-player', rank: 2 },
      ],
    });
    expect(responses.map((response) => response.status)).toEqual([201, 200, 200, 200]);
    expect(
      responses.every((response) => response.headers.get('cache-control') === 'private, no-store')
    ).toBe(true);
    expect(await responseData(responses[3])).toEqual({
      memberId,
      queue: [queueEntry],
      failedIds: ['picked-player'],
    });
  });

  it('keeps auto-pick on canonical PreDraftQueue and global drafted-player cleanup', () => {
    const routeSource = read('src/app/api/drafts/[id]/auto-pick/route.ts');
    const repositorySource = read('src/server/draft/repository/DraftRepository.ts');
    const serviceSource = read('src/server/draft/services/DraftApplicationService.ts');

    expect(routeSource).toContain('draftApplicationService.autoPick');
    expect(repositorySource).toContain('tx.preDraftQueue.findFirst');
    expect(repositorySource).toContain('removePlayerFromAllDraftQueues');
    expect(repositorySource).toContain('where: { draftId, playerId }');
    expect(repositorySource).not.toContain('tx.queueItem');
    expect(serviceSource).toContain(
      'draftRepository.removePlayerFromAllDraftQueues(tx, draftId, selectedPlayer.id)'
    );
  });
});
