# Read Model API Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move player-facing API routes onto Prisma read models derived from canonical Firestore raw player-match documents.

**Architecture:** Keep Firestore raw documents as the semantic source and Prisma as the serving projection. API routes should call read-model services instead of reconstructing stats from legacy Firestore fields or route-local fallback readers.

**Tech Stack:** Next.js App Router route handlers, TypeScript, Prisma, Firebase Admin read-model builders, Vitest.

---

## Scope

This PR must not include UI styling changes, dependency governance, ClickHouse telemetry, or broad docs rewrites.

## Files

- Modify: `src/app/api/players/route.ts`
- Modify: `src/app/api/players/route.test.ts`
- Modify: `src/app/api/players/[id]/route.ts`
- Modify: `src/app/api/players/[id]/route.test.ts`
- Modify: `src/app/api/players/[id]/stats/route.ts`
- Modify: `src/app/api/players/[id]/stats/route.test.ts`
- Modify: `src/app/api/players/[id]/matches/route.ts`
- Modify: `src/app/api/players/[id]/matches/route.test.ts`
- Modify: `src/app/api/rankings/route.ts`
- Modify: `src/app/api/rankings/route.test.ts`
- Create or modify: `src/server/players/playerPool.ts`
- Create or modify: `src/server/players/playerPool.test.ts`
- Modify: `src/server/readModels/playerReadModels.ts`
- Modify: `src/server/readModels/playerReadModels.test.ts`

## Task 1: Player Pool Service

- [ ] **Step 1: Add service tests**

Create or update `src/server/players/playerPool.test.ts` with tests proving:

```ts
expect(result.season).toBe(2026);
expect(result.total).toBe(2);
expect(result.players.map((player) => player.id)).toEqual(['player-a', 'player-b']);
```

The fixture must include a global `Player` row for another season and assert it does not inflate the selected season total.

- [ ] **Step 2: Implement `listPlayerPool`**

Implement `src/server/players/playerPool.ts` so it reads `playerSeasonSummary` for the selected season, maps `statsJson` and `totalsJson` through the existing read-model JSON parser, and enriches ownership only when `leagueId` is present.

- [ ] **Step 3: Verify service**

Run:

```bash
npx vitest run src/server/players/playerPool.test.ts
```

Expected: service tests pass.

## Task 2: Player Routes Use Read Models

- [ ] **Step 1: Route tests**

Update player route tests so `/api/players?season=2026` expects totals from `playerSeasonSummary`, not the global `Player` table.

- [ ] **Step 2: Route implementation**

Modify `src/app/api/players/route.ts` to call `listPlayerPool` and preserve existing authentication/league membership checks.

- [ ] **Step 3: Verify route**

Run:

```bash
npx vitest run src/app/api/players/route.test.ts
```

Expected: all player route tests pass.

## Task 3: Rankings API Uses Published Snapshots

- [ ] **Step 1: Ranking tests**

Update `src/app/api/rankings/route.test.ts` so rankings are loaded via `statsReadService.listRankings({ season, scope: 'season' })` and expose publication metadata.

- [ ] **Step 2: Ranking implementation**

Modify `src/app/api/rankings/route.ts` to reject unpublished recent-form periods and read season rankings from the stats read service.

- [ ] **Step 3: Verify rankings**

Run:

```bash
npx vitest run src/app/api/rankings/route.test.ts
```

Expected: rankings tests pass and unsupported `period=last3` returns `400`.

## Task 4: Match Logs And Player Detail

- [ ] **Step 1: Match log tests**

Update `src/app/api/players/[id]/matches/route.test.ts` to prove match logs come from projected match-log rows for requested seasons.

- [ ] **Step 2: Route implementation**

Modify `src/app/api/players/[id]/matches/route.ts` to use read-model helpers and remove route-local Firestore stat interpretation.

- [ ] **Step 3: Verify all API tests**

Run:

```bash
npx vitest run \
  src/app/api/players/route.test.ts \
  src/app/api/players/[id]/route.test.ts \
  src/app/api/players/[id]/stats/route.test.ts \
  src/app/api/players/[id]/matches/route.test.ts \
  src/app/api/rankings/route.test.ts
```

Expected: all listed tests pass.

## Final Verification

Run:

```bash
npm run typecheck
git diff --check
```

Expected: both pass. If the dirty tree contains unrelated untracked tests, run the checks in this isolated branch only.

## Self-Review

- Scope excludes UI, ops, and docs-only migrations.
- Every task has exact files and commands.
- The route and service names match the current Statly codebase.
