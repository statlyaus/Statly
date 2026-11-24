import { expect, test } from '@playwright/test';

import { axeViolations } from './helpers/axe';
import { auditPage, EMPTY } from './helpers/brandAudit';

/**
 * The living style guide (`/dev/styleguide`, docs/product/style-guide.md phase 6) renders every
 * token, ground and control recipe, so the brand audit and axe on it check them all at once. The red
 * swatches and danger buttons are skipped by `data-specimen="red"`: red is right there (destructive,
 * live), but the audit only knows the live and alert exceptions.
 */
for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`the style guide follows the brand at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize(viewport);
    await page.goto('/dev/styleguide');
    await expect(page.getByRole('heading', { level: 1, name: 'Style guide' })).toBeVisible({
      timeout: 30_000,
    });
    // Every token value resolved in the browser.
    await expect(page.locator('main code', { hasText: '…' })).toHaveCount(0);
    const { findings, skipped } = await auditPage(page, ['[data-specimen="red"]']);
    expect.soft(findings).toEqual(EMPTY);
    expect.soft(skipped[0]).toBeGreaterThan(0);
    expect.soft(await axeViolations(page)).toEqual([]);
    // Reflow: no sideways scroll at either width.
    expect
      .soft(await page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(viewport.width);
  });
}
