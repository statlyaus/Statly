import { expect, test } from '@playwright/test';

import {
  authenticateAsDevelopmentUser,
  collectRuntimeErrors,
  expectNoAppErrorBoundary,
  expectNoPageLevelHorizontalOverflow,
} from './helpers/devAuth';
import { E2E_LEAGUE_ID } from './global.setup';

test('a league the viewer is not in offers their leagues and a league code instead of an error', async ({
  page,
}) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await authenticateAsDevelopmentUser(page);

  await page.goto('/leagues/e2e-league-you-are-not-in?tab=standings');

  await expect(
    page.getByRole('heading', { level: 1, name: "You're not in this league" })
  ).toBeVisible();
  await expect(page.getByText('Failed to load league')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Enter a league code' })).toHaveAttribute(
    'href',
    '/leagues/join'
  );
  await expect(page.getByRole('link', { name: 'Start a new league' })).toHaveAttribute(
    'href',
    '/leagues/new'
  );
  await expectNoPageLevelHorizontalOverflow(page);

  await expect(
    page
      .getByRole('list', { name: 'Your leagues' })
      .getByRole('link', { name: 'Test AFL Champions League' })
  ).toHaveAttribute('href', `/leagues/${E2E_LEAGUE_ID}`);

  await expectNoAppErrorBoundary(page);
  expect(runtimeErrors).toEqual([]);
});
