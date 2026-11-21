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
 * Area palettes still owned by later tickets are skipped by selector. Each ticket deletes its own
 * entry when it lands; an entry that skips nothing across the pages fails, so none can linger. Only
 * the league palette (08) reaches these pages today; the social (09), trade centre (10a) and draft
 * room (10b) pages join PAGES, with no exclusion, when those tickets land.
 */
const AREA_EXCLUSIONS = [
  { ticket: '08', area: 'league', selector: '[class*="--league-"]' },
] as const;

/**
 * Most elements an exclusion may skip on each page, at any width. These numbers may only fall:
 * lower one when a page sheds area palette, never raise one to make a page pass.
 */
const PAGES: ReadonlyArray<{
  path: string;
  ready: (page: Page) => Promise<void>;
  ceiling: number;
}> = [
  { path: '/dashboard', ready: heading(1), ceiling: 0 },
  { path: `/leagues/${E2E_LEAGUE_ID}`, ready: heading(1), ceiling: 0 },
  {
    path: `/leagues/${E2E_LEAGUE_ID}?tab=roster`,
    ready: heading(3, 'On the field'),
    ceiling: 21,
  },
  // The seeded round 1 result: the ladder and the category table must be on screen.
  { path: `/leagues/${E2E_LEAGUE_ID}?tab=standings`, ready: text('AFL Legends'), ceiling: 1 },
  {
    path: `/leagues/${E2E_LEAGUE_ID}?tab=matchups`,
    ready: async (page) => {
      await expect(page.getByRole('table', { name: /totals by scoring category/i })).toBeVisible();
    },
    ceiling: 124,
  },
  {
    path: `/leagues/${WAIVER_SCENARIO.leagueId}?tab=waivers`,
    ready: text(WAIVER_SCENARIO.freeAgentName),
    ceiling: 1,
  },
  { path: '/players', ready: heading(1), ceiling: 0 },
  { path: `/players/${E2E_PLAYER_ID}`, ready: heading(1), ceiling: 0 },
];

function text(words: string) {
  return async (page: Page) => {
    await expect(page.locator('main').getByText(words).first()).toBeVisible();
  };
}

function heading(level: number, name?: string) {
  return async (page: Page) => {
    await expect(page.getByRole('heading', { level, name }).first()).toBeVisible();
  };
}

const selectors = AREA_EXCLUSIONS.map((exclusion) => exclusion.selector);

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
      const skippedInRun = AREA_EXCLUSIONS.map(() => 0);

      for (const { path, ready, ceiling } of PAGES) {
        await test.step(path, async () => {
          await page.goto(path);
          await ready(page);
          const { findings, skipped } = await auditPage(page, selectors);
          skipped.forEach((count, index) => (skippedInRun[index]! += count));
          expect.soft(findings, path).toEqual(EMPTY);
          const total = skipped.reduce((sum, count) => sum + count, 0);
          expect
            .soft(total, `${path}: elements skipped as area palette`)
            .toBeLessThanOrEqual(ceiling);
        });
      }

      AREA_EXCLUSIONS.forEach(({ ticket, area }, index) => {
        expect(
          skippedInRun[index],
          `no ${area} palette left on the audited pages: ticket ${ticket} landed, delete its exclusion`
        ).toBeGreaterThan(0);
      });
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
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    const { findings } = await auditPage(page);
    expect.soft(findings, `/login at ${viewport.width}px`).toEqual(EMPTY);
  }
});
