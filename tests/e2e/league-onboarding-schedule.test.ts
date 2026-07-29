import { expect, test } from '@playwright/test';

import {
  authenticateAsDevelopmentUser,
  collectRuntimeErrors,
  expectNoAppErrorBoundary,
} from './helpers/devAuth';

test('creates a league after scheduling the draft with keyboard controls', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await authenticateAsDevelopmentUser(page);

  await page.goto('/leagues/new');
  await expect(page.getByRole('heading', { name: 'Create a new league' })).toBeVisible();
  await page.getByLabel('League name').fill('E2E Keyboard League');

  const addSchedule = page.getByRole('button', { name: 'Add draft schedule' });
  await addSchedule.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Schedule later' })).toBeFocused();

  const tomorrowChoice = page.getByRole('button', {
    name: 'Schedule the draft for tomorrow at 7:00 pm',
  });
  await tomorrowChoice.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Start time')).toHaveValue('19:00');
  await expect(page.getByText('Draft starts').locator('..')).toContainText('7:00 pm');

  const createLeague = page.getByRole('button', { name: 'Create league' });
  await createLeague.focus();
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/leagues\/[^/]+$/);
  await expectNoAppErrorBoundary(page);
  expect(runtimeErrors).toEqual([]);
});
