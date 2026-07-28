import { expect, test, type APIResponse } from '@playwright/test';

import {
  authenticateAsDevelopmentUser,
  collectRuntimeErrors,
  expectNoAppErrorBoundary,
} from './helpers/devAuth';
import { seedFullDraftSoakFixture } from './helpers/fullDraftSoakFixture';

const MAX_DRAFT_INTERACTION_MS = 10_000;
const MAX_RENDERED_AVAILABLE_PLAYER_ROWS = 120;
const FULL_DRAFT_SOAK_TIMEOUT_MS = 5 * 60_000;

async function expectOkDraftResponse(response: APIResponse, label: string) {
  if (response.ok()) {
    return;
  }

  const body = await response.text();
  throw new Error(`${label} failed with ${response.status()} ${response.statusText()}: ${body}`);
}

test('completes a fresh 12-team draft and reconciles rosters/history without freezing', async ({
  page,
}) => {
  test.setTimeout(FULL_DRAFT_SOAK_TIMEOUT_MS);

  const fixture = await seedFullDraftSoakFixture();
  const runtimeErrors = collectRuntimeErrors(page);
  await authenticateAsDevelopmentUser(page);

  await page.goto(`/drafts/${fixture.draftId}`);
  await expect(page.locator('body')).toContainText('Pick 1 of 264');
  await expectNoAppErrorBoundary(page);

  const playerRows = page
    .getByRole('table', { name: 'Available draft players' })
    .locator('tbody tr');
  const renderedRows = await playerRows.count();
  expect(renderedRows).toBeLessThanOrEqual(MAX_RENDERED_AVAILABLE_PLAYER_ROWS);

  const firstSelectButton = page.getByRole('button', { name: /^Select / }).first();
  const playerReadyStart = Date.now();
  await expect(firstSelectButton).toBeEnabled();
  expect(Date.now() - playerReadyStart).toBeLessThan(MAX_DRAFT_INTERACTION_MS);

  const selectStart = Date.now();
  await firstSelectButton.click();
  await expect(page.locator('body')).toContainText('Pick 2 of 264');
  expect(Date.now() - selectStart).toBeLessThan(MAX_DRAFT_INTERACTION_MS);

  const firstPickResponse = await page.request.get(
    `/api/drafts/${fixture.draftId}/picks?pageSize=1`
  );
  expect(firstPickResponse.ok()).toBe(true);
  const firstPickPayload = await firstPickResponse.json();
  const firstPickedPlayerId = firstPickPayload.data.picks[0].player.id;

  const secondPick = await page.request.post(`/api/drafts/${fixture.draftId}/auto-pick`, {
    headers: { authorization: 'Bearer dev:statly-dev-tester' },
  });
  await expectOkDraftResponse(secondPick, 'Auto-pick 2');
  const secondPayload = await secondPick.json();
  expect(secondPayload.data.wasQueued).toBe(true);
  expect(secondPayload.data.pick.player.id).toBe(fixture.queuedBotPlayerId);

  const thirdPick = await page.request.post(`/api/drafts/${fixture.draftId}/auto-pick`, {
    headers: { authorization: 'Bearer dev:statly-dev-tester' },
  });
  await expectOkDraftResponse(thirdPick, 'Auto-pick 3');
  const thirdPayload = await thirdPick.json();
  const expectedThirdPickPlayerId = fixture.rankedPlayerIds.find(
    (playerId) => ![firstPickedPlayerId, fixture.queuedBotPlayerId].includes(playerId)
  );
  expect(thirdPayload.data.pick.player.id).toBe(expectedThirdPickPlayerId);

  for (let pick = 4; pick <= fixture.totalPicks; pick += 1) {
    const response = await page.request.post(`/api/drafts/${fixture.draftId}/auto-pick`, {
      headers: { authorization: 'Bearer dev:statly-dev-tester' },
    });
    await expectOkDraftResponse(response, `Auto-pick ${pick}`);
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
