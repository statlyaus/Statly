/**
 * What the waivers page shows a member, read from Prisma (#796): their own claims in the page's status
 * words, and their FAAB balance. Firestore plays no part in either.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/firebaseAdmin', () => ({ adminDb: {} }));

import { prisma } from '@/lib/prisma';
import { PrismaWaiverClaimStore, type WaiverClaim } from '@/server/waivers/WaiverProcessingService';
import { loadWaiverOutcomes, publishWaiverOutcome } from '@/server/waivers/waiverActivity';

import { deleteLeagueFixtures } from './helpers/deleteLeagueFixtures';

const LEAGUE = 'int-waiver-read-league';
const OTHER_LEAGUE = 'int-waiver-read-other-league';
const SETTINGS = ['int-waiver-read-settings', 'int-waiver-read-other-settings'];
const users = ['a', 'b'].map((name) => `int-waiver-read-user-${name}`);
const [member, rival] = users.map((id) => `${id}-member`);
const OTHER_MEMBER = 'int-waiver-read-user-a-other-member';
const FAAB = { system: 'FAAB', faabBudget: 100 } as const;

// Nothing under test reads Firestore; the store only writes projections elsewhere.
const store = () => new PrismaWaiverClaimStore(prisma, {} as never);

const removeFixture = () =>
  deleteLeagueFixtures(prisma, {
    leagueIds: [LEAGUE, OTHER_LEAGUE],
    playerIds: [],
    settingsIds: SETTINGS,
    userIds: users,
  });

async function seedFixture() {
  await prisma.user.createMany({
    data: users.map((id) => ({
      id,
      email: `${id}@statly.local`,
      passwordHash: 'x',
      displayName: id,
    })),
  });
  await prisma.leagueSettings.createMany({
    data: SETTINGS.map((id) => ({
      id,
      rosterSize: 4,
      benchSize: 0,
      maxTeams: 2,
      pickSeconds: 60,
      draftType: 'SNAKE' as const,
    })),
  });
  await prisma.league.createMany({
    data: [
      {
        id: LEAGUE,
        name: 'Read',
        inviteCode: 'INTWREAD',
        ownerId: users[0],
        settingsId: SETTINGS[0],
      },
      {
        id: OTHER_LEAGUE,
        name: 'Other',
        inviteCode: 'INTWOTHR',
        ownerId: users[0],
        settingsId: SETTINGS[1],
      },
    ],
  });
  await prisma.leagueMember.createMany({
    data: [
      { id: member, leagueId: LEAGUE, userId: users[0], role: 'OWNER', teamName: 'A' },
      { id: rival, leagueId: LEAGUE, userId: users[1], role: 'MANAGER', teamName: 'B' },
      { id: OTHER_MEMBER, leagueId: OTHER_LEAGUE, userId: users[0], role: 'OWNER', teamName: 'A2' },
    ],
  });
}

const claimAction = (
  id: string,
  leagueId: string,
  memberId: string,
  status: 'PENDING' | 'PROCESSED' | 'REJECTED' | 'CANCELLED',
  createdAt: string
) => ({
  id,
  leagueId,
  memberId,
  actionType: 'WAIVER_CLAIM' as const,
  status,
  details: JSON.stringify({ playerId: `${id}-player`, priority: 1, bidAmount: 5 }),
  createdAt: new Date(createdAt),
  ...(status === 'PENDING' ? {} : { processedAt: new Date(createdAt) }),
});

beforeEach(async () => {
  await removeFixture();
  await seedFixture();
});

afterAll(removeFixture);

describe('waivers page read model', () => {
  it("lists only the member's own claims in this league, newest first, in page status words", async () => {
    await prisma.teamAction.createMany({
      data: [
        claimAction('read-pending', LEAGUE, member, 'PENDING', '2026-10-04T03:00:00Z'),
        claimAction('read-won', LEAGUE, member, 'PROCESSED', '2026-10-04T02:00:00Z'),
        claimAction('read-lost', LEAGUE, member, 'REJECTED', '2026-10-04T01:00:00Z'),
        claimAction('read-cancelled', LEAGUE, member, 'CANCELLED', '2026-10-04T00:00:00Z'),
        claimAction('read-rival', LEAGUE, rival, 'PENDING', '2026-10-04T04:00:00Z'),
        claimAction(
          'read-other-league',
          OTHER_LEAGUE,
          OTHER_MEMBER,
          'PENDING',
          '2026-10-04T05:00:00Z'
        ),
      ],
    });

    const claims = await store().loadMemberClaims(LEAGUE, member);

    expect(claims.map((claim) => [claim.id, claim.status])).toEqual([
      ['read-pending', 'PENDING'],
      ['read-won', 'SUCCESSFUL'],
      ['read-lost', 'FAILED'],
      ['read-cancelled', 'CANCELLED'],
    ]);
    expect(claims[0]).toMatchObject({
      playerId: 'read-pending-player',
      bidAmount: 5,
      userId: users[0],
    });
    expect(claims[0].processedAt).toBeUndefined();
    expect(claims[1].processedAt).toEqual(new Date('2026-10-04T02:00:00Z'));
  });

  it('shows the budget until a claim touches the balance, then the balance, and nothing without FAAB', async () => {
    await expect(store().loadRemainingFaab(LEAGUE, member, FAAB)).resolves.toBe(100);

    await prisma.waiverPriority.create({
      data: { leagueId: LEAGUE, memberId: member, priority: 1, remainingFAAB: 63 },
    });
    await expect(store().loadRemainingFaab(LEAGUE, member, FAAB)).resolves.toBe(63);
    await expect(
      store().loadRemainingFaab(LEAGUE, member, { system: 'PRIORITY' })
    ).resolves.toBeUndefined();
  });

  it('publishes a processed claim once, readable, and lists it in the waiver feed', async () => {
    await prisma.player.upsert({
      where: { id: 'int-waiver-read-player' },
      update: {},
      create: { id: 'int-waiver-read-player', name: 'Jack Ginnivan', club: 'HAW', position: 'FWD' },
    });
    const won: WaiverClaim = {
      id: 'read-feed-won',
      leagueId: LEAGUE,
      userId: users[0],
      teamId: member,
      playerId: 'int-waiver-read-player',
      priority: 1,
      status: 'PENDING',
      createdAt: new Date(),
      bidAmount: 12,
    };

    try {
      await publishWaiverOutcome({ leagueId: LEAGUE, claim: won, type: 'waiver-successful' });
      await publishWaiverOutcome({ leagueId: LEAGUE, claim: won, type: 'waiver-successful' });

      const messages = await prisma.socialMessage.findMany({
        where: { leagueId: LEAGUE, relatedEntityId: won.id },
        select: { content: true, type: true },
      });
      expect(messages).toEqual([
        { content: 'A claimed Jack Ginnivan off waivers for $12.', type: 'SYSTEM' },
      ]);
      await expect(loadWaiverOutcomes(LEAGUE, { limit: 10 })).resolves.toEqual([
        expect.objectContaining({
          type: 'waiver-successful',
          teamId: member,
          playerId: 'int-waiver-read-player',
          bidAmount: 12,
          claimId: won.id,
        }),
      ]);
    } finally {
      await prisma.player.deleteMany({ where: { id: 'int-waiver-read-player' } });
    }
  });

  it('pages waiver outcomes newest first and leaves out other leagues and other events', async () => {
    const [{ id: seasonId }, { id: otherSeasonId }] = await Promise.all(
      [LEAGUE, OTHER_LEAGUE].map((leagueId) =>
        prisma.leagueSeason.create({ data: { leagueId, label: '2026', year: 2026 } })
      )
    );
    await prisma.league.update({ where: { id: LEAGUE }, data: { activeSeasonId: seasonId } });
    await prisma.league.update({
      where: { id: OTHER_LEAGUE },
      data: { activeSeasonId: otherSeasonId },
    });
    const message = (id: string, leagueId: string, season: string, type: string, at: string) => ({
      id,
      leagueId,
      seasonId: season,
      type: 'SYSTEM' as const,
      content: id,
      relatedEntityType: type,
      relatedEntityId: id,
      contextJson: JSON.stringify({
        type: type === 'WAIVER_FAILED' ? 'waiver-failed' : 'waiver-successful',
        claimId: id,
      }),
      createdAt: new Date(at),
    });
    await prisma.socialMessage.createMany({
      data: [
        message('feed-1', LEAGUE, seasonId, 'WAIVER_SUCCESSFUL', '2026-10-05T01:00:00Z'),
        message('feed-2', LEAGUE, seasonId, 'WAIVER_FAILED', '2026-10-05T02:00:00Z'),
        message('feed-3', LEAGUE, seasonId, 'WAIVER_SUCCESSFUL', '2026-10-05T03:00:00Z'),
        message('feed-draft', LEAGUE, seasonId, 'PLAYER_DRAFTED', '2026-10-05T04:00:00Z'),
        message(
          'feed-other',
          OTHER_LEAGUE,
          otherSeasonId,
          'WAIVER_SUCCESSFUL',
          '2026-10-05T05:00:00Z'
        ),
      ],
    });

    const firstPage = await loadWaiverOutcomes(LEAGUE, { limit: 2 });
    expect(firstPage.map((item) => item.claimId)).toEqual(['feed-3', 'feed-2']);
    const secondPage = await loadWaiverOutcomes(LEAGUE, {
      limit: 2,
      before: new Date(firstPage[1].timestamp),
    });
    expect(secondPage.map((item) => [item.claimId, item.type])).toEqual([
      ['feed-1', 'waiver-successful'],
    ]);
  });
});
