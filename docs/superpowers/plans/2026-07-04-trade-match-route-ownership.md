# Trade And Match Route Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate the public AFL draft/trade archive from the fantasy league workspace, reclaim Trade Centre for league-scoped fantasy trading, and make Match Centre route ownership match the live match centre product.

**Architecture:** Keep public AFL history under the public route group at `/draft/trades`, but rename the product surface to **AFL Draft & Trade Archive** so it is not confused with fantasy trading. Make `/tradecentre` a fantasy compatibility gateway that sends signed-in managers to their league trade centre and sends signed-out users to login with a return path. Make `/matches` the canonical Match Centre route, with `/live-scoring` kept as a focused live scoring utility rather than the primary Match Centre destination.

**Tech Stack:** Next.js App Router, React Server Components and Client Components, TypeScript, Vitest route-contract tests, existing Statly auth/server auth helpers, existing shadcn-style tokenized Tailwind classes.

---

## Scope Contract

This plan intentionally changes product meaning, not just links:

- **Public archive:** `/draft/trades` remains public and outside the authenticated fantasy app shell. It is renamed in UI copy to **AFL Draft & Trade Archive**.
- **Fantasy Trade Centre:** `/tradecentre` stops redirecting to public archive content. It becomes a fantasy gateway to `/leagues/[id]/trades`.
- **League trades:** `/leagues/[id]/trades` remains the canonical source of truth for proposals, reviews, and league roster context.
- **Match Centre:** `/matches` becomes the canonical Match Centre route because it renders `RealTimeMatchCenter`.
- **Live scoring utility:** `/live-scoring` remains available but is labelled as Live Scoring, not Match Centre.

Do not restore the old `SmartTradeAnalyzer` `/tradecentre` page. It used mock/local state and conflicts with the league-scoped trade architecture.

## File Structure

- Modify `src/app/tradecentre/page.tsx`
  - Responsibility: fantasy compatibility gateway for legacy `/tradecentre` requests.
  - Server component. Uses server auth and Prisma league membership lookup.

- Modify `next.config.mjs`
  - Responsibility: remove the request-level `/tradecentre -> /draft/trades` redirect so the app route can own `/tradecentre`.

- Modify `src/app/(public)/page.tsx`
  - Responsibility: home page product pathway. It must present the fantasy workspace and the public AFL archive as separate choices.

- Modify `src/app/(public)/layout.tsx`
  - Responsibility: public shell navigation labels. It must not imply the archive is fantasy Trade Centre.

- Modify `src/components/navigation/MainNavigation.tsx`
  - Responsibility: authenticated app navigation. Match Centre should point to `/matches`; Live Scoring should point to `/live-scoring` as a separate utility.

- Modify `src/components/dashboard/QuickActionsModule.tsx`
  - Responsibility: dashboard shortcut copy and links. Keep live scores pointed at `/matches`; make any trade shortcut wording league/fantasy specific, not public archive wording.

- Modify `tests/unit/public-draft-trade-routing.test.tsx`
  - Responsibility: public archive route contract. It should assert the archive name and route separation.

- Modify `tests/unit/dashboard-production-recovery-contract.test.ts`
  - Responsibility: production route ownership contract. It should assert `/tradecentre` is fantasy-owned and navigation does not send fantasy users to the public archive accidentally.

- Add `tests/unit/tradecentre-gateway-routing.test.ts`
  - Responsibility: focused static contract for the `/tradecentre` gateway implementation.

- Add `tests/unit/match-centre-navigation-contract.test.ts`
  - Responsibility: focused static contract for Match Centre and Live Scoring navigation ownership.

## Proposed Edit Plan

Working with: `src/app/tradecentre/page.tsx`, `next.config.mjs`, `src/app/(public)/page.tsx`, `src/app/(public)/layout.tsx`, `src/components/navigation/MainNavigation.tsx`, `src/components/dashboard/QuickActionsModule.tsx`, `tests/unit/public-draft-trade-routing.test.tsx`, `tests/unit/dashboard-production-recovery-contract.test.ts`, `tests/unit/tradecentre-gateway-routing.test.ts`, `tests/unit/match-centre-navigation-contract.test.ts`

Total planned edits: 8

### Edit sequence:

1. Update route-contract tests for public archive naming and fantasy `/tradecentre` ownership - Purpose: make the desired route ownership fail before app code changes.
2. Add focused static tests for `/tradecentre` gateway and Match Centre navigation - Purpose: lock the two boundaries that were confused.
3. Remove the `next.config.mjs` `/tradecentre -> /draft/trades` redirect - Purpose: allow the app route to own legacy fantasy Trade Centre requests.
4. Replace `/tradecentre` page with authenticated fantasy gateway - Purpose: route signed-in managers to league trades and signed-out users to login.
5. Rename public archive copy on public homepage and public nav - Purpose: establish a separate pathway from home without calling it fantasy Trade Centre.
6. Update authenticated navigation Match Centre and Live Scoring ownership - Purpose: make `/matches` the Match Centre and keep `/live-scoring` distinct.
7. Update dashboard shortcut copy if needed - Purpose: align shortcuts with the new route meaning.
8. Run targeted tests, type checks, lint, and browser route checks - Purpose: prove direct loads, navigation, and route contracts match the product decision.

Dependencies:

- Task 1 and Task 2 must happen before implementation so failures prove the intended behavior.
- Task 3 must happen before Task 4 can work, because Next config redirects execute before the page route.
- Task 5 and Task 6 depend on the product labels established in Task 1.
- Task 8 depends on all code and test changes.

Verification:

- `npm run test:unit -- tests/unit/public-draft-trade-routing.test.tsx tests/unit/dashboard-production-recovery-contract.test.ts tests/unit/tradecentre-gateway-routing.test.ts tests/unit/match-centre-navigation-contract.test.ts`
- `npm run typecheck:app`
- `npm run lint:ci`
- Browser check direct loads and navigation for `/`, `/draft/trades`, `/tradecentre`, `/matches`, `/live-scoring`, and `/leagues/[id]/trades` using the local dev server.

---

### Task 1: Update Public And Dashboard Route Contract Tests

**Files:**
- Modify: `tests/unit/public-draft-trade-routing.test.tsx`
- Modify: `tests/unit/dashboard-production-recovery-contract.test.ts`

- [ ] **Step 1: Update `public-draft-trade-routing.test.tsx` to expect archive naming and no `/tradecentre` redirect**

Replace the public route tests for the home link and legacy redirect with:

```tsx
it('links the homepage public archive product card to the canonical AFL archive', () => {
  render(<HomePage />);

  const archiveLink = screen.getByRole('link', { name: /open afl archive/i });
  expect(archiveLink).toHaveAttribute('href', '/draft/trades');
  expect(archiveLink).not.toHaveAttribute('href', '/tradecentre');
});

it('does not keep a request-level redirect from /tradecentre to the public archive', async () => {
  const { default: nextConfig } = (await import(
    '../../next.config.mjs'
  )) as { default: NextConfigWithRedirects };
  const redirects = await nextConfig.redirects?.();
  const tradeCentreRoute = readFileSync(
    join(process.cwd(), 'src/app/tradecentre/page.tsx'),
    'utf8'
  );

  expect(redirects).not.toContainEqual({
    source: '/tradecentre',
    destination: '/draft/trades',
    permanent: false,
  });
  expect(tradeCentreRoute).not.toContain("redirect('/draft/trades')");
  expect(tradeCentreRoute).toContain("redirect('/login?next=/tradecentre')");
});
```

- [ ] **Step 2: Update `dashboard-production-recovery-contract.test.ts` to assert fantasy ownership**

Replace the test named `keeps public AFL trade history ownership on /tradecentre` with:

```ts
it('keeps public AFL archive separate from fantasy Trade Centre', () => {
  const tradeCentreRoute = readRepoFile('src/app/tradecentre/page.tsx');
  expect(tradeCentreRoute).not.toContain("redirect('/draft/trades')");
  expect(tradeCentreRoute).toContain("redirect('/login?next=/tradecentre')");
  expect(tradeCentreRoute).toContain('leagueMember.findFirst');
  expect(tradeCentreRoute).toContain("redirect(`/leagues/${membership.leagueId}/trades`)");

  const publicHome = readRepoFile('src/app/(public)/page.tsx');
  expect(publicHome).toContain('AFL Draft & Trade Archive');
  expect(publicHome).toContain("href: '/draft/trades'");
  expect(publicHome).not.toContain('Draft & Trade Hub');

  const publicLayout = readRepoFile('src/app/(public)/layout.tsx');
  expect(publicLayout).toContain('AFL Archive');
  expect(publicLayout).not.toContain('Draft & Trade Hub');

  const navigation = readRepoFile('src/components/navigation/MainNavigation.tsx');
  expect(navigation).not.toContain("href: '/tradecentre'");
  expect(navigation).toContain("name: 'Waivers & Trades'");

  const quickActionsModule = readRepoFile('src/components/dashboard/QuickActionsModule.tsx');
  expect(quickActionsModule).not.toContain('/tradecentre');

  const rostersPage = readRepoFile('src/app/(app)/rosters/page.tsx');
  expect(rostersPage).not.toContain('/tradecentre');
});
```

- [ ] **Step 3: Run the edited tests and verify they fail**

Run:

```bash
npm run test:unit -- tests/unit/public-draft-trade-routing.test.tsx tests/unit/dashboard-production-recovery-contract.test.ts
```

Expected: FAIL because `/tradecentre` still redirects to `/draft/trades`, the public product is still labelled `Draft & Trade Hub`, and `next.config.mjs` still has the request-level redirect.

- [ ] **Step 4: Commit failing route contract tests**

Run:

```bash
git add tests/unit/public-draft-trade-routing.test.tsx tests/unit/dashboard-production-recovery-contract.test.ts
git commit -m "test: define trade route ownership"
```

Expected: commit succeeds and includes only the two test files.

### Task 2: Add Focused Route Ownership Tests

**Files:**
- Create: `tests/unit/tradecentre-gateway-routing.test.ts`
- Create: `tests/unit/match-centre-navigation-contract.test.ts`

- [ ] **Step 1: Add `/tradecentre` gateway contract test**

Create `tests/unit/tradecentre-gateway-routing.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('tradecentre gateway route ownership', () => {
  it('uses /tradecentre as a fantasy league gateway instead of the public archive', () => {
    const page = readRepoFile('src/app/tradecentre/page.tsx');
    const nextConfig = readRepoFile('next.config.mjs');

    expect(page).toContain("import 'server-only'");
    expect(page).toContain("import { redirect } from 'next/navigation'");
    expect(page).toContain("import { getAuthenticatedUserIdFromServerContext } from '@/lib/serverAuth'");
    expect(page).toContain("import { prisma } from '@/lib/prisma'");
    expect(page).toContain("redirect('/login?next=/tradecentre')");
    expect(page).toContain('prisma.leagueMember.findFirst');
    expect(page).toContain("redirect(`/leagues/${membership.leagueId}/trades`)");
    expect(page).toContain('Join or create a league to trade');
    expect(page).not.toContain("redirect('/draft/trades')");

    expect(nextConfig).not.toContain("source: '/tradecentre'");
    expect(nextConfig).not.toContain("destination: '/draft/trades'");
  });
});
```

- [ ] **Step 2: Add Match Centre navigation contract test**

Create `tests/unit/match-centre-navigation-contract.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('match centre navigation ownership', () => {
  it('uses /matches as Match Centre and keeps /live-scoring separate', () => {
    const navigation = readRepoFile('src/components/navigation/MainNavigation.tsx');
    const dashboardQuickActions = readRepoFile('src/components/dashboard/QuickActionsModule.tsx');
    const matchesPage = readRepoFile('src/app/(app)/matches/page.tsx');
    const liveScoringPage = readRepoFile('src/app/(app)/live-scoring/page.tsx');

    expect(navigation).toContain("name: 'Match Centre'");
    expect(navigation).toContain("href: '/matches'");
    expect(navigation).toContain("name: 'Live Scoring'");
    expect(navigation).toContain("href: '/live-scoring'");
    expect(navigation).toContain("if (href === '/matches') return p.startsWith('/matches')");
    expect(navigation).toContain("if (href === '/live-scoring') return p.startsWith('/live-scoring')");

    expect(dashboardQuickActions).toContain("title: 'Match Centre'");
    expect(dashboardQuickActions).toContain("href: '/matches'");

    expect(matchesPage).toContain('RealTimeMatchCenter');
    expect(matchesPage).toContain('Match Centre');
    expect(liveScoringPage).toContain('LiveScoringMatchup');
  });
});
```

- [ ] **Step 3: Run the new tests and verify they fail**

Run:

```bash
npm run test:unit -- tests/unit/tradecentre-gateway-routing.test.ts tests/unit/match-centre-navigation-contract.test.ts
```

Expected: FAIL because `/tradecentre` still points to `/draft/trades`, `next.config.mjs` still has the redirect, and `MainNavigation.tsx` still labels `/live-scoring` as Match Centre.

- [ ] **Step 4: Commit the new failing tests**

Run:

```bash
git add tests/unit/tradecentre-gateway-routing.test.ts tests/unit/match-centre-navigation-contract.test.ts
git commit -m "test: lock trade and match centre ownership"
```

Expected: commit succeeds and includes only the two new tests.

### Task 3: Remove Request-Level `/tradecentre` Redirect

**Files:**
- Modify: `next.config.mjs`

- [ ] **Step 1: Remove the `/tradecentre` redirect entry**

Change:

```js
  async redirects() {
    return [
      {
        source: '/tradecentre',
        destination: '/draft/trades',
        permanent: false,
      },
    ];
  },
```

To:

```js
  async redirects() {
    return [];
  },
```

- [ ] **Step 2: Run redirect-related tests**

Run:

```bash
npm run test:unit -- tests/unit/public-draft-trade-routing.test.tsx tests/unit/tradecentre-gateway-routing.test.ts
```

Expected: still FAIL because `src/app/tradecentre/page.tsx` still redirects to `/draft/trades`, but redirect config assertions now pass.

- [ ] **Step 3: Commit redirect removal**

Run:

```bash
git add next.config.mjs
git commit -m "fix: let tradecentre route own fantasy gateway"
```

Expected: commit succeeds with only `next.config.mjs`.

### Task 4: Reclaim `/tradecentre` As Fantasy League Gateway

**Files:**
- Modify: `src/app/tradecentre/page.tsx`

- [ ] **Step 1: Replace the redirect-only route with the server gateway**

Replace the entire file with:

```tsx
import 'server-only';

import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AppLayout } from '@/components/navigation';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserIdFromServerContext } from '@/lib/serverAuth';

export default async function TradeCentrePage() {
  const userId = await getAuthenticatedUserIdFromServerContext();

  if (!userId) {
    redirect('/login?next=/tradecentre');
  }

  const membership = await prisma.leagueMember.findFirst({
    where: { userId },
    orderBy: { joinedAt: 'asc' },
    select: { leagueId: true },
  });

  if (membership) {
    redirect(`/leagues/${membership.leagueId}/trades`);
  }

  return (
    <AppLayout>
      <main className="min-h-screen bg-background text-foreground">
        <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-4 py-16 sm:px-6">
          <section className="rounded-lg border border-border bg-card p-8 text-card-foreground shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Trade Centre
            </p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
              Join or create a league to trade
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Fantasy trades are managed inside a league workspace so each proposal can use the
              right roster, scoring settings, and commissioner rules.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/leagues/join"
                className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Join league
              </Link>
              <Link
                href="/leagues/new"
                className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Create league
              </Link>
            </div>
          </section>
        </div>
      </main>
    </AppLayout>
  );
}
```

- [ ] **Step 2: Run trade gateway tests**

Run:

```bash
npm run test:unit -- tests/unit/public-draft-trade-routing.test.tsx tests/unit/dashboard-production-recovery-contract.test.ts tests/unit/tradecentre-gateway-routing.test.ts
```

Expected: trade gateway assertions pass. Public archive naming assertions still fail until the public copy changes.

- [ ] **Step 3: Commit `/tradecentre` gateway**

Run:

```bash
git add src/app/tradecentre/page.tsx
git commit -m "fix: route tradecentre to fantasy league trades"
```

Expected: commit succeeds with only `src/app/tradecentre/page.tsx`.

### Task 5: Rename Public Archive Pathway

**Files:**
- Modify: `src/app/(public)/page.tsx`
- Modify: `src/app/(public)/layout.tsx`

- [ ] **Step 1: Rename the product card on the public home page**

In `src/app/(public)/page.tsx`, update the second `products` entry from:

```tsx
  {
    icon: BarChart3,
    title: 'Draft & Trade Hub',
    description: 'Research historical AFL trades, draft picks, club movement, and player deals.',
    href: '/draft/trades',
    action: 'Open Trade Hub',
  },
```

To:

```tsx
  {
    icon: BarChart3,
    title: 'AFL Draft & Trade Archive',
    description: 'Explore public AFL draft picks, historical trades, club movement, and player deals.',
    href: '/draft/trades',
    action: 'Open AFL Archive',
  },
```

- [ ] **Step 2: Update the hero secondary CTA**

In `src/app/(public)/page.tsx`, change:

```tsx
                Explore Draft &amp; Trade Hub
```

To:

```tsx
                Explore AFL Archive
```

- [ ] **Step 3: Update the public nav label**

In `src/app/(public)/layout.tsx`, change:

```tsx
  { href: '/draft/trades', label: 'Draft & Trade Hub' },
```

To:

```tsx
  { href: '/draft/trades', label: 'AFL Archive' },
```

Then replace the responsive label block:

```tsx
                {link.label === 'Draft & Trade Hub' ? (
                  <>
                    <span className="sm:hidden">Draft Hub</span>
                    <span className="hidden sm:inline">{link.label}</span>
                  </>
                ) : (
                  link.label
                )}
```

With:

```tsx
                {link.label}
```

- [ ] **Step 4: Run public archive tests**

Run:

```bash
npm run test:unit -- tests/unit/public-draft-trade-routing.test.tsx tests/unit/dashboard-production-recovery-contract.test.ts
```

Expected: public archive route and naming tests pass.

- [ ] **Step 5: Commit public naming changes**

Run:

```bash
git add 'src/app/(public)/page.tsx' 'src/app/(public)/layout.tsx'
git commit -m "copy: separate public AFL archive from fantasy trades"
```

Expected: commit succeeds with only public route group files.

### Task 6: Set Match Centre To `/matches`

**Files:**
- Modify: `src/components/navigation/MainNavigation.tsx`
- Modify: `src/components/dashboard/QuickActionsModule.tsx`

- [ ] **Step 1: Update Match Centre nav item to `/matches` and add Live Scoring utility**

In `src/components/navigation/MainNavigation.tsx`, inside `toolsNavigationItem.submenu`, replace the current Match Centre item:

```tsx
    {
      name: 'Match Centre',
      href: '/live-scoring',
      description: 'Live scoring and matchup monitoring',
      icon: (
```

With:

```tsx
    {
      name: 'Match Centre',
      href: '/matches',
      description: 'Live matches, top performers, and watched players',
      icon: (
```

Add a second item immediately after the Match Centre item:

```tsx
    {
      name: 'Live Scoring',
      href: '/live-scoring',
      description: 'Focused live matchup scoring',
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.958a1 1 0 00.95.69h4.162c.969 0 1.371 1.24.588 1.81l-3.367 2.446a1 1 0 00-.364 1.118l1.286 3.958c.3.921-.755 1.688-1.54 1.118l-3.367-2.446a1 1 0 00-1.175 0l-3.367 2.446c-.784.57-1.838-.197-1.539-1.118l1.286-3.958a1 1 0 00-.364-1.118L4.059 9.385c-.783-.57-.38-1.81.588-1.81h4.162a1 1 0 00.951-.69l1.289-3.958z"
          />
        </svg>
      ),
    },
```

- [ ] **Step 2: Update active-route logic**

In `src/components/navigation/MainNavigation.tsx`, change:

```tsx
  if (href === '/live-scoring') return p.startsWith('/live-scoring') || p.startsWith('/matches');
```

To:

```tsx
  if (href === '/matches') return p.startsWith('/matches');
  if (href === '/live-scoring') return p.startsWith('/live-scoring');
```

In `shouldShowLeagueSwitcher`, add `/matches` to the list by changing:

```tsx
    p.startsWith('/live-scoring') ||
```

To:

```tsx
    p.startsWith('/matches') ||
    p.startsWith('/live-scoring') ||
```

- [ ] **Step 3: Update dashboard quick action title**

In `src/components/dashboard/QuickActionsModule.tsx`, change the quick action:

```tsx
      title: 'Live scores',
      description: 'Track live AFL scoring',
      href: '/matches',
```

To:

```tsx
      title: 'Match Centre',
      description: 'Track live AFL matches, top performers, and watched players',
      href: '/matches',
```

- [ ] **Step 4: Run Match Centre tests**

Run:

```bash
npm run test:unit -- tests/unit/match-centre-navigation-contract.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Match Centre navigation changes**

Run:

```bash
git add src/components/navigation/MainNavigation.tsx src/components/dashboard/QuickActionsModule.tsx
git commit -m "fix: make matches the match centre route"
```

Expected: commit succeeds with only the two navigation/shortcut files.

### Task 7: Run Full Targeted Verification

**Files:**
- No source modifications expected.

- [ ] **Step 1: Run route ownership tests**

Run:

```bash
npm run test:unit -- tests/unit/public-draft-trade-routing.test.tsx tests/unit/dashboard-production-recovery-contract.test.ts tests/unit/tradecentre-gateway-routing.test.ts tests/unit/match-centre-navigation-contract.test.ts tests/unit/tradeListArchitecture.test.ts tests/unit/tradeRouteArchitecture.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run app typecheck**

Run:

```bash
npm run typecheck:app
```

Expected: PASS.

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint:ci
```

Expected: PASS. If unrelated lint failures appear, capture exact file paths and confirm they were pre-existing before changing scope.

- [ ] **Step 4: Start the dev server**

Run:

```bash
npm run dev
```

Expected: server starts on the configured local port. If port `3000` is in use, use the port printed by Next.js.

- [ ] **Step 5: Browser-check public archive separation**

Open `/`.

Expected:

- Primary fantasy CTA says `Open Fantasy Workspace` and links to `/dashboard`.
- Secondary public archive CTA says `Explore AFL Archive` and links to `/draft/trades`.
- Product card says `AFL Draft & Trade Archive`.
- Public nav says `AFL Archive`.

- [ ] **Step 6: Browser-check public archive route**

Open `/draft/trades`.

Expected:

- Page loads in public layout.
- No authenticated app sidebar or fantasy league shell appears.
- Archive content remains accessible without login.

- [ ] **Step 7: Browser-check fantasy Trade Centre route while signed out**

Open `/tradecentre` in a signed-out session.

Expected:

- Browser redirects to `/login?next=/tradecentre`.
- It does not redirect to `/draft/trades`.

- [ ] **Step 8: Browser-check fantasy Trade Centre route while signed in**

Open `/tradecentre` in a signed-in session with at least one league membership.

Expected:

- Browser redirects to `/leagues/<leagueId>/trades`.
- League trade centre loads with proposal form and recent trade list.

- [ ] **Step 9: Browser-check no-league Trade Centre fallback**

Use a signed-in account with no league membership or seed a no-league user locally.

Expected:

- `/tradecentre` renders the join/create league screen.
- `Join league` links to `/leagues/join`.
- `Create league` links to `/leagues/new`.

- [ ] **Step 10: Browser-check Match Centre and Live Scoring**

Open `/matches`.

Expected:

- Page heading is `Match Centre`.
- Embedded live panel heading is `Live Match Centre`.
- `RealTimeMatchCenter` tabs are available.
- Authenticated navigation highlights Match Centre.

Open `/live-scoring`.

Expected:

- `LiveScoringMatchup` renders.
- Authenticated navigation highlights Live Scoring, not Match Centre.

### Task 8: Final Review And Commit Readiness

**Files:**
- Review all changed files from Tasks 1-6.

- [ ] **Step 1: Confirm intended diff only**

Run:

```bash
git status --short
git diff --stat
```

Expected:

- Modified files are limited to:
  - `next.config.mjs`
  - `src/app/tradecentre/page.tsx`
  - `src/app/(public)/page.tsx`
  - `src/app/(public)/layout.tsx`
  - `src/components/navigation/MainNavigation.tsx`
  - `src/components/dashboard/QuickActionsModule.tsx`
  - `tests/unit/public-draft-trade-routing.test.tsx`
  - `tests/unit/dashboard-production-recovery-contract.test.ts`
  - `tests/unit/tradecentre-gateway-routing.test.ts`
  - `tests/unit/match-centre-navigation-contract.test.ts`
- `prisma/dev.db` remains unstaged if it was dirty before this work.

- [ ] **Step 2: Run council commit gate**

Run:

```bash
npm run codex:council:logical -- --staged --prompt "Chairman Decision 2: decide whether this completed route ownership work should be committed."
```

Expected: output includes `CHAIRMAN DECISION 2: COMMIT` before making the final commit.

- [ ] **Step 3: Make reviewed final commit**

Run:

```bash
git add next.config.mjs 'src/app/tradecentre/page.tsx' 'src/app/(public)/page.tsx' 'src/app/(public)/layout.tsx' src/components/navigation/MainNavigation.tsx src/components/dashboard/QuickActionsModule.tsx tests/unit/public-draft-trade-routing.test.tsx tests/unit/dashboard-production-recovery-contract.test.ts tests/unit/tradecentre-gateway-routing.test.ts tests/unit/match-centre-navigation-contract.test.ts
npm run codex:commit:reviewed -- "fix: clarify trade and match centre route ownership"
```

Expected: reviewed commit succeeds and excludes `prisma/dev.db`.

## Self-Review

Spec coverage:

- Public Draft & Trade Hub confusion is covered by Task 5, which renames the public surface to `AFL Draft & Trade Archive` and keeps it at `/draft/trades`.
- Home page pathway is covered by Task 5 with explicit hero CTA and product card copy.
- Fantasy separation is covered by Task 4, which makes `/tradecentre` a fantasy gateway to league trades.
- Match Centre ownership is covered by Task 6, which makes `/matches` canonical and keeps `/live-scoring` distinct.
- Regression coverage is covered by Tasks 1 and 2.
- Verification and commit safety are covered by Tasks 7 and 8.

Placeholder scan:

- This plan contains no `TBD`, no deferred implementation, and no unspecified test assertions.

Type consistency:

- The plan consistently uses `getAuthenticatedUserIdFromServerContext`, `prisma.leagueMember.findFirst`, `membership.leagueId`, `/draft/trades`, `/tradecentre`, `/matches`, `/live-scoring`, and `/leagues/[id]/trades`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-04-trade-match-route-ownership.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
