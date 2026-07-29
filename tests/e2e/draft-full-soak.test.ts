import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';

import {
  authenticateAsDevelopmentUser,
  collectRuntimeErrors,
  expectNoAppErrorBoundary,
} from './helpers/devAuth';
import { seedFullDraftSoakFixture } from './helpers/fullDraftSoakFixture';

const MAX_DRAFT_INTERACTION_MS = 10_000;
const MAX_RENDERED_AVAILABLE_PLAYER_ROWS = 120;
const FULL_DRAFT_SOAK_TIMEOUT_MS = 8 * 60_000;
const AUTO_PICK_MAX_ATTEMPTS = 4;
const AUTO_PICK_RETRY_DELAY_MS = 250;

async function expectOkDraftResponse(response: APIResponse, label: string) {
  if (response.ok()) {
    return;
  }

  const body = await response.text();
  throw new Error(`${label} failed with ${response.status()} ${response.statusText()}: ${body}`);
}

function waitForRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function readCanonicalCurrentPick(
  request: APIRequestContext,
  draftId: string
): Promise<number> {
  let lastFailure = 'Draft state request did not complete';

  for (let attempt = 1; attempt <= AUTO_PICK_MAX_ATTEMPTS; attempt += 1) {
    const response = await request.get(`/api/drafts/${draftId}/picks?pageSize=1`, {
      headers: { authorization: 'Bearer dev:statly-dev-tester' },
    });

    if (response.ok()) {
      const payload = await response.json();
      const currentPick = payload?.data?.draftState?.currentPick;
      if (typeof currentPick !== 'number') {
        throw new Error('Canonical draft state response did not include currentPick');
      }
      return currentPick;
    }

    lastFailure = `${response.status()} ${response.statusText()}: ${await response.text()}`;
    await waitForRetry(AUTO_PICK_RETRY_DELAY_MS * attempt);
  }

  throw new Error(`Unable to read canonical draft state: ${lastFailure}`);
}

async function submitConvergentAutoPick(
  request: APIRequestContext,
  draftId: string,
  pick: number
): Promise<void> {
  const expectedCurrentPick = pick + 1;
  let lastFailure = 'Auto-pick request did not complete';

  for (let attempt = 1; attempt <= AUTO_PICK_MAX_ATTEMPTS; attempt += 1) {
    const response = await request.post(`/api/drafts/${draftId}/auto-pick`, {
      headers: { authorization: 'Bearer dev:statly-dev-tester' },
    });

    if (response.ok()) {
      const payload = await response.json();
      expect(payload.data.currentPick, `Auto-pick ${pick} canonical next pick`).toBe(
        expectedCurrentPick
      );
      return;
    }

    lastFailure = `${response.status()} ${response.statusText()}: ${await response.text()}`;
    const canonicalCurrentPick = await readCanonicalCurrentPick(request, draftId);

    if (canonicalCurrentPick === expectedCurrentPick) {
      return;
    }
    if (canonicalCurrentPick !== pick) {
      throw new Error(
        `Auto-pick ${pick} failed and canonical state advanced unexpectedly to pick ${canonicalCurrentPick}: ${lastFailure}`
      );
    }

    await waitForRetry(AUTO_PICK_RETRY_DELAY_MS * attempt);
  }

  throw new Error(`Auto-pick ${pick} did not converge after retries: ${lastFailure}`);
}

test('completes a fresh 12-team draft and reconciles rosters/history without freezing', async ({
  context,
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
  await expect
    .poll(() => playerRows.count())
    .toBeLessThanOrEqual(MAX_RENDERED_AVAILABLE_PLAYER_ROWS);

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

  await page.close();

  for (let pick = 4; pick <= fixture.totalPicks; pick += 1) {
    await submitConvergentAutoPick(context.request, fixture.draftId, pick);
  }

  const verificationPage = await context.newPage();
  const verificationRuntimeErrors = collectRuntimeErrors(verificationPage);

  await verificationPage.goto(`/drafts/${fixture.draftId}`);
  await expect(verificationPage.getByText('Draft is complete')).toBeVisible();
  await expect(
    verificationPage.getByRole('link', { name: 'Review completed draft' })
  ).toBeVisible();
  await expect(verificationPage.getByRole('link', { name: 'Review my roster' })).toBeVisible();
  await expectNoAppErrorBoundary(verificationPage);

  await verificationPage.goto(`/drafts/history/${fixture.draftId}`);
  await expect(verificationPage.locator('body')).toContainText(String(fixture.totalPicks));
  await expectNoAppErrorBoundary(verificationPage);

  await verificationPage.goto(`/leagues/${fixture.leagueId}?tab=roster`);
  await expect(verificationPage.getByRole('heading', { name: 'Robbo Rockers' })).toBeVisible();
  await expect(
    verificationPage.getByRole('table', { name: 'Robbo Rockers roster table' })
  ).toBeVisible();
  await expect(verificationPage.getByText('No Team Selected')).toHaveCount(0);
  await expectNoAppErrorBoundary(verificationPage);

  expect([...runtimeErrors, ...verificationRuntimeErrors]).toEqual([]);
});
