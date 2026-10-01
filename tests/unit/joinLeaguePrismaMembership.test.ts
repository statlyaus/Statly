import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserIdFromRequest: vi.fn(),
  batch: vi.fn(),
  batchCommit: vi.fn(),
  batchUpdate: vi.fn(),
  collection: vi.fn(),
  leagueQueryGet: vi.fn(),
  runTransaction: vi.fn(),
  transactionGet: vi.fn(),
  transactionSet: vi.fn(),
  listActiveLeagueMembers: vi.fn(),
  queueLeagueMembershipSet: vi.fn(),
  findPrismaLeagueIdByInviteCode: vi.fn(),
  joinLeague: vi.fn(),
  syncPrismaLeagueMember: vi.fn(),
}));

vi.mock('@/lib/serverAuth', () => ({ getUserIdFromRequest: mocks.getUserIdFromRequest }));
vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: {
    batch: mocks.batch,
    collection: mocks.collection,
    runTransaction: mocks.runTransaction,
  },
}));
vi.mock('@/lib/leagueMembership', () => ({
  listActiveLeagueMembers: mocks.listActiveLeagueMembers,
  queueLeagueMembershipSet: mocks.queueLeagueMembershipSet,
}));
vi.mock('@/server/leagues/memberCommands', () => ({
  findPrismaLeagueIdByInviteCode: mocks.findPrismaLeagueIdByInviteCode,
  joinLeague: mocks.joinLeague,
}));
vi.mock('@/lib/prismaLeagueBridge', () => ({
  syncPrismaLeagueMember: mocks.syncPrismaLeagueMember,
}));

const LEGACY_LEAGUE = {
  name: 'Legacy League',
  code: 'LEGACY12',
  type: 'private',
  status: 'preseason',
  maxTeams: 2,
};

const JOINED = {
  ok: true as const,
  data: {
    member: {
      id: 'league-1_joining-user',
      leagueId: 'league-1',
      userId: 'joining-user',
      role: 'member' as const,
      teamName: 'New Team',
      joinedAt: '2026-09-30T00:00:00.000Z',
      isActive: true as const,
    },
    memberCount: 3,
    draftSlot: 3,
    league: {
      id: 'league-1',
      name: 'Prisma League',
      inviteCode: 'PRISMA12',
      draftDate: '2026-10-10T09:00:00.000Z',
    },
  },
};

describe('join league route membership authority', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    mocks.getUserIdFromRequest.mockResolvedValue('joining-user');
    mocks.findPrismaLeagueIdByInviteCode.mockResolvedValue(null);
    mocks.joinLeague.mockResolvedValue(JOINED);
    mocks.queueLeagueMembershipSet.mockReturnValue('league-1_joining-user');
    mocks.syncPrismaLeagueMember.mockResolvedValue({ synced: false, reason: 'no-prisma-league' });
    mocks.batchCommit.mockResolvedValue(undefined);
    mocks.batch.mockReturnValue({ commit: mocks.batchCommit, update: mocks.batchUpdate });
    mocks.leagueQueryGet.mockResolvedValue({
      empty: false,
      size: 1,
      docs: [{ id: 'league-1', data: () => LEGACY_LEAGUE }],
    });
    mocks.runTransaction.mockImplementation((callback) =>
      callback({ get: mocks.transactionGet, set: mocks.transactionSet })
    );
    mocks.transactionGet.mockResolvedValue({
      exists: true,
      id: 'league-1',
      data: () => LEGACY_LEAGUE,
    });
    mocks.collection.mockImplementation((name: string) => {
      if (name !== 'leagues') throw new Error(`Unexpected collection access: ${name}`);
      return {
        doc: vi.fn(() => ({ id: 'league-1' })),
        where: vi.fn(() => ({ limit: vi.fn(() => ({ get: mocks.leagueQueryGet })) })),
      };
    });
  });

  it('joins a Prisma league through the Prisma command and projects the member to Firestore', async () => {
    mocks.findPrismaLeagueIdByInviteCode.mockResolvedValue('league-1');

    const response = await join({ code: 'prisma-12', teamName: 'New Team' });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(mocks.findPrismaLeagueIdByInviteCode).toHaveBeenCalledWith('PRISMA12');
    expect(mocks.joinLeague).toHaveBeenCalledWith({
      leagueId: 'league-1',
      userId: 'joining-user',
      teamName: 'New Team',
    });
    expect(body.data).toEqual({
      member: JOINED.data.member,
      league: {
        id: 'league-1',
        name: 'Prisma League',
        code: 'PRISMA12',
        draftDate: '2026-10-10T09:00:00.000Z',
      },
    });
    expect(mocks.queueLeagueMembershipSet).toHaveBeenCalledWith(
      expect.objectContaining({ commit: mocks.batchCommit }),
      expect.objectContaining({ leagueId: 'league-1', userId: 'joining-user', isActive: true }),
      { topLevelMemberId: 'league-1_joining-user' }
    );
    expect(mocks.batchUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ memberCount: 3 })
    );
    expect(mocks.batchCommit).toHaveBeenCalled();
    expect(mocks.leagueQueryGet).not.toHaveBeenCalled();
    expect(mocks.runTransaction).not.toHaveBeenCalled();
    expect(mocks.listActiveLeagueMembers).not.toHaveBeenCalled();
    expect(mocks.syncPrismaLeagueMember).not.toHaveBeenCalled();
  });

  it('keeps a committed Prisma join successful when the Firestore projection fails', async () => {
    mocks.findPrismaLeagueIdByInviteCode.mockResolvedValue('league-1');
    mocks.batchCommit.mockRejectedValue(new Error('firestore unavailable'));

    const response = await join({ code: 'PRISMA12', teamName: 'New Team' });

    expect(response.status).toBe(201);
  });

  it.each([
    ['league-full', 'League is full', 400],
    ['draft-started', 'League is no longer accepting new members', 400],
    ['already-member', 'Already a member of this league', 400],
    ['team-name-taken', 'Team name already taken', 400],
  ] as const)('reports the %s command refusal', async (code, message, status) => {
    mocks.findPrismaLeagueIdByInviteCode.mockResolvedValue('league-1');
    mocks.joinLeague.mockResolvedValue({ ok: false, code, message });

    const response = await join({ code: 'PRISMA12', teamName: 'New Team' });
    const body = await response.json();

    expect(response.status).toBe(status);
    expect(body).toMatchObject({ success: false, error: message });
    expect(mocks.batchCommit).not.toHaveBeenCalled();
  });

  it('joins through Prisma when the Firestore code belongs to a league Prisma owns', async () => {
    const response = await join({ code: 'LEGACY12', teamName: 'New Team' });

    expect(response.status).toBe(201);
    expect(mocks.joinLeague).toHaveBeenCalledWith(
      expect.objectContaining({ leagueId: 'league-1' })
    );
    expect(mocks.runTransaction).not.toHaveBeenCalled();
  });

  it('keeps the Firestore join for legacy leagues without a Prisma row', async () => {
    mocks.joinLeague.mockResolvedValue({
      ok: false,
      code: 'league-not-found',
      message: 'League not found.',
    });
    mocks.listActiveLeagueMembers.mockResolvedValue([
      firestoreMember('owner-user', 'Owner Team'),
      firestoreMember('second-user', 'Second Team'),
    ]);

    const response = await join({ code: 'LEGACY12', teamName: 'New Team' });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('League is full');
    expect(mocks.runTransaction).toHaveBeenCalled();
    expect(mocks.listActiveLeagueMembers).toHaveBeenCalledWith('league-1');
  });

  it('reports an unknown code', async () => {
    mocks.leagueQueryGet.mockResolvedValue({ empty: true, size: 0, docs: [] });

    const response = await join({ code: 'NOPE1234' });

    expect(response.status).toBe(400);
    expect(mocks.joinLeague).not.toHaveBeenCalled();
  });
});

async function join(body: unknown) {
  const { POST } = await import('../../src/app/api/leagues/join/route');
  return POST(
    new Request('https://statly.test/api/leagues/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as NextRequest
  );
}

function firestoreMember(userId: string, teamName: string) {
  return {
    id: `league-1_${userId}`,
    leagueId: 'league-1',
    userId,
    role: 'member',
    teamName,
    isActive: true,
    source: 'embedded',
  };
}
