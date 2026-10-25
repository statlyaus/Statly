import { PrismaClient } from '@prisma/client';
import { expect, test } from '@playwright/test';

import { E2E_BOT_MEMBER_ID, E2E_BOT_USER_ID, E2E_LEAGUE_ID, E2E_SEASON_ID } from './global.setup';
import {
  authenticateAsDevelopmentUser,
  collectRuntimeErrors,
  expectNoAppErrorBoundary,
} from './helpers/devAuth';

// CI and the Netlify deployment run without a Socket.IO process, so chat must catch up by polling.
test('league chat sends a message and shows another member’s message without a reload', async ({
  page,
}) => {
  const runtimeErrors = collectRuntimeErrors(page);
  const ownText = `Pies by three goals ${Date.now()}`;
  const otherText = `Not a chance, Bombers by ten ${Date.now()}`;

  await authenticateAsDevelopmentUser(page);
  await page.goto(`/leagues/${E2E_LEAGUE_ID}/social`);

  const chat = page.getByRole('region', { name: 'League chat' });
  await expect(chat).toBeVisible();
  const composer = chat.getByPlaceholder('Message your league…');
  const acceptStandards = page.getByRole('button', { name: 'I accept the community standards' });
  await expect(composer.or(acceptStandards).first()).toBeVisible();
  if (await acceptStandards.isVisible()) await acceptStandards.click();

  await composer.fill(ownText);
  await composer.press('Enter');
  const messages = chat.getByRole('list', { name: 'League chat messages' });
  await expect(messages).toContainText(ownText);

  // Another member posts: the same rows createSocialMessage writes in one transaction.
  const prisma = new PrismaClient();
  try {
    await prisma.$transaction(async (tx) => {
      const record = await tx.socialMessage.create({
        data: {
          leagueId: E2E_LEAGUE_ID,
          seasonId: E2E_SEASON_ID,
          authorUserId: E2E_BOT_USER_ID,
          authorMemberId: E2E_BOT_MEMBER_ID,
          content: otherText,
        },
      });
      await tx.socialOutboxEvent.create({
        data: {
          leagueId: E2E_LEAGUE_ID,
          seasonId: E2E_SEASON_ID,
          channel: 'CHAT',
          actorUserId: E2E_BOT_USER_ID,
          eventType: 'social:message',
          aggregateType: 'message',
          aggregateId: record.id,
          payloadJson: JSON.stringify({
            id: record.id,
            leagueId: E2E_LEAGUE_ID,
            seasonId: E2E_SEASON_ID,
            type: 'member',
            content: otherText,
            author: { userId: E2E_BOT_USER_ID, displayName: 'AFL Legends', teamName: null },
            createdAt: record.createdAt.toISOString(),
            moderationStatus: 'active',
            isOwn: false,
          }),
        },
      });
    });
  } finally {
    await prisma.$disconnect();
  }

  // One 10-second catch-up tick, plus request time.
  await expect(messages).toContainText(otherText, { timeout: 20_000 });
  // Scoped to chat: Next.js renders an empty route announcer with role="alert" on every page.
  await expect(chat.getByRole('alert')).toHaveCount(0);
  await expectNoAppErrorBoundary(page);
  expect(runtimeErrors).toEqual([]);
});
