import {
  DraftDirection,
  DraftStatus,
  DraftType,
  LeagueRole,
  PickOrder,
  WaiverRule,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { ensureLeagueDraftSetupConverged } from '@/server/draft/services/DraftSetupConvergenceService';

vi.mock('@/lib/prisma', () => ({
  prisma: {},
}));

function buildSettings(startAt: Date) {
  return {
    id: 'settings-1',
    rosterSize: 13,
    benchSize: 4,
    maxTeams: 12,
    pickSeconds: 120,
    allowAutoPick: true,
    draftType: DraftType.SNAKE,
    pickOrder: PickOrder.RANDOM,
    waiverRule: WaiverRule.WEEKLY,
    positionLimitsJson: JSON.stringify({ DEF: 5, MID: 4, RUC: 1, FWD: 3, BENCH: 4 }),
    startAt,
    timeZone: 'Australia/Melbourne',
    locked: false,
  };
}

function buildMembers() {
  return [1, 2].map((slot) => ({
    id: `member-${slot}`,
    leagueId: 'league-1',
    userId: `user-${slot}`,
    role: LeagueRole.MANAGER,
    teamName: `Team ${slot}`,
    draftSlot: slot,
    isActive: true,
    status: 'ACTIVE',
    joinedAt: new Date('2026-05-01T00:00:00.000Z'),
  }));
}

function buildLeagueWithDraft(startAt: Date) {
  const members = buildMembers();
  const draft = {
    id: 'draft-1',
    leagueId: 'league-1',
    status: DraftStatus.SCHEDULED,
    currentPick: 1,
    totalPicks: 34,
    round: 1,
    direction: DraftDirection.FORWARD,
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    startedAt: null,
    completedAt: null,
    schedulingVersion: 0,
    lobbyStatus: 'COUNTDOWN',
    lobbyOpenAt: new Date('2026-05-01T00:00:00.000Z'),
    picks: [],
    orders: members.map((member) => ({
      id: `order-${member.id}`,
      draftId: 'draft-1',
      slot: member.draftSlot ?? 1,
      memberId: member.id,
    })),
  };

  return {
    id: 'league-1',
    name: 'AFL Legends',
    inviteCode: '1D3XOXC7',
    ownerId: 'user-1',
    settingsId: 'settings-1',
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    settings: buildSettings(startAt),
    members,
    drafts: [draft],
  };
}

describe('ensureLeagueDraftSetupConverged', () => {
  it('creates the missing room and recommends explicit start for an overdue ready draft', async () => {
    const startAt = new Date('2026-05-02T00:00:00.000Z');
    const members = buildMembers();
    const tx = {
      league: {
        findUnique: vi.fn().mockResolvedValue({
          ...buildLeagueWithDraft(startAt),
          members,
          drafts: [],
        }),
      },
      draft: {
        create: vi.fn().mockResolvedValue({
          id: 'draft-1',
          leagueId: 'league-1',
          status: DraftStatus.SCHEDULED,
          currentPick: 1,
          totalPicks: 34,
          round: 1,
          direction: DraftDirection.FORWARD,
          createdAt: new Date('2026-05-02T00:00:00.000Z'),
          startedAt: null,
          completedAt: null,
          schedulingVersion: 0,
          lobbyStatus: 'COUNTDOWN',
          lobbyOpenAt: new Date('2026-05-02T00:05:00.000Z'),
        }),
      },
      draftOrder: {
        create: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      player: {
        count: vi.fn().mockResolvedValue(100),
        groupBy: vi.fn().mockResolvedValue([
          { position: 'DEF', _count: { _all: 50 } },
          { position: 'MID', _count: { _all: 50 } },
          { position: 'RUC', _count: { _all: 50 } },
          { position: 'FWD', _count: { _all: 50 } },
        ]),
      },
    };

    const client = {
      $transaction: vi.fn((work) => work(tx)),
      league: {
        findUnique: vi.fn().mockResolvedValue(buildLeagueWithDraft(startAt)),
      },
      player: {
        count: vi.fn().mockResolvedValue(100),
        groupBy: vi.fn().mockResolvedValue([
          { position: 'DEF', _count: { _all: 50 } },
          { position: 'MID', _count: { _all: 50 } },
          { position: 'RUC', _count: { _all: 50 } },
          { position: 'FWD', _count: { _all: 50 } },
        ]),
      },
    };
    const readiness = await ensureLeagueDraftSetupConverged({
      prismaClient: client as never,
      leagueId: 'league-1',
      now: new Date('2026-05-02T00:05:00.000Z'),
    });

    expect(tx.draft.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leagueId: 'league-1',
          status: DraftStatus.SCHEDULED,
          lobbyStatus: 'COUNTDOWN',
        }),
      })
    );
    expect(tx.draftOrder.create).toHaveBeenCalledTimes(2);
    expect(readiness.recommendedAction).toBe('AWAIT_EXPLICIT_START');
    expect(readiness.lifecycle.canEnterRoom).toBe(true);
  });

  it('updates an existing draft totalPicks when roster settings change', async () => {
    const startAt = new Date('2026-05-02T00:00:00.000Z');
    const members = buildMembers();
    const staleDraft = {
      ...buildLeagueWithDraft(startAt).drafts[0],
      totalPicks: 2,
      orders: members.map((member) => ({
        id: `order-${member.id}`,
        draftId: 'draft-1',
        slot: member.draftSlot ?? 1,
        memberId: member.id,
      })),
    };
    const convergedLeague = {
      ...buildLeagueWithDraft(startAt),
      settings: {
        ...buildSettings(startAt),
        rosterSize: 2,
        benchSize: 0,
        positionLimitsJson: JSON.stringify({ DEF: 2, MID: 0, RUC: 0, FWD: 0, BENCH: 0 }),
      },
      members,
      drafts: [{ ...staleDraft, totalPicks: 4 }],
    };
    const tx = {
      league: {
        findUnique: vi.fn().mockResolvedValue({
          ...convergedLeague,
          drafts: [staleDraft],
        }),
      },
      draft: {
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({ ...staleDraft, totalPicks: 4 }),
      },
      draftOrder: {
        create: vi.fn(),
        deleteMany: vi.fn(),
      },
      player: {
        count: vi.fn().mockResolvedValue(100),
        groupBy: vi.fn().mockResolvedValue([
          { position: 'DEF', _count: { _all: 50 } },
          { position: 'MID', _count: { _all: 50 } },
          { position: 'RUC', _count: { _all: 50 } },
          { position: 'FWD', _count: { _all: 50 } },
        ]),
      },
    };

    const client = {
      $transaction: vi.fn((work) => work(tx)),
      league: {
        findUnique: vi.fn().mockResolvedValue(convergedLeague),
      },
      player: {
        count: vi.fn().mockResolvedValue(100),
        groupBy: vi.fn().mockResolvedValue([
          { position: 'DEF', _count: { _all: 50 } },
          { position: 'MID', _count: { _all: 50 } },
          { position: 'RUC', _count: { _all: 50 } },
          { position: 'FWD', _count: { _all: 50 } },
        ]),
      },
    };

    const readiness = await ensureLeagueDraftSetupConverged({
      prismaClient: client as never,
      leagueId: 'league-1',
      now: new Date('2026-05-02T00:05:00.000Z'),
    });

    expect(tx.draft.update).toHaveBeenCalledWith({
      where: { id: 'draft-1' },
      data: { totalPicks: 4 },
    });
    expect(tx.draftOrder.deleteMany).not.toHaveBeenCalled();
    expect(readiness.totalPicks).toBe(4);
  });

  it('does not rewrite the draft order of a live draft when the member count drifts', async () => {
    const startAt = new Date('2026-05-02T00:00:00.000Z');
    const league = buildLeagueWithDraft(startAt);
    const liveDraft = {
      ...league.drafts[0],
      status: DraftStatus.LIVE,
      currentPick: 5,
      startedAt: new Date('2026-05-02T00:00:00.000Z'),
      orders: [
        ...league.drafts[0].orders,
        { id: 'order-left', draftId: 'draft-1', slot: 3, memberId: 'member-left' },
      ],
    };
    const { tx, client } = buildConvergenceMocks({ ...league, drafts: [liveDraft] });

    await ensureLeagueDraftSetupConverged({
      prismaClient: client as never,
      leagueId: 'league-1',
      now: new Date('2026-05-02T00:05:00.000Z'),
    });

    expect(tx.draftOrder.deleteMany).not.toHaveBeenCalled();
    expect(tx.draftOrder.create).not.toHaveBeenCalled();
    expect(tx.draft.update).not.toHaveBeenCalled();
  });

  it('leaves a declined member with an active flag out of the draft order', async () => {
    const startAt = new Date('2026-05-02T00:00:00.000Z');
    const league = buildLeagueWithDraft(startAt);
    const members = [
      ...buildMembers(),
      {
        ...buildMembers()[0],
        id: 'member-declined',
        userId: 'user-declined',
        draftSlot: 3,
        status: 'declined',
      },
    ];
    const { tx, client } = buildConvergenceMocks({ ...league, members, drafts: [] });

    await ensureLeagueDraftSetupConverged({
      prismaClient: client as never,
      leagueId: 'league-1',
      now: new Date('2026-05-02T00:05:00.000Z'),
    });

    const memberIds = tx.draftOrder.create.mock.calls.map((call) => call[0].data.memberId);
    expect(memberIds).toEqual(['member-1', 'member-2']);
  });

  it('gives a member without a draft slot a slot no other member holds', async () => {
    const startAt = new Date('2026-05-02T00:00:00.000Z');
    const league = buildLeagueWithDraft(startAt);
    // Postgres sorts NULL draftSlot last, so the owner comes after the joiners, as in the real query.
    const members = [
      { ...buildMembers()[0], id: 'member-joiner-2', draftSlot: 2 },
      { ...buildMembers()[0], id: 'member-joiner-3', draftSlot: 3 },
      { ...buildMembers()[0], id: 'member-owner', draftSlot: null },
    ];
    const { tx, client } = buildConvergenceMocks({ ...league, members, drafts: [] });

    await ensureLeagueDraftSetupConverged({
      prismaClient: client as never,
      leagueId: 'league-1',
      now: new Date('2026-05-02T00:05:00.000Z'),
    });

    const slots = tx.draftOrder.create.mock.calls.map((call) => call[0].data.slot);
    expect(slots).toEqual([2, 3, 1]);
  });
});

function buildConvergenceMocks(league: Record<string, unknown>) {
  const positionCounts = [
    { position: 'DEF', _count: { _all: 50 } },
    { position: 'MID', _count: { _all: 50 } },
    { position: 'RUC', _count: { _all: 50 } },
    { position: 'FWD', _count: { _all: 50 } },
  ];
  const tx = {
    league: { findUnique: vi.fn().mockResolvedValue(league) },
    draft: {
      create: vi
        .fn()
        .mockResolvedValue({ ...buildLeagueWithDraft(new Date()).drafts[0], id: 'draft-new' }),
      update: vi.fn().mockResolvedValue({}),
    },
    draftOrder: {
      create: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    player: {
      count: vi.fn().mockResolvedValue(100),
      groupBy: vi.fn().mockResolvedValue(positionCounts),
    },
  };
  const client = {
    $transaction: vi.fn((work) => work(tx)),
    league: { findUnique: vi.fn().mockResolvedValue(league) },
    player: {
      count: vi.fn().mockResolvedValue(100),
      groupBy: vi.fn().mockResolvedValue(positionCounts),
    },
  };
  return { tx, client };
}
