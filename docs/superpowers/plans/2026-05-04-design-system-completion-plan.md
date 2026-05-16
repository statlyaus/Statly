# Design System Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Statly's design-system migration so semantic shadcn-style primitives, Tailwind tokens, and lucide icons are enforceable by default without flattening intentional AFL product identity.

**Architecture:** Keep shadcn-style open components as the component model, Tailwind semantic tokens as the styling language, and lucide-react as the icon standard. Complete the migration by moving guard policy out of the scanner, documenting intentional exceptions, migrating high-value product surfaces by ownership boundary, then enabling strict enforcement only when active drift is fixed or explicitly justified.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS v4, shadcn-style primitives, CSS variables in `src/index.css`, `lucide-react`, `tsx`, Vitest, ESLint, Prettier.

---

## Current State

Already implemented:

- `AGENTS.md` defines Statly website design-system rules and confirms `lucide`, Tailwind, and shadcn are complementary.
- `docs/superpowers/plans/2026-05-04-design-system-drift-migration.md` records the first migration roadmap.
- `docs/audits/design-system-drift-baseline-2026-05-04.md` records the baseline inventory.
- `scripts/check-design-drift.ts` scans palette/hex drift and legacy icon imports.
- `package.json` has `design:drift` report mode and `guard:design` strict mode.
- Shared primitives, auth chrome, league panels, navigation touchpoints, and player/ranking table shells have had an initial migration pass.

Known completion gap:

- `npm run guard:design` still fails because the scanner reports thousands of active findings.
- The allowlist is currently embedded as an empty array inside `scripts/check-design-drift.ts`.
- Remaining drift includes true legacy UI debt, intentional brand art, intentional team colors, dark sports-board surfaces, demos, and lower-priority product surfaces.

## Long-Term Design Decision

This plan does not replace Tailwind with shadcn, or shadcn with lucide. The durable stack is:

```text
shadcn-style open components + Tailwind semantic tokens + lucide-react icons
```

Use this rule when deciding whether a finding should be migrated or allowlisted:

```text
If the styling expresses app structure, workflow state, form state, table state, panel hierarchy, or generic status, migrate it to semantic tokens or shared primitives.
If the styling expresses club identity, intentional public art direction, or a deliberately dark live-sports surface, document and narrowly allowlist it.
```

## Files And Responsibilities

- `scripts/check-design-drift.ts`: scanner and report/strict-mode runner only. It should not own product policy.
- `scripts/design-drift-allowlist.ts`: new typed allowlist policy for intentional exceptions.
- `docs/audits/design-system-drift-baseline-2026-05-04.md`: source of truth for why exceptions exist and which surfaces still need migration.
- `package.json`: script wiring only. Do not add `guard:design` to `prepush:ci` until Task 8.
- `src/components/ui/table.tsx`: shared table semantics. Add repeated state classes here when at least two tables use them.
- `src/styles/leagueDesignSystem.ts`: league-specific surface/status semantics. Do not add generic app tokens here.
- `src/index.css`: global CSS variables only for roles that recur across multiple product areas.
- `src/components/MyTeamPanel.tsx`: roster/team-management migration surface.
- `src/components/team/PlayerRow.tsx`: team row/status migration surface.
- `src/components/team/TeamAnalyticsDashboard.tsx`: analytics panel/status migration surface.
- `src/components/roster/RosterManager.tsx`: roster-management migration surface.
- `src/components/AvailablePlayersTable.tsx` and `src/components/AvailablePlayersTable_new.tsx`: finish table/icon drift left after the first pass.
- `src/app/players/PlayersPageClient.tsx`: player browser chrome and icon migration, only after checking current uncommitted edits.
- `src/app/page.tsx`, `src/app/fantasy/page.tsx`, and `src/components/demos/**`: classify before migrating; most findings should be preserved or excluded from strict product enforcement.

## Task 1: Move Drift Policy Into A Typed Allowlist

**Files:**

- Create: `scripts/design-drift-allowlist.ts`
- Modify: `scripts/check-design-drift.ts`
- Modify: `docs/audits/design-system-drift-baseline-2026-05-04.md`

- [ ] **Step 1: Create the allowlist policy file**

Create `scripts/design-drift-allowlist.ts`:

```ts
export type DesignDriftCategory = 'palette' | 'legacy-icon';

export type DesignDriftAllowlistEntry = {
  filePattern: RegExp;
  category?: DesignDriftCategory;
  valuePattern?: RegExp;
  reason: string;
};

export const designDriftAllowlist: DesignDriftAllowlistEntry[] = [
  {
    filePattern: /^src\/app\/page\.tsx$/,
    category: 'palette',
    reason:
      'Public homepage uses intentional brand/art direction pending a separate marketing-page design review.',
  },
  {
    filePattern: /^src\/app\/fantasy\/page\.tsx$/,
    category: 'palette',
    reason:
      'Public fantasy landing page uses intentional campaign art direction pending a separate marketing-page design review.',
  },
  {
    filePattern: /^src\/components\/demos\//,
    reason:
      'Demo components document legacy examples and are excluded from product-surface enforcement until demo cleanup.',
  },
];
```

- [ ] **Step 2: Import the allowlist from the scanner**

In `scripts/check-design-drift.ts`, replace the local `FindingCategory` and `AllowlistEntry` definitions with:

```ts
import {
  designDriftAllowlist,
  type DesignDriftAllowlistEntry,
  type DesignDriftCategory,
} from './design-drift-allowlist';
```

Then set:

```ts
type FindingCategory = DesignDriftCategory;
type AllowlistEntry = DesignDriftAllowlistEntry;
const ALLOWLIST = designDriftAllowlist;
```

- [ ] **Step 3: Document the initial allowlist**

Append this section to `docs/audits/design-system-drift-baseline-2026-05-04.md`:

```markdown
## Intentional Exception Register

| File pattern               | Category                | Reason                                                                            | Exit criteria                                                          |
| -------------------------- | ----------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `src/app/page.tsx`         | palette                 | Public homepage uses intentional brand/art direction.                             | Revisit during marketing-page redesign; do not block product UI guard. |
| `src/app/fantasy/page.tsx` | palette                 | Public fantasy landing page uses intentional campaign art direction.              | Revisit during marketing-page redesign; do not block product UI guard. |
| `src/components/demos/**`  | palette and legacy-icon | Demo components preserve historical examples and are not active product surfaces. | Delete demos or migrate them in a dedicated demo cleanup task.         |
```

- [ ] **Step 4: Verify Task 1**

Run:

```bash
npx prettier --check scripts/design-drift-allowlist.ts scripts/check-design-drift.ts docs/audits/design-system-drift-baseline-2026-05-04.md
npx eslint scripts/design-drift-allowlist.ts scripts/check-design-drift.ts
npm run design:drift
```

Expected:

- Prettier passes.
- ESLint passes.
- `npm run design:drift` exits 0 and prints an allowlisted count greater than 0.

- [ ] **Step 5: Commit Task 1**

```bash
git add scripts/design-drift-allowlist.ts scripts/check-design-drift.ts docs/audits/design-system-drift-baseline-2026-05-04.md
git commit -m "chore: separate design drift allowlist policy"
```

## Task 2: Add Drift Budgets By Product Surface

**Files:**

- Modify: `scripts/check-design-drift.ts`
- Modify: `scripts/design-drift-allowlist.ts`
- Modify: `docs/audits/design-system-drift-baseline-2026-05-04.md`

- [ ] **Step 1: Add surface classification to the scanner**

Add this type and function to `scripts/check-design-drift.ts`:

```ts
type ProductSurface =
  | 'auth'
  | 'dashboard'
  | 'draft'
  | 'league'
  | 'live-scoring'
  | 'players'
  | 'public'
  | 'roster'
  | 'shared-ui'
  | 'team'
  | 'demo'
  | 'other';

function classifySurface(file: string): ProductSurface {
  if (file.startsWith('src/components/demos/')) return 'demo';
  if (file === 'src/app/page.tsx' || file === 'src/app/fantasy/page.tsx') return 'public';
  if (file.includes('/(auth)/') || file.includes('/Auth')) return 'auth';
  if (file.includes('/draft/') || file.includes('/Draft')) return 'draft';
  if (file.includes('/league/') || file.includes('/leagues/') || file.includes('League'))
    return 'league';
  if (file.includes('LiveScoring') || file.includes('LiveGameScores')) return 'live-scoring';
  if (file.includes('/players/') || file.includes('/player/') || file.includes('Player'))
    return 'players';
  if (file.includes('/roster/') || file.includes('Roster') || file.includes('MyTeamPanel'))
    return 'roster';
  if (file.includes('/team/') || file.includes('Team')) return 'team';
  if (file.includes('/dashboard/') || file.includes('Dashboard')) return 'dashboard';
  if (file.includes('/components/ui/')) return 'shared-ui';
  return 'other';
}
```

- [ ] **Step 2: Include surface on each finding**

Change the `Finding` type in `scripts/check-design-drift.ts` to include:

```ts
surface: ProductSurface;
```

Update `findMatches` so each finding sets:

```ts
surface: classifySurface(file),
```

- [ ] **Step 3: Print surface totals**

Add this function to `scripts/check-design-drift.ts`:

```ts
function printSurfaceSummary(findings: Finding[]): void {
  const counts = new Map<ProductSurface, number>();

  for (const finding of findings) {
    counts.set(finding.surface, (counts.get(finding.surface) ?? 0) + 1);
  }

  console.log('\nActive findings by product surface');
  for (const [surface, count] of Array.from(counts.entries()).sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    console.log(`  ${surface}: ${count}`);
  }
}
```

Call it after printing `Active findings`:

```ts
printSurfaceSummary(activeFindings);
```

- [ ] **Step 4: Document enforcement budgets**

Append this section to the audit:

```markdown
## Enforcement Budgets

Strict enforcement should be enabled in stages:

| Stage | Surfaces                             |                               Required active findings |
| ----- | ------------------------------------ | -----------------------------------------------------: |
| 1     | `auth`, `shared-ui`, `league`        |                                                      0 |
| 2     | `players`, `roster`, `team`          |                                                      0 |
| 3     | `draft`, `dashboard`, `live-scoring` |                 0 or documented dark-sports exceptions |
| 4     | `public`, `demo`, `other`            | reviewed and either migrated or intentionally excluded |
```

- [ ] **Step 5: Verify Task 2**

Run:

```bash
npx prettier --check scripts/check-design-drift.ts scripts/design-drift-allowlist.ts docs/audits/design-system-drift-baseline-2026-05-04.md
npx eslint scripts/check-design-drift.ts scripts/design-drift-allowlist.ts
npm run design:drift
```

Expected:

- Report includes `Active findings by product surface`.
- Report mode exits 0.

- [ ] **Step 6: Commit Task 2**

```bash
git add scripts/check-design-drift.ts scripts/design-drift-allowlist.ts docs/audits/design-system-drift-baseline-2026-05-04.md
git commit -m "chore: report design drift by product surface"
```

## Task 3: Finish Shared UI Primitive Drift

**Files:**

- Modify: `src/components/ui/Alert.tsx`
- Modify: `src/components/ui/Badge.tsx`
- Modify: `src/components/ui/DataTable.tsx`
- Modify: `src/components/ui/ErrorBoundary.tsx`
- Modify: `src/components/ui/LoadingSpinner.tsx`
- Modify: `src/components/ui/LoadingState.tsx`
- Modify: `src/components/ui/Modal.tsx`
- Modify: `src/components/ui/NotificationCenter.tsx`
- Modify: `src/components/ui/table.tsx`

- [ ] **Step 1: Confirm current shared UI drift**

Run:

```bash
npm run design:drift -- --strict
```

Expected: command fails. In the output, note findings under `src/components/ui/`.

- [ ] **Step 2: Replace shared UI Heroicons with lucide**

Use this mapping in touched files:

```ts
import {
  AlertTriangle,
  Bell,
  CheckCircle,
  ChevronDown,
  ChevronsUpDown,
  Info,
  RefreshCw,
  Search,
  X,
  XCircle,
} from 'lucide-react';
```

Heroicons mapping:

```text
XMarkIcon -> X
ExclamationTriangleIcon -> AlertTriangle
ArrowPathIcon -> RefreshCw
BellIcon -> Bell
MagnifyingGlassIcon -> Search
ChevronDownIcon -> ChevronDown
ChevronUpDownIcon -> ChevronsUpDown
CheckCircleIcon -> CheckCircle
XCircleIcon -> XCircle
InformationCircleIcon -> Info
```

Set decorative icons to `aria-hidden="true"` and icon-only buttons to `aria-label="Close"`, `aria-label="Dismiss notification"`, or the exact action text.

- [ ] **Step 3: Add table state classes if repeated**

If table loading/empty/error classes are repeated in two or more table components, extend `src/components/ui/table.tsx`:

```ts
export type TableStateClassKey = 'empty' | 'loading' | 'error';

export const tableStateClasses = {
  empty: 'px-3 py-8 text-center text-sm text-muted-foreground',
  loading: 'px-3 py-8 text-center text-sm text-muted-foreground',
  error: 'px-3 py-8 text-center text-sm text-destructive',
} as const satisfies Record<TableStateClassKey, string>;
```

- [ ] **Step 4: Replace hard-coded shared UI palette classes**

Use these replacements:

```text
bg-white -> bg-card or bg-background based on component role
text-gray-900 -> text-foreground
text-gray-700 -> text-foreground
text-gray-600 -> text-muted-foreground
text-gray-500 -> text-muted-foreground
border-gray-200 -> border-border
ring-blue-500 -> ring-ring
text-red-600 -> text-destructive
bg-red-50 -> bg-destructive/10
```

- [ ] **Step 5: Verify Task 3**

Run:

```bash
npx prettier --check src/components/ui/Alert.tsx src/components/ui/Badge.tsx src/components/ui/DataTable.tsx src/components/ui/ErrorBoundary.tsx src/components/ui/LoadingSpinner.tsx src/components/ui/LoadingState.tsx src/components/ui/Modal.tsx src/components/ui/NotificationCenter.tsx src/components/ui/table.tsx
npx eslint src/components/ui/Alert.tsx src/components/ui/Badge.tsx src/components/ui/DataTable.tsx src/components/ui/ErrorBoundary.tsx src/components/ui/LoadingSpinner.tsx src/components/ui/LoadingState.tsx src/components/ui/Modal.tsx src/components/ui/NotificationCenter.tsx src/components/ui/table.tsx
npx tsc -p tsconfig.app.json --noEmit --pretty false
npm run design:drift
```

Expected:

- Prettier, ESLint, and typecheck pass.
- Shared UI legacy-icon findings are 0 unless a file is documented in the exception register.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/components/ui/Alert.tsx src/components/ui/Badge.tsx src/components/ui/DataTable.tsx src/components/ui/ErrorBoundary.tsx src/components/ui/LoadingSpinner.tsx src/components/ui/LoadingState.tsx src/components/ui/Modal.tsx src/components/ui/NotificationCenter.tsx src/components/ui/table.tsx
git commit -m "refactor: finish shared ui design primitives"
```

## Task 4: Finish Player And Rankings Surface Drift

**Files:**

- Modify: `src/components/AvailablePlayersTable.tsx`
- Modify: `src/components/AvailablePlayersTable_new.tsx`
- Modify: `src/components/PlayerTable.tsx`
- Modify: `src/components/PlayerTableRow.tsx`
- Modify: `src/components/rankings/NineCategoryRankingsTable.tsx`
- Modify: `src/components/rankings/RankingsTable.tsx`
- Modify after checking current edits: `src/app/players/PlayersPageClient.tsx`

- [ ] **Step 1: Check current uncommitted overlap**

Run:

```bash
git diff -- src/app/players/PlayersPageClient.tsx src/components/AvailablePlayersTable.tsx src/components/AvailablePlayersTable_new.tsx
```

Expected: inspect existing edits before changing these files. Do not revert unrelated user changes.

- [ ] **Step 2: Replace remaining table Heroicons with lucide**

Use this mapping:

```text
StarIcon outline -> Star
StarIcon solid -> Star, with fill-current or fill-[currentColor]
MagnifyingGlassIcon -> Search
AdjustmentsHorizontalIcon -> SlidersHorizontal
ChevronUpIcon -> ChevronUp
ChevronDownIcon -> ChevronDown
PlusIcon -> Plus
MinusIcon -> Minus
```

- [ ] **Step 3: Convert remaining table action colors**

Use semantic button variants where possible:

```tsx
<button
  type="button"
  className="inline-flex items-center justify-center rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
>
  Action
</button>
```

Use `text-muted-foreground` for secondary metadata and `text-destructive` for destructive states.

- [ ] **Step 4: Preserve table behavior**

Before and after edits, verify these behaviors in code:

```text
sort state is unchanged
filter inputs keep the same state keys
draft/player selection callbacks keep the same arguments
watchlist toggles keep the same optimistic behavior
virtualized row keys stay stable
```

- [ ] **Step 5: Verify Task 4**

Run:

```bash
npx vitest run src/components/rankings/__tests__/NineCategoryRankingsTable.a11y.test.tsx src/components/rankings/__tests__/RankingsTable.a11y.test.tsx
npx prettier --check src/components/AvailablePlayersTable.tsx src/components/AvailablePlayersTable_new.tsx src/components/PlayerTable.tsx src/components/PlayerTableRow.tsx src/components/rankings/NineCategoryRankingsTable.tsx src/components/rankings/RankingsTable.tsx src/app/players/PlayersPageClient.tsx
npx eslint src/components/AvailablePlayersTable.tsx src/components/AvailablePlayersTable_new.tsx src/components/PlayerTable.tsx src/components/PlayerTableRow.tsx src/components/rankings/NineCategoryRankingsTable.tsx src/components/rankings/RankingsTable.tsx src/app/players/PlayersPageClient.tsx
npx tsc -p tsconfig.app.json --noEmit --pretty false
npm run design:drift
```

Expected:

- Ranking a11y tests pass.
- Typecheck passes.
- Player/rankings legacy-icon findings are 0 unless an intentional exception is documented.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/components/AvailablePlayersTable.tsx src/components/AvailablePlayersTable_new.tsx src/components/PlayerTable.tsx src/components/PlayerTableRow.tsx src/components/rankings/NineCategoryRankingsTable.tsx src/components/rankings/RankingsTable.tsx src/app/players/PlayersPageClient.tsx
git commit -m "refactor: complete player table design migration"
```

## Task 5: Finish Roster And Team Management Drift

**Files:**

- Modify: `src/components/MyTeamPanel.tsx`
- Modify: `src/components/team/PlayerRow.tsx`
- Modify: `src/components/team/TeamAnalyticsDashboard.tsx`
- Modify: `src/components/roster/RosterManager.tsx`

- [ ] **Step 1: Migrate `PlayerRow` first**

Use this semantic row shape:

```tsx
const rowClassName =
  'rounded-md border border-border bg-card p-3 text-card-foreground shadow-sm transition-colors hover:bg-accent/40 focus-within:ring-2 focus-within:ring-ring';
const metadataClassName = 'text-xs text-muted-foreground';
const statusClassName =
  'inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground';
```

Preserve captain and vice-captain labels and any existing click/drag behavior.

- [ ] **Step 2: Migrate analytics panels**

Use:

```ts
const panelClassName = 'rounded-md border border-border bg-card p-4 text-card-foreground shadow-sm';
const mutedPanelClassName = 'rounded-md border border-border bg-muted/30 p-4 text-foreground';
const helpTextClassName = 'text-sm text-muted-foreground';
```

Use `text-destructive`, `text-muted-foreground`, and `text-foreground` instead of hard-coded red/gray/slate text.

- [ ] **Step 3: Split `MyTeamPanel` edits into five commits if the diff is large**

Use this order:

```text
1. Search/filter controls
2. Table/list headers
3. Player slot cards
4. Footer actions
5. Live scoring dark board constants
```

For the dark board, first extract repeated hard-coded classes into local constants:

```ts
const liveBoardClassName = 'rounded-md border border-slate-700 bg-slate-950 text-slate-100';
const liveBoardMutedTextClassName = 'text-slate-400';
```

Then decide whether to migrate or allowlist. If the dark surface is intentional and still product-correct, add a narrow allowlist entry for `src/components/MyTeamPanel.tsx` with reason:

```ts
{
  filePattern: /^src\/components\/MyTeamPanel\.tsx$/,
  category: 'palette',
  valuePattern: /(?:bg|text|border)-slate-\d{2,3}/,
  reason: 'MyTeamPanel live scoring board intentionally uses a dark sports surface for game-state contrast.',
}
```

- [ ] **Step 4: Verify Task 5**

Run:

```bash
npx prettier --check src/components/MyTeamPanel.tsx src/components/team/PlayerRow.tsx src/components/team/TeamAnalyticsDashboard.tsx src/components/roster/RosterManager.tsx scripts/design-drift-allowlist.ts docs/audits/design-system-drift-baseline-2026-05-04.md
npx eslint src/components/MyTeamPanel.tsx src/components/team/PlayerRow.tsx src/components/team/TeamAnalyticsDashboard.tsx src/components/roster/RosterManager.tsx scripts/design-drift-allowlist.ts
npx tsc -p tsconfig.app.json --noEmit --pretty false
npm run design:drift
```

Expected:

- Typecheck passes.
- Roster/team legacy-icon findings are 0 unless an intentional dark-board exception is documented.
- No roster action, captaincy, or drag/drop behavior changes.

- [ ] **Step 5: Commit Task 5**

```bash
git add src/components/MyTeamPanel.tsx src/components/team/PlayerRow.tsx src/components/team/TeamAnalyticsDashboard.tsx src/components/roster/RosterManager.tsx scripts/design-drift-allowlist.ts docs/audits/design-system-drift-baseline-2026-05-04.md
git commit -m "refactor: complete roster design migration"
```

## Task 6: Finish League, Live Scoring, Draft, And Commissioner Drift

**Files:**

- Modify: `src/components/league/DraftManager.tsx`
- Modify: `src/components/league/LeagueOverview.tsx`
- Modify: `src/components/matchup/LiveScoringMatchup.tsx`
- Modify: `src/components/advanced/AdvancedLiveScoringDashboard.tsx`
- Modify: `src/components/commissioner/CommissionerTools.tsx`
- Modify: `src/components/draft/DraftHubNav.tsx`
- Modify: `src/components/draft/DraftTradesExplorer.tsx`
- Modify: `src/components/draft/draftHubChrome.ts`
- Modify only if needed: `src/styles/leagueDesignSystem.ts`

- [ ] **Step 1: Migrate league and commissioner icon imports**

Use lucide equivalents:

```text
Cog6ToothIcon -> Settings
UserGroupIcon -> Users
CalendarDaysIcon -> CalendarDays
TrophyIcon -> Trophy
ChartBarIcon -> ChartBar
ExclamationTriangleIcon -> AlertTriangle
ArrowPathIcon -> RefreshCw
CheckCircleIcon -> CheckCircle
ClockIcon -> Clock
```

- [ ] **Step 2: Use league patterns for league-owned panels**

Use existing exports:

```ts
import { leagueStatusTonePatterns, leagueSurfacePatterns } from '@/styles/leagueDesignSystem';
```

Use `leagueSurfacePatterns.panelSection`, `leagueSurfacePatterns.subpanel`, and `leagueStatusTonePatterns.neutral | success | warning | danger` for league-owned UI.

- [ ] **Step 3: Preserve dark live-scoring surfaces intentionally**

If a live-scoring component uses dark slate/emerald/red contrast for game-state readability, document and allowlist only that file and category:

```ts
{
  filePattern: /^src\/components\/matchup\/LiveScoringMatchup\.tsx$/,
  category: 'palette',
  valuePattern: /(?:bg|text|border|ring)-(?:slate|emerald|red|yellow)-\d{2,3}/,
  reason: 'LiveScoringMatchup intentionally uses dark sports-board contrast for active game state.',
}
```

- [ ] **Step 4: Verify Task 6**

Run:

```bash
npx prettier --check src/components/league/DraftManager.tsx src/components/league/LeagueOverview.tsx src/components/matchup/LiveScoringMatchup.tsx src/components/advanced/AdvancedLiveScoringDashboard.tsx src/components/commissioner/CommissionerTools.tsx src/components/draft/DraftHubNav.tsx src/components/draft/DraftTradesExplorer.tsx src/components/draft/draftHubChrome.ts src/styles/leagueDesignSystem.ts scripts/design-drift-allowlist.ts docs/audits/design-system-drift-baseline-2026-05-04.md
npx eslint src/components/league/DraftManager.tsx src/components/league/LeagueOverview.tsx src/components/matchup/LiveScoringMatchup.tsx src/components/advanced/AdvancedLiveScoringDashboard.tsx src/components/commissioner/CommissionerTools.tsx src/components/draft/DraftHubNav.tsx src/components/draft/DraftTradesExplorer.tsx src/components/draft/draftHubChrome.ts src/styles/leagueDesignSystem.ts scripts/design-drift-allowlist.ts
npx tsc -p tsconfig.app.json --noEmit --pretty false
npm run design:drift
```

Expected:

- League/draft/commissioner legacy-icon findings are 0 unless documented.
- Live scoring hard-coded palette findings are either migrated or narrowly allowlisted with dark-sports reasoning.

- [ ] **Step 5: Commit Task 6**

```bash
git add src/components/league/DraftManager.tsx src/components/league/LeagueOverview.tsx src/components/matchup/LiveScoringMatchup.tsx src/components/advanced/AdvancedLiveScoringDashboard.tsx src/components/commissioner/CommissionerTools.tsx src/components/draft/DraftHubNav.tsx src/components/draft/DraftTradesExplorer.tsx src/components/draft/draftHubChrome.ts src/styles/leagueDesignSystem.ts scripts/design-drift-allowlist.ts docs/audits/design-system-drift-baseline-2026-05-04.md
git commit -m "refactor: complete league and draft design migration"
```

## Task 7: Review Public, Demo, And Low-Priority Surfaces

**Files:**

- Review: `src/app/page.tsx`
- Review: `src/app/fantasy/page.tsx`
- Review: `src/components/demos/**`
- Modify: `scripts/design-drift-allowlist.ts`
- Modify: `docs/audits/design-system-drift-baseline-2026-05-04.md`

- [ ] **Step 1: Classify public page findings**

For each public page, classify sections using:

```text
preserve: hero art, campaign imagery, club/product identity, intentional visual storytelling
migrate: form controls, reusable cards, status messages, product workflow chrome
remove: stale demo-only sections that are not linked or product-owned
```

- [ ] **Step 2: Classify demos**

Run:

```bash
find src/components/demos -maxdepth 1 -type f | sort
```

For each file, choose one:

```text
keep and allowlist: still useful as a visual regression/demo reference
migrate: active demo used by docs or Storybook
delete in a separate cleanup task: stale and unreferenced
```

- [ ] **Step 3: Update the exception register**

For each preserved exception, add one row to the audit with exact file pattern, category, reason, and exit criteria. Use this format:

```markdown
| `src/components/demos/AuthFormDemo.tsx` | palette and legacy-icon | Demo preserves historical auth visual states for comparison. | Delete or migrate when demo inventory is retired. |
```

- [ ] **Step 4: Verify Task 7**

Run:

```bash
npx prettier --check scripts/design-drift-allowlist.ts docs/audits/design-system-drift-baseline-2026-05-04.md
npx eslint scripts/design-drift-allowlist.ts
npm run design:drift
```

Expected:

- Report mode exits 0.
- Every allowlisted finding has a matching documented reason in the audit.

- [ ] **Step 5: Commit Task 7**

```bash
git add scripts/design-drift-allowlist.ts docs/audits/design-system-drift-baseline-2026-05-04.md
git commit -m "docs: document intentional design drift exceptions"
```

## Task 8: Enable Strict Enforcement

**Files:**

- Modify: `package.json`
- Modify: `docs/audits/design-system-drift-baseline-2026-05-04.md`

- [ ] **Step 1: Confirm strict mode is clean**

Run:

```bash
npm run guard:design
```

Expected: PASS. If it fails, do not continue. Fix or document the active findings in Tasks 3-7 first.

- [ ] **Step 2: Add design guard to prepush**

In `package.json`, update `prepush:ci` so `guard:design` runs after dependency/import guards and before tests:

```json
"prepush:ci": "npm run typecheck && npm run lint && npm run env:check:firebase && npm run guard:routes && npm run guard:tracked-artifacts && npm run guard:deps && npm run guard:design && npm test && npm run format:check"
```

- [ ] **Step 3: Document enforcement date**

Append this section to the audit:

```markdown
## Enforcement Status

`npm run guard:design` is part of `prepush:ci` after the 2026-05-04 completion migration. New product UI drift must be migrated to semantic tokens, shared primitives, or a documented narrow exception before merge.
```

- [ ] **Step 4: Verify Task 8**

Run:

```bash
npm run guard:design
npm run prepush:ci
```

Expected:

- `guard:design` passes.
- `prepush:ci` passes or fails only on unrelated pre-existing non-design checks. If `prepush:ci` fails outside design, record the failing command and keep `guard:design` verified separately.

- [ ] **Step 5: Commit Task 8**

```bash
git add package.json docs/audits/design-system-drift-baseline-2026-05-04.md
git commit -m "chore: enforce design drift guard"
```

## Cross-Task Verification

After each task:

```bash
npm run design:drift
npx tsc -p tsconfig.app.json --noEmit --pretty false
```

Before declaring the whole plan complete:

```bash
npm run guard:design
npm run prepush:ci
```

Browser verification for changed surfaces:

```bash
npm run dev:app
```

Then inspect these routes in the browser at desktop and mobile widths:

```text
http://localhost:3000
http://localhost:3000/fantasy
http://localhost:3000/login
http://localhost:3000/register
http://localhost:3000/players
http://localhost:3000/leagues/test-league-id?tab=overview
http://localhost:3000/leagues/test-league-id?tab=matchup
```

Acceptance criteria:

- No inaccessible icon-only buttons were introduced.
- No user workflow behavior changed during visual migration.
- Product workflow chrome uses semantic tokens and shared primitives.
- Intentional public art, club identity, and dark live-sports surfaces are documented as exceptions.
- `guard:design` passes before it is wired into `prepush:ci`.

## Self-Review

Spec coverage:

- Current implementation is accounted for in `Current State`.
- Long-term stack choice is explicit in `Long-Term Design Decision`.
- Old design to replace is handled by Tasks 3-6.
- Intentional design to preserve is handled by Tasks 1, 6, and 7.
- Strict future enforcement is handled by Task 8.
- `lucide`, Tailwind, and shadcn compatibility is stated directly.

Placeholder scan:

- No task depends on an unspecified implementation.
- Each code-changing task includes concrete imports, class replacements, allowlist entries, or command gates.

Type consistency:

- Drift categories are `palette` and `legacy-icon` in both scanner and allowlist.
- Surface classification is owned by `scripts/check-design-drift.ts`.
- Allowlist policy is owned by `scripts/design-drift-allowlist.ts`.
