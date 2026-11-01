/**
 * #955 cohort 3: the outbox, audit and command payload columns are jsonb. Values round-trip as
 * objects, the database rejects malformed JSON, and the player-identity planner still finds alias
 * ids inside jsonb documents.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';
import { publishLeagueSystemMessage } from '@/server/leagues/social/socialSystemEvents';
import { planPlayerIdentityConsolidation } from '@/server/players/playerIdentityConsolidationPlanner';

import { deleteLeagueFixtures } from './helpers/deleteLeagueFixtures';

const LEAGUE = 'int-jsonb-c3-league';
const SEASON = 'int-jsonb-c3-season';
const SETTINGS = 'int-jsonb-c3-settings';
const USERS = ['int-jsonb-c3-user-a', 'int-jsonb-c3-user-b'];
const MEMBERS = ['int-jsonb-c3-member-a', 'int-jsonb-c3-member-b'];
const ALIAS = 'int-jsonb-c3-alias-player';
const CANONICAL = 'int_jsonb_c3_canonical_player';

async function removeFixture() {
  await prisma.$transaction([
    prisma.socialOutboxEvent.deleteMany({ where: { leagueId: LEAGUE } }),
    prisma.socialMessage.deleteMany({ where: { leagueId: LEAGUE } }),
    prisma.socialCommand.deleteMany({ where: { leagueId: LEAGUE } }),
    prisma.leagueTradeOutboxEvent.deleteMany({ where: { leagueId: LEAGUE } }),
    prisma.leagueTradeCommand.deleteMany({ where: { leagueId: LEAGUE } }),
    prisma.leagueCompetitionAudit.deleteMany({ where: { leagueId: LEAGUE } }),
  ]);
  await deleteLeagueFixtures(prisma, {
    leagueIds: [LEAGUE],
    playerIds: [ALIAS, CANONICAL],
    settingsIds: [SETTINGS],
    userIds: USERS,
  });
}

async function seedLeague() {
  await prisma.user.createMany({
    data: USERS.map((id) => ({
      id,
      email: `${id}@example.test`,
      passwordHash: 'test',
      displayName: id,
    })),
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
      name: 'Jsonb Cohort Three',
      inviteCode: 'JSONBC31',
      ownerId: USERS[0],
      settingsId: SETTINGS,
    },
  });
  await prisma.leagueSeason.create({ data: { id: SEASON, leagueId: LEAGUE, label: '2026' } });
  await prisma.league.update({ where: { id: LEAGUE }, data: { activeSeasonId: SEASON } });
  await prisma.leagueMember.createMany({
    data: MEMBERS.map((id, index) => ({
      id,
      leagueId: LEAGUE,
      userId: USERS[index],
      role: index === 0 ? ('OWNER' as const) : ('MANAGER' as const),
      teamName: `Team ${index}`,
    })),
  });
}

describe('payload jsonb columns', () => {
  beforeEach(removeFixture);
  afterAll(async () => {
    await removeFixture();
    await prisma.$disconnect();
  });

  it('stores all eight columns as jsonb', async () => {
    const columns = await prisma.$queryRaw<Array<{ data_type: string }>>`
      SELECT data_type FROM information_schema.columns
      WHERE (table_name, column_name) IN (
        ('LeagueCompetitionAudit', 'payloadJson'),
        ('SocialMessage', 'contextJson'),
        ('SocialModerationRecord', 'retainedContentJson'),
        ('SocialCommand', 'responseJson'),
        ('SocialOutboxEvent', 'payloadJson'),
        ('LeagueTradeEvent', 'payloadJson'),
        ('LeagueTradeCommand', 'responseJson'),
        ('LeagueTradeOutboxEvent', 'payloadJson')
      )`;
    expect(columns.map((column) => column.data_type)).toEqual(Array(8).fill('jsonb'));
  });

  it('stores a system message context, command response and outbox payload as objects', async () => {
    await seedLeague();
    const input = {
      leagueId: LEAGUE,
      eventType: 'WAIVER_PROCESSED',
      relatedEntityId: 'claim-1',
      content: 'Team 0 claimed a player',
      context: { claimId: 'claim-1', bid: 3 },
    };

    const message = await publishLeagueSystemMessage(input);
    await expect(publishLeagueSystemMessage(input)).resolves.toEqual(message);

    const stored = await prisma.socialMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(stored.contextJson).toEqual({ claimId: 'claim-1', bid: 3 });
    const command = await prisma.socialCommand.findFirstOrThrow({ where: { leagueId: LEAGUE } });
    expect(command.responseJson).toEqual(message);
    const outbox = await prisma.socialOutboxEvent.findFirstOrThrow({ where: { leagueId: LEAGUE } });
    expect(outbox.payloadJson).toEqual(message);
  });

  it('rejects a malformed JSON write at the database', async () => {
    await seedLeague();
    await prisma.leagueCompetitionAudit.create({
      data: {
        id: 'int-jsonb-c3-audit',
        leagueId: LEAGUE,
        eventType: 'RULES_PUBLISHED',
        payloadJson: {},
      },
    });

    // An untyped literal is coerced to the column type, so a text column would have accepted it.
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "LeagueCompetitionAudit" SET "payloadJson" = '{"round": 4' WHERE "id" = $1`,
        'int-jsonb-c3-audit'
      )
    ).rejects.toThrow(/invalid input syntax for type json/);
  });

  it('counts alias references inside jsonb documents in all four planner tables', async () => {
    await seedLeague();
    await prisma.player.createMany({
      data: [ALIAS, CANONICAL].map((id) => ({
        id,
        name: 'Same Player',
        club: 'Club',
        position: 'MID',
      })),
    });
    const thread = await prisma.leagueTradeThread.create({
      data: {
        leagueId: LEAGUE,
        seasonId: SEASON,
        memberOneId: MEMBERS[0],
        memberTwoId: MEMBERS[1],
      },
    });
    const document = { players: [{ playerId: ALIAS }] };
    await prisma.leagueCompetitionAudit.create({
      data: { leagueId: LEAGUE, eventType: 'RULES_PUBLISHED', payloadJson: document },
    });
    await prisma.leagueTradeEvent.create({
      data: {
        threadId: thread.id,
        eventType: 'PROPOSED',
        nextStatus: 'OPEN',
        payloadJson: document,
      },
    });
    await prisma.leagueTradeCommand.create({
      data: {
        leagueId: LEAGUE,
        seasonId: SEASON,
        actorUserId: USERS[0],
        idempotencyKey: 'int-jsonb-c3-command',
        commandType: 'CREATE_OFFER',
        requestHash: 'hash',
        responseJson: document,
      },
    });
    await prisma.leagueTradeOutboxEvent.create({
      data: {
        leagueId: LEAGUE,
        seasonId: SEASON,
        threadId: thread.id,
        eventType: 'trade:update',
        payloadJson: document,
      },
    });
    // A document that only mentions the canonical player is not a reference to the alias.
    await prisma.leagueCompetitionAudit.create({
      data: {
        leagueId: LEAGUE,
        eventType: 'RULES_PUBLISHED',
        payloadJson: { players: [{ playerId: CANONICAL }] },
      },
    });

    const plan = await planPlayerIdentityConsolidation(prisma, [
      { aliasId: ALIAS, canonicalPlayerId: CANONICAL },
    ]);
    expect(plan.references.jsonDocuments).toBe(4);
  });
});
