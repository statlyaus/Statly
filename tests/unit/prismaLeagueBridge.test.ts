import { describe, expect, it, vi } from 'vitest';
import { DraftType, LeagueRole } from '@prisma/client';

vi.mock('../../src/lib/firebaseAdmin', () => ({
  adminDb: {},
}));

vi.mock('../../src/lib/prisma', () => ({
  prisma: {},
}));

import {
  buildExternalUserEmail,
  loadFirestoreLeagueMirrorSnapshot,
  normalizeDraftTypeForPrisma,
  normalizeLeagueRoleForPrisma,
  syncPrismaLeagueMember,
  upsertPrismaLeagueMirror,
  type PrismaLeagueMirrorSnapshot,
} from '../../src/lib/prismaLeagueBridge';

function snap(docs: Array<{ id: string; data: Record<string, unknown> }>) {
  return {
    docs: docs.map((doc) => ({
      id: doc.id,
      data: () => doc.data,
    })),
  };
}

function buildFirestoreMock(input: {
  league: Record<string, unknown>;
  topLevelMembers?: Array<{ id: string; data: Record<string, unknown> }>;
  embeddedMembers?: Array<{ id: string; data: Record<string, unknown> }>;
}) {
  const leagueRef = {
    get: vi.fn().mockResolvedValue({
      exists: true,
      data: () => input.league,
    }),
    collection: vi.fn(() => ({
      get: vi.fn().mockResolvedValue(snap(input.embeddedMembers ?? [])),
    })),
  };

  const leagueMembersQuery = {
    get: vi.fn().mockResolvedValue(snap(input.topLevelMembers ?? [])),
  };

  const leagueMembersCollection = {
    where: vi.fn(() => leagueMembersQuery),
  };

  return {
    collection: vi.fn((name: string) => {
      if (name === 'leagues') {
        return { doc: vi.fn(() => leagueRef) };
      }
      if (name === 'leagueMembers') {
        return leagueMembersCollection;
      }
      throw new Error(`Unexpected collection ${name}`);
    }),
  };
}

function buildTx(overrides: Record<string, unknown> = {}) {
  const tx = {
    league: {
      findUnique: vi.fn(async ({ where }: { where: Record<string, string> }) => {
        if (where.id) return null;
        if (where.inviteCode) return null;
        return null;
      }),
      create: vi.fn(async (args) => args.data),
      update: vi.fn(async (args) => args.data),
    },
    leagueSettings: {
      create: vi.fn(async () => ({ id: 'settings-1' })),
      update: vi.fn(async (args) => args.data),
    },
    user: {
      upsert: vi.fn(async (args) => args.create),
    },
    leagueMember: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      create: vi.fn(async (args) => args.data),
      update: vi.fn(async (args) => args.data),
      updateMany: vi.fn(async () => ({ count: 1 })),
      delete: vi.fn(async (args) => args.where),
    },
    draftOrder: { count: vi.fn(async () => 0) },
    pick: { count: vi.fn(async () => 0) },
    draftWatchlist: { count: vi.fn(async () => 0) },
    preDraftQueue: { count: vi.fn(async () => 0) },
    lobbyActivity: { count: vi.fn(async () => 0) },
    ...overrides,
  };

  return tx;
}

function buildPrismaClient(tx: Record<string, unknown>) {
  return {
    $transaction: vi.fn(async (callback: (_transaction: typeof tx) => unknown) => callback(tx)),
  };
}

describe('prismaLeagueBridge', () => {
  it('normalizes Firestore roles, draft types, and external user emails deterministically', () => {
    expect(normalizeDraftTypeForPrisma('linear')).toBe(DraftType.LINEAR);
    expect(normalizeDraftTypeForPrisma('snake')).toBe(DraftType.SNAKE);
    expect(normalizeLeagueRoleForPrisma('owner', 'user-1', 'user-1')).toBe(LeagueRole.OWNER);
    expect(normalizeLeagueRoleForPrisma('member', 'user-2', 'user-1')).toBe(LeagueRole.MANAGER);
    expect(buildExternalUserEmail('firebase-user')).toBe(buildExternalUserEmail('firebase-user'));
    expect(buildExternalUserEmail('firebase-user')).toMatch(
      /^firebase_[a-f0-9]{20}@statly\.local$/
    );
  });

  it('loads active top-level memberships as the Prisma mirror source', async () => {
    const firestore = buildFirestoreMock({
      league: {
        name: 'Statly League',
        code: 'ABC12345',
        ownerId: 'owner-user',
        maxTeams: 10,
        draftType: 'linear',
      },
      topLevelMembers: [
        {
          id: 'inactive-member',
          data: {
            leagueId: 'league-1',
            userId: 'inactive-user',
            teamName: 'Inactive',
            isActive: false,
          },
        },
        {
          id: 'owner-member',
          data: {
            leagueId: 'league-1',
            userId: 'owner-user',
            role: 'owner',
            teamName: 'Owner Team',
            draftSlot: 1,
            isActive: true,
          },
        },
      ],
      embeddedMembers: [
        {
          id: 'embedded-user',
          data: {
            userId: 'embedded-user',
            role: 'member',
            teamName: 'Embedded Team',
            isActive: true,
          },
        },
      ],
    });

    const snapshot = await loadFirestoreLeagueMirrorSnapshot(
      {
        leagueId: 'league-1',
        timePerPick: 90,
        scheduledStartTime: new Date('2026-06-01T00:00:00.000Z'),
      },
      firestore as never
    );

    expect(snapshot).toMatchObject({
      leagueId: 'league-1',
      name: 'Statly League',
      inviteCode: 'ABC12345',
      ownerId: 'owner-user',
      maxTeams: 10,
      draftType: DraftType.LINEAR,
      pickSeconds: 90,
      allowAutoPick: true,
      positionLimitsJson: JSON.stringify({ DEF: 5, MID: 7, RUC: 2, FWD: 4, BENCH: 4 }),
      autoPickRulesJson: JSON.stringify({ enabled: true, strategy: 'queue-first' }),
      members: [
        {
          id: 'owner-member',
          userId: 'owner-user',
          role: 'owner',
          teamName: 'Owner Team',
          draftSlot: 1,
        },
      ],
    });
  });

  it('creates a Prisma mirror with stable league, user, and member identities', async () => {
    const tx = buildTx();
    const client = buildPrismaClient(tx);
    const snapshot: PrismaLeagueMirrorSnapshot = {
      leagueId: 'league-1',
      name: 'Statly League',
      inviteCode: 'ABC12345',
      ownerId: 'owner-user',
      maxTeams: 8,
      draftType: DraftType.LINEAR,
      pickOrder: 'RANDOM',
      waiverRule: 'WEEKLY',
      startAt: new Date('2026-06-01T00:00:00.000Z'),
      timeZone: 'Australia/Melbourne',
      pickSeconds: 90,
      allowAutoPick: false,
      positionLimitsJson: JSON.stringify({ DEF: 6, MID: 8, RUC: 2, FWD: 6, BENCH: 4 }),
      autoPickRulesJson: JSON.stringify({ enabled: false, strategy: 'best-available' }),
      members: [
        {
          id: 'owner-member',
          leagueId: 'league-1',
          userId: 'owner-user',
          role: 'owner',
          teamName: 'Owner Team',
          draftSlot: 1,
          isActive: true,
        },
        {
          id: 'member-2',
          leagueId: 'league-1',
          userId: 'member-user',
          role: 'member',
          teamName: 'Member Team',
          draftSlot: 2,
          isActive: true,
        },
      ],
    };

    const result = await upsertPrismaLeagueMirror(snapshot, client as never);

    expect(result).toEqual({
      leagueId: 'league-1',
      activeMemberCount: 2,
      mirroredMemberIds: ['owner-member', 'member-2'],
    });
    expect(tx.league.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'league-1',
        inviteCode: 'ABC12345',
        ownerId: 'owner-user',
        settingsId: 'settings-1',
      }),
    });
    expect(tx.user.upsert).toHaveBeenCalledTimes(2);
    expect(tx.leagueMember.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'owner-member',
        userId: 'owner-user',
        role: LeagueRole.OWNER,
      }),
    });
    expect(tx.leagueMember.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'member-2',
        userId: 'member-user',
        role: LeagueRole.MANAGER,
      }),
    });
  });

  it('does not delete a Prisma member that already has draft dependencies', async () => {
    const tx = buildTx({
      league: {
        findUnique: vi.fn(async () => ({ id: 'league-1', ownerId: 'owner-user' })),
      },
      leagueMember: {
        findFirst: vi.fn(async () => ({ id: 'member-2', userId: 'member-user' })),
        delete: vi.fn(),
      },
      draftOrder: { count: vi.fn(async () => 1) },
      pick: { count: vi.fn(async () => 0) },
      draftWatchlist: { count: vi.fn(async () => 0) },
      preDraftQueue: { count: vi.fn(async () => 0) },
      lobbyActivity: { count: vi.fn(async () => 0) },
    });
    const client = buildPrismaClient(tx);

    const result = await syncPrismaLeagueMember(
      {
        leagueId: 'league-1',
        userId: 'member-user',
        isActive: false,
      },
      { prisma: client as never }
    );

    expect(result).toEqual({
      synced: false,
      reason: 'member-has-draft-dependencies',
    });
    expect(tx.leagueMember.delete).not.toHaveBeenCalled();
  });
});
