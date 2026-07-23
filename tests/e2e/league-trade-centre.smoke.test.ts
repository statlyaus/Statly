import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  authenticateAsDevelopmentUser,
  collectRuntimeErrors,
  expectNoAppErrorBoundary,
} from './helpers/devAuth';
import { E2E_LEAGUE_ID } from './global.setup';

const leagueId = process.env.STATLY_E2E_LEAGUE_ID ?? E2E_LEAGUE_ID;

const viewports = [
  { name: 'wide desktop', width: 1920, height: 1000 },
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'tablet', width: 1024, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

test('trade centre remains usable and responsive across supported viewports', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await authenticateAsDevelopmentUser(page);
  await page.goto(`/leagues/${leagueId}?tab=trades`);

  const sendRoster = rosterSection(page, 'Robbo Rockers sends');
  const receiveRoster = rosterSection(page, 'AFL Legends sends');
  const selectionTray = page.locator('[data-trade-selection-tray]');
  const composerContent = page.locator('[data-trade-composer-content]');

  await expect(page.getByRole('heading', { name: 'Trade Centre' })).toBeVisible();
  await expect(page.getByLabel('Trade partner')).toHaveValue('e2e-member-bot');

  for (const viewport of viewports) {
    await test.step(viewport.name, async () => {
      await page.setViewportSize(viewport);
      await composerContent.evaluate((element) => element.scrollTo({ top: 0 }));

      if (viewport.name === 'mobile') {
        await assertMobileRosterSwitch(page, sendRoster, receiveRoster);
      } else {
        await expect(sendRoster).toBeVisible();
        await expect(receiveRoster).toBeVisible();
      }

      await assertMajorControlsAreTouchSized(page, viewport.name === 'mobile');
      await assertNoPageLevelHorizontalOverflow(page);
      await assertRosterTableScrollsInternally(page, 'Robbo Rockers');
      if (viewport.name !== 'mobile') {
        await assertRosterTableScrollsInternally(page, 'AFL Legends');
      }
      await assertPersistentSelectionTray(composerContent, selectionTray);
    });
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await composerContent.evaluate((element) => element.scrollTo({ top: 0 }));
  await expect(sendRoster).toBeVisible();
  await expect(receiveRoster).toBeVisible();

  await sendRoster.getByRole('checkbox', { name: /Darcy Cameron/ }).check();
  await receiveRoster.getByRole('checkbox', { name: /Zach Merrett/ }).check();

  await expect(sendRoster.getByRole('row', { name: /Darcy Cameron/ })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(receiveRoster.getByRole('row', { name: /Zach Merrett/ })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(page.getByText('2 players selected')).toBeVisible();
  await expect(page.getByText('Ready to review')).toBeVisible();

  await page.getByRole('button', { name: 'Review trade' }).click();
  await expect(page.getByRole('heading', { name: 'Review trade proposal' })).toBeFocused();

  const sendingPackage = page.getByRole('region', { name: 'You send package' });
  const receivingPackage = page.getByRole('region', { name: 'You receive package' });
  await expect(sendingPackage).toContainText('Robbo Rockers');
  await expect(sendingPackage).toContainText('Darcy Cameron');
  await expect(receivingPackage).toContainText('AFL Legends');
  await expect(receivingPackage).toContainText('Zach Merrett');
  await expect(page.getByText('average per selected player, per game')).toBeVisible();

  await page.getByRole('button', { name: 'Back to edit' }).click();
  await expect(page.getByRole('heading', { name: 'Robbo Rockers sends' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review trade' })).toBeFocused();
  await expect(sendRoster.getByRole('row', { name: /Darcy Cameron/ })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(receiveRoster.getByRole('row', { name: /Zach Merrett/ })).toHaveAttribute(
    'aria-selected',
    'true'
  );

  await expectNoAppErrorBoundary(page);
  expect(runtimeErrors).toEqual([]);
});

async function assertMobileRosterSwitch(
  page: Page,
  sendRoster: Locator,
  receiveRoster: Locator
): Promise<void> {
  const rosterSwitch = page.getByRole('group', { name: 'Choose roster' });
  const sendButton = rosterSwitch.getByRole('button', {
    name: /Send Robbo Rockers, \d+ selected/i,
  });
  const receiveButton = rosterSwitch.getByRole('button', {
    name: /Receive AFL Legends, \d+ selected/i,
  });

  await expect(rosterSwitch).toBeVisible();
  await sendButton.click();
  await expect(sendButton).toHaveAttribute('aria-pressed', 'true');
  await expect(receiveButton).toHaveAttribute('aria-pressed', 'false');
  await expect(sendRoster).toBeVisible();
  await expect(receiveRoster).toBeHidden();

  await receiveButton.click();
  await expect(sendButton).toHaveAttribute('aria-pressed', 'false');
  await expect(receiveButton).toHaveAttribute('aria-pressed', 'true');
  await expect(sendRoster).toBeHidden();
  await expect(receiveRoster).toBeVisible();

  await sendButton.click();
  await expect(sendButton).toHaveAttribute('aria-pressed', 'true');
  await expect(sendRoster).toBeVisible();
  await expect(receiveRoster).toBeHidden();
}

async function assertMajorControlsAreTouchSized(page: Page, mobile: boolean): Promise<void> {
  const controls = [
    page.getByLabel('Trade partner'),
    page.getByRole('button', { name: 'Clear selected players' }),
    page.getByRole('button', { name: 'Review trade' }),
    page.getByRole('searchbox', { name: 'Search Robbo Rockers roster' }),
  ];

  if (mobile) {
    controls.push(
      page.getByRole('button', { name: /Send Robbo Rockers, \d+ selected/i }),
      page.getByRole('button', { name: /Receive AFL Legends, \d+ selected/i })
    );
  } else {
    controls.push(page.getByRole('searchbox', { name: 'Search AFL Legends roster' }));
  }

  for (const control of controls) {
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box, 'major control should have a measurable box').not.toBeNull();
    expect(box!.height, 'major controls should be at least 44px high').toBeGreaterThanOrEqual(44);
  }
}

async function assertNoPageLevelHorizontalOverflow(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));

  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
}

async function assertRosterTableScrollsInternally(page: Page, teamName: string): Promise<void> {
  const scrollRegion = page.getByLabel(`${teamName} roster table, horizontally scrollable`);
  await expect(scrollRegion).toBeVisible();

  const widths = await scrollRegion.evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
    overflowX: getComputedStyle(element).overflowX,
  }));

  expect(widths.scroll).toBeGreaterThan(widths.client);
  expect(['auto', 'scroll']).toContain(widths.overflowX);
}

async function assertPersistentSelectionTray(
  composerContent: Locator,
  selectionTray: Locator
): Promise<void> {
  await expect(selectionTray).toBeInViewport();
  const initialBox = await selectionTray.boundingBox();
  expect(initialBox, 'selection tray should have a measurable box').not.toBeNull();

  await composerContent.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
  await expect
    .poll(() => composerContent.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await expect(selectionTray).toBeInViewport();

  const scrolledBox = await selectionTray.boundingBox();
  expect(
    scrolledBox,
    'selection tray should remain measurable after inner scrolling'
  ).not.toBeNull();
  expect(Math.abs(scrolledBox!.y - initialBox!.y)).toBeLessThanOrEqual(1);
}

function rosterSection(page: Page, heading: string): Locator {
  return page
    .getByRole('heading', { name: heading, includeHidden: true })
    .locator('xpath=ancestor::section[1]');
}
