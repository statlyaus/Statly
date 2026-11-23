import { expect, test, type Page } from '@playwright/test';

import { auditPage, EMPTY } from './helpers/brandAudit';
import { axeViolations } from './helpers/axe';
import { authenticateAsDevelopmentUser } from './helpers/devAuth';
import { removeFinishedRound, seedFinishedRound } from './helpers/matchupScenarioFixture';
import { seedWaiverScenario, WAIVER_SCENARIO } from './helpers/waiverScenarioFixture';
import { E2E_DRAFT_ID, E2E_LEAGUE_ID, E2E_PLAYER_ID } from './global.setup';

/**
 * Brand conformance of the signed-in fantasy app (docs/product/style-guide.md), with the same
 * element-by-element audit as the public trade pages (`helpers/brandAudit.ts`).
 *
 * Nothing is skipped: the league (08), social (09), trade centre (10a) and draft room (10b) palettes
 * are gone.
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
  // League social (ticket 09): chat, the message board and activity.
  { path: `/leagues/${E2E_LEAGUE_ID}/social`, ready: heading(1) },
  { path: `/leagues/${E2E_LEAGUE_ID}/social?view=board`, ready: heading(2, 'Message board') },
  { path: `/leagues/${E2E_LEAGUE_ID}/social?view=activity`, ready: heading(2) },
  // Trade centre (ticket 10a): the offers list.
  { path: `/leagues/${E2E_LEAGUE_ID}?tab=trades`, ready: heading(2, 'Trades') },
  // Draft room (ticket 10b): the seeded draft, live or complete.
  {
    path: `/drafts/${E2E_DRAFT_ID}`,
    ready: async (page) => {
      await expect(page.locator('body')).toContainText(
        /Pick \d+ of \d+|Draft is complete|Draft room is ready/,
        { timeout: 30_000 }
      );
    },
  },
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

    test('dashboard, league, My Team, standings, matchups, waivers, players, social, trades and the draft room', async ({
      page,
    }) => {
      test.setTimeout(480_000);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await authenticateAsDevelopmentUser(page);

      for (const { path, ready } of PAGES) {
        await test.step(path, async () => {
          await page.goto(path);
          await ready(page);
          const { findings } = await auditPage(page);
          expect.soft(findings, path).toEqual(EMPTY);
          expect.soft(await axeViolations(page), `${path} (axe)`).toEqual([]);
        });
      }
    });
  });
}

// The league switcher sits in the cobalt header only from 1536px (`2xl`), so neither width above shows it.
test('the wide desktop header, with the league switcher, follows the brand', async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1536, height: 900 });
  await authenticateAsDevelopmentUser(page);
  await page.goto('/dashboard');
  await heading(1)(page);
  // The switcher is a stone chip on the cobalt bar: it must carry ink words, not the bar's white.
  const switcher = page.getByRole('banner').locator('[aria-haspopup="dialog"]').first();
  await expect(switcher).toBeVisible({ timeout: 30_000 });
  await expect(switcher).toHaveCSS('color', 'rgb(17, 17, 17)');
  const { findings } = await auditPage(page);
  expect.soft(findings, '/dashboard at 1536px').toEqual(EMPTY);
});

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

// The chat launcher and the panel it opens float over every league page.
test('the league chat launcher and panel follow the brand', async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await authenticateAsDevelopmentUser(page);
  await page.goto(`/leagues/${E2E_LEAGUE_ID}`);
  await heading(1)(page);
  await page.getByRole('button', { name: /open league chat/i }).click();
  await expect(page.getByLabel('League chat panel')).toBeVisible({ timeout: 30_000 });
  const { findings } = await auditPage(page);
  expect.soft(findings, 'league chat panel').toEqual(EMPTY);
});

// The trade composer: both rosters, the selection tray and the sticky summary.
test('the trade composer follows the brand', async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await authenticateAsDevelopmentUser(page);
  await page.goto(`/leagues/${E2E_LEAGUE_ID}?tab=trades`);
  await heading(2, 'Trades')(page);
  await page.getByRole('button', { name: 'Propose trade' }).click();
  await expect(page.getByLabel('Trade with')).toBeVisible({ timeout: 30_000 });
  const { findings } = await auditPage(page);
  expect.soft(findings, 'trade composer').toEqual(EMPTY);
});
