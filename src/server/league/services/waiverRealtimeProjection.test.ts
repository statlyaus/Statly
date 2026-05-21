import { describe, expect, it, vi } from 'vitest';

import { syncLeagueWaiverRealtimeProjection } from './waiverRealtimeProjection';

function createFirestoreMock() {
  const set = vi.fn();
  const commit = vi.fn().mockResolvedValue(undefined);
  const batch = vi.fn(() => ({ set, commit }));
  const doc = vi.fn((path: string) => ({ path }));

  return {
    firestore: { batch, doc },
    set,
    commit,
  };
}

describe('syncLeagueWaiverRealtimeProjection', () => {
  it('materializes waiver claims, rosters, priorities, and activity for realtime clients', async () => {
    const prismaClient = {
      waiverClaim: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'claim-1',
            leagueId: 'league-1',
            memberId: 'member-1',
            playerId: 'player-add',
            dropPlayerId: 'player-drop',
            priority: 2,
            bidAmount: 7,
            status: 'PENDING',
            reason: null,
            processingAt: new Date('2026-05-20T10:00:00.000Z'),
            processedAt: null,
            createdAt: new Date('2026-05-20T09:00:00.000Z'),
            member: {
              id: 'member-1',
              userId: 'user-1',
              teamName: 'Test Team',
            },
          },
        ]),
      },
      waiverPriority: {
        findMany: vi.fn().mockResolvedValue([
          {
            memberId: 'member-1',
            currentPriority: 2,
            remainingFaab: 93,
            pendingBidTotal: 7,
            updatedAt: new Date('2026-05-20T09:30:00.000Z'),
            member: {
              id: 'member-1',
              userId: 'user-1',
              teamName: 'Test Team',
            },
          },
        ]),
      },
      leagueMember: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'member-1',
            userId: 'user-1',
            teamName: 'Test Team',
            role: 'OWNER',
            rosterPlayers: [
              { playerId: 'player-drop', sortOrder: 0 },
              { playerId: 'player-keep', sortOrder: 1 },
            ],
          },
        ]),
      },
    };
    const { firestore, set, commit } = createFirestoreMock();

    await syncLeagueWaiverRealtimeProjection({
      leagueId: 'league-1',
      prismaClient: prismaClient as never,
      firestore: firestore as never,
    });

    expect(set).toHaveBeenCalledWith(
      { path: 'leagues/league-1/waivers/claim-1' },
      expect.objectContaining({
        leagueId: 'league-1',
        userId: 'user-1',
        teamId: 'member-1',
        playerId: 'player-add',
        dropPlayerId: 'player-drop',
        priority: 2,
        bidAmount: 7,
        status: 'PENDING',
      }),
      { merge: true }
    );
    expect(set).toHaveBeenCalledWith(
      { path: 'leagues/league-1/rosters/user-1' },
      expect.objectContaining({
        leagueId: 'league-1',
        memberId: 'member-1',
        userId: 'user-1',
        teamName: 'Test Team',
        playerIds: ['player-drop', 'player-keep'],
      }),
      { merge: true }
    );
    expect(set).toHaveBeenCalledWith(
      { path: 'leagues/league-1/members/user-1' },
      expect.objectContaining({
        leagueId: 'league-1',
        memberId: 'member-1',
        userId: 'user-1',
        teamName: 'Test Team',
        role: 'OWNER',
        status: 'ACTIVE',
      }),
      { merge: true }
    );
    expect(set).toHaveBeenCalledWith(
      { path: 'leagues/league-1/waiverPriorities/user-1' },
      expect.objectContaining({
        leagueId: 'league-1',
        memberId: 'member-1',
        userId: 'user-1',
        currentPriority: 2,
        remainingFAAB: 93,
        pendingBidTotal: 7,
      }),
      { merge: true }
    );
    expect(set).toHaveBeenCalledWith(
      { path: 'leagues/league-1/activity/waiver-claim-1' },
      expect.objectContaining({
        leagueId: 'league-1',
        type: 'waiver-submitted',
        userId: 'user-1',
        teamId: 'member-1',
        playerId: 'player-add',
        dropPlayerId: 'player-drop',
        claimId: 'claim-1',
      }),
      { merge: true }
    );
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('writes explicit nulls instead of undefined optional Firestore fields', async () => {
    const prismaClient = {
      waiverClaim: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'claim-1',
            leagueId: 'league-1',
            memberId: 'member-1',
            playerId: 'player-add',
            dropPlayerId: null,
            priority: 1,
            bidAmount: null,
            status: 'PENDING',
            reason: null,
            processingAt: null,
            processedAt: null,
            createdAt: new Date('2026-05-20T09:00:00.000Z'),
            member: {
              id: 'member-1',
              userId: 'user-1',
              teamName: 'Test Team',
            },
          },
        ]),
      },
      waiverPriority: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      leagueMember: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const { firestore, set } = createFirestoreMock();

    await syncLeagueWaiverRealtimeProjection({
      leagueId: 'league-1',
      prismaClient: prismaClient as never,
      firestore: firestore as never,
    });

    const payloads = set.mock.calls.map(([, data]) => data);
    expect(payloads).toHaveLength(2);
    for (const payload of payloads) {
      expect(JSON.stringify(payload)).not.toContain('undefined');
      expect(Object.values(payload as Record<string, unknown>)).not.toContain(undefined);
    }
    expect(set).toHaveBeenCalledWith(
      { path: 'leagues/league-1/waivers/claim-1' },
      expect.objectContaining({
        bidAmount: null,
        dropPlayerId: null,
        processedAt: null,
        processingAt: null,
        reason: null,
      }),
      { merge: true }
    );
  });

  it('chunks Firestore writes below the batch limit', async () => {
    const claims = Array.from({ length: 260 }, (_, index) => ({
      id: `claim-${index}`,
      leagueId: 'league-1',
      memberId: 'member-1',
      playerId: `player-${index}`,
      dropPlayerId: null,
      priority: index + 1,
      bidAmount: null,
      status: 'PENDING',
      reason: null,
      processingAt: null,
      processedAt: null,
      createdAt: new Date('2026-05-20T09:00:00.000Z'),
      member: {
        id: 'member-1',
        userId: 'user-1',
        teamName: 'Test Team',
      },
    }));
    const prismaClient = {
      waiverClaim: {
        findMany: vi.fn().mockResolvedValue(claims),
      },
      waiverPriority: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      leagueMember: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const { firestore, commit } = createFirestoreMock();

    await syncLeagueWaiverRealtimeProjection({
      leagueId: 'league-1',
      prismaClient: prismaClient as never,
      firestore: firestore as never,
    });

    expect(firestore.batch).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenCalledTimes(2);
  });
});
