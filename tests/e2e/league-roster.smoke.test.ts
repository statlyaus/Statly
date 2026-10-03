import { expect, test } from '@playwright/test';

import {
  authenticateAsDevelopmentUser,
  collectRuntimeErrors,
  expectNoAppErrorBoundary,
} from './helpers/devAuth';
import { E2E_LEAGUE_ID } from './global.setup';

const leagueId = process.env.STATLY_E2E_LEAGUE_ID ?? E2E_LEAGUE_ID;

test('old roster links open My Team with the squad and the round lineup', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await authenticateAsDevelopmentUser(page);
  await page.goto(`/leagues/${leagueId}?tab=roster`);

  await expect(page.getByRole('heading', { level: 2, name: 'My team' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'My Team' })).toHaveAttribute(
    'aria-current',
    'page'
  );
  await expect(page.getByRole('button', { name: 'My Roster' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Optimize' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Lineup readiness' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { level: 2, name: 'My team' })).toBeVisible();
  await expectNoAppErrorBoundary(page);
  expect(runtimeErrors).toEqual([]);
});
