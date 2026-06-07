# World Class Draft Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved Statly draft room into the existing `/drafts/[id]` route with one consolidated live draft experience.

**Architecture:** Keep `DraftProvider` as the state owner and integrate new focused components into `UnifiedDraftRoom`, not a parallel draft room. Add `Statly Z` at the draft-player read-model boundary, then pass normalized pick, rail, table, and feed state down into small presentational components.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Vitest, Testing Library, existing shadcn-style semantic Tailwind tokens, Prisma-backed draft APIs.

---

## PROPOSED EDIT PLAN

Working with: `src/server/draft/readModels/draftPlayerReadModel.ts`, `src/types/draft.ts`, `src/components/draft/PlayerGrid.tsx`, `src/lib/mappers/draftUiMappers.ts`, `src/components/LivePickHeader.tsx`, `src/components/draft/DraftPickTrain.tsx`, `src/components/draft/DraftLeftRail.tsx`, `src/components/PickFeed.tsx`, `src/components/draft/UnifiedDraftRoom.tsx`, and focused tests.

Total planned edits: 7

### Edit sequence:

1. Add `Statly Z` read-model support - Purpose: make the primary value come from the league's selected categories at the data boundary.
2. Update `PlayerGrid` for `Statly Z` and category sorting - Purpose: remove "Fantasy avg" and make the player table reflect league-selected categories.
3. Add a pick-train mapper and refactor `LivePickHeader` - Purpose: keep the existing live-status owner while giving it an ESPN-style draft board.
4. Add the left roster/queue/watchlist rail - Purpose: provide the approved phase-aware default and persisted user choice.
5. Convert the pick feed to the right activity rail standard - Purpose: remove mixed legacy styling and show pick/watchlist context cleanly.
6. Integrate the shell in `UnifiedDraftRoom` - Purpose: make the main route use the top board, left rail, center players, and right feed with no parallel version.
7. Run unit, type, and browser verification - Purpose: prove scheduled/live/paused/complete states, dynamic categories, persisted rail choice, and visible picks work.

Dependencies:

- Edit 2 depends on Edit 1 because `PlayerGrid` needs `statlyZScore`.
- Edit 3 depends on the existing `draftUiMappers` shapes and can run in parallel with Edit 1 after the mapper API is decided.
- Edit 4 depends on existing `DraftQueue` and `DraftWatchlist` props but not on `Statly Z`.
- Edit 6 depends on Edits 2, 3, 4, and 5.
- Edit 7 depends on all implementation edits.

Verification:

- `npm run test:unit -- tests/unit/draftPlayersRouteReadModel.test.ts`
- `npm run test:unit -- tests/unit/PlayerGrid.a11y.test.tsx`
- `npm run test:unit -- tests/unit/UnifiedDraftRoom.liveShell.test.tsx`
- `npm run test:unit -- tests/unit/unifiedDraftRoomDesignArchitecture.test.ts`
- `npm run typecheck`
- Browser verification on `http://localhost:3004/drafts/<draftId>` at desktop and mobile widths.

## File Structure

- Modify `src/server/draft/readModels/draftPlayerReadModel.ts`: compute and expose `statlyZScore` from league-selected categories.
- Modify `src/types/draft.ts`: add optional `statlyZScore`, `statlyZBreakdown`, and `statlyZMissingCategories` to `DraftPlayer`.
- Modify `src/app/api/drafts/[id]/players/route.ts`: pass selected categories into `buildAvailableDraftPlayer`.
- Modify `src/components/draft/PlayerGrid.tsx`: show `Statly Z`, sort by `statlyZ`, preserve logos and category columns.
- Modify `src/lib/mappers/draftUiMappers.ts`: add `toDraftPickTrainState` and use existing feed mappers as source.
- Modify `src/components/LivePickHeader.tsx`: keep it as the canonical live-status component and delegate its pick-train body to a focused component.
- Create `src/components/draft/DraftPickTrain.tsx`: top horizontal pick train and timer surface used by `LivePickHeader`.
- Create `src/components/draft/DraftLeftRail.tsx`: roster/queue/watchlist rail with phase defaults and session persistence.
- Modify `src/components/PickFeed.tsx`: convert to semantic tokens and add team-logo/player context for the right rail.
- Modify `src/components/draft/UnifiedDraftRoom.tsx`: compose the new shell around the existing provider data and handlers.
- Add or update `tests/unit/statlyZScore.test.ts`, `tests/unit/draftPlayersRouteReadModel.test.ts`, `tests/unit/PlayerGrid.a11y.test.tsx`, `tests/unit/UnifiedDraftRoom.liveShell.test.tsx`, and `tests/unit/unifiedDraftRoomDesignArchitecture.test.ts`.

### Task 1: Statly Z Read Model

**Files:**
- Modify: `src/types/draft.ts`
- Modify: `src/server/draft/readModels/draftPlayerReadModel.ts`
- Modify: `src/app/api/drafts/[id]/players/route.ts`
- Test: `tests/unit/statlyZScore.test.ts`
- Test: `tests/unit/draftPlayersRouteReadModel.test.ts`

- [ ] **Step 1: Write the failing Statly Z helper tests**

Create `tests/unit/statlyZScore.test.ts` with focused expectations:

```ts
import { describe, expect, it } from 'vitest';

import {
  calculateStatlyZScores,
  type StatlyZPlayerInput,
} from '@/server/draft/readModels/draftPlayerReadModel';
import type { FantasyCategoryKey } from '@/types/fantasyCategories';

const categories = ['goals', 'tackles', 'inside50s'] satisfies FantasyCategoryKey[];

const players: StatlyZPlayerInput[] = [
  { id: 'p1', stats: { goals: 3, tackles: 8, inside50s: 4 } },
  { id: 'p2', stats: { goals: 1, tackles: 4, inside50s: 2 } },
  { id: 'p3', stats: { goals: 2, tackles: 6, inside50s: 3 } },
];

describe('calculateStatlyZScores', () => {
  it('sums z scores across the league selected categories', () => {
    const scores = calculateStatlyZScores(players, categories);

    expect(scores.get('p1')?.score).toBeGreaterThan(0);
    expect(scores.get('p2')?.score).toBeLessThan(0);
    expect(scores.get('p3')?.score).toBe(0);
    expect(scores.get('p1')?.breakdown.map((entry) => entry.category)).toEqual(categories);
  });

  it('does not assume a fixed nine category set', () => {
    const scores = calculateStatlyZScores(players, ['goals']);

    expect(scores.get('p1')?.breakdown).toHaveLength(1);
    expect(scores.get('p1')?.breakdown[0]).toMatchObject({ category: 'goals' });
  });

  it('reports missing selected categories without inflating the score', () => {
    const scores = calculateStatlyZScores([{ id: 'p1', stats: { goals: 3 } }], [
      'goals',
      'tackles',
    ]);

    expect(scores.get('p1')?.missingCategories).toEqual(['tackles']);
    expect(scores.get('p1')?.score).toBe(0);
  });
});
```

- [ ] **Step 2: Run the helper test and confirm failure**

Run:

```bash
npm run test:unit -- tests/unit/statlyZScore.test.ts
```

Expected: fail because `calculateStatlyZScores` and `StatlyZPlayerInput` do not exist.

- [ ] **Step 3: Add draft player `Statly Z` types**

In `src/types/draft.ts`, extend `DraftPlayer`:

```ts
  statlyZScore?: number;
  statlyZBreakdown?: Array<{
    category: import('@/types/fantasyCategories').FantasyCategoryKey;
    value: number;
    zScore: number;
  }>;
  statlyZMissingCategories?: import('@/types/fantasyCategories').FantasyCategoryKey[];
```

- [ ] **Step 4: Implement `calculateStatlyZScores` in the read model**

In `src/server/draft/readModels/draftPlayerReadModel.ts`, export these types and helper:

```ts
export type StatlyZPlayerInput = {
  id: string;
  stats?: Partial<PlayerStats>;
};

export type StatlyZScore = {
  score: number;
  breakdown: Array<{ category: FantasyCategoryKey; value: number; zScore: number }>;
  missingCategories: FantasyCategoryKey[];
};

function roundZ(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculateStatlyZScores(
  players: StatlyZPlayerInput[],
  selectedCategories: FantasyCategoryKey[]
): Map<string, StatlyZScore> {
  const categories = selectedCategories.filter((category) => FANTASY_CATEGORIES[category]);
  const result = new Map<string, StatlyZScore>();

  const categoryStats = new Map<FantasyCategoryKey, { mean: number; stdDev: number }>();
  for (const category of categories) {
    const values = players
      .map((player) => player.stats?.[category])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const mean = values.length
      ? values.reduce((total, value) => total + value, 0) / values.length
      : 0;
    const variance = values.length
      ? values.reduce((total, value) => total + Math.pow(value - mean, 2), 0) / values.length
      : 0;
    categoryStats.set(category, { mean, stdDev: Math.sqrt(variance) });
  }

  for (const player of players) {
    const breakdown: StatlyZScore['breakdown'] = [];
    const missingCategories: FantasyCategoryKey[] = [];

    for (const category of categories) {
      const value = player.stats?.[category];
      const stats = categoryStats.get(category);
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        missingCategories.push(category);
        continue;
      }

      const zScore = stats && stats.stdDev > 0 ? (value - stats.mean) / stats.stdDev : 0;
      breakdown.push({ category, value, zScore: roundZ(zScore) });
    }

    result.set(player.id, {
      score: roundZ(breakdown.reduce((total, entry) => total + entry.zScore, 0)),
      breakdown,
      missingCategories,
    });
  }

  return result;
}
```

- [ ] **Step 5: Pass selected categories into available player building**

Change `buildAvailableDraftPlayer` to accept `statlyZScore?: StatlyZScore` and include:

```ts
    ...(statlyZScore
      ? {
          statlyZScore: statlyZScore.score,
          statlyZBreakdown: statlyZScore.breakdown,
          statlyZMissingCategories: statlyZScore.missingCategories,
        }
      : undefined),
```

In `src/app/api/drafts/[id]/players/route.ts`, build all players first, calculate scores from those rows, then spread scores onto the already-built rows:

```ts
const basePlayers = players.map((player) => buildAvailableDraftPlayer(player, statsLookup));
const statlyZScores = calculateStatlyZScores(basePlayers, selectedCategories);

const data = {
  draftId: id,
  players: basePlayers.map((player) => {
    const statlyZScore = statlyZScores.get(player.id);
    return {
      ...player,
      ...(statlyZScore
        ? {
            statlyZScore: statlyZScore.score,
            statlyZBreakdown: statlyZScore.breakdown,
            statlyZMissingCategories: statlyZScore.missingCategories,
          }
        : undefined),
    };
  }),
  pagination: {
    page,
    pageSize,
    hasMore,
    q: q || null,
    position: position || null,
  },
  selectedCategories,
  draftReadiness,
  lastUpdated: lastUpdated.toISOString(),
};
```

- [ ] **Step 6: Update the route read-model test**

In `tests/unit/draftPlayersRouteReadModel.test.ts`, add:

```ts
expect(body.data.players[0]).toMatchObject({
  statlyZScore: expect.any(Number),
  statlyZBreakdown: expect.arrayContaining([
    expect.objectContaining({ category: 'goals', value: 0.5, zScore: expect.any(Number) }),
  ]),
});
expect(body.data.players[0].statlyZBreakdown).toHaveLength(REAL_DATA_NINE_CATEGORY_PRESET.length);
expect(body.data.players[1].statlyZScore).toBeDefined();
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
npm run test:unit -- tests/unit/statlyZScore.test.ts tests/unit/draftPlayersRouteReadModel.test.ts
```

Expected: both pass.

### Task 2: PlayerGrid `Statly Z` Table

**Files:**
- Modify: `src/components/draft/PlayerGrid.tsx`
- Modify: `src/components/draft/UnifiedDraftRoom.tsx`
- Test: `tests/unit/PlayerGrid.a11y.test.tsx`

- [ ] **Step 1: Write failing PlayerGrid assertions**

In `tests/unit/PlayerGrid.a11y.test.tsx`, change the fixture player to include:

```ts
statlyZScore: 3.42,
statlyZBreakdown: [
  { category: 'goals', value: 1.1, zScore: 0.4 },
  { category: 'tackles', value: 5.8, zScore: 1.2 },
],
```

Add assertions:

```ts
expect(within(playerRow).getByText('Statly Z')).toBeInTheDocument();
expect(within(playerRow).getByText('3.42')).toBeInTheDocument();
expect(screen.getByRole('option', { name: 'Sort by Statly Z' })).toBeInTheDocument();
expect(screen.queryByText(/Fantasy avg/i)).not.toBeInTheDocument();
expect(screen.queryByText(/Fantasy average/i)).not.toBeInTheDocument();
```

- [ ] **Step 2: Run PlayerGrid test and confirm failure**

Run:

```bash
npm run test:unit -- tests/unit/PlayerGrid.a11y.test.tsx
```

Expected: fail because the table still renders `Fantasy avg` and lacks `statlyZ` sorting.

- [ ] **Step 3: Extend PlayerGrid sort props**

In `PlayerGridProps`, change sort types to:

```ts
  sortBy: 'statlyZ' | 'name' | 'position' | 'club' | 'adp';
  onSortChange: (sort: 'statlyZ' | 'name' | 'position' | 'club' | 'adp') => void;
```

- [ ] **Step 4: Render the `Statly Z` metric**

Replace the `Fantasy avg` block with:

```tsx
<div>
  <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
    Statly Z
  </div>
  <div className="mt-1 text-lg font-semibold leading-none text-foreground">
    {typeof player.statlyZScore === 'number' ? player.statlyZScore.toFixed(2) : 'Pending'}
  </div>
  <div className="mt-1 text-[11px] leading-4 text-muted-foreground">
    Combined Z score across this league&apos;s selected scoring categories.
  </div>
</div>
```

When `visibleCategories.length === 0`, keep the existing category empty state but update wording to `League categories pending.`

- [ ] **Step 5: Add sort option**

In the sort select:

```tsx
<option value="statlyZ">Sort by Statly Z</option>
<option value="adp">Sort by ADP</option>
```

- [ ] **Step 6: Update UnifiedDraftRoom sort behavior**

In `src/components/draft/UnifiedDraftRoom.tsx`, change sort state to:

```ts
const [sortBy, setSortBy] = useState<'statlyZ' | 'name' | 'position' | 'club' | 'adp'>('statlyZ');
```

Update `sortKeyMap`:

```ts
statlyZ: (p: DraftPlayer) => p.statlyZScore ?? Number.NEGATIVE_INFINITY,
```

For `statlyZ`, sort descending. For `adp`, sort ascending. For strings, sort alphabetically.

- [ ] **Step 7: Run focused tests**

Run:

```bash
npm run test:unit -- tests/unit/PlayerGrid.a11y.test.tsx tests/unit/UnifiedDraftRoom.liveShell.test.tsx
```

Expected: pass.

### Task 3: Draft Pick Train

**Files:**
- Modify: `src/lib/mappers/draftUiMappers.ts`
- Modify: `src/components/LivePickHeader.tsx`
- Create: `src/components/draft/DraftPickTrain.tsx`
- Test: `tests/unit/DraftPickTrain.test.tsx`
- Test: `tests/unit/LivePickHeader.a11y.test.tsx`
- Test: `tests/unit/unifiedDraftRoomDesignArchitecture.test.ts`

- [ ] **Step 1: Write mapper and component test**

Create `tests/unit/DraftPickTrain.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import DraftPickTrain from '@/components/draft/DraftPickTrain';
import type { DraftPickTrainState } from '@/lib/mappers/draftUiMappers';

const state: DraftPickTrainState = {
  status: 'LIVE',
  currentPick: 2,
  totalPicks: 4,
  round: 1,
  timePerPick: 60,
  pickDeadlineAt: null,
  isYourTurn: true,
  slots: [
    {
      key: 'pick-1',
      overall: 1,
      round: 1,
      slot: 1,
      state: 'completed',
      teamName: 'Statly Dev Tester',
      isUserTeam: true,
      player: { id: 'caleb', name: 'Caleb Daniel', position: 'DEF', club: 'North Melbourne' },
      auto: false,
    },
    {
      key: 'pick-2',
      overall: 2,
      round: 1,
      slot: 2,
      state: 'current',
      teamName: 'CPU Team 2',
      isUserTeam: false,
    },
    {
      key: 'pick-3',
      overall: 3,
      round: 2,
      slot: 2,
      state: 'upcoming',
      teamName: 'CPU Team 2',
      isUserTeam: false,
    },
    {
      key: 'pick-4',
      overall: 4,
      round: 2,
      slot: 1,
      state: 'upcoming',
      teamName: 'Statly Dev Tester',
      isUserTeam: true,
      isUserNextPick: true,
    },
  ],
};

describe('DraftPickTrain', () => {
  it('renders completed, current, upcoming, and user next pick states', () => {
    render(<DraftPickTrain state={state} />);

    expect(screen.getByRole('region', { name: /draft pick train/i })).toBeInTheDocument();
    expect(screen.getByText('Caleb Daniel')).toBeInTheDocument();
    expect(screen.getByText('On the clock')).toBeInTheDocument();
    expect(screen.getByText('Your next pick')).toBeInTheDocument();
    expect(screen.getByText('North Melbourne')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Add mapper types**

In `src/lib/mappers/draftUiMappers.ts`, add:

```ts
export type DraftPickTrainSlot = {
  key: string;
  overall: number;
  round: number;
  slot: number;
  state: 'completed' | 'current' | 'upcoming';
  teamName: string;
  isUserTeam: boolean;
  isUserNextPick?: boolean;
  auto?: boolean;
  player?: { id: string; name: string; position: string; club: string };
};

export type DraftPickTrainState = {
  status: DraftState['status'];
  currentPick: number;
  totalPicks: number;
  round: number;
  timePerPick: number;
  pickDeadlineAt?: string | null;
  isYourTurn: boolean;
  slots: DraftPickTrainSlot[];
};
```

- [ ] **Step 3: Add `toDraftPickTrainState`**

Implement the helper using existing participants and picks:

```ts
export function toDraftPickTrainState(params: {
  draft: DraftState;
  participants: DraftParticipant[];
  picks: DraftPick[];
  userMemberId: string;
  isYourTurn: boolean;
  windowSize?: number;
}): DraftPickTrainState {
  const { draft, participants, picks, userMemberId, isYourTurn, windowSize = 14 } = params;
  const participantBySlot = new Map(participants.map((participant) => [participant.draftOrder, participant]));
  const pickByOverall = new Map(picks.map((pick) => [pick.overall, pick]));
  const teamCount = Math.max(1, participants.length);
  const start = Math.max(1, draft.currentPick - 5);
  const end = Math.min(draft.totalPicks, start + windowSize - 1);

  const slots: DraftPickTrainSlot[] = [];
  for (let overall = start; overall <= end; overall += 1) {
    const round = Math.ceil(overall / teamCount);
    const isReverse = draft.direction === 'REVERSE' || (draft.direction === 'FORWARD' && round % 2 === 0);
    const slot = isReverse ? teamCount - ((overall - 1) % teamCount) : ((overall - 1) % teamCount) + 1;
    const participant = participantBySlot.get(slot);
    const pick = pickByOverall.get(overall);
    const isUserTeam = participant?.id === userMemberId;
    slots.push({
      key: pick?.id ?? `pick-${overall}`,
      overall,
      round,
      slot,
      state: pick ? 'completed' : overall === draft.currentPick ? 'current' : 'upcoming',
      teamName: participant?.teamName || participant?.displayName || `Team ${slot}`,
      isUserTeam,
      isUserNextPick: !pick && overall > draft.currentPick && isUserTeam,
      auto: pick?.auto,
      player: pick?.player
        ? {
            id: pick.player.id,
            name: pick.player.name,
            position: pick.player.position,
            club: pick.player.club,
          }
        : undefined,
    });
  }

  return {
    status: draft.status,
    currentPick: draft.currentPick,
    totalPicks: draft.totalPicks,
    round: draft.round,
    timePerPick: draft.settings?.timePerPick ?? 120,
    pickDeadlineAt: draft.pickDeadlineAt ? formatDateToIso(draft.pickDeadlineAt) : null,
    isYourTurn,
    slots,
  };
}
```

- [ ] **Step 4: Create `DraftPickTrain`**

Create `src/components/draft/DraftPickTrain.tsx` as a semantic-token component. Use `getTeamLogo` for completed-pick club logos, `Clock3`, `CheckCircle2`, and `UserRound` from `lucide-react`, and render a horizontally scrollable list with:

```tsx
<section
  role="region"
  aria-label="Draft pick train"
  className="border-b border-border bg-card text-card-foreground"
>
  <div className="flex items-center gap-3 overflow-x-auto px-3 py-3">
    {state.slots.map((slot) => (
      <article
        key={slot.key}
        aria-current={slot.state === 'current' ? 'step' : undefined}
        className="min-w-44 rounded-md border border-border bg-background p-3"
      >
        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Pick {slot.overall}
        </div>
        <div className="mt-1 text-sm font-semibold text-foreground">
          {slot.player?.name ?? slot.teamName}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {slot.state === 'current'
            ? 'On the clock'
            : slot.isUserNextPick
              ? 'Your next pick'
              : `Round ${slot.round}`}
        </div>
      </article>
    ))}
  </div>
</section>
```

Do not import or render `LivePickHeader` inside this component. `LivePickHeader` imports `DraftPickTrain`, not the other way around.

- [ ] **Step 5: Refactor `LivePickHeader` to use `DraftPickTrain`**

Keep `LivePickHeader` props stable for `UnifiedDraftRoom`. Add `toDraftPickTrainStateFromHeaderData` beside `toLivePickHeaderData`:

```ts
export function toDraftPickTrainStateFromHeaderData(params: {
  draftData: LivePickHeaderData;
  timePerPick: number;
  isYourTurn: boolean;
  yourSlot?: number;
}): DraftPickTrainState {
  const { draftData, timePerPick, isYourTurn, yourSlot } = params;
  const userMemberId =
    draftData.participants.find((participant) => participant.slot === yourSlot)?.member.id ?? '';
  const draftState = {
    id: draftData.id,
    leagueId: '',
    name: 'Draft',
    status: draftData.status as DraftState['status'],
    currentPick: draftData.currentPick,
    totalPicks: draftData.totalPicks,
    round: draftData.round,
    direction: draftData.direction as DraftState['direction'],
    pickDeadlineAt: draftData.pickDeadlineAt ? new Date(draftData.pickDeadlineAt) : null,
    participants: [],
    picks: [],
    availablePlayers: [],
    settings: { timePerPick } as DraftState['settings'],
    createdAt: new Date(),
    updatedAt: new Date(),
    lastActivity: new Date(),
  };
  const participants = draftData.participants.map((participant) => ({
    id: participant.member.id,
    userId: participant.member.userId,
    displayName: participant.member.displayName,
    teamName: participant.member.displayName,
    draftOrder: participant.slot,
    isOnline: true,
    lastSeen: new Date(),
    isCurrentTurn: false,
  }));
  const picks = draftData.picks.map((pick) => ({
    id: pick.id,
    overall: pick.overall,
    round: pick.round,
    slot: pick.slot,
    player: { ...pick.player, isAvailable: false },
    member: { ...pick.member, userId: '', teamName: pick.member.displayName },
    auto: pick.auto,
    madeAt: new Date(pick.madeAt),
  }));

  return toDraftPickTrainState({ draft: draftState, participants, picks, userMemberId, isYourTurn });
}
```

Then replace `LivePickHeader`'s old visual body with:

```tsx
const pickTrainState = toDraftPickTrainStateFromHeaderData({
  draftData,
  timePerPick,
  isYourTurn,
  yourSlot,
});

return <DraftPickTrain state={pickTrainState} timeLeft={timeLeft} className={className} />;
```

- [ ] **Step 6: Update header and architecture tests**

In `tests/unit/unifiedDraftRoomDesignArchitecture.test.ts`, add expectations:

```ts
expect(roomSource).toContain('<LivePickHeader');
expect(roomSource).not.toContain('role="tablist"');
```

In `tests/unit/LivePickHeader.a11y.test.tsx`, update assertions so the header remains the accessible banner and now exposes pick-train text:

```ts
expect(screen.getByRole('banner', { name: /live draft status/i })).toBeInTheDocument();
expect(screen.getByRole('region', { name: /draft pick train/i })).toBeInTheDocument();
expect(screen.getByText(/on the clock/i)).toBeInTheDocument();
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
npm run test:unit -- tests/unit/DraftPickTrain.test.tsx tests/unit/LivePickHeader.a11y.test.tsx tests/unit/unifiedDraftRoomDesignArchitecture.test.ts
```

Expected: pass after `LivePickHeader` delegates to `DraftPickTrain`.

### Task 4: Left Rail With Phase Defaults

**Files:**
- Create: `src/components/draft/DraftLeftRail.tsx`
- Modify: `src/components/draft/DraftQueue.tsx`
- Modify: `src/components/DraftWatchlist.tsx`
- Test: `tests/unit/DraftLeftRail.test.tsx`

- [ ] **Step 1: Write left rail behavior tests**

Create `tests/unit/DraftLeftRail.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import DraftLeftRail from '@/components/draft/DraftLeftRail';

const props = {
  status: 'LOBBY' as const,
  queueCount: 2,
  watchlistCount: 1,
  roster: [{ label: 'DEF', playerName: null }],
  queuePanel: <div>Queue panel</div>,
  watchlistPanel: <div>Watchlist panel</div>,
};

describe('DraftLeftRail', () => {
  it('defaults to queue before the draft starts', () => {
    render(<DraftLeftRail {...props} />);
    expect(screen.getByRole('tab', { name: /queue 2/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Queue panel')).toBeInTheDocument();
  });

  it('defaults to roster during live drafts', () => {
    render(<DraftLeftRail {...props} status="LIVE" />);
    expect(screen.getByRole('tab', { name: /roster/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('persists manual mode choice for the session', () => {
    render(<DraftLeftRail {...props} status="LIVE" storageKey="test-draft-left-rail" />);
    fireEvent.click(screen.getByRole('tab', { name: /watchlist 1/i }));
    expect(window.sessionStorage.getItem('test-draft-left-rail')).toBe('watchlist');
  });
});
```

- [ ] **Step 2: Create `DraftLeftRail`**

Create a client component with:

```ts
type DraftRailMode = 'roster' | 'queue' | 'watchlist';
```

Use this default logic:

```ts
function defaultModeForStatus(status: DraftStatus): DraftRailMode {
  return status === 'LIVE' || status === 'PAUSED' || status === 'COMPLETED' ? 'roster' : 'queue';
}
```

Persist user choice:

```ts
const [mode, setMode] = useState<DraftRailMode>(() => defaultModeForStatus(status));

useEffect(() => {
  const stored = window.sessionStorage.getItem(storageKey);
  if (stored === 'roster' || stored === 'queue' || stored === 'watchlist') setMode(stored);
}, [storageKey]);

const chooseMode = (next: DraftRailMode) => {
  setMode(next);
  window.sessionStorage.setItem(storageKey, next);
};
```

- [ ] **Step 3: Render roster, queue, and watchlist panels**

The rail should accept `queuePanel` and `watchlistPanel` so existing queue/watchlist components stay reusable. Render roster rows from:

```ts
type RosterSlot = {
  label: string;
  playerName: string | null;
  position?: string;
  club?: string;
};
```

Use semantic tokens and accessible tabs. Queue and watchlist labels must include counts.

- [ ] **Step 4: Tokenize queue/watchlist only where embedded**

Update `DraftQueue` and `DraftWatchlist` hard-coded gray/blue/red/orange/yellow classes that become visible in the left rail. Replace with existing semantic utilities: `bg-card`, `bg-muted`, `border-border`, `text-foreground`, `text-muted-foreground`, `text-destructive`, `bg-primary`, and `text-primary-foreground`.

- [ ] **Step 5: Run focused test**

Run:

```bash
npm run test:unit -- tests/unit/DraftLeftRail.test.tsx
```

Expected: pass.

### Task 5: Right Pick Feed Rail

**Files:**
- Modify: `src/components/PickFeed.tsx`
- Test: `tests/unit/PickFeed.test.tsx`

- [ ] **Step 1: Write PickFeed assertions**

Create `tests/unit/PickFeed.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import PickFeed from '@/components/PickFeed';

describe('PickFeed', () => {
  it('renders recent picks with semantic activity filters', () => {
    render(
      <PickFeed
        userMemberId="member-1"
        watchlistPlayerIds={['player-1']}
        participants={[{ slot: 1, member: { id: 'member-1', userId: 'u1', displayName: 'Statly Dev', email: '' } }]}
        picks={[
          {
            id: 'pick-1',
            overall: 1,
            round: 1,
            slot: 1,
            auto: false,
            madeAt: new Date('2026-06-07T08:00:00.000Z').toISOString(),
            member: { id: 'member-1', displayName: 'Statly Dev' },
            player: { id: 'player-1', name: 'Caleb Daniel', position: 'DEF', club: 'North Melbourne' },
          },
        ]}
      />
    );

    expect(screen.getByRole('complementary', { name: /pick feed/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /all/i })).toBeInTheDocument();
    expect(screen.getByText('Caleb Daniel')).toBeInTheDocument();
    expect(screen.getByText('Watchlist')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Convert PickFeed to semantic tokens**

Replace hard-coded classes such as `border-slate-200`, `bg-white`, `text-slate-950`, `bg-emerald-50`, and `bg-amber-50` with semantic tokens. Keep the same filter behavior.

- [ ] **Step 3: Add club logo to pick card**

Use `getTeamLogo(pick.player.club)` and `next/image`, with `alt=""` and `aria-hidden="true"` for decorative logos.

- [ ] **Step 4: Run focused test**

Run:

```bash
npm run test:unit -- tests/unit/PickFeed.test.tsx
```

Expected: pass.

### Task 6: Unified Draft Room Shell Integration

**Files:**
- Modify: `src/components/draft/UnifiedDraftRoom.tsx`
- Modify: `tests/unit/UnifiedDraftRoom.liveShell.test.tsx`
- Modify: `tests/unit/unifiedDraftRoomDesignArchitecture.test.ts`

- [ ] **Step 1: Update shell composition tests**

In `tests/unit/UnifiedDraftRoom.liveShell.test.tsx`, mock the new components:

```ts
vi.mock('@/components/draft/DraftPickTrain', () => ({
  default: () => <section aria-label="Draft pick train">Draft pick train</section>,
}));

vi.mock('@/components/draft/DraftLeftRail', () => ({
  default: () => <aside aria-label="Draft roster and lists">Draft left rail</aside>,
}));
```

Update assertions:

```ts
expect(screen.getByRole('region', { name: /draft pick train/i })).toBeInTheDocument();
expect(screen.getByRole('complementary', { name: /draft roster and lists/i })).toBeInTheDocument();
expect(screen.getByText('Available player grid')).toBeInTheDocument();
expect(screen.getByRole('complementary', { name: /pick feed/i })).toBeInTheDocument();
```

- [ ] **Step 2: Replace tabbed shell with three-column layout**

In `UnifiedDraftRoom`, remove the top-level `activeTab` state for players/queue/watchlist/analytics. Keep search/filter/sort state and queue/watchlist handlers.

Render:

```tsx
<LivePickHeader
  draftData={toLivePickHeaderData(activeDraft, participants, picks)}
  timePerPick={activeDraft.settings?.timePerPick ?? 120}
  isYourTurn={Boolean(draft.liveState?.isYourTurn)}
  yourSlot={yourSlot}
/>
<main className="grid gap-4 px-3 pb-6 sm:px-5 lg:grid-cols-[20rem_minmax(0,1fr)_22rem] lg:px-6 xl:grid-cols-[22rem_minmax(0,1fr)_24rem]">
  <DraftLeftRail
    status={activeDraft.status}
    storageKey={`draft-left-rail:${draftId}:${userMemberId}`}
    queueCount={queuePlayerIds.length}
    watchlistCount={watchlistItems.length}
    roster={rosterSlots}
    queuePanel={queuePanel}
    watchlistPanel={watchlistPanel}
  />
  <section aria-label="Available players">
    <PlayerGrid
      players={filteredPlayers}
      totalPlayers={playersList.length}
      onPlayerSelect={handlePlayerSelect}
      onAddToQueue={handleAddToQueue}
      onToggleWatchlist={handleToggleWatchlist}
      canMakePick={draft.canMakePick}
      queuedPlayerIds={queuePlayerIds}
      watchedPlayerIds={watchlistItems.map((item) => item.playerId)}
      selectedCategories={selectedCategories}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      positionFilter={positionFilter}
      onPositionFilterChange={setPositionFilter}
      availablePositions={availablePositions}
      sortBy={sortBy}
      onSortChange={setSortBy}
      isLoading={draft.isSaving}
      emptyStateMessage={emptyPlayerMessage}
    />
  </section>
  <PickFeed
    picks={feedPicks}
    participants={feedParticipants}
    userMemberId={userMemberId}
    watchlistPlayerIds={watchlistItems.map((item) => item.playerId)}
  />
</main>
```

Keep `DraftAnalytics` out of the first implementation unless it is already required by a visible route state. This avoids hiding the approved player/rail/feed layout behind a fourth tab.

- [ ] **Step 3: Build left rail roster data**

Use existing picks and user member id to create simple roster slots:

```ts
const myPicks = picks.filter((pick) => pick.member.id === userMemberId);
const rosterSlots = myPicks.map((pick, index) => ({
  label: `Pick ${index + 1}`,
  playerName: pick.player.name,
  position: pick.player.position,
  club: pick.player.club,
}));
```

If no picks exist, create empty roster display slots from `activeDraft.settings.startingLineup` and `activeDraft.settings.benchSize`. When those settings are empty, render one empty row with label `Roster` and text `Roster will fill as your picks are made.`

- [ ] **Step 4: Preserve `teamName` in mappers**

In `src/lib/mappers/draftUiMappers.ts`, preserve `teamName` when mapping participants and picks:

```ts
member: {
  id: p.id,
  userId: p.userId,
  displayName: p.teamName || p.displayName,
  email: '',
}
```

- [ ] **Step 5: Keep mobile feed accessible**

The right `PickFeed` is visible in the desktop grid. Keep the existing mobile pick-feed button/modal if the right column collapses below `lg`, or replace it with a semantic mobile drawer using the same `PickFeed` props. Preserve `aria-label="Open Pick Feed"` and focus restore.

- [ ] **Step 6: Run shell tests**

Run:

```bash
npm run test:unit -- tests/unit/UnifiedDraftRoom.liveShell.test.tsx tests/unit/unifiedDraftRoomDesignArchitecture.test.ts
```

Expected: pass.

### Task 7: Verification And Commit Gate

**Files:**
- No app files unless verification reveals a defect.

- [ ] **Step 1: Run focused unit suite**

Run:

```bash
npm run test:unit -- tests/unit/statlyZScore.test.ts tests/unit/draftPlayersRouteReadModel.test.ts tests/unit/PlayerGrid.a11y.test.tsx tests/unit/DraftPickTrain.test.tsx tests/unit/LivePickHeader.a11y.test.tsx tests/unit/DraftLeftRail.test.tsx tests/unit/PickFeed.test.tsx tests/unit/UnifiedDraftRoom.liveShell.test.tsx tests/unit/unifiedDraftRoomDesignArchitecture.test.ts
```

Expected: pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: pass, or document unrelated existing failures with exact file and message.

- [ ] **Step 3: Browser verify draft room**

Use the local dev server at `http://localhost:3004/drafts/<draftId>` or create a fresh test draft with the existing helper route. Verify:

- scheduled draft shows top pick train shell and left rail defaults to `Queue`
- live draft shows left rail defaults to `Roster`
- manual rail choice persists through at least one pick update
- player rows show AFL club logos next to names
- player table primary metric says `Statly Z`, not `Fantasy avg`
- category chips/columns match the selected league categories
- pick train shows completed, current, upcoming, and user's next pick
- timer and on-clock team agree with the select button state
- right pick feed shows the latest pick after a pick is made
- mobile width keeps timer/player market usable and exposes pick feed through the mobile control

- [ ] **Step 4: Run council Decision 2**

Run:

```bash
npm run codex:council:logical -- --staged --prompt "Chairman Decision 2: decide whether this completed world-class draft room implementation should be committed."
```

Expected: `CHAIRMAN DECISION 2: COMMIT`.

- [ ] **Step 5: Commit through reviewed path**

Stage only intended implementation files. Do not stage `prisma/dev.db` or `.superpowers`.

Run:

```bash
npm run codex:commit:reviewed -- "feat: build consolidated draft room"
```

Expected: reviewed commit succeeds.

## Self-Review

Spec coverage:

- Top pick train: Task 3 refactors `LivePickHeader`; Task 6 keeps `UnifiedDraftRoom` rendering that canonical header.
- Left roster/queue/watchlist rail with phase defaults and persisted user choice: Task 4 and Task 6.
- Center player market with logos and cleaner stats: Task 2.
- Right pick feed/activity rail: Task 5 and Task 6.
- Dynamic league-selected `Statly Z`: Task 1 and Task 2.
- No parallel draft-room version: Task 6 updates `UnifiedDraftRoom` directly.
- Accessibility and browser verification: Tasks 2 through 7.

Placeholder scan:

- This plan intentionally avoids open-ended placeholders. Any implementation detail that can vary is constrained by an exact file, prop shape, helper signature, command, or expected behavior.

Type consistency:

- `statlyZScore`, `statlyZBreakdown`, and `statlyZMissingCategories` are introduced in `DraftPlayer` before being consumed by `PlayerGrid`.
- `DraftPickTrainState` is introduced in `draftUiMappers` before being consumed by `DraftPickTrain` and `LivePickHeader`.
- `DraftLeftRail` accepts rendered queue/watchlist panels, keeping existing handler ownership in `UnifiedDraftRoom`.
