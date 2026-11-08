import { DraftType, LeagueRole, PickOrder, WaiverRule } from '@prisma/client';
import type { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({ getUserIdFromRequest: vi.fn() }));

// The league exists only in Prisma. Any Firestore read would mean Firestore is deciding.
vi.mock('@/lib/firebaseAdmin', () => {
  const unexpected = () => {
    throw new Error('Unexpected Firestore access for a Prisma league');
  };
  return {
    adminDb: { collection: unexpected, collectionGroup: unexpected, doc: unexpected },
  };
});
vi.mock('@/lib/serverAuth', () => authMocks);
vi.mock('@/lib/requestTracing', () => ({
  withRequestTracing: () => ({ complete: vi.fn(), error: vi.fn() }),
}));

import { GET } from '@/app/api/leagues/[id]/members/route';
import { prisma } from '@/lib/prisma';

const FIXTURE = {
  leagueId: 'integration-members-route-league',
  settingsId: 'integration-members-route-settings',
} as const;
const [ownerUserId, managerUserId, outsiderUserId] = ['owner', 'manager', 'outsider'].map(
  (name) => `integration-members-route-${name}`
);

async function removeFixture(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.leagueMember.deleteMany({ where: { leagueId: FIXTURE.leagueId } });
    await tx.league.deleteMany({ where: { id: FIXTURE.leagueId } });
    await tx.leagueSettings.deleteMany({ where: { id: FIXTURE.settingsId } });
    await tx.user.deleteMany({
      where: { id: { in: [ownerUserId, managerUserId, outsiderUserId] } },
    });
  });
}

async function seedFixture(): Promise<void> {
  const now = new Date('2026-05-31T00:00:00.000Z');
  await prisma.$transaction(async (tx) => {
    await tx.user.createMany({
      data: [ownerUserId, managerUserId, outsiderUserId].map((id) => ({
        id,
        email: `${id}@statly.local`,
        passwordHash: 'integration-only',
        displayName: id,
        timeZone: 'Australia/Melbourne',
      })),
    });
    await tx.leagueSettings.create({
      data: {
        id: FIXTURE.settingsId,
        rosterSize: 2,
        benchSize: 0,
        maxTeams: 4,
        pickSeconds: 60,
        allowAutoPick: true,
        positionLimitsJson: {},
        autoPickRulesJson: { enabled: true, strategy: 'queue-first' },
        draftType: DraftType.SNAKE,
        pickOrder: PickOrder.MANUAL,
        waiverRule: WaiverRule.WEEKLY,
        startAt: now,
        timeZone: 'Australia/Melbourne',
      },
    });
    await tx.league.create({
      data: {
        id: FIXTURE.leagueId,
        name: 'Integration Members Route League',
        inviteCode: 'INTMEMRT',
        ownerId: ownerUserId,
        settingsId: FIXTURE.settingsId,
        categoriesJson: [],
      },
    });
    await tx.leagueMember.createMany({
      data: [
        {
          id: `${ownerUserId}-member`,
          leagueId: FIXTURE.leagueId,
          userId: ownerUserId,
          role: LeagueRole.OWNER,
          teamName: 'Owner Team',
          draftSlot: 1,
          joinedAt: now,
        },
        {
          id: `${managerUserId}-member`,
          leagueId: FIXTURE.leagueId,
          userId: managerUserId,
          role: LeagueRole.MANAGER,
          teamName: 'Manager Team',
          draftSlot: 2,
          joinedAt: now,
        },
      ],
    });
  });
}

function getMembers(leagueId: string) {
  return GET(new Request(`https://statly.test/api/leagues/${leagueId}/members`) as NextRequest, {
    params: Promise.resolve({ id: leagueId }),
  });
}

describe('GET /api/leagues/[id]/members', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await removeFixture();
    await seedFixture();
  });

  afterAll(async () => {
    await removeFixture();
  });

  it('lists the members of a Prisma league that has no Firestore document', async () => {
    authMocks.getUserIdFromRequest.mockResolvedValue(managerUserId);

    const response = await getMembers(FIXTURE.leagueId);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(
      body.data.map((member: { userId: string; role: string; teamName: string }) => ({
        userId: member.userId,
        role: member.role,
        teamName: member.teamName,
      }))
    ).toEqual([
      { userId: ownerUserId, role: 'owner', teamName: 'Owner Team' },
      { userId: managerUserId, role: 'member', teamName: 'Manager Team' },
    ]);
  });

  it('refuses a signed-in user who is not a member', async () => {
    authMocks.getUserIdFromRequest.mockResolvedValue(outsiderUserId);

    const response = await getMembers(FIXTURE.leagueId);

    expect(response.status).toBe(403);
  });

  it('returns not found for a league with no Prisma row', async () => {
    authMocks.getUserIdFromRequest.mockResolvedValue(managerUserId);

    const response = await getMembers('integration-members-route-missing-league');

    expect(response.status).toBe(404);
  });
});
