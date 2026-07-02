# League Overview Masthead Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bland League Overview card-grid with the selected masthead dashboard composition.

**Architecture:** Keep the implementation inside the existing `LeagueTabs` overview branch. Reuse the existing overview data derivations and trade fetch state, but reorganize the JSX into a dominant masthead panel, side summary modules, a structured team preview table, and calmer supporting modules.

**Tech Stack:** Next.js/React, TypeScript, Tailwind utility classes, existing league CSS tokens, Vitest/Testing Library, Browser runtime for rendered QA.

---

## File Structure

- Modify: `src/components/league/LeagueTabs.tsx`
  - Replace the current `activeTab === 'overview'` JSX structure with the masthead dashboard layout.
  - Keep existing derived values and event handlers.
  - Do not introduce new dependencies or global theme changes.
- Modify: `tests/unit/LeagueTabs.overview.test.tsx`
  - Update assertions from `Current state` and `League table snapshot` to masthead/dashboard copy.
  - Preserve checks for teams, waiver priority, pending trades, scoring, team preview, and absence of `Next action`.
- Modify: `tests/unit/LeagueTabs.draftActions.test.tsx`
  - Update draft status copy assertion only if the masthead changes the rendered phrase.

## Task 1: Update Overview Test Expectations

**Files:**
- Modify: `tests/unit/LeagueTabs.overview.test.tsx`

- [ ] **Step 1: Change overview test assertions to the masthead design**

Replace the central assertions after render with:

```tsx
expect(screen.getByText('League overview')).toBeInTheDocument();
expect(screen.getByText('Snapshot League')).toBeInTheDocument();
expect(screen.getByText('2/4 teams')).toBeInTheDocument();
expect(screen.getByText('Trade offers')).toBeInTheDocument();
expect(screen.getByText('5 categories')).toBeInTheDocument();
expect(screen.getAllByText('Priority 2').length).toBeGreaterThan(0);
expect(screen.getByText('Team preview')).toBeInTheDocument();
expect(screen.getByText('First Team')).toBeInTheDocument();
expect(screen.getAllByText('Second Team').length).toBeGreaterThan(0);
expect(screen.getByText('Offers needing review')).toBeInTheDocument();
```

- [ ] **Step 2: Keep async trade and absence checks**

Keep these assertions:

```tsx
await waitFor(() => {
  expect(screen.getByText('Midfield upgrade')).toBeInTheDocument();
});

expect(screen.getByText('Player A, Player B')).toBeInTheDocument();
expect(screen.getByText('Your claim position')).toBeInTheDocument();
expect(screen.queryByText('Next action')).not.toBeInTheDocument();
expect(authenticatedFetchMock).toHaveBeenCalledWith(
  '/api/trades/list?leagueId=league-1&status=PENDING&pageSize=3',
  {},
  'user-2'
);
```

- [ ] **Step 3: Run focused test and confirm expected failure**

Run:

```bash
npm run test:unit -- tests/unit/LeagueTabs.overview.test.tsx
```

Expected: FAIL because `League overview`, `2/4 teams`, and `Team preview` are not rendered yet.

## Task 2: Replace Top Grid With Masthead Dashboard

**Files:**
- Modify: `src/components/league/LeagueTabs.tsx`

- [ ] **Step 1: Replace the first overview section**

Replace the current first overview `<section>` that starts with `League snapshot` and four equal stat tiles with a masthead group:

```tsx
<section className="rounded-[24px] border border-slate-200 bg-slate-50 p-4 shadow-[0_24px_70px_-52px_rgba(15,23,42,0.45)] sm:p-5">
  <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
    <div className="rounded-[22px] bg-[color:var(--league-primary)] p-5 text-[color:var(--league-primary-foreground)] shadow-[0_24px_70px_-48px_rgba(15,23,42,0.7)] sm:p-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/65">
        League overview
      </p>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
        {league.name}
      </h2>
      <p className="mt-2 text-sm text-white/70">
        {league.type === 'private' ? 'Private' : 'Public'} · {activeMembers.length}/{league.maxTeams} teams · Draft {draftReadiness?.status ?? league.status}
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div>
          <p className="text-3xl font-semibold text-white">{activeMembers.length}</p>
          <p className="mt-1 text-xs font-medium uppercase tracking-[0.14em] text-white/60">
            teams
          </p>
        </div>
        <div>
          <p className="text-3xl font-semibold text-white">
            {overviewTradesStatus === 'loading' ? '...' : overviewTrades.length}
          </p>
          <p className="mt-1 text-xs font-medium uppercase tracking-[0.14em] text-white/60">
            trade offers
          </p>
        </div>
        <div>
          <p className="text-3xl font-semibold text-white">{league.categories.length}</p>
          <p className="mt-1 text-xs font-medium uppercase tracking-[0.14em] text-white/60">
            categories
          </p>
        </div>
      </div>
    </div>

    <div className="grid gap-3">
      {/* Side summary cards added in Task 3 */}
    </div>
  </div>
</section>
```

- [ ] **Step 2: Preserve team count phrasing for tests and users**

In the masthead body, render the summary text as:

```tsx
<p className="mt-2 text-sm text-white/70">
  {league.type === 'private' ? 'Private' : 'Public'} · {activeMembers.length}/{league.maxTeams}{' '}
  teams · Draft {draftReadiness?.status ?? league.status}
</p>
```

- [ ] **Step 3: Run focused test**

Run:

```bash
npm run test:unit -- tests/unit/LeagueTabs.overview.test.tsx
```

Expected: still FAIL until side cards and team preview copy are added.

## Task 3: Add Side Summary Cards And Team Preview Table

**Files:**
- Modify: `src/components/league/LeagueTabs.tsx`

- [ ] **Step 1: Add right-side summary modules inside the masthead section**

Replace the placeholder side card container with:

```tsx
<div className="grid gap-3">
  <div className="rounded-2xl border border-slate-200 bg-white p-4">
    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
      Your team
    </p>
    <p className="mt-2 text-lg font-semibold text-slate-950">
      {currentMember?.teamName ?? 'Team not set'}
    </p>
    <p className="mt-1 text-sm text-slate-600">
      {currentMember?.role === 'owner' || currentMember?.role === 'manager'
        ? 'Commissioner access'
        : 'Member access'}
    </p>
  </div>
  <div className="rounded-2xl border border-slate-200 bg-white p-4">
    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
      Waiver position
    </p>
    <p className="mt-2 text-lg font-semibold text-slate-950">{waiverPriorityLabel}</p>
    <p className="mt-1 text-sm capitalize text-slate-600">{waiverPolicyLabel} order</p>
  </div>
</div>
```

- [ ] **Step 2: Add team preview table under the masthead grid**

Inside the same masthead section, after the grid, add:

```tsx
<div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
  <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        Team preview
      </p>
      <h3 className="mt-1 text-lg font-semibold text-slate-950">League table</h3>
    </div>
    <button
      type="button"
      onClick={() => handleTabChange('teams')}
      className="inline-flex h-9 items-center justify-center rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-900 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
    >
      View teams
    </button>
  </div>
  <div className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-slate-200 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
    <span>Team</span>
    <span>Role</span>
    <span>Status</span>
  </div>
  {overviewTeams.map((member) => (
    <div
      key={member.id}
      className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0"
    >
      <span className="truncate text-sm font-semibold text-slate-950">
        {member.teamName || 'Unnamed team'}
      </span>
      <span className="text-xs capitalize text-slate-600">
        {getLeagueMemberRoleLabel(member, league)}
      </span>
      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
        {member.isActive === false ? 'Inactive' : 'Active'}
      </span>
    </div>
  ))}
</div>
```

- [ ] **Step 3: Remove the old separate team table and side stack section**

Delete the old section beginning:

```tsx
<section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
```

and ending immediately before:

```tsx
<section className="grid gap-4 lg:grid-cols-2">
```

- [ ] **Step 4: Run focused test**

Run:

```bash
npm run test:unit -- tests/unit/LeagueTabs.overview.test.tsx
```

Expected: PASS after test assertions and masthead content align.

## Task 4: Polish Supporting Modules

**Files:**
- Modify: `src/components/league/LeagueTabs.tsx`

- [ ] **Step 1: Convert trade and waiver modules to cooler neutral styling**

In the existing trade and waiver support section, replace `var(--league-surface)` / `var(--league-page)` visual containers with `bg-white`, `bg-slate-50`, `border-slate-200`, `text-slate-*` classes while preserving buttons, click handlers, and copy.

Use this button class for secondary buttons:

```tsx
className="inline-flex h-10 items-center justify-center rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-900 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
```

- [ ] **Step 2: Preserve draft-complete safety**

Do not reintroduce `Prepare draft`, `Enter draft room`, or `Next action` inside the overview.

- [ ] **Step 3: Run both focused tests**

Run:

```bash
npm run test:unit -- tests/unit/LeagueTabs.overview.test.tsx tests/unit/LeagueTabs.draftActions.test.tsx
```

Expected: PASS.

## Task 5: Verification And Commit

**Files:**
- Verify: `src/components/league/LeagueTabs.tsx`
- Verify: `tests/unit/LeagueTabs.overview.test.tsx`
- Verify: `tests/unit/LeagueTabs.draftActions.test.tsx`

- [ ] **Step 1: Run lint**

Run:

```bash
npx eslint src/components/league/LeagueTabs.tsx tests/unit/LeagueTabs.overview.test.tsx tests/unit/LeagueTabs.draftActions.test.tsx
```

Expected: exit code 0.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: exit code 0.

- [ ] **Step 3: Run diff whitespace check**

Run:

```bash
git diff --check -- src/components/league/LeagueTabs.tsx tests/unit/LeagueTabs.overview.test.tsx tests/unit/LeagueTabs.draftActions.test.tsx
```

Expected: exit code 0.

- [ ] **Step 4: Browser verify desktop**

Use the in-app browser at:

```text
http://localhost:3000/leagues/cmezlicop0002uxzjdtavv4mk
```

Expected:

- Page title is `Statly - Fantasy AFL`.
- Overview tab renders a dark/navy masthead panel.
- `League overview`, league name, team count, trade offers, categories, side cards, and team preview are visible.
- `Next action` is absent.
- No framework runtime/build overlay appears.

- [ ] **Step 5: Browser verify mobile**

Set a mobile viewport around `390x844`, reload the same route, and confirm:

- Masthead stacks cleanly.
- Text does not overlap.
- Team preview columns remain readable or wrap acceptably.
- No horizontal page overflow is introduced.

- [ ] **Step 6: Stage intended files only**

Run:

```bash
git add src/components/league/LeagueTabs.tsx tests/unit/LeagueTabs.overview.test.tsx tests/unit/LeagueTabs.draftActions.test.tsx docs/superpowers/plans/2026-07-02-league-overview-masthead-dashboard.md
git status --short
```

Expected:

- Intended files are staged.
- `prisma/dev.db` remains unstaged.
- `.superpowers/brainstorm/...` files remain untracked and unstaged.

- [ ] **Step 7: Run Decision 2**

Run:

```bash
npm run codex:council:logical -- --staged --prompt "Chairman Decision 2: decide whether the League Overview masthead dashboard implementation should be committed."
```

Expected: `CHAIRMAN DECISION 2: COMMIT`.

- [ ] **Step 8: Commit through reviewed path**

Run:

```bash
npm run codex:commit:reviewed -- "Implement league overview masthead dashboard"
```

Expected: commit succeeds with only intended files.
