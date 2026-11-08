/**
 * #955 cohort 4: TeamAction.details, DraftEvent.payload and LobbyActivity.details are jsonb. The
 * database rejects malformed JSON, the drop hold still finds a pending drop by its player id, and
 * the player-identity planner still blocks on a pending action that names an alias.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';
import { planPlayerIdentityConsolidation } from '@/server/players/playerIdentityConsolidationPlanner';

import { deleteLeagueFixtures } from './helpers/deleteLeagueFixtures';
import { activateLeagueSeason } from './helpers/leagueSeason';

const LEAGUE = 'int-jsonb-c4-league';
let seasonId = '';
const SETTINGS = 'int-jsonb-c4-settings';
const USER = 'int-jsonb-c4-user';
const MEMBER = 'int-jsonb-c4-member';
const DRAFT = 'int-jsonb-c4-draft';
const ALIAS = 'int-jsonb-c4-alias-player';
const CANONICAL = 'int_jsonb_c4_canonical_player';

async function removeFixture() {
  await deleteLeagueFixtures(prisma, {
    leagueIds: [LEAGUE],
    playerIds: [ALIAS, CANONICAL],
    settingsIds: [SETTINGS],
    userIds: [USER],
  });
}

async function seedLeague() {
  await prisma.user.create({
    data: { id: USER, email: `${USER}@example.test`, passwordHash: 'test', displayName: USER },
  });
  await prisma.leagueSettings.create({
    data: {
      id: SETTINGS,
      rosterSize: 22,
      benchSize: 4,
      maxTeams: 12,
      pickSeconds: 60,
      draftType: 'SNAKE',
      startAt: new Date('2026-07-24T00:00:00.000Z'),
    },
  });
  await prisma.league.create({
    data: {
      id: LEAGUE,
      name: 'Jsonb Cohort Four',
      inviteCode: 'JSONBC41',
      ownerId: USER,
      settingsId: SETTINGS,
    },
  });
  seasonId = await activateLeagueSeason(prisma, LEAGUE);
  await prisma.leagueMember.create({
    data: { id: MEMBER, leagueId: LEAGUE, userId: USER, role: 'OWNER', teamName: 'Team' },
  });
  await prisma.draft.create({
    data: { id: DRAFT, leagueId: LEAGUE, status: 'COMPLETED', totalPicks: 1 },
  });
  await prisma.player.createMany({
    data: [ALIAS, CANONICAL].map((id) => ({
      id,
      name: 'Same Player',
      club: 'Club',
      position: 'MID',
    })),
  });
}

describe('team action, draft event and lobby activity jsonb columns', () => {
  beforeEach(removeFixture);
  afterAll(async () => {
    await removeFixture();
    await prisma.$disconnect();
  });

  it('stores all three columns as jsonb', async () => {
    const columns = await prisma.$queryRaw<Array<{ data_type: string }>>`
      SELECT data_type FROM information_schema.columns
      WHERE (table_name, column_name) IN (
        ('TeamAction', 'details'),
        ('DraftEvent', 'payload'),
        ('LobbyActivity', 'details')
      )`;
    expect(columns.map((column) => column.data_type)).toEqual(['jsonb', 'jsonb', 'jsonb']);
  });

  it('rejects a malformed JSON write at the database', async () => {
    await seedLeague();
    const action = await prisma.teamAction.create({
      data: {
        leagueId: LEAGUE,
        seasonId,
        memberId: MEMBER,
        actionType: 'WAIVER_CLAIM',
        details: {},
      },
    });

    // An untyped literal is coerced to the column type, so a text column would have accepted it.
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "TeamAction" SET "details" = '{"playerId": ' WHERE "id" = $1`,
        action.id
      )
    ).rejects.toThrow(/invalid input syntax for type json/);
  });

  it('finds a pending drop by its player id with the roster-add hold filter', async () => {
    await seedLeague();
    await prisma.teamAction.create({
      data: {
        leagueId: LEAGUE,
        seasonId,
        memberId: MEMBER,
        actionType: 'DROP_PLAYER',
        status: 'PENDING',
        processingAt: new Date(Date.now() + 60 * 60_000),
        details: { playerId: ALIAS, source: 'drop-to-waivers' },
      },
    });

    const hold = (playerId: string) =>
      prisma.teamAction.findFirst({
        where: {
          leagueId: LEAGUE,
          actionType: 'DROP_PLAYER',
          status: 'PENDING',
          processingAt: { gt: new Date() },
          details: { path: ['playerId'], equals: playerId },
        },
        select: { id: true },
      });
    await expect(hold(ALIAS)).resolves.not.toBeNull();
    await expect(hold(CANONICAL)).resolves.toBeNull();
  });

  it('blocks consolidation on a pending action and counts jsonb draft and lobby references', async () => {
    await seedLeague();
    const pending = await prisma.teamAction.create({
      data: {
        leagueId: LEAGUE,
        seasonId,
        memberId: MEMBER,
        actionType: 'WAIVER_CLAIM',
        status: 'PENDING',
        details: { playerId: ALIAS, priority: 1 },
      },
    });
    await prisma.teamAction.create({
      data: {
        leagueId: LEAGUE,
        seasonId,
        memberId: MEMBER,
        actionType: 'WAIVER_CLAIM',
        status: 'PROCESSED',
        details: { playerId: ALIAS },
      },
    });
    await prisma.draftEvent.create({
      data: {
        draftId: DRAFT,
        leagueId: LEAGUE,
        event: 'draft:pick-made',
        payload: { player: { id: ALIAS } },
      },
    });
    await prisma.lobbyActivity.create({
      data: { draftId: DRAFT, memberId: MEMBER, action: 'queue', details: { playerId: ALIAS } },
    });

    const plan = await planPlayerIdentityConsolidation(prisma, [
      { aliasId: ALIAS, canonicalPlayerId: CANONICAL },
    ]);
    expect(plan.status).toBe('blocked');
    expect(plan.blockers).toEqual([
      expect.objectContaining({
        code: 'PENDING_ACTION_REFERENCE',
        scopeId: pending.id,
        aliasIds: [ALIAS],
      }),
    ]);
    // Both team actions, the draft event and the lobby activity mention the alias.
    expect(plan.references.jsonDocuments).toBe(4);
  });
});
