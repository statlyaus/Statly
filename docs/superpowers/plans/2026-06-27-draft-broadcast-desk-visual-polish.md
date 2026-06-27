# Draft Broadcast Desk Visual Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved Broadcast Desk visual direction to the active draft room without changing draft mechanics, realtime state, queue behavior, or backend contracts.

**Architecture:** Add a small set of draft broadcast CSS tokens and apply them only to the live draft-room shell/chrome: page background, live clock/header, pick train, left rail wrapper, and pick-feed wrapper. Keep `PlayerGrid` on the existing readable card/table surface so the stat table stays scannable. Update guardrail tests to lock the active runtime surface and prevent a return to the clunky light-card shell.

**Tech Stack:** Next.js App Router, React client components, Tailwind utility classes, CSS variables in `src/index.css`, Vitest source guardrail tests.

---

### Task 1: Add Broadcast Desk Theme Tokens

**Files:**

- Modify: `src/index.css`

- [ ] **Step 1: Add draft broadcast CSS variables under `:root`**

Add tokens for page, panel, elevated panel, borders, muted text, accent red, completed green, and upcoming yellow:

```css
--draft-broadcast-page: #05070b;
--draft-broadcast-panel: #0e141f;
--draft-broadcast-panel-strong: #111827;
--draft-broadcast-border: #273244;
--draft-broadcast-text: #f8fafc;
--draft-broadcast-muted: #94a3b8;
--draft-broadcast-red: #dc2626;
--draft-broadcast-red-soft: rgba(220, 38, 38, 0.16);
--draft-broadcast-green: #14783a;
--draft-broadcast-yellow: #facc15;
--draft-broadcast-yellow-text: #422006;
```

- [ ] **Step 2: Run formatting/check**

Run:

```bash
npx prettier --write src/index.css
```

Expected: CSS formats without changing unrelated tokens.

### Task 2: Apply Shell And Rail Chrome

**Files:**

- Modify: `src/components/draft/UnifiedDraftRoom.tsx`
- Test: `tests/unit/unifiedDraftRoomDesignArchitecture.test.ts`
- Test: `tests/unit/DraftRoomLayout.test.ts`

- [ ] **Step 1: Update tests for the broadcast shell**

In `unifiedDraftRoomDesignArchitecture.test.ts`, expect:

```ts
expect(roomSource).toContain('bg-[color:var(--draft-broadcast-page)]');
expect(roomSource).toContain('text-[color:var(--draft-broadcast-text)]');
expect(roomSource).toContain('border-[color:var(--draft-broadcast-border)]');
expect(roomSource).toContain('bg-[color:var(--draft-broadcast-panel)]');
```

Keep the existing composition assertions for `DraftLeftRail`, `PlayerGrid`, `DraftQueue`, `DraftWatchlist`, and `PickFeed`.

- [ ] **Step 2: Update the active draft shell classes**

Change the active room root from plain `bg-background text-foreground` to:

```tsx
<div className="min-h-screen bg-[color:var(--draft-broadcast-page)] text-[color:var(--draft-broadcast-text)]">
```

Change the live status summary card and desktop pick-feed wrapper to broadcast panel classes. Keep `PlayerGrid` unchanged.

- [ ] **Step 3: Run layout tests**

Run:

```bash
npm run test:unit -- unifiedDraftRoomDesignArchitecture DraftRoomLayout
```

Expected: both test files pass.

### Task 3: Strengthen Live Header And Pick Train

**Files:**

- Modify: `src/components/LivePickHeader.tsx`
- Modify: `src/components/draft/DraftPickTrain.tsx`
- Test: `tests/unit/LivePickHeader.a11y.test.tsx`
- Test: `tests/unit/DraftPickTrain.test.tsx`

- [ ] **Step 1: Update `LivePickHeader` visual chrome only**

Make the live clock card a broadcast panel, use stronger red for urgent/current pick, and keep the existing timer state logic unchanged.

- [ ] **Step 2: Update `DraftPickTrain` state colors**

Use broadcast tokens for current, completed, and user-upcoming pick cards. Keep status labels, icons, and slot data unchanged.

- [ ] **Step 3: Run targeted tests**

Run:

```bash
npm run test:unit -- LivePickHeader.a11y DraftPickTrain
```

Expected: tests pass and accessibility labels remain intact.

### Task 4: Final Verification

**Files:**

- All changed files

- [ ] **Step 1: Run targeted lint and typecheck**

Run:

```bash
npx eslint src/index.css src/components/draft/UnifiedDraftRoom.tsx src/components/LivePickHeader.tsx src/components/draft/DraftPickTrain.tsx tests/unit/unifiedDraftRoomDesignArchitecture.test.ts tests/unit/DraftRoomLayout.test.ts
npm run typecheck -- --pretty false
git diff --check
```

Expected: all pass.

- [ ] **Step 2: Browser verification**

Load an authenticated draft route if the current browser session permits it. If the draft route is still auth-blocked, document the auth limitation and rely on targeted tests/source guards for the visual shell changes.

- [ ] **Step 3: Closeout**

Report changed files, checks run, active runtime surface audit, deployment surface, and residual risk.
