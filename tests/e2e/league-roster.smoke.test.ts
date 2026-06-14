import { expect, test } from '@playwright/test';
import {
  authenticateAsDevelopmentUser,
  collectRuntimeErrors,
  expectNoAppErrorBoundary,
} from './helpers/devAuth';

const leagueId = process.env.STATLY_E2E_LEAGUE_ID ?? 'cmevh14am001jux1gl87onfgh';

test('league roster pulls through completed team data into the review table', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await authenticateAsDevelopmentUser(page);

  await page.goto(`/leagues/${leagueId}?tab=roster`);

  await expect(page.getByRole('heading', { name: 'Robbo Rockers' })).toBeVisible();
  await expect(page.getByText('Avg Statly Z')).toBeVisible();
  await expect(page.getByText('Scoring Profile')).toBeVisible();
  await expect(page.getByText('Composition')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Robbo Rockers roster table' })).toBeVisible();
  await expect(page.getByText('No Team Selected')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Propose Trade' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Waiver Claims' })).toHaveCount(0);
  await expectNoAppErrorBoundary(page);
  expect(runtimeErrors).toEqual([]);
});
