# Trade Centre Review Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a symmetric, sports-focused Trade Centre composer with full-row roster selection, honest average-based impact analysis, a sticky package tray, a mobile Send/Receive switch, and a client-only review step before the existing proposal API is called.

**Architecture:** `TradeComposer` remains the proposal-draft owner but delegates pure state transitions to a reducer and delegates presentation to focused workspace, tray, review, roster, and comparison components. The existing server snapshot and submission callback remain the source of truth; no API, persistence, lifecycle, or category arithmetic changes are permitted.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS 4, Lucide React, Testing Library, Vitest, Playwright, existing Statly trade DTOs and semantic CSS variables.

---

## File Structure

Create:

- `src/components/league/trades/tradeComposerState.ts` — pure proposal draft state, reducer, selectors, and neutral position deltas.
- `src/components/league/trades/tradeComposerState.test.ts` — reducer and selector regression coverage.
- `src/components/league/trades/TradeRosterWorkspace.tsx` — symmetric desktop panels and mobile Send/Receive switch.
- `src/components/league/trades/TradeRosterWorkspace.test.tsx` — responsive visibility and retained-selection semantics.
- `src/components/league/trades/TradeSelectionTray.tsx` — sticky selection/readiness action bar.
- `src/components/league/trades/TradeReviewStep.tsx` — client-only package confirmation view.

Modify:

- `src/components/league/trades/tradeComparison.ts` — add pure impact-summary aggregation without changing comparison math.
- `tests/unit/tradeComparison.test.ts` — cover gained/lost/even/unavailable summaries.
- `src/components/league/trades/TradeRosterTable.tsx` — team-relative API, sports identity, full-row pointer selection, larger rows/values, explicit sort state, and category help.
- `src/components/league/trades/TradeRosterTable.test.tsx` — prove row and checkbox interactions toggle exactly once.
- `src/components/league/trades/TradeComparisonTable.tsx` — team columns, compact impact summary, combined impact column, neutral header, and average-basis disclosure.
- `src/components/league/trades/TradeOfferAssets.tsx` — remove direction-colour semantics from persisted offer packages.
- `src/components/league/trades/TradeOfferStatus.tsx` — retain warning semantics without depending on removed send styling.
- `src/components/league/trades/TradeComposer.tsx` — reducer orchestration, edit/review focus management, and final-only submission.
- `src/components/league/trades/LeagueTradeCentrePanel.tsx` — pass existing trade rules into the composer and strengthen context typography.
- `src/components/league/trades/LeagueTradeCentrePanel.test.tsx` — update one-step submission expectations to the two-step flow.
- `src/index.css` — replace send/receive direction tokens with neutral/brand selection tokens.
- `tests/e2e/league-trade-centre.smoke.test.ts` — mobile switch, sticky tray, review transition, overflow, and control-size coverage.

Do not modify:

- `src/server/leagues/trades/tradeContracts.ts`
- `src/server/leagues/trades/tradeReadModel.ts`
- `src/server/leagues/trades/tradeService.ts`
- `prisma/schema.prisma`
- `prisma/dev.db`

## Task 1: Add Honest Category-Impact Summaries

**Files:**

- Modify: `tests/unit/tradeComparison.test.ts`
- Modify: `src/components/league/trades/tradeComparison.ts`

- [ ] **Step 1: Write the failing summary test**

Add the import and test below:

```ts
import {
  compareTradeSelections,
  summarizeTradeComparisons,
} from '@/components/league/trades/tradeComparison';

it('summarizes favourable, unfavourable, even, and unavailable categories', () => {
  const comparisons = compareTradeSelections(['sendOne'], ['receive'], {
    ...dataset,
    columns: [
      ...dataset.columns,
      {
        key: 'goals',
        label: 'Goals',
        shortLabel: 'G',
        format: 'number',
        direction: 'HIGH_WINS',
      },
      {
        key: 'tackles',
        label: 'Tackles',
        shortLabel: 'T',
        format: 'number',
        direction: 'HIGH_WINS',
      },
    ],
    playersById: {
      ...dataset.playersById,
      sendOne: {
        gamesPlayed: 10,
        values: { ...dataset.playersById.sendOne.values, goals: 1, tackles: null },
      },
      receive: {
        gamesPlayed: 10,
        values: { ...dataset.playersById.receive.values, goals: 1, tackles: 4 },
      },
    },
  });

  expect(summarizeTradeComparisons(comparisons)).toEqual({
    gained: 2,
    lost: 0,
    even: 1,
    unavailable: 1,
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm exec -- vitest run --config vitest.config.unit.ts tests/unit/tradeComparison.test.ts --coverage.enabled=false
```

Expected: FAIL because `summarizeTradeComparisons` is not exported.

- [ ] **Step 3: Implement the pure summary helper**

Add to `tradeComparison.ts`:

```ts
export interface TradeComparisonSummary {
  gained: number;
  lost: number;
  even: number;
  unavailable: number;
}

export function summarizeTradeComparisons(
  comparisons: readonly TradeCategoryComparison[]
): TradeComparisonSummary {
  return comparisons.reduce<TradeComparisonSummary>(
    (summary, comparison) => {
      if (comparison.outcome === 'favourable') summary.gained += 1;
      if (comparison.outcome === 'unfavourable') summary.lost += 1;
      if (comparison.outcome === 'even') summary.even += 1;
      if (comparison.outcome === 'unavailable') summary.unavailable += 1;
      return summary;
    },
    { gained: 0, lost: 0, even: 0, unavailable: 0 }
  );
}
```

Do not change `averageSelected` or `compareTradeSelections`.

- [ ] **Step 4: Run the unit test and verify it passes**

Run the command from Step 2.

Expected: 4 tests pass, including the existing average-not-total and lower-is-better cases.

- [ ] **Step 5: Review and checkpoint**

Run `git diff --check`. Do not stage `prisma/dev.db`. Record this task as complete in the plan; defer the reviewed commit until the complete feature passes Decision 2.

## Task 2: Introduce a Pure Composer State Machine

**Files:**

- Create: `src/components/league/trades/tradeComposerState.ts`
- Create: `src/components/league/trades/tradeComposerState.test.ts`

- [ ] **Step 1: Write failing reducer tests**

Create tests for initialization, toggles, partner changes, edit/review transitions, and reset:

```ts
import { describe, expect, it } from 'vitest';

import { createTradeComposerState, tradeComposerReducer } from './tradeComposerState';

describe('tradeComposerReducer', () => {
  it('keeps the draft local while moving between edit and review', () => {
    let state = createTradeComposerState({
      partnerId: 'member-2',
      sendingPlayerIds: ['send-1'],
      receivingPlayerIds: ['receive-1'],
    });

    state = tradeComposerReducer(state, { type: 'setMessage', message: 'Fair swap' });
    state = tradeComposerReducer(state, { type: 'review' });
    expect(state).toMatchObject({ step: 'review', message: 'Fair swap' });

    state = tradeComposerReducer(state, { type: 'edit' });
    expect(state).toMatchObject({
      step: 'edit',
      sendingPlayerIds: ['send-1'],
      receivingPlayerIds: ['receive-1'],
      message: 'Fair swap',
    });
  });

  it('clears only the incoming package when the partner changes', () => {
    const state = createTradeComposerState({
      partnerId: 'member-2',
      sendingPlayerIds: ['send-1'],
      receivingPlayerIds: ['receive-1'],
    });

    expect(
      tradeComposerReducer(state, { type: 'selectPartner', partnerId: 'member-3' })
    ).toMatchObject({
      partnerId: 'member-3',
      sendingPlayerIds: ['send-1'],
      receivingPlayerIds: [],
      step: 'edit',
    });
  });

  it('resets selections and message after a successful proposal', () => {
    const state = createTradeComposerState({
      partnerId: 'member-2',
      sendingPlayerIds: ['send-1'],
      receivingPlayerIds: ['receive-1'],
      message: 'Fair swap',
    });

    expect(tradeComposerReducer(state, { type: 'reset' })).toMatchObject({
      partnerId: 'member-2',
      sendingPlayerIds: [],
      receivingPlayerIds: [],
      message: '',
      activeRoster: 'sending',
      step: 'edit',
    });
  });
});
```

- [ ] **Step 2: Run the reducer test and verify it fails**

Run:

```bash
npm exec -- vitest run src/components/league/trades/tradeComposerState.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the reducer and selectors**

Create these public types and exports:

```ts
import type { TradePlayerDto } from '@/server/leagues/trades/tradeContracts';

export interface TradeComposerState {
  partnerId: string;
  sendingPlayerIds: string[];
  receivingPlayerIds: string[];
  message: string;
  activeRoster: 'sending' | 'receiving';
  step: 'edit' | 'review';
}

export type TradeComposerAction =
  | { type: 'selectPartner'; partnerId: string }
  | { type: 'toggleSendingPlayer'; playerId: string }
  | { type: 'toggleReceivingPlayer'; playerId: string }
  | { type: 'clearSelections' }
  | { type: 'setMessage'; message: string }
  | { type: 'showRoster'; roster: TradeComposerState['activeRoster'] }
  | { type: 'review' }
  | { type: 'edit' }
  | { type: 'reset' };

export interface CreateTradeComposerStateInput {
  partnerId: string;
  sendingPlayerIds?: string[];
  receivingPlayerIds?: string[];
  message?: string;
}

export function isTradeSelectionComplete(state: TradeComposerState): boolean {
  return state.sendingPlayerIds.length > 0 && state.receivingPlayerIds.length > 0;
}

export function getSelectedPlayers(
  players: readonly TradePlayerDto[],
  selectedIds: readonly string[]
): TradePlayerDto[] {
  const selected = new Set(selectedIds);
  return players.filter((player) => selected.has(player.id));
}

export function getPositionCounts(players: readonly TradePlayerDto[]): Record<string, number> {
  return players.reduce<Record<string, number>>((counts, player) => {
    counts[player.position] = (counts[player.position] ?? 0) + 1;
    return counts;
  }, {});
}

export function getPositionDeltas(
  outgoingPlayers: readonly TradePlayerDto[],
  incomingPlayers: readonly TradePlayerDto[]
): Record<string, number>;
```

Implement toggles with a shared immutable helper. `review` may only change `step` when `isTradeSelectionComplete(state)` is true. `reset` must preserve `partnerId`.

- [ ] **Step 4: Add selector coverage**

Add tests proving:

```ts
expect(isTradeSelectionComplete(createTradeComposerState({ partnerId: 'member-2' }))).toBe(false);
expect(getPositionCounts([{ id: '1', name: 'A', club: 'GWS', position: 'MID' }])).toEqual({
  MID: 1,
});
```

Add direct `getPositionDeltas` coverage across the union of positions, including positive, negative, zero, and unequal-package cases. The calculation is `incoming count - outgoing count`; it describes package balance only, never lineup legality or projected impact.

- [ ] **Step 5: Run reducer tests and typecheck**

Run:

```bash
npm exec -- vitest run src/components/league/trades/tradeComposerState.test.ts
npm run typecheck
```

Expected: all reducer tests pass and TypeScript exits 0.

## Task 3: Rebuild the Roster Table as a Sports Selection Surface

**Files:**

- Modify: `src/components/league/trades/TradeRosterTable.test.tsx`
- Modify: `src/components/league/trades/TradeRosterTable.tsx`

- [ ] **Step 1: Update the test harness to the symmetric API**

Replace `label`, `description`, and `onSelectionChange` with:

```tsx
<TradeRosterTable
  team={team}
  playerStats={playerStats}
  selectedIds={selectedIds}
  disabled={false}
  onTogglePlayer={(playerId) =>
    setSelectedIds((current) =>
      current.includes(playerId) ? current.filter((id) => id !== playerId) : [...current, playerId]
    )
  }
/>
```

Use a `TradeTeamDto` fixture named `Alpha FC`.

- [ ] **Step 2: Write failing row-selection tests**

Add:

```ts
it('toggles once from either the row or the native checkbox', async () => {
  const user = userEvent.setup();
  render(<Harness />);

  await user.click(screen.getByRole('row', { name: /Alice Able/ }));
  expect(screen.getByRole('checkbox', { name: /Alice Able/ })).toBeChecked();

  await user.click(screen.getByRole('checkbox', { name: /Alice Able/ }));
  expect(screen.getByRole('checkbox', { name: /Alice Able/ })).not.toBeChecked();
});

it('exposes the full category name and explicit sort state', async () => {
  render(<Harness />);

  expect(screen.getByRole('button', { name: /Inside 50s.*not sorted/i })).toBeInTheDocument();
  expect(screen.getByText('A–Z')).toBeInTheDocument();
});
```

- [ ] **Step 3: Run the roster test and verify it fails**

Run:

```bash
npm exec -- vitest run src/components/league/trades/TradeRosterTable.test.tsx
```

Expected: FAIL because the current API and interaction behavior differ.

- [ ] **Step 4: Implement the symmetric team API and row behavior**

Use this interface:

```ts
interface TradeRosterTableProps {
  team: TradeTeamDto;
  playerStats: LeaguePlayerStatDatasetDto;
  selectedIds: string[];
  disabled: boolean;
  onTogglePlayer: (playerId: string) => void;
}
```

For each row:

```tsx
<tr
  aria-selected={selected}
  onClick={(event) => {
    if (
      disabled ||
      (event.target instanceof Element && event.target.closest('input, label, button, a'))
    )
      return;
    onTogglePlayer(player.id);
  }}
  className="group h-14 cursor-pointer border-b border-[color:var(--trade-border)]"
>
```

The checkbox calls `onTogglePlayer(player.id)` directly and remains the only tab stop for selection. Extend the interaction regression so clicking the player-name label also toggles exactly once.

- [ ] **Step 5: Add existing AFL club identity**

Import:

```ts
import Image from 'next/image';
import { getTeamAbbreviation, getTeamLogo } from '@/lib/teamLogos';
```

Render a 24px club logo with the existing asset path and a neutral position badge. Use `getTeamAbbreviation(player.club)` for concise visible club identity and preserve the canonical club name in accessible text.

Do not render injury or availability. `TradePlayerDto` has no authoritative field for either state, so this remains an explicit residual product gap rather than a silent omission. Do not expand the protected read-model/server boundary in this UI-only change.

- [ ] **Step 6: Make sort state visibly explicit**

Keep `aria-sort` and update `SortButton` to show a compact text suffix:

```ts
const stateLabel = !active
  ? 'Not sorted'
  : sortKey === 'player'
    ? direction === 'ascending'
      ? 'A–Z'
      : 'Z–A'
    : direction === 'ascending'
      ? 'Low–high'
      : 'High–low';
```

Sort buttons must be at least 44px high. Every abbreviation control has the complete category name and sort state in its accessible label; a native `title` may provide optional pointer help. Do not use the existing global Tooltip because it cannot currently provide combined hover/focus semantics or a valid described-by relationship. The brief permits complete accessible expanded labels instead of a visual tooltip.

- [ ] **Step 7: Apply neutral selection semantics**

Use white/cool-grey surfaces for both teams. Selected rows use `--trade-selection-soft`, a Statly-blue leading accent, `aria-selected`, and a checked 20px control. Remove all send/receive amber/teal variables from this component.

- [ ] **Step 8: Run focused verification**

Run:

```bash
npm exec -- vitest run src/components/league/trades/TradeRosterTable.test.tsx
npm exec eslint -- src/components/league/trades/TradeRosterTable.tsx src/components/league/trades/TradeRosterTable.test.tsx
npm run typecheck
```

Expected: roster tests pass, lint has zero errors, and TypeScript exits 0.

## Task 4: Add the Symmetric Desktop and Mobile Roster Workspace

**Files:**

- Create: `src/components/league/trades/TradeRosterWorkspace.tsx`
- Create: `src/components/league/trades/TradeRosterWorkspace.test.tsx`

- [ ] **Step 1: Write failing workspace tests**

Cover symmetric headings, mobile controls, and retained selections:

```ts
it('uses symmetric team-relative headings and preserves both packages', async () => {
  const user = userEvent.setup();
  render(<Harness />);

  expect(screen.getByRole('heading', { name: 'Robbo Rockers sends' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'AFL Legends sends' })).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /Receive.*AFL Legends/i }));
  expect(screen.getByRole('button', { name: /Receive.*AFL Legends/i })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});
```

The DOM contains one instance of each panel so desktop can show them together. Give the inactive wrapper `hidden lg:block` and the active wrapper `block`; `display:none` removes the inactive mobile panel from the accessibility tree, so do not add `aria-hidden`. The segmented buttons expose active state with `aria-pressed`. JSDOM verifies the active state and responsive class contract; the in-app browser verifies actual breakpoint visibility and reflow.

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm exec -- vitest run src/components/league/trades/TradeRosterWorkspace.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the workspace interface**

```ts
interface TradeRosterWorkspaceProps {
  viewerTeam: TradeTeamDto;
  partnerTeam: TradeTeamDto;
  playerStats: LeaguePlayerStatDatasetDto;
  sendingPlayerIds: string[];
  receivingPlayerIds: string[];
  activeRoster: 'sending' | 'receiving';
  disabled: boolean;
  onToggleSendingPlayer: (playerId: string) => void;
  onToggleReceivingPlayer: (playerId: string) => void;
  onActiveRosterChange: (roster: 'sending' | 'receiving') => void;
}
```

The mobile control uses two 44px buttons with `aria-pressed`, `aria-controls`, team name, and selected count. The panel grid becomes two columns at `lg`; below `lg`, only the active panel is visually and accessibly active.

- [ ] **Step 4: Run tests and verify semantics**

Run:

```bash
npm exec -- vitest run src/components/league/trades/TradeRosterWorkspace.test.tsx
npm exec eslint -- src/components/league/trades/TradeRosterWorkspace.tsx src/components/league/trades/TradeRosterWorkspace.test.tsx
```

Expected: workspace tests pass and lint exits 0.

## Task 5: Build the Sticky Selection Tray

**Files:**

- Create: `src/components/league/trades/TradeSelectionTray.tsx`
- Test within: `src/components/league/trades/LeagueTradeCentrePanel.test.tsx`

- [ ] **Step 1: Write failing tray assertions**

Assert:

```ts
expect(screen.getByText('2 players selected')).toBeInTheDocument();
expect(screen.getByText('Ready to review')).toBeInTheDocument();
expect(screen.getByRole('button', { name: 'Clear selected players' })).toBeEnabled();
expect(screen.getByRole('button', { name: 'Review trade' })).toBeEnabled();
```

With only one side selected, expect `Select from both teams` and a disabled Review trade button.

- [ ] **Step 2: Implement the tray**

Use this API:

```ts
interface TradeSelectionTrayProps {
  selectedCount: number;
  selectionComplete: boolean;
  disabled: boolean;
  reviewButtonRef: React.RefObject<HTMLButtonElement | null>;
  onClear: () => void;
  onReview: () => void;
}
```

The composer edit view is a bounded flex workspace using `h-[clamp(28rem,65dvh,42rem)] min-h-0`. Partner, rosters, and live comparison sit in a `min-h-0 flex-1 overflow-y-auto overscroll-contain` content region, while the tray is a `shrink-0` footer sibling at the bottom of the composer. The tray uses a solid neutral surface, top border, safe-area bottom padding, and a subtle shadow. This makes it visible from the first selectable roster row through category inspection without viewport-global positioning. Keep roster tables horizontally scrollable and cap their vertical height so the two nested scroll regions remain distinguishable; browser QA must reject scroll trapping. The status copy is in `aria-live="polite"`. On mobile, Review trade is full width; on larger screens, actions align right.

- [ ] **Step 3: Run the owning component test**

Expected: both incomplete and complete tray states pass without invoking the proposal callback. Browser QA must prove the tray is visible before the roster content is scrolled, not only after reaching its normal-flow position.

## Task 6: Build the Client-Only Review Step

**Files:**

- Create: `src/components/league/trades/TradeReviewStep.tsx`
- Modify: `src/components/league/trades/TradeComparisonTable.tsx`

- [ ] **Step 1: Write failing review assertions**

Add a test that selects one player from each team and clicks Review trade:

```ts
await user.click(screen.getByRole('button', { name: 'Review trade' }));

expect(onSubmit).not.toHaveBeenCalled();
expect(screen.getByRole('heading', { name: 'Review trade proposal' })).toHaveFocus();
expect(screen.getByRole('heading', { name: 'You send' })).toBeInTheDocument();
expect(screen.getByRole('heading', { name: 'You receive' })).toBeInTheDocument();
expect(screen.getByText(/expires 72 hours after sending/i)).toBeInTheDocument();
```

- [ ] **Step 2: Implement `TradeReviewStep`**

Use this interface:

```ts
interface TradeReviewStepProps {
  viewerTeam: TradeTeamDto;
  partnerTeam: TradeTeamDto;
  sendingPlayers: TradePlayerDto[];
  receivingPlayers: TradePlayerDto[];
  sendingPlayerIds: string[];
  receivingPlayerIds: string[];
  message: string;
  rules: TradeRulesDto;
  playerStats: LeaguePlayerStatDatasetDto;
  isSubmitting: boolean;
  error?: string | null;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onMessageChange: (message: string) => void;
  onBack: () => void;
  onSubmit: () => void;
  onCancelCounter?: () => void;
}
```

Package summaries use player name, club identity, and position. Position consequences are labelled `Package position change` and use `getPositionDeltas` to show signed, neutral package-balance changes only. Deadline uses the existing value when present; otherwise render `No league deadline`. Pre-send expiry must remain relative. When `onCancelCounter` is present, expose `Cancel counteroffer` in review as well as edit.

- [ ] **Step 3: Redesign comparison presentation without changing math**

Update `TradeComparisonTable` props:

```ts
interface TradeComparisonTableProps {
  sendingTeamName: string;
  receivingTeamName: string;
  sendingPlayerIds: string[];
  receivingPlayerIds: string[];
  playerStats: LeaguePlayerStatDatasetDto;
}
```

Use `summarizeTradeComparisons`. When both packages are complete, render `Category impact: N gained · N lost · N even`, with unavailable appended only when non-zero. When either package is empty, render `Select players from both teams to compare` instead of a misleading all-unavailable summary. Team names become the two value columns. Replace Difference and Result with one Impact cell containing signed value, icon, and outcome text.

Keep the caption and visible basis:

```text
Season {season} average per selected player, per game. Not category totals or projected lineup impact.
```

Render this live comparison below the roster workspace in edit mode so managers can inspect categories while selecting. Reuse the component in review mode, but render only the active step's instance so duplicate captions, IDs, or landmarks never exist.

- [ ] **Step 4: Run comparison and review tests**

Run component tests plus `tests/unit/tradeComparison.test.ts` with the unit config.

Expected: existing average/lower-is-better tests and new review/summary tests pass.

## Task 7: Integrate the Reducer, Workspace, Tray, and Review Step

**Files:**

- Modify: `src/components/league/trades/TradeComposer.tsx`
- Modify: `src/components/league/trades/LeagueTradeCentrePanel.tsx`
- Modify: `src/components/league/trades/LeagueTradeCentrePanel.test.tsx`

- [ ] **Step 1: Change the composer contract**

Add:

```ts
rules: TradeRulesDto;
```

to `TradeComposerProps`, and pass the already-narrowed `snapshot.rules` from `LeagueTradeCentrePanel` after its null guard.

- [ ] **Step 2: Replace local state with `useReducer`**

Keep `validationError` local. Initialize the reducer from the existing deep-link and counteroffer inputs. Preserve the existing preferred-partner behavior.

Effects must dispatch only when an external preferred partner changes; ordinary partner changes come directly through reducer actions.

- [ ] **Step 3: Implement edit-to-review focus management**

Create `reviewHeadingRef` and `reviewButtonRef`. On a successful transition to review, focus the heading. On Back to edit, focus Review trade after the edit view is committed.

Use a narrowly-scoped effect keyed by `state.step`; do not add document queries.

- [ ] **Step 4: Preserve final submission behavior**

The final handler sends exactly:

```ts
{
  recipientMemberId: state.partnerId,
  sendingPlayerIds: state.sendingPlayerIds,
  receivingPlayerIds: state.receivingPlayerIds,
  message: state.message.trim() || undefined,
}
```

Only `TradeReviewStep` calls this handler. A successful response dispatches `reset`. A false response keeps the review state unchanged.

- [ ] **Step 5: Update panel tests for two-step behavior**

Change the proposal test so clicking Review trade first proves:

```ts
expect(authenticatedFetch).not.toHaveBeenCalled();
```

Then click final Send proposal and retain the exact existing body/idempotency/refresh assertions.

Update the retry test so the same draft and proposal idempotency key survive a failed final submission.

- [ ] **Step 6: Verify counteroffers**

Ensure counteroffer initialization opens in edit mode, keeps the locked partner, and final review uses `Send counteroffer`. Pass the existing cancel callback into both edit and review, and add a review-state cancellation assertion.

- [ ] **Step 7: Run focused component verification**

Run:

```bash
npm exec -- vitest run \
  src/components/league/trades/tradeComposerState.test.ts \
  src/components/league/trades/TradeRosterTable.test.tsx \
  src/components/league/trades/TradeRosterWorkspace.test.tsx \
  src/components/league/trades/LeagueTradeCentrePanel.test.tsx
npm exec eslint -- src/components/league/trades
npm run typecheck
```

Expected: all focused tests pass, lint has zero errors, and TypeScript exits 0.

## Task 8: Apply the Approved Neutral Visual System

**Files:**

- Modify: `src/index.css`
- Modify: `src/components/league/trades/LeagueTradeCentrePanel.tsx`
- Modify: `src/components/league/trades/TradeRosterTable.tsx`
- Modify: `src/components/league/trades/TradeComparisonTable.tsx`
- Modify: `src/components/league/trades/TradeSelectionTray.tsx`
- Modify: `src/components/league/trades/TradeReviewStep.tsx`
- Modify: `src/components/league/trades/TradeOfferAssets.tsx`
- Modify: `src/components/league/trades/TradeOfferStatus.tsx`

- [ ] **Step 1: Replace biased direction tokens**

Remove:

```css
--trade-send;
--trade-send-soft;
--trade-receive;
--trade-receive-soft;
```

Replace the biased direction declarations with:

```css
--trade-selection: #2563eb;
--trade-selection-soft: #eff6ff;
--trade-negative-soft: #fef3f2;
--trade-warning-soft: #fff7ed;
```

Retain the existing `--trade-warning`; do not duplicate it. Remove `--trade-error-soft`. Keep `--trade-positive`, `--trade-negative`, and `--trade-negative-soft` exclusively in calculated category impact. Validation, API, and offer-status warnings use `--trade-warning`/`--trade-warning-soft` or neutral text and never reuse gain/loss colour tokens. Neutralize `TradeOfferAssets` so persisted send/receive packages no longer depend on the removed direction tokens.

- [ ] **Step 2: Apply the approved scale**

Verify in code:

- Trade Centre title is 28–32px.
- Team eyebrow and supporting metadata are 12–13px.
- Section headings are 16–18px.
- Player names and stat values are at least 14px.
- Roster rows are 52–56px.
- Sort, search, segmented, tray, Back, Review, and Send controls are at least 44px.

- [ ] **Step 3: Keep comparison hierarchy neutral**

Use a navy/neutral header, not pale blue. Green/red appear only in outcome labels. Even and unavailable use neutral styling. Signs, icons, and text remain visible regardless of colour perception.

- [ ] **Step 4: Run style and token checks**

Run Prettier and ESLint for every touched component, then `rg` the Trade Centre files to prove the removed send/receive tokens are no longer referenced.

## Task 9: Update Responsive and Interaction Smoke Coverage

**Files:**

- Modify: `tests/e2e/league-trade-centre.smoke.test.ts`

- [ ] **Step 1: Replace the old mobile stacking assertions**

At 390px assert:

```ts
await expect(page.getByRole('button', { name: /Send.*Robbo Rockers/i })).toHaveAttribute(
  'aria-pressed',
  'true'
);
await expect(page.getByRole('heading', { name: 'Robbo Rockers sends' })).toBeVisible();
await page.getByRole('button', { name: /Receive.*AFL Legends/i }).click();
await expect(page.getByRole('heading', { name: 'AFL Legends sends' })).toBeVisible();
```

- [ ] **Step 2: Cover the two-step submission boundary without mutating data**

Select one player from each team, click Review trade, assert the review heading and package summary, then click Back to edit. Do not click final Send proposal in the smoke test.

- [ ] **Step 3: Cover layout invariants**

For 1920, 1440, 1024, and 390px assert:

- document scroll width does not exceed client width;
- all major actions and mobile switch controls are at least 44px high;
- the persistent tray is visible before and after scrolling within the composer;
- the player table remains internally scrollable.

At 200% browser zoom, repeat the 1024px journey in the user-selected in-app browser and verify no page-level overflow or hidden Review trade action. Record the actual browser zoom control used. Keep this as supervised browser evidence; do not approximate zoom with device scale factor, CSS `zoom`, or a Playwright viewport resize.

- [ ] **Step 4: Run E2E only against a disposable database**

Stop any writer using the source temporary database. Verify `/tmp/statly-trade-centre-runtime-20260722.db` exists, create a unique destination with `mktemp`, copy that disposable database to the resolved destination, and print/verify the exact destination before starting the app. Never use `prisma/dev.db` as the source. Then run the smoke test against the verified destination:

```bash
test -s /tmp/statly-trade-centre-runtime-20260722.db
TRADE_E2E_DB=$(mktemp /tmp/statly-trade-centre-e2e.XXXXXX)
cp /tmp/statly-trade-centre-runtime-20260722.db "$TRADE_E2E_DB"
test -s "$TRADE_E2E_DB"
DATABASE_URL="file:$TRADE_E2E_DB" \
PLAYWRIGHT_WITH_SOCKET=false \
npm exec playwright test tests/e2e/league-trade-centre.smoke.test.ts
```

Expected: the smoke test passes without reading or writing `prisma/dev.db`. If the disposable source database is unavailable, recreate and migrate a new temporary database through the repository's documented local setup before browser verification; do not fall back to the protected database.

If Product Design browser policy requires the in-app browser instead of CLI, leave the Playwright test committed but perform the same journey in the in-app browser and report the automated smoke as not executed.

## Task 10: Final Review, Visual QA, and Reviewed Commit

**Files:** All files listed in this plan.

- [ ] **Step 1: Run the complete focused verification suite**

Run:

```bash
npm exec prettier -- --check \
  src/index.css \
  src/components/league/trades \
  tests/unit/tradeComparison.test.ts \
  tests/e2e/league-trade-centre.smoke.test.ts
npm exec eslint -- src/components/league/trades tests/e2e/league-trade-centre.smoke.test.ts
npm run typecheck
npm exec -- vitest run src/components/league/trades
npm exec -- vitest run --config vitest.config.unit.ts tests/unit/tradeComparison.test.ts --coverage.enabled=false
TRADE_RUNTIME_DB=/tmp/statly-trade-centre-runtime-20260722.db
test -s "$TRADE_RUNTIME_DB"
DATABASE_URL="file:$TRADE_RUNTIME_DB" npm run build
git diff --check
```

Expected: formatting, lint, typecheck, focused tests, unit tests, build, and diff check all exit 0. Report unrelated warnings exactly.

- [ ] **Step 2: Perform supervised responsive browser QA**

Capture edit-empty, edit-selected, review, Back-to-edit, and mobile-switch states at matching viewports. Inspect each accepted screenshot and compare the 1440px edit state against the pre-implementation committed-state baseline `/tmp/statly-trade-centre-design-audit-20260722/after-1440-viewport.jpg` in one combined image. The exact route is `/leagues/cmezlicop0002uxzjdtavv4mk?tab=trades` at a 1440px viewport.

Verify:

- 1920, 1440, 1024, and 390px;
- 200% zoom;
- keyboard-only selection and edit/review navigation;
- sticky tray overlap;
- visible focus and complete expanded category names for assistive technology;
- no page-level horizontal overflow.

- [ ] **Step 3: Run independent read-only reviews**

Assign sub-agents disjoint reviews for state/data semantics, accessibility/responsiveness, and design-system scope. The primary agent validates every finding before changing code.

- [ ] **Step 4: Stage only intended files**

Use explicit `git add -- <file list>`. Confirm `prisma/dev.db` remains unstaged.

- [ ] **Step 5: Run Chairman Decision 2**

Run:

```bash
npm run codex:council:logical -- --staged --prompt \
  "Chairman Decision 2: decide whether this completed Trade Centre review flow should be committed."
```

Expected: `CHAIRMAN DECISION 2: COMMIT` with no blocking signals.

- [ ] **Step 6: Commit through the reviewed path**

Run:

```bash
npm run codex:commit:reviewed -- "feat(leagues): add trade proposal review flow"
```

Expected: one reviewed implementation commit containing only the planned source and test files.

## Done Criteria

- Both composition panels use symmetric team-relative labels and neutral/blue selection semantics.
- Player rows are sports-specific, full-row pointer-selectable, keyboard-selectable through native checkboxes, and at least 52px tall.
- Category abbreviations have expanded accessible meaning and explicit sort state.
- Comparison shows an average-based gained/lost/even summary and correctly retains lower-is-better logic.
- The sticky tray remains visible through package inspection and never claims server validity.
- Review trade makes no network request; only final Send proposal uses the existing API callback.
- Back to edit preserves selections and message.
- Mobile uses a Send/Receive switch with retained selections.
- No injury, availability, lineup-legality, or projected-impact claims are introduced. Injury/availability remains a reported residual gap because the protected Trade Centre DTO has no authoritative field.
- Required responsive, keyboard, zoom, test, type, lint, build, and council checks have evidence.
- `prisma/dev.db` remains untouched by the commit.
