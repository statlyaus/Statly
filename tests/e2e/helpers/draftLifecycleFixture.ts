import {
  DraftDirection,
  DraftStatus,
  DraftType,
  LeagueRole,
  Prisma,
  PrismaClient,
} from '@prisma/client';

import { DEVELOPMENT_AUTH_EMAIL, DEVELOPMENT_AUTH_USER_ID } from '../../../src/lib/devAuth';
import {
  buildAvailableDraftPlayer,
  buildDraftPlayerStatsLookup,
  calculateStatlyZScores,
} from '../../../src/server/draft/readModels/draftPlayerReadModel';
import { listSeasonStatPlayers } from '../../../src/server/players/playerPoolReadModel';
import { REAL_DATA_NINE_CATEGORY_PRESET } from '../../../src/types/fantasyCategories';

export const DRAFT_LIFECYCLE_FIXTURE = {
  leagueId: 'e2e-draft-lifecycle-league',
  draftId: 'cme2elifecycle0000e2edraft',
  settingsId: 'e2e-draft-lifecycle-settings',
  humanMemberId: 'e2e-draft-lifecycle-member-human',
  teamCount: 2,
  rosterSize: 2,
  totalPicks: 4,
} as const;

type DraftLifecycleFixture = typeof DRAFT_LIFECYCLE_FIXTURE & {
  queuedBotPlayerId: string;
  rankedPlayerIds: string[];
};

type TxClient = Prisma.TransactionClient;

const BOT_MEMBER_IDS = Array.from(
  { length: DRAFT_LIFECYCLE_FIXTURE.teamCount - 1 },
  (_, index) => `e2e-draft-lifecycle-member-bot-${index + 1}`
);

const BOT_USER_IDS = Array.from(
  { length: DRAFT_LIFECYCLE_FIXTURE.teamCount - 1 },
  (_, index) => `e2e-draft-lifecycle-user-bot-${index + 1}`
);

const MEMBER_IDS = [DRAFT_LIFECYCLE_FIXTURE.humanMemberId, ...BOT_MEMBER_IDS];

function teamNameForSlot(slot: number): string {
  if (slot === 1) return 'Robbo Rockers';
  return `CPU Team ${slot - 1}`;
}

async function deleteExistingFixture(tx: TxClient) {
  const fixtureDrafts = await tx.draft.findMany({
    where: {
      OR: [{ id: DRAFT_LIFECYCLE_FIXTURE.draftId }, { leagueId: DRAFT_LIFECYCLE_FIXTURE.leagueId }],
    },
    select: { id: true },
  });
  const draftIds = fixtureDrafts.map((draft) => draft.id);

  await tx.leagueRosterPlayer.deleteMany({
    where: {
      OR: [
        { leagueId: DRAFT_LIFECYCLE_FIXTURE.leagueId },
        { memberId: { in: MEMBER_IDS } },
        ...(draftIds.length > 0 ? [{ draftId: { in: draftIds } }] : []),
      ],
    },
  });
  await tx.teamAction.deleteMany({
    where: {
      OR: [
        { leagueId: DRAFT_LIFECYCLE_FIXTURE.leagueId },
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

  await tx.leagueMember.deleteMany({ where: { leagueId: DRAFT_LIFECYCLE_FIXTURE.leagueId } });
  await tx.league.deleteMany({ where: { id: DRAFT_LIFECYCLE_FIXTURE.leagueId } });
  await tx.leagueSettings.deleteMany({ where: { id: DRAFT_LIFECYCLE_FIXTURE.settingsId } });
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

// Fixed fixture players with one stored season each, so Statly-Z ranks them the same every run.
const STATS_SEASON = 2025;
const FIXTURE_CLUBS = ['Adelaide', 'Brisbane', 'Carlton', 'Collingwood'] as const;
const FIXTURE_POSITIONS = ['DEF', 'MID', 'RUC', 'FWD'] as const;
const FIXTURE_PLAYERS = Array.from({ length: 16 }, (_, index) => {
  const number = String(index + 1).padStart(2, '0');
  return {
    id: `e2e-lifecycle-player-${number}`,
    name: `Lifecycle Player ${number}`,
    club: FIXTURE_CLUBS[index % FIXTURE_CLUBS.length],
    position: FIXTURE_POSITIONS[index % FIXTURE_POSITIONS.length],
    // Per-game value index + 1 in every category over 10 games.
    total: (index + 1) * 10,
  };
});

async function upsertActivePlayerPool(prisma: PrismaClient): Promise<string[]> {
  const candidateIds: string[] = [];

  for (const player of FIXTURE_PLAYERS) {
    const { id, name, club, position } = player;
    await prisma.player.upsert({
      where: { id },
      update: { name, club, position, active: true },
      create: { id, name, club, position, active: true },
    });
    const totals = Object.fromEntries(
      [
        'goals',
        'tackles',
        'inside_50s',
        'intercepts',
        'contested_marks',
        'rebound_50s',
        'contested_possessions',
        'effective_disposals',
        'score_involvements',
      ].map((key) => [key, player.total])
    );
    const row = {
      club: player.club,
      games: 10,
      lastRound: 10,
      totalsJson: totals,
      gamesByStatJson: Object.fromEntries(Object.keys(totals).map((key) => [key, 10])),
      source: 'statly-e2e',
    };
    await prisma.playerSeasonStat.upsert({
      where: { playerId_season: { playerId: id, season: STATS_SEASON } },
      update: row,
      create: { ...row, playerId: id, season: STATS_SEASON },
    });
    candidateIds.push(id);
  }

  return candidateIds;
}

async function rankActivePlayerIds(tx: TxClient, candidateIds: string[]): Promise<string[]> {
  const candidates = await tx.player.findMany({
    where: { active: true, id: { in: candidateIds } },
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, position: true, club: true },
  });
  const statsLookup = buildDraftPlayerStatsLookup(
    await listSeasonStatPlayers({ season: STATS_SEASON, ids: candidateIds }, tx),
    { season: STATS_SEASON }
  );
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
  const fixtureCreatedAt = new Date('2026-06-19T00:00:00.000Z');
  const clockStartedAt = new Date();

  await tx.leagueSettings.create({
    data: {
      id: DRAFT_LIFECYCLE_FIXTURE.settingsId,
      rosterSize: DRAFT_LIFECYCLE_FIXTURE.rosterSize,
      benchSize: 0,
      maxTeams: DRAFT_LIFECYCLE_FIXTURE.teamCount,
      pickSeconds: 60,
      allowAutoPick: true,
      positionLimitsJson: {},
      autoPickRulesJson: { strategy: 'statly-z' },
      draftType: DraftType.SNAKE,
      pickOrder: 'MANUAL',
      waiverRule: 'WEEKLY',
      startAt: fixtureCreatedAt,
      timeZone: 'Australia/Melbourne',
      locked: true,
    },
  });

  await tx.league.create({
    data: {
      id: DRAFT_LIFECYCLE_FIXTURE.leagueId,
      name: 'E2E Draft Lifecycle League',
      inviteCode: 'E2ELIFE1',
      ownerId: DEVELOPMENT_AUTH_USER_ID,
      settingsId: DRAFT_LIFECYCLE_FIXTURE.settingsId,
      categoriesJson: [...REAL_DATA_NINE_CATEGORY_PRESET],
      createdAt: fixtureCreatedAt,
    },
  });

  await tx.leagueMember.createMany({
    data: MEMBER_IDS.map((memberId, index) => ({
      id: memberId,
      leagueId: DRAFT_LIFECYCLE_FIXTURE.leagueId,
      userId: index === 0 ? DEVELOPMENT_AUTH_USER_ID : BOT_USER_IDS[index - 1],
      role: index === 0 ? LeagueRole.OWNER : LeagueRole.MANAGER,
      teamName: teamNameForSlot(index + 1),
      draftSlot: index + 1,
      joinedAt: fixtureCreatedAt,
    })),
  });

  await tx.draft.create({
    data: {
      id: DRAFT_LIFECYCLE_FIXTURE.draftId,
      leagueId: DRAFT_LIFECYCLE_FIXTURE.leagueId,
      status: DraftStatus.LIVE,
      currentPick: 1,
      totalPicks: DRAFT_LIFECYCLE_FIXTURE.totalPicks,
      round: 1,
      direction: DraftDirection.FORWARD,
      lobbyStatus: 'LIVE',
      lobbyOpenAt: clockStartedAt,
      startedAt: clockStartedAt,
      pickStartedAt: clockStartedAt,
      pickDeadlineAt: new Date(clockStartedAt.getTime() + 60_000),
    },
  });

  await tx.draftOrder.createMany({
    data: MEMBER_IDS.map((memberId, index) => ({
      draftId: DRAFT_LIFECYCLE_FIXTURE.draftId,
      memberId,
      slot: index + 1,
    })),
  });

  await tx.preDraftQueue.create({
    data: {
      draftId: DRAFT_LIFECYCLE_FIXTURE.draftId,
      memberId: BOT_MEMBER_IDS[0],
      playerId: queuedBotPlayerId,
      rank: 1,
    },
  });
}

export async function seedDraftLifecycleFixture(): Promise<DraftLifecycleFixture> {
  const prisma = new PrismaClient();

  try {
    const candidateIds = await upsertActivePlayerPool(prisma);
    return await prisma.$transaction(
      async (tx) => {
        await deleteExistingFixture(tx);
        await upsertUsers(tx);

        const rankedPlayerIds = await rankActivePlayerIds(tx, candidateIds);
        if (rankedPlayerIds.length < DRAFT_LIFECYCLE_FIXTURE.totalPicks) {
          throw new Error(
            `Draft lifecycle requires ${DRAFT_LIFECYCLE_FIXTURE.totalPicks} active ranked players, found ${rankedPlayerIds.length}`
          );
        }

        const queuedBotPlayerId = rankedPlayerIds[3];
        if (!queuedBotPlayerId) {
          throw new Error('Unable to choose a queued bot player for the draft lifecycle fixture');
        }

        await createLeagueAndDraft(tx, queuedBotPlayerId);

        return {
          ...DRAFT_LIFECYCLE_FIXTURE,
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
