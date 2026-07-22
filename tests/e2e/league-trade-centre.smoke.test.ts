import { expect, test, type Locator } from '@playwright/test';

import {
  authenticateAsDevelopmentUser,
  collectRuntimeErrors,
  expectNoAppErrorBoundary,
} from './helpers/devAuth';
import { E2E_LEAGUE_ID } from './global.setup';

const leagueId = process.env.STATLY_E2E_LEAGUE_ID ?? E2E_LEAGUE_ID;

const viewports = [
  { name: 'wide desktop', width: 1920, height: 1000, stacked: false },
  { name: 'desktop', width: 1440, height: 1000, stacked: false },
  { name: 'tablet', width: 1024, height: 900, stacked: true },
  { name: 'mobile', width: 390, height: 844, stacked: true },
] as const;

test('trade centre remains usable and responsive across supported viewports', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await authenticateAsDevelopmentUser(page);
  await page.goto(`/leagues/${leagueId}?tab=trades`);

  const sendRoster = rosterSection(page.getByRole('heading', { name: 'You send' }));
  const receiveRoster = rosterSection(
    page.getByRole('heading', { name: 'You receive from AFL Legends' })
  );

  await expect(page.getByRole('heading', { name: 'Trade Centre' })).toBeVisible();
  await expect(page.getByLabel('Trade partner')).toHaveValue('e2e-member-bot');
  await expect(sendRoster).toBeVisible();
  await expect(receiveRoster).toBeVisible();

  for (const viewport of viewports) {
    await test.step(viewport.name, async () => {
      await page.setViewportSize(viewport);
      await expect(page.getByRole('button', { name: 'Send proposal' })).toBeVisible();
      await expect(page.getByLabel('Search roster for you send')).toBeVisible();
      await expect(page.getByLabel('Search roster for you receive from AFL Legends')).toBeVisible();

      const [sendBox, receiveBox, buttonBox, pageWidths] = await Promise.all([
        sendRoster.boundingBox(),
        receiveRoster.boundingBox(),
        page.getByRole('button', { name: 'Send proposal' }).boundingBox(),
        page.evaluate(() => ({
          client: document.documentElement.clientWidth,
          scroll: document.documentElement.scrollWidth,
        })),
      ]);

      expect(sendBox).not.toBeNull();
      expect(receiveBox).not.toBeNull();
      expect(buttonBox?.height).toBeGreaterThanOrEqual(44);
      expect(pageWidths.scroll).toBeLessThanOrEqual(pageWidths.client);

      if (viewport.stacked) {
        expect(receiveBox!.y).toBeGreaterThan(sendBox!.y + sendBox!.height - 2);
      } else {
        expect(Math.abs(receiveBox!.y - sendBox!.y)).toBeLessThan(2);
      }
    });
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('checkbox', { name: /Darcy Cameron/ }).check();
  await page.getByRole('checkbox', { name: /Zach Merrett/ }).check();

  await expect(sendRoster.getByRole('row', { name: /Darcy Cameron/ })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(receiveRoster.getByRole('row', { name: /Zach Merrett/ })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(page.getByRole('heading', { name: 'Package comparison' })).toBeVisible();
  await expect(page.getByText('average per selected player, per game')).toBeVisible();
  await expectNoAppErrorBoundary(page);
  expect(runtimeErrors).toEqual([]);
});

function rosterSection(heading: Locator): Locator {
  return heading.locator('xpath=ancestor::section[1]');
}
