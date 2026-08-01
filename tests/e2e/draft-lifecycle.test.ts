import { expect, test, type APIResponse } from '@playwright/test';

import {
  authenticateAsDevelopmentUser,
  collectRuntimeErrors,
  expectNoAppErrorBoundary,
} from './helpers/devAuth';
import { seedDraftLifecycleFixture } from './helpers/draftLifecycleFixture';

const MAX_DRAFT_INTERACTION_MS = 10_000;
const MAX_RENDERED_AVAILABLE_PLAYER_ROWS = 120;

async function readOkDraftResponse(response: APIResponse, label: string) {
  if (!response.ok()) {
    const body = await response.text();
    throw new Error(`${label} failed with ${response.status()} ${response.statusText()}: ${body}`);
  }

  return response.json();
}

test('completes a representative draft and recovers history and roster state', async ({
  context,
  page,
}) => {
  test.setTimeout(90_000);

  const fixture = await seedDraftLifecycleFixture();
  const runtimeErrors = collectRuntimeErrors(page);
  await authenticateAsDevelopmentUser(page);

  await page.goto(`/drafts/${fixture.draftId}`);
  await expect(page.locator('body')).toContainText('Pick 1 of 4');
  await expectNoAppErrorBoundary(page);

  const playerRows = page
    .getByRole('table', { name: 'Available draft players' })
    .locator('tbody tr');
  await expect
    .poll(() => playerRows.count())
    .toBeLessThanOrEqual(MAX_RENDERED_AVAILABLE_PLAYER_ROWS);

  const firstSelectButton = page.getByRole('button', { name: /^Select / }).first();
  const playerReadyStart = Date.now();
  await expect(firstSelectButton).toBeEnabled();
  expect(Date.now() - playerReadyStart).toBeLessThan(MAX_DRAFT_INTERACTION_MS);

  const selectStart = Date.now();
  await firstSelectButton.click();
  await expect(page.locator('body')).toContainText('Pick 2 of 4');
  expect(Date.now() - selectStart).toBeLessThan(MAX_DRAFT_INTERACTION_MS);

  const firstPickResponse = await page.request.get(
    `/api/drafts/${fixture.draftId}/picks?pageSize=1`
  );
  const firstPickPayload = await readOkDraftResponse(firstPickResponse, 'Read manual pick');
  const firstPickedPlayerId = firstPickPayload.data.picks[0].player.id;

  const secondPickResponse = await page.request.post(`/api/drafts/${fixture.draftId}/auto-pick`, {
    headers: { authorization: 'Bearer dev:statly-dev-tester' },
  });
  const secondPickPayload = await readOkDraftResponse(secondPickResponse, 'Queued auto-pick');
  expect(secondPickPayload.data).toMatchObject({
    currentPick: 3,
    isComplete: false,
    wasQueued: true,
    pick: { player: { id: fixture.queuedBotPlayerId } },
  });

  const thirdPickResponse = await page.request.post(`/api/drafts/${fixture.draftId}/auto-pick`, {
    headers: { authorization: 'Bearer dev:statly-dev-tester' },
  });
  const thirdPickPayload = await readOkDraftResponse(thirdPickResponse, 'Fallback auto-pick');
  expect(thirdPickPayload.data).toMatchObject({
    currentPick: 4,
    isComplete: false,
    wasQueued: false,
  });
  expect([firstPickedPlayerId, fixture.queuedBotPlayerId]).not.toContain(
    thirdPickPayload.data.pick.player.id
  );

  const finalPickResponse = await page.request.post(`/api/drafts/${fixture.draftId}/auto-pick`, {
    headers: { authorization: 'Bearer dev:statly-dev-tester' },
  });
  const finalPickPayload = await readOkDraftResponse(finalPickResponse, 'Completing auto-pick');
  expect(finalPickPayload.data).toMatchObject({
    currentPick: 5,
    isComplete: true,
    wasQueued: false,
  });

  await expect(page.getByText('Draft is complete')).toBeVisible();
  await expectNoAppErrorBoundary(page);
  await page.close();

  const recoveryPage = await context.newPage();
  const recoveryRuntimeErrors = collectRuntimeErrors(recoveryPage);

  await recoveryPage.goto(`/drafts/${fixture.draftId}`);
  await expect(recoveryPage.getByText('Draft is complete')).toBeVisible();
  await expect(recoveryPage.getByRole('link', { name: 'Review completed draft' })).toBeVisible();
  await expect(recoveryPage.getByRole('link', { name: 'Review my roster' })).toBeVisible();
  await expectNoAppErrorBoundary(recoveryPage);

  await recoveryPage.goto(`/drafts/history/${fixture.draftId}`);
  await expect(recoveryPage.locator('body')).toContainText(String(fixture.totalPicks));
  await expectNoAppErrorBoundary(recoveryPage);

  await recoveryPage.goto(`/leagues/${fixture.leagueId}?tab=roster`);
  await expect(recoveryPage.getByRole('heading', { name: 'Robbo Rockers' })).toBeVisible();
  await expect(
    recoveryPage.getByRole('table', { name: 'Robbo Rockers roster table' })
  ).toBeVisible();
  await expect(recoveryPage.getByText('No Team Selected')).toHaveCount(0);
  await expectNoAppErrorBoundary(recoveryPage);

  expect([...runtimeErrors, ...recoveryRuntimeErrors]).toEqual([]);
});
