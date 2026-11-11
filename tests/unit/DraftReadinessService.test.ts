import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DraftDirection,
  DraftStatus,
  DraftType,
  LeagueRole,
  PickOrder,
  WaiverRule,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { getLeagueDraftOperationalReadiness } from '@/server/draft/services/DraftReadinessService';

vi.mock('@/lib/prisma', () => ({
  prisma: {},
}));

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

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
  };
}

function buildMember(id: string, draftSlot: number) {
  return {
    id,
    leagueId: 'league-1',
    userId: `user-${draftSlot}`,
    role: LeagueRole.MANAGER,
    teamName: `Team ${draftSlot}`,
    draftSlot,
    joinedAt: new Date('2026-05-01T00:00:00.000Z'),
    isActive: true,
    status: 'active',
  };
}

function buildClient(input: {
  startAt: Date;
  availablePlayers: number;
  draftStatus?: DraftStatus;
  lobbyStatus?: string;
  lobbyOpenAt?: Date | null;
}) {
  const members = [buildMember('member-1', 1), buildMember('member-2', 2)];
  const draft = {
    id: 'draft-1',
    leagueId: 'league-1',
    status: input.draftStatus ?? DraftStatus.SCHEDULED,
    currentPick: 1,
    totalPicks: 34,
    round: 1,
    direction: DraftDirection.FORWARD,
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    startedAt: null,
    completedAt: null,
    schedulingVersion: 0,
    lobbyStatus: input.lobbyStatus ?? 'COUNTDOWN',
    lobbyOpenAt:
      input.lobbyOpenAt === undefined ? new Date('2026-05-01T00:00:00.000Z') : input.lobbyOpenAt,
    orders: members.map((member) => ({
      id: `order-${member.id}`,
      draftId: 'draft-1',
      slot: member.draftSlot ?? 1,
      memberId: member.id,
    })),
  };

  return {
    league: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'league-1',
        name: 'AFL Legends',
        inviteCode: '1D3XOXC7',
        ownerId: 'user-1',
        settingsId: 'settings-1',
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
        settings: buildSettings(input.startAt),
        members,
        drafts: [draft],
      }),
    },
    player: {
      count: vi.fn().mockResolvedValue(input.availablePlayers),
      groupBy: vi.fn().mockResolvedValue([
        { position: 'DEF', _count: { _all: 50 } },
        { position: 'MID', _count: { _all: 50 } },
        { position: 'RUC', _count: { _all: 50 } },
        { position: 'FWD', _count: { _all: 50 } },
      ]),
    },
  };
}

describe('getLeagueDraftOperationalReadiness', () => {
  it('keeps a future scheduled draft out of the room before the lobby opens', async () => {
    const readiness = await getLeagueDraftOperationalReadiness(
      buildClient({
        startAt: new Date('2026-05-02T00:00:00.000Z'),
        availablePlayers: 100,
        lobbyStatus: 'CLOSED',
        lobbyOpenAt: null,
      }) as any,
      {
        leagueId: 'league-1',
        now: new Date('2026-05-01T23:30:00.000Z'),
      }
    );

    expect(readiness.status).toBe('scheduled');
    expect(readiness.draftId).toBe('draft-1');
    expect(readiness.lifecycle.canEnterRoom).toBe(false);
    expect(readiness.lifecycle.canStartClock).toBe(false);
    expect(readiness.blockers).toEqual([]);
  });

  it('opens the room for a scheduled draft whose lobby is open before its start', async () => {
    const readiness = await getLeagueDraftOperationalReadiness(
      buildClient({
        startAt: new Date('2026-05-02T00:00:00.000Z'),
        availablePlayers: 100,
        lobbyStatus: 'OPEN',
        lobbyOpenAt: new Date('2026-05-01T00:00:00.000Z'),
      }) as any,
      {
        leagueId: 'league-1',
        now: new Date('2026-05-01T23:30:00.000Z'),
      }
    );

    expect(readiness.status).toBe('room_open');
    expect(readiness.lifecycle.canEnterRoom).toBe(true);
  });

  it('marks an overdue scheduled draft as enterable and startable', async () => {
    const readiness = await getLeagueDraftOperationalReadiness(
      buildClient({
        startAt: new Date('2026-05-02T00:00:00.000Z'),
        availablePlayers: 100,
      }) as any,
      {
        leagueId: 'league-1',
        now: new Date('2026-05-02T00:05:00.000Z'),
      }
    );

    expect(readiness.status).toBe('room_open');
    expect(readiness.draftId).toBe('draft-1');
    expect(readiness.lifecycle.canEnterRoom).toBe(true);
    expect(readiness.lifecycle.canStartClock).toBe(true);
    expect(readiness.blockers).toEqual([]);
  });

  it('reports an empty player pool as an operational blocker', async () => {
    const readiness = await getLeagueDraftOperationalReadiness(
      buildClient({
        startAt: new Date('2026-05-02T00:00:00.000Z'),
        availablePlayers: 0,
      }) as any,
      {
        leagueId: 'league-1',
        now: new Date('2026-05-02T00:05:00.000Z'),
      }
    );

    expect(readiness.status).toBe('blocked');
    expect(readiness.lifecycle.canStartClock).toBe(false);
    expect(readiness.blockers).toContainEqual({
      id: 'player_pool_empty',
      code: 'player_pool_empty',
      message: 'No active players are available for this draft.',
    });
  });

  it('assigns stable identities to repeated positional shortage blockers', async () => {
    const client = buildClient({
      startAt: new Date('2026-05-02T00:00:00.000Z'),
      availablePlayers: 100,
    });
    client.player.groupBy.mockResolvedValue([
      { position: 'DEF', _count: { _all: 1 } },
      { position: 'MID', _count: { _all: 1 } },
      { position: 'RUC', _count: { _all: 1 } },
      { position: 'FWD', _count: { _all: 1 } },
    ]);

    const readiness = await getLeagueDraftOperationalReadiness(client as any, {
      leagueId: 'league-1',
      now: new Date('2026-05-02T00:05:00.000Z'),
    });
    const positionBlockers = readiness.blockers.filter(
      (blocker) => blocker.code === 'position_pool_shortage'
    );

    expect(positionBlockers).toHaveLength(4);
    expect(positionBlockers.map((blocker) => blocker.id)).toEqual([
      'position_pool_shortage:DEF',
      'position_pool_shortage:MID',
      'position_pool_shortage:RUC',
      'position_pool_shortage:FWD',
    ]);
  });

  it('keeps lobby read paths free of lifecycle writes', () => {
    const lobbySource = read('src/lib/draftLobby.ts');
    const convergenceSource = read('src/server/draft/services/DraftSetupConvergenceService.ts');

    expect(lobbySource).not.toContain('auto-open');
    expect(convergenceSource).not.toContain('startDraft(');
    expect(convergenceSource).not.toContain('currentPickDeadline');
  });
});

describe('Bloodsucker draft readiness (BR-02, BR-06)', () => {
  async function readinessFor(
    input: { leagueFormat: string; bloodsuckerMemberId: string | null },
    memberStatus: Record<string, string> = {}
  ) {
    const client = buildClient({
      startAt: new Date('2026-05-02T00:00:00.000Z'),
      availablePlayers: 100,
    });
    const league = await client.league.findUnique();
    client.league.findUnique.mockResolvedValue({
      ...league,
      settings: { ...league.settings, ...input },
      members: league.members.map((member: { id: string; status: string }) => ({
        ...member,
        status: memberStatus[member.id] ?? member.status,
      })),
    });
    return getLeagueDraftOperationalReadiness(client as any, {
      leagueId: 'league-1',
      now: new Date('2026-05-02T00:05:00.000Z'),
    });
  }

  it('blocks the start with "Choose a Bloodsucker" and the 8-team minimum', async () => {
    const readiness = await readinessFor({
      leagueFormat: 'BLOODSUCKER',
      bloodsuckerMemberId: null,
    });

    expect(readiness.status).toBe('blocked');
    expect(readiness.lifecycle.canStartClock).toBe(false);
    expect(readiness.lifecycle.canEnterRoom).toBe(false);
    expect(readiness.blockers.map((blocker) => blocker.message)).toEqual([
      'Choose a Bloodsucker.',
      'A Bloodsucker league needs at least 8 teams (12 recommended).',
    ]);
  });

  it('blocks again once the chosen Bloodsucker is no longer an active member', async () => {
    const readiness = await readinessFor({
      leagueFormat: 'BLOODSUCKER',
      bloodsuckerMemberId: 'member-gone',
    });

    expect(readiness.blockers.map((blocker) => blocker.code)).toContain('bloodsucker_missing');
  });

  it('treats a removed member as gone, as the draft-start guard does', async () => {
    const readiness = await readinessFor(
      { leagueFormat: 'BLOODSUCKER', bloodsuckerMemberId: 'member-2' },
      { 'member-2': 'removed' }
    );

    expect(readiness.blockers.map((blocker) => blocker.code)).toContain('bloodsucker_missing');
  });

  it('adds no format blocker to a standard league', async () => {
    const readiness = await readinessFor({ leagueFormat: 'STANDARD', bloodsuckerMemberId: null });

    expect(readiness.blockers).toEqual([]);
  });
});
