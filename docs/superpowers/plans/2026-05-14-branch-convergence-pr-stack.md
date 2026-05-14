# Branch Convergence PR Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the current broad merge branch into reviewable long-term slices, starting with portable repo hygiene and bounded Footywire import/rematerialization convergence.

**Architecture:** Keep canonical player-match semantics in the Firestore raw contract and make import repair refresh bounded Prisma read models, then publish rankings and roster summaries from that refreshed contract. Keep shadcn/UI migration separate from data convergence so backend contract review and product-surface review can happen independently.

**Tech Stack:** Next.js App Router, TypeScript, Firebase Admin Firestore, Prisma read models, Vitest, npm scripts, Tailwind/shadcn-style open components for later UI slices.

---

## Goal Assessment

The branch goal is to make Statly production-ready by converging player data around canonical Footywire raw documents, rebuilding serving read models, and improving app/API/UI reliability. That goal is correct, but the branch currently mixes independent concerns into one very large diff.

The long-term solution is a PR stack:

1. Foundation hygiene/tooling.
2. Footywire import and bounded rematerialization.
3. Read-model API consumer convergence.
4. shadcn/design-system UI migration.
5. Architecture and operations docs.

This plan implements the first two slices only. The later slices should not start until these pass review because UI and docs should describe a stable data path.

## Shortcomings Being Addressed

- Local artifacts and machine-specific files must not be staged.
- Tooling paths must work on case-sensitive CI filesystems.
- Omitted import rounds must repair every importable round from the authoritative Footywire fixture list, not only rounds already present in Firestore.
- Import/rematerialization changes need targeted tests and typecheck before any PR split.
- Successful non-dry-run imports must not return success while app-facing ranking or roster projections remain dirty.
- shadcn UI migration must stay separated from canonical data repair.

## File Map

Foundation hygiene/tooling:

- Modify: `.gitignore`
- Modify: `package.json`
- Modify: `tests/dependency-sweep.test.ts`
- Verify: `Scripts/dependency-sweep.mjs`

Core Footywire import/rematerialization:

- Modify: `src/app/api/etl/import-rounds/route.ts`
- Modify: `src/app/api/etl/import-rounds/route.test.ts`
- Modify: `src/lib/footywireImporter.ts`

Final verification:

- Run: `npx vitest run tests/dependency-sweep.test.ts src/app/api/etl/import-rounds/route.test.ts`
- Run: `npm run typecheck`
- Run: `npm run deps:report:fixtures`
- Run: `git diff --check`
- Run: `npm run graphify:update`

## Task 1: Foundation Hygiene And Tooling

**Invariant enforced:** The PR must not depend on local machine state and must run on case-sensitive CI.

**Files:**
- Modify: `.gitignore`
- Modify: `package.json`
- Modify: `tests/dependency-sweep.test.ts`
- Verify: `Scripts/dependency-sweep.mjs`

- [ ] **Step 1: Verify local-only artifacts are ignored**

Run:

```bash
git status --short --untracked-files=all | rg '^(\\?\\? (--json|tmp/|\\.codex/hooks\\.json))' || true
```

Expected: no output. If output appears, add exact ignore entries for those local-only paths.

- [ ] **Step 2: Ensure dependency sweep paths use the tracked `Scripts/` directory**

Expected content in `package.json`:

```json
"deps:report": "node Scripts/dependency-sweep.mjs",
"deps:report:fixtures": "node Scripts/dependency-sweep.mjs --fixtures",
"deps:report:file": "node Scripts/dependency-sweep.mjs > dependency-sweep-report.md"
```

Expected import and spawn path in `tests/dependency-sweep.test.ts`:

```ts
} from '../Scripts/dependency-sweep.mjs';

const result = spawnSync(process.execPath, ['Scripts/dependency-sweep.mjs', '--fixtures'], {
  cwd: process.cwd(),
  encoding: 'utf8',
});
```

- [ ] **Step 3: Run dependency sweep fixture verification**

Run:

```bash
npm run deps:report:fixtures
```

Expected:
- Exit code `0`.
- Output contains `# Dependency Sweep Report`.
- Output contains `| root | openai | 5.20.2 | 5.21.0 | review |`.

## Task 2: Footywire Import Round Resolution

**Invariant enforced:** A repair request with omitted rounds covers all importable season rounds from the authoritative Footywire fixture list, including rounds absent from raw Firestore persistence.

**Files:**
- Modify: `src/app/api/etl/import-rounds/route.ts`
- Modify: `src/app/api/etl/import-rounds/route.test.ts`
- Modify: `src/lib/footywireImporter.ts`

- [ ] **Step 1: Add or preserve the failing test case**

The omitted-rounds test in `src/app/api/etl/import-rounds/route.test.ts` must mock `listFootywireImportableRounds({ season: 2026 })` to return `[1, 2, 3, 4]`.

Expected assertion:

```ts
expect(listFootywireImportableRoundsMock).toHaveBeenCalledWith({ season: 2026 });
expect(body.result.rounds).toEqual([1, 2, 3, 4]);
```

This proves omitted repair scope is no longer derived from possibly incomplete Firestore raw state.

- [ ] **Step 2: Implement authoritative fixture-based round resolution**

`src/lib/footywireImporter.ts` must export:

```ts
export async function listFootywireImportableRounds(options: {
  season: number;
  liveMatches?: LiveScoreboardMatch[];
}): Promise<number[]> {
  const fixtureHtml = await fetchFootywireHtml(`ft_match_list?year=${options.season}`);
  const fixtureRows = parseFixtureRows(
    fixtureHtml,
    options.season,
    new Set(Array.from({ length: 41 }, (_, round) => round)),
    options.liveMatches ?? []
  );

  return Array.from(
    new Set(
      fixtureRows
        .filter((row) => row.status !== 'scheduled')
        .map((row) => row.roundNumber)
        .filter((round) => Number.isInteger(round) && round >= 0)
    )
  ).sort((a, b) => a - b);
}
```

`src/app/api/etl/import-rounds/route.ts` must call this helper when the request omits `rounds`. Do not query Firestore to infer omitted repair scope.

- [ ] **Step 3: Run the import route test**

Run:

```bash
npx vitest run src/app/api/etl/import-rounds/route.test.ts
```

Expected:
- 4 tests pass.
- The omitted-rounds test fails if the old short-circuit is restored.

## Task 3: App-Facing Projection Publication

**Invariant enforced:** A successful non-dry-run import completes the existing read-model refresh and app-facing publication sequence for rankings and roster summaries.

**Files:**
- Modify: `src/app/api/etl/import-rounds/route.ts`
- Modify: `src/app/api/etl/import-rounds/route.test.ts`

- [ ] **Step 1: Publish after bounded refresh**

After metadata and advanced stat imports complete, the route must:

1. call `refreshPlayerReadModels({ season, rounds })`
2. call `publishPlayerRankings({ season })`
3. call `publishLeagueRosterSummaries({ season })`

Expected audit output:

```ts
rematerialization: {
  refreshedPlayerIds,
  refreshedRounds,
  rankingSnapshots,
  rosterSummaries,
  rankingsDirty: false,
  rostersDirty,
  published,
}
```

- [ ] **Step 2: Preserve dry-run safety**

When `dryRun` is true, the route may import in dry-run mode but must not refresh or publish read models.

## Task 4: Integration Verification

**Invariant enforced:** The first PR slices are independently reviewable and do not regress type safety or whitespace.

**Files:**
- Verify only.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npx vitest run tests/dependency-sweep.test.ts src/app/api/etl/import-rounds/route.test.ts
```

Expected:
- 2 test files pass.
- 10 tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected:
- `next typegen` completes.
- `tsc -p tsconfig.app.json --noEmit` passes.
- `tsc -p tsconfig.test.json --noEmit` passes.

- [ ] **Step 3: Run whitespace and graph verification**

Run:

```bash
git diff --check
npm run graphify:update
```

Expected:
- `git diff --check` exits `0`.
- `graphify update` rebuilds `graphify-out/GRAPH_REPORT.md`.

## Later PR Boundaries

Do not mix these into the first two PR slices:

- Read-model API convergence beyond import route publication.
- shadcn UI surface migration.
- broad `STATLY_DESIGN_SYSTEM.md` rewrite.
- ClickHouse/web-vitals persistence.
- Prisma migration archival.

For the shadcn/UI PR, use existing `src/components/ui/*`, `cn`, semantic tokens from `src/index.css`, lucide icons, and the repo's `components.json` New York/RSC conventions. Avoid raw controls when a shadcn-style primitive exists, avoid nested cards, and keep loading/error/empty states explicit.

## Self-Review

- Spec coverage: this plan covers the agreed first implementation slice and explicitly defers API/UI/docs slices.
- Placeholder scan: no `TBD`, vague future implementation instructions, or unnamed files remain.
- Type consistency: function and script names match existing repo paths.
