# Match Log Nullability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve unknown AFL match-log stat values as explicit `null` from normalization through chart display, while keeping scoring fallbacks intentional and type-safe.

**Architecture:** Treat `null` as "known unavailable" and `undefined` as "not supplied at this boundary". `src/lib/matchLogs.ts` owns stat normalization, `src/components/PlayerDetail.tsx` maps API rows into UI data without semantic coercion, and `src/components/PlayerChart.tsx` renders nullable chart values using Chart.js gaps plus nullable-aware summary helpers. Scoring continues to use neutral handling for nullable efficiency modifiers through `calculateTotalValue`, not by converting all UI data to zero.

**Tech Stack:** Next.js App Router, React, TypeScript strict null checks, Chart.js via `react-chartjs-2`, Vitest, Testing Library.

---

## Research Notes

- Chart.js line datasets support skipped or missing values; `spanGaps` controls whether missing points create a visual gap or connected line. Use explicit `null` values in `data` to represent unavailable stats and set `spanGaps: false` for honest gaps.
- TypeScript `strictNullChecks` requires `null` and `undefined` to be declared in type contracts instead of being hidden behind a broader `number` type.
- JSON Schema models nullable data as a union such as `["number", "null"]`; absent and `null` are different states. This matches our `statAvailability` model.
- Zod distinguishes `.optional()`, `.nullable()`, and `.nullish()`. If API validation is added later, match-log stat fields should use nullable, not optional, when the stat key is present but unavailable.

Primary references used while writing this plan:
- Chart.js Line Chart docs: https://www.chartjs.org/docs/latest/charts/line.html
- Chart.js Data Structures docs: https://www.chartjs.org/docs/latest/general/data-structures.html
- TypeScript `strictNullChecks`: https://www.typescriptlang.org/tsconfig/#strictNullChecks
- JSON Schema null reference: https://json-schema.org/understanding-json-schema/reference/null
- Zod optionals/nullables/nullish docs: https://zod.dev/?id=optionals

---

## File Structure

- Modify: `src/lib/matchLogs.ts`
  - Responsibility: Match-log row types, nullable-stat registry, normalization, reconciliation helpers.
  - Change intent: Tighten `normalizeMatchLogStatValue` parsing so invalid numeric strings do not become partial numbers.

- Modify: `src/lib/matchLogs.test.ts`
  - Responsibility: Unit coverage for match-log normalization and reconciliation.
  - Change intent: Lock down strict numeric parsing and nullable semantics.

- Modify: `src/components/PlayerChart.tsx`
  - Responsibility: Player trend chart, focused round display, opponent round chips, summary stat tiles.
  - Change intent: Accept `number | null` values, render unavailable values as gaps, and compute summaries from numeric values only.

- Create: `src/components/PlayerChart.test.tsx`
  - Responsibility: Component-level and exported-helper tests for nullable chart behavior.
  - Change intent: Prove null values are passed to Chart.js as gaps, excluded from summaries, and displayed as unavailable rather than zero.

- Modify: `src/components/PlayerDetail.tsx`
  - Responsibility: Fetch player match rows, compute total values, prepare chart data and match-log table display.
  - Change intent: Keep nullable stats as null for chart metrics, while total value remains numeric through scoring-specific neutral fallback.

- Create: `src/components/PlayerDetail.test.tsx`
  - Responsibility: Boundary test for mapping nullable API stats into `PlayerChart`.
  - Change intent: Prove nullable advanced stats reach the chart as `null` instead of `0`.

- Modify: `docs/superpowers/plans/2026-05-08-typecheck-blockers.md`
  - Responsibility: Historical implementation plan for the original typecheck blocker fix.
  - Change intent: Correct the stale `PlayerChart` contract note after implementation so future workers do not follow outdated guidance.

---

## Task 1: Lock Down Match-Log Stat Normalization

**Files:**
- Modify: `src/lib/matchLogs.test.ts`
- Modify: `src/lib/matchLogs.ts`

- [ ] **Step 1: Add failing tests for strict numeric parsing**

In `src/lib/matchLogs.test.ts`, add this test inside `describe('normalizeMatchLogStatValue', () => { ... })`, after the existing `"preserves finite numeric and numeric-string values"` test:

```ts
  it('rejects blank and partially numeric strings instead of parsing prefixes', () => {
    expect(normalizeMatchLogStatValue('disposalEffPct', '')).toBeNull();
    expect(normalizeMatchLogStatValue('disposalEffPct', '   ')).toBeNull();
    expect(normalizeMatchLogStatValue('disposalEffPct', '72%')).toBeNull();
    expect(normalizeMatchLogStatValue('disposalEffPct', '72abc')).toBeNull();
    expect(normalizeMatchLogStatValue('disposals', '')).toBe(0);
    expect(normalizeMatchLogStatValue('disposals', '   ')).toBe(0);
    expect(normalizeMatchLogStatValue('disposals', '18 disposals')).toBe(0);
    expect(normalizeMatchLogStatValue('disposals', 'Infinity')).toBe(0);
  });
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npx vitest run src/lib/matchLogs.test.ts --runInBand
```

Expected: FAIL. At minimum, `'72%'` currently parses as `72` because `Number.parseFloat` accepts numeric prefixes.

- [ ] **Step 3: Replace partial string parsing with exact numeric-string parsing**

In `src/lib/matchLogs.ts`, replace the current `normalizeMatchLogStatValue` implementation with this code:

```ts
function fallbackMatchLogStatValue(key: CanonicalStatKey): number | null {
  return isMatchLogNullableStatKey(key) ? null : 0;
}

function parseExactFiniteNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeMatchLogStatValue(
  key: CanonicalStatKey,
  value: unknown
): number | null {
  if (value == null) {
    return fallbackMatchLogStatValue(key);
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallbackMatchLogStatValue(key);
  }

  if (typeof value === 'string') {
    return parseExactFiniteNumber(value) ?? fallbackMatchLogStatValue(key);
  }

  return fallbackMatchLogStatValue(key);
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
npx vitest run src/lib/matchLogs.test.ts --runInBand
```

Expected: PASS for `src/lib/matchLogs.test.ts`.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add src/lib/matchLogs.ts src/lib/matchLogs.test.ts
git commit -m "fix: tighten match log stat normalization"
```

Expected: Commit succeeds with only the normalization helper and tests staged.

---

## Task 2: Add Nullable Chart Tests Before Changing PlayerChart

**Files:**
- Create: `src/components/PlayerChart.test.tsx`
- Read: `src/components/PlayerChart.tsx`

- [ ] **Step 1: Create a failing test file for nullable chart behavior**

Create `src/components/PlayerChart.test.tsx` with this content:

```tsx
import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import PlayerChart, {
  formatNullableMetricValue,
  summarizeNullableChartValues,
} from './PlayerChart';

const lineRenderMock = vi.fn();

vi.mock('chart.js', () => ({
  CategoryScale: class CategoryScale {},
  Chart: {
    register: vi.fn(),
  },
  Legend: class Legend {},
  LineElement: class LineElement {},
  LinearScale: class LinearScale {},
  PointElement: class PointElement {},
  Tooltip: class Tooltip {},
}));

vi.mock('react-chartjs-2', () => ({
  Line: (props: ComponentProps<'div'> & { data: unknown; options: unknown }) => {
    lineRenderMock(props);
    return <div data-testid="line-chart" />;
  },
}));

describe('PlayerChart nullable values', () => {
  it('passes null values to Chart.js as gaps instead of converting them to zero', () => {
    render(
      <PlayerChart
        playerName="Test Player"
        metricLabel="Disposal Efficiency"
        matchData={[
          { round: 1, value: 72.5, opposition: 'Carlton' },
          { round: 2, value: null, opposition: 'Collingwood' },
          { round: 3, value: 84, opposition: 'Essendon' },
        ]}
      />
    );

    expect(screen.getByTestId('line-chart')).toBeInTheDocument();

    const props = lineRenderMock.mock.calls[0]?.[0] as {
      data: { datasets: Array<{ data: Array<number | null>; spanGaps?: boolean }> };
    };

    expect(props.data.datasets[0]?.data).toEqual([72.5, null, 84]);
    expect(props.data.datasets[0]?.spanGaps).toBe(false);
  });

  it('summarizes only finite numeric chart values', () => {
    expect(summarizeNullableChartValues([72.5, null, 84])).toEqual({
      average: 78.25,
      best: 84,
      worst: 72.5,
      numericCount: 2,
      hasData: true,
    });
  });

  it('formats unavailable chart values without implying a zero result', () => {
    expect(formatNullableMetricValue(null)).toBe('Not available');
    expect(formatNullableMetricValue(72.5)).toBe('72.5');
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
npx vitest run src/components/PlayerChart.test.tsx --runInBand
```

Expected: FAIL. `formatNullableMetricValue` and `summarizeNullableChartValues` are not exported yet, and `PlayerChart` still requires numeric values.

- [ ] **Step 3: Commit nothing**

Run:

```bash
git status --short
```

Expected: `src/components/PlayerChart.test.tsx` is untracked or modified. Do not commit until Task 3 makes it pass.

---

## Task 3: Make PlayerChart Nullable-Aware

**Files:**
- Modify: `src/components/PlayerChart.tsx`
- Test: `src/components/PlayerChart.test.tsx`

- [ ] **Step 1: Widen the chart value contract**

In `src/components/PlayerChart.tsx`, replace the `MatchData` type with this code:

```ts
type MatchData = {
  round: number | undefined;
  value: number | null;
  opposition: string;
};
```

- [ ] **Step 2: Add exported nullable-value helpers**

In `src/components/PlayerChart.tsx`, add these helpers after `getAbbrBadgeClasses` and before `const PlayerChart`:

```ts
type NullableChartSummary = {
  average: number;
  best: number;
  worst: number;
  numericCount: number;
  hasData: boolean;
};

function isFiniteChartValue(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function summarizeNullableChartValues(values: Array<number | null>): NullableChartSummary {
  const numericValues = values.filter(isFiniteChartValue);

  if (numericValues.length === 0) {
    return {
      average: 0,
      best: 0,
      worst: 0,
      numericCount: 0,
      hasData: false,
    };
  }

  return {
    average: numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length,
    best: Math.max(...numericValues),
    worst: Math.min(...numericValues),
    numericCount: numericValues.length,
    hasData: true,
  };
}

export function formatNullableMetricValue(value: number | null): string {
  return isFiniteChartValue(value) ? value.toFixed(1) : 'Not available';
}

function getComparableChartValue(value: number | null): number {
  return isFiniteChartValue(value) ? Math.abs(value) : Number.NEGATIVE_INFINITY;
}
```

- [ ] **Step 3: Replace numeric-only summary derivation**

In `src/components/PlayerChart.tsx`, replace:

```ts
  const values = sortedMatches.map((match) => match.value);
  const focusPointValues = values.map((value, idx) =>
    activePointIndex !== null && idx === activePointIndex ? value : null
  );
  const hasData = values.some((v) => Number.isFinite(v) && v !== 0);
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const best = values.length ? Math.max(...values) : 0;
  const worst = values.length ? Math.min(...values) : 0;
```

with:

```ts
  const values = sortedMatches.map((match) => match.value);
  const focusPointValues = values.map((value, idx) =>
    activePointIndex !== null && idx === activePointIndex && isFiniteChartValue(value)
      ? value
      : null
  );
  const summary = summarizeNullableChartValues(values);
  const { average: avg, best, worst, numericCount, hasData } = summary;
```

- [ ] **Step 4: Update duplicate-round comparison to tolerate null**

In `src/components/PlayerChart.tsx`, replace:

```ts
      if (Math.abs(match.value) > Math.abs(existing.match.value)) {
        byRound.set(round, { match, chartIndex });
      }
```

with:

```ts
      if (getComparableChartValue(match.value) > getComparableChartValue(existing.match.value)) {
        byRound.set(round, { match, chartIndex });
      }
```

- [ ] **Step 5: Set Chart.js gap behavior explicitly**

In the first dataset object passed to `<Line />`, add `spanGaps: false` immediately after `data: values`:

```ts
                  data: values,
                  spanGaps: false,
```

- [ ] **Step 6: Make tooltip formatting nullable-aware**

In `renderBroadcastTooltip`, replace:

```ts
  const rawValue = typeof point?.raw === 'number' ? point.raw : Number(point?.raw ?? 0);
  const value = Number.isFinite(rawValue) ? rawValue.toFixed(1) : '0.0';
```

with:

```ts
  const rawValue = typeof point?.raw === 'number' && Number.isFinite(point.raw) ? point.raw : null;
  const value = formatNullableMetricValue(rawValue);
```

- [ ] **Step 7: Make focused summary copy distinguish missing data from DNP**

In `src/components/PlayerChart.tsx`, replace:

```ts
  const focusedValue = focusedIsDnp ? null : focusedMatch ? focusedMatch.value : null;
```

with:

```ts
  const focusedValue = focusedIsDnp ? null : (focusedMatch?.value ?? null);
  const focusedHasUnavailableStat = !focusedIsDnp && focusedMatch != null && focusedValue === null;
```

Then replace:

```tsx
                {focusedValue !== null ? focusedValue.toFixed(1) : 'DNP'}
```

with:

```tsx
                {formatNullableMetricValue(focusedValue)}
```

Then replace:

```tsx
                <p className="text-sm font-semibold text-slate-500">No match recorded</p>
```

with:

```tsx
                <p className="text-sm font-semibold text-slate-500">
                  {focusedHasUnavailableStat ? 'Stat unavailable for this match' : 'No match recorded'}
                </p>
```

- [ ] **Step 8: Make the summary tile count explicit**

In the final summary grid, replace:

```tsx
              <div className="text-slate-500">Games</div>
              <div className="text-xl font-bold text-slate-900">{sortedMatches.length}</div>
```

with:

```tsx
              <div className="text-slate-500">Data Points</div>
              <div className="text-xl font-bold text-slate-900">
                {numericCount}/{sortedMatches.length}
              </div>
```

- [ ] **Step 9: Run PlayerChart tests**

Run:

```bash
npx vitest run src/components/PlayerChart.test.tsx --runInBand
```

Expected: PASS.

- [ ] **Step 10: Commit Task 2 and Task 3 together**

Run:

```bash
git add src/components/PlayerChart.tsx src/components/PlayerChart.test.tsx
git commit -m "fix: support nullable player chart values"
```

Expected: Commit succeeds with the new PlayerChart test and implementation together.

---

## Task 4: Prove PlayerDetail Preserves Nullable Advanced Stats

**Files:**
- Create: `src/components/PlayerDetail.test.tsx`
- Modify: `src/components/PlayerDetail.tsx`

- [ ] **Step 1: Create a boundary test for PlayerDetail chart data**

Create `src/components/PlayerDetail.test.tsx` with this content:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type PlayerChart from './PlayerChart';
import { PlayerDetail } from './PlayerDetail';

const fetchApiMock = vi.fn();
const playerChartRenderMock = vi.fn();

vi.mock('@/lib/api', () => ({
  fetchApi: (...args: unknown[]) => fetchApiMock(...args),
}));

vi.mock('./PlayerSummaryCard', () => ({
  default: () => <div data-testid="player-summary-card" />,
}));

vi.mock('./ui', () => ({
  LoadingSpinner: () => <div data-testid="loading-spinner" />,
}));

vi.mock('./PlayerChart', () => ({
  default: (props: ComponentProps<typeof PlayerChart>) => {
    playerChartRenderMock(props);
    return <div data-testid="player-chart" />;
  },
}));

const basePlayer = {
  id: 'player-1',
  name: 'Test Player',
  position: 'MID',
  club: 'Carlton',
  status: 'active',
};

describe('PlayerDetail nullable match-log stats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes unavailable nullable advanced stats to PlayerChart as null', async () => {
    fetchApiMock.mockResolvedValue([
      {
        matchId: '2026-R1-CAR-RIC',
        season: 2026,
        roundNumber: 1,
        date: '2026-03-12',
        opponent: 'Richmond',
        stats: {
          behinds: 0,
          kicks: 12,
          handballs: 8,
          disposals: 20,
          marks: 5,
          tackles: 4,
          goals: 1,
          hitouts: 0,
          clearances: null,
          inside50s: null,
          rebound50s: null,
          clangers: 2,
          contestedPossessions: null,
          uncontestedPossessions: null,
          freesFor: null,
          freesAgainst: null,
          onePercenters: null,
          goalAssists: null,
          turnovers: null,
          intercepts: null,
          metresGained: null,
          contestedMarks: null,
          effectiveDisposals: null,
          scoreInvolvements: null,
          timeOnGroundPct: null,
          disposalEffPct: null,
          minutes: null,
        },
      },
    ]);

    render(<PlayerDetail player={basePlayer} />);

    await screen.findByTestId('player-chart');
    fireEvent.change(screen.getByLabelText(/stat/i), {
      target: { value: 'disposalEffPct' },
    });

    await waitFor(() => {
      const latestProps = playerChartRenderMock.mock.calls.at(-1)?.[0] as ComponentProps<
        typeof PlayerChart
      >;

      expect(latestProps.metricLabel).toBe('Disposal Efficiency %');
      expect(latestProps.matchData).toEqual([
        {
          round: 1,
          value: null,
          opposition: 'Richmond',
        },
      ]);
    });
  });
});
```

- [ ] **Step 2: Run the new boundary test and verify it passes after Task 3**

Run:

```bash
npx vitest run src/components/PlayerDetail.test.tsx --runInBand
```

Expected: PASS. `PlayerDetail` already calls `normalizeMatchLogStatValue(chartMetric, ...)`; after Task 3, the receiving chart contract accepts `null`.

- [ ] **Step 3: If the label assertion fails, inspect the canonical stat label**

Run:

```bash
rg "disposalEffPct" src/lib/stats/statColumns.ts
```

Expected: The stat label is present in `STAT_COLUMNS`. If the exact label differs from `Disposal Efficiency %`, update only the expected string in `src/components/PlayerDetail.test.tsx` to the actual canonical label.

- [ ] **Step 4: Commit Task 4**

Run:

```bash
git add src/components/PlayerDetail.test.tsx src/components/PlayerDetail.tsx
git commit -m "test: cover nullable player detail chart stats"
```

Expected: Commit succeeds. If `src/components/PlayerDetail.tsx` has no diff, omit it from `git add`.

---

## Task 5: Update Historical Plan Note And Run Verification

**Files:**
- Modify: `docs/superpowers/plans/2026-05-08-typecheck-blockers.md`
- Verify: `src/lib/matchLogs.ts`
- Verify: `src/components/PlayerChart.tsx`
- Verify: `src/components/PlayerDetail.tsx`

- [ ] **Step 1: Correct the stale PlayerChart type note**

In `docs/superpowers/plans/2026-05-08-typecheck-blockers.md`, replace the lines in the "Confirm the chart prop type" expected output:

```ts
type MatchData = {
  round: number | undefined;
  value: number | null;
  opposition: string;
};
```

with:

```ts
type MatchData = {
  round: number | undefined;
  value: number;
  opposition: string;
};
```

Then add this note immediately below that code block:

```markdown
Note: this was the contract at the time of the original blocker fix. The follow-up nullable-stat durability work in `docs/superpowers/plans/2026-05-12-match-log-nullability.md` intentionally widens `PlayerChart` to `value: number | null`.
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
npx vitest run src/lib/matchLogs.test.ts src/components/PlayerChart.test.tsx src/components/PlayerDetail.test.tsx --runInBand
```

Expected: PASS.

- [ ] **Step 3: Run app typecheck**

Run:

```bash
npm run typecheck:app
```

Expected: PASS. If it fails because dependencies are missing, run `npm install` only after confirming with the current executor policy; otherwise record the exact missing command output in the handoff.

- [ ] **Step 4: Run full typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS, or fail only on pre-existing test-project errors unrelated to `matchLogs`, `PlayerChart`, or `PlayerDetail`.

- [ ] **Step 5: Run diff hygiene**

Run:

```bash
git diff --check HEAD~4..HEAD
```

Expected: no output.

- [ ] **Step 6: Commit Task 5**

Run:

```bash
git add docs/superpowers/plans/2026-05-08-typecheck-blockers.md
git commit -m "docs: clarify player chart nullability follow-up"
```

Expected: Commit succeeds if the docs file changed. If the docs file already contains the note, skip this commit.

---

## Self-Review

- Spec coverage: The plan implements the durable long-term solution by preserving `null` in normalization, widening the chart contract, rendering Chart.js gaps, excluding unavailable data from summaries, and testing the `PlayerDetail` boundary.
- Placeholder scan: No "TBD", "TODO", "implement later", or unspecified "write tests" placeholders remain. Every code-changing step includes exact code or exact replacement guidance.
- Type consistency: `MatchData.value` is widened once to `number | null`; helper signatures, tests, focused values, and chart dataset values all use the same nullable type. Scoring remains separate through `calculateTotalValue`, which already accepts nullable efficiency modifiers.
- Maintainability: The plan avoids new dependencies, keeps the change scoped to existing files, and creates small exported helpers only where they make chart behavior testable without brittle canvas assertions.
