# Draft Room Workflow Visual Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the main Statly draft room so live sequencing, timer UX, table alignment, side rails, persistence, and verification behave as one polished product flow.

**Architecture:** Keep the existing `/drafts/[id]` draft room as the single product surface. Move sequencing and timer presentation math into a shared pure read model, let `DraftContext` remain the client state owner, and make `LivePickHeader`, `DraftPickTrain`, `PlayerGrid`, `DraftLeftRail`, and `PickFeed` consume normalized state instead of recalculating workflow rules independently. Preserve the server application services as the source of truth for picks, deadlines, pause/resume, and completion.

**Tech Stack:** Next.js App Router, React, TypeScript, Prisma, Socket.IO draft events, shadcn-style tokenized Tailwind, Vitest, Testing Library, Playwright-compatible browser verification through the local dev stack.

---

## Council Decision Frame

The LLM council Decision 1 for this product area is `PROCEED`.

Committee findings to preserve during implementation:

- The Contrarian: Do not ship another cosmetic layer over unstable sequencing; timer, pick train, context, and route projection must agree after refresh, reconnect, pause, resume, and auto-pick.
- First Principles: The product is a live draft room, not a static table. The correct ownership boundary is an authoritative draft-room read model backed by persisted draft state.
- The Expansionist: Use this pass to raise the room above a functional prototype: a full-width header, clear pick train, table-grade stat display, fixed rails, and testable seeded draft flow.
- The Outsider: A user must understand who is picking, how long remains, what happens next, where their queue/roster lives, and why an action button is disabled without knowing the codebase.
- The Executor: Implement in small verified slices: pure sequencing tests first, then context, then header/train, then table/rails, then seeded browser verification.

Chairman decision: proceed only through the existing draft room and shared infrastructure. Reject parallel draft-room versions, one-off CSS patches, and unverified UI-only fixes.

## Current Fault Model

- `LivePickHeader` calculates upcoming user turns locally while `draftUiMappers.ts` separately calculates the pick train. That creates two places for snake sequencing bugs.
- `UnifiedDraftRoom` only renders `LivePickHeader` for `LIVE`, so scheduled, paused, and completed flows use a different visual system from the live room.
- `PlayerGrid` is a native table, but its action column is wide and wrapping, which allows controls to visually drift from the stat columns on narrow desktop widths.
- `UnifiedDraftRoom` contains a watchlist toggle path that must be checked during implementation because a double-toggle regression would make watchlist state appear to do nothing.
- There are existing layout architecture tests with conflicting expectations. The implementation must update those tests to the final agreed layout contract, not keep both old and new contracts alive.
- Full-draft testing is possible through `POST /api/create-test-draft`; the standard mode creates one development user plus eleven CPU teams.

## File Structure

- Create `src/lib/draftRoomSequencing.ts`
  - Pure TypeScript read model for current turn, next user pick, pick train window, timer display state, phase label, and disabled action reasons.
  - No React imports, no server-only imports, no browser globals.
- Modify `src/lib/mappers/draftUiMappers.ts`
  - Keep current exported mapper names.
  - Delegate pick train calculation to `src/lib/draftRoomSequencing.ts`.
- Modify `src/contexts/DraftContext.tsx`
  - Keep `DraftProvider` as the owner of browser state.
  - Reuse shared sequencing helpers for current slot checks.
  - Ensure snapshots, command responses, and pick deltas preserve `currentPick`, `pickStartedAt`, `pickDeadlineAt`, picks, and available players coherently.
- Modify `src/components/LivePickHeader.tsx`
  - Convert from workflow calculator to presenter.
  - Render scheduled, lobby/countdown, live, paused, completed, and cancelled as one visual header system.
  - Use the shared sequencing read model for timer and next-turn messaging.
- Modify `src/components/draft/DraftPickTrain.tsx`
  - Keep it focused on visual train rendering.
  - Make completed, current, upcoming, and user-next states visually consistent at desktop and mobile widths.
- Modify `src/components/draft/UnifiedDraftRoom.tsx`
  - Always render the unified header when draft data is present.
  - Keep the three-column board, but give the player table the flexible center width and keep roster/feed rails fixed.
  - Fix watchlist toggle behavior if the double-call regression is still present.
  - Scope history navigation to the selected league when that league id exists.
- Modify `src/components/draft/PlayerGrid.tsx`
  - Preserve native table semantics.
  - Replace wrapping action controls with a fixed, non-overlapping action cell contract.
  - Align stat headers and stat values through `colgroup`, tabular numbers, and consistent cell padding.
- Modify `src/components/draft/DraftLeftRail.tsx`
  - Keep tab persistence.
  - Ensure roster, queue, and watchlist share rail sizing and scroll behavior with the main room.
- Modify `src/components/PickFeed.tsx`
  - Keep feed persistence and filtering.
  - Align right rail height, padding, and empty/loading states with the main room.
- Modify tests:
  - `tests/unit/draftRoomSequencing.test.ts`
  - `tests/unit/DraftPickTrain.test.tsx`
  - `tests/unit/UnifiedDraftRoom.liveShell.test.tsx`
  - `tests/unit/PlayerGrid.a11y.test.tsx`
  - `tests/unit/DraftRoomLayout.test.ts`
  - `tests/unit/unifiedDraftRoomDesignArchitecture.test.ts`
  - `tests/unit/DraftContext.initialFetch.test.tsx`
- Create `Scripts/verify-draft-room-workflow.mjs`
  - Local browser verification script for seeded standard and quick-completion drafts.
  - Uses the running web app and exits non-zero on blank room, missing table headers, broken action alignment, or missing timer states.

## Task 1: Shared Sequencing Read Model

**Files:**
- Create: `src/lib/draftRoomSequencing.ts`
- Create: `tests/unit/draftRoomSequencing.test.ts`
- Modify: `src/lib/mappers/draftUiMappers.ts`

- [ ] **Step 1: Write failing tests for snake order, next user pick, and timer display**

Add `tests/unit/draftRoomSequencing.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import {
  buildDraftRoomSequence,
  getDraftRoomTimerState,
} from '@/lib/draftRoomSequencing';

const participants = Array.from({ length: 6 }, (_, index) => ({
  id: `member-${index + 1}`,
  userId: `user-${index + 1}`,
  displayName: `Team ${index + 1}`,
  teamName: `Team ${index + 1}`,
  draftOrder: index + 1,
}));

describe('buildDraftRoomSequence', () => {
  it('returns current, completed, upcoming, and next user pick slots in snake order', () => {
    const sequence = buildDraftRoomSequence({
      currentPick: 7,
      totalPicks: 18,
      participants,
      picks: [
        {
          id: 'pick-6',
          overall: 6,
          round: 1,
          slot: 6,
          player: { id: 'player-6', name: 'Completed Player', position: 'MID', club: 'Collingwood' },
          member: { id: 'member-6', displayName: 'Team 6', teamName: 'Team 6' },
          auto: false,
          madeAt: new Date('2026-06-13T00:00:00.000Z'),
        },
      ],
      yourSlot: 1,
      windowBefore: 1,
      windowAfter: 4,
    });

    expect(sequence.current).toMatchObject({
      overall: 7,
      round: 2,
      slot: 6,
      displayName: 'Team 6',
      status: 'current',
    });
    expect(sequence.slots.map((slot) => slot.overall)).toEqual([6, 7, 8, 9, 10, 11, 12]);
    expect(sequence.slots.map((slot) => slot.slot)).toEqual([6, 6, 5, 4, 3, 2, 1]);
    expect(sequence.nextUserPick).toMatchObject({
      overall: 12,
      picksUntil: 5,
      estimatedSecondsUntil: 600,
    });
  });

  it('handles completed drafts without inventing a live current slot', () => {
    const sequence = buildDraftRoomSequence({
      currentPick: 19,
      totalPicks: 18,
      participants,
      picks: [],
      yourSlot: 1,
      status: 'COMPLETED',
    });

    expect(sequence.current).toBeNull();
    expect(sequence.nextUserPick).toBeNull();
    expect(sequence.phase).toBe('COMPLETED');
  });
});

describe('getDraftRoomTimerState', () => {
  it('derives remaining seconds and urgency from an authoritative deadline', () => {
    vi.setSystemTime(new Date('2026-06-13T10:00:00.000Z'));

    expect(
      getDraftRoomTimerState({
        status: 'LIVE',
        timePerPick: 120,
        pickDeadlineAt: '2026-06-13T10:00:45.000Z',
      })
    ).toMatchObject({
      remainingSeconds: 45,
      percentRemaining: 38,
      tone: 'warning',
      label: 'Short clock',
      isRunning: true,
    });

    vi.useRealTimers();
  });

  it('freezes the clock for paused and completed states', () => {
    expect(
      getDraftRoomTimerState({
        status: 'PAUSED',
        timePerPick: 120,
        pickDeadlineAt: '2026-06-13T10:00:45.000Z',
      })
    ).toMatchObject({
      remainingSeconds: 120,
      percentRemaining: 100,
      tone: 'neutral',
      label: 'Paused',
      isRunning: false,
    });
  });
});
```

- [ ] **Step 2: Run the focused test and confirm it fails because the module does not exist**

Run:

```bash
npm run test:unit -- tests/unit/draftRoomSequencing.test.ts
```

Expected:

```text
FAIL tests/unit/draftRoomSequencing.test.ts
Error: Failed to resolve import "@/lib/draftRoomSequencing"
```

- [ ] **Step 3: Create the shared read model**

Add `src/lib/draftRoomSequencing.ts`:

```ts
export type DraftRoomStatus =
  | 'SCHEDULED'
  | 'LOBBY'
  | 'COUNTDOWN'
  | 'LIVE'
  | 'PAUSED'
  | 'COMPLETED'
  | 'CANCELLED'
  | string;

export type DraftRoomParticipant = {
  id: string;
  userId?: string;
  displayName?: string;
  teamName?: string;
  draftOrder?: number;
  slot?: number;
  member?: {
    id: string;
    userId?: string;
    displayName?: string;
    teamName?: string;
  };
};

export type DraftRoomPick = {
  id: string;
  overall: number;
  round: number;
  slot: number;
  player?: {
    id: string;
    name: string;
    position: string;
    club: string;
  };
  member?: {
    id: string;
    displayName: string;
    teamName?: string;
  };
  auto?: boolean;
  madeAt?: Date | string;
};

export type DraftRoomSequenceSlot = {
  overall: number;
  round: number;
  slot: number;
  status: 'completed' | 'current' | 'upcoming';
  isUserPick: boolean;
  displayName: string;
  teamName?: string;
  picksUntil: number;
  estimatedSecondsUntil: number;
  player?: NonNullable<DraftRoomPick['player']>;
};

export type DraftRoomSequence = {
  phase: DraftRoomStatus;
  current: DraftRoomSequenceSlot | null;
  nextUserPick: DraftRoomSequenceSlot | null;
  slots: DraftRoomSequenceSlot[];
};

export type DraftRoomTimerState = {
  remainingSeconds: number;
  percentRemaining: number;
  tone: 'neutral' | 'healthy' | 'warning' | 'urgent' | 'complete';
  label: string;
  isRunning: boolean;
};

function toSlot(participant: DraftRoomParticipant): number {
  return Number(participant.slot ?? participant.draftOrder ?? 0);
}

export function getSlotForOverallPick(overall: number, teamCount: number): number {
  if (overall <= 0 || teamCount <= 0) return 0;
  const round = Math.ceil(overall / teamCount);
  const pickIndex = (overall - 1) % teamCount;
  return round % 2 === 1 ? pickIndex + 1 : teamCount - pickIndex;
}

export function buildDraftRoomSequence(input: {
  currentPick: number;
  totalPicks: number;
  participants: DraftRoomParticipant[];
  picks: DraftRoomPick[];
  yourSlot?: number;
  status?: DraftRoomStatus;
  timePerPick?: number;
  windowBefore?: number;
  windowAfter?: number;
}): DraftRoomSequence {
  const teamCount = input.participants.length;
  const totalPicks = Math.max(0, Math.floor(input.totalPicks));
  const currentPick = Math.max(1, Math.floor(input.currentPick || 1));
  const timePerPick = Math.max(1, Math.floor(input.timePerPick ?? 120));
  const phase = input.status ?? 'LIVE';
  const participantsBySlot = new Map(input.participants.map((participant) => [toSlot(participant), participant]));
  const picksByOverall = new Map(input.picks.map((pick) => [Number(pick.overall), pick]));
  const isComplete = phase === 'COMPLETED' || currentPick > totalPicks;
  const safeCurrent = isComplete ? totalPicks : Math.min(currentPick, Math.max(totalPicks, 1));
  const pickWindow = new Set<number>();
  const start = Math.max(1, safeCurrent - (input.windowBefore ?? 1));
  const end = Math.min(totalPicks, safeCurrent + (input.windowAfter ?? 4));

  for (let overall = start; overall <= end; overall += 1) {
    pickWindow.add(overall);
  }

  if (input.yourSlot && teamCount > 0 && !isComplete) {
    for (let overall = safeCurrent; overall <= totalPicks; overall += 1) {
      if (getSlotForOverallPick(overall, teamCount) === input.yourSlot) {
        pickWindow.add(overall);
        break;
      }
    }
  }

  const slots = [...pickWindow].sort((a, b) => a - b).map((overall) => {
    const slot = getSlotForOverallPick(overall, teamCount);
    const participant = participantsBySlot.get(slot);
    const pick = picksByOverall.get(overall);
    const status: DraftRoomSequenceSlot['status'] =
      overall === safeCurrent && !isComplete ? 'current' : overall < safeCurrent || Boolean(pick) ? 'completed' : 'upcoming';
    const member = participant?.member;

    return {
      overall,
      round: teamCount > 0 ? Math.ceil(overall / teamCount) : 1,
      slot,
      status,
      isUserPick: slot === input.yourSlot,
      displayName: member?.displayName ?? participant?.displayName ?? `Team ${slot}`,
      teamName: member?.teamName ?? participant?.teamName,
      picksUntil: Math.max(0, overall - safeCurrent),
      estimatedSecondsUntil: Math.max(0, overall - safeCurrent) * timePerPick,
      player: pick?.player,
    };
  });

  return {
    phase,
    current: isComplete ? null : slots.find((slot) => slot.status === 'current') ?? null,
    nextUserPick: input.yourSlot ? slots.find((slot) => slot.isUserPick && slot.overall >= safeCurrent) ?? null : null,
    slots,
  };
}

export function getDraftRoomTimerState(input: {
  status: DraftRoomStatus;
  timePerPick: number;
  pickDeadlineAt?: string | Date | null;
  nowMs?: number;
}): DraftRoomTimerState {
  const timePerPick = Math.max(1, Math.floor(input.timePerPick));
  const status = input.status;

  if (status === 'COMPLETED') {
    return { remainingSeconds: 0, percentRemaining: 0, tone: 'complete', label: 'Complete', isRunning: false };
  }

  if (status === 'PAUSED') {
    return { remainingSeconds: timePerPick, percentRemaining: 100, tone: 'neutral', label: 'Paused', isRunning: false };
  }

  if (status !== 'LIVE') {
    return { remainingSeconds: timePerPick, percentRemaining: 100, tone: 'neutral', label: 'Waiting', isRunning: false };
  }

  const deadlineMs = input.pickDeadlineAt ? new Date(input.pickDeadlineAt).getTime() : Number.NaN;
  const remainingSeconds = Number.isFinite(deadlineMs)
    ? Math.max(0, Math.ceil((deadlineMs - (input.nowMs ?? Date.now())) / 1000))
    : timePerPick;
  const percentRemaining = Math.max(0, Math.min(100, Math.round((remainingSeconds / timePerPick) * 100)));

  if (remainingSeconds <= 15) {
    return { remainingSeconds, percentRemaining, tone: 'urgent', label: 'Urgent', isRunning: true };
  }

  if (remainingSeconds <= 60) {
    return { remainingSeconds, percentRemaining, tone: 'warning', label: 'Short clock', isRunning: true };
  }

  return { remainingSeconds, percentRemaining, tone: 'healthy', label: 'On pace', isRunning: true };
}
```

- [ ] **Step 4: Run the focused test and confirm it passes**

Run:

```bash
npm run test:unit -- tests/unit/draftRoomSequencing.test.ts
```

Expected:

```text
PASS tests/unit/draftRoomSequencing.test.ts
```

- [ ] **Step 5: Route existing pick train mapping through the shared read model**

In `src/lib/mappers/draftUiMappers.ts`, replace local slot/window helpers with imports from `src/lib/draftRoomSequencing.ts`, and map `DraftRoomSequenceSlot` back to the existing `DraftPickTrainSlot` type:

```ts
import { buildDraftRoomSequence } from '@/lib/draftRoomSequencing';
```

```ts
function buildDraftPickTrainState(params: {
  currentPick: number;
  totalPicks: number;
  round: number;
  direction: string;
  participants: DraftPickTrainParticipant[];
  picks: DraftPickTrainPick[];
  yourSlot?: number;
}): DraftPickTrainState {
  const sequence = buildDraftRoomSequence({
    currentPick: params.currentPick,
    totalPicks: params.totalPicks,
    participants: params.participants,
    picks: params.picks,
    yourSlot: params.yourSlot,
    status: 'LIVE',
  });

  return {
    currentPick: params.currentPick,
    totalPicks: params.totalPicks,
    round: params.round,
    direction: params.direction,
    slots: sequence.slots.map((slot) => ({
      overall: slot.overall,
      round: slot.round,
      slot: slot.slot,
      status: slot.status,
      isUserPick: slot.isUserPick,
      displayName: slot.displayName,
      teamName: slot.teamName,
      player: slot.player,
    })),
  };
}
```

- [ ] **Step 6: Run existing train tests**

Run:

```bash
npm run test:unit -- tests/unit/DraftPickTrain.test.tsx tests/unit/draftRoomSequencing.test.ts
```

Expected:

```text
PASS tests/unit/DraftPickTrain.test.tsx
PASS tests/unit/draftRoomSequencing.test.ts
```

## Task 2: Draft Context Sequencing and Timer Recovery

**Files:**
- Modify: `src/contexts/DraftContext.tsx`
- Test: `tests/unit/DraftContext.initialFetch.test.tsx`

- [ ] **Step 1: Add regression coverage for refresh after picks have occurred**

Extend `tests/unit/DraftContext.initialFetch.test.tsx` with a test that loads a draft snapshot at pick 4 with persisted picks and asserts the client state keeps that pick number and deadline:

```tsx
it('hydrates an in-progress draft with persisted picks and authoritative deadline after refresh', async () => {
  const pickDeadlineAt = '2026-06-13T10:05:00.000Z';

  mockFetchApi.mockResolvedValueOnce({
    success: true,
    data: {
      draft: {
        id: 'draft-1',
        status: 'LIVE',
        currentPick: 4,
        totalPicks: 24,
        round: 1,
        direction: 'FORWARD',
        pickDeadlineAt,
        settings: { timePerPick: 120, pickSeconds: 120 },
      },
      participants: [
        { id: 'member-1', userId: 'statly-dev-tester', displayName: 'Tester', draftOrder: 1, queue: [] },
        { id: 'member-2', userId: 'bot-1', displayName: 'CPU Team 1', draftOrder: 2, queue: [] },
      ],
      picks: [
        {
          id: 'pick-1',
          overall: 1,
          round: 1,
          slot: 1,
          auto: false,
          madeAt: '2026-06-13T10:00:00.000Z',
          player: { id: 'player-1', name: 'Player One', position: 'MID', club: 'Sydney' },
          member: { id: 'member-1', displayName: 'Tester', teamName: 'Your Team' },
        },
      ],
      availablePlayers: [],
      watchlistItems: [],
      selectedCategories: ['goals', 'tackles'],
    },
  });

  const seenStates: DraftStateForTest[] = [];

  render(
    <DraftProvider draftId="draft-1" userId="statly-dev-tester">
      <DraftStateProbe onState={(state) => seenStates.push(state)} />
    </DraftProvider>
  );

  await waitFor(() => {
    expect(seenStates.at(-1)?.draft?.currentPick).toBe(4);
  });
  expect(seenStates.at(-1)?.draft?.pickDeadlineAt?.toISOString()).toBe(pickDeadlineAt);
  expect(seenStates.at(-1)?.picks).toHaveLength(1);
});
```

- [ ] **Step 2: Run the focused context test**

Run:

```bash
npm run test:unit -- tests/unit/DraftContext.initialFetch.test.tsx
```

Expected before implementation:

```text
FAIL tests/unit/DraftContext.initialFetch.test.tsx
```

The failure must identify a real mismatch in snapshot normalization or test harness setup. If it passes immediately, keep the test and continue because it protects the refresh path.

- [ ] **Step 3: Replace local current-slot math with the shared helper**

In `src/contexts/DraftContext.tsx`, import `getSlotForOverallPick`:

```ts
import { getSlotForOverallPick } from '@/lib/draftRoomSequencing';
```

Replace the local `computeCurrentSlotFromSnake` body with:

```ts
function computeCurrentSlotFromSnake(currentPick: number, teamCount: number): number | undefined {
  const slot = getSlotForOverallPick(currentPick, teamCount);
  return slot > 0 ? slot : undefined;
}
```

- [ ] **Step 4: Keep command responses and pick deltas authoritative**

In `applyDelta`, preserve these fields when present on pick-created command payloads:

```ts
const draft =
  next.draft && (nextCurrentPick !== undefined || payload.pickDeadlineAt !== undefined)
    ? {
        ...next.draft,
        ...(nextCurrentPick !== undefined ? { currentPick: nextCurrentPick } : {}),
        ...(typeof payload.round === 'number' ? { round: payload.round } : {}),
        ...(typeof payload.direction === 'string' ? { direction: payload.direction } : {}),
        ...(payload.pickStartedAt !== undefined
          ? { pickStartedAt: payload.pickStartedAt ? toOptionalDate(payload.pickStartedAt) : null }
          : {}),
        ...(payload.pickDeadlineAt !== undefined
          ? {
              pickDeadlineAt:
                payload.pickDeadlineAt === null
                  ? null
                  : (toOptionalDate(payload.pickDeadlineAt) ?? next.draft.pickDeadlineAt ?? null),
            }
          : {}),
      }
    : next.draft;
```

- [ ] **Step 5: Run context and command route tests**

Run:

```bash
npm run test:unit -- tests/unit/DraftContext.initialFetch.test.tsx tests/unit/draftCommandRoutes.test.ts
```

Expected:

```text
PASS tests/unit/DraftContext.initialFetch.test.tsx
PASS tests/unit/draftCommandRoutes.test.ts
```

## Task 3: Unified Draft Header and Timer UX

**Files:**
- Modify: `src/components/LivePickHeader.tsx`
- Modify: `src/components/draft/UnifiedDraftRoom.tsx`
- Test: `tests/unit/UnifiedDraftRoom.liveShell.test.tsx`

- [ ] **Step 1: Add a test that the header renders for paused and completed rooms**

Extend `tests/unit/UnifiedDraftRoom.liveShell.test.tsx` so the mocked context can change status, then assert `LivePickHeader` receives non-live states:

```tsx
it.each(['SCHEDULED', 'PAUSED', 'COMPLETED'] as const)(
  'renders the unified draft status header for %s drafts',
  (status) => {
    draftContext.status = status;

    render(<UnifiedDraftRoom draftId="draft-1" userId="statly-dev-tester" />);

    expect(screen.getByRole('banner', { name: /live draft status/i })).toBeInTheDocument();
  }
);
```

Update the test fixture shape:

```ts
const draftContext = vi.hoisted<{
  status: 'SCHEDULED' | 'LIVE' | 'PAUSED' | 'COMPLETED';
  availablePlayers: DraftRoomPlayerFixture[];
}>(() => ({
  status: 'LIVE',
  availablePlayers: [
    {
      id: 'player-1',
      name: 'Caleb Daniel',
      position: 'DEF',
      club: 'North Melbourne',
      adp: 1,
      statlyZScore: 1.2,
    },
  ],
}));
```

In the mocked draft object, use:

```ts
status: draftContext.status,
```

- [ ] **Step 2: Run the focused shell test and confirm it fails**

Run:

```bash
npm run test:unit -- tests/unit/UnifiedDraftRoom.liveShell.test.tsx
```

Expected:

```text
FAIL tests/unit/UnifiedDraftRoom.liveShell.test.tsx
```

The failure should show the header is absent for at least one non-live state.

- [ ] **Step 3: Always render `LivePickHeader` for loaded drafts**

In `src/components/draft/UnifiedDraftRoom.tsx`, replace the separate non-live banner/header branch with:

```tsx
{activeDraft.status !== 'LIVE' && (
  <DraftStatusBanner
    status={activeDraft.status}
    onStartDraft={draft.startDraft}
    isLoading={draft.isSaving}
  />
)}

<LivePickHeader
  draftData={toLivePickHeaderData(activeDraft, participants, picks)}
  timePerPick={activeDraft.settings?.timePerPick ?? activeDraft.settings?.pickSeconds ?? 120}
  isYourTurn={Boolean(draft.liveState?.isYourTurn)}
  yourSlot={yourSlot}
/>
```

- [ ] **Step 4: Convert `LivePickHeader` to shared read-model calculations**

In `src/components/LivePickHeader.tsx`, import:

```ts
import {
  buildDraftRoomSequence,
  getDraftRoomTimerState,
} from '@/lib/draftRoomSequencing';
```

Replace local upcoming-turn calculation and timer tone calculation with:

```ts
const sequence = useMemo(
  () =>
    buildDraftRoomSequence({
      currentPick: draftData.currentPick,
      totalPicks: draftData.totalPicks,
      participants: draftData.participants,
      picks: draftData.picks,
      yourSlot,
      status: normalizedStatus,
      timePerPick,
    }),
  [draftData, normalizedStatus, timePerPick, yourSlot]
);

const timerState = useMemo(
  () =>
    getDraftRoomTimerState({
      status: normalizedStatus,
      timePerPick,
      pickDeadlineAt: draftData.pickDeadlineAt,
    }),
  [draftData.pickDeadlineAt, normalizedStatus, timePerPick]
);

const nextUserPick = sequence.nextUserPick;
const picksUntilYourTurn = nextUserPick?.picksUntil ?? 0;
const estimatedTimeUntilYourTurn = nextUserPick?.estimatedSecondsUntil ?? 0;
```

Keep the interval effect, but it should recalculate through `getDraftRoomTimerState` on each tick:

```ts
const getRemainingSeconds = useMemo(
  () => () =>
    getDraftRoomTimerState({
      status: normalizedStatus,
      timePerPick,
      pickDeadlineAt: draftData.pickDeadlineAt,
    }).remainingSeconds,
  [draftData.pickDeadlineAt, normalizedStatus, timePerPick]
);
```

- [ ] **Step 5: Replace disconnected non-live cards with the same header shell**

Keep one `<section role="banner" aria-label="Live draft status">`. Within it, render:

```tsx
const statusCopy = {
  SCHEDULED: {
    title: 'Draft scheduled',
    detail: 'The room is ready. Participants can prepare queues before the league owner starts the draft.',
  },
  LOBBY: {
    title: 'Draft lobby',
    detail: 'The lobby is open for final queue and roster checks.',
  },
  COUNTDOWN: {
    title: 'Draft countdown',
    detail: 'The draft is waiting for its scheduled launch.',
  },
  LIVE: {
    title: sequence.current ? `Pick ${sequence.current.overall}` : `Pick ${draftData.currentPick}`,
    detail: sequence.current
      ? `${sequence.current.displayName} is on the clock.`
      : 'The draft clock is live.',
  },
  PAUSED: {
    title: 'Draft paused',
    detail: 'The clock is stopped until the league owner resumes the room.',
  },
  COMPLETED: {
    title: 'Draft complete',
    detail: 'All picks are finalized and the draft history is available for review.',
  },
  CANCELLED: {
    title: 'Draft cancelled',
    detail: 'This draft is no longer accepting picks.',
  },
}[normalizedStatus] ?? {
  title: 'Draft room',
  detail: 'The room is loading the latest draft state.',
};
```

The live timer card remains visible for all states, but its label and bar come from `timerState`. The pick train remains visible whenever participants exist.

- [ ] **Step 6: Run header and train tests**

Run:

```bash
npm run test:unit -- tests/unit/UnifiedDraftRoom.liveShell.test.tsx tests/unit/DraftPickTrain.test.tsx tests/unit/draftRoomSequencing.test.ts
```

Expected:

```text
PASS tests/unit/UnifiedDraftRoom.liveShell.test.tsx
PASS tests/unit/DraftPickTrain.test.tsx
PASS tests/unit/draftRoomSequencing.test.ts
```

## Task 4: Main Room Layout Contract

**Files:**
- Modify: `src/components/draft/UnifiedDraftRoom.tsx`
- Modify: `tests/unit/DraftRoomLayout.test.ts`
- Modify: `tests/unit/unifiedDraftRoomDesignArchitecture.test.ts`

- [ ] **Step 1: Rewrite layout tests to one final contract**

Update `tests/unit/DraftRoomLayout.test.ts` so it expects the final grid contract:

```ts
expect(unifiedDraftRoom).toContain(
  'xl:grid-cols-[minmax(16rem,20rem)_minmax(54rem,1fr)_minmax(20rem,22rem)]'
);
expect(unifiedDraftRoom).toContain('2xl:grid-cols-[20rem_minmax(64rem,1fr)_22rem]');
expect(unifiedDraftRoom).toContain('w-full px-3 pb-6 sm:px-5 lg:px-8');
expect(unifiedDraftRoom).toContain('className="min-w-0 overflow-x-auto"');
expect(unifiedDraftRoom).not.toContain('lg:grid-cols-[17rem_minmax(0,1fr)_20rem]');
expect(unifiedDraftRoom).not.toContain('max-w-[1780px]');
```

Update `tests/unit/unifiedDraftRoomDesignArchitecture.test.ts` to match the same strings:

```ts
expect(roomSource).toContain(
  'xl:grid-cols-[minmax(16rem,20rem)_minmax(54rem,1fr)_minmax(20rem,22rem)]'
);
expect(roomSource).toContain('2xl:grid-cols-[20rem_minmax(64rem,1fr)_22rem]');
expect(roomSource).toContain('hidden min-h-0 lg:block');
```

- [ ] **Step 2: Run layout tests and confirm they fail**

Run:

```bash
npm run test:unit -- tests/unit/DraftRoomLayout.test.ts tests/unit/unifiedDraftRoomDesignArchitecture.test.ts
```

Expected:

```text
FAIL tests/unit/DraftRoomLayout.test.ts
FAIL tests/unit/unifiedDraftRoomDesignArchitecture.test.ts
```

- [ ] **Step 3: Implement the final board grid**

In `src/components/draft/UnifiedDraftRoom.tsx`, change the draft board section to:

```tsx
<section
  aria-label="Draft board"
  className="mt-6 grid gap-4 lg:grid-cols-[minmax(16rem,18rem)_minmax(0,1fr)] xl:grid-cols-[minmax(16rem,20rem)_minmax(54rem,1fr)_minmax(20rem,22rem)] 2xl:grid-cols-[20rem_minmax(64rem,1fr)_22rem]"
>
```

Change the player table wrapper to:

```tsx
<div className="min-w-0 overflow-x-auto">
```

Keep the rails fixed by preserving:

```tsx
className="min-h-[28rem] lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)]"
```

and:

```tsx
<aside className="hidden min-h-0 lg:block" aria-label="Desktop pick feed">
```

- [ ] **Step 4: Fix watchlist toggle and selected league history link**

In `handleToggleWatchlist`, keep exactly one mutation call:

```ts
const handleToggleWatchlist = useCallback(
  async (player: DraftPlayer) => {
    try {
      await draft.toggleWatchlist(player.id);
    } catch (error) {
      console.error('Failed to toggle watchlist:', error);
    }
  },
  [draft]
);
```

Derive a selected league history URL near `displayDraftSubtitle`:

```ts
const historyHref = activeDraft.leagueId
  ? `/drafts/history?leagueId=${encodeURIComponent(activeDraft.leagueId)}`
  : '/drafts/history';
```

Use it in the link:

```tsx
<Link
  href={historyHref}
  className="inline-flex items-center rounded-full border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
>
  History
</Link>
```

- [ ] **Step 5: Run layout and shell tests**

Run:

```bash
npm run test:unit -- tests/unit/DraftRoomLayout.test.ts tests/unit/unifiedDraftRoomDesignArchitecture.test.ts tests/unit/UnifiedDraftRoom.liveShell.test.tsx
```

Expected:

```text
PASS tests/unit/DraftRoomLayout.test.ts
PASS tests/unit/unifiedDraftRoomDesignArchitecture.test.ts
PASS tests/unit/UnifiedDraftRoom.liveShell.test.tsx
```

## Task 5: Player Table Alignment and Action Geometry

**Files:**
- Modify: `src/components/draft/PlayerGrid.tsx`
- Modify: `tests/unit/PlayerGrid.a11y.test.tsx`

- [ ] **Step 1: Update the table test to enforce non-overlapping action geometry**

In `tests/unit/PlayerGrid.a11y.test.tsx`, update the layout guard expectations:

```ts
expect(source).toContain('const PLAYER_COLUMN_WIDTH = 340');
expect(source).toContain('const PROFILE_COLUMN_WIDTH = 180');
expect(source).toContain('const STAT_COLUMN_WIDTH = 88');
expect(source).toContain('const ACTIONS_COLUMN_WIDTH = 236');
expect(source).toContain('grid grid-cols-3 items-center gap-2');
expect(source).toContain('h-10 w-full justify-center');
expect(source).toContain('inline-flex min-w-12 justify-center tabular-nums');
expect(source).not.toContain('flex flex-wrap items-center justify-center gap-2');
```

- [ ] **Step 2: Run the focused player table test and confirm it fails**

Run:

```bash
npm run test:unit -- tests/unit/PlayerGrid.a11y.test.tsx
```

Expected:

```text
FAIL tests/unit/PlayerGrid.a11y.test.tsx
```

- [ ] **Step 3: Set the final column width contract**

In `src/components/draft/PlayerGrid.tsx`, change constants to:

```ts
const PLAYER_COLUMN_WIDTH = 340;
const PROFILE_COLUMN_WIDTH = 180;
const STAT_COLUMN_WIDTH = 88;
const ACTIONS_COLUMN_WIDTH = 236;
```

Keep:

```ts
const statColumnCount = Math.max(visibleCategories.length, 1);
const tableMinWidth =
  PLAYER_COLUMN_WIDTH +
  PROFILE_COLUMN_WIDTH +
  statColumnCount * STAT_COLUMN_WIDTH +
  ACTIONS_COLUMN_WIDTH;
```

- [ ] **Step 4: Align stat headers and values**

Update stat header cells:

```tsx
className="border-l border-border/70 px-3 py-2 text-center text-[11px] font-semibold uppercase text-muted-foreground first:border-l"
```

Update stat value cells:

```tsx
className="border-l border-border/60 px-3 py-4 text-center align-middle text-sm font-semibold text-foreground"
```

Update the stat value span:

```tsx
<span className="inline-flex min-w-12 justify-center tabular-nums">
  {displayValue}
</span>
```

- [ ] **Step 5: Replace wrapping actions with a fixed three-column action grid**

Update the action cell:

```tsx
<td className="border-l border-border/60 px-3 py-4 align-middle">
  <div className="grid grid-cols-3 items-center gap-2">
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggleWatchlist(player);
      }}
      disabled={isLoading}
      className={`inline-flex h-10 w-full justify-center items-center gap-1.5 rounded-md px-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
        !isLoading && isWatched
          ? 'border border-border bg-accent text-accent-foreground hover:bg-accent/80'
          : !isLoading
            ? 'border border-input bg-background text-foreground hover:bg-muted'
            : 'cursor-not-allowed border border-border bg-muted text-muted-foreground'
      }`}
      aria-label={`${isWatched ? 'Remove' : 'Add'} ${player.name} ${isWatched ? 'from' : 'to'} watchlist`}
    >
      <Star className="h-4 w-4" aria-hidden="true" fill={isWatched ? 'currentColor' : 'none'} />
      <span className="hidden 2xl:inline">{isWatched ? 'Watched' : 'Watch'}</span>
    </button>
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onAddToQueue(player);
      }}
      disabled={isLoading || isQueued}
      className={`inline-flex h-10 w-full justify-center items-center gap-1.5 rounded-md px-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
        !isLoading && !isQueued
          ? 'border border-input bg-background text-foreground hover:bg-muted'
          : 'cursor-not-allowed border border-border bg-muted text-muted-foreground'
      }`}
      aria-label={isQueued ? `${player.name} already in queue` : `Add ${player.name} to queue`}
    >
      <ListPlus className="h-4 w-4" aria-hidden="true" />
      <span className="hidden 2xl:inline">{isQueued ? 'Queued' : 'Queue'}</span>
    </button>
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        handlePlayerSelect(player);
      }}
      disabled={!canMakePick || isLoading}
      className={`inline-flex h-10 w-full justify-center items-center gap-1.5 rounded-md px-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
        canMakePick && !isLoading
          ? 'bg-primary text-primary-foreground hover:bg-primary/90'
          : 'cursor-not-allowed bg-muted text-muted-foreground'
      }`}
      aria-label={`Select ${player.name}`}
    >
      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
      <span className="hidden 2xl:inline">{isLoading ? 'Selecting' : 'Select'}</span>
    </button>
  </div>
</td>
```

- [ ] **Step 6: Run the focused player table test**

Run:

```bash
npm run test:unit -- tests/unit/PlayerGrid.a11y.test.tsx
```

Expected:

```text
PASS tests/unit/PlayerGrid.a11y.test.tsx
```

## Task 6: Rails and Feed Final Visual Pass

**Files:**
- Modify: `src/components/draft/DraftLeftRail.tsx`
- Modify: `src/components/PickFeed.tsx`
- Test: `tests/unit/DraftLeftRail.test.tsx`
- Test: `tests/unit/PickFeed.test.tsx`

- [ ] **Step 1: Add rail persistence and sizing assertions**

Extend `tests/unit/DraftLeftRail.test.tsx`:

```tsx
it('uses stable rail sizing and persists the selected mode per draft/user key', () => {
  render(
    <DraftLeftRail
      draftStatus="LIVE"
      storageKey="draft-left-rail:draft-1:member-1"
      rosterSlots={[{ id: 'slot-1', label: 'MID 1' }]}
      queueCount={2}
      watchlistCount={1}
      queuePanel={<div>Queue panel</div>}
      watchlistPanel={<div>Watchlist panel</div>}
      className="min-h-[28rem] lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)]"
    />
  );

  expect(screen.getByRole('tablist')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: /queue/i }));
  expect(window.sessionStorage.getItem('draft-left-rail:draft-1:member-1')).toBe('queue');
});
```

Extend `tests/unit/PickFeed.test.tsx`:

```tsx
it('keeps empty feed and active feed inside the same rail shell', () => {
  const { rerender } = render(
    <PickFeed
      picks={[]}
      participants={[]}
      userMemberId="member-1"
      watchlistPlayerIds={[]}
      contentId="pick-feed-content:test"
    />
  );

  expect(screen.getByText(/no picks yet/i)).toBeInTheDocument();

  rerender(
    <PickFeed
      picks={[
        {
          id: 'pick-1',
          overall: 1,
          round: 1,
          slot: 1,
          auto: false,
          madeAt: '2026-06-13T10:00:00.000Z',
          player: { id: 'player-1', name: 'Caleb Daniel', position: 'DEF', club: 'North Melbourne' },
          member: { id: 'member-1', displayName: 'Tester', teamName: 'Your Team' },
        },
      ]}
      participants={[]}
      userMemberId="member-1"
      watchlistPlayerIds={['player-1']}
      contentId="pick-feed-content:test"
    />
  );

  expect(screen.getByText('Caleb Daniel')).toBeInTheDocument();
  expect(screen.getByText(/watchlist/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run focused rail/feed tests**

Run:

```bash
npm run test:unit -- tests/unit/DraftLeftRail.test.tsx tests/unit/PickFeed.test.tsx
```

Expected before implementation:

```text
PASS tests/unit/DraftLeftRail.test.tsx
PASS tests/unit/PickFeed.test.tsx
```

If either fails because the test query differs from current markup, update the assertion to the visible accessible label in the current component and keep the same behavior contract.

- [ ] **Step 3: Apply rail visual consistency**

In `DraftLeftRail`, ensure the outer shell uses this class pattern:

```tsx
className={cn(
  'overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-sm',
  className
)}
```

Keep tab buttons as semantic buttons or tabs, with `aria-selected`, no hard-coded color utilities, and no nested cards inside the rail.

- [ ] **Step 4: Apply feed visual consistency**

In `PickFeed`, keep the right rail using:

```tsx
className={cn('h-full overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-sm', className)}
```

The empty state and active feed list must live inside the same scroll container so the right rail does not resize when the first pick appears.

- [ ] **Step 5: Run focused rail/feed tests again**

Run:

```bash
npm run test:unit -- tests/unit/DraftLeftRail.test.tsx tests/unit/PickFeed.test.tsx
```

Expected:

```text
PASS tests/unit/DraftLeftRail.test.tsx
PASS tests/unit/PickFeed.test.tsx
```

## Task 7: Full Draft Browser Verification Script

**Files:**
- Create: `Scripts/verify-draft-room-workflow.mjs`
- Modify: `package.json`

- [ ] **Step 1: Create a browser verification script**

Add `Scripts/verify-draft-room-workflow.mjs`:

```js
import { chromium } from 'playwright';

const baseUrl = process.env.STATLY_BASE_URL || 'http://localhost:3004';

async function createDraft(mode) {
  const response = await fetch(`${baseUrl}/api/create-test-draft`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(mode ? { mode } : {}),
  });
  const json = await response.json();
  if (!response.ok || !json?.data?.draft?.url) {
    throw new Error(`Failed to create ${mode || 'standard'} draft: ${JSON.stringify(json)}`);
  }
  return json.data.draft;
}

async function verifyDraftRoom(page, draft) {
  await page.goto(`${baseUrl}${draft.url}`, { waitUntil: 'networkidle' });
  await page.getByRole('banner', { name: /live draft status/i }).waitFor({ timeout: 15000 });
  await page.getByRole('table', { name: /available draft players/i }).waitFor({ timeout: 15000 });
  await page.getByRole('columnheader', { name: /^player$/i }).waitFor();
  await page.getByRole('columnheader', { name: /^profile$/i }).waitFor();
  await page.getByRole('columnheader', { name: /^league stats$/i }).waitFor();
  await page.getByRole('columnheader', { name: /^actions$/i }).waitFor();
  await page.getByRole('button', { name: /watch/i }).first().waitFor();
  await page.getByRole('button', { name: /queue/i }).first().waitFor();
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const standardDraft = await createDraft();
  if (standardDraft.teamCount !== 12) {
    throw new Error(`Expected standard draft to have 12 teams, got ${standardDraft.teamCount}`);
  }
  await verifyDraftRoom(page, standardDraft);

  const compactPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const quickDraft = await createDraft('quick-completion');
  if (quickDraft.teamCount !== 2) {
    throw new Error(`Expected quick draft to have 2 teams, got ${quickDraft.teamCount}`);
  }
  await verifyDraftRoom(compactPage, quickDraft);
} finally {
  await browser.close();
}
```

- [ ] **Step 2: Add an npm script**

In `package.json`, add:

```json
"verify:draft-room": "node Scripts/verify-draft-room-workflow.mjs"
```

- [ ] **Step 3: Run the script against a running stack**

Start the stack in a separate terminal:

```bash
npm run dev:full:all
```

Then run:

```bash
STATLY_BASE_URL=http://localhost:3004 npm run verify:draft-room
```

Expected:

```text
no output and exit code 0
```

If the stack uses another port, set `STATLY_BASE_URL` to the actual web URL shown by Next.js.

## Task 8: Integration Check Suite

**Files:**
- No new files.
- Uses all modified files from Tasks 1-7.

- [ ] **Step 1: Run the focused draft-room unit suite**

Run:

```bash
npm run test:unit -- \
  tests/unit/draftRoomSequencing.test.ts \
  tests/unit/DraftContext.initialFetch.test.tsx \
  tests/unit/DraftPickTrain.test.tsx \
  tests/unit/UnifiedDraftRoom.liveShell.test.tsx \
  tests/unit/PlayerGrid.a11y.test.tsx \
  tests/unit/DraftLeftRail.test.tsx \
  tests/unit/PickFeed.test.tsx \
  tests/unit/DraftRoomLayout.test.ts \
  tests/unit/unifiedDraftRoomDesignArchitecture.test.ts \
  tests/unit/draftCommandRoutes.test.ts
```

Expected:

```text
PASS tests/unit/draftRoomSequencing.test.ts
PASS tests/unit/DraftContext.initialFetch.test.tsx
PASS tests/unit/DraftPickTrain.test.tsx
PASS tests/unit/UnifiedDraftRoom.liveShell.test.tsx
PASS tests/unit/PlayerGrid.a11y.test.tsx
PASS tests/unit/DraftLeftRail.test.tsx
PASS tests/unit/PickFeed.test.tsx
PASS tests/unit/DraftRoomLayout.test.ts
PASS tests/unit/unifiedDraftRoomDesignArchitecture.test.ts
PASS tests/unit/draftCommandRoutes.test.ts
```

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected:

```text
no TypeScript errors
```

- [ ] **Step 3: Run lint on touched source paths**

Run:

```bash
npm run lint -- src/lib/draftRoomSequencing.ts src/lib/mappers/draftUiMappers.ts src/contexts/DraftContext.tsx src/components/LivePickHeader.tsx src/components/draft/UnifiedDraftRoom.tsx src/components/draft/PlayerGrid.tsx src/components/draft/DraftLeftRail.tsx src/components/PickFeed.tsx
```

Expected:

```text
no ESLint errors for touched files
```

- [ ] **Step 4: Run browser verification**

Run with the local stack already running:

```bash
STATLY_BASE_URL=http://localhost:3004 npm run verify:draft-room
```

Expected:

```text
exit code 0
```

## Task 9: Council Review and Commit Gate

**Files:**
- No new code files.
- Uses staged implementation diff.

- [ ] **Step 1: Review unstaged changes before staging**

Run:

```bash
git status --short
git diff -- src/lib/draftRoomSequencing.ts src/lib/mappers/draftUiMappers.ts src/contexts/DraftContext.tsx src/components/LivePickHeader.tsx src/components/draft/UnifiedDraftRoom.tsx src/components/draft/PlayerGrid.tsx src/components/draft/DraftLeftRail.tsx src/components/PickFeed.tsx tests/unit package.json Scripts/verify-draft-room-workflow.mjs
```

Expected:

```text
Only draft-room implementation, tests, package script, and verification script are shown. prisma/dev.db remains unstaged.
```

- [ ] **Step 2: Stage only intended files**

Run:

```bash
git add \
  src/lib/draftRoomSequencing.ts \
  src/lib/mappers/draftUiMappers.ts \
  src/contexts/DraftContext.tsx \
  src/components/LivePickHeader.tsx \
  src/components/draft/UnifiedDraftRoom.tsx \
  src/components/draft/PlayerGrid.tsx \
  src/components/draft/DraftLeftRail.tsx \
  src/components/PickFeed.tsx \
  tests/unit/draftRoomSequencing.test.ts \
  tests/unit/DraftContext.initialFetch.test.tsx \
  tests/unit/DraftPickTrain.test.tsx \
  tests/unit/UnifiedDraftRoom.liveShell.test.tsx \
  tests/unit/PlayerGrid.a11y.test.tsx \
  tests/unit/DraftLeftRail.test.tsx \
  tests/unit/PickFeed.test.tsx \
  tests/unit/DraftRoomLayout.test.ts \
  tests/unit/unifiedDraftRoomDesignArchitecture.test.ts \
  Scripts/verify-draft-room-workflow.mjs \
  package.json
```

Expected:

```text
git status --short shows staged implementation files and an unstaged prisma/dev.db change only.
```

- [ ] **Step 3: Run Decision 2 council review**

Run:

```bash
npm run codex:council:logical -- --staged --prompt "Chairman Decision 2: decide whether the completed draft-room workflow and visual completion work should be committed. Require root-cause sequencing/timer ownership, table/rail alignment, persistence, tests, and browser verification."
```

Expected:

```text
Committee Debate
Chairman Decision
CHAIRMAN DECISION 2: COMMIT
```

- [ ] **Step 4: Commit through the reviewed path**

Run:

```bash
npm run codex:commit:reviewed -- "Complete draft room workflow and visual polish"
```

Expected:

```text
Commit created successfully
```

## Self-Review Checklist

- Spec coverage: This plan covers live sequencing, timer UX, one unified draft-room shell, table alignment, side rails, pick feed, seeded full-draft verification, and council commit gates.
- Placeholder scan: The plan contains no deferred implementation markers and every task has concrete files, code snippets, commands, and expected results.
- Type consistency: Sequencing types are defined in `src/lib/draftRoomSequencing.ts`; existing mapper names remain stable; components keep their public imports.
- Workflow simplification: The plan keeps one draft room and removes conflicting layout expectations from tests.
- Persistence: Draft state remains stored through existing Prisma and draft services; browser state persistence remains limited to UI preferences such as the left-rail tab.
