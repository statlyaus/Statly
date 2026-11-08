import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  findMemberships: vi.fn(),
  firestoreCollection: vi.fn(() => {
    throw new Error('Firestore must not be read');
  }),
  legacyMemberships: vi.fn(() => {
    throw new Error('Firestore memberships must not be read');
  }),
}));

vi.mock('@/lib/serverAuth', () => ({ getAuthenticatedUserId: mocks.authenticate }));
vi.mock('@/lib/prisma', () => ({
  prisma: { leagueMember: { findMany: mocks.findMemberships } },
}));
vi.mock('@/lib/firebaseAdmin', () => ({ adminDb: { collection: mocks.firestoreCollection } }));
vi.mock('@/lib/leagueMembership', () => ({
  listActiveUserLeagueMemberships: mocks.legacyMemberships,
}));

import { GET } from '@/app/api/leagues/user/[userId]/route';

const createdAt = new Date('2026-07-01T00:00:00.000Z');
const startAt = new Date('2026-08-15T09:00:00.000Z');

function request(userId: string) {
  return new NextRequest(`http://localhost/api/leagues/user/${userId}`);
}

function params(userId: string) {
  return { params: Promise.resolve({ userId }) };
}

describe('GET /api/leagues/user/[userId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue('user-1');
  });

  it('lists a Prisma league that has no Firestore document', async () => {
    mocks.findMemberships.mockResolvedValue([
      {
        teamName: 'Hawks Nest',
        league: {
          id: 'league-1',
          name: 'Prisma Only League',
          ownerId: 'user-1',
          inviteCode: 'CODE1234',
          categoriesJson: REAL_DATA_NINE_CATEGORY_PRESET,
          createdAt,
          settings: { maxTeams: 10, startAt },
          drafts: [{ status: 'LIVE' }],
          _count: { members: 6 },
        },
      },
    ]);

    const response = await GET(request('user-1'), params('user-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      leagues: [
        {
          id: 'league-1',
          name: 'Prisma Only League',
          teamName: 'Hawks Nest',
          status: 'active',
          draftCompleted: false,
          memberCount: 6,
          maxTeams: 10,
          description: 'Prisma Only League Fantasy League',
          ownerId: 'user-1',
          type: 'private',
          code: 'CODE1234',
          categories: [...REAL_DATA_NINE_CATEGORY_PRESET],
          draftDate: startAt.toISOString(),
          createdAt: createdAt.toISOString(),
          updatedAt: createdAt.toISOString(),
        },
      ],
    });
    expect(mocks.findMemberships).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', isActive: true } })
    );
    expect(mocks.firestoreCollection).not.toHaveBeenCalled();
    expect(mocks.legacyMemberships).not.toHaveBeenCalled();
  });

  it('returns an empty list, not Firestore leagues, when the user has no Prisma memberships', async () => {
    mocks.findMemberships.mockResolvedValue([]);

    const response = await GET(request('user-1'), params('user-1'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, leagues: [] });
    expect(mocks.firestoreCollection).not.toHaveBeenCalled();
    expect(mocks.legacyMemberships).not.toHaveBeenCalled();
  });

  it("refuses to answer for another user's id", async () => {
    const response = await GET(request('user-2'), params('user-2'));

    expect(response.status).toBe(403);
    expect(mocks.findMemberships).not.toHaveBeenCalled();
  });

  it('refuses an unauthenticated caller', async () => {
    mocks.authenticate.mockResolvedValue(null);

    const response = await GET(request('user-1'), params('user-1'));

    expect(response.status).toBe(401);
    expect(mocks.findMemberships).not.toHaveBeenCalled();
  });
});
