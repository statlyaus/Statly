import { DraftType, LeagueRole, PickOrder, WaiverRule } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';
import { getLeagueMembershipAccess } from '@/server/leagues/membership';

const FIXTURE = {
  leagueId: 'integration-commissioner-auth-league',
  settingsId: 'integration-commissioner-auth-settings',
} as const;

const users = {
  owner: 'integration-commissioner-auth-owner',
  coCommissioner: 'integration-commissioner-auth-co',
  manager: 'integration-commissioner-auth-manager',
  removed: 'integration-commissioner-auth-removed',
  outsider: 'integration-commissioner-auth-outsider',
} as const;

async function removeFixture() {
  await prisma.leagueMember.deleteMany({ where: { leagueId: FIXTURE.leagueId } });
  await prisma.league.deleteMany({ where: { id: FIXTURE.leagueId } });
  await prisma.leagueSettings.deleteMany({ where: { id: FIXTURE.settingsId } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
}

describe('commissioner authorization', () => {
  beforeAll(async () => {
    await removeFixture();
    await prisma.user.createMany({
      data: Object.values(users).map((id) => ({
        id,
        email: `${id}@statly.local`,
        passwordHash: 'integration-only',
        displayName: id,
        timeZone: 'Australia/Melbourne',
      })),
    });
    await prisma.leagueSettings.create({
      data: {
        id: FIXTURE.settingsId,
        rosterSize: 2,
        benchSize: 0,
        maxTeams: 4,
        pickSeconds: 60,
        allowAutoPick: true,
        positionLimitsJson: '{}',
        autoPickRulesJson: '{}',
        draftType: DraftType.SNAKE,
        pickOrder: PickOrder.MANUAL,
        waiverRule: WaiverRule.WEEKLY,
        startAt: new Date(),
        timeZone: 'Australia/Melbourne',
      },
    });
    await prisma.league.create({
      data: {
        id: FIXTURE.leagueId,
        name: 'Commissioner Auth League',
        inviteCode: 'INTAUTH1',
        ownerId: users.owner,
        settingsId: FIXTURE.settingsId,
        categoriesJson: '[]',
      },
    });
    await prisma.leagueMember.createMany({
      data: [
        { userId: users.owner, role: LeagueRole.OWNER, teamName: 'Owner' },
        {
          userId: users.coCommissioner,
          role: LeagueRole.MANAGER,
          teamName: 'Co',
          isCoCommissioner: true,
        },
        { userId: users.manager, role: LeagueRole.MANAGER, teamName: 'Manager' },
        {
          userId: users.removed,
          role: LeagueRole.MANAGER,
          teamName: 'Removed',
          isCoCommissioner: true,
          isActive: false,
          status: 'removed',
        },
      ].map((member) => ({ ...member, leagueId: FIXTURE.leagueId })),
    });
  });

  afterAll(removeFixture);

  it.each([
    ['the owner', users.owner, { isMember: true, canManage: true }],
    ['a co-commissioner', users.coCommissioner, { isMember: true, canManage: true }],
    ['an ordinary manager', users.manager, { isMember: true, canManage: false }],
    ['a removed co-commissioner', users.removed, { isMember: false, canManage: false }],
    ['someone outside the league', users.outsider, { isMember: false, canManage: false }],
  ])('treats %s as the commissioner rule requires', async (_label, userId, expected) => {
    await expect(getLeagueMembershipAccess(FIXTURE.leagueId, userId)).resolves.toMatchObject(
      expected
    );
  });
});
