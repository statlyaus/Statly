import { expect, test } from '@playwright/test';

import { E2E_DRAFT_ID, E2E_PLAYER_ID } from './global.setup';
import {
  authenticateAsDevelopmentUser,
  collectRuntimeErrors,
  expectNoAppErrorBoundary,
  expectNoPageLevelHorizontalOverflow,
} from './helpers/devAuth';

test.describe('shared app shell at 390px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('keeps public and auth routes outside the protected shell', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-app-shell]')).toHaveCount(0);
    await expect(page.locator('#main-content')).toHaveCount(1);
    await expectNoPageLevelHorizontalOverflow(page);

    await page.goto('/login');
    await expect(page.locator('[data-app-shell]')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Sign in to Statly' })).toBeVisible();
    await expectNoPageLevelHorizontalOverflow(page);
  });

  test('renders one responsive shell across representative protected routes', async ({ page }) => {
    const runtimeErrors = collectRuntimeErrors(page);
    await authenticateAsDevelopmentUser(page);

    const protectedRoutes = [
      '/drafts',
      '/scheduling',
      '/help',
      '/team-analytics',
      `/players/${E2E_PLAYER_ID}`,
      '/live-scoring',
      '/commissioner',
      '/rosters',
    ];

    for (const route of protectedRoutes) {
      await test.step(route, async () => {
        await page.goto(route);
        if (route.startsWith('/players/')) {
          await expect(page.getByRole('heading', { name: 'Darcy Cameron' })).toBeVisible();
        }
        await expect(page.locator('[data-app-shell]')).toHaveCount(1);
        await expect(page.getByRole('banner')).toHaveCount(1);
        await expect(page.locator('#main-content')).toHaveCount(1);
        await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
        await expectNoAppErrorBoundary(page);
        await expectNoPageLevelHorizontalOverflow(page);
      });
    }

    expect(runtimeErrors).toEqual([]);
  });

  test('keeps the live draft room immersive', async ({ page }) => {
    const runtimeErrors = collectRuntimeErrors(page);
    await authenticateAsDevelopmentUser(page);

    await page.goto(`/drafts/${E2E_DRAFT_ID}`);

    await expect(page.locator('body')).toContainText(
      /Pick \d+ of \d+|Draft is complete|Draft room is ready/
    );
    await expect(page.locator('[data-app-shell]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open navigation' })).toHaveCount(0);
    await expectNoAppErrorBoundary(page);
    await expectNoPageLevelHorizontalOverflow(page);
    expect(runtimeErrors).toEqual([]);
  });
});

for (const width of [1440, 1536]) {
  test(`keeps the immersive draft room within a ${width}px viewport`, async ({ page }) => {
    const runtimeErrors = collectRuntimeErrors(page);
    await page.setViewportSize({ width, height: 900 });
    await authenticateAsDevelopmentUser(page);

    await page.goto(`/drafts/${E2E_DRAFT_ID}`);

    await expect(page.locator('body')).toContainText(
      /Pick \d+ of \d+|Draft is complete|Draft room is ready/
    );
    await expect(page.locator('[data-app-shell]')).toHaveCount(0);
    await expectNoAppErrorBoundary(page);
    await expectNoPageLevelHorizontalOverflow(page);
    expect(runtimeErrors).toEqual([]);
  });
}
