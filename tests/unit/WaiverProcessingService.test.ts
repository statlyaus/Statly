import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: {},
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {},
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import {
  buildAdvancedWaiverPriorityUpdates,
  PrismaWaiverClaimStore,
  sortWaiverClaims,
  WaiverProcessingService,
  type WaiverClaim,
} from '@/server/waivers/WaiverProcessingService';

function claim(overrides: Partial<WaiverClaim> = {}): WaiverClaim {
  return {
    id: 'claim-1',
    leagueId: 'league-1',
    userId: 'user-1',
    teamId: 'member-1',
    playerId: 'free-player',
    priority: 1,
    status: 'PENDING',
    createdAt: new Date('2026-06-23T10:00:00.000Z'),
    ...overrides,
  };
}

function createDbMock() {
  const tx = {
    league: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'league-1',
        settings: { rosterSize: 2 },
      }),
    },
    leagueMember: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'member-1',
        userId: 'user-1',
      }),
    },
    leagueRoster: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'roster-1',
        playerIds: JSON.stringify(['old-player', 'keep-player']),
      }),
      upsert: vi.fn().mockResolvedValue({ id: 'roster-1' }),
    },
    leagueRosterPlayer: {
      count: vi.fn().mockResolvedValue(2),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      findFirst: vi.fn(async ({ where }: { where: { playerId?: unknown; memberId?: string } }) => {
        const playerIds =
          where.playerId && typeof where.playerId === 'object' && 'in' in where.playerId
            ? (where.playerId as { in: string[] }).in
            : [where.playerId];
        if (playerIds.includes('free-player')) return null;
        if (playerIds.includes('old-player') && where.memberId === 'member-1') {
          return { playerId: 'old-player', memberId: 'member-1' };
        }
        return null;
      }),
      upsert: vi.fn().mockResolvedValue({ id: 'roster-player-1' }),
    },
    player: {
      findMany: vi
        .fn()
        .mockResolvedValue([
          { id: 'free-player', name: 'Free Player', club: 'Test Club', position: 'MID' },
        ]),
    },
    teamAction: {
      create: vi.fn().mockResolvedValue({ id: 'drop-hold-1' }),
    },
  };

  return {
    tx,
    db: {
      ...tx,
      $transaction: vi.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    },
  };
}

function createClaimStoreMock() {
  return {
    markSuccessful: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    recordActivity: vi.fn().mockResolvedValue(undefined),
    decrementPendingBidTotal: vi.fn().mockResolvedValue(undefined),
    debitFaab: vi.fn().mockResolvedValue(undefined),
    advancePriority: vi.fn().mockResolvedValue(undefined),
  };
}

function createCompatibilityProjectionMock() {
  const waiverDoc = {
    set: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
  };
  const activityDoc = {
    set: vi.fn().mockResolvedValue(undefined),
  };

  return {
    waiverDoc,
    activityDoc,
    firestore: {
      collection: vi.fn((path: string) => ({
        doc: vi.fn((id?: string) =>
          path.endsWith('/waivers') ? waiverDoc : { id: id ?? 'activity-1', ...activityDoc }
        ),
      })),
      doc: vi.fn(() => waiverDoc),
    },
  };
}

describe('WaiverProcessingService', () => {
  it('writes successful waiver ownership to canonical Prisma roster tables and refreshes availability', async () => {
    const { db, tx } = createDbMock();
    const claimStore = createClaimStoreMock();
    const projection = { projectLeague: vi.fn().mockResolvedValue({ owned: 2, available: 10 }) };
    const service = new WaiverProcessingService(db as never, claimStore, projection);

    const result = await service.processClaims({
      leagueId: 'league-1',
      waiverSettings: { system: 'PRIORITY' },
      claims: [claim({ dropPlayerId: 'old-player' })],
    });

    expect(result.results).toEqual([{ id: 'claim-1', status: 'SUCCESSFUL' }]);
    expect(tx.leagueRosterPlayer.deleteMany).toHaveBeenCalledWith({
      where: { leagueId: 'league-1', memberId: 'member-1', playerId: 'old-player' },
    });
    expect(tx.teamAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leagueId: 'league-1',
        memberId: 'member-1',
        actionType: 'DROP_PLAYER',
        status: 'PENDING',
        details: expect.stringContaining('"playerId":"old-player"'),
        processingAt: expect.any(Date),
      }),
      select: { id: true },
    });
    expect(tx.leagueRosterPlayer.upsert).toHaveBeenCalledWith({
      where: { leagueId_playerId: { leagueId: 'league-1', playerId: 'free-player' } },
      update: expect.objectContaining({
        memberId: 'member-1',
        acquiredBy: 'WAIVER',
      }),
      create: expect.objectContaining({
        leagueId: 'league-1',
        memberId: 'member-1',
        playerId: 'free-player',
        acquiredBy: 'WAIVER',
      }),
    });
    expect(tx.leagueRoster.upsert).toHaveBeenCalledWith({
      where: { leagueId_memberId: { leagueId: 'league-1', memberId: 'member-1' } },
      update: { playerIds: JSON.stringify(['keep-player', 'free-player']) },
      create: {
        leagueId: 'league-1',
        memberId: 'member-1',
        playerIds: JSON.stringify(['keep-player', 'free-player']),
      },
    });
    expect(claimStore.markSuccessful).toHaveBeenCalledWith(
      expect.objectContaining({ leagueId: 'league-1', claimId: 'claim-1' })
    );
    expect(claimStore.advancePriority).toHaveBeenCalledWith('league-1', 'user-1');
    expect(projection.projectLeague).toHaveBeenCalledWith({ leagueId: 'league-1' });
  });

  it('fails a claim before ownership transfer when the roster is full and no drop player is supplied', async () => {
    const { db, tx } = createDbMock();
    const claimStore = createClaimStoreMock();
    const projection = { projectLeague: vi.fn() };
    const service = new WaiverProcessingService(db as never, claimStore, projection);

    const result = await service.processClaims({
      leagueId: 'league-1',
      waiverSettings: { system: 'PRIORITY' },
      claims: [claim()],
    });

    expect(result.results).toEqual([
      { id: 'claim-1', status: 'FAILED', reason: 'Roster limit reached' },
    ]);
    expect(tx.leagueRosterPlayer.upsert).not.toHaveBeenCalled();
    expect(claimStore.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({ claimId: 'claim-1', reason: 'Roster limit reached' })
    );
    expect(projection.projectLeague).not.toHaveBeenCalled();
  });

  it('does not debit FAAB when canonical roster validation fails', async () => {
    const { db } = createDbMock();
    const claimStore = createClaimStoreMock();
    const projection = { projectLeague: vi.fn() };
    const service = new WaiverProcessingService(db as never, claimStore, projection);

    const result = await service.processClaims({
      leagueId: 'league-1',
      waiverSettings: { system: 'FAAB', faabBudget: 100 },
      claims: [claim({ bidAmount: 12 })],
    });

    expect(result.results).toEqual([
      { id: 'claim-1', status: 'FAILED', reason: 'Roster limit reached' },
    ]);
    expect(claimStore.debitFaab).not.toHaveBeenCalled();
    expect(claimStore.decrementPendingBidTotal).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'claim-1', bidAmount: 12 }),
      true
    );
    expect(projection.projectLeague).not.toHaveBeenCalled();
  });

  it('rejects a claim when another alias for the logical player is already owned', async () => {
    const { db, tx } = createDbMock();
    tx.player.findMany.mockResolvedValue([
      {
        id: 'jack-ginnivan-hawthorn',
        name: 'Jack Ginnivan',
        club: 'Hawthorn',
        position: null,
      },
      {
        id: 'jack_ginnivan',
        name: 'Jack Ginnivan',
        club: 'Hawthorn',
        position: 'FWD',
      },
    ]);
    tx.leagueRosterPlayer.findFirst.mockResolvedValue({
      playerId: 'jack-ginnivan-hawthorn',
      memberId: 'member-2',
    });
    const claimStore = createClaimStoreMock();
    const projection = { projectLeague: vi.fn() };
    const service = new WaiverProcessingService(db as never, claimStore, projection);

    const result = await service.processClaims({
      leagueId: 'league-1',
      waiverSettings: { system: 'PRIORITY' },
      claims: [claim({ playerId: 'jack_ginnivan' })],
    });

    expect(result.results).toEqual([
      { id: 'claim-1', status: 'FAILED', reason: 'Player already owned' },
    ]);
    expect(tx.leagueRosterPlayer.findFirst).toHaveBeenCalledWith({
      where: {
        leagueId: 'league-1',
        playerId: { in: ['jack_ginnivan', 'jack-ginnivan-hawthorn'] },
      },
      select: { playerId: true, memberId: true },
    });
    expect(tx.leagueRosterPlayer.upsert).not.toHaveBeenCalled();
    expect(projection.projectLeague).not.toHaveBeenCalled();
  });

  it('sorts FAAB claims by bid, then waiver priority, then submission time', () => {
    const sorted = sortWaiverClaims(
      [
        claim({
          id: 'late-high-priority',
          userId: 'user-1',
          priority: 1,
          bidAmount: 10,
          createdAt: new Date('2026-06-23T10:03:00.000Z'),
        }),
        claim({
          id: 'higher-bid',
          userId: 'user-2',
          priority: 3,
          bidAmount: 12,
          createdAt: new Date('2026-06-23T10:02:00.000Z'),
        }),
        claim({
          id: 'early-same-bid',
          userId: 'user-3',
          priority: 1,
          bidAmount: 10,
          createdAt: new Date('2026-06-23T10:01:00.000Z'),
        }),
      ],
      { system: 'FAAB' }
    );

    expect(sorted.map((item) => item.id)).toEqual([
      'higher-bid',
      'early-same-bid',
      'late-high-priority',
    ]);
  });

  it('uses team waiver-order rank before a manager claim queue rank', () => {
    const highQueueRankLowWaiverRank = claim({
      id: 'first-queue-third-waiver',
      userId: 'user-1',
      priority: 1,
    }) as WaiverClaim & { waiverPriority: number };
    highQueueRankLowWaiverRank.waiverPriority = 3;

    const lowQueueRankHighWaiverRank = claim({
      id: 'second-queue-first-waiver',
      userId: 'user-2',
      priority: 2,
    }) as WaiverClaim & { waiverPriority: number };
    lowQueueRankHighWaiverRank.waiverPriority = 1;

    const sorted = sortWaiverClaims([highQueueRankLowWaiverRank, lowQueueRankHighWaiverRank], {
      system: 'PRIORITY',
    });

    expect(sorted.map((item) => item.id)).toEqual([
      'second-queue-first-waiver',
      'first-queue-third-waiver',
    ]);
  });

  it('moves the successful team to the bottom before choosing the next pending claim', async () => {
    const { db, tx } = createDbMock();
    tx.league.findUnique.mockResolvedValue({ id: 'league-1', settings: { rosterSize: 10 } });
    tx.leagueRosterPlayer.count.mockResolvedValue(0);
    tx.leagueRoster.findUnique.mockResolvedValue({ id: 'roster-1', playerIds: '[]' });
    tx.player.findMany.mockResolvedValue([
      { id: 'player-1', name: 'Player One', club: 'Test Club', position: 'MID' },
      { id: 'player-2', name: 'Player Two', club: 'Test Club', position: 'FWD' },
      { id: 'player-3', name: 'Player Three', club: 'Test Club', position: 'DEF' },
    ]);
    const claimStore = createClaimStoreMock();
    const projection = { projectLeague: vi.fn().mockResolvedValue({ owned: 3, available: 9 }) };
    const service = new WaiverProcessingService(db as never, claimStore, projection);

    const userOneFirst = claim({
      id: 'user-1-first',
      userId: 'user-1',
      teamId: 'member-1',
      playerId: 'player-1',
      priority: 1,
    }) as WaiverClaim & { waiverPriority: number };
    userOneFirst.waiverPriority = 1;

    const userOneSecond = claim({
      id: 'user-1-second',
      userId: 'user-1',
      teamId: 'member-1',
      playerId: 'player-2',
      priority: 2,
    }) as WaiverClaim & { waiverPriority: number };
    userOneSecond.waiverPriority = 1;

    const userTwoFirst = claim({
      id: 'user-2-first',
      userId: 'user-2',
      teamId: 'member-2',
      playerId: 'player-3',
      priority: 1,
    }) as WaiverClaim & { waiverPriority: number };
    userTwoFirst.waiverPriority = 2;

    const result = await service.processClaims({
      leagueId: 'league-1',
      waiverSettings: { system: 'PRIORITY' },
      claims: [userOneFirst, userOneSecond, userTwoFirst],
    });

    expect(result.results.map((item) => item.id)).toEqual([
      'user-1-first',
      'user-2-first',
      'user-1-second',
    ]);
  });

  it('moves a successful claimant to the end of the rolling waiver order', () => {
    expect(
      buildAdvancedWaiverPriorityUpdates(
        [
          { userId: 'user-1', priority: 1 },
          { userId: 'user-2', priority: 2 },
          { userId: 'user-3', priority: 3 },
        ],
        'user-2'
      )
    ).toEqual([
      { userId: 'user-1', priority: 1 },
      { userId: 'user-3', priority: 2 },
      { userId: 'user-2', priority: 3 },
    ]);
  });
});

describe('PrismaWaiverClaimStore', () => {
  it('loads pending canonical TeamAction waiver claims with Prisma waiver priority state', async () => {
    const createdAt = new Date('2026-06-23T10:00:00.000Z');
    const processingAt = new Date('2026-06-24T10:00:00.000Z');
    const db = {
      teamAction: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'action-1',
            leagueId: 'league-1',
            memberId: 'member-1',
            actionType: 'WAIVER_CLAIM',
            status: 'PENDING',
            details: JSON.stringify({
              playerId: 'free-player',
              dropPlayerId: 'old-player',
              priority: 2,
              bidAmount: 7,
            }),
            processingAt,
            createdAt,
          },
        ]),
      },
      leagueMember: {
        findMany: vi.fn().mockResolvedValue([{ id: 'member-1', userId: 'user-1' }]),
      },
      $queryRaw: vi.fn().mockResolvedValue([
        {
          memberId: 'member-1',
          priority: 4,
          remainingFAAB: 93,
          pendingBidTotal: 7,
        },
      ]),
    };
    const { firestore } = createCompatibilityProjectionMock();
    const store = new PrismaWaiverClaimStore(db as never, firestore as never);

    const claims = await store.loadPendingClaims('league-1');

    expect(db.teamAction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          leagueId: 'league-1',
          actionType: 'WAIVER_CLAIM',
          status: 'PENDING',
        }),
      })
    );
    expect(claims).toEqual([
      expect.objectContaining({
        id: 'action-1',
        leagueId: 'league-1',
        userId: 'user-1',
        teamId: 'member-1',
        playerId: 'free-player',
        dropPlayerId: 'old-player',
        priority: 2,
        waiverPriority: 4,
        bidAmount: 7,
        status: 'PENDING',
        createdAt,
      }),
    ]);
  });

  it('submits a canonical TeamAction claim, reserves pending FAAB, and mirrors to Firestore', async () => {
    const db = {
      leagueMember: {
        findFirst: vi.fn().mockResolvedValue({ id: 'member-1', userId: 'user-1' }),
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: 'member-1', userId: 'user-1', draftSlot: 1, joinedAt: new Date() },
          ]),
      },
      teamAction: {
        create: vi.fn().mockResolvedValue({ id: 'action-1' }),
        update: vi.fn().mockResolvedValue({ id: 'action-1' }),
      },
      $queryRaw: vi
        .fn()
        .mockResolvedValue([
          { memberId: 'member-1', priority: 1, remainingFAAB: 100, pendingBidTotal: 7 },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ memberId: 'member-1', finalPick: 1 }])
        .mockResolvedValueOnce([{ memberId: 'member-1', remainingFAAB: 100, pendingBidTotal: 0 }]),
      $executeRaw: vi.fn().mockResolvedValue(1),
      $transaction: vi.fn((work: (client: unknown) => Promise<unknown>) => work(db)),
    };
    const { firestore, waiverDoc, activityDoc } = createCompatibilityProjectionMock();
    const store = new PrismaWaiverClaimStore(db as never, firestore as never);

    const result = await store.submitClaim({
      leagueId: 'league-1',
      userId: 'user-1',
      teamId: 'member-1',
      playerId: 'free-player',
      dropPlayerId: 'old-player',
      priority: 2,
      bidAmount: 7,
      waiverSettings: { system: 'FAAB', faabBudget: 100 },
    });

    expect(result.id).toBe('action-1');
    expect(db.teamAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leagueId: 'league-1',
          memberId: 'member-1',
          actionType: 'WAIVER_CLAIM',
          details: expect.stringContaining('"playerId":"free-player"'),
        }),
      })
    );
    expect(db.$executeRaw).toHaveBeenCalled();
    expect(waiverDoc.set).toHaveBeenCalledWith(
      expect.objectContaining({
        leagueId: 'league-1',
        userId: 'user-1',
        teamId: 'member-1',
        playerId: 'free-player',
        canonicalActionId: 'action-1',
        status: 'PENDING',
      })
    );
    expect(firestore.doc).toHaveBeenCalledWith('leagues/league-1/waiverPriorities/user-1');
    expect(activityDoc.set).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'waiver-submitted',
        claimId: 'action-1',
      })
    );
  });

  it('seeds missing canonical waiver priorities from reverse final draft pick order', async () => {
    const joinedAt = new Date('2026-06-01T00:00:00.000Z');
    const db = {
      leagueMember: {
        findFirst: vi.fn().mockResolvedValue({ id: 'member-2', userId: 'user-2' }),
        findMany: vi.fn().mockResolvedValue([
          { id: 'member-1', userId: 'user-1', draftSlot: 1, joinedAt },
          { id: 'member-2', userId: 'user-2', draftSlot: 2, joinedAt },
        ]),
      },
      teamAction: {
        create: vi.fn().mockResolvedValue({ id: 'action-1' }),
        update: vi.fn().mockResolvedValue({ id: 'action-1' }),
      },
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { memberId: 'member-2', finalPick: 4 },
          { memberId: 'member-1', finalPick: 3 },
        ])
        .mockResolvedValue([
          { memberId: 'member-2', priority: 1, remainingFAAB: null, pendingBidTotal: 0 },
          { memberId: 'member-1', priority: 2, remainingFAAB: null, pendingBidTotal: 0 },
        ]),
      $executeRaw: vi.fn().mockResolvedValue(1),
      $transaction: vi.fn((work: (client: unknown) => Promise<unknown>) => work(db)),
    };
    const { firestore, waiverDoc, activityDoc } = createCompatibilityProjectionMock();
    const store = new PrismaWaiverClaimStore(db as never, firestore as never);

    await store.submitClaim({
      leagueId: 'league-1',
      userId: 'user-2',
      teamId: 'member-2',
      playerId: 'free-player',
      priority: 1,
      waiverSettings: { system: 'PRIORITY' },
    });

    expect(db.$executeRaw).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.any(String),
      'league-1',
      'member-2',
      1,
      null,
      expect.any(Date),
      expect.any(Date)
    );
    expect(db.$executeRaw).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.any(String),
      'league-1',
      'member-1',
      2,
      null,
      expect.any(Date),
      expect.any(Date)
    );
    expect(waiverDoc.set).toHaveBeenCalledWith(expect.objectContaining({ teamId: 'member-2' }));
    expect(activityDoc.set).toHaveBeenCalledWith(expect.objectContaining({ claimId: 'action-1' }));
  });

  it('updates canonical status and mirrors successful processing to Firestore', async () => {
    const db = {
      teamAction: {
        update: vi.fn().mockResolvedValue({ id: 'action-1' }),
      },
    };
    const { firestore, waiverDoc } = createCompatibilityProjectionMock();
    const store = new PrismaWaiverClaimStore(db as never, firestore as never);

    await store.markSuccessful({
      leagueId: 'league-1',
      claimId: 'action-1',
      claim: claim({ id: 'action-1' }),
    });

    expect(db.teamAction.update).toHaveBeenCalledWith({
      where: { id: 'action-1' },
      data: expect.objectContaining({
        status: 'PROCESSED',
        processedAt: expect.any(Date),
      }),
    });
    expect(waiverDoc.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'SUCCESSFUL',
        processedAt: expect.any(Date),
      })
    );
  });

  it('cancels canonical pending claims and releases reserved FAAB before mirroring cancellation', async () => {
    const db = {
      leagueMember: {
        findFirst: vi.fn().mockResolvedValue({ id: 'member-1', userId: 'user-1' }),
      },
      teamAction: {
        update: vi.fn().mockResolvedValue({ id: 'action-1' }),
      },
      $queryRaw: vi
        .fn()
        .mockResolvedValue([
          { memberId: 'member-1', priority: 1, remainingFAAB: 100, pendingBidTotal: 0 },
        ]),
      $executeRaw: vi.fn().mockResolvedValue(1),
      $transaction: vi.fn((work: (client: unknown) => Promise<unknown>) => work(db)),
    };
    const { firestore, waiverDoc } = createCompatibilityProjectionMock();
    const store = new PrismaWaiverClaimStore(db as never, firestore as never);

    await store.cancelPendingClaim({
      leagueId: 'league-1',
      claimId: 'action-1',
      claim: claim({ id: 'action-1', bidAmount: 7 }),
      cancelledBy: 'user-1',
    });

    expect(db.teamAction.update).toHaveBeenCalledWith({
      where: { id: 'action-1' },
      data: expect.objectContaining({
        status: 'CANCELLED',
        processedAt: expect.any(Date),
      }),
    });
    expect(db.$executeRaw).toHaveBeenCalled();
    expect(waiverDoc.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'CANCELLED',
        cancelledBy: 'user-1',
        cancelledAt: expect.any(Date),
      })
    );
  });
});
