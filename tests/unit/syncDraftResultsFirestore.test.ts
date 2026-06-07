import type { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestoreMocks = vi.hoisted(() => ({
  batch: vi.fn(),
  collection: vi.fn(),
}));

const prismaMocks = vi.hoisted(() => ({
  league: {
    findUnique: vi.fn(),
  },
  draft: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: {
    batch: firestoreMocks.batch,
    collection: firestoreMocks.collection,
  },
}));

vi.mock('../../src/lib/firebaseAdmin', () => ({
  adminDb: {
    batch: firestoreMocks.batch,
    collection: firestoreMocks.collection,
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMocks,
}));

vi.mock('../../src/lib/prisma', () => ({
  prisma: prismaMocks,
}));

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: vi.fn(async () => 'manager-1'),
}));

vi.mock('../../src/lib/serverAuth', () => ({
  getAuthenticatedUserId: vi.fn(async () => 'manager-1'),
}));

vi.mock('@/lib/leagueMembership', () => ({
  getLeagueMembership: vi.fn(async () => ({
    isMember: true,
    data: { role: 'owner' },
  })),
  isLeagueManagerRole: vi.fn(() => true),
}));

vi.mock('../../src/lib/leagueMembership', () => ({
  getLeagueMembership: vi.fn(async () => ({
    isMember: true,
    data: { role: 'owner' },
  })),
  isLeagueManagerRole: vi.fn(() => true),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('../../src/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe('sync draft results Firestore fallback architecture', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    prismaMocks.league.findUnique.mockResolvedValue(null);
  });

  it('writes final draft rosters to the canonical league rosters subcollection', async () => {
    const batch = {
      commit: vi.fn().mockResolvedValue(undefined),
      set: vi.fn(),
      update: vi.fn(),
    };
    const rostersCollection = {
      doc: vi.fn((docId: string) => ({ path: `leagues/league-1/rosters/${docId}` })),
    };
    const teamsCollection = {
      doc: vi.fn((docId: string) => ({ path: `leagues/league-1/teams/${docId}` })),
    };
    const leagueDocRef = {
      collection: vi.fn((collectionName: string) => {
        if (collectionName === 'rosters') return rostersCollection;
        if (collectionName === 'teams') return teamsCollection;
        throw new Error(`Unexpected league subcollection ${collectionName}`);
      }),
      get: vi.fn().mockResolvedValue({ exists: true }),
      path: 'leagues/league-1',
    };
    const leaguesCollection = {
      doc: vi.fn(() => leagueDocRef),
    };

    firestoreMocks.batch.mockReturnValue(batch);
    firestoreMocks.collection.mockImplementation((collectionName: string) => {
      if (collectionName === 'leagues') return leaguesCollection;
      throw new Error(`Unexpected top-level collection ${collectionName}`);
    });

    const { POST } = await import('../../src/app/api/leagues/[id]/sync-draft-results/route');
    const response = await POST(
      jsonRequest('/api/leagues/league-1/sync-draft-results', {
        draftId: 'draft-1',
        finalRosters: [
          {
            memberId: 'member-1',
            userId: 'user-1',
            teamName: 'Draft Winners',
            players: [
              {
                playerId: 'player-1',
                playerName: 'Player One',
                position: 'MID',
                club: 'CARL',
                pickNumber: 1,
                round: 1,
              },
            ],
          },
        ],
      }),
      { params: Promise.resolve({ id: 'league-1' }) }
    );

    expect(response.status).toBe(200);
    expect(leagueDocRef.collection).toHaveBeenCalledWith('rosters');
    expect(leagueDocRef.collection).not.toHaveBeenCalledWith('teams');
    expect(batch.set).toHaveBeenCalledWith(
      { path: 'leagues/league-1/rosters/member-1' },
      expect.objectContaining({
        leagueId: 'league-1',
        memberId: 'member-1',
        userId: 'user-1',
        teamName: 'Draft Winners',
        playerIds: ['player-1'],
        bench: [],
        emergencies: [],
      }),
      { merge: true }
    );
  });

  it('requires a league manager before syncing draft results', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/api/leagues/[id]/sync-draft-results/route.ts'),
      'utf8'
    );

    expect(source).toContain("import { getAuthenticatedUserId } from '@/lib/serverAuth'");
    expect(source).toContain(
      "import { getLeagueMembership, isLeagueManagerRole } from '@/lib/leagueMembership'"
    );
    expect(source).toContain('authorizeDraftResultsSync(request, leagueId)');
    expect(source).toContain('const userId = await getAuthenticatedUserId(request);');
    expect(source).toContain('const membership = await getLeagueMembership(leagueId, userId);');
    expect(source).toContain('!isLeagueManagerRole(membership.data?.role)');
    expect(source.indexOf('authorizeDraftResultsSync(request, leagueId)')).toBeLessThan(
      source.indexOf('prisma.league.findUnique')
    );
  });
});

function jsonRequest(path: string, body: unknown): NextRequest {
  return new Request(`https://statly.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}
