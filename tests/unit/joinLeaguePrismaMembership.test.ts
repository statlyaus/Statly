import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserIdFromRequest: vi.fn(),
  batch: vi.fn(),
  batchCommit: vi.fn(),
  batchUpdate: vi.fn(),
  collection: vi.fn(),
  leagueDoc: vi.fn(),
  runTransaction: vi.fn(),
  queueLeagueMembershipSet: vi.fn(),
  findPrismaLeagueIdByInviteCode: vi.fn(),
  joinLeague: vi.fn(),
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
  queueLeagueMembershipSet: mocks.queueLeagueMembershipSet,
}));
vi.mock('@/server/leagues/memberCommands', () => ({
  findPrismaLeagueIdByInviteCode: mocks.findPrismaLeagueIdByInviteCode,
  joinLeague: mocks.joinLeague,
}));

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
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    mocks.getUserIdFromRequest.mockResolvedValue('joining-user');
    mocks.findPrismaLeagueIdByInviteCode.mockResolvedValue(null);
    mocks.joinLeague.mockResolvedValue(JOINED);
    mocks.queueLeagueMembershipSet.mockReturnValue('league-1_joining-user');
    mocks.batchCommit.mockResolvedValue(undefined);
    mocks.batch.mockReturnValue({ commit: mocks.batchCommit, update: mocks.batchUpdate });
    mocks.leagueDoc.mockReturnValue({ id: 'league-1' });
    mocks.collection.mockImplementation((name: string) => {
      if (name !== 'leagues') throw new Error(`Unexpected collection access: ${name}`);
      return { doc: mocks.leagueDoc };
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
    expect(mocks.leagueDoc).toHaveBeenCalledWith('league-1');
    expect(mocks.runTransaction).not.toHaveBeenCalled();
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

  it('reports an unknown code as not found without consulting Firestore', async () => {
    const response = await join({ code: 'nope-1234', teamName: 'New Team' });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ success: false, error: 'League with code "NOPE1234" not found.' });
    expect(mocks.findPrismaLeagueIdByInviteCode).toHaveBeenCalledWith('NOPE1234');
    expect(mocks.joinLeague).not.toHaveBeenCalled();
    expect(mocks.collection).not.toHaveBeenCalled();
    expect(mocks.batch).not.toHaveBeenCalled();
    expect(mocks.runTransaction).not.toHaveBeenCalled();
  });

  it('reports a league that left Prisma mid-join as not found without consulting Firestore', async () => {
    mocks.findPrismaLeagueIdByInviteCode.mockResolvedValue('league-1');
    mocks.joinLeague.mockResolvedValue({
      ok: false,
      code: 'league-not-found',
      message: 'League not found.',
    });

    const response = await join({ code: 'PRISMA12', teamName: 'New Team' });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ success: false, error: 'League with code "PRISMA12" not found.' });
    expect(mocks.collection).not.toHaveBeenCalled();
    expect(mocks.batch).not.toHaveBeenCalled();
    expect(mocks.runTransaction).not.toHaveBeenCalled();
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
