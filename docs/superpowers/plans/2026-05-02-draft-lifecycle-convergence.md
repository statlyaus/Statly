# Draft Lifecycle Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make league draft setup converge reliably from saved settings and draft slots to a CTA-ready draft room, including schedules already inside or past the lobby window.

**Architecture:** League-backed drafts should have one setup contract before lock: `LeagueSettings` plus contiguous `LeagueMember.draftSlot`s. Every route that mutates that contract must call one sync/finalization flow that provisions the single `Draft`, rebuilds `DraftOrder`, updates queue/reminders, and starts overdue drafts through `DraftApplicationService.startDraft`. UI should consume the returned draft lifecycle summary and show a clear join/recovery CTA.

**Tech Stack:** Next.js route handlers, Prisma, BullMQ draft queue, Vitest, React client components with existing league design tokens.

---

## Current Invariant

For league-backed drafts, `LeagueSettings + LeagueMember.draftSlot` are the only editable draft setup contract before lock. A successful mutation of that contract must converge these downstream artifacts:

- `Draft` row
- `DraftOrder` rows
- queue jobs for lobby/start or immediate start
- reminders
- observable draft lifecycle status
- UI state that can show either `Join Draft Room` or a specific blocking reason

Draft start must only happen through `DraftApplicationService.startDraft`, never by direct `Draft.status = LIVE` updates.

## Files And Responsibilities

- Modify `src/server/draft/services/LeagueDraftProvisioningService.ts`
  - Own draft provisioning from league settings and draft slots.
  - Return a richer draft lifecycle result that tells routes/UI whether the draft is ready, blocked, started, or locked.
- Modify `src/server/draft/services/DraftApplicationService.ts`
  - Keep `startDraft`, `startDraftIfOverdue`, and `openScheduledLobby` as the only lifecycle transition authority.
- Modify `src/server/queue/draftQueue.ts`
  - Keep scheduling primitives, including zero-delay immediate start, covered by tests.
- Modify `src/app/api/leagues/[id]/route.ts`
  - Continue syncing after league setup draft-field changes.
- Modify `src/app/api/leagues/[id]/draft-settings/route.ts`
  - Sync/provision after draft settings writes, matching `PUT /api/leagues/[id]`.
- Modify `src/app/api/leagues/[id]/members/route.ts`
  - Sync or reject after member draft-slot/member-set changes according to lock policy.
- Modify `src/app/api/leagues/[id]/draft/route.ts`
  - Return CTA-ready draft lifecycle status and start overdue existing drafts.
- Modify `src/app/api/drafts/[id]/schedule/route.ts`
  - Remove direct `LIVE` mutation; use `DraftApplicationService.startDraft`.
- Modify `src/components/league/LeagueTabs.tsx`
  - Align setup copy and consume richer provisioning result for settings-save feedback.
- Modify `src/components/league/DraftManager.tsx`
  - Show join CTA, blocked reason, or recovery CTA deterministically.
- Add or extend tests:
  - `src/server/draft/services/LeagueDraftProvisioningService.test.ts`
  - `src/server/draft/services/DraftApplicationService.test.ts`
  - `src/server/queue/draftQueue.test.ts`
  - `src/app/api/leagues/[id]/draft-settings/route.test.ts`
  - `src/app/api/leagues/[id]/route.test.ts`
  - `src/app/api/leagues/[id]/members/route.test.ts`
  - `src/app/api/drafts/[id]/schedule/route.test.ts`
- Modify `docs/runtime-contract.md`
  - Document worker/Redis requirements and the request-driven fallback.

---

### Task 1: Server Sync Contract

**Files:**
- Modify: `src/server/draft/services/LeagueDraftProvisioningService.ts`
- Test: `src/server/draft/services/LeagueDraftProvisioningService.test.ts`

- [ ] **Step 1: Write failing tests for sync outcomes**

Add coverage for:

```ts
it('creates a draft for an overdue saved schedule and reports immediate start required', async () => {});
it('updates a scheduled draft order and keeps the same draft id', async () => {});
it('returns draft_order_incomplete for missing or duplicate draft slots', async () => {});
it('returns existing_draft_locked for live drafts without resetting them', async () => {});
```

Run:

```bash
npx vitest run src/server/draft/services/LeagueDraftProvisioningService.test.ts
```

Expected: new tests fail before implementation.

- [ ] **Step 2: Extend provisioning result shape**

Add fields to `LeagueDraftProvisioningResult`:

```ts
type LeagueDraftProvisioningLifecycle = 'blocked' | 'scheduled' | 'immediate_start_required' | 'locked';
```

The service should return `lifecycle: 'immediate_start_required'` when `startAt - PRE_START_DELAY_MS <= now`.

- [ ] **Step 3: Keep provisioning idempotent**

Ensure scheduled drafts are created or reset exactly once, `DraftOrder` is rebuilt from sorted slots, and non-scheduled drafts return locked without mutation.

- [ ] **Step 4: Verify**

Run:

```bash
npx vitest run src/server/draft/services/LeagueDraftProvisioningService.test.ts
```

Expected: all provisioning tests pass.

---

### Task 2: Deterministic Overdue Start

**Files:**
- Modify: `src/app/api/leagues/[id]/draft/route.ts`
- Modify: `src/app/api/leagues/[id]/route.ts`
- Modify: `src/app/api/leagues/[id]/draft-settings/route.ts`
- Modify: `src/app/api/leagues/[id]/members/route.ts`
- Test: route tests for these paths

- [ ] **Step 1: Write failing route tests**

Cover this behavior:

```ts
it('PUT draft-settings provisions and starts an overdue valid draft setup', async () => {});
it('PUT league setup provisions and starts an overdue valid draft setup', async () => {});
it('reorderDraftSlots provisions and returns a CTA-ready draft summary', async () => {});
```

Run:

```bash
npx vitest run src/app/api/leagues/[id]/draft-settings/route.test.ts src/app/api/leagues/[id]/route.test.ts src/app/api/leagues/[id]/members/route.test.ts
```

Expected: tests fail where routes do not sync/start.

- [ ] **Step 2: Add route-level finalization helper**

Create a local helper or service method used by league draft setup routes:

```ts
async function finalizeProvisionedDraft(provisioning: LeagueDraftProvisioningResult) {
  if (provisioning.lifecycle !== 'immediate_start_required' || !provisioning.draft?.id) {
    return provisioning;
  }

  const startResult = await draftApplicationService.startDraftIfOverdue({
    draftId: provisioning.draft.id,
  });

  if (startResult) {
    await draftRealtimePublisher.publishCommandResult(startResult);
  }

  return provisioning;
}
```

Use the real final type and avoid duplicating this helper across routes if it grows beyond one route file.

- [ ] **Step 3: Make `PUT /draft-settings` sync**

After `leagueApplicationService.updateDraftSettings`, call `leagueDraftProvisioningService.syncFromLeagueSettings(id)`, then finalize overdue start, and include `draftProvisioning` in the response.

- [ ] **Step 4: Make member/order mutations consistent**

For `reorderDraftSlots`, keep provisioning. For `updateMember` with `draftSlot`, `joinLeague`, and `removeMember`, either:

- reprovision while the draft is `SCHEDULED`, or
- reject once the draft is locked/live.

Use the same response shape for any mutation that syncs draft setup.

- [ ] **Step 5: Verify**

Run:

```bash
npx vitest run src/app/api/leagues/[id]/draft-settings/route.test.ts src/app/api/leagues/[id]/route.test.ts src/app/api/leagues/[id]/members/route.test.ts
```

Expected: tests pass and route responses include draft ids when prerequisites are valid.

---

### Task 3: Remove Lifecycle Bypasses

**Files:**
- Modify: `src/app/api/drafts/[id]/schedule/route.ts`
- Audit: `src/app/api/drafts/route.ts`
- Test: `src/app/api/drafts/[id]/schedule/route.test.ts`

- [ ] **Step 1: Write failing tests for schedule start**

Cover:

```ts
it('starts a draft schedule through DraftApplicationService instead of direct LIVE update', async () => {});
it('preserves pick deadline and scheduling version when starting immediately', async () => {});
```

Run:

```bash
npx vitest run src/app/api/drafts/[id]/schedule/route.test.ts
```

Expected: tests fail because the route directly updates the draft.

- [ ] **Step 2: Replace direct live mutation**

Change schedule deletion/immediate-start behavior to call:

```ts
const result = await draftApplicationService.startDraft({ draftId: id });
await draftRealtimePublisher.publishCommandResult(result);
```

Handle already-live drafts idempotently with the existing `startDraftIfOverdue` behavior if needed.

- [ ] **Step 3: Document generic route policy**

Add an inline comment or route guard for league-backed drafts explaining that generic `/api/drafts` schedule mutation must not bypass the league setup contract.

- [ ] **Step 4: Verify**

Run:

```bash
npx vitest run src/app/api/drafts/[id]/schedule/route.test.ts src/server/draft/services/DraftApplicationService.test.ts
```

Expected: tests pass.

---

### Task 4: UI CTA And Blocking Reasons

**Files:**
- Modify: `src/components/league/LeagueTabs.tsx`
- Modify: `src/components/league/DraftManager.tsx`
- Test: `src/components/league/LeagueTabs.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Cover:

```tsx
it('shows a join draft room CTA when settings save returns draftProvisioning.draft', async () => {});
it('shows a specific blocked reason when prerequisites are satisfied but no draft exists', async () => {});
it('does not tell users to create a room manually when provisioning is automatic', () => {});
```

Run:

```bash
npx vitest run src/components/league/LeagueTabs.test.tsx
```

Expected: tests fail on missing CTA/state copy.

- [ ] **Step 2: Consume richer provisioning result**

In `LeagueTabs`, parse `payload.data.draftProvisioning.draft` and store enough state or trigger callback state so the Draft tab can show a CTA without requiring manual refresh.

- [ ] **Step 3: Add blocked/recovery state in `DraftManager`**

When schedule exists, order is saved, member count is valid, but no draft exists, show an accessible `aria-live="polite"` message with the blocking reason and one action:

```tsx
<button type="button" onClick={() => void refreshDraftStatus()}>
  Refresh Draft Status
</button>
```

If the server exposes a safe prepare action, use `Prepare Draft Room` as the primary action.

- [ ] **Step 4: Align copy**

Replace “create the draft room” with “prepare the draft room automatically” in Settings and Draft tab copy.

- [ ] **Step 5: Verify**

Run:

```bash
npx vitest run src/components/league/LeagueTabs.test.tsx
```

Expected: UI tests pass and text remains token-based with existing design conventions.

---

### Task 5: Tests, Worker Contract, And Diagnostics

**Files:**
- Modify: `src/server/queue/draftQueue.test.ts`
- Modify: `src/server/draft/services/DraftApplicationService.test.ts`
- Create: `src/server/workers/enhancedDraftWorker.test.ts`
- Modify: `docs/runtime-contract.md`
- Optional modify: `package.json`

- [ ] **Step 1: Expand queue tests**

Cover scheduled lobby job, too-soon lobby error, future start rejection without `immediateStart`, and job id cleanup.

Run:

```bash
npx vitest run src/server/queue/draftQueue.test.ts
```

- [ ] **Step 2: Expand application service lifecycle tests**

Cover:

```ts
it('startDraftIfOverdue starts overdue scheduled drafts with orders', async () => {});
it('startDraftIfOverdue returns null for future schedules', async () => {});
it('startDraftIfOverdue returns null when draft order is missing', async () => {});
it('openScheduledLobby transitions scheduled drafts to countdown', async () => {});
it('openScheduledLobby is idempotent for countdown and live drafts', async () => {});
```

Run:

```bash
npx vitest run src/server/draft/services/DraftApplicationService.test.ts
```

- [ ] **Step 3: Add worker processor tests**

Mock worker inputs and cover:

```ts
it('opens lobby and enqueues start for draft:start-lobby', async () => {});
it('starts scheduled draft for draft:start', async () => {});
it('skips missing or non-scheduled drafts', async () => {});
it('skips stale or early pick-expiry jobs', async () => {});
```

Run:

```bash
npx vitest run src/server/workers/enhancedDraftWorker.test.ts
```

- [ ] **Step 4: Update runtime contract**

Document:

- Redis is required for scheduled lifecycle jobs.
- Local scheduled drafts require `npm run worker:dev` or a full stack script.
- GET draft routes provide a request-driven overdue-start fallback, but workers remain the primary scheduler.
- Production needs an explicit draft worker entrypoint; do not confuse it with web-vitals worker scripts.

- [ ] **Step 5: Verify broader lifecycle scope**

Run:

```bash
npm run typecheck:tests
npx vitest run src/server/draft src/server/queue src/server/workers src/app/api/drafts src/app/api/leagues/[id]
```

Expected: typecheck and focused lifecycle suites pass.

---

## Subagent Task Assignments

### Server Lifecycle Agent

Owns Tasks 1, 2, and 3 server-side changes.

Scope:

- `src/server/draft/services/LeagueDraftProvisioningService.ts`
- `src/server/draft/services/DraftApplicationService.ts`
- `src/app/api/leagues/[id]/route.ts`
- `src/app/api/leagues/[id]/draft-settings/route.ts`
- `src/app/api/leagues/[id]/members/route.ts`
- `src/app/api/leagues/[id]/draft/route.ts`
- `src/app/api/drafts/[id]/schedule/route.ts`

Constraints:

- Do not direct-update `Draft.status = LIVE`.
- Do not add a second draft setup contract.
- Preserve lock behavior for non-scheduled drafts.
- Return draft ids/statuses in route responses when a room is ready.

### UI Agent

Owns Task 4.

Scope:

- `src/components/league/LeagueTabs.tsx`
- `src/components/league/DraftManager.tsx`
- `src/components/league/LeagueTabs.test.tsx`

Constraints:

- Use existing league design tokens and components.
- Preserve keyboard access and accessible names.
- Do not introduce new dependencies.
- Do not make users infer why `Join Draft Room` is hidden.

### Test And Operations Agent

Owns Task 5.

Scope:

- `src/server/queue/draftQueue.test.ts`
- `src/server/draft/services/DraftApplicationService.test.ts`
- `src/server/workers/enhancedDraftWorker.test.ts`
- `docs/runtime-contract.md`
- optionally `package.json` if adding a clear draft worker script

Constraints:

- Prefer focused Vitest tests with mocked queue/Prisma/worker boundaries.
- Do not require Redis for unit tests.
- Document the worker requirement explicitly.

---

## Verification Checklist

- Valid overdue setup produces a `Draft` row.
- The same request path starts an overdue draft or returns a draft that a GET immediately promotes.
- Draft order is rebuilt from contiguous `draftSlot`s.
- Non-scheduled drafts are not reset by settings/member mutations.
- UI shows `Join Draft Room` when `draftProvisioning.draft` exists.
- UI shows a specific blocking reason when no draft exists.
- Worker and request-driven fallback are both tested.
- Runtime docs explain which local/prod processes must be running.
