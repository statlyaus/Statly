import { expect, test, type Page } from '@playwright/test';

import { auditPage, EMPTY } from './helpers/brandAudit';
import { authenticateAsDevelopmentUser } from './helpers/devAuth';
import { removeFinishedRound, seedFinishedRound } from './helpers/matchupScenarioFixture';
import { seedWaiverScenario, WAIVER_SCENARIO } from './helpers/waiverScenarioFixture';
import { E2E_LEAGUE_ID, E2E_PLAYER_ID } from './global.setup';

/**
 * Brand conformance of the signed-in fantasy app (docs/product/style-guide.md), with the same
 * element-by-element audit as the public trade pages (`helpers/brandAudit.ts`).
 *
 * Nothing is skipped: the league palette is gone (ticket 08). The social (09), trade centre (10a) and
 * draft room (10b) pages join PAGES when those tickets land.
 */
const PAGES: ReadonlyArray<{
  path: string;
  ready: (page: Page) => Promise<void>;
}> = [
  { path: '/dashboard', ready: heading(1) },
  { path: `/leagues/${E2E_LEAGUE_ID}`, ready: heading(1) },
  {
    path: `/leagues/${E2E_LEAGUE_ID}?tab=roster`,
    ready: heading(3, 'On the field'),
  },
  // The seeded round 1 result: the ladder and the category table must be on screen.
  { path: `/leagues/${E2E_LEAGUE_ID}?tab=standings`, ready: text('AFL Legends') },
  {
    path: `/leagues/${E2E_LEAGUE_ID}?tab=matchups`,
    ready: async (page) => {
      await expect(page.getByRole('table', { name: /totals by scoring category/i })).toBeVisible({
        timeout: 30_000,
      });
    },
  },
  {
    path: `/leagues/${WAIVER_SCENARIO.leagueId}?tab=waivers`,
    ready: text(WAIVER_SCENARIO.freeAgentName),
  },
  { path: '/players', ready: heading(1) },
  { path: `/players/${E2E_PLAYER_ID}`, ready: heading(1) },
];

function text(words: string) {
  return async (page: Page) => {
    await expect(page.locator('main').getByText(words).first()).toBeVisible({ timeout: 30_000 });
  };
}

function heading(level: number, name?: string) {
  return async (page: Page) => {
    await expect(page.getByRole('heading', { level, name }).first()).toBeVisible({
      timeout: 30_000,
    });
  };
}

test.beforeAll(async () => {
  await seedFinishedRound();
  await seedWaiverScenario();
});

test.afterAll(async () => {
  await removeFinishedRound();
});

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`the fantasy app follows the brand at ${viewport.width}px`, () => {
    test.use({ viewport });

    test('dashboard, league, My Team, standings, matchups, waivers and players', async ({
      page,
    }) => {
      test.setTimeout(300_000);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await authenticateAsDevelopmentUser(page);

      for (const { path, ready } of PAGES) {
        await test.step(path, async () => {
          await page.goto(path);
          await ready(page);
          const { findings } = await auditPage(page);
          expect.soft(findings, path).toEqual(EMPTY);
        });
      }
    });
  });
}

test('the sign-in page follows the brand', async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 30_000 });
    const { findings } = await auditPage(page);
    expect.soft(findings, `/login at ${viewport.width}px`).toEqual(EMPTY);
  }
});
