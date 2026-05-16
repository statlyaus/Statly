# Design System Drift Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Statly's remaining UI drift into a durable, Statly-specific design system without flattening intentional product art direction or creating a risky visual rewrite.

**Architecture:** Treat `shadcn-style open components`, `Tailwind semantic tokens`, and `lucide-react` as one aligned UI stack. Build the foundation first, then migrate high-value product surfaces by ownership boundary, and only then enforce drift prevention in CI. Product quality is judged against `STATLY_DESIGN_SYSTEM.md`: fast decisions, high trust, AFL-specific depth without clutter, and mobile-ready team management.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, shadcn-style primitives, CSS variables in `src/index.css`, `lucide-react`, Vitest, ESLint, Prettier.

---

## Assessment Of The Previous Plan

The previous drift plan had the correct intent, but it was too color-class focused. It would reduce obvious Tailwind palette drift, but long-term design-system quality also depends on layout density, table behavior, mobile task completion, status semantics, component ownership, accessibility, and repeated local class strings.

Shortcomings corrected in this rewrite:

- The roadmap now separates current implementation, target architecture, legacy design to replace, and intentional design to preserve.
- The guard is now a baseline/reporting tool first, not an immediate CI blocker.
- Surface migrations are prioritized by product value: league workspace, rankings/player tables, roster/team management, then auth/public/app-shell.
- Shared semantic decisions are made before large surface migrations.
- Acceptance criteria include visual/product outcomes, not only lint/typecheck.
- `lucide`, `Tailwind`, and `shadcn` are explicitly defined as complementary, not competing.

## Stack Compatibility Decision

There is no contradiction between lucide, Tailwind, and shadcn in this roadmap.

- Tailwind is the styling mechanism.
- shadcn is the open-code component architecture and composition model.
- lucide-react is the preferred icon layer for new or touched UI.

The target stack is:

```text
shadcn-style primitives + Tailwind semantic tokens + lucide icons
```

The legacy drift to reduce is:

- new Heroicons or React Icons usage where lucide has an equivalent
- hard-coded Tailwind palette ramps where semantic tokens fit
- custom monolithic components where shadcn-style composition fits
- duplicated table, card, badge, form, status, and panel styling

Do not frame migrations as "Tailwind vs shadcn." Use Tailwind through shadcn-style primitives and semantic CSS variables.

## Design To Preserve

Preserve these unless a task explicitly redesigns them:

- Team colors, team logos, and club identity signals used for recognition.
- Public marketing pages with intentional visual art direction, especially `src/app/fantasy/page.tsx` and `src/app/page.tsx`.
- Dark sports surfaces where contrast and game-state emphasis are intentional, such as parts of live scoring or roster board UI.
- Existing component APIs used across features.
- Existing data behavior, sort/filter semantics, loading states, and route behavior.

## Design To Replace

Replace these when touching the same area:

- Generic gray-card SaaS shells in product workflows.
- Repeated `bg-gray-*`, `text-slate-*`, `border-blue-*`, and status color ramps where semantic app or league tokens fit.
- Copied panel/card/table/badge class strings that should be shared primitives or local constants.
- Icon-only buttons without accessible names.
- Tables that lack explicit empty/loading/error states.
- Mobile layouts that only shrink desktop tables when the workflow needs task-specific mobile structure.
- New Heroicons or React Icons imports in touched files.

## Phase 0: Baseline Inventory And Ownership

**Purpose:** Create a reliable drift map before large changes.

**Files:**

- Read: `AGENTS.md`
- Read: `STATLY_DESIGN_SYSTEM.md`
- Read: `src/index.css`
- Read: `src/styles/leagueDesignSystem.ts`
- Read: `components.json`
- Create: `docs/audits/design-system-drift-baseline-2026-05-04.md`

- [ ] **Step 1: Generate a drift baseline**

Run:

```bash
rg -n "bg-(white|gray|slate|blue|red|green|yellow|purple|orange|cyan|sky|indigo)|text-(gray|slate|blue|red|green|yellow|purple|orange|cyan|sky|indigo)|border-(gray|slate|blue|red|green|yellow|purple|orange|cyan|sky|indigo)|#[0-9A-Fa-f]{3,8}|@heroicons/react|react-icons" src/components src/app -g '*.{tsx,ts}' > /tmp/statly-design-drift.txt
```

Expected: output file exists and contains current drift candidates.

- [ ] **Step 2: Write the baseline audit**

Create `docs/audits/design-system-drift-baseline-2026-05-04.md` with this structure:

```markdown
# Design System Drift Baseline - 2026-05-04

## Target Stack

Statly standardizes on shadcn-style open components, Tailwind semantic tokens, and lucide-react icons.

## Preserve

- Intentional public-page art direction.
- Team logo and club identity colors.
- Intentional dark sports surfaces.

## Replace

- Generic gray-card product shells.
- Repeated hard-coded palette ramps.
- Duplicated table, badge, panel, and form class strings.
- New Heroicons/React Icons usage in touched UI.

## Priority Surfaces

1. League workspace
2. Rankings and player tables
3. Roster and team management
4. Auth and app shell
5. Public marketing pages, review only

## Baseline Findings

[Paste grouped summary from /tmp/statly-design-drift.txt. Group by product surface instead of listing every line.]
```

- [ ] **Step 3: Verify audit formatting**

Run:

```bash
npx prettier --check docs/audits/design-system-drift-baseline-2026-05-04.md
```

Expected: PASS after formatting.

## Phase 1: Foundation Decisions Before Broad Migration

**Purpose:** Make reusable decisions once so surface workers do not invent local styles.

**Files:**

- Modify: `src/styles/leagueDesignSystem.ts`
- Modify: `src/components/ui/table.tsx`
- Modify only if needed: `src/index.css`
- Modify only if needed: `STATLY_DESIGN_SYSTEM.md`

- [ ] **Step 1: Add reusable league status patterns if needed**

If two or more league files need the same status styles, add this to `src/styles/leagueDesignSystem.ts`:

```ts
export const leagueStatusTonePatterns = {
  success:
    'border border-[color:var(--league-success-soft)] bg-[color:var(--league-success-soft)] text-[color:var(--league-success)]',
  warning:
    'border border-[color:var(--league-warning-soft)] bg-[color:var(--league-warning-soft)] text-[color:var(--league-warning)]',
  danger:
    'border border-[color:var(--league-danger-soft)] bg-[color:var(--league-danger-soft)] text-[color:var(--league-danger)]',
  neutral:
    'border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] text-[color:var(--league-text-muted)]',
} as const;
```

- [ ] **Step 2: Add table empty-state helper only if repeated**

If two or more table migrations repeat empty-state classes, add this to `src/components/ui/table.tsx`:

```ts
export const tableStateClasses = {
  empty: 'px-3 py-8 text-center text-sm text-muted-foreground',
  loading: 'px-3 py-8 text-center text-sm text-muted-foreground',
  error: 'px-3 py-8 text-center text-sm text-destructive',
} as const;
```

- [ ] **Step 3: Do not add one-off tokens**

Only modify `src/index.css` when a visual role recurs across at least two product surfaces. Use semantic names such as `--status-warning`, `--surface-raised`, or `--data-positive`; do not add mockup-specific names.

- [ ] **Step 4: Verify foundation**

Run:

```bash
npx eslint src/styles/leagueDesignSystem.ts src/components/ui/table.tsx
npx tsc -p tsconfig.app.json --noEmit --pretty false
npx prettier --check src/styles/leagueDesignSystem.ts src/components/ui/table.tsx src/index.css STATLY_DESIGN_SYSTEM.md
```

Expected: PASS.

## Phase 2: League Workspace Migration

**Purpose:** Replace generic SaaS panels with league workspace patterns while preserving league behavior.

**Files:**

- Modify: `src/components/league/LiveGameScoresPanel.tsx`
- Modify: `src/components/league/TeamSettings.tsx`
- Modify: `src/components/league/LeagueMatchupTab.tsx`
- Modify: `src/components/LeagueDashboard.tsx`
- Modify only if needed: `src/styles/leagueDesignSystem.ts`

- [ ] **Step 1: Convert panel shells**

Use `leagueSurfacePatterns.panelSection`, `leagueSurfacePatterns.subpanel`, `leagueSurfacePatterns.subpanelCompact`, `leagueSurfacePatterns.sectionTitle`, and `leagueSurfacePatterns.body` for matching league panels.

- [ ] **Step 2: Convert status badges**

Use `leagueStatusTonePatterns` from Phase 1 when available. Keep local maps only when a tone appears once.

- [ ] **Step 3: Replace touched Heroicons with lucide**

Only replace icons in the files edited for this phase. Decorative icons must use `aria-hidden="true"`.

- [ ] **Step 4: Verify league workspace**

Run:

```bash
npx eslint src/components/league/LiveGameScoresPanel.tsx src/components/league/TeamSettings.tsx src/components/league/LeagueMatchupTab.tsx src/components/LeagueDashboard.tsx src/styles/leagueDesignSystem.ts
npx tsc -p tsconfig.app.json --noEmit --pretty false
```

Expected: PASS.

Acceptance criteria:

- League surfaces use league tokens or league patterns for core shells.
- Error/success/warning states remain visually distinct without hard-coded palette ramps.
- No route or data behavior changes.

## Phase 3: Rankings And Player Table Migration

**Purpose:** Standardize data-heavy player comparison surfaces around shared table patterns.

**Files:**

- Modify: `src/components/rankings/NineCategoryRankingsTable.tsx`
- Modify: `src/components/PlayerTable.tsx`
- Modify: `src/components/PlayerTableRow.tsx`
- Modify: `src/components/AvailablePlayersTable.tsx`
- Modify: `src/components/AvailablePlayersTable_new.tsx`
- Modify: `src/app/players/PlayersPageClient.tsx`
- Test: `src/components/rankings/__tests__/NineCategoryRankingsTable.a11y.test.tsx`

- [ ] **Step 1: Convert table shells to shared classes**

Use:

```ts
import { UITable, tableClasses } from '@/components/ui/table';
```

Use `tableClasses.container`, `tableClasses.thead`, `tableClasses.tbody`, `tableClasses.th`, `tableClasses.td`, and `tableClasses.tdNumeric`.

- [ ] **Step 2: Preserve comparison behavior**

Do not change sorting, filtering, row click behavior, watchlist behavior, or player selection behavior.

- [ ] **Step 3: Add explicit table states**

Tables must show explicit loading, empty, and error states where data can be absent.

- [ ] **Step 4: Verify rankings and player tables**

Run:

```bash
npx vitest run src/components/rankings/__tests__/NineCategoryRankingsTable.a11y.test.tsx src/components/rankings/__tests__/RankingsTable.a11y.test.tsx
npx eslint src/components/rankings/NineCategoryRankingsTable.tsx src/components/PlayerTable.tsx src/components/PlayerTableRow.tsx src/components/AvailablePlayersTable.tsx src/components/AvailablePlayersTable_new.tsx src/app/players/PlayersPageClient.tsx
npx tsc -p tsconfig.app.json --noEmit --pretty false
```

Expected: PASS.

Acceptance criteria:

- Numeric columns align right and use tabular treatment where useful.
- Column headers remain accessible.
- Mobile behavior is no worse than before.

## Phase 4: Roster, Team, And Live Scoring Migration

**Purpose:** Migrate the most complex fantasy-management surfaces without losing intentional sports-board styling.

**Files:**

- Modify: `src/components/team/PlayerRow.tsx`
- Modify: `src/components/team/TeamAnalyticsDashboard.tsx`
- Modify: `src/components/MyTeamPanel.tsx`
- Modify only if needed: `src/app/rosters/page.tsx`
- Modify only if needed: `src/app/team-analytics/TeamAnalyticsClient.tsx`

- [ ] **Step 1: Migrate `PlayerRow` first**

Convert row shells, metadata, focus rings, trend colors, and availability/status badges to semantic classes. Preserve captain and vice-captain meaning.

- [ ] **Step 2: Migrate analytics panels**

Use app semantic classes for panels:

```ts
const panelClass = 'rounded-md border border-border bg-card p-4 text-card-foreground shadow-sm';
const mutedPanelClass = 'rounded-md border border-border bg-muted/30 p-4';
```

- [ ] **Step 3: Split `MyTeamPanel` into separate migration commits**

Use this order:

```text
1. Search/filter controls
2. Table/list headers
3. Player slot cards
4. Footer actions
5. Live scoring dark board
```

For the live scoring dark board, preserve intentional dark surface mood. Convert repeated hex/slate strings into local constants first, then decide whether those constants should become tokens.

- [ ] **Step 4: Verify roster and team surfaces**

Run:

```bash
npx eslint src/components/team/PlayerRow.tsx src/components/team/TeamAnalyticsDashboard.tsx src/components/MyTeamPanel.tsx src/app/rosters/page.tsx src/app/team-analytics/TeamAnalyticsClient.tsx
npx tsc -p tsconfig.app.json --noEmit --pretty false
```

Expected: PASS.

Acceptance criteria:

- Core roster actions remain reachable.
- Dark sports-board styling remains intentional, not accidental copy-paste.
- No drag/drop, roster, or scoring behavior changes.

## Phase 5: Auth, Public, And App Shell Review

**Purpose:** Separate intentional brand art direction from product-shell drift.

**Files:**

- Modify: `src/components/AuthForm.tsx`
- Modify: `src/components/AuthCTA.tsx`
- Modify: `src/app/(auth)/login/page.tsx`
- Modify: `src/app/(auth)/register/page.tsx`
- Modify: `src/components/navigation/MainSidebar.tsx`
- Review first: `src/app/fantasy/page.tsx`
- Review first: `src/app/page.tsx`

- [ ] **Step 1: Classify public-page styling**

Classify each public page section as one of:

```text
preserve: intentional brand/art direction
migrate: product chrome or duplicated generic panel styling
defer: requires product/design decision
```

- [ ] **Step 2: Migrate auth controls**

Use `UIInput`, `UILabel`, `UIButton`, semantic focus classes, and explicit error/help associations. Preserve auth behavior.

- [ ] **Step 3: Deprecate or migrate `MainSidebar`**

Run:

```bash
rg -n "MainSidebar" src -g '*.{ts,tsx}'
```

If `MainSidebar` is not mounted, add a short comment at the export site explaining that `MainNavigation` is the active shell. If mounted, migrate shell classes to semantic tokens.

- [ ] **Step 4: Verify auth and shell**

Run:

```bash
npx eslint src/components/AuthForm.tsx src/components/AuthCTA.tsx 'src/app/(auth)/login/page.tsx' 'src/app/(auth)/register/page.tsx' src/components/navigation/MainSidebar.tsx
npx tsc -p tsconfig.app.json --noEmit --pretty false
```

Expected: PASS.

Acceptance criteria:

- Auth flows keep labels, validation, loading, and error behavior.
- Public art direction is documented rather than accidentally token-flattened.

## Phase 6: Drift Guard And CI Rollout

**Purpose:** Prevent future drift after migration has reduced the current baseline.

**Files:**

- Create: `scripts/check-design-drift.ts`
- Modify: `package.json`
- Modify: `docs/audits/design-system-drift-baseline-2026-05-04.md`

- [ ] **Step 1: Create a reporting guard, not a brittle blocker**

Create `scripts/check-design-drift.ts` with categories:

```ts
const tokenCandidatePattern =
  /\b(?:bg|text|border|ring|from|to|via)-(?:gray|slate|blue|red|green|yellow|purple|orange|cyan|indigo|sky|emerald|rose)-\d{2,3}(?:\/\d+)?\b|#[0-9A-Fa-f]{3,8}/g;

const legacyIconPattern = /@heroicons\/react|react-icons/g;
```

The script should print grouped findings by file and exit non-zero only when run with `--strict`.

- [ ] **Step 2: Add scripts**

Add to `package.json`:

```json
"design:drift": "tsx scripts/check-design-drift.ts",
"guard:design": "tsx scripts/check-design-drift.ts --strict"
```

- [ ] **Step 3: Run report mode**

Run:

```bash
npm run design:drift
```

Expected: prints remaining findings and exits 0.

- [ ] **Step 4: Enable strict mode only after allowlist is documented**

Add `guard:design` to `prepush:ci` only when remaining findings are either fixed or explicitly documented in `docs/audits/design-system-drift-baseline-2026-05-04.md`.

Acceptance criteria:

- Report mode is useful during migration.
- Strict mode is not enabled until it will not block intentional design.

## Verification Matrix

Every implementation phase must run:

```bash
npx prettier --check <changed-files>
npx eslint <changed-files>
npx tsc -p tsconfig.app.json --noEmit --pretty false
```

Surface-specific checks:

- Rankings/player tables: ranking a11y tests and any table tests present.
- League workspace: league component tests if present, plus manual review of loading/error/empty states.
- Roster/live scoring: verify no drag/drop, scoring, or roster ownership behavior changed.
- Auth: verify login/register/forgot-password loading and error states.
- Figma-driven changes: compare against Figma screenshot and check desktop/mobile/dark mode.

## Recommended Execution Order

1. Phase 0: baseline inventory.
2. Phase 1: shared semantic decisions.
3. Phase 2 and Phase 3 can run in parallel after Phase 1.
4. Phase 4 should run after table/status patterns settle.
5. Phase 5 can run independently after Phase 1.
6. Phase 6 runs last.

## Subagent Boundaries

Safe parallel workers:

- Worker A: Phase 0 and Phase 6 guard/reporting files.
- Worker B: Phase 1 foundation plus league patterns.
- Worker C: Phase 3 rankings/player table surfaces.
- Worker D: Phase 5 auth/public/app-shell review.

Do not run Phase 4 `MyTeamPanel` work in parallel with rankings/player table work if both workers need shared table or player row abstractions.
