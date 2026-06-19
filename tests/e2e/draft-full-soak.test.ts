import { expect, test } from '@playwright/test';

import {
  authenticateAsDevelopmentUser,
  collectRuntimeErrors,
  expectNoAppErrorBoundary,
} from './helpers/devAuth';
import { seedFullDraftSoakFixture } from './helpers/fullDraftSoakFixture';

test('completes a fresh 12-team draft and reconciles rosters/history without freezing', async ({
  page,
}) => {
  test.setTimeout(180_000);

  const fixture = await seedFullDraftSoakFixture();
  const runtimeErrors = collectRuntimeErrors(page);
  await authenticateAsDevelopmentUser(page);

  await page.goto(`/drafts/${fixture.draftId}`);
  await expect(page.locator('body')).toContainText('Pick 1 of 264');
  await expectNoAppErrorBoundary(page);

  const renderedRows = await page.locator('tbody tr').count();
  expect(renderedRows).toBeLessThan(90);

  const firstSelectButton = page.getByRole('button', { name: /^Select / }).first();
  const playerReadyStart = Date.now();
  await expect(firstSelectButton).toBeEnabled();
  expect(Date.now() - playerReadyStart).toBeLessThan(5000);

  const selectStart = Date.now();
  await firstSelectButton.click();
  await expect(page.locator('body')).toContainText('Pick 2 of 264');
  expect(Date.now() - selectStart).toBeLessThan(5000);

  const firstPickResponse = await page.request.get(`/api/drafts/${fixture.draftId}/picks?pageSize=1`);
  expect(firstPickResponse.ok()).toBe(true);
  const firstPickPayload = await firstPickResponse.json();
  const firstPickedPlayerId = firstPickPayload.data.picks[0].player.id;

  const secondPick = await page.request.post(`/api/drafts/${fixture.draftId}/auto-pick`, {
    headers: { authorization: 'Bearer dev:statly-dev-tester' },
  });
  expect(secondPick.ok()).toBe(true);
  const secondPayload = await secondPick.json();
  expect(secondPayload.data.wasQueued).toBe(true);
  expect(secondPayload.data.pick.player.id).toBe(fixture.queuedBotPlayerId);

  const thirdPick = await page.request.post(`/api/drafts/${fixture.draftId}/auto-pick`, {
    headers: { authorization: 'Bearer dev:statly-dev-tester' },
  });
  expect(thirdPick.ok()).toBe(true);
  const thirdPayload = await thirdPick.json();
  const expectedThirdPickPlayerId = fixture.rankedPlayerIds.find(
    (playerId) => ![firstPickedPlayerId, fixture.queuedBotPlayerId].includes(playerId)
  );
  expect(thirdPayload.data.pick.player.id).toBe(expectedThirdPickPlayerId);

  for (let pick = 4; pick <= fixture.totalPicks; pick += 1) {
    const response = await page.request.post(`/api/drafts/${fixture.draftId}/auto-pick`, {
      headers: { authorization: 'Bearer dev:statly-dev-tester' },
    });
    expect(response.ok()).toBe(true);
  }

  await page.goto(`/drafts/${fixture.draftId}`);
  await expect(page.getByText('Draft is complete')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Review completed draft' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Review my roster' })).toBeVisible();
  await expectNoAppErrorBoundary(page);

  await page.goto(`/drafts/history/${fixture.draftId}`);
  await expect(page.locator('body')).toContainText('264');
  await expectNoAppErrorBoundary(page);

  await page.goto(`/leagues/${fixture.leagueId}?tab=roster`);
  await expect(page.getByRole('heading', { name: 'Robbo Rockers' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Robbo Rockers roster table' })).toBeVisible();
  await expect(page.getByText('No Team Selected')).toHaveCount(0);
  await expectNoAppErrorBoundary(page);

  expect(runtimeErrors).toEqual([]);
});
