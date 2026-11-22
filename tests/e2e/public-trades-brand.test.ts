import { expect, test, type Page } from '@playwright/test';

import { auditPage, EMPTY } from './helpers/brandAudit';

/**
 * Brand conformance of the public trade pages (docs/product/style-guide.md), element by element: see
 * `helpers/brandAudit.ts` for the rules. Anything inside `[data-collage]` is skipped: the story
 * collage exception (home hero, the Cameron story teaser) and the trade page head and scarf that
 * the owner is redesigning (ticket 06h).
 */

async function expectConformant(page: Page, path: string) {
  await page.goto(path);
  const { findings } = await auditPage(page);
  expect.soft(findings, path).toEqual(EMPTY);
}

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 1024, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
]) {
  test.describe(`public trade pages follow the brand at ${viewport.width}px`, () => {
    test.use({ viewport });

    test('front page, trade list, a trade, a club and the method', async ({ page }) => {
      test.setTimeout(240_000);

      await page.goto('/afl/trades');
      const trade = await page
        .locator('main a[href^="/afl/trades/"]:not([href*="/clubs/"]):not([href$="/method"])')
        .first()
        .getAttribute('href');
      expect(trade, 'a trade link on the list').toBeTruthy();
      await page.goto(trade!);
      const club = await page
        .locator('main a[href^="/afl/trades/clubs/"]')
        .first()
        .getAttribute('href');
      expect(club, 'a club chains link on the trade page').toBeTruthy();

      for (const path of ['/', '/afl/trades', trade!, club!, '/afl/trades/method']) {
        await test.step(path, () => expectConformant(page, path));
      }
    });
  });
}

// The public draft hub (ticket 07p). With no outcomes database here, each route shows the hub's
// unavailable state, so this audits the hub header, its nav and that state; the explorers and the
// clubs directory render only against real data and are checked on production after deploy.
for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`the public draft hub follows the brand at ${viewport.width}px`, () => {
    test.use({ viewport });

    test('drafts, trades and clubs', async ({ page }) => {
      test.setTimeout(240_000);
      for (const path of ['/draft/drafts', '/draft/trades', '/draft/clubs']) {
        await test.step(path, () => expectConformant(page, path));
      }
    });
  });
}
