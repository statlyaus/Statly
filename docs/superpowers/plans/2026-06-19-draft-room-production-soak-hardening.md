# Draft Room Production Soak Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the draft room can complete a fresh 12-team, 264-pick draft and reconcile picks into history and rosters without freezes, duplicates, stale state, or broken post-draft UI.

**Architecture:** Add one deterministic E2E fixture helper for a full live draft and one Playwright soak test that drives the real browser, API routes, Prisma database, and completed draft pages. Production code is changed only if the soak test exposes a root-cause failure. The fixture uses the existing development auth user as the human manager and creates 11 bot league members with snake draft order.

**Tech Stack:** Next.js App Router, Prisma SQLite test database, Playwright, existing Statly development auth, existing draft API routes, existing draft application service.

---

## PROPOSED EDIT PLAN

Working with: `tests/e2e/helpers/fullDraftSoakFixture.ts`, `tests/e2e/draft-full-soak.test.ts`, and only failing production files if the soak test exposes a root-cause bug.
Total planned edits: 3

### Edit sequence:

1. Add the full-draft fixture helper - Purpose: create and reset a 12-team, 264-pick live draft with enough active real players, deterministic members, draft order, and a queued bot player.
2. Add the Playwright full-draft soak test - Purpose: verify manual pick responsiveness, queued auto-pick, Statly Z fallback auto-pick, 264-pick completion, no runtime errors, no table over-rendering, roster reconciliation, and history visibility.
3. Fix only failures exposed by the soak test - Purpose: keep production edits evidence-led and scoped to the broken source-of-truth boundary.

Dependencies:

- Edit 2 depends on Edit 1 because the test needs deterministic fixture IDs and queued/fallback expectations.
- Edit 3 depends on the first red soak run. No production code should change until the failure is observed and traced.

Verification:

- `npm run test:e2e -- tests/e2e/draft-full-soak.test.ts`
- Focused unit tests for any production file touched by Edit 3.
- `npm run typecheck`
- `npm run lint:ci`
- Browser verification on the generated full draft and completed history/roster routes.
- Council Decision 2 before commit.

### Task 1: Full Draft Soak Fixture

**Files:**
- Create: `tests/e2e/helpers/fullDraftSoakFixture.ts`

- [ ] **Step 1: Create fixture constants and cleanup helper**

```ts
export const FULL_DRAFT_SOAK = {
  leagueId: 'e2e-full-soak-league',
  draftId: 'cme2efull0000e2esoakdraft',
  settingsId: 'e2e-full-soak-settings',
  humanMemberId: 'e2e-full-soak-member-human',
  teamCount: 12,
  rosterSize: 22,
  totalPicks: 264,
} as const;
```

- [ ] **Step 2: Seed users, league, members, draft, draft order, and active players**

```ts
await tx.draft.create({
  data: {
    id: FULL_DRAFT_SOAK.draftId,
    leagueId: FULL_DRAFT_SOAK.leagueId,
    status: DraftStatus.LIVE,
    currentPick: 1,
    totalPicks: FULL_DRAFT_SOAK.totalPicks,
    round: 1,
    direction: DraftDirection.FORWARD,
    lobbyStatus: 'LIVE',
    lobbyOpenAt: now,
    startedAt: now,
    pickStartedAt: now,
    pickDeadlineAt: new Date(now.getTime() + 60_000),
  },
});
```

- [ ] **Step 3: Compute fixture expectations**

```ts
return {
  ...FULL_DRAFT_SOAK,
  queuedBotPlayerId,
  expectedThirdPickPlayerId,
};
```

- [ ] **Step 4: Run the helper through a temporary import check**

Run: `npx tsc --noEmit --pretty false`

Expected: TypeScript can resolve `seedFullDraftSoakFixture`.

### Task 2: Full Draft Soak Playwright Test

**Files:**
- Create: `tests/e2e/draft-full-soak.test.ts`

- [ ] **Step 1: Write the failing Playwright test**

```ts
test('completes a fresh 12-team draft and reconciles rosters/history without freezing', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const fixture = await seedFullDraftSoakFixture();
  const runtimeErrors = collectRuntimeErrors(page);
  await authenticateAsDevelopmentUser(page);

  await page.goto(`/drafts/${fixture.draftId}`);
  await expect(page.locator('body')).toContainText('Pick 1 of 264');

  const renderedRows = await page.locator('tbody tr').count();
  expect(renderedRows).toBeLessThan(90);

  const selectStart = Date.now();
  await page.getByRole('button', { name: /^Select / }).first().click();
  await expect(page.locator('body')).toContainText('Pick 2 of 264');
  expect(Date.now() - selectStart).toBeLessThan(5000);

  const secondPick = await page.request.post(`/api/drafts/${fixture.draftId}/auto-pick`, {
    headers: { authorization: 'Bearer dev:statly-dev-tester' },
  });
  expect(secondPick.ok()).toBe(true);
  const secondPayload = await secondPick.json();
  expect(secondPayload.data.wasQueued).toBe(true);
  expect(secondPayload.data.pick.player.id).toBe(fixture.queuedBotPlayerId);

  const thirdPick = await page.request.post(`/api/drafts/${fixture.draftId}/auto-pick`, {
    headers: { authorization: 'Bearer dev:statly-dev-tester' },
  });
  expect(thirdPick.ok()).toBe(true);
  const thirdPayload = await thirdPick.json();
  expect(thirdPayload.data.pick.player.id).toBe(fixture.expectedThirdPickPlayerId);

  for (let pick = 4; pick <= fixture.totalPicks; pick += 1) {
    const response = await page.request.post(`/api/drafts/${fixture.draftId}/auto-pick`, {
      headers: { authorization: 'Bearer dev:statly-dev-tester' },
    });
    expect(response.ok()).toBe(true);
  }

  await page.goto(`/drafts/${fixture.draftId}`);
  await expect(page.getByText('Draft is complete')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Review completed draft' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Review my roster' })).toBeVisible();

  await page.goto(`/drafts/history/${fixture.draftId}`);
  await expect(page.locator('body')).toContainText('264');

  await page.goto(`/leagues/${fixture.leagueId}?tab=roster`);
  await expect(page.getByRole('heading', { name: 'Robbo Rockers' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Robbo Rockers roster table' })).toBeVisible();
  await expect(page.getByText('No Team Selected')).toHaveCount(0);

  expect(runtimeErrors).toEqual([]);
});
```

- [ ] **Step 2: Run the test to verify it fails before the fixture exists**

Run: `npm run test:e2e -- tests/e2e/draft-full-soak.test.ts`

Expected: FAIL because `tests/e2e/helpers/fullDraftSoakFixture.ts` is not implemented yet.

- [ ] **Step 3: Implement the fixture helper**

Use Prisma transactions, existing `DEVELOPMENT_AUTH_USER_ID`, `REAL_DATA_NINE_CATEGORY_PRESET`, `getPlayers`, `buildAvailableDraftPlayer`, and `calculateStatlyZScores`.

- [ ] **Step 4: Run the soak test to gather real failures**

Run: `npm run test:e2e -- tests/e2e/draft-full-soak.test.ts`

Expected after fixture implementation: either PASS or a concrete failure at manual pick, queued pick, Statly Z pick, completion, history, roster, or performance assertion.

### Task 3: Evidence-Led Fixes

**Files:**
- Modify only files named by the failing stack trace, assertion, or data-flow trace.

- [ ] **Step 1: Trace the first failure to its source**

Record whether the failure is in browser rendering, API command response, draft application service, repository query, projection, history read model, or league roster read model.

- [ ] **Step 2: Add the smallest focused regression test**

Use the existing closest unit/integration test file:

- `tests/unit/DraftApplicationService.completionProjection.test.ts`
- `tests/unit/DraftContext.initialFetch.test.tsx`
- `tests/unit/PlayerGrid.a11y.test.tsx`
- `tests/unit/LeagueTabs.roster.test.tsx`
- `tests/unit/UnifiedDraftRoom.liveShell.test.tsx`

- [ ] **Step 3: Implement the source-of-truth fix**

Make one bounded production edit that fixes the observed failing boundary. Do not change UI styling unless the failure is visual or layout-specific.

- [ ] **Step 4: Verify focused tests and the soak test**

Run:

```bash
npm run test:e2e -- tests/e2e/draft-full-soak.test.ts
npm run typecheck
npm run lint:ci
```

Expected: all commands exit 0. Existing unrelated warnings must be reported separately if they remain.

---

## Self-Review

Spec coverage:

- Full 264-pick E2E soak: Task 2 drives a 12-team, 264-pick draft.
- Manual picks: Task 2 performs the first pick through the browser.
- Bot/queued auto-pick: Task 2 asserts pick 2 uses the seeded queue.
- Highest Statly Z fallback: Task 2 asserts pick 3 uses the computed highest available Statly Z player.
- Completion reconciliation: Task 2 verifies completed draft UI, history, and league roster table.
- Reconnect/refresh reliability: Task 2 reloads the draft after completion; additional mid-pick refresh should be added if the first soak test passes cleanly.
- Performance threshold: Task 2 asserts row windowing and manual pick latency.
- Warning cleanup: runtime console/page errors are collected; existing unit-test warnings remain a separate cleanup item.
- Final UX QA: Task 2 covers completed next-step links and roster/history visibility.

Placeholder scan:

- No task uses TODO/TBD/implement-later wording.
- Evidence-led production fixes are intentionally gated behind the first failing test because the target file must be determined by the failure.

Type consistency:

- Fixture IDs and return fields match the Playwright test expectations.
- Draft IDs remain CUID-like to satisfy existing route validation.
