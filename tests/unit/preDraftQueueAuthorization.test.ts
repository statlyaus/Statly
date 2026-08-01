import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { DraftPrivateStateAccessError, draftPrivateStateService, getAuthenticatedUserId } =
  vi.hoisted(() => {
    class MockDraftPrivateStateAccessError extends Error {}

    return {
      DraftPrivateStateAccessError: MockDraftPrivateStateAccessError,
      draftPrivateStateService: {
        getPreDraftQueue: vi.fn(),
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
  draftPrivateStateService,
}));

import { GET, PUT } from '@/app/api/drafts/[id]/pre-queue/route';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const draftId = 'draft-1';
const actorUserId = 'user-1';
const context = { params: Promise.resolve({ id: draftId }) };

function request(path: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, init);
}

describe('pre-draft queue authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthenticated queue reads and writes before private state access', async () => {
    getAuthenticatedUserId.mockResolvedValue(null);

    const responses = await Promise.all([
      GET(request(`/api/drafts/${draftId}/pre-queue`), context),
      PUT(
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

  it('maps inactive or cross-league membership failures to forbidden', async () => {
    getAuthenticatedUserId.mockResolvedValue(actorUserId);
    draftPrivateStateService.getPreDraftQueue.mockRejectedValueOnce(
      new DraftPrivateStateAccessError('Not a member of this draft')
    );
    draftPrivateStateService.replacePreDraftQueue.mockRejectedValueOnce(
      new DraftPrivateStateAccessError('Not a member of this draft')
    );

    const responses = await Promise.all([
      GET(request(`/api/drafts/${draftId}/pre-queue`), context),
      PUT(
        request(`/api/drafts/${draftId}/pre-queue`, {
          method: 'PUT',
          body: JSON.stringify({ queue: [] }),
        }),
        context
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([403, 403]);
  });

  it('ignores spoofed legacy member IDs and uses the authenticated actor', async () => {
    getAuthenticatedUserId.mockResolvedValue(actorUserId);
    draftPrivateStateService.getPreDraftQueue.mockResolvedValue([]);
    draftPrivateStateService.replacePreDraftQueue.mockResolvedValue([]);

    const getResponse = await GET(
      request(`/api/drafts/${draftId}/pre-queue?memberId=spoofed-member`),
      context
    );
    const putResponse = await PUT(
      request(`/api/drafts/${draftId}/pre-queue`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberId: 'spoofed-member',
          queue: [{ playerId: 'player-1', rank: 1 }],
        }),
      }),
      context
    );

    expect(draftPrivateStateService.getPreDraftQueue).toHaveBeenCalledWith({
      draftId,
      actorUserId,
    });
    expect(draftPrivateStateService.replacePreDraftQueue).toHaveBeenCalledWith({
      draftId,
      actorUserId,
      queue: [{ playerId: 'player-1', rank: 1 }],
    });
    expect(draftPrivateStateService.replacePreDraftQueue.mock.calls[0]?.[0]).not.toHaveProperty(
      'memberId'
    );
    expect(getResponse.headers.get('cache-control')).toBe('private, no-store');
    expect(putResponse.status).toBe(200);
  });

  it('validates queue shape after authentication and before service access', async () => {
    getAuthenticatedUserId.mockResolvedValue(actorUserId);

    const response = await PUT(
      request(`/api/drafts/${draftId}/pre-queue`, {
        method: 'PUT',
        body: JSON.stringify({ memberId: 'spoofed-member', queue: [{ playerId: '', rank: 1 }] }),
      }),
      context
    );

    expect(response.status).toBe(400);
    expect(draftPrivateStateService.replacePreDraftQueue).not.toHaveBeenCalled();
  });

  it('keeps the compatibility queue route on PreDraftQueue and server-derived membership', () => {
    const source = read('src/app/api/drafts/[id]/queue/route.ts');

    expect(source).toContain('getAuthenticatedUserId');
    expect(source).toContain('getDraftMembershipAccess');
    expect(source).toContain('access.memberId');
    expect(source).toContain('preDraftQueue');
    expect(source).toContain('resolveCanonicalPlayerId');
    expect(source).toContain('resolveCanonicalPlayerIds');
    expect(source).toContain('z.string().trim().min(1)');
    expect(source).not.toMatch(/\bqueueItem\b/i);
    expect(source).not.toContain('memberId: z.string().min(1)');
  });

  it('auto-pick reaches PreDraftQueue through the draft service and repository', () => {
    const routeSource = read('src/app/api/drafts/[id]/auto-pick/route.ts');
    const repositorySource = read('src/server/draft/repository/DraftRepository.ts');

    expect(routeSource).toContain('draftApplicationService.autoPick');
    expect(repositorySource).toContain('tx.preDraftQueue.findFirst');
    expect(repositorySource).toContain('tx.preDraftQueue.deleteMany');
    expect(repositorySource).toContain('tx.preDraftQueue.delete');
    expect(repositorySource).not.toContain('tx.queueItem');
  });
});
