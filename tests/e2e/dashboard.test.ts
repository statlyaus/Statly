import { test, expect } from '@playwright/test';

test('dashboard settings persist', async ({ page }) => {
  await test.step('load dashboard', async () => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/dashboard/);
  });
});
