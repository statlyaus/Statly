import { expect, test } from '@playwright/test';
import {
  authenticateAsDevelopmentUser,
  collectRuntimeErrors,
  expectNoAppErrorBoundary,
} from './helpers/devAuth';

const draftId = process.env.STATLY_E2E_DRAFT_ID ?? 'cmevh14aq001lux1gottrhp3a';

test('draft room renders its completion or live workflow without runtime errors', async ({
  page,
}) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await authenticateAsDevelopmentUser(page);

  await page.goto(`/drafts/${draftId}`);

  await expect(page.locator('body')).toContainText(
    /Pick \d+ of \d+|Draft is complete|Draft room is ready/
  );
  await expectNoAppErrorBoundary(page);

  const completedDraft = page.getByText('Draft is complete');
  if ((await completedDraft.count()) > 0) {
    await expect(page.getByRole('link', { name: 'Go back to league hub' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Review completed draft' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Review my roster' })).toBeVisible();
  }

  expect(runtimeErrors).toEqual([]);
});
