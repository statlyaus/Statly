# Player Page Balanced Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved balanced profile dashboard UX for Statly player detail pages.

**Architecture:** Keep the existing player page data flow and component ownership. `PlayerDetail` owns page composition, `PlayerSummaryCard` owns the profile header, `PlayerChart` owns chart presentation, and `MatchLogTable` keeps its table behavior while improving valid empty states.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind utility classes, existing Chart.js/React Chart.js, existing Heroicons in `MatchLogTable`.

---

## File Structure

- Modify `src/components/PlayerSummaryCard.tsx`: replace the sparse white card with the approved profile header and stat rail. Reuse the existing `Player` type and import the null-safe `capitalizeWords` helper from `src/lib/utils.ts`.
- Modify `src/components/PlayerDetail.tsx`: keep the API envelope normalizer and match-log data mapping, but change the layout into a constrained profile dashboard with sibling panels for performance and logs.
- Modify `src/components/PlayerChart.tsx`: keep the same props and chart behavior, but update headings, panel styling, chart height, and empty chart copy.
- Modify `src/components/MatchLogTable.tsx`: change only the loading and empty-state branches plus outer panel tone where needed; preserve sort, filters, row selection, and non-empty table behavior.
- Do not change API routes, data contracts, global layout, theme files, or dependencies.

## Current Prerequisite

The current worktree already contains unstaged runtime fixes in:

- `src/app/(app)/players/[id]/page.tsx`
- `src/components/PlayerDetail.tsx`

Those fixes unwrap standardized API responses and are required for the player page to render. Do not discard or overwrite them. If working from a clean branch, re-apply or verify equivalent behavior before starting this UX plan.

## PROPOSED EDIT PLAN

Working with: `src/components/PlayerSummaryCard.tsx`, `src/components/PlayerDetail.tsx`, `src/components/PlayerChart.tsx`, `src/components/MatchLogTable.tsx`
Total planned edits: 4

### Edit sequence:

1. Replace `PlayerSummaryCard` with the balanced profile header - Purpose: establish the page's visual anchor and safe data presentation.
2. Reframe `PlayerDetail` layout around summary, performance, and logs panels - Purpose: turn disconnected sections into one coherent dashboard.
3. Polish `PlayerChart` panel and empty chart state - Purpose: keep chart behavior while matching the approved visual system.
4. Polish `MatchLogTable` loading/empty states - Purpose: present valid empty match logs as neutral empty data, not an error.

Dependencies:

- Edit 2 depends on Edit 1 because the page spacing assumes the new summary card spans the content width.
- Edit 3 and Edit 4 depend on Edit 2 because `PlayerDetail` supplies their containing grid.
- Verification depends on the prerequisite API envelope fixes remaining in place.

Verification:

- `npx eslint 'src/components/PlayerSummaryCard.tsx' 'src/components/PlayerDetail.tsx' 'src/components/PlayerChart.tsx' 'src/components/MatchLogTable.tsx' 'src/app/(app)/players/[id]/page.tsx'`
- `npm run typecheck -- --pretty false`
- Browser verification at `http://localhost:3000/players/nick-daicos-collingwood`
- Desktop and mobile viewport checks
- `Refresh Data` interaction check

### Task 1: Profile Summary Card

**Files:**

- Modify: `src/components/PlayerSummaryCard.tsx`

- [ ] **Step 1: Replace the local unsafe formatter and old card markup**

Replace the file body with this implementation:

```tsx
// src/components/PlayerSummaryCard.tsx
'use client';

import React from 'react';
import { capitalizeWords } from '@/lib/utils';
import type { Player } from '../types/players';

type Props = {
  player: Player;
};

const statLabels: Record<string, string> = {
  MG: 'Metres Gained',
  CP: 'Cont. Poss',
  UP: 'Uncont. Poss',
  DE: 'Disp. Eff %',
  ED: 'Effective Disposals',
  CL: 'Clangers',
  CCL: 'Centre Clearances',
  SCL: 'Stoppage Clearances',
  SI: 'Score Involvements',
  T5: 'Tackles I50',
  MI5: 'Marks I50',
  ITC: 'Intercepts',
  BO: 'Bounces',
  GA: 'Goal Assists',
  TOG: 'Time on Ground %',
};

const PlayerSummaryCard: React.FC<Props> = ({ player }) => {
  const { name, team, position, injury, games, summary = {} } = player;
  const summaryStats = summary as Record<string, number>;
  const displayName = capitalizeWords(name) || 'Unknown player';
  const displayPosition = position ? String(position) : '-';

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="bg-foreground px-5 py-6 text-background sm:px-7">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-background/70">
              Player profile
            </p>
            <h1 className="mt-2 break-words text-3xl font-bold leading-tight sm:text-4xl">
              {displayName}
            </h1>
            <div className="mt-4 flex flex-wrap gap-2">
              {team && (
                <span className="rounded-full border border-background/20 bg-background/10 px-3 py-1 text-sm font-medium text-background">
                  {team}
                </span>
              )}
              {position && (
                <span className="rounded-full border border-background/20 bg-background/10 px-3 py-1 text-sm font-medium text-background">
                  {position}
                </span>
              )}
              {injury && (
                <span className="rounded-full border border-destructive/20 bg-destructive/15 px-3 py-1 text-sm font-semibold text-background">
                  Injured
                </span>
              )}
            </div>
          </div>

          <div className="grid min-w-0 grid-cols-2 gap-3 sm:min-w-56">
            <div className="rounded-lg border border-background/15 bg-background/10 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-background/70">
                Games
              </div>
              <div className="mt-1 text-3xl font-bold">{games ?? '-'}</div>
            </div>
            <div className="rounded-lg border border-background/15 bg-background/10 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-background/70">
                Position
              </div>
              <div className="mt-1 text-2xl font-bold">{displayPosition}</div>
            </div>
          </div>
        </div>
      </div>

      {Object.entries(statLabels).some(([key]) => typeof summaryStats[key] === 'number') && (
        <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-6">
          {Object.entries(statLabels).map(([key, label]) =>
            typeof summaryStats[key] === 'number' ? (
              <div key={key} className="bg-card px-4 py-3">
                <div className="text-xs font-medium text-muted-foreground">{label}</div>
                <div className="mt-1 text-lg font-semibold text-card-foreground">
                  {summaryStats[key]}
                </div>
              </div>
            ) : null
          )}
        </div>
      )}
    </section>
  );
};

export default PlayerSummaryCard;
```

- [ ] **Step 2: Run focused lint**

Run:

```bash
npx eslint src/components/PlayerSummaryCard.tsx
```

Expected: exits `0`.

- [ ] **Step 3: Commit task if working in an implementation branch**

Only commit if the branch/workflow expects incremental commits and no unrelated files are staged:

```bash
git add src/components/PlayerSummaryCard.tsx
git commit -m "style: redesign player summary card"
```

Expected: commit contains only `src/components/PlayerSummaryCard.tsx`.

### Task 2: Player Detail Layout

**Files:**

- Modify: `src/components/PlayerDetail.tsx`

- [ ] **Step 1: Keep response normalization, then replace the returned JSX layout**

In `src/components/PlayerDetail.tsx`, keep lines equivalent to the existing imports, `normalizeMatchLogsResponse`, state, effect, and match mapping. Replace the `return (...)` block with:

```tsx
return (
  <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
    <PlayerSummaryCard player={player} />

    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
      <section className="min-w-0">
        {loading ? (
          <div className="flex h-72 items-center justify-center rounded-lg border border-border bg-card shadow-sm">
            <LoadingSpinner />
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">
            {error}
          </div>
        ) : (
          <PlayerChart
            matchData={matchLogs.map((log) => ({
              round: log.round,
              totalValue: log.totalValue || log.fantasyPoints || 0,
              opposition: log.opponent,
            }))}
            playerName={player.name}
          />
        )}
      </section>

      <section className="min-w-0">
        {loading ? (
          <div className="flex h-72 items-center justify-center rounded-lg border border-border bg-card shadow-sm">
            <LoadingSpinner />
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">
            {error}
          </div>
        ) : (
          <MatchLogTable
            matchLogs={matchLogs}
            playerName={player.name}
            showAdvancedStats={true}
            onRefresh={() => window.location.reload()}
          />
        )}
      </section>
    </div>
  </div>
);
```

- [ ] **Step 2: Run focused lint**

Run:

```bash
npx eslint src/components/PlayerDetail.tsx
```

Expected: exits `0`.

- [ ] **Step 3: Commit task if working in an implementation branch**

Only commit if no unrelated files are staged:

```bash
git add src/components/PlayerDetail.tsx
git commit -m "style: frame player detail dashboard layout"
```

Expected: commit contains only `src/components/PlayerDetail.tsx`.

### Task 3: Performance Chart Panel

**Files:**

- Modify: `src/components/PlayerChart.tsx`

- [ ] **Step 1: Replace the chart container markup and options**

In `src/components/PlayerChart.tsx`, keep the imports, Chart.js registration, prop types, and `sortedMatches`/`labels`/`values` calculations. Replace the returned JSX with:

```tsx
return (
  <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="text-xl font-semibold text-card-foreground">Recent Performance</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {playerName} - 9-category total value by round
        </p>
      </div>
      <span className="w-fit rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
        2025 season
      </span>
    </div>

    <div className="mt-5 h-72">
      {sortedMatches.length > 0 ? (
        <Line
          data={{
            labels,
            datasets: [
              {
                label: 'Total Value (9-Category)',
                data: values,
                borderColor: '#2563eb',
                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#2563eb',
                pointBorderColor: '#ffffff',
                pointBorderWidth: 2,
                pointRadius: 4,
              },
            ],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                display: false,
              },
              tooltip: {
                callbacks: {
                  title: (context) => context[0].label,
                  label: (context) => `Total Value: ${context.parsed.y.toFixed(1)}`,
                },
              },
            },
            scales: {
              y: {
                beginAtZero: true,
                grid: {
                  color: 'rgba(148, 163, 184, 0.25)',
                },
                title: {
                  display: true,
                  text: 'Total Value Points',
                },
              },
              x: {
                grid: {
                  display: false,
                },
                title: {
                  display: true,
                  text: 'Match',
                },
              },
            },
            interaction: {
              intersect: false,
              mode: 'index' as const,
            },
          }}
        />
      ) : (
        <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center">
          <div>
            <h3 className="text-base font-semibold text-card-foreground">
              No performance data yet
            </h3>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              Match data will appear here once round-by-round totals are available.
            </p>
          </div>
        </div>
      )}
    </div>

    {sortedMatches.length > 0 && (
      <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-4 text-sm md:grid-cols-4">
        <div>
          <div className="text-muted-foreground">Average</div>
          <div className="font-semibold text-card-foreground">
            {(values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Best</div>
          <div className="font-semibold text-card-foreground">{Math.max(...values).toFixed(1)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Worst</div>
          <div className="font-semibold text-card-foreground">{Math.min(...values).toFixed(1)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Games</div>
          <div className="font-semibold text-card-foreground">{sortedMatches.length}</div>
        </div>
      </div>
    )}
  </div>
);
```

- [ ] **Step 2: Run focused lint**

Run:

```bash
npx eslint src/components/PlayerChart.tsx
```

Expected: exits `0`.

- [ ] **Step 3: Commit task if working in an implementation branch**

Only commit if no unrelated files are staged:

```bash
git add src/components/PlayerChart.tsx
git commit -m "style: polish player performance chart panel"
```

Expected: commit contains only `src/components/PlayerChart.tsx`.

### Task 4: Match Log Empty State

**Files:**

- Modify: `src/components/MatchLogTable.tsx`

- [ ] **Step 1: Replace only the loading branch**

In `src/components/MatchLogTable.tsx`, replace the `if (isLoading) { ... }` block with:

```tsx
if (isLoading) {
  return (
    <div className={`rounded-lg border border-border bg-card shadow-sm ${className}`}>
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <ArrowPathIcon className="mx-auto mb-4 h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading match logs...</p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace only the empty-state branch**

Still in `src/components/MatchLogTable.tsx`, replace the `if (!matchLogs || matchLogs.length === 0) { ... }` block with:

```tsx
if (!matchLogs || matchLogs.length === 0) {
  return (
    <div className={`rounded-lg border border-border bg-card p-5 shadow-sm ${className}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-card-foreground">Match Logs</h2>
          <p className="mt-1 text-sm text-muted-foreground">Most recent AFL fantasy records</p>
        </div>
      </div>

      <div className="mt-5 rounded-lg border border-dashed border-border bg-muted/30 p-6">
        <ChartBarIcon className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <h3 className="mt-4 text-base font-semibold text-card-foreground">
          No match data available
        </h3>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          {playerName
            ? `No match logs were returned for ${playerName}.`
            : 'No match logs were returned for this player.'}
        </p>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            className="mt-4 inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <ArrowPathIcon className="h-4 w-4" aria-hidden="true" />
            Refresh Data
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Do not alter the non-empty table behavior**

Review the diff:

```bash
git diff -- src/components/MatchLogTable.tsx
```

Expected: only the loading and empty branches changed. Sorting, filters, table columns, modal, row actions, and non-empty state behavior remain intact.

- [ ] **Step 4: Run focused lint**

Run:

```bash
npx eslint src/components/MatchLogTable.tsx
```

Expected: exits `0`.

- [ ] **Step 5: Commit task if working in an implementation branch**

Only commit if no unrelated files are staged:

```bash
git add src/components/MatchLogTable.tsx
git commit -m "style: calm player match log empty state"
```

Expected: commit contains only `src/components/MatchLogTable.tsx`.

### Task 5: Full Verification

**Files:**

- Inspect: `src/app/(app)/players/[id]/page.tsx`
- Inspect: `src/components/PlayerDetail.tsx`
- Inspect: `src/components/PlayerSummaryCard.tsx`
- Inspect: `src/components/PlayerChart.tsx`
- Inspect: `src/components/MatchLogTable.tsx`

- [ ] **Step 1: Run focused lint for all touched files**

Run:

```bash
npx eslint 'src/app/(app)/players/[id]/page.tsx' \
  'src/components/PlayerDetail.tsx' \
  'src/components/PlayerSummaryCard.tsx' \
  'src/components/PlayerChart.tsx' \
  'src/components/MatchLogTable.tsx'
```

Expected: exits `0`.

- [ ] **Step 2: Run TypeScript**

Run:

```bash
npm run typecheck -- --pretty false
```

Expected: exits `0`.

- [ ] **Step 3: Browser verify desktop**

Open:

```text
http://localhost:3000/players/nick-daicos-collingwood
```

Expected desktop evidence:

- URL remains `/players/nick-daicos-collingwood`.
- Page title remains `Statly - Fantasy AFL`.
- Summary card shows `Nick Daicos`, `Collingwood`, `Injured`, `Games 18`, and `Position -` or the real position when present.
- Recent Performance panel renders with neutral empty chart copy if no match rows exist.
- Match Logs panel renders `No match data available`.
- The page does not show `Page Error`.
- The page does not show `Failed to load match history`.
- Browser console has no fresh app errors after reload.

- [ ] **Step 4: Browser verify interaction**

Click `Refresh Data`.

Expected:

- The page reloads or refreshes without a page error.
- The same valid empty-state content returns.
- Browser console has no fresh app errors after the interaction.

- [ ] **Step 5: Browser verify mobile**

Set a mobile viewport, such as `390x844`, and reload the same URL.

Expected mobile evidence:

- Summary chips wrap cleanly.
- Games and Position stat rail does not overflow.
- Performance and Match Logs stack vertically.
- No text overlaps or horizontal scrolling appears.

- [ ] **Step 6: Review final diff**

Run:

```bash
git diff --check -- \
  'src/app/(app)/players/[id]/page.tsx' \
  'src/components/PlayerDetail.tsx' \
  'src/components/PlayerSummaryCard.tsx' \
  'src/components/PlayerChart.tsx' \
  'src/components/MatchLogTable.tsx'
git diff --stat
git diff -- \
  'src/app/(app)/players/[id]/page.tsx' \
  'src/components/PlayerDetail.tsx' \
  'src/components/PlayerSummaryCard.tsx' \
  'src/components/PlayerChart.tsx' \
  'src/components/MatchLogTable.tsx'
```

Expected:

- No whitespace errors.
- Diff is limited to the prerequisite response unwrap and approved UX design files.
- No API, dependency, global theme, or unrelated route changes.

- [ ] **Step 7: Council Decision 2 before final commit**

Run:

```bash
npm run codex:council:logical -- --staged --prompt "Chairman Decision 2: decide whether this completed player page balanced profile UX implementation should be committed."
```

Expected:

- Output includes `CHAIRMAN DECISION 2: COMMIT` before committing.

- [ ] **Step 8: Commit through reviewed path**

Only after checks pass and Decision 2 says `COMMIT`, stage exactly the intended files:

```bash
git add 'src/app/(app)/players/[id]/page.tsx' \
  'src/components/PlayerDetail.tsx' \
  'src/components/PlayerSummaryCard.tsx' \
  'src/components/PlayerChart.tsx' \
  'src/components/MatchLogTable.tsx'
npm run codex:commit:reviewed -- "style: improve player profile page ux"
```

Expected:

- Commit succeeds.
- Staged files match the intended implementation scope.

## Self-Review

Spec coverage:

- Coherent dashboard profile: Task 1 and Task 2.
- Scannable identity, club, injury, games, position: Task 1.
- Framed performance/log panels: Task 2, Task 3, Task 4.
- Calm empty match-log state with refresh action: Task 4.
- Accessibility and responsive behavior: Task 1, Task 2, Task 4, Task 5.
- No new API fields/dependencies/global redesign: File Structure, Task 5 diff review.

Placeholder scan:

- No placeholder markers or vague deferred-work steps remain.

Type consistency:

- `Player`, `MatchLog`, `PlayerSummaryCard`, `PlayerChart`, and `MatchLogTable` names match the existing code.
- `normalizeMatchLogsResponse` remains in `PlayerDetail`.
- `onRefresh`, `playerName`, `matchLogs`, and `showAdvancedStats` props match `MatchLogTable`.
