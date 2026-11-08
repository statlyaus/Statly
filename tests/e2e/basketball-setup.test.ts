import { expect, test } from '@playwright/test';

import { NEW_LEAGUE_DEFAULTS } from '../../src/components/basketball/setup/newLeagueDefaults';
import { E2E_BASKETBALL_CREATED_LEAGUE_PREFIX, E2E_BASKETBALL_LEAGUE_ID } from './global.setup';
import {
  authenticateAsDevelopmentUser,
  collectRuntimeErrors,
  expectNoAppErrorBoundary,
  expectNoPageLevelHorizontalOverflow,
} from './helpers/devAuth';

test('sets up a basketball league, builds the roster and keeps it after a reload', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const runtimeErrors = collectRuntimeErrors(page);
  await authenticateAsDevelopmentUser(page);
  const leagueName = `${E2E_BASKETBALL_CREATED_LEAGUE_PREFIX}Setup League`;

  await test.step('create the league through the setup form', async () => {
    await page.goto('/basketball/new');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Set up a basketball league' })
    ).toBeVisible();
    await expect(page.getByLabel('Week 1 starts')).toHaveValue(NEW_LEAGUE_DEFAULTS.weekOneStartsOn);

    await page.getByLabel('League name').fill(leagueName);
    await page.getByLabel('Your team name').fill('Setup Squad');
    await page.getByLabel('Other team names (optional)').fill('Paste Patrol\nSearch Party');
    await page.getByRole('button', { name: 'Create league' }).click();

    await expect(page).toHaveURL(/\/basketball\/[^/]+\/roster$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Roster' })).toBeVisible();
    await expect(page.getByText(leagueName).first()).toBeVisible();
  });

  const search = page.getByRole('combobox', { name: 'Search NBA players' });

  await test.step('add two players by search, by click and by keyboard', async () => {
    await search.fill('Hale');
    await page.getByRole('option', { name: /Marcus Hale/ }).click();
    await expect(page.getByText('Added Marcus Hale to Setup Squad.')).toBeVisible();

    await search.fill('Petrov');
    await expect(page.getByRole('option', { name: /Nikolai Petrov/ })).toBeVisible();
    await search.press('Enter');
    await expect(page.getByText('Added Nikolai Petrov to Setup Squad.')).toBeVisible();
  });

  await test.step('paste two names and resolve the ambiguous one', async () => {
    await page.getByText('Paste a roster instead').click();
    await page.getByLabel('Paste players, one per line').fill('PG Caleb Young LAL\nJ. Price');
    // The roster page has a second paste box, under Players on other teams.
    await page
      .getByRole('region', { name: 'Add players' })
      .getByRole('button', { name: 'Find players' })
      .click();

    const ambiguous = page.getByRole('group', { name: /Line 2: J\. Price/ });
    await expect(ambiguous).toContainText('Pick one');
    await expect(page.getByRole('button', { name: 'Add 1 player to Setup Squad' })).toBeDisabled();

    await ambiguous.getByRole('radio', { name: /Jordan Price/ }).check();
    await page.getByRole('button', { name: 'Add 2 players to Setup Squad' }).click();
    await expect(page.getByText('Added 2 players to Setup Squad.')).toBeVisible();
  });

  await test.step("set this week's opponent", async () => {
    await page.getByLabel(/Opponent for Week/).selectOption({ label: 'Paste Patrol' });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText(/Paste Patrol is your opponent for week \d+\./)).toBeVisible();
  });

  await test.step('remove a player, then undo it', async () => {
    await page.getByRole('button', { name: 'Remove Nikolai Petrov', exact: true }).click();
    await expect(page.getByText('Removed Nikolai Petrov from Setup Squad.')).toBeVisible();
    await page.getByRole('button', { name: 'Undo removing Nikolai Petrov' }).click();
    await expect(page.getByText('Put Nikolai Petrov back on Setup Squad.')).toBeVisible();
  });

  await test.step('reload and see everything persisted', async () => {
    await page.reload();
    const myRoster = page.getByRole('region', { name: 'Setup Squad roster' });
    for (const name of ['Caleb Young', 'Jordan Price', 'Marcus Hale', 'Nikolai Petrov']) {
      await expect(myRoster.getByRole('listitem').filter({ hasText: name })).toBeVisible();
    }
    await expect(myRoster.getByRole('listitem')).toHaveCount(4);
    await expect(page.getByLabel(/Opponent for Week/).locator('option:checked')).toHaveText(
      'Paste Patrol'
    );

    const tabs = page.getByRole('navigation', { name: 'Basketball league sections' });
    await tabs.getByRole('link', { name: 'Overview', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'My roster' }).getByRole('rowheader')
    ).toHaveCount(4);
    await expect(page.getByText('Paste Patrol')).toBeVisible();
    await expectNoAppErrorBoundary(page);
  });

  await test.step('delete the league from Settings', async () => {
    await page
      .getByRole('navigation', { name: 'Basketball league sections' })
      .getByRole('link', { name: 'Settings', exact: true })
      .click();
    await page.getByRole('button', { name: 'Delete league' }).click();
    const dialog = page.getByRole('alertdialog', { name: `Delete ${leagueName}?` });
    await dialog.getByRole('button', { name: 'Delete league' }).click();

    // Back to the one seeded league.
    await expect(page).toHaveURL(new RegExp(`/basketball/${E2E_BASKETBALL_LEAGUE_ID}$`));
  });

  expect(runtimeErrors).toEqual([]);
});

test('marks the players on other teams as taken, leaving my team alone', async ({ page }) => {
  test.setTimeout(90_000);
  const runtimeErrors = collectRuntimeErrors(page);
  await authenticateAsDevelopmentUser(page);
  const roster = `/basketball/${E2E_BASKETBALL_LEAGUE_ID}/roster`;
  const otherTeams = page.getByRole('region', { name: 'Players on other teams' });

  await test.step('paste three names, one of them already on my team', async () => {
    await page.goto(roster);
    await expect(page.getByRole('region', { name: 'Set up in three steps' })).toContainText(
      '0 players on other teams (at least 80 needed)'
    );
    await otherTeams
      .getByLabel("Paste your league's rosters")
      .fill(
        'Rim Runners\nPos\tPlayer\tOpp\tStatus\nLuca Moretti\nDarius Holt LAL - F\nMarcus Hale'
      );
    await otherTeams.getByRole('button', { name: 'Find players' }).click();

    await expect(otherTeams.getByRole('list', { name: 'What was found' })).toContainText(
      '3 matched'
    );
    await expect(otherTeams).toContainText('1 already on a team you entered: left alone');
    await otherTeams.getByRole('button', { name: 'Mark 2 players as taken' }).click();

    await expect(
      page.getByText(
        'Marked 2 players as taken. Skipped 1 on a team you entered: Marcus Hale (Dev Dunkers).'
      )
    ).toBeVisible();
    await expect(otherTeams).toContainText('2 players marked as taken');
    // Focus returns to the emptied paste box rather than dropping to the page.
    await expect(otherTeams.getByLabel("Paste your league's rosters")).toBeFocused();
    await expect(
      page
        .getByRole('region', { name: 'Dev Dunkers roster' })
        .getByRole('listitem')
        .filter({ hasText: 'Marcus Hale' })
    ).toBeVisible();
  });

  await test.step('Pickups no longer lists them', async () => {
    await page.goto(`/basketball/${E2E_BASKETBALL_LEAGUE_ID}/pickups`);
    await expect(page.getByRole('heading', { level: 1, name: 'Pickups' })).toBeVisible();
    await expect(
      page.getByText('Statly knows 2 players on other teams (at least 80 needed)', { exact: false })
    ).toBeVisible();
    for (const name of ['Luca Moretti', 'Darius Holt']) {
      await expect(page.getByText(name)).toHaveCount(0);
    }
  });

  await test.step('clear the taken players again', async () => {
    await page.goto(roster);
    await otherTeams.getByRole('button', { name: 'Clear all taken players' }).click();
    await page
      .getByRole('alertdialog', { name: 'Clear all taken players?' })
      .getByRole('button', { name: 'Clear taken players' })
      .click();
    await expect(page.getByText('Cleared 2 players marked as taken.')).toBeVisible();
    await expect(otherTeams).toContainText('0 players marked as taken');
  });

  expect(runtimeErrors).toEqual([]);
});

test.describe('basketball pages at 390px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('fit the phone width without page-level sideways scrolling', async ({ page }) => {
    const runtimeErrors = collectRuntimeErrors(page);
    await authenticateAsDevelopmentUser(page);

    for (const section of ['', '/roster', '/settings']) {
      await page.goto(`/basketball/${E2E_BASKETBALL_LEAGUE_ID}${section}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoAppErrorBoundary(page);
      await expectNoPageLevelHorizontalOverflow(page);
    }
    // On a phone, held-since and move sit behind each player's Edit disclosure.
    await page.goto(`/basketball/${E2E_BASKETBALL_LEAGUE_ID}/roster`);
    const heldSince = page
      .getByLabel('Marcus Hale Held since', { exact: true })
      .filter({ visible: true });
    await expect(heldSince).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit Marcus Hale' }).click();
    await expect(heldSince).toHaveCount(1);
    await expect(
      page.getByRole('button', { name: 'Remove Marcus Hale', exact: true })
    ).toBeVisible();

    await page.goto('/basketball/new');
    await expectNoPageLevelHorizontalOverflow(page);
    expect(runtimeErrors).toEqual([]);
  });

  test('shows a missing page inside the league, under its tabs', async ({ page }) => {
    await authenticateAsDevelopmentUser(page);
    await page.goto(`/basketball/${E2E_BASKETBALL_LEAGUE_ID}/no-such-section`);
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Basketball league sections' })
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to the overview' })).toHaveAttribute(
      'href',
      `/basketball/${E2E_BASKETBALL_LEAGUE_ID}`
    );
  });

  test("shows not found for a league that is not the user's", async ({ page }) => {
    await authenticateAsDevelopmentUser(page);
    await page.goto('/basketball/not-a-real-league/roster');
    await expect(page.getByRole('heading', { level: 1, name: 'League not found' })).toBeVisible();
  });
});
