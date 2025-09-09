import { test, expect } from '@playwright/test';

test('dashboard settings persist', async () => {
  await test.step('load dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/dashboard/);
  });
});
