# Typecheck Blockers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the three pre-existing repo-wide TypeScript blockers so `npm run typecheck:app` can progress past casing conflicts and the `PlayerDetail` nullable round mismatch.

**Architecture:** Keep the repair narrow and non-semantic. Standardize player and injury static data paths on the existing lowercase `src/data` directory, then normalize nullable round values at the UI boundary before passing data into chart/table helpers.

**Tech Stack:** Next.js App Router, TypeScript, React, Vitest, npm scripts, Git case-only rename workflow.

---

## File Structure

- Modify: `src/app/api/injuries/route.ts`
  - Responsibility: API route for injury scraping, cache fallback, and mock injury data fallback.
  - Change intent: Import mock injury data through the canonical lowercase alias path.

- Modify or case-rename: `src/data/mockInjuryData.ts`
  - Responsibility: Static mock injury fallback data.
  - Change intent: Ensure Git tracks this file only under lowercase `src/data/mockInjuryData.ts`.

- Modify: `src/lib/playerPositionMapping.ts`
  - Responsibility: Position lookup service backed by static AFL player data plus curated overrides.
  - Change intent: Import AFL players through the canonical lowercase alias path.

- Case-rename: `src/Data/aflPlayers.ts` to `src/data/aflPlayers.ts`
  - Responsibility: Static AFL player dataset.
  - Change intent: Ensure Git tracks this file only under lowercase `src/data/aflPlayers.ts`.

- Modify: `src/components/PlayerDetail.tsx`
  - Responsibility: Player detail UI, match history table, and chart data preparation.
  - Change intent: Convert `null` rounds to `undefined` before passing match data to `PlayerChart`, preserving current display behavior.

- Existing test: `src/lib/__tests__/playerPositionMapping.test.ts`
  - Responsibility: Coverage for exact mapped player positions.
  - Change intent: Re-run after the import/path change to prove the mapping module still loads.

---

## Task 1: Capture Baseline And Confirm The Exact Blockers

**Files:**
- Read: `package.json`
- Read: `tsconfig.app.json`
- Read: `tsconfig.base.json`
- Read: `src/app/api/injuries/route.ts`
- Read: `src/lib/playerPositionMapping.ts`
- Read: `src/components/PlayerDetail.tsx`

- [ ] **Step 1: Confirm the typecheck command**

Run:

```bash
node -e "const scripts=require('./package.json').scripts; console.log(scripts['typecheck:app']); console.log(scripts.typecheck);"
```

Expected output includes:

```text
npm run typegen:next && tsc -p tsconfig.app.json --noEmit
npm run typecheck:app && npm run typecheck:tests
```

- [ ] **Step 2: Capture the current TypeScript failures**

Run:

```bash
npm run typecheck:app
```

Expected: FAIL. Confirm the output includes these failures before editing:

```text
mockInjuryData.ts
aflPlayers.ts
PlayerDetail.tsx
```

- [ ] **Step 3: Capture Git's tracked casing for the data files**

Run:

```bash
git ls-files | rg '^(src|SRC)/(data|Data)/(mockInjuryData|aflPlayers)\.ts$'
```

Expected before the fix: at least one uppercase `src/Data/...` entry or a mismatch between the import path and tracked path. Current observed local output is:

```text
src/Data/aflPlayers.ts
src/data/mockInjuryData.ts
```

- [ ] **Step 4: Confirm the source imports**

Run:

```bash
rg "mockInjuryData|aflPlayers" src/app/api/injuries/route.ts src/lib/playerPositionMapping.ts
```

Expected before the fix:

```text
src/app/api/injuries/route.ts:import { mockInjuryData } from '../../../data/mockInjuryData';
src/lib/playerPositionMapping.ts:import aflPlayers from '../data/aflPlayers';
```

- [ ] **Step 5: Commit nothing**

Run:

```bash
git status --short
```

Expected: No files from this plan have been edited yet. Existing unrelated dirty files may appear and must not be reverted.

---

## Task 2: Canonicalize `mockInjuryData` To Lowercase `src/data`

**Files:**
- Modify: `src/app/api/injuries/route.ts`
- Possibly case-rename: `src/Data/mockInjuryData.ts` to `src/data/mockInjuryData.ts`
- Verify: `src/data/mockInjuryData.ts`

- [ ] **Step 1: Check whether Git tracks an uppercase mock injury file**

Run:

```bash
git ls-files | rg '^src/(data|Data)/mockInjuryData\.ts$'
```

Expected after this task is complete:

```text
src/data/mockInjuryData.ts
```

- [ ] **Step 2: If Git tracks `src/Data/mockInjuryData.ts`, record the case-only rename through a temporary filename**

Run only if Step 1 prints `src/Data/mockInjuryData.ts`:

```bash
git mv src/Data/mockInjuryData.ts src/data/mockInjuryData.casefix.ts
git mv src/data/mockInjuryData.casefix.ts src/data/mockInjuryData.ts
```

Expected: `git status --short` shows a rename ending at `src/data/mockInjuryData.ts`.

- [ ] **Step 3: Update the injury route import**

In `src/app/api/injuries/route.ts`, replace:

```ts
import { mockInjuryData } from '../../../data/mockInjuryData';
```

with:

```ts
import { mockInjuryData } from '@/data/mockInjuryData';
```

- [ ] **Step 4: Run the narrow TypeScript check for this import path**

Run:

```bash
npx tsc -p tsconfig.app.json --noEmit --pretty false
```

Expected: The mock injury casing error is gone. Other known failures may remain until later tasks.

- [ ] **Step 5: Review the diff for this task**

Run:

```bash
git diff -- src/app/api/injuries/route.ts src/data/mockInjuryData.ts src/Data/mockInjuryData.ts
```

Expected: Only the import path and any required case-only rename are present.

- [ ] **Step 6: Commit this task**

Run:

```bash
git add src/app/api/injuries/route.ts src/data/mockInjuryData.ts src/Data/mockInjuryData.ts
git commit -m "fix: canonicalize mock injury data path"
```

Expected: Commit succeeds. If `src/Data/mockInjuryData.ts` is not tracked, `git add` may report no such path; rerun with the two existing paths only:

```bash
git add src/app/api/injuries/route.ts src/data/mockInjuryData.ts
git commit -m "fix: canonicalize mock injury data path"
```

---

## Task 3: Canonicalize `aflPlayers` To Lowercase `src/data`

**Files:**
- Modify: `src/lib/playerPositionMapping.ts`
- Case-rename: `src/Data/aflPlayers.ts` to `src/data/aflPlayers.ts`
- Test: `src/lib/__tests__/playerPositionMapping.test.ts`

- [ ] **Step 1: Confirm the tracked AFL player file casing**

Run:

```bash
git ls-files | rg '^src/(data|Data)/aflPlayers\.ts$'
```

Expected before the fix in the current repo:

```text
src/Data/aflPlayers.ts
```

- [ ] **Step 2: Record the case-only rename through a temporary filename**

Run:

```bash
git mv src/Data/aflPlayers.ts src/data/aflPlayers.casefix.ts
git mv src/data/aflPlayers.casefix.ts src/data/aflPlayers.ts
```

Expected: `git status --short` shows a rename ending at `src/data/aflPlayers.ts`.

- [ ] **Step 3: Update the position mapping import**

In `src/lib/playerPositionMapping.ts`, replace:

```ts
import aflPlayers from '../data/aflPlayers';
```

with:

```ts
import aflPlayers from '@/data/aflPlayers';
```

- [ ] **Step 4: Run the focused position mapping test**

Run:

```bash
npx vitest run src/lib/__tests__/playerPositionMapping.test.ts
```

Expected: PASS. The test proves `src/lib/playerPositionMapping.ts` can import the canonical AFL player data file.

- [ ] **Step 5: Run the narrow TypeScript check**

Run:

```bash
npx tsc -p tsconfig.app.json --noEmit --pretty false
```

Expected: The AFL player casing error is gone. The `PlayerDetail.tsx` nullable round error may remain until Task 4.

- [ ] **Step 6: Review the diff for this task**

Run:

```bash
git diff -- src/lib/playerPositionMapping.ts src/data/aflPlayers.ts src/Data/aflPlayers.ts src/lib/__tests__/playerPositionMapping.test.ts
```

Expected: Only the import path and case-only rename are present. The test file should be unchanged unless the runner updated snapshots, which is not expected.

- [ ] **Step 7: Commit this task**

Run:

```bash
git add src/lib/playerPositionMapping.ts src/data/aflPlayers.ts src/Data/aflPlayers.ts
git commit -m "fix: canonicalize afl player data path"
```

Expected: Commit succeeds.

---

## Task 4: Normalize Nullable Rounds In `PlayerDetail`

**Files:**
- Modify: `src/components/PlayerDetail.tsx`
- Read: `src/components/PlayerChart.tsx`
- Read: `src/types/matchLogs.ts`

- [ ] **Step 1: Confirm the chart prop type**

Run:

```bash
sed -n '1,35p' src/components/PlayerChart.tsx
```

Expected output includes:

```ts
type MatchData = {
  round: number | undefined;
  value: number;
  opposition: string;
};
```

Note: this was the contract at the time of the original blocker fix. The follow-up nullable-stat durability work in `docs/superpowers/plans/2026-05-12-match-log-nullability.md` intentionally widens `PlayerChart` to `value: number | null`.

- [ ] **Step 2: Update chart data preparation to convert `null` rounds to `undefined`**

In `src/components/PlayerDetail.tsx`, replace the `round` assignment inside `chartData`:

```ts
        round: log.round,
```

with:

```ts
        round: log.round ?? undefined,
```

- [ ] **Step 3: Keep table display behavior explicitly nullable-safe**

In `src/components/PlayerDetail.tsx`, confirm this helper accepts both `null` and `undefined`:

```ts
const formatRoundNumber = (round: number | undefined | null): string => {
  if (round === undefined || round === null) return '—';
  if (round === 0) return 'Finals';
  return `R${round}`;
};
```

If the helper currently lacks `null`, update it to the exact code above.

- [ ] **Step 4: Run the narrow TypeScript check**

Run:

```bash
npx tsc -p tsconfig.app.json --noEmit --pretty false
```

Expected: The `src/components/PlayerDetail.tsx` error about `number | null | undefined` passed to `number | undefined` is gone.

- [ ] **Step 5: Review the diff for this task**

Run:

```bash
git diff -- src/components/PlayerDetail.tsx
```

Expected diff:

```diff
-        round: log.round,
+        round: log.round ?? undefined,
```

The `formatRoundNumber` helper may also show the `null` parameter widening if it was not already present.

- [ ] **Step 6: Commit this task**

Run:

```bash
git add src/components/PlayerDetail.tsx
git commit -m "fix: normalize nullable player match rounds"
```

Expected: Commit succeeds.

---

## Task 5: Verify Repo-Wide Typecheck Is Unblocked

**Files:**
- Verify: `src/app/api/injuries/route.ts`
- Verify: `src/lib/playerPositionMapping.ts`
- Verify: `src/data/mockInjuryData.ts`
- Verify: `src/data/aflPlayers.ts`
- Verify: `src/components/PlayerDetail.tsx`

- [ ] **Step 1: Confirm no uppercase data files remain tracked**

Run:

```bash
git ls-files | rg '^src/Data/'
```

Expected: no output.

- [ ] **Step 2: Confirm canonical imports**

Run:

```bash
rg "mockInjuryData|aflPlayers" src/app/api/injuries/route.ts src/lib/playerPositionMapping.ts
```

Expected output:

```text
src/app/api/injuries/route.ts:import { mockInjuryData } from '@/data/mockInjuryData';
src/lib/playerPositionMapping.ts:import aflPlayers from '@/data/aflPlayers';
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
npx vitest run src/lib/__tests__/playerPositionMapping.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run app typecheck**

Run:

```bash
npm run typecheck:app
```

Expected: PASS or fail only on errors outside the three blockers covered by this plan. If new failures appear, record exact file paths and confirm whether they are unrelated before expanding scope.

- [ ] **Step 5: Run full typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS or fail only on test-project errors outside the three blockers covered by this plan. If `typecheck:app` passes and `typecheck:tests` fails, keep the app blocker fix complete and create a separate plan for test-project failures.

- [ ] **Step 6: Review final diff**

Run:

```bash
git diff --stat HEAD~3..HEAD
git diff --check HEAD~3..HEAD
```

Expected: `git diff --check` reports no whitespace errors. The stat includes only the route import, mapping import, AFL player file case rename, optional mock injury file case rename, and `PlayerDetail.tsx` nullable round normalization.

---

## Self-Review

- Spec coverage: The plan covers all three named blockers: `mockInjuryData` casing, `aflPlayers` casing, and `PlayerDetail.tsx` nullable round type mismatch.
- Placeholder scan: The plan contains concrete files, exact commands, exact code replacements, expected outputs, and commit messages.
- Type consistency: The `PlayerChart` prop remains `number | undefined`; `PlayerDetail` converts `null` to `undefined` at the boundary instead of widening the child component contract.
- Scope control: No Footywire convergence contract, ETL, rebuild, rematerialization, or projection logic is changed.
