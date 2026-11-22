import { expect, test } from '@playwright/test';

/**
 * The public trade list (/afl/trades): filters in a rail, one row per trade, and the chosen trade open
 * in a preview beside the list. Everything lives in the address, so it works without scripts.
 */

const rows = 'section[aria-labelledby="results-heading"] li > a';
const preview = '#trade-preview';

test.describe('trade list with a preview at 1280px', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('opens the first trade, then the one clicked, and keeps it in the address', async ({
    page,
  }) => {
    await page.goto('/afl/trades?year=all');
    await expect(page.locator(preview).getByText('Where the trade went')).toBeVisible();
    await expect(page.locator(rows).first()).toHaveAttribute('aria-current', 'true');

    const count = await page.locator(rows).count();
    expect(count, 'the sample bundle lists more than one trade').toBeGreaterThan(1);
    const second = page.locator(rows).nth(1);
    const href = await second.getAttribute('href');
    expect(href).toContain('trade=');
    await second.click();
    await expect(page).toHaveURL(/trade=/u);
    await expect(page.locator(rows).nth(1)).toHaveAttribute('aria-current', 'true');
    await expect(page.locator(rows).first()).not.toHaveAttribute('aria-current', 'true');
    await expect(
      page.locator(preview).getByRole('link', { name: 'Open the full trade' })
    ).toBeVisible();
  });

  test('narrows the list to a club from the rail', async ({ page }) => {
    await page.goto('/afl/trades?year=all');
    const rail = page.getByRole('navigation', { name: 'Filter the trades' });
    const club = rail.locator('a[href*="club="]').first();
    const name = (await club.locator('span.truncate').textContent())?.trim() ?? '';
    await club.click();
    await expect(page).toHaveURL(/club=/u);
    await expect(page.locator('#results-heading')).toContainText(name);
    await expect(rail.getByRole('link', { name: 'Clear' })).toBeVisible();
  });
});

test.describe('trade list on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('shows the list, then the chosen trade alone with a way back', async ({ page }) => {
    await page.goto('/afl/trades?year=all');
    await expect(page.locator(preview)).toBeHidden();
    await page.locator(rows).first().click();
    await expect(page).toHaveURL(/trade=/u);
    await expect(page.locator(preview)).toBeVisible();
    await expect(page.locator(rows).first()).toBeHidden();
    await page.getByRole('link', { name: '← All trades' }).click();
    await expect(page).not.toHaveURL(/trade=/u);
    await expect(page.locator(rows).first()).toBeVisible();
  });
});
