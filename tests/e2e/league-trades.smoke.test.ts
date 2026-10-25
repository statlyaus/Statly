import { PrismaClient } from '@prisma/client';
import { expect, test, type Page } from '@playwright/test';

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

// Mirrors playwright.config.ts: CI's browser job starts a Socket.IO server; PLAYWRIGHT_WITH_SOCKET=false
// runs without one, as the Netlify deployment does.
const socketServerRunning =
  process.env.PLAYWRIGHT_WITH_SOCKET === 'true' ||
  (process.env.PLAYWRIGHT_WITH_SOCKET !== 'false' && !process.env.CI);
const revisionPath = `/api/leagues/${E2E_LEAGUE_ID}/trades/revision`;
const SOCKET_IO_URL = /\/socket\.io\//;

// Both tests observe the delivery mechanism, not just the result: a dev-server Fast Refresh
// re-render also reloads the snapshot and would otherwise pass them by accident.

test('with a live league room, another manager’s offer arrives over Socket.IO', async ({
  page,
}) => {
  test.skip(!socketServerRunning, 'No Socket.IO server in this run.');
  const runtimeErrors = collectRuntimeErrors(page);
  const frames: string[] = [];
  page.on('websocket', (socket) => {
    if (SOCKET_IO_URL.test(socket.url())) {
      socket.on('framereceived', (frame) => frames.push(String(frame.payload)));
    }
  });

  await withBotOffer(
    page,
    async () => {
      // The league room acknowledged the join, so the panel is live and does not poll.
      await expect
        .poll(() => frames.some((frame) => frame.includes(`social:league:${E2E_LEAGUE_ID}`)), {
          timeout: 15_000,
        })
        .toBe(true);
    },
    async () => {
      await expect
        .poll(
          () =>
            frames.some((frame) => frame.includes('trade:update') && frame.includes(E2E_LEAGUE_ID)),
          { timeout: 15_000 }
        )
        .toBe(true);
    }
  );

  await expectNoAppErrorBoundary(page);
  expect(runtimeErrors).toEqual([]);
});

test('without Socket.IO, another manager’s offer arrives by polling the trade revision', async ({
  page,
}) => {
  // Page load, then up to two 10-second catch-up ticks.
  test.setTimeout(90_000);
  const runtimeErrors = collectRuntimeErrors(page);
  // As on the Netlify deployment: no realtime room ever answers.
  await page.routeWebSocket(SOCKET_IO_URL, (socket) => socket.close());
  await page.route(SOCKET_IO_URL, (route) => route.abort());

  let baseline = '';
  await withBotOffer(
    page,
    async () => {
      // One tick before the offer exists proves the panel is polling.
      const response = await page.waitForResponse(
        (candidate) => candidate.url().endsWith(revisionPath) && candidate.ok(),
        { timeout: 25_000 }
      );
      baseline = ((await response.json()) as { revision: string }).revision;
    },
    async () => {
      await page.waitForResponse(
        async (candidate) =>
          candidate.url().endsWith(revisionPath) &&
          candidate.ok() &&
          ((await candidate.json()) as { revision: string }).revision !== baseline,
        { timeout: 25_000 }
      );
    }
  );

  await expectNoAppErrorBoundary(page);
  // The blocked socket logs connection errors; everything else must be clean.
  expect(runtimeErrors.filter((error) => !/socket|websocket/i.test(String(error)))).toEqual([]);
});

/**
 * Opens the dev user's Trade Centre, waits until `ready`, has the bot propose an offer (the rows
 * createLeagueTrade writes), waits for `delivered`, then expects Inbox 1 in the same document.
 */
async function withBotOffer(
  page: Page,
  ready: () => Promise<void>,
  delivered: () => Promise<void>
): Promise<void> {
  const prisma = new PrismaClient();
  let threadId: string | null = null;
  try {
    await authenticateAsDevelopmentUser(page);
    await page.goto(`/leagues/${E2E_LEAGUE_ID}?tab=trades`);
    const trades = page.getByRole('region', { name: 'Trades' });
    await expect(trades.getByRole('button', { name: /^Inbox\s*0$/ })).toBeVisible();
    await ready();
    await page.evaluate(() => {
      (window as unknown as { __sameDocument: boolean }).__sameDocument = true;
    });

    threadId = await insertBotOffer(prisma);
    await delivered();

    await expect(trades.getByRole('button', { name: /^Inbox\s*1$/ })).toBeVisible();
    await expect(trades.getByText('AFL Legends', { exact: false }).first()).toBeVisible();
    await expect(
      page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)
    ).resolves.toBe(true);
  } finally {
    if (threadId) await prisma.leagueTradeThread.delete({ where: { id: threadId } });
    await prisma.$disconnect();
  }
}

async function insertBotOffer(prisma: PrismaClient): Promise<string> {
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
  const move = (roster: typeof botRoster, fromMemberId: string, toMemberId: string) => ({
    playerId: roster.playerId,
    playerNameSnapshot: roster.player.name,
    playerClubSnapshot: roster.player.club ?? '',
    playerPositionSnapshot: roster.player.position ?? '',
    fromMemberId,
    toMemberId,
  });

  return prisma.$transaction(async (tx) => {
    const thread = await tx.leagueTradeThread.create({
      data: {
        leagueId: E2E_LEAGUE_ID,
        seasonId: E2E_SEASON_ID,
        memberOneId: E2E_BOT_MEMBER_ID,
        memberTwoId: E2E_HUMAN_MEMBER_ID,
      },
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
    return thread.id;
  });
}
