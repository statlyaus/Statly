import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  findLeague: vi.fn(),
  readiness: vi.fn(),
  firestoreCollection: vi.fn(() => {
    throw new Error('Firestore must not be read');
  }),
  legacyMembership: vi.fn(() => {
    throw new Error('Firestore membership must not be read');
  }),
}));

vi.mock('@/lib/serverAuth', () => ({ getAuthenticatedUserId: mocks.authenticate }));
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: mocks.findLeague } } }));
vi.mock('@/lib/firebaseAdmin', () => ({ adminDb: { collection: mocks.firestoreCollection } }));
vi.mock('@/lib/leagueMembership', () => ({
  getLeagueMembership: mocks.legacyMembership,
}));
vi.mock('@/server/draft/services/DraftReadinessService', () => ({
  getLeagueDraftOperationalReadiness: mocks.readiness,
}));

import { GET } from '@/app/api/leagues/[id]/draft/route';

const draftCreatedAt = new Date('2026-08-01T00:00:00.000Z');
const startAt = new Date('2026-08-15T09:00:00.000Z');

function prismaLeague(members: Array<{ userId: string; role: string }>) {
  return {
    id: 'league-1',
    name: 'Prisma Only League',
    ownerId: 'owner-user',
    settings: { draftType: 'SNAKE', pickSeconds: 90, startAt, maxTeams: 10 },
    drafts: [
      {
        id: 'draft-1',
        status: 'SCHEDULED',
        currentPick: 0,
        totalPicks: 180,
        createdAt: draftCreatedAt,
      },
    ],
    _count: { members: 4 },
    members,
  };
}

function stubLeague(league: ReturnType<typeof prismaLeague> | null) {
  mocks.findLeague.mockImplementation(
    async (args: { select?: Record<string, unknown>; include?: Record<string, unknown> }) => {
      if (!league) return null;
      if (args.select) {
        // getLeagueMembershipAccess selects the caller's membership row.
        return {
          ownerId: league.ownerId,
          members: league.members.map((member, index) => ({
            id: `member-${index}`,
            role: member.role,
            isActive: true,
            status: 'active',
            isCoCommissioner: false,
          })),
        };
      }
      return league;
    }
  );
}

function request() {
  return new NextRequest('http://localhost/api/leagues/league-1/draft');
}

const params = { params: Promise.resolve({ id: 'league-1' }) };

describe('GET /api/leagues/[id]/draft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue('owner-user');
    mocks.readiness.mockResolvedValue({ ready: true });
  });

  it('returns the draft for a Prisma league that has no Firestore document', async () => {
    stubLeague(prismaLeague([{ userId: 'owner-user', role: 'owner' }]));

    const response = await GET(request(), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      data: {
        leagueId: 'league-1',
        draft: {
          id: 'draft-1',
          status: 'SCHEDULED',
          type: 'SNAKE',
          pickSeconds: 90,
          startAt: startAt.toISOString(),
          currentPick: 0,
          totalPicks: 180,
          createdAt: draftCreatedAt.toISOString(),
        },
        canManage: true,
        memberCount: 4,
        maxTeams: 10,
        league: { id: 'league-1', name: 'Prisma Only League' },
        draftReadiness: { ready: true },
      },
    });
    expect(mocks.firestoreCollection).not.toHaveBeenCalled();
    expect(mocks.legacyMembership).not.toHaveBeenCalled();
  });

  it('treats a league with no Prisma row as not found without consulting Firestore', async () => {
    stubLeague(null);

    const response = await GET(request(), params);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ success: false, error: 'League not found' });
    expect(mocks.firestoreCollection).not.toHaveBeenCalled();
    expect(mocks.legacyMembership).not.toHaveBeenCalled();
    expect(mocks.readiness).not.toHaveBeenCalled();
  });

  it('refuses a caller who is not a member of the Prisma league', async () => {
    mocks.authenticate.mockResolvedValue('outsider');
    stubLeague(prismaLeague([]));

    const response = await GET(request(), params);

    expect(response.status).toBe(403);
    expect(mocks.firestoreCollection).not.toHaveBeenCalled();
    expect(mocks.readiness).not.toHaveBeenCalled();
  });

  it('refuses an unauthenticated caller before reading the league', async () => {
    mocks.authenticate.mockResolvedValue(null);

    const response = await GET(request(), params);

    expect(response.status).toBe(401);
    expect(mocks.findLeague).not.toHaveBeenCalled();
  });
});
