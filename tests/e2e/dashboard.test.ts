import { test, expect } from '@playwright/test';
import {
  authenticateAsDevelopmentUser,
  collectRuntimeErrors,
  expectNoAppErrorBoundary,
} from './helpers/devAuth';

test('dashboard loads for the local development user', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await authenticateAsDevelopmentUser(page);

  await test.step('load dashboard', async () => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/dashboard/);
    await expectNoAppErrorBoundary(page);
    expect(runtimeErrors).toEqual([]);
  });
});

test('leagues hub resolves to the dashboard for the local development user', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await authenticateAsDevelopmentUser(page);

  await page.goto('/leagues');
  await expect(page).toHaveURL(/\/dashboard/);
  await expectNoAppErrorBoundary(page);
  expect(runtimeErrors).toEqual([]);
});
