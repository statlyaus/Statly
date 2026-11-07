import { expect, test, type Page } from '@playwright/test';

import {
  authenticateAsDevelopmentUser,
  collectRuntimeErrors,
  expectNoAppErrorBoundary,
  expectNoPageLevelHorizontalOverflow,
} from './helpers/devAuth';

// Seeded by tests/e2e/global.setup.ts: league `e2e-bball-league` owned by the development user, with
// my team and an opponent for the current week (five players each) and NBA games this week.
const LEAGUE = '/basketball/e2e-bball-league';

function tableRows(page: Page, region: string) {
  return page.getByRole('region', { name: region }).locator('tbody tr');
}

test.describe('basketball analysis pages', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAsDevelopmentUser(page);
  });

  test('Players lists valued players and tries a punt', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto(`${LEAGUE}/players`);

    await expect(page.getByRole('heading', { level: 1, name: 'Players' })).toBeVisible();
    await expect(tableRows(page, 'Players table').first()).toBeVisible();

    const puntPoints = page.getByRole('button', { name: 'Punt PTS' });
    await expect(puntPoints).toHaveAttribute('aria-pressed', 'false');
    await puntPoints.click();
    await expect(page).toHaveURL(/[?&]punts=PTS/);
    await expect(puntPoints).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Save as league punts' })).toBeVisible();

    await expectNoAppErrorBoundary(page);
    expect(errors).toEqual([]);
  });

  test('Matchup shows every category and moves between weeks', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto(`${LEAGUE}/matchup`);

    await expect(page.getByRole('heading', { level: 1, name: 'Matchup' })).toBeVisible();
    await expect(tableRows(page, 'Categories this week')).not.toHaveCount(0);
    await expect(page.getByText('projected W–L–T')).toBeVisible();

    await page
      .getByRole('navigation', { name: 'Fantasy week' })
      .getByRole('link', { name: /^Next: Week \d+$/ })
      .click();
    await expect(page).toHaveURL(/[?&]week=\d+/);
    await expect(page.getByRole('link', { name: 'This week' })).toBeVisible();

    await expectNoAppErrorBoundary(page);
    expect(errors).toEqual([]);
  });

  test('Pickups compares against this week and changes the drop', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto(`${LEAGUE}/pickups`);

    await expect(page.getByRole('heading', { level: 1, name: 'Pickups' })).toBeVisible();
    await expect(
      page.getByRole('list', { name: 'Categories now' }).getByRole('listitem')
    ).not.toHaveCount(0);
    // Free agents depend on the seed's minutes and injuries: a table with rows, or the empty state.
    await expect(
      tableRows(page, 'Free agents table').first().or(page.getByText('No free agents to show'))
    ).toBeVisible();

    await page.getByLabel('If I drop').selectOption('none');
    await expect(page).toHaveURL(/[?&]drop=none/);

    await expectNoAppErrorBoundary(page);
    expect(errors).toEqual([]);
  });

  test('Trade check nets the categories for a player given away', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto(`${LEAGUE}/trade`);

    await expect(page.getByRole('heading', { level: 1, name: 'Trade check' })).toBeVisible();
    await page.getByRole('group', { name: 'You give' }).getByRole('checkbox').first().check();
    await expect(page).toHaveURL(/[?&]give=/);
    await expect(tableRows(page, 'Trade by category')).not.toHaveCount(0);
    await expect(page.getByText('Net season value for you')).toBeVisible();

    await expectNoAppErrorBoundary(page);
    expect(errors).toEqual([]);
  });

  test('the four pages fit a 390px phone without page-level sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const section of ['players', 'matchup', 'pickups', 'trade']) {
      await page.goto(`${LEAGUE}/${section}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoPageLevelHorizontalOverflow(page);
    }
  });
});
