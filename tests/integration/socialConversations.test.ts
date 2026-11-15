/**
 * League chat stage 2: league chat runs on one LEAGUE conversation per season, and a DM's or group's
 * messages stay out of league chat, its unread count and its read position. No screen creates a DM
 * yet, so the tests insert one directly, as stage 3 will.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/leagues/membership', () => ({
  getLeagueMembershipAccess: vi.fn(async (_leagueId: string, userId: string) => ({
    isMember: true,
    memberId: `${userId}-member`,
    canManage: false,
  })),
}));

import { prisma } from '@/lib/prisma';
import {
  createSocialMessage,
  markSocialChannelRead,
  reportSocialContent,
  editSocialMessage,
} from '@/server/leagues/social/socialCommands';
import { privateConversationAudience } from '@/server/leagues/social/socialConversations';
import { getLeagueSocialSummary, listSocialMessages } from '@/server/leagues/social/socialQueries';

import { deleteLeagueFixtures } from './helpers/deleteLeagueFixtures';
import { activateLeagueSeason } from './helpers/leagueSeason';

const LEAGUE = 'int-social-conv-league';
const SETTINGS = 'int-social-conv-settings';
const [ANN, BEN, CAL] = ['int-social-conv-ann', 'int-social-conv-ben', 'int-social-conv-cal'];
const USERS = [ANN, BEN, CAL];

const removeFixture = () =>
  deleteLeagueFixtures(prisma, {
    leagueIds: [LEAGUE],
    playerIds: [],
    settingsIds: [SETTINGS],
    userIds: USERS,
  });

let seasonId = '';
let sequence = 0;
const key = () => `int-social-conv-${(sequence += 1)}`;

async function seedLeague() {
  await removeFixture();
  await prisma.user.createMany({
    data: USERS.map((id) => ({
      id,
      email: `${id}@statly.local`,
      passwordHash: 'x',
      displayName: id,
    })),
  });
  await prisma.leagueSettings.create({
    data: {
      id: SETTINGS,
      rosterSize: 1,
      benchSize: 0,
      maxTeams: 4,
      pickSeconds: 120,
      draftType: 'SNAKE',
    },
  });
  await prisma.league.create({
    data: {
      id: LEAGUE,
      name: 'Conversations',
      inviteCode: 'INTCONV',
      ownerId: ANN,
      settingsId: SETTINGS,
    },
  });
  await prisma.leagueMember.createMany({
    data: USERS.map((userId) => ({
      id: `${userId}-member`,
      leagueId: LEAGUE,
      userId,
      teamName: userId,
      role: userId === ANN ? 'OWNER' : 'MANAGER',
      socialStandardsAcceptedAt: new Date(),
    })),
  });
  seasonId = await activateLeagueSeason(prisma, LEAGUE);
}

/** A DM between Ann and Ben, with one message from Ben, written as stage 3 will write it. */
async function seedAnnBenDm(options: { annMuted?: boolean } = {}) {
  const dm = await prisma.socialConversation.create({
    data: {
      leagueId: LEAGUE,
      seasonId,
      kind: 'DM',
      uniqueKey: `dm:${ANN}-member:${BEN}-member`,
      members: {
        create: [ANN, BEN].map((userId) => ({
          leagueId: LEAGUE,
          seasonId,
          userId,
          memberId: `${userId}-member`,
          mutedAt: userId === ANN && options.annMuted ? new Date() : null,
        })),
      },
    },
  });
  const message = await prisma.socialMessage.create({
    data: {
      leagueId: LEAGUE,
      seasonId,
      conversationId: dm.id,
      authorUserId: BEN,
      authorMemberId: `${BEN}-member`,
      content: 'Private offer',
    },
  });
  await prisma.socialOutboxEvent.create({
    data: {
      leagueId: LEAGUE,
      seasonId,
      conversationId: dm.id,
      channel: 'CHAT',
      actorUserId: BEN,
      eventType: 'social:message',
      aggregateType: 'message',
      aggregateId: message.id,
      payloadJson: {},
    },
  });
  return { dm, message };
}

describe('league chat conversations', () => {
  beforeEach(seedLeague);
  afterAll(async () => {
    await removeFixture();
    await prisma.$disconnect();
  });

  it('creates one league conversation per season and links messages and events to it', async () => {
    await Promise.all(
      USERS.map((userId) =>
        createSocialMessage(LEAGUE, userId, { content: `hi from ${userId}`, idempotencyKey: key() })
      )
    );

    const conversations = await prisma.socialConversation.findMany({ where: { seasonId } });
    expect(conversations).toEqual([
      expect.objectContaining({ kind: 'LEAGUE', uniqueKey: 'league' }),
    ]);
    const messages = await prisma.socialMessage.findMany({ where: { seasonId } });
    expect(messages.map((message) => message.conversationId)).toEqual(
      Array(3).fill(conversations[0].id)
    );
    const events = await prisma.socialOutboxEvent.findMany({ where: { seasonId } });
    expect(events.map((event) => event.conversationId)).toEqual(Array(3).fill(conversations[0].id));
  });

  it('keeps DM messages out of league chat, its unread count and its read position', async () => {
    await createSocialMessage(LEAGUE, BEN, { content: 'League hello', idempotencyKey: key() });
    await seedAnnBenDm();

    const page = await listSocialMessages(LEAGUE, CAL, { limit: 25 });
    expect(page.items.map((item) => item.content)).toEqual(['League hello']);

    // Cal is not in the DM: one unread, league chat's. Ann is: league chat's plus the DM's.
    await expect(getLeagueSocialSummary(LEAGUE, CAL)).resolves.toMatchObject({
      unread: { chat: 1 },
    });
    await expect(getLeagueSocialSummary(LEAGUE, ANN)).resolves.toMatchObject({
      unread: { chat: 2 },
    });

    // Reading league chat moves to league chat's newest event, not the newer DM one, and leaves the
    // DM unread.
    const leagueEvent = await prisma.socialOutboxEvent.findFirstOrThrow({
      where: { seasonId, conversation: { is: { kind: 'LEAGUE' } } },
    });
    await expect(markSocialChannelRead(LEAGUE, ANN, { channel: 'chat' })).resolves.toEqual({
      channel: 'chat',
      sequence: leagueEvent.sequence,
    });
    await expect(getLeagueSocialSummary(LEAGUE, ANN)).resolves.toMatchObject({
      unread: { chat: 1 },
      latestSequence: { chat: leagueEvent.sequence },
    });
  });

  it('leaves a muted DM out of the chat badge', async () => {
    await seedAnnBenDm({ annMuted: true });
    await expect(getLeagueSocialSummary(LEAGUE, ANN)).resolves.toMatchObject({
      unread: { chat: 0 },
    });
  });

  it('delivers a DM event to its current members only, and league chat to everyone', async () => {
    const { dm } = await seedAnnBenDm();
    await expect(privateConversationAudience(prisma, dm.id)).resolves.toEqual(new Set([ANN, BEN]));

    await prisma.socialConversationMember.updateMany({
      where: { conversationId: dm.id, userId: BEN },
      data: { leftAt: new Date() },
    });
    await expect(privateConversationAudience(prisma, dm.id)).resolves.toEqual(new Set([ANN]));

    await createSocialMessage(LEAGUE, ANN, { content: 'League', idempotencyKey: key() });
    const league = await prisma.socialConversation.findFirstOrThrow({
      where: { seasonId, kind: 'LEAGUE' },
    });
    await expect(privateConversationAudience(prisma, league.id)).resolves.toBeNull();
    await expect(privateConversationAudience(prisma, null)).resolves.toBeNull();
    await expect(privateConversationAudience(prisma, 'no-such-conversation')).resolves.toEqual(
      new Set()
    );
  });

  it('keeps a copy of a reported message that survives a later edit', async () => {
    const message = await createSocialMessage(LEAGUE, BEN, {
      content: 'Something rude',
      idempotencyKey: key(),
    });
    const report = await reportSocialContent(LEAGUE, ANN, {
      contentType: 'message',
      contentId: message.id,
      reason: 'harassment',
    });
    await editSocialMessage(LEAGUE, BEN, message.id, { content: 'Something nice' });

    const stored = await prisma.socialReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(stored.retainedContentJson).toEqual({ content: 'Something rude', giphyId: null });
    expect(stored.conversationId).toEqual(
      (await prisma.socialMessage.findUniqueOrThrow({ where: { id: message.id } })).conversationId
    );
  });
});
