import { DraftDirection, DraftStatus, DraftType, LeagueRole, PrismaClient } from '@prisma/client';

import { DEVELOPMENT_AUTH_EMAIL, DEVELOPMENT_AUTH_USER_ID } from '../../src/lib/devAuth';
import { REAL_DATA_NINE_CATEGORY_PRESET } from '../../src/types/fantasyCategories';

export const E2E_LEAGUE_ID = 'e2e-completed-league';
export const E2E_DRAFT_ID = 'cme2edraft0000e2etestdraft';
const E2E_SETTINGS_ID = 'e2e-completed-settings';
const E2E_HUMAN_MEMBER_ID = 'e2e-member-human';
const E2E_BOT_MEMBER_ID = 'e2e-member-bot';
const E2E_BOT_USER_ID = 'e2e-bot-user';
const E2E_MEMBER_IDS = [E2E_HUMAN_MEMBER_ID, E2E_BOT_MEMBER_ID];

const E2E_PLAYERS = [
  { id: 'e2e-player-darcy-cameron', name: 'Darcy Cameron', club: 'Collingwood', position: 'RUC' },
  { id: 'e2e-player-zach-merrett', name: 'Zach Merrett', club: 'Essendon', position: 'MID' },
  { id: 'e2e-player-hayden-young', name: 'Hayden Young', club: 'Fremantle', position: 'MID' },
  { id: 'e2e-player-sam-durham', name: 'Sam Durham', club: 'Essendon', position: 'MID' },
] as const;

async function globalSetup() {
  const prisma = new PrismaClient();
  const now = new Date('2026-06-14T00:00:00.000Z');

  try {
    await prisma.$transaction(async (tx) => {
      const fixtureDrafts = await tx.draft.findMany({
        where: { OR: [{ id: E2E_DRAFT_ID }, { leagueId: E2E_LEAGUE_ID }] },
        select: { id: true },
      });
      const fixtureDraftIds = fixtureDrafts.map((draft) => draft.id);

      await tx.leagueRosterPlayer.deleteMany({
        where: { OR: [{ leagueId: E2E_LEAGUE_ID }, { memberId: { in: E2E_MEMBER_IDS } }] },
      });
      await tx.leagueRoster.deleteMany({
        where: { OR: [{ leagueId: E2E_LEAGUE_ID }, { memberId: { in: E2E_MEMBER_IDS } }] },
      });
      await tx.teamAction.deleteMany({
        where: {
          OR: [
            { leagueId: E2E_LEAGUE_ID },
            { memberId: { in: E2E_MEMBER_IDS } },
            { targetMemberId: { in: E2E_MEMBER_IDS } },
          ],
        },
      });
      await tx.queueItem.deleteMany({ where: { memberId: { in: E2E_MEMBER_IDS } } });

      if (fixtureDraftIds.length > 0) {
        await tx.draftWatchlist.deleteMany({ where: { draftId: { in: fixtureDraftIds } } });
        await tx.preDraftQueue.deleteMany({ where: { draftId: { in: fixtureDraftIds } } });
        await tx.lobbyActivity.deleteMany({ where: { draftId: { in: fixtureDraftIds } } });
        await tx.draftEvent.deleteMany({ where: { draftId: { in: fixtureDraftIds } } });
        await tx.pick.deleteMany({ where: { draftId: { in: fixtureDraftIds } } });
        await tx.draftOrder.deleteMany({ where: { draftId: { in: fixtureDraftIds } } });
        await tx.draft.deleteMany({ where: { id: { in: fixtureDraftIds } } });
      }

      await tx.leagueMember.deleteMany({ where: { leagueId: E2E_LEAGUE_ID } });
      await tx.league.deleteMany({ where: { id: E2E_LEAGUE_ID } });
      await tx.leagueSettings.deleteMany({ where: { id: E2E_SETTINGS_ID } });

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

      await tx.user.upsert({
        where: { id: E2E_BOT_USER_ID },
        update: {
          email: 'e2e-bot@statly.local',
          displayName: 'AFL Legends',
          timeZone: 'Australia/Melbourne',
        },
        create: {
          id: E2E_BOT_USER_ID,
          email: 'e2e-bot@statly.local',
          passwordHash: 'e2e-bot-user',
          displayName: 'AFL Legends',
          timeZone: 'Australia/Melbourne',
        },
      });

      await tx.leagueSettings.create({
        data: {
          id: E2E_SETTINGS_ID,
          rosterSize: 2,
          benchSize: 0,
          maxTeams: 2,
          pickSeconds: 30,
          allowAutoPick: true,
          positionLimitsJson: JSON.stringify({ MID: 2, RUC: 1 }),
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
          id: E2E_LEAGUE_ID,
          name: 'Test AFL Champions League',
          inviteCode: 'E2ETEST1',
          ownerId: DEVELOPMENT_AUTH_USER_ID,
          settingsId: E2E_SETTINGS_ID,
          categoriesJson: JSON.stringify([...REAL_DATA_NINE_CATEGORY_PRESET]),
          createdAt: now,
        },
      });

      await tx.leagueMember.createMany({
        data: [
          {
            id: E2E_HUMAN_MEMBER_ID,
            leagueId: E2E_LEAGUE_ID,
            userId: DEVELOPMENT_AUTH_USER_ID,
            role: LeagueRole.OWNER,
            teamName: 'Robbo Rockers',
            draftSlot: 1,
            joinedAt: now,
          },
          {
            id: E2E_BOT_MEMBER_ID,
            leagueId: E2E_LEAGUE_ID,
            userId: E2E_BOT_USER_ID,
            role: LeagueRole.MANAGER,
            teamName: 'AFL Legends',
            draftSlot: 2,
            joinedAt: now,
          },
        ],
      });

      await Promise.all(
        E2E_PLAYERS.map((player) =>
          tx.player.upsert({
            where: { id: player.id },
            update: { ...player, active: true },
            create: { ...player, active: true },
          })
        )
      );

      await tx.draft.create({
        data: {
          id: E2E_DRAFT_ID,
          leagueId: E2E_LEAGUE_ID,
          status: DraftStatus.COMPLETED,
          currentPick: 4,
          totalPicks: 4,
          round: 2,
          direction: DraftDirection.REVERSE,
          lobbyStatus: 'CLOSED',
          lobbyOpenAt: now,
          startedAt: now,
          completedAt: now,
          pickStartedAt: now,
          pickDeadlineAt: now,
        },
      });

      await tx.draftOrder.createMany({
        data: [
          { draftId: E2E_DRAFT_ID, memberId: E2E_HUMAN_MEMBER_ID, slot: 1 },
          { draftId: E2E_DRAFT_ID, memberId: E2E_BOT_MEMBER_ID, slot: 2 },
        ],
      });

      const picks = [
        {
          id: 'e2e-pick-1',
          overall: 1,
          round: 1,
          slot: 1,
          memberId: E2E_HUMAN_MEMBER_ID,
          playerId: E2E_PLAYERS[0].id,
        },
        {
          id: 'e2e-pick-2',
          overall: 2,
          round: 1,
          slot: 2,
          memberId: E2E_BOT_MEMBER_ID,
          playerId: E2E_PLAYERS[1].id,
        },
        {
          id: 'e2e-pick-3',
          overall: 3,
          round: 2,
          slot: 2,
          memberId: E2E_BOT_MEMBER_ID,
          playerId: E2E_PLAYERS[2].id,
        },
        {
          id: 'e2e-pick-4',
          overall: 4,
          round: 2,
          slot: 1,
          memberId: E2E_HUMAN_MEMBER_ID,
          playerId: E2E_PLAYERS[3].id,
        },
      ];

      await tx.pick.createMany({
        data: picks.map((pick) => ({
          ...pick,
          draftId: E2E_DRAFT_ID,
          madeAt: now,
          auto: pick.memberId !== E2E_HUMAN_MEMBER_ID,
        })),
      });

      await tx.leagueRoster.create({
        data: {
          id: 'e2e-roster-human',
          leagueId: E2E_LEAGUE_ID,
          memberId: E2E_HUMAN_MEMBER_ID,
          playerIds: JSON.stringify([E2E_PLAYERS[0].id, E2E_PLAYERS[3].id]),
        },
      });

      await tx.leagueRosterPlayer.createMany({
        data: [
          {
            id: 'e2e-roster-player-1',
            leagueId: E2E_LEAGUE_ID,
            memberId: E2E_HUMAN_MEMBER_ID,
            draftId: E2E_DRAFT_ID,
            pickId: 'e2e-pick-1',
            playerId: E2E_PLAYERS[0].id,
            slot: 'RUC',
            acquiredBy: 'DRAFT',
            acquiredAt: now,
          },
          {
            id: 'e2e-roster-player-2',
            leagueId: E2E_LEAGUE_ID,
            memberId: E2E_HUMAN_MEMBER_ID,
            draftId: E2E_DRAFT_ID,
            pickId: 'e2e-pick-4',
            playerId: E2E_PLAYERS[3].id,
            slot: 'MID',
            acquiredBy: 'DRAFT',
            acquiredAt: now,
          },
          {
            id: 'e2e-roster-player-3',
            leagueId: E2E_LEAGUE_ID,
            memberId: E2E_BOT_MEMBER_ID,
            draftId: E2E_DRAFT_ID,
            pickId: 'e2e-pick-2',
            playerId: E2E_PLAYERS[1].id,
            slot: 'MID',
            acquiredBy: 'DRAFT',
            acquiredAt: now,
          },
          {
            id: 'e2e-roster-player-4',
            leagueId: E2E_LEAGUE_ID,
            memberId: E2E_BOT_MEMBER_ID,
            draftId: E2E_DRAFT_ID,
            pickId: 'e2e-pick-3',
            playerId: E2E_PLAYERS[2].id,
            slot: 'MID',
            acquiredBy: 'DRAFT',
            acquiredAt: now,
          },
        ],
      });
    });
  } finally {
    await prisma.$disconnect();
  }
}

export default globalSetup;
