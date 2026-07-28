import { expect, test } from '@playwright/test';
import {
  collectRuntimeErrors,
  DEVELOPMENT_PASSWORD,
  DEVELOPMENT_USER,
  expectNoAppErrorBoundary,
} from './helpers/devAuth';

test('development login reaches the dashboard without a runtime error', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);

  await page.goto('/login?callbackUrl=/dashboard');
  await expect(page.getByRole('heading', { name: 'Sign in to Statly' })).toBeVisible();

  await page.getByLabel('Email Address').fill(DEVELOPMENT_USER.email);
  await page.locator('input#password').fill(DEVELOPMENT_PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  await expectNoAppErrorBoundary(page);
  expect(runtimeErrors).toEqual([]);
});

test('development login honors a preserved deep-link path and query', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  const destination = '/leagues/e2e-completed-league/social?view=board';

  await page.goto(`/login?next=${encodeURIComponent(destination)}`);
  await expect(page.getByRole('heading', { name: 'Sign in to Statly' })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('next')).toBe(destination);

  await page.getByLabel('Email Address').fill(DEVELOPMENT_USER.email);
  await page.locator('input#password').fill(DEVELOPMENT_PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();

  await expect(page).toHaveURL(new RegExp(`${destination.replace('?', '\\?')}$`));
  await expectNoAppErrorBoundary(page);
  expect(runtimeErrors).toEqual([]);
});
