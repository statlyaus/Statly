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
    startAt,
    timeZone: 'Australia/Melbourne',
    locked: false,
    enableCaptainSystem: false,
    captainMultiplier: 2,
    viceCaptainMultiplier: 1.5,
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
    };

    const client = {
      $transaction: vi.fn((work) => work(tx)),
      league: {
        findUnique: vi.fn().mockResolvedValue(buildLeagueWithDraft(startAt)),
      },
      player: {
        count: vi.fn().mockResolvedValue(100),
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
    };

    const client = {
      $transaction: vi.fn((work) => work(tx)),
      league: {
        findUnique: vi.fn().mockResolvedValue(convergedLeague),
      },
      player: {
        count: vi.fn().mockResolvedValue(100),
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
});
