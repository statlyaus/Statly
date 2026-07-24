import {
  DraftDirection,
  DraftStatus,
  DraftType,
  LeagueRole,
  Prisma,
  PrismaClient,
} from '@prisma/client';

import { DEVELOPMENT_AUTH_EMAIL, DEVELOPMENT_AUTH_USER_ID } from '../../../src/lib/devAuth';
import { getPlayers } from '../../../src/lib/data';
import { buildCanonicalPlayerId } from '../../../src/lib/playerIdentity';
import {
  buildAvailableDraftPlayer,
  buildDraftPlayerStatsLookup,
  calculateStatlyZScores,
} from '../../../src/server/draft/readModels/draftPlayerReadModel';
import { REAL_DATA_NINE_CATEGORY_PRESET } from '../../../src/types/fantasyCategories';

export const FULL_DRAFT_SOAK = {
  leagueId: 'e2e-full-soak-league',
  draftId: 'cme2efull0000e2esoakdraft',
  settingsId: 'e2e-full-soak-settings',
  humanMemberId: 'e2e-full-soak-member-human',
  teamCount: 12,
  rosterSize: 22,
  totalPicks: 264,
} as const;

type SoakFixture = typeof FULL_DRAFT_SOAK & {
  queuedBotPlayerId: string;
  rankedPlayerIds: string[];
};

type TxClient = Prisma.TransactionClient;

const BOT_MEMBER_IDS = Array.from(
  { length: FULL_DRAFT_SOAK.teamCount - 1 },
  (_, index) => `e2e-full-soak-member-bot-${index + 1}`
);

const BOT_USER_IDS = Array.from(
  { length: FULL_DRAFT_SOAK.teamCount - 1 },
  (_, index) => `e2e-full-soak-user-bot-${index + 1}`
);

const MEMBER_IDS = [FULL_DRAFT_SOAK.humanMemberId, ...BOT_MEMBER_IDS];

function teamNameForSlot(slot: number): string {
  if (slot === 1) return 'Robbo Rockers';
  return `CPU Team ${slot - 1}`;
}

async function deleteExistingFixture(tx: TxClient) {
  const fixtureDrafts = await tx.draft.findMany({
    where: { OR: [{ id: FULL_DRAFT_SOAK.draftId }, { leagueId: FULL_DRAFT_SOAK.leagueId }] },
    select: { id: true },
  });
  const draftIds = fixtureDrafts.map((draft) => draft.id);

  await tx.leagueRosterPlayer.deleteMany({
    where: {
      OR: [
        { leagueId: FULL_DRAFT_SOAK.leagueId },
        { memberId: { in: MEMBER_IDS } },
        ...(draftIds.length > 0 ? [{ draftId: { in: draftIds } }] : []),
      ],
    },
  });
  await tx.leagueRoster.deleteMany({
    where: { OR: [{ leagueId: FULL_DRAFT_SOAK.leagueId }, { memberId: { in: MEMBER_IDS } }] },
  });
  await tx.teamAction.deleteMany({
    where: {
      OR: [
        { leagueId: FULL_DRAFT_SOAK.leagueId },
        { memberId: { in: MEMBER_IDS } },
        { targetMemberId: { in: MEMBER_IDS } },
      ],
    },
  });
  await tx.queueItem.deleteMany({ where: { memberId: { in: MEMBER_IDS } } });

  if (draftIds.length > 0) {
    await tx.draftWatchlist.deleteMany({ where: { draftId: { in: draftIds } } });
    await tx.preDraftQueue.deleteMany({ where: { draftId: { in: draftIds } } });
    await tx.lobbyActivity.deleteMany({ where: { draftId: { in: draftIds } } });
    await tx.draftEvent.deleteMany({ where: { draftId: { in: draftIds } } });
    await tx.pick.deleteMany({ where: { draftId: { in: draftIds } } });
    await tx.draftOrder.deleteMany({ where: { draftId: { in: draftIds } } });
    await tx.draft.deleteMany({ where: { id: { in: draftIds } } });
  }

  await tx.leagueMember.deleteMany({ where: { leagueId: FULL_DRAFT_SOAK.leagueId } });
  await tx.league.deleteMany({ where: { id: FULL_DRAFT_SOAK.leagueId } });
  await tx.leagueSettings.deleteMany({ where: { id: FULL_DRAFT_SOAK.settingsId } });
}

async function upsertUsers(tx: TxClient) {
  await tx.user.upsert({
    where: { id: DEVELOPMENT_AUTH_USER_ID },
    update: {
      email: DEVELOPMENT_AUTH_EMAIL,
      displayName: 'Statly Dev Tester',
      timeZone: 'Australia/Melbourne',
    },
    create: {
      id: DEVELOPMENT_AUTH_USER_ID,
      email: DEVELOPMENT_AUTH_EMAIL,
      passwordHash: 'e2e-dev-user',
      displayName: 'Statly Dev Tester',
      timeZone: 'Australia/Melbourne',
    },
  });

  await Promise.all(
    BOT_USER_IDS.map((userId, index) =>
      tx.user.upsert({
        where: { id: userId },
        update: {
          email: `${userId}@statly.local`,
          displayName: teamNameForSlot(index + 2),
          timeZone: 'Australia/Melbourne',
        },
        create: {
          id: userId,
          email: `${userId}@statly.local`,
          passwordHash: 'e2e-bot-user',
          displayName: teamNameForSlot(index + 2),
          timeZone: 'Australia/Melbourne',
        },
      })
    )
  );
}

async function upsertActivePlayerPool(tx: TxClient): Promise<string[]> {
  const players = await getPlayers();
  const activePlayers = players
    .slice(0, Math.max(FULL_DRAFT_SOAK.totalPicks + 64, 360))
    .map((player) => ({ ...player, id: buildCanonicalPlayerId(player.name) }));
  const candidateIds = [...new Set(activePlayers.map((player) => player.id))];

  if (candidateIds.length < FULL_DRAFT_SOAK.totalPicks) {
    throw new Error(
      `Full draft soak requires at least ${FULL_DRAFT_SOAK.totalPicks} canonical players, found ${candidateIds.length}`
    );
  }

  for (const player of activePlayers) {
    await tx.player.upsert({
      where: { id: player.id },
      update: {
        name: player.name,
        club: player.team ?? 'N/A',
        position: player.position ?? '',
        active: true,
      },
      create: {
        id: player.id,
        name: player.name,
        club: player.team ?? 'N/A',
        position: player.position ?? '',
        active: true,
      },
    });
  }

  return candidateIds;
}

async function rankActivePlayerIds(tx: TxClient, candidateIds: string[]): Promise<string[]> {
  const candidates = await tx.player.findMany({
    where: { active: true, id: { in: candidateIds } },
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, position: true, club: true },
  });
  const statsLookup = buildDraftPlayerStatsLookup(await getPlayers());
  const projectedCandidates = candidates.map((player) =>
    buildAvailableDraftPlayer(player, statsLookup)
  );
  const zScores = calculateStatlyZScores(projectedCandidates, REAL_DATA_NINE_CATEGORY_PRESET);

  return [...candidates]
    .sort((a, b) => {
      const aScore = zScores.get(a.id)?.score;
      const bScore = zScores.get(b.id)?.score;
      const aHasScore = typeof aScore === 'number';
      const bHasScore = typeof bScore === 'number';

      if (aHasScore && bHasScore && aScore !== bScore) {
        return bScore - aScore;
      }

      if (aHasScore !== bHasScore) {
        return aHasScore ? -1 : 1;
      }

      const positionCompare = String(a.position ?? '').localeCompare(String(b.position ?? ''));
      if (positionCompare !== 0) return positionCompare;

      return a.name.localeCompare(b.name);
    })
    .map((player) => player.id);
}

async function createLeagueAndDraft(tx: TxClient, queuedBotPlayerId: string) {
  const now = new Date('2026-06-19T00:00:00.000Z');

  await tx.leagueSettings.create({
    data: {
      id: FULL_DRAFT_SOAK.settingsId,
      rosterSize: FULL_DRAFT_SOAK.rosterSize,
      benchSize: 0,
      maxTeams: FULL_DRAFT_SOAK.teamCount,
      pickSeconds: 60,
      allowAutoPick: true,
      positionLimitsJson: JSON.stringify({}),
      autoPickRulesJson: JSON.stringify({ strategy: 'statly-z' }),
      draftType: DraftType.SNAKE,
      pickOrder: 'MANUAL',
      waiverRule: 'WEEKLY',
      startAt: now,
      timeZone: 'Australia/Melbourne',
      locked: true,
    },
  });

  await tx.league.create({
    data: {
      id: FULL_DRAFT_SOAK.leagueId,
      name: 'E2E Full Draft Soak League',
      inviteCode: 'E2EFULL1',
      ownerId: DEVELOPMENT_AUTH_USER_ID,
      settingsId: FULL_DRAFT_SOAK.settingsId,
      categoriesJson: JSON.stringify([...REAL_DATA_NINE_CATEGORY_PRESET]),
      createdAt: now,
    },
  });

  await tx.leagueMember.createMany({
    data: MEMBER_IDS.map((memberId, index) => ({
      id: memberId,
      leagueId: FULL_DRAFT_SOAK.leagueId,
      userId: index === 0 ? DEVELOPMENT_AUTH_USER_ID : BOT_USER_IDS[index - 1],
      role: index === 0 ? LeagueRole.OWNER : LeagueRole.MANAGER,
      teamName: teamNameForSlot(index + 1),
      draftSlot: index + 1,
      joinedAt: now,
    })),
  });

  await tx.draft.create({
    data: {
      id: FULL_DRAFT_SOAK.draftId,
      leagueId: FULL_DRAFT_SOAK.leagueId,
      status: DraftStatus.LIVE,
      currentPick: 1,
      totalPicks: FULL_DRAFT_SOAK.totalPicks,
      round: 1,
      direction: DraftDirection.FORWARD,
      lobbyStatus: 'LIVE',
      lobbyOpenAt: now,
      startedAt: now,
      pickStartedAt: now,
      pickDeadlineAt: new Date(now.getTime() + 60_000),
    },
  });

  await tx.draftOrder.createMany({
    data: MEMBER_IDS.map((memberId, index) => ({
      draftId: FULL_DRAFT_SOAK.draftId,
      memberId,
      slot: index + 1,
    })),
  });

  await tx.preDraftQueue.create({
    data: {
      draftId: FULL_DRAFT_SOAK.draftId,
      memberId: BOT_MEMBER_IDS[0],
      playerId: queuedBotPlayerId,
      rank: 1,
    },
  });
}

export async function seedFullDraftSoakFixture(): Promise<SoakFixture> {
  const prisma = new PrismaClient();

  try {
    return await prisma.$transaction(
      async (tx) => {
        await deleteExistingFixture(tx);
        await upsertUsers(tx);
        const candidateIds = await upsertActivePlayerPool(tx);

        const rankedPlayerIds = await rankActivePlayerIds(tx, candidateIds);
        if (rankedPlayerIds.length < FULL_DRAFT_SOAK.totalPicks) {
          throw new Error(
            `Full draft soak requires ${FULL_DRAFT_SOAK.totalPicks} active ranked players, found ${rankedPlayerIds.length}`
          );
        }

        const queuedBotPlayerId = rankedPlayerIds[10];
        if (!queuedBotPlayerId) {
          throw new Error('Unable to choose a queued bot player for the full draft soak fixture');
        }

        await createLeagueAndDraft(tx, queuedBotPlayerId);

        return {
          ...FULL_DRAFT_SOAK,
          queuedBotPlayerId,
          rankedPlayerIds,
        };
      },
      { timeout: 60_000 }
    );
  } finally {
    await prisma.$disconnect();
  }
}
