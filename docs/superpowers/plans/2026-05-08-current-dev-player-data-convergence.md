# Current Dev Player Data Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the current dev stack's `/players` data by converging the local Prisma player directory with canonical 2026 Firestore player ids, rebuilding player read models, and verifying the app-facing players API.

**Architecture:** The active dev stack is running from `/Users/robert/Developer/Statly`, but the player-directory convergence tooling exists in `/Users/robert/.config/superpowers/worktrees/Statly/full-data-convergence-plan`. Execute that tooling from the clean convergence worktree while overriding `DATABASE_URL` to target `/Users/robert/Developer/Statly/prisma/dev.db`. This mutates only the local Prisma SQLite database and generated `tmp/` artifacts; Firestore remains read-only.

**Tech Stack:** Next.js dev server, Firebase Admin Firestore reads, Prisma SQLite, TypeScript `tsx` scripts, existing `converge:player-data`, `diagnose:player-identity-gaps`, `sync:player-directory-season`, `build:player-read-models`, and `verify:player-read-models` scripts.

---

## Investigation Summary

- Current app checkout: `/Users/robert/Developer/Statly` on `codex/draftrefinement` at `b4fe6ab3` from `2026-05-05T20:32:34+10:00`.
- Current dev database: `/Users/robert/Developer/Statly/prisma/dev.db`.
- Current DB counts before repair: `Player = 0`, `PlayerSeasonSummary = 0`, `PlayerMatchLogProjection = 0`.
- `/api/players?limit=5&page=1&season=2026` returned `{"players":[],"season":2026,"total":0,"page":1,"limit":5}`.
- Server logs from `/players` showed `skippedWithoutCanonicalId = 4498` during on-demand read-model refresh.
- Identity diagnostic for `2026` round `0` showed `236` Firestore rows and `236` `player_id_not_in_prisma` rows.
- The missing sync workflow landed later on other branches:
  - `fe362149` at `2026-05-05T21:21:47+10:00`: `Add season player directory sync command`
  - `3e4c4862` at `2026-05-05T23:04:49+10:00`: `Converge 2026 round 0 player directory`
  - `d9129037` at `2026-05-05T23:35:04+10:00`: `feat: add player data convergence runner`
- Dry-run against the current DB from the convergence worktree succeeded:
  - `playersToCreate = 230`
  - `registrationsToCreate = 230`
  - `coverage.ok = true`
  - `sync.valid = true`

## Files

- Read-only tooling source: `/Users/robert/.config/superpowers/worktrees/Statly/full-data-convergence-plan/Scripts/run-player-data-convergence.ts`
- Read-only tooling source: `/Users/robert/.config/superpowers/worktrees/Statly/full-data-convergence-plan/Scripts/sync-player-directory-season.ts`
- Mutated local database: `/Users/robert/Developer/Statly/prisma/dev.db`
- Generated evidence: `/Users/robert/.config/superpowers/worktrees/Statly/full-data-convergence-plan/tmp/player-data-convergence/**`
- Verify target: `http://localhost:3000/api/players?limit=5&page=1&season=2026`

### Task 1: Confirm Pre-Repair State

**Files:**
- Mutates: none
- Reads: `/Users/robert/Developer/Statly/prisma/dev.db`

- [ ] **Step 1: Confirm local player tables are empty or incomplete**

```bash
sqlite3 /Users/robert/Developer/Statly/prisma/dev.db \
  "select 'Player', count(*) from Player union all select 'PlayerSeasonSummary', count(*) from PlayerSeasonSummary union all select 'PlayerMatchLogProjection', count(*) from PlayerMatchLogProjection;"
```

Expected before repair: `Player|0`, `PlayerSeasonSummary|0`, and `PlayerMatchLogProjection|0`.

- [ ] **Step 2: Confirm `/players` API is empty**

```bash
curl -sS --max-time 30 'http://localhost:3000/api/players?limit=5&page=1&season=2026'
```

Expected before repair: JSON with `"players":[]` and `"total":0`.

### Task 2: Apply Player Directory Convergence And Rebuild Round 0

**Files:**
- Mutates: `/Users/robert/Developer/Statly/prisma/dev.db`
- Generates: `/Users/robert/.config/superpowers/worktrees/Statly/full-data-convergence-plan/tmp/player-data-convergence/**`

- [ ] **Step 1: Run the convergence workflow against the current dev database**

```bash
DATABASE_URL='file:/Users/robert/Developer/Statly/prisma/dev.db' \
  npm --silent run converge:player-data -- \
  --season=2026 \
  --rounds=0 \
  --apply-directory-sync \
  --include-merged-live \
  --json
```

Run from:

```bash
/Users/robert/.config/superpowers/worktrees/Statly/full-data-convergence-plan
```

Expected:
- `diagnose` completes.
- `sync-dry-run` reports `coverage.ok = true`.
- `sync-apply` reports `applied = true`.
- `build-read-models` completes with `ok = true`.
- `verify-read-models` completes with `ok = true`.
- No Firestore mutation command is run.

### Task 3: Verify Repaired Local State

**Files:**
- Reads: `/Users/robert/Developer/Statly/prisma/dev.db`
- Reads: `http://localhost:3000/api/players?limit=5&page=1&season=2026`

- [ ] **Step 1: Confirm Prisma now has player directory and projection rows**

```bash
sqlite3 /Users/robert/Developer/Statly/prisma/dev.db \
  "select 'Player', count(*) from Player union all select 'PlayerSeasonRegistration', count(*) from PlayerSeasonRegistration union all select 'PlayerSeasonSummary', count(*) from PlayerSeasonSummary union all select 'PlayerMatchLogProjection', count(*) from PlayerMatchLogProjection;"
```

Expected after repair:
- `Player` count greater than `0`
- `PlayerSeasonRegistration` count greater than `0`
- `PlayerSeasonSummary` count greater than `0`
- `PlayerMatchLogProjection` count greater than `0`

- [ ] **Step 2: Confirm the identity gap is closed for 2026 round 0**

```bash
DATABASE_URL='file:/Users/robert/Developer/Statly/prisma/dev.db' \
  npm --silent run diagnose:player-identity-gaps -- \
  --season=2026 \
  --rounds=0 \
  --json \
  --limit=5
```

Run from:

```bash
/Users/robert/.config/superpowers/worktrees/Statly/full-data-convergence-plan
```

Expected:
- `classificationCounts.player_id_not_in_prisma = 0`, or the only remaining value is a documented ignored non-semantic stored id from the convergence coverage gate.
- If the only remaining `player_id_not_in_prisma` value is `nasiah_wanganeenmilera`, confirm the convergence run reported it under `ignoredNonSemanticStoredPlayerIds` and the read-model verifier passed.
- `assertionCounts.rowsWithStoredPlayerIdInPrisma` is at least `235` for the current 236-row round 0 slice.

- [ ] **Step 3: Confirm `/players` API returns players**

```bash
curl -sS --max-time 30 'http://localhost:3000/api/players?limit=5&page=1&season=2026'
```

Expected after repair:
- JSON has `players` with at least one row.
- `total` is greater than `0`.

- [ ] **Step 4: Confirm the rendered `/players` page no longer says 0 players**

```bash
curl -sS --max-time 30 'http://localhost:3000/players' -o /tmp/statly-players-after.html
rg -n '0 players|No players found matching your filters|[1-9][0-9]* players' /tmp/statly-players-after.html | head -20
```

Expected after repair:
- The rendered page includes a non-zero player count.
- The empty table message is absent from the rendered post-repair payload.

---

## Self-Review

- Spec coverage: the plan explains when the working branch diverged, why the active dev stack is empty, applies the existing convergence workflow, rebuilds read models, and verifies both data and UI-facing API behavior.
- Placeholder scan: no `TBD`, `TODO`, or unspecified implementation steps remain.
- Type consistency: all commands use the same season `2026`, round `0`, current database path `/Users/robert/Developer/Statly/prisma/dev.db`, and convergence worktree path `/Users/robert/.config/superpowers/worktrees/Statly/full-data-convergence-plan`.
