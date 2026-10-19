import { expect, test } from '@playwright/test';

import { authenticateAsDevelopmentUser, expectNoAppErrorBoundary } from './helpers/devAuth';
import {
  WAIVER_SCENARIO,
  makeWaiverClaimsDue,
  readWaiverOwner,
  seedWaiverScenario,
} from './helpers/waiverScenarioFixture';

const { leagueId, commissioner, rival, freeAgentName } = WAIVER_SCENARIO;

test('the higher FAAB bid wins the player, is charged, and the outcome shows in League Activity', async ({
  page,
}) => {
  test.setTimeout(90_000);

  await seedWaiverScenario();
  const serverErrors: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 500) {
      serverErrors.push(`${response.status()} ${response.url()}`);
    }
  });
  await authenticateAsDevelopmentUser(page);

  await page.goto(`/leagues/${leagueId}?tab=waivers`);
  await expect(page.getByRole('heading', { name: 'Waiver Wire' })).toBeVisible();
  await expect(page.getByText('No active waiver claims.')).toBeVisible();

  await page.getByRole('button', { name: `Claim ${freeAgentName}` }).click();
  await page.getByLabel('FAAB bid').fill(String(commissioner.bid));
  await page.getByRole('button', { name: `Submit claim for ${freeAgentName}` }).click();
  await page.getByRole('button', { name: 'Place bid' }).click();

  const myClaims = page.locator('section', {
    has: page.getByRole('heading', { name: 'My Claims' }),
  });
  await expect(myClaims.getByText(`Add ${freeAgentName}`)).toBeVisible();
  await expect(myClaims.getByText('Pending', { exact: true })).toBeVisible();
  await expect(myClaims.getByText('No active waiver claims.')).toHaveCount(0);
  // Claims are private until waivers run: the rival's bid is not on this page.
  await expect(page.locator('body')).not.toContainText(rival.teamName);

  await page.reload();
  await expect(myClaims.getByText(`Add ${freeAgentName}`)).toBeVisible();
  await expect(myClaims.getByText('Pending', { exact: true })).toBeVisible();

  expect(await makeWaiverClaimsDue()).toBe(2);
  const processed = await page.request.post(`/api/leagues/${leagueId}/waivers/process`);
  expect(processed.status()).toBe(200);
  expect(await processed.json()).toMatchObject({ processed: 2 });
  expect(await readWaiverOwner()).toBe(commissioner.memberId);

  await page.reload();
  const balance = page
    .getByText('FAAB Remaining', { exact: true })
    .locator('xpath=following-sibling::div');
  await expect(balance).toHaveText(`$${WAIVER_SCENARIO.faabBudget - commissioner.bid}`);

  const activity = page.locator('section', {
    has: page.getByRole('heading', { name: 'League Activity' }),
  });
  await expect(activity).toContainText(`${commissioner.teamName} claimed ${freeAgentName}`);
  await expect(activity).toContainText(`${rival.teamName} missed out on ${freeAgentName}`);

  // A run after the first has finished finds nothing left to settle.
  const secondRun = await page.request.post(`/api/leagues/${leagueId}/waivers/process`);
  expect(secondRun.status()).toBe(200);
  expect(await secondRun.json()).toMatchObject({ processed: 0 });

  await expectNoAppErrorBoundary(page);
  expect(serverErrors).toEqual([]);
});
