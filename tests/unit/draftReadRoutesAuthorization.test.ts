import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAuthenticatedUserId, getDraftMembershipAccess, prisma } = vi.hoisted(() => ({
  getAuthenticatedUserId: vi.fn(),
  getDraftMembershipAccess: vi.fn(),
  prisma: {
    draft: { findUnique: vi.fn() },
    pick: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  },
}));

vi.mock('@/lib/serverAuth', () => ({ getAuthenticatedUserId }));
vi.mock('@/server/leagues/membership', () => ({ getDraftMembershipAccess }));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/server/draft/services/DraftProjectionService', () => ({
  buildDraftClockPayload: vi.fn(),
}));
vi.mock('@/server/draft/services/DraftReadinessService', () => ({
  getLeagueDraftOperationalReadiness: vi.fn(),
}));

import { GET as getDraft } from '@/app/api/drafts/[id]/route';
import { GET as getDraftPicks } from '@/app/api/drafts/[id]/picks/route';

const draftId = 'cmn9l4tiv0000uxd6u0kz1xq1';
const context = { params: Promise.resolve({ id: draftId }) };

function request(path: string) {
  return new NextRequest(`http://localhost:3000${path}`);
}

describe('protected draft read routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['draft metadata', getDraft, `/api/drafts/${draftId}`],
    ['draft picks', getDraftPicks, `/api/drafts/${draftId}/picks`],
  ])(
    'rejects unauthenticated %s reads before querying draft state',
    async (_name, handler, path) => {
      getAuthenticatedUserId.mockResolvedValue(null);

      const response = await handler(request(path), context);

      expect(response.status).toBe(401);
      expect(getDraftMembershipAccess).not.toHaveBeenCalled();
      expect(prisma.draft.findUnique).not.toHaveBeenCalled();
      expect(prisma.pick.findFirst).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['draft metadata', getDraft, `/api/drafts/${draftId}`],
    ['draft picks', getDraftPicks, `/api/drafts/${draftId}/picks`],
  ])('rejects cross-league %s reads before querying draft state', async (_name, handler, path) => {
    getAuthenticatedUserId.mockResolvedValue('outsider-user');
    getDraftMembershipAccess.mockResolvedValue({
      leagueId: 'league-1',
      userId: 'outsider-user',
      isMember: false,
      canManage: false,
    });

    const response = await handler(request(path), context);

    expect(response.status).toBe(403);
    expect(getDraftMembershipAccess).toHaveBeenCalledWith(draftId, 'outsider-user');
    expect(prisma.draft.findUnique).not.toHaveBeenCalled();
    expect(prisma.pick.findFirst).not.toHaveBeenCalled();
  });
});
