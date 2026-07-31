import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

function workflowJob(workflow: string, job: string, nextJob: string): string {
  const start = workflow.indexOf(`\n  ${job}:`);
  const end = workflow.indexOf(`\n  ${nextJob}:`, start + 1);

  expect(start, `Missing ${job} CI job`).toBeGreaterThanOrEqual(0);
  expect(end, `Missing ${nextJob} CI job after ${job}`).toBeGreaterThan(start);
  return workflow.slice(start, end);
}

describe('Playwright browser matrix', () => {
  it('runs the full suite in Chromium and smoke coverage in Firefox and WebKit', () => {
    const config = read('playwright.config.ts');

    expect(config).toContain("name: 'chromium'");
    expect(config).toContain("name: 'firefox-smoke'");
    expect(config).toContain("name: 'webkit-smoke'");
    expect(config.match(/testMatch: \/\.\*\\\.smoke\\\.test\\\.ts\//g)).toHaveLength(2);
    expect(config).toContain("devices['Desktop Firefox']");
    expect(config).toContain("devices['Desktop Safari']");
  });

  it('keeps the draft worker explicit and selects worker coverage by capability tag', () => {
    const config = read('playwright.config.ts');
    const packageJson = read('package.json');
    const timerTest = read('tests/e2e/draft-timer-worker.test.ts');

    expect(config).toContain("process.env.PLAYWRIGHT_WITH_DRAFT_WORKER === 'true'");
    expect(config).not.toContain("PLAYWRIGHT_WITH_DRAFT_WORKER !== 'false'");
    expect(packageJson).toContain('playwright test --grep-invert @draft-worker');
    expect(packageJson).toContain('playwright test --grep @draft-worker --project=chromium');
    expect(timerTest).toContain("{ tag: '@draft-worker' }");
    expect(timerTest).toContain("process.env.PLAYWRIGHT_WITH_DRAFT_WORKER !== 'true'");
    expect(timerTest).toContain('db: database');
  });

  it('keeps 264-pick persistence coverage in integration and browser coverage representative', () => {
    const integrationTest = read('tests/integration/draftFullConvergence.test.ts');
    const lifecycleTest = read('tests/e2e/draft-lifecycle.test.ts');

    expect(integrationTest).toContain('teamCount: 12');
    expect(integrationTest).toContain('rosterSize: 22');
    expect(integrationTest).toContain('totalPicks: 264');
    expect(integrationTest).toMatch(/new DraftApplicationService\(\s*rosterProjectionService\s*\)/);
    expect(integrationTest).toMatch(
      /new RosterProjectionService\(\s*prisma,\s*waiverAvailabilityProjection\s*\)/
    );
    expect(integrationTest).toMatch(
      /expect\(\s*waiverAvailabilityProjection\.projectLeague\s*\)\.toHaveBeenCalledTimes\(\s*1\s*\)/
    );
    expect(integrationTest).toMatch(
      /expect\(\s*waiverAvailabilityProjection\.projectLeague\s*\)\.toHaveBeenCalledWith\(\{\s*leagueId:\s*FIXTURE\.leagueId,?\s*\}\)/
    );
    expect(integrationTest).toContain('leagueRosterPlayer.findMany');
    expect(integrationTest).not.toContain('page.request');

    expect(lifecycleTest).toContain("toContainText('Pick 1 of 4')");
    expect(lifecycleTest).toContain('seedDraftLifecycleFixture');
    expect(lifecycleTest).toContain("getByText('Draft is complete')");
    expect(lifecycleTest).toContain("getByRole('table', { name: 'Robbo Rockers roster table' })");
    expect(existsSync(join(root, 'tests/e2e/draft-full-soak.test.ts'))).toBe(false);
    expect(existsSync(join(root, 'tests/e2e/helpers/fullDraftSoakFixture.ts'))).toBe(false);
  });

  it('isolates the standard browser matrix from required draft-worker coverage in CI', () => {
    const workflow = read('.github/workflows/ci.yml');
    const testsJob = workflowJob(workflow, 'tests', 'draft-worker-e2e');
    const workerJob = workflowJob(workflow, 'draft-worker-e2e', 'build');
    const gateJob = workflow.slice(workflow.indexOf('\n  ci-gate:'));

    expect(testsJob).toContain("PLAYWRIGHT_WITH_DRAFT_WORKER: 'false'");
    expect(testsJob).toContain('npm run test:e2e');
    expect(testsJob).toContain('npx playwright install --with-deps chromium firefox webkit');

    expect(workerJob).toContain('DATABASE_URL: file:./ci-draft-worker.db');
    expect(workerJob).toContain('DATABASE_URL_TEST: file:./ci-draft-worker.db');
    expect(workerJob).toContain("PLAYWRIGHT_WITH_DRAFT_WORKER: 'true'");
    expect(workerJob).toContain('npx playwright install --with-deps chromium');
    expect(workerJob).toContain('npm run test:e2e:draft-worker');
    expect(workerJob).toContain('name: draft-worker-test-artifacts');
    expect(gateJob).toContain('- draft-worker-e2e');
  });
});
