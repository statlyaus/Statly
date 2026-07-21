import { expect, test } from '@playwright/test';

import {
  authenticateAsDevelopmentUser,
  collectRuntimeErrors,
  expectNoAppErrorBoundary,
} from './helpers/devAuth';
import { E2E_LEAGUE_ID } from './global.setup';

const leagueId = process.env.STATLY_E2E_LEAGUE_ID ?? E2E_LEAGUE_ID;

for (const viewport of [
  { width: 390, height: 844 },
  { width: 768, height: 900 },
]) {
  test(`league overview navigation remains accessible at ${viewport.width}px`, async ({ page }) => {
    const runtimeErrors = collectRuntimeErrors(page);
    await page.setViewportSize(viewport);
    await authenticateAsDevelopmentUser(page);

    await page.goto(`/leagues/${leagueId}`);

    await expect(
      page.getByRole('heading', { level: 1, name: 'Test AFL Champions League' })
    ).toBeVisible();
    await expect(page.getByText('Draft completed', { exact: true })).toBeVisible();
    await expect(page.getByText('Commissioner', { exact: true })).toBeVisible();

    const teams = page.getByRole('list', { name: 'League teams' });
    const currentTeam = teams.getByRole('listitem').filter({ hasText: 'Robbo Rockers' });
    await expect(currentTeam.getByText('Your team', { exact: true })).toBeVisible();

    const leagueNavigation = page.getByRole('navigation', { name: 'League sections' });
    const navigationItems = leagueNavigation.getByRole('button');
    const overview = leagueNavigation.getByRole('button', { name: 'Overview' });
    const leagueSettings = leagueNavigation.getByRole('button', { name: 'League Settings' });

    await expect(leagueNavigation).toBeVisible();
    await expect(overview).toHaveAttribute('aria-current', 'page');
    await expect
      .poll(() => leagueNavigation.evaluate((element) => element.scrollWidth > element.clientWidth))
      .toBe(true);

    await overview.focus();
    const itemCount = await navigationItems.count();
    for (let index = 1; index < itemCount; index += 1) {
      await page.keyboard.press('Tab');
    }

    await expect(leagueSettings).toBeFocused();
    await expect
      .poll(() =>
        leagueNavigation.evaluate((element) => {
          const activeElement = document.activeElement;
          if (!(activeElement instanceof HTMLElement)) return false;

          const navigationBox = element.getBoundingClientRect();
          const activeBox = activeElement.getBoundingClientRect();
          return (
            element.contains(activeElement) &&
            activeBox.left >= navigationBox.left &&
            activeBox.right <= navigationBox.right
          );
        })
      )
      .toBe(true);

    const focusBoxShadow = await leagueSettings.evaluate(
      (element) => window.getComputedStyle(element).boxShadow
    );
    expect(focusBoxShadow).not.toBe('none');

    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(new RegExp(`/leagues/${leagueId}\\?tab=league-settings$`));
    await expect(leagueSettings).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: 'League Settings' })).toBeVisible();
    await expectNoAppErrorBoundary(page);
    expect(runtimeErrors).toEqual([]);
  });
}
