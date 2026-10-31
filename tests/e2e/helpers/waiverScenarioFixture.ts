import { LeagueRole, PrismaClient } from '@prisma/client';

import { DEVELOPMENT_AUTH_EMAIL, DEVELOPMENT_AUTH_USER_ID } from '../../../src/lib/devAuth';
import { REAL_DATA_NINE_CATEGORY_PRESET } from '../../../src/types/fantasyCategories';

export const WAIVER_SCENARIO = {
  leagueId: 'e2e-waiver-league',
  settingsId: 'e2e-waiver-settings',
  draftId: 'e2e-waiver-draft',
  commissioner: { memberId: 'e2e-waiver-commissioner', teamName: 'Dev Tester FC', bid: 30 },
  rival: {
    userId: 'e2e-waiver-rival-user',
    memberId: 'e2e-waiver-rival',
    teamName: 'Rival Rovers',
    bid: 20,
  },
  faabBudget: 100,
  freeAgentName: 'Free Agent Alpha',
  freeAgentId: 'e2e-waiver-player-free',
} as const;

const DRAFTED_PLAYERS = [
  { id: 'e2e-waiver-player-commissioner', name: 'Commissioner Mid', position: 'MID' },
  { id: 'e2e-waiver-player-rival', name: 'Rival Mid', position: 'MID' },
] as const;

// Prisma half of Scripts/dev/seed-waiver-scenario.ts. The rival cannot sign in under dev auth, so
// the rival's bid goes through the canonical claim store, which reserves it like the submit route.
export async function seedWaiverScenario(): Promise<void> {
  const prisma = new PrismaClient();
  const { leagueId, settingsId, draftId, commissioner, rival } = WAIVER_SCENARIO;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.teamAction.deleteMany({ where: { leagueId } });
      await tx.waiverPriority.deleteMany({ where: { leagueId } });
      // The season cascades to season-scoped rows (trade threads, social) and blocks the league.
      await tx.leagueSeason.deleteMany({ where: { leagueId } });
      await tx.leagueRosterPlayer.deleteMany({ where: { leagueId } });
      await tx.pick.deleteMany({ where: { draftId } });
      await tx.draftOrder.deleteMany({ where: { draftId } });
      await tx.draft.deleteMany({ where: { leagueId } });
      await tx.leagueMember.deleteMany({ where: { leagueId } });
      await tx.league.deleteMany({ where: { id: leagueId } });
      await tx.leagueSettings.deleteMany({ where: { id: settingsId } });

      await tx.user.upsert({
        where: { id: DEVELOPMENT_AUTH_USER_ID },
        update: { email: DEVELOPMENT_AUTH_EMAIL, displayName: 'Statly Dev Tester' },
        create: {
          id: DEVELOPMENT_AUTH_USER_ID,
          email: DEVELOPMENT_AUTH_EMAIL,
          passwordHash: 'e2e-dev-user',
          displayName: 'Statly Dev Tester',
          timeZone: 'Australia/Melbourne',
        },
      });
      await tx.user.upsert({
        where: { id: rival.userId },
        update: {},
        create: {
          id: rival.userId,
          email: 'e2e-waiver-rival@statly.dev',
          passwordHash: 'e2e-rival-user',
          displayName: 'E2E Waiver Rival',
          timeZone: 'Australia/Melbourne',
        },
      });

      for (const [id, name, position] of [
        ...DRAFTED_PLAYERS.map((player) => [player.id, player.name, player.position] as const),
        [WAIVER_SCENARIO.freeAgentId, WAIVER_SCENARIO.freeAgentName, 'MID'] as const,
      ]) {
        await tx.player.upsert({
          where: { id },
          update: { name, position, active: true },
          create: { id, name, club: 'Statly Test', position, active: true },
        });
      }

      await tx.leagueSettings.create({
        data: {
          id: settingsId,
          rosterSize: 2,
          benchSize: 0,
          maxTeams: 2,
          pickSeconds: 60,
          draftType: 'SNAKE',
          pickOrder: 'MANUAL',
          waiverRule: 'WEEKLY',
          faabBudget: WAIVER_SCENARIO.faabBudget,
          timeZone: 'Australia/Melbourne',
          locked: true,
        },
      });
      await tx.league.create({
        data: {
          id: leagueId,
          name: 'E2E Waiver League',
          inviteCode: 'E2EWAIV',
          ownerId: DEVELOPMENT_AUTH_USER_ID,
          settingsId,
          categoriesJson: [...REAL_DATA_NINE_CATEGORY_PRESET],
        },
      });
      // Every real league gets an active season at creation (createLeagueService); trades and
      // social refuse a league without one.
      const seasonYear = new Date().getUTCFullYear();
      const season = await tx.leagueSeason.create({
        data: {
          leagueId,
          label: `${seasonYear} season`,
          year: seasonYear,
          startsAt: new Date(Date.UTC(seasonYear, 0, 1)),
          endsAt: new Date(Date.UTC(seasonYear, 11, 31, 23, 59, 59, 999)),
        },
      });
      await tx.league.update({ where: { id: leagueId }, data: { activeSeasonId: season.id } });

      const members = [
        {
          id: commissioner.memberId,
          userId: DEVELOPMENT_AUTH_USER_ID,
          role: LeagueRole.OWNER,
          teamName: commissioner.teamName,
        },
        {
          id: rival.memberId,
          userId: rival.userId,
          role: LeagueRole.MANAGER,
          teamName: rival.teamName,
        },
      ];
      await tx.leagueMember.createMany({
        data: members.map((member, index) => ({ ...member, leagueId, draftSlot: index + 1 })),
      });

      await tx.draft.create({
        data: {
          id: draftId,
          leagueId,
          status: 'COMPLETED',
          currentPick: 3,
          totalPicks: 2,
          round: 1,
          direction: 'FORWARD',
          lobbyStatus: 'CLOSED',
        },
      });
      await tx.draftOrder.createMany({
        data: members.map((member, index) => ({ draftId, memberId: member.id, slot: index + 1 })),
      });
      for (const [index, member] of members.entries()) {
        const playerId = DRAFTED_PLAYERS[index].id;
        const pick = await tx.pick.create({
          data: {
            draftId,
            overall: index + 1,
            round: 1,
            slot: index + 1,
            memberId: member.id,
            playerId,
          },
        });
        await tx.leagueRosterPlayer.create({
          data: {
            leagueId,
            memberId: member.id,
            playerId,
            draftId,
            pickId: pick.id,
            acquiredBy: 'DRAFT',
          },
        });
      }

      await tx.waiverPriority.createMany({
        data: [
          {
            leagueId,
            memberId: rival.memberId,
            priority: 1,
            remainingFAAB: WAIVER_SCENARIO.faabBudget,
          },
          {
            leagueId,
            memberId: commissioner.memberId,
            priority: 2,
            remainingFAAB: WAIVER_SCENARIO.faabBudget,
          },
        ],
      });
    });
  } finally {
    await prisma.$disconnect();
  }

  await submitRivalClaim();
}

async function submitRivalClaim(): Promise<void> {
  // Firestore is not part of the e2e stack; the store writes its projection best-effort.
  process.env.FIREBASE_ADMIN_DISABLED = 'true';
  const { PrismaWaiverClaimStore } =
    await import('../../../src/server/waivers/WaiverProcessingService');
  const store = new PrismaWaiverClaimStore();
  const { leagueId, rival } = WAIVER_SCENARIO;

  await store.submitClaim({
    leagueId,
    userId: rival.userId,
    teamId: rival.memberId,
    playerId: WAIVER_SCENARIO.freeAgentId,
    priority: 1,
    bidAmount: rival.bid,
    waiverSettings: (await store.loadWaiverSettings(leagueId)) ?? {},
  });
}

export async function makeWaiverClaimsDue(): Promise<number> {
  const prisma = new PrismaClient();
  try {
    const { count } = await prisma.teamAction.updateMany({
      where: {
        leagueId: WAIVER_SCENARIO.leagueId,
        actionType: 'WAIVER_CLAIM',
        status: 'PENDING',
      },
      data: { processingAt: new Date(Date.now() - 1000) },
    });
    return count;
  } finally {
    await prisma.$disconnect();
  }
}

export async function readWaiverOwner(): Promise<string | null> {
  const prisma = new PrismaClient();
  try {
    const row = await prisma.leagueRosterPlayer.findFirst({
      where: { leagueId: WAIVER_SCENARIO.leagueId, playerId: WAIVER_SCENARIO.freeAgentId },
      select: { memberId: true },
    });
    return row?.memberId ?? null;
  } finally {
    await prisma.$disconnect();
  }
}
