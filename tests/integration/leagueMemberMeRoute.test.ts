import { DraftType, LeagueRole, PickOrder, WaiverRule } from '@prisma/client';
import type { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({ getAuthenticatedUserId: vi.fn() }));

// Prisma owns membership. Any Firestore read would mean Firestore is deciding.
vi.mock('@/lib/firebaseAdmin', () => {
  const unexpected = () => {
    throw new Error('Unexpected Firestore access for a Prisma league');
  };
  return {
    adminDb: { collection: unexpected, collectionGroup: unexpected, doc: unexpected },
  };
});
vi.mock('@/lib/serverAuth', () => authMocks);

import { PATCH } from '@/app/api/leagues/[id]/members/me/route';
import { prisma } from '@/lib/prisma';

const FIXTURE = {
  leagueId: 'integration-member-me-league',
  settingsId: 'integration-member-me-settings',
} as const;
const [ownerUserId, managerUserId, outsiderUserId] = ['owner', 'manager', 'outsider'].map(
  (name) => `integration-member-me-${name}`
);
const managerMemberId = `${managerUserId}-member`;

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

// The owner owns the league but has no LeagueMember row, so has no team to edit.
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
        name: 'Integration Member Me League',
        inviteCode: 'INTMEME1',
        ownerId: ownerUserId,
        settingsId: FIXTURE.settingsId,
        categoriesJson: [],
      },
    });
    await tx.leagueMember.create({
      data: {
        id: managerMemberId,
        leagueId: FIXTURE.leagueId,
        userId: managerUserId,
        role: LeagueRole.MANAGER,
        teamName: 'Manager Team',
        draftSlot: 1,
        joinedAt: now,
      },
    });
  });
}

function patchMe(body: Record<string, unknown>) {
  return PATCH(
    new Request(`https://statly.test/api/leagues/${FIXTURE.leagueId}/members/me`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as NextRequest,
    { params: Promise.resolve({ id: FIXTURE.leagueId }) }
  );
}

describe('PATCH /api/leagues/[id]/members/me', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await removeFixture();
    await seedFixture();
  });

  afterAll(async () => {
    await removeFixture();
  });

  it('updates the team of a member with a LeagueMember row', async () => {
    authMocks.getAuthenticatedUserId.mockResolvedValue(managerUserId);

    const response = await patchMe({ teamName: 'Renamed Team' });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.member).toMatchObject({ id: managerMemberId, teamName: 'Renamed Team' });
  });

  it('returns not found, not a server error, for a league owner with no team', async () => {
    authMocks.getAuthenticatedUserId.mockResolvedValue(ownerUserId);

    const response = await patchMe({ teamName: 'Owner Team' });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'You do not have a team in this league',
    });
    expect(await prisma.leagueMember.count({ where: { leagueId: FIXTURE.leagueId } })).toBe(1);
  });

  it('refuses a signed-in user who is not in the league', async () => {
    authMocks.getAuthenticatedUserId.mockResolvedValue(outsiderUserId);

    const response = await patchMe({ teamName: 'Intruder Team' });

    expect(response.status).toBe(403);
  });
});
