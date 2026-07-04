# Field Lineup Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-ready My Lineup experience where users can assign any roster player to any active lineup spot using an immersive AFL field board plus roster pool, with no position eligibility restrictions while position data is unreliable.

**Architecture:** Keep lineup integrity at the server boundary: roster ownership, duplicate prevention, slot validity, slot count limits, and locked-player checks remain in `lineupService`. Remove all position eligibility enforcement from backend and UI. Split the large lineup UI into focused helper utilities and presentational components: `LeagueLineupPanel` owns loading/saving state, `LineupRosterPool` owns available player display, and `LineupFieldBoard` owns the AFL field placement surface with native drag/drop plus click fallback.

**Tech Stack:** Next.js App Router, React client components, TypeScript, Prisma, Vitest unit/architecture tests, native HTML drag-and-drop, existing Statly league theme CSS variables.

---

## File Structure

### Modify Existing Files

- `src/server/leagues/lineupService.ts`
  - Responsibility: canonical server validation for lineup saves.
  - Change: remove position eligibility enforcement entirely while preserving roster, duplicate, lock, slot validity, slot index, and slot count validation.

- `tests/unit/lineupService.test.ts`
  - Responsibility: prove server lineup validation behavior.
  - Change: replace position-specific tests with “any roster player can occupy any lineup slot”.

- `src/components/league/matchups/LeagueLineupPanel.tsx`
  - Responsibility: orchestration only: fetch lineup payload, hold selected slot state, save to API, render roster pool plus field board.
  - Change: remove select-list-only layout and remove `canAssignToSlot`.

- `tests/unit/leagueMatchupsUiArchitecture.test.ts`
  - Responsibility: architecture guard for league Matchups/Lineup UI surfaces.
  - Change: assert field board, roster pool, drop zones, no position filtering, and save path.

### Create New Files

- `src/components/league/matchups/lineupBuilderTypes.ts`
  - Responsibility: shared client-side lineup builder types.

- `src/components/league/matchups/lineupBuilderUtils.ts`
  - Responsibility: pure helper functions for rows, assignments, availability, slot labels, and drag payload parsing.

- `src/components/league/matchups/LineupRosterPool.tsx`
  - Responsibility: polished roster list with draggable player cards and click-to-select fallback.

- `src/components/league/matchups/LineupFieldBoard.tsx`
  - Responsibility: polished AFL oval field with lineup spots/drop zones grouped by FWD/MID/RUC/DEF/UTIL and clear/remove actions.

- `tests/unit/lineupBuilderUtils.test.ts`
  - Responsibility: fast deterministic tests for lineup builder state transitions.

---

## Product Requirements

1. Position restrictions are removed everywhere for lineup setting.
2. Every unselected roster player can be placed into every unlocked lineup spot.
3. The lineup page has an immersive field layout, not a plain list of selects.
4. The roster list sits beside the field on desktop and above it on mobile.
5. Users can drag a player onto a spot.
6. Users can click a roster player then click a field spot as a non-drag fallback.
7. Users can clear a filled spot.
8. Duplicate player selection is prevented in the UI and still rejected on the server.
9. Save uses the existing `PATCH /api/leagues/[id]/lineups/[round]` endpoint.
10. Match Centre player contribution tables continue to read from saved lineup data.
11. Admin scoring controls do not reappear on Matchups or My Lineup.
12. No new dependency is added.

---

### Task 1: Remove Backend Position Restrictions

**Files:**
- Modify: `src/server/leagues/lineupService.ts`
- Modify: `tests/unit/lineupService.test.ts`

- [ ] **Step 1: Write the failing backend validation test**

Replace the current position eligibility tests in `tests/unit/lineupService.test.ts` with this behavior:

```ts
import { describe, expect, it } from 'vitest';

import {
  canAssignPlayerToSlot,
  isLineupPlayerLocked,
  validateLineupSubmission,
} from '@/server/leagues/lineupService';
import { DEFAULT_ACTIVE_LINEUP_SLOTS } from '@/server/leagues/lineupSettings';

describe('lineup service', () => {
  it('allows any roster player position into any active or bench slot while positions are unreliable', () => {
    expect(canAssignPlayerToSlot('DEF', 'MID')).toBe(true);
    expect(canAssignPlayerToSlot('MID', 'FWD')).toBe(true);
    expect(canAssignPlayerToSlot('RUC', 'DEF')).toBe(true);
    expect(canAssignPlayerToSlot('FWD', 'RUC')).toBe(true);
    expect(canAssignPlayerToSlot(null, 'MID')).toBe(true);
    expect(canAssignPlayerToSlot(undefined, 'FWD')).toBe(true);
    expect(canAssignPlayerToSlot('', 'RUC')).toBe(true);
    expect(canAssignPlayerToSlot('UNKNOWN', 'UTIL')).toBe(true);
    expect(canAssignPlayerToSlot('UNKNOWN', 'BENCH')).toBe(true);
  });

  it('locks a player once their AFL game has started', () => {
    const now = new Date('2026-07-04T10:10:00.000Z');
    expect(isLineupPlayerLocked(new Date('2026-07-04T10:00:00.000Z'), now)).toBe(true);
    expect(isLineupPlayerLocked(new Date('2026-07-04T10:30:00.000Z'), now)).toBe(false);
  });

  it('rejects duplicate players and non-roster players while allowing any roster position', () => {
    const result = validateLineupSubmission({
      now: new Date('2026-07-04T10:00:00.000Z'),
      lineupSlots: DEFAULT_ACTIVE_LINEUP_SLOTS,
      rosterPlayers: [
        { playerId: 'p1', position: 'DEF' },
        { playerId: 'p2', position: 'FWD' },
      ],
      existingLockedPlayers: [],
      submittedPlayers: [
        { playerId: 'p1', slot: 'MID', slotIndex: 0 },
        { playerId: 'p1', slot: 'DEF', slotIndex: 0 },
        { playerId: 'p3', slot: 'FWD', slotIndex: 0 },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('duplicate'),
        expect.stringContaining('roster'),
      ])
    );
    expect(result.errors).not.toEqual(expect.arrayContaining([expect.stringContaining('eligible')]));
  });

  it('rejects active slot indexes outside configured slot counts', () => {
    const result = validateLineupSubmission({
      now: new Date('2026-07-04T10:00:00.000Z'),
      lineupSlots: DEFAULT_ACTIVE_LINEUP_SLOTS,
      rosterPlayers: [{ playerId: 'p1', position: 'DEF' }],
      existingLockedPlayers: [],
      submittedPlayers: [{ playerId: 'p1', slot: 'RUC', slotIndex: 99 }],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('exceeds the configured lineup count')])
    );
  });
});
```

- [ ] **Step 2: Run the backend validation test and confirm it fails**

Run:

```bash
npm run test:unit -- --coverage=false tests/unit/lineupService.test.ts
```

Expected: FAIL because `canAssignPlayerToSlot('DEF', 'MID')` currently returns `false`, and validation still emits an `eligible` error.

- [ ] **Step 3: Replace `canAssignPlayerToSlot` with no-position-restriction implementation**

In `src/server/leagues/lineupService.ts`, remove `ActiveLineupSlot` from the type import and replace `normalizePosition` plus `canAssignPlayerToSlot` with:

```ts
export function canAssignPlayerToSlot(
  _playerPosition: string | null | undefined,
  slot: LeagueLineupSlot
): boolean {
  return LINEUP_SLOTS.has(slot);
}
```

The top import should become:

```ts
import type { LeagueLineupSlot, LineupSlotSettings } from './scoringTypes';
```

Do not remove this validation block from `validateLineupSubmission`:

```ts
if (!canAssignPlayerToSlot(rosterPlayer.position, player.slot)) {
  errors.push(`Player ${player.playerId} is not eligible for ${player.slot}.`);
}
```

It becomes a defensive guard against unsupported slot values and stays harmless because slot validity is already checked.

- [ ] **Step 4: Run the backend validation test and confirm it passes**

Run:

```bash
npm run test:unit -- --coverage=false tests/unit/lineupService.test.ts
```

Expected: PASS with 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/leagues/lineupService.ts tests/unit/lineupService.test.ts
git commit -m "fix: relax lineup position eligibility"
```

---

### Task 2: Add Lineup Builder Types And Pure Helpers

**Files:**
- Create: `src/components/league/matchups/lineupBuilderTypes.ts`
- Create: `src/components/league/matchups/lineupBuilderUtils.ts`
- Create: `tests/unit/lineupBuilderUtils.test.ts`

- [ ] **Step 1: Create shared lineup builder types**

Create `src/components/league/matchups/lineupBuilderTypes.ts`:

```ts
export interface LineupPlayer {
  id?: string;
  playerId: string;
  slot: string;
  slotIndex: number;
  lockedAt?: string | null;
  player?: { name?: string; position?: string };
}

export interface RosterPlayerOption {
  playerId: string;
  name: string;
  position?: string | null;
  club?: string | null;
}

export interface LineupSlots {
  FWD: number;
  DEF: number;
  MID: number;
  RUC: number;
  UTIL: number;
}

export interface LineupSlotRow {
  playerId: string;
  slot: keyof LineupSlots;
  slotIndex: number;
  lockedAt?: string | null;
}

export interface DraggedLineupPlayer {
  playerId: string;
}
```

- [ ] **Step 2: Write pure helper tests**

Create `tests/unit/lineupBuilderUtils.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  assignPlayerToSlot,
  buildEmptyLineupRows,
  getAvailableRosterPlayers,
  getDragPlayerId,
  getRosterPlayerLabel,
  normalizeLineupSlots,
  removePlayerFromSlot,
  toSavePayload,
} from '@/components/league/matchups/lineupBuilderUtils';

describe('lineup builder utils', () => {
  it('normalizes lineup slots with Statly defaults', () => {
    expect(normalizeLineupSlots(undefined)).toEqual({
      FWD: 5,
      DEF: 5,
      MID: 5,
      RUC: 1,
      UTIL: 3,
    });
    expect(normalizeLineupSlots({ FWD: 2, DEF: 3, MID: 4, RUC: 1, UTIL: 2 })).toEqual({
      FWD: 2,
      DEF: 3,
      MID: 4,
      RUC: 1,
      UTIL: 2,
    });
  });

  it('builds ordered empty lineup rows from slot counts', () => {
    expect(buildEmptyLineupRows({ FWD: 1, DEF: 1, MID: 1, RUC: 1, UTIL: 1 })).toEqual([
      { playerId: '', slot: 'FWD', slotIndex: 0 },
      { playerId: '', slot: 'MID', slotIndex: 0 },
      { playerId: '', slot: 'RUC', slotIndex: 0 },
      { playerId: '', slot: 'DEF', slotIndex: 0 },
      { playerId: '', slot: 'UTIL', slotIndex: 0 },
    ]);
  });

  it('assigns a player to a target slot and removes the player from any previous slot', () => {
    const rows = buildEmptyLineupRows({ FWD: 1, DEF: 1, MID: 1, RUC: 1, UTIL: 1 });
    const first = assignPlayerToSlot(rows, 'p1', 'FWD', 0);
    const second = assignPlayerToSlot(first, 'p1', 'MID', 0);

    expect(second.find((row) => row.slot === 'FWD')?.playerId).toBe('');
    expect(second.find((row) => row.slot === 'MID')?.playerId).toBe('p1');
  });

  it('does not replace locked slots', () => {
    const rows = [{ playerId: 'locked-player', slot: 'FWD' as const, slotIndex: 0, lockedAt: '2026-07-04T00:00:00.000Z' }];
    expect(assignPlayerToSlot(rows, 'p2', 'FWD', 0)).toEqual(rows);
  });

  it('returns only unselected roster players as available', () => {
    const roster = [
      { playerId: 'p1', name: 'One', position: 'DEF', club: 'ADE' },
      { playerId: 'p2', name: 'Two', position: null, club: 'CAR' },
    ];
    const rows = [{ playerId: 'p1', slot: 'FWD' as const, slotIndex: 0 }];

    expect(getAvailableRosterPlayers(roster, rows).map((player) => player.playerId)).toEqual(['p2']);
  });

  it('removes a player from a slot', () => {
    const rows = [{ playerId: 'p1', slot: 'FWD' as const, slotIndex: 0 }];
    expect(removePlayerFromSlot(rows, 'FWD', 0)).toEqual([{ playerId: '', slot: 'FWD', slotIndex: 0 }]);
  });

  it('serializes only filled rows for saving', () => {
    const rows = [
      { playerId: 'p1', slot: 'FWD' as const, slotIndex: 0 },
      { playerId: '', slot: 'MID' as const, slotIndex: 0 },
    ];
    expect(toSavePayload(rows)).toEqual([{ playerId: 'p1', slot: 'FWD', slotIndex: 0 }]);
  });

  it('formats roster labels without requiring position data', () => {
    expect(getRosterPlayerLabel({ playerId: 'p1', name: 'A Player', position: null, club: 'ADE' })).toBe('A Player - ADE');
    expect(getRosterPlayerLabel({ playerId: 'p2', name: 'B Player', position: 'MID', club: null })).toBe('B Player - MID');
  });

  it('parses drag payload safely', () => {
    const dataTransfer = {
      getData: (type: string) => (type === 'application/x-statly-lineup-player' ? '{"playerId":"p1"}' : ''),
    } as DataTransfer;
    expect(getDragPlayerId(dataTransfer)).toBe('p1');
  });
});
```

- [ ] **Step 3: Run helper tests and confirm they fail**

Run:

```bash
npm run test:unit -- --coverage=false tests/unit/lineupBuilderUtils.test.ts
```

Expected: FAIL because `lineupBuilderUtils.ts` does not exist.

- [ ] **Step 4: Create helper implementation**

Create `src/components/league/matchups/lineupBuilderUtils.ts`:

```ts
import type {
  DraggedLineupPlayer,
  LineupPlayer,
  LineupSlotRow,
  LineupSlots,
  RosterPlayerOption,
} from './lineupBuilderTypes';

export const ACTIVE_SLOT_ORDER: Array<keyof LineupSlots> = ['FWD', 'MID', 'RUC', 'DEF', 'UTIL'];

export const DEFAULT_LINEUP_SLOTS: LineupSlots = {
  FWD: 5,
  DEF: 5,
  MID: 5,
  RUC: 1,
  UTIL: 3,
};

export const LINEUP_DRAG_MIME = 'application/x-statly-lineup-player';

export function normalizeLineupSlots(value: unknown): LineupSlots {
  if (!value || typeof value !== 'object') return DEFAULT_LINEUP_SLOTS;
  const source = value as Partial<Record<keyof LineupSlots, unknown>>;

  return ACTIVE_SLOT_ORDER.reduce<LineupSlots>(
    (slots, slot) => ({
      ...slots,
      [slot]:
        typeof source[slot] === 'number' && Number.isInteger(source[slot]) && source[slot]! > 0
          ? source[slot]!
          : DEFAULT_LINEUP_SLOTS[slot],
    }),
    { ...DEFAULT_LINEUP_SLOTS }
  );
}

export function buildEmptyLineupRows(slots: LineupSlots): LineupSlotRow[] {
  return ACTIVE_SLOT_ORDER.flatMap((slot) =>
    Array.from({ length: slots[slot] }, (_, slotIndex) => ({
      playerId: '',
      slot,
      slotIndex,
    }))
  );
}

export function mergeSavedLineupRows(
  emptyRows: LineupSlotRow[],
  savedPlayers: LineupPlayer[]
): LineupSlotRow[] {
  const savedBySlot = new Map(
    savedPlayers.map((player) => [`${player.slot}:${player.slotIndex}`, player])
  );

  return emptyRows.map((row) => {
    const savedPlayer = savedBySlot.get(`${row.slot}:${row.slotIndex}`);
    return savedPlayer
      ? {
          playerId: savedPlayer.playerId,
          slot: row.slot,
          slotIndex: row.slotIndex,
          lockedAt: savedPlayer.lockedAt,
        }
      : row;
  });
}

export function assignPlayerToSlot(
  rows: LineupSlotRow[],
  playerId: string,
  slot: keyof LineupSlots,
  slotIndex: number
): LineupSlotRow[] {
  return rows.map((row) => {
    const isTarget = row.slot === slot && row.slotIndex === slotIndex;
    if (isTarget && row.lockedAt) return row;
    if (isTarget) return { ...row, playerId };
    if (row.playerId === playerId && !row.lockedAt) return { ...row, playerId: '' };
    return row;
  });
}

export function removePlayerFromSlot(
  rows: LineupSlotRow[],
  slot: keyof LineupSlots,
  slotIndex: number
): LineupSlotRow[] {
  return rows.map((row) =>
    row.slot === slot && row.slotIndex === slotIndex && !row.lockedAt ? { ...row, playerId: '' } : row
  );
}

export function getSelectedPlayerIds(rows: LineupSlotRow[]): Set<string> {
  return new Set(rows.map((row) => row.playerId).filter(Boolean));
}

export function getAvailableRosterPlayers(
  rosterPlayers: RosterPlayerOption[],
  rows: LineupSlotRow[]
): RosterPlayerOption[] {
  const selected = getSelectedPlayerIds(rows);
  return rosterPlayers.filter((player) => !selected.has(player.playerId));
}

export function getRosterPlayerLabel(player: RosterPlayerOption): string {
  const meta = [player.position, player.club].filter(Boolean).join(', ');
  return meta ? `${player.name} - ${meta}` : player.name;
}

export function getRosterPlayerById(
  rosterPlayers: RosterPlayerOption[],
  playerId: string
): RosterPlayerOption | undefined {
  return rosterPlayers.find((player) => player.playerId === playerId);
}

export function setDragPlayer(dataTransfer: DataTransfer, playerId: string): void {
  const payload: DraggedLineupPlayer = { playerId };
  dataTransfer.setData(LINEUP_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.effectAllowed = 'move';
}

export function getDragPlayerId(dataTransfer: DataTransfer): string | null {
  try {
    const raw = dataTransfer.getData(LINEUP_DRAG_MIME);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DraggedLineupPlayer>;
    return typeof parsed.playerId === 'string' && parsed.playerId ? parsed.playerId : null;
  } catch {
    return null;
  }
}

export function toSavePayload(rows: LineupSlotRow[]): Array<{
  playerId: string;
  slot: keyof LineupSlots;
  slotIndex: number;
}> {
  return rows
    .filter((row) => row.playerId)
    .map((row) => ({
      playerId: row.playerId,
      slot: row.slot,
      slotIndex: row.slotIndex,
    }));
}
```

- [ ] **Step 5: Run helper tests and confirm they pass**

Run:

```bash
npm run test:unit -- --coverage=false tests/unit/lineupBuilderUtils.test.ts
```

Expected: PASS with 9 tests.

- [ ] **Step 6: Commit**

```bash
git add src/components/league/matchups/lineupBuilderTypes.ts src/components/league/matchups/lineupBuilderUtils.ts tests/unit/lineupBuilderUtils.test.ts
git commit -m "feat: add lineup builder utilities"
```

---

### Task 3: Build Roster Pool Component

**Files:**
- Create: `src/components/league/matchups/LineupRosterPool.tsx`
- Modify: `tests/unit/leagueMatchupsUiArchitecture.test.ts`

- [ ] **Step 1: Add architecture assertions for roster pool**

In `tests/unit/leagueMatchupsUiArchitecture.test.ts`, add:

```ts
const rosterPool = readRepoFile('src/components/league/matchups/LineupRosterPool.tsx');

expect(rosterPool).toContain('draggable');
expect(rosterPool).toContain('setDragPlayer');
expect(rosterPool).toContain('onSelectPlayer');
expect(rosterPool).toContain('Available players');
expect(rosterPool).not.toContain('canAssignToSlot');
expect(rosterPool).not.toContain('position ===');
```

Keep the existing `lineupPanel` assertions, but replace `expect(lineupPanel).toContain('canAssignToSlot');` with:

```ts
expect(lineupPanel).not.toContain('canAssignToSlot');
expect(lineupPanel).toContain('LineupRosterPool');
```

- [ ] **Step 2: Run architecture test and confirm it fails**

Run:

```bash
npm run test:unit -- --coverage=false tests/unit/leagueMatchupsUiArchitecture.test.ts
```

Expected: FAIL because `LineupRosterPool.tsx` does not exist and `LeagueLineupPanel` still contains `canAssignToSlot`.

- [ ] **Step 3: Create roster pool component**

Create `src/components/league/matchups/LineupRosterPool.tsx`:

```tsx
'use client';

import type { RosterPlayerOption } from './lineupBuilderTypes';
import { getRosterPlayerLabel, setDragPlayer } from './lineupBuilderUtils';

interface LineupRosterPoolProps {
  players: RosterPlayerOption[];
  selectedPlayerId: string | null;
  onSelectPlayer: (playerId: string) => void;
}

export function LineupRosterPool({
  players,
  selectedPlayerId,
  onSelectPlayer,
}: LineupRosterPoolProps) {
  return (
    <aside
      className="rounded-xl border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-4"
      aria-labelledby="lineup-roster-pool-heading"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="lineup-roster-pool-heading" className="text-sm font-semibold text-[color:var(--league-text)]">
            Available players
          </h3>
          <p className="mt-1 text-xs leading-5 text-[color:var(--league-text-muted)]">
            Drag a player onto the field or select one, then choose a spot.
          </p>
        </div>
        <span className="rounded-full bg-[color:var(--league-primary-soft)] px-2.5 py-1 text-xs font-semibold text-[color:var(--league-primary)]">
          {players.length}
        </span>
      </div>

      <div className="mt-4 grid max-h-[34rem] gap-2 overflow-y-auto pr-1">
        {players.length ? (
          players.map((player) => {
            const selected = selectedPlayerId === player.playerId;
            return (
              <button
                key={player.playerId}
                type="button"
                draggable
                onClick={() => onSelectPlayer(player.playerId)}
                onDragStart={(event) => setDragPlayer(event.dataTransfer, player.playerId)}
                className={`rounded-lg border p-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] ${
                  selected
                    ? 'border-[color:var(--league-primary)] bg-[color:var(--league-primary-soft)]'
                    : 'border-[color:var(--league-border)] bg-[color:var(--league-page)] hover:bg-[color:var(--league-surface-muted)]'
                }`}
                aria-pressed={selected}
              >
                <span className="block truncate text-sm font-semibold text-[color:var(--league-text)]">
                  {player.name}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[color:var(--league-text-muted)]">
                  {player.position ? (
                    <span className="rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-2 py-0.5 font-semibold text-[color:var(--league-text)]">
                      {player.position}
                    </span>
                  ) : (
                    <span className="rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-2 py-0.5 font-semibold text-[color:var(--league-text-muted)]">
                      Position pending
                    </span>
                  )}
                  {player.club ? <span>{player.club}</span> : null}
                </span>
                <span className="sr-only">{getRosterPlayerLabel(player)}</span>
              </button>
            );
          })
        ) : (
          <div className="rounded-lg border border-dashed border-[color:var(--league-border)] p-4 text-sm text-[color:var(--league-text-muted)]">
            Every roster player is currently placed on the field.
          </div>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Run architecture test and confirm roster pool assertions pass once integrated in Task 5**

Run:

```bash
npm run test:unit -- --coverage=false tests/unit/leagueMatchupsUiArchitecture.test.ts
```

Expected now: FAIL until `LeagueLineupPanel` imports and renders `LineupRosterPool`.

- [ ] **Step 5: Commit**

```bash
git add src/components/league/matchups/LineupRosterPool.tsx tests/unit/leagueMatchupsUiArchitecture.test.ts
git commit -m "feat: add lineup roster pool"
```

---

### Task 4: Build AFL Field Board Component

**Files:**
- Create: `src/components/league/matchups/LineupFieldBoard.tsx`
- Modify: `tests/unit/leagueMatchupsUiArchitecture.test.ts`

- [ ] **Step 1: Add architecture assertions for field board**

In `tests/unit/leagueMatchupsUiArchitecture.test.ts`, add:

```ts
const fieldBoard = readRepoFile('src/components/league/matchups/LineupFieldBoard.tsx');

expect(fieldBoard).toContain('AFL field');
expect(fieldBoard).toContain('onDrop');
expect(fieldBoard).toContain('getDragPlayerId');
expect(fieldBoard).toContain('selectedPlayerId');
expect(fieldBoard).toContain('Assign selected player');
expect(fieldBoard).toContain('Clear');
expect(fieldBoard).toContain('FWD');
expect(fieldBoard).toContain('MID');
expect(fieldBoard).toContain('DEF');
expect(fieldBoard).toContain('RUC');
expect(fieldBoard).toContain('UTIL');
```

Add these panel assertions:

```ts
expect(lineupPanel).toContain('LineupFieldBoard');
expect(lineupPanel).toContain('assignPlayerToSlot');
expect(lineupPanel).toContain('removePlayerFromSlot');
```

- [ ] **Step 2: Run architecture test and confirm it fails**

Run:

```bash
npm run test:unit -- --coverage=false tests/unit/leagueMatchupsUiArchitecture.test.ts
```

Expected: FAIL because `LineupFieldBoard.tsx` does not exist.

- [ ] **Step 3: Create field board component**

Create `src/components/league/matchups/LineupFieldBoard.tsx`:

```tsx
'use client';

import type { LineupSlotRow, LineupSlots, RosterPlayerOption } from './lineupBuilderTypes';
import { getDragPlayerId, getRosterPlayerById } from './lineupBuilderUtils';

interface LineupFieldBoardProps {
  rows: LineupSlotRow[];
  rosterPlayers: RosterPlayerOption[];
  selectedPlayerId: string | null;
  onAssignPlayer: (playerId: string, slot: keyof LineupSlots, slotIndex: number) => void;
  onRemovePlayer: (slot: keyof LineupSlots, slotIndex: number) => void;
}

const FIELD_GROUPS: Array<{
  slot: keyof LineupSlots;
  label: string;
  className: string;
}> = [
  { slot: 'FWD', label: 'Forward line', className: 'top-[12%] left-1/2 -translate-x-1/2' },
  { slot: 'MID', label: 'Midfield', className: 'top-[38%] left-1/2 -translate-x-1/2' },
  { slot: 'RUC', label: 'Ruck', className: 'top-[50%] left-1/2 -translate-x-1/2' },
  { slot: 'DEF', label: 'Defensive line', className: 'bottom-[16%] left-1/2 -translate-x-1/2' },
  { slot: 'UTIL', label: 'Utility', className: 'top-[64%] left-1/2 -translate-x-1/2' },
];

export function LineupFieldBoard({
  rows,
  rosterPlayers,
  selectedPlayerId,
  onAssignPlayer,
  onRemovePlayer,
}: LineupFieldBoardProps) {
  return (
    <section
      className="rounded-xl border border-[color:var(--league-border)] bg-[linear-gradient(180deg,#f7fbf3_0%,#eef7e9_100%)] p-4"
      aria-labelledby="lineup-field-heading"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="lineup-field-heading" className="text-sm font-semibold text-[color:var(--league-text)]">
            AFL field
          </h3>
          <p className="mt-1 text-xs leading-5 text-[color:var(--league-text-muted)]">
            Drop players onto spots, or select a player from the list and click a spot.
          </p>
        </div>
        {selectedPlayerId ? (
          <span className="rounded-full bg-[color:var(--league-primary-soft)] px-3 py-1 text-xs font-semibold text-[color:var(--league-primary)]">
            Assign selected player
          </span>
        ) : null}
      </div>

      <div className="relative mt-4 min-h-[46rem] overflow-hidden rounded-[46%] border-4 border-white bg-[repeating-linear-gradient(180deg,#67a83b_0,#67a83b_44px,#5f9f35_44px,#5f9f35_88px)] shadow-inner ring-1 ring-[color:var(--league-border)]">
        <div className="absolute left-[8%] right-[8%] top-[8%] h-[84%] rounded-[46%] border-2 border-white/90" />
        <div className="absolute left-1/2 top-[45%] h-28 w-36 -translate-x-1/2 rounded-sm border-2 border-white/90" />
        <div className="absolute left-1/2 top-[51%] h-12 w-12 -translate-x-1/2 rounded-full border-2 border-white/90" />
        <div className="absolute left-[18%] right-[18%] top-[22%] h-24 rounded-b-[50%] border-b-4 border-blue-500" />
        <div className="absolute bottom-[22%] left-[18%] right-[18%] h-24 rounded-t-[50%] border-t-4 border-red-500" />

        {FIELD_GROUPS.map((group) => {
          const groupRows = rows.filter((row) => row.slot === group.slot);
          return (
            <div key={group.slot} className={`absolute z-10 w-[82%] ${group.className}`}>
              <div className="mb-2 text-center text-[11px] font-bold uppercase tracking-wide text-white drop-shadow">
                {group.label}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {groupRows.map((row) => (
                  <LineupFieldSpot
                    key={`${row.slot}:${row.slotIndex}`}
                    row={row}
                    rosterPlayers={rosterPlayers}
                    selectedPlayerId={selectedPlayerId}
                    onAssignPlayer={onAssignPlayer}
                    onRemovePlayer={onRemovePlayer}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function LineupFieldSpot({
  row,
  rosterPlayers,
  selectedPlayerId,
  onAssignPlayer,
  onRemovePlayer,
}: {
  row: LineupSlotRow;
  rosterPlayers: RosterPlayerOption[];
  selectedPlayerId: string | null;
  onAssignPlayer: (playerId: string, slot: keyof LineupSlots, slotIndex: number) => void;
  onRemovePlayer: (slot: keyof LineupSlots, slotIndex: number) => void;
}) {
  const player = row.playerId ? getRosterPlayerById(rosterPlayers, row.playerId) : undefined;
  const locked = Boolean(row.lockedAt);

  return (
    <button
      type="button"
      onClick={() => {
        if (selectedPlayerId && !locked) onAssignPlayer(selectedPlayerId, row.slot, row.slotIndex);
      }}
      onDragOver={(event) => {
        if (!locked) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (locked) return;
        const playerId = getDragPlayerId(event.dataTransfer);
        if (playerId) onAssignPlayer(playerId, row.slot, row.slotIndex);
      }}
      className={`min-h-20 rounded-xl border p-2 text-center shadow-sm backdrop-blur transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white ${
        player
          ? 'border-white/80 bg-white/90 text-[color:var(--league-text)]'
          : 'border-white/70 bg-white/35 text-white hover:bg-white/50'
      } ${locked ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}
      aria-label={`${row.slot} ${row.slotIndex + 1}${player ? ` assigned to ${player.name}` : ' empty'}`}
    >
      <span className="block text-[11px] font-bold uppercase tracking-wide">
        {row.slot} {row.slotIndex + 1}
      </span>
      <span className="mt-1 block truncate text-sm font-semibold">
        {player?.name ?? 'Drop player'}
      </span>
      <span className="mt-1 block text-[11px]">
        {locked ? 'Locked' : player ? [player.position, player.club].filter(Boolean).join(' / ') : 'Available'}
      </span>
      {player && !locked ? (
        <span
          role="button"
          tabIndex={0}
          onClick={(event) => {
            event.stopPropagation();
            onRemovePlayer(row.slot, row.slotIndex);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.stopPropagation();
              onRemovePlayer(row.slot, row.slotIndex);
            }
          }}
          className="mt-2 inline-flex rounded-full border border-[color:var(--league-border)] bg-white px-2 py-0.5 text-[11px] font-semibold text-[color:var(--league-text-muted)]"
        >
          Clear
        </span>
      ) : null}
    </button>
  );
}
```

- [ ] **Step 4: Run architecture test and confirm it fails until panel integration**

Run:

```bash
npm run test:unit -- --coverage=false tests/unit/leagueMatchupsUiArchitecture.test.ts
```

Expected now: FAIL until `LeagueLineupPanel` imports and renders `LineupFieldBoard`.

- [ ] **Step 5: Commit**

```bash
git add src/components/league/matchups/LineupFieldBoard.tsx tests/unit/leagueMatchupsUiArchitecture.test.ts
git commit -m "feat: add AFL lineup field board"
```

---

### Task 5: Integrate Field Builder Into My Lineup

**Files:**
- Modify: `src/components/league/matchups/LeagueLineupPanel.tsx`
- Modify: `tests/unit/leagueMatchupsUiArchitecture.test.ts`

- [ ] **Step 1: Replace old panel implementation with orchestration component**

Replace the contents of `src/components/league/matchups/LeagueLineupPanel.tsx` with:

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';

import { authenticatedFetch } from '@/lib/authenticatedFetch';

import { LineupFieldBoard } from './LineupFieldBoard';
import { LineupRosterPool } from './LineupRosterPool';
import type { LineupPlayer, LineupSlotRow, RosterPlayerOption } from './lineupBuilderTypes';
import {
  assignPlayerToSlot,
  buildEmptyLineupRows,
  getAvailableRosterPlayers,
  mergeSavedLineupRows,
  normalizeLineupSlots,
  removePlayerFromSlot,
  toSavePayload,
} from './lineupBuilderUtils';

interface LeagueLineupPanelProps {
  leagueId: string;
  currentUserId?: string;
}

interface LineupPayload {
  players?: LineupPlayer[];
  rosterPlayers?: RosterPlayerOption[];
  lineupSlots?: unknown;
}

export function LeagueLineupPanel({ leagueId, currentUserId }: LeagueLineupPanelProps) {
  const [rows, setRows] = useState<LineupSlotRow[]>([]);
  const [rosterPlayers, setRosterPlayers] = useState<RosterPlayerOption[]>([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const round = 1;

  async function loadLineup() {
    setIsLoading(true);
    setMessage(null);
    try {
      const response = await authenticatedFetch(
        `/api/leagues/${leagueId}/lineups/${round}`,
        {},
        currentUserId
      );
      const payload = (await response.json()) as { success?: boolean; data?: LineupPayload; error?: string };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? 'Failed to load lineup.');
      }

      const nextSlots = normalizeLineupSlots(payload.data?.lineupSlots);
      const savedPlayers = Array.isArray(payload.data?.players) ? payload.data.players : [];
      const emptyRows = buildEmptyLineupRows(nextSlots);

      setRosterPlayers(Array.isArray(payload.data?.rosterPlayers) ? payload.data.rosterPlayers : []);
      setRows(mergeSavedLineupRows(emptyRows, savedPlayers));
      setSelectedPlayerId(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load lineup.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadLineup();
  }, [leagueId, currentUserId]);

  const availablePlayers = useMemo(
    () => getAvailableRosterPlayers(rosterPlayers, rows),
    [rosterPlayers, rows]
  );

  function handleAssignPlayer(playerId: string, slot: LineupSlotRow['slot'], slotIndex: number) {
    setRows((current) => assignPlayerToSlot(current, playerId, slot, slotIndex));
    setSelectedPlayerId(null);
  }

  function handleRemovePlayer(slot: LineupSlotRow['slot'], slotIndex: number) {
    setRows((current) => removePlayerFromSlot(current, slot, slotIndex));
  }

  async function saveLineup() {
    setIsSaving(true);
    setMessage(null);
    try {
      const response = await authenticatedFetch(
        `/api/leagues/${leagueId}/lineups/${round}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ players: toSavePayload(rows) }),
        },
        currentUserId
      );
      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
        details?: string[];
      };
      if (!response.ok || !payload.success) {
        throw new Error(payload.details?.join(', ') ?? payload.error ?? 'Failed to save lineup.');
      }
      await loadLineup();
      setMessage('Lineup saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save lineup.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="space-y-4" aria-labelledby="league-lineup-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2
            id="league-lineup-heading"
            className="text-xl font-semibold text-[color:var(--league-text)]"
          >
            My Lineup
          </h2>
          <p className="mt-1 text-sm text-[color:var(--league-text-muted)]">
            Place roster players onto the AFL field for the current round.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void saveLineup()}
          disabled={isSaving || isLoading}
          className="rounded-md bg-[color:var(--league-primary)] px-4 py-2 text-sm font-semibold text-[color:var(--league-primary-foreground)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? 'Saving...' : 'Save lineup'}
        </button>
      </div>

      {message && (
        <div className="rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-3 text-sm text-[color:var(--league-text)]">
          {message}
        </div>
      )}

      {isLoading ? (
        <div className="rounded-lg border border-[color:var(--league-border)] p-4">
          Loading lineup
        </div>
      ) : rosterPlayers.length ? (
        <div className="grid gap-4 xl:grid-cols-[20rem_minmax(0,1fr)]">
          <LineupRosterPool
            players={availablePlayers}
            selectedPlayerId={selectedPlayerId}
            onSelectPlayer={setSelectedPlayerId}
          />
          <LineupFieldBoard
            rows={rows}
            rosterPlayers={rosterPlayers}
            selectedPlayerId={selectedPlayerId}
            onAssignPlayer={handleAssignPlayer}
            onRemovePlayer={handleRemovePlayer}
          />
        </div>
      ) : (
        <div className="rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-4 text-sm text-[color:var(--league-text-muted)]">
          No roster players are available to set a lineup yet.
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Run focused UI architecture test and confirm it passes**

Run:

```bash
npm run test:unit -- --coverage=false tests/unit/leagueMatchupsUiArchitecture.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run TypeScript check and fix any type errors exactly at the component boundary**

Run:

```bash
npm run typecheck:app
```

Expected: PASS.

If TypeScript complains about `payload.details`, replace the `payload` type in `saveLineup` with:

```ts
const payload = (await response.json()) as {
  success?: boolean;
  error?: string;
  details?: string[];
};
```

- [ ] **Step 4: Commit**

```bash
git add src/components/league/matchups/LeagueLineupPanel.tsx tests/unit/leagueMatchupsUiArchitecture.test.ts
git commit -m "feat: integrate field lineup builder"
```

---

### Task 6: Link Match Centre Empty Lineup State To My Lineup

**Files:**
- Modify: `src/components/league/matchups/LeagueMatchupsPanel.tsx`
- Modify: `tests/unit/leagueMatchupsUiArchitecture.test.ts`

- [ ] **Step 1: Add failing architecture assertions for Set Lineup guidance**

In `tests/unit/leagueMatchupsUiArchitecture.test.ts`, add:

```ts
expect(matchupsPanel).toContain('Set your lineup');
expect(matchupsPanel).toContain('My Lineup');
expect(matchupsPanel).toContain('No active lineup players are set for this matchup');
```

- [ ] **Step 2: Run architecture test and confirm it fails**

Run:

```bash
npm run test:unit -- --coverage=false tests/unit/leagueMatchupsUiArchitecture.test.ts
```

Expected: FAIL because the Match Centre still only says `No active lineup players set for this matchup.`

- [ ] **Step 3: Replace the empty table state**

In `src/components/league/matchups/LeagueMatchupsPanel.tsx`, find the `if (!rows)` branch in `MirroredPlayerMatchupTable` and replace it with:

```tsx
if (!rows) {
  return (
    <div className="rounded-md border border-dashed border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-5 text-center">
      <h3 className="text-base font-semibold text-[color:var(--league-text)]">Set your lineup</h3>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[color:var(--league-text-muted)]">
        No active lineup players are set for this matchup. Open the My Lineup tab, place your roster
        players onto the field, then save to populate this Match Centre.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run architecture test and confirm it passes**

Run:

```bash
npm run test:unit -- --coverage=false tests/unit/leagueMatchupsUiArchitecture.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/league/matchups/LeagueMatchupsPanel.tsx tests/unit/leagueMatchupsUiArchitecture.test.ts
git commit -m "feat: guide empty match centre to lineup builder"
```

---

### Task 7: Full Verification And Production Readiness

**Files:**
- Verify: all files changed in Tasks 1-6

- [ ] **Step 1: Run focused unit and architecture tests**

Run:

```bash
npm run test:unit -- --coverage=false tests/unit/lineupService.test.ts tests/unit/lineupBuilderUtils.test.ts tests/unit/leagueMatchupsUiArchitecture.test.ts tests/unit/matchupReadModel.test.ts
```

Expected: PASS. Expected test files: 4. Expected tests: at least 15.

- [ ] **Step 2: Run app typecheck**

Run:

```bash
npm run typecheck:app
```

Expected: PASS with `tsc -p tsconfig.app.json --noEmit`.

- [ ] **Step 3: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: no output and exit code 0.

- [ ] **Step 4: Confirm dev server responds**

Run:

```bash
curl -I --max-time 10 http://localhost:3000
```

Expected: `HTTP/1.1 200 OK`.

- [ ] **Step 5: Manual browser smoke test**

Open:

```text
http://localhost:3000
```

Manual checks:

1. Sign in with local seeded user if prompted.
2. Open a league.
3. Open `My Lineup`.
4. Confirm the roster pool is visible.
5. Confirm the AFL field is visible.
6. Drag a roster player onto a field spot.
7. Select another roster player, then click a different field spot.
8. Clear one placed player.
9. Save lineup.
10. Confirm the success message says `Lineup saved.`
11. Open `Matchups`.
12. Confirm the player contribution table is populated for saved active lineup players.
13. Confirm `Recalculate` and `Finalize` do not appear in Matchups.

- [ ] **Step 6: Commit final verification-only adjustments if any**

If Tasks 1-6 were committed as written and no final fixes were needed, do not create an empty commit.

If verification required fixes, commit only those fixes:

```bash
git status --short
git add src/server/leagues/lineupService.ts src/components/league/matchups/LeagueLineupPanel.tsx src/components/league/matchups/LineupFieldBoard.tsx src/components/league/matchups/LineupRosterPool.tsx src/components/league/matchups/lineupBuilderTypes.ts src/components/league/matchups/lineupBuilderUtils.ts tests/unit/lineupService.test.ts tests/unit/lineupBuilderUtils.test.ts tests/unit/leagueMatchupsUiArchitecture.test.ts
git commit -m "fix: polish field lineup builder"
```

---

## Rollback Plan

If the field builder causes a severe runtime issue, revert only the UI integration while keeping the backend no-position enforcement if the user still needs lineup saves unblocked:

```bash
git log --oneline -- src/components/league/matchups/LeagueLineupPanel.tsx src/components/league/matchups/LineupFieldBoard.tsx src/components/league/matchups/LineupRosterPool.tsx
git revert "$(git log --format=%H --grep='feat: integrate field lineup builder' -n 1)"
```

Do not revert unrelated fixture generation or Match Centre scoring commits. Do not revert `prisma/dev.db`.

---

## Self-Review

### Spec Coverage

- Remove position restrictions: Task 1 removes backend position eligibility and Task 5 removes UI filtering.
- Players not showing if they do not match position: Task 5 uses `availablePlayers` only by selected/not-selected status, not position.
- Player list on one side: Task 3 creates `LineupRosterPool`; Task 5 renders it in the left column on desktop.
- Drag and drop onto a field: Task 4 creates native drag/drop field spots; Task 5 wires assignment.
- More polished and immersive field: Task 4 creates an oval AFL field with arcs, goal-square-like markings, and grouped field spots.
- Player spots visible: Task 4 renders every configured lineup row as a field spot.
- Easy placement: Task 4 supports drop and click; Task 5 clears selected player after assignment.
- Production ready: Task 7 includes tests, typecheck, whitespace check, dev server, and browser smoke path.
- Match Centre linked up: Task 6 adds guidance and Task 7 verifies saved lineup appears in Matchups.

### Placeholder Scan

The plan contains concrete file paths, code, commands, and expected outcomes. The scan did not find unresolved planning markers or vague implementation instructions.

### Type Consistency

Types are consistent across tasks:

- `LineupSlotRow.slot` uses `keyof LineupSlots`.
- `RosterPlayerOption.playerId` matches API payload field.
- `assignPlayerToSlot`, `removePlayerFromSlot`, and `toSavePayload` are defined before `LeagueLineupPanel` imports them.
- `LineupFieldBoard` and `LineupRosterPool` props match the integration in Task 5.
