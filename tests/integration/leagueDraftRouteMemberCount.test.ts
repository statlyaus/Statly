import { DraftType, LeagueRole, PickOrder, WaiverRule } from '@prisma/client';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({ getAuthenticatedUserId: vi.fn() }));

vi.mock('@/lib/serverAuth', () => authMocks);

import { GET } from '@/app/api/leagues/[id]/draft/route';
import { prisma } from '@/lib/prisma';

const FIXTURE = {
  leagueId: 'integration-draft-count-league',
  settingsId: 'integration-draft-count-settings',
} as const;
const [ownerUserId, managerUserId, formerUserId] = ['owner', 'manager', 'former'].map(
  (name) => `integration-draft-count-${name}`
);

async function removeFixture(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.leagueMember.deleteMany({ where: { leagueId: FIXTURE.leagueId } });
    await tx.league.deleteMany({ where: { id: FIXTURE.leagueId } });
    await tx.leagueSettings.deleteMany({ where: { id: FIXTURE.settingsId } });
    await tx.user.deleteMany({
      where: { id: { in: [ownerUserId, managerUserId, formerUserId] } },
    });
  });
}

// Two active teams plus one removed member whose row is kept for history.
async function seedFixture(): Promise<void> {
  const now = new Date('2026-05-31T00:00:00.000Z');
  await prisma.$transaction(async (tx) => {
    await tx.user.createMany({
      data: [ownerUserId, managerUserId, formerUserId].map((id) => ({
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
        name: 'Integration Draft Count League',
        inviteCode: 'INTDRCNT',
        ownerId: ownerUserId,
        settingsId: FIXTURE.settingsId,
        categoriesJson: [],
      },
    });
    await tx.leagueMember.createMany({
      data: [
        { userId: ownerUserId, role: LeagueRole.OWNER, draftSlot: 1 },
        { userId: managerUserId, role: LeagueRole.MANAGER, draftSlot: 2 },
        {
          userId: formerUserId,
          role: LeagueRole.MANAGER,
          draftSlot: 3,
          isActive: false,
          status: 'REMOVED' as const,
          leftAt: now,
        },
      ].map((member) => ({
        id: `${member.userId}-member`,
        leagueId: FIXTURE.leagueId,
        teamName: `${member.userId} team`,
        joinedAt: now,
        ...member,
      })),
    });
  });
}

describe('GET /api/leagues/[id]/draft member count', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await removeFixture();
    await seedFixture();
  });

  afterAll(async () => {
    await removeFixture();
  });

  it('counts only active members, not removed ones', async () => {
    authMocks.getAuthenticatedUserId.mockResolvedValue(ownerUserId);

    const response = await GET(
      new NextRequest(`http://localhost/api/leagues/${FIXTURE.leagueId}/draft`),
      { params: Promise.resolve({ id: FIXTURE.leagueId }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.memberCount).toBe(2);
  });
});
