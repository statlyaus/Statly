import { PrismaClient } from '@prisma/client';
import { expect, test } from '@playwright/test';

import {
  E2E_BOT_MEMBER_ID,
  E2E_HUMAN_MEMBER_ID,
  E2E_LEAGUE_ID,
  E2E_SEASON_ID,
} from './global.setup';
import {
  authenticateAsDevelopmentUser,
  collectRuntimeErrors,
  expectNoAppErrorBoundary,
} from './helpers/devAuth';

// CI and the Netlify deployment run without a Socket.IO process, so the Trade Centre must catch up
// by polling the viewer's trade revision.
test('an offer from another manager reaches the Trade Centre inbox without a reload', async ({
  page,
}) => {
  // Page load, then up to two 10-second catch-up ticks.
  test.setTimeout(90_000);
  const runtimeErrors = collectRuntimeErrors(page);
  const revisionPath = `/api/leagues/${E2E_LEAGUE_ID}/trades/revision`;
  const prisma = new PrismaClient();
  let threadId: string | null = null;

  try {
    await authenticateAsDevelopmentUser(page);
    await page.goto(`/leagues/${E2E_LEAGUE_ID}?tab=trades`);

    const trades = page.getByRole('region', { name: 'Trades' });
    const inbox = trades.getByRole('button', { name: /^Inbox\s*0$/ });
    await expect(inbox).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as { __sameDocument: boolean }).__sameDocument = true;
    });
    // Wait for one catch-up tick before the offer exists. That proves the panel is polling, and it
    // lets the dev server finish compiling (a Fast Refresh re-render would also reload the snapshot).
    const baseline = (await (
      await page.waitForResponse(
        (response) => response.url().endsWith(revisionPath) && response.ok(),
        {
          timeout: 25_000,
        }
      )
    ).json()) as { revision: string };

    // The bot proposes one of its players for one of ours: the rows createLeagueTrade writes.
    const [settings, botRoster, humanRoster] = await Promise.all([
      prisma.league
        .findUniqueOrThrow({ where: { id: E2E_LEAGUE_ID }, select: { settings: true } })
        .then((league) => league.settings),
      prisma.leagueRosterPlayer.findFirstOrThrow({
        where: { leagueId: E2E_LEAGUE_ID, memberId: E2E_BOT_MEMBER_ID },
        include: { player: true },
      }),
      prisma.leagueRosterPlayer.findFirstOrThrow({
        where: { leagueId: E2E_LEAGUE_ID, memberId: E2E_HUMAN_MEMBER_ID },
        include: { player: true },
      }),
    ]);
    await prisma.$transaction(async (tx) => {
      const thread = await tx.leagueTradeThread.create({
        data: {
          leagueId: E2E_LEAGUE_ID,
          seasonId: E2E_SEASON_ID,
          memberOneId: E2E_BOT_MEMBER_ID,
          memberTwoId: E2E_HUMAN_MEMBER_ID,
        },
      });
      threadId = thread.id;
      const move = (roster: typeof botRoster, fromMemberId: string, toMemberId: string) => ({
        playerId: roster.playerId,
        playerNameSnapshot: roster.player.name,
        playerClubSnapshot: roster.player.club ?? '',
        playerPositionSnapshot: roster.player.position ?? '',
        fromMemberId,
        toMemberId,
      });
      const offer = await tx.leagueTradeOffer.create({
        data: {
          threadId: thread.id,
          sequence: 1,
          proposerMemberId: E2E_BOT_MEMBER_ID,
          recipientMemberId: E2E_HUMAN_MEMBER_ID,
          expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
          reviewMode: settings?.tradeReviewMode ?? 'NONE',
          reviewHours: settings?.tradeReviewHours ?? 24,
          vetoThreshold: settings?.tradeVetoThreshold ?? 3,
          players: {
            create: [
              move(botRoster, E2E_BOT_MEMBER_ID, E2E_HUMAN_MEMBER_ID),
              move(humanRoster, E2E_HUMAN_MEMBER_ID, E2E_BOT_MEMBER_ID),
            ],
          },
        },
      });
      await tx.leagueTradeThread.update({
        where: { id: thread.id },
        data: { currentOfferId: offer.id },
      });
      await tx.leagueTradeEvent.create({
        data: {
          threadId: thread.id,
          offerId: offer.id,
          actorMemberId: E2E_BOT_MEMBER_ID,
          eventType: 'PROPOSED',
          nextStatus: 'OPEN',
        },
      });
      await tx.leagueTradeOutboxEvent.create({
        data: {
          leagueId: E2E_LEAGUE_ID,
          seasonId: E2E_SEASON_ID,
          threadId: thread.id,
          offerId: offer.id,
          eventType: 'trade:proposed',
          payloadJson: JSON.stringify({ threadId: thread.id, offerId: offer.id, status: 'OPEN' }),
        },
      });
    });

    // The next tick sees the new revision, and the snapshot reloads without a navigation.
    await page.waitForResponse(
      async (response) =>
        response.url().endsWith(revisionPath) &&
        response.ok() &&
        ((await response.json()) as { revision: string }).revision !== baseline.revision,
      { timeout: 25_000 }
    );
    await expect(trades.getByRole('button', { name: /^Inbox\s*1$/ })).toBeVisible();
    await expect(trades.getByText('AFL Legends', { exact: false }).first()).toBeVisible();
    // A soft refresh keeps the document: the offer arrived without a reload.
    await expect(
      page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)
    ).resolves.toBe(true);
    await expectNoAppErrorBoundary(page);
    expect(runtimeErrors).toEqual([]);
  } finally {
    if (threadId) await prisma.leagueTradeThread.delete({ where: { id: threadId } });
    await prisma.$disconnect();
  }
});
