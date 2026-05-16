# Footywire Program Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Footywire convergence program so canonical Firestore raw-match documents are the only persisted semantic source, Prisma read models are rebuildable projections, repair operations are bounded and audited, and the release can be reviewed without unrelated dirty-tree risk.

**Architecture:** Complete the work as gated vertical slices. Each gate must remove one class of drift or release risk, prove the affected scope with tests/verifiers, and leave no permanent compatibility reader or undocumented mutation path behind.

**Tech Stack:** TypeScript, Next.js App Router, Prisma/SQLite migrations, Firebase Admin Firestore, Vitest, ESLint, tsx scripts, Footywire ETL, Firestore `player_match_stats`, Prisma read models.

---

## Current Verified State

- The verifier runtime blocker is repaired for the current local environment.
- Canonical stat number, presence, and provenance reads are centralized in `src/lib/stats/footywireCanonicalContract.ts`.
- `src/server/readModels/playerReadModels.ts` consumes canonical contract helpers instead of duplicating stat semantics.
- Shared team identity covers the known `KAN/NOR/NTH/NM`, `BRL/BRIS`, and `WBD/DOGS` alias drift.
- Migration hygiene is partially repaired: standalone SQL files were moved out of executable Prisma migration path.
- The repaired verification slice is 2026 rounds `0,1`, not the whole season.
- Verified commands from the latest gate:
  - `npm test -- --run tests/teamNames.test.ts tests/verify-player-read-models-core.test.ts src/lib/footywireStatsIngestion.test.ts src/server/readModels/playerReadModels.test.ts src/lib/stats/footywireCanonicalContract.test.ts`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run verify:player-read-models -- --season 2026 --rounds 0,1 --json`
  - `npm run verify:player-read-models -- --season 2026 --rounds 0,1 --include-merged-live --json --merged-timeout-ms 120000`

## Goal Assessment

The goal is architectural completion, not just another passing test run. The finished program must make Firestore `player_match_stats.canonical_stats` the only persisted semantic contract for Footywire-derived player-match data, keep Prisma identity facts normalized, and publish Prisma read models as rebuildable serving projections.

That goal has five non-negotiable invariants:

- Stat meaning, presence, provenance, and source priority are defined once at the canonical contract boundary.
- Player and match identity resolution are deterministic, season-aware, and backed by explicit identity facts or unresolved-row quarantine.
- Import and repair operations rematerialize the smallest safe affected scope and mark dependent projections dirty until republished.
- Mutation paths are explicitly authorized and auditable in shared environments.
- Completion is proven by verifier output, not inferred from code review.

## Shortcomings Against That Goal

The prior plan was directionally correct but still too broad to guarantee completion:

- It did not distinguish the already-passing 2026 rounds `0,1` slice from the full 2026 season acceptance gate.
- It treated inventory, schema review, canonical cleanup, identity repair, rematerialization, security, and release packaging as parallel checklist items rather than ordered release gates.
- It did not define a concrete failure-triage loop for full-season verifier failures.
- It allowed “document or add lineage” as an open choice without specifying how to prove projections remain rebuildable and non-canonical.
- It did not require final staging to be derived from a release inventory, which is risky in the current large dirty tree.
- It did not explicitly require raw-loss survivors to be classified by cause before calling the program complete.

## Rewritten Long-Term Solution

The optimal long-term solution is a release-gated convergence program:

- First, lock the release boundary so local/generated/UI artifacts cannot contaminate the data-contract release.
- Second, close schema and migration safety so the relational model can be replayed and reviewed from zero.
- Third, complete canonical-reader convergence so downstream code cannot rebuild business meaning from legacy raw shapes.
- Fourth, curate true identity gaps into normalized, evidence-backed identity data, while quarantining unresolved source rows.
- Fifth, rematerialize only affected players/rounds/matches and publish projection families only after dependent data is current.
- Sixth, harden all mutation paths with explicit auth and audit output.
- Seventh, run a verifier matrix and block completion on any unresolved `dropped_before_raw`, `dropped_in_projection`, raw/projection mismatch, or aggregate mismatch.
- Eighth, package the release into reviewable groups with an explicit exclusion list.

## Completion Definition

The whole program is complete only when all of these are true:

- The claimed completion scope is explicit: either repaired slice, full 2026 season, or another named season/round/player scope.
- `dropped_before_raw` is zero for the claimed completion scope.
- `dropped_in_projection` is zero for the claimed completion scope.
- Raw, projection, and season-summary aggregates match for the claimed completion scope.
- Live merged-source verification passes for the repaired slice and either passes for full season or has a documented source/runtime limitation.
- Remaining raw-loss rows are classified as true unresolved player-directory/source gaps, not punctuation, team alias, short-name, match identity, or presence-semantics drift.
- Prisma migrations validate and replay from zero.
- Import, repair, rebuild, and verifier operations have explicit authorization, audit output, and runbook commands.
- Final staged changes exclude local artifacts, generated emulator exports, unrelated UI/product changes, and review-only scratch files.
- A final completion report records exact command output summaries, unresolved gaps, and the completion decision.

## PROPOSED EDIT PLAN
Working with: repository-wide Footywire convergence program
Total planned edits: 9

### Edit sequence:
1. Finalize release inventory and staging boundaries - Purpose: avoid shipping unrelated dirty-tree changes or local artifacts. Status: required before staging any additional files.
2. Close schema and migration concerns - Purpose: prove relational design, executable migration history, and projection lineage are safe long term. Status: partially complete; needs final replay and lineage decision.
3. Finish canonical reader audit - Purpose: eliminate remaining permanent downstream semantic readers outside the canonical contract. Status: partially complete for read models; needs repository-wide audit.
4. Finish identity curation workflow - Purpose: turn unresolved player rows into evidence-backed identity facts or explicit quarantine. Status: pending full unresolved-row classification.
5. Finish bounded rematerialization - Purpose: rebuild only affected players/rounds/matches after imports or repairs. Status: pending proof that import/repair paths do not over-rebuild or under-publish.
6. Harden import, repair, and rebuild operations - Purpose: enforce authorization, auditability, and safe operational defaults. Status: pending route/script review.
7. Run full convergence verification matrix - Purpose: prove repaired-scope and season-level raw/projection/summary correctness. Status: repaired slice passed; full target season pending.
8. Package release into reviewable groups - Purpose: make the branch mergeable and reduce regression risk. Status: pending after gates 1-7.
9. Create final completion report - Purpose: document what is complete, residual risks, and exact rerun commands. Status: pending after final verifier matrix.

### Gate dependencies:
- Gate 1 blocks final staging and must stay current whenever new files change.
- Gate 2 blocks schema/identity/rematerialization claims because migration replay is the foundation for reviewability.
- Gate 3 blocks projection-complete claims because duplicated semantic readers can reintroduce drift.
- Gate 4 blocks full-season rematerialization because unresolved identity gaps should be repaired or quarantined before rebuilding projections.
- Gate 5 blocks import-route completion because import success is not app-facing success until affected projections are rebuilt or marked dirty.
- Gate 6 blocks production/shared-environment use of mutation paths.
- Gate 7 blocks final completion unless every failure class is zero or explicitly scoped out with evidence.
- Gates 8-9 are release hygiene and reporting gates; they cannot start until implementation gates have passed or blockers are documented.

### Failure triage rule:
- If a verifier fails, do not patch multiple classes at once.
- First classify each failure into one of: source unavailable, unresolved player identity, match identity drift, stat presence drift, raw write loss, projection rebuild loss, aggregate calculation drift, or test/runtime issue.
- Then create or update a blocker plan for exactly one class and rerun the narrowest verifier scope after that class is repaired.

## Task 1: Finalize Release Inventory And Staging Boundaries

**Files:**
- Modify: `docs/superpowers/plans/2026-04-26-change-inventory.md`
- Read: `git status --short --untracked-files=all`

- [ ] **Step 1: Refresh dirty-tree inventory**

Run:

```bash
git status --short --untracked-files=all
git diff --stat
```

Expected:

- Every changed path is visible.
- Any new path since the last inventory is classified before implementation continues.
- The inventory records whether each file is implementation, test, migration, docs, generated/local, or unrelated product/UI work.

- [ ] **Step 2: Mark files by release gate**

Update `docs/superpowers/plans/2026-04-26-change-inventory.md` with these final buckets:

- Gate A: canonical contract, ETL, read-model, verifier, identity, migration, operation docs.
- Gate B: valid but later product/UI work.
- Gate C: local/generated artifacts that must not be staged.
- Gate D: mixed files requiring manual diff review before staging.

- [ ] **Step 3: Enforce exclusion list before final staging**

Run:

```bash
git status --short --untracked-files=all | rg "^( M|\\?\\?) (\\.firebase-data|dataconnect/\\.dataconnect|prisma/dev\\.db|\\.cursor/settings\\.json)"
```

Expected:

- Matches are allowed to remain dirty locally.
- Matches are not staged in the convergence release.

Gate pass criteria:

- Every dirty path is assigned to a release gate.
- No local/generated path is staged.
- No unrelated UI/product path is staged unless explicitly approved as a separate package.
- Mixed files have a documented decision: split, include with justification, or defer.

## Task 2: Close Schema And Migration Concerns

**Files:**
- Modify: `docs/superpowers/plans/2026-04-26-schema-design-review.md`
- Review: `prisma/schema.prisma`
- Review: `prisma/migrations/**/migration.sql`
- Review: `prisma/legacy-migrations/*.sql`

- [ ] **Step 1: Verify executable migration shape**

Run:

```bash
find prisma/migrations -maxdepth 1 -type f -print | sort
```

Expected:

```text
prisma/migrations/migration_lock.toml
```

- [ ] **Step 2: Validate schema**

Run:

```bash
npx prisma validate --schema prisma/schema.prisma
```

Expected:

- Prisma reports the schema is valid.

- [ ] **Step 3: Replay migrations from zero**

Run:

```bash
DATABASE_URL=file:./tmp-program-completion.db npx prisma migrate deploy --schema prisma/schema.prisma
rm -f prisma/tmp-program-completion.db
```

Expected:

- All migrations apply successfully.
- The temporary database is removed.

- [ ] **Step 4: Close projection lineage decision**

Review these tables in `prisma/schema.prisma`:

- `PlayerProjectionPublication`
- `PlayerSeasonSummary`
- `PlayerRankingSnapshot`
- `PlayerRecentFormSummary`
- `PlayerLatestSnapshot`
- `PlayerMatchLogProjection`
- `LeagueRosterPlayerSummary`

Acceptance:

- Either `PlayerProjectionPublication(scope='season')` is documented as the publication ledger for all player projection families, or a new explicit lineage field/migration is added for match-log/latest projections.
- No projection table is documented or used as canonical input for Footywire stat semantics.

Gate pass criteria:

- `prisma/migrations/` contains only migration directories and `migration_lock.toml`.
- `npx prisma validate --schema prisma/schema.prisma` passes.
- A clean replay database applies every migration from zero.
- Projection lineage is documented in `docs/superpowers/plans/2026-04-26-schema-design-review.md` or implemented in schema/migration code.
- Read-model tables are explicitly treated as rebuildable projections, not Footywire semantic sources.

## Task 3: Finish Canonical Reader Audit

**Files:**
- Review/modify: `src/lib/stats/footywireCanonicalContract.ts`
- Review/modify: `etl/processFootywireData.ts`
- Review/modify: `src/lib/footywireStatsIngestion.ts`
- Review/modify: `src/server/readModels/playerReadModels.ts`
- Review/modify: `Scripts/verify-player-read-models-core.ts`
- Test: `src/lib/stats/footywireCanonicalContract.test.ts`
- Test: `src/server/readModels/playerReadModels.test.ts`

- [ ] **Step 1: Search for duplicated stat semantics**

Run:

```bash
rg -n "canonical_stats|raw_row|data\\.stats|legacy_top_level|fallback|availability|provenance|source_priority|TEAM_ABBR|TEAM_NAME_MAP" src etl Scripts shared
```

Expected:

- Hits in canonical writer/contract/verifier are acceptable.
- Hits in downstream readers must either call canonical helpers or be documented as isolated transitional adapters with removal criteria.

- [ ] **Step 2: Remove or isolate permanent fallback readers**

For each downstream reader hit:

- If canonical data exists, read through `readFootywireCanonicalStatNumber`, `readFootywireCanonicalStatPresence`, or `readFootywireCanonicalStatProvenance`.
- If legacy compatibility is still required, keep it in one helper with a comment stating the repaired scope and removal condition.

Acceptance:

- No downstream projection path reconstructs stat meaning from top-level Firestore fields, `data.stats`, or `raw_row` once `canonical_stats` exists.

- [ ] **Step 3: Verify reader behavior**

Run:

```bash
npm test -- --run src/lib/stats/footywireCanonicalContract.test.ts src/server/readModels/playerReadModels.test.ts
```

Expected:

- Tests pass.
- Zero values with availability `true` remain present.
- Values with availability `false` remain absent.

Gate pass criteria:

- Repository search finds no stage-local `TEAM_ABBR` or `TEAM_NAME_MAP` replacement for shared team identity.
- Downstream read-model code does not interpret top-level raw stat fields when `canonical_stats` exists.
- Any temporary compatibility adapter is isolated, named as transitional, and has a documented removal condition.
- Canonical contract tests cover number conversion, presence, zero values, absence, aliases, and provenance.

## Task 4: Finish Identity Curation Workflow

**Files:**
- Review/modify: `src/server/playerDirectoryRepair.ts`
- Review/modify: `src/server/playerDirectoryRosterEvidence.ts`
- Review/modify: `src/data/playerDirectoryRepairs2026.ts`
- Review/modify: `src/data/playerRosterEvidence2026.ts`
- Review/modify: `shared/player-identity/playerIdentityResolver.ts`
- Test: `src/server/playerDirectoryRepair.test.ts`
- Test: `src/server/playerDirectoryRosterEvidence.test.ts`
- Test: `src/server/playerIdentityResolver.test.ts`

- [ ] **Step 1: Audit unresolved rows**

Run:

```bash
npx tsx Scripts/audit-unresolved-player-directory.ts --season 2026 --rounds 0,1
```

Expected:

- Output separates true directory gaps from normalization drift.
- Any punctuation/team/short-name issue becomes a resolver test before repair data is added.

- [ ] **Step 2: Add evidence-backed repairs only**

For each true gap:

- Add roster evidence to `src/data/playerRosterEvidence2026.ts`.
- Add repair mapping to `src/data/playerDirectoryRepairs2026.ts`.
- Include source identity, observed source name, team, season, and confidence.

Acceptance:

- No repair is based solely on fuzzy name matching.
- Season-specific club facts live in `PlayerSeasonRegistration`, not only mutable `Player.club`.

- [ ] **Step 3: Verify identity repairs**

Run:

```bash
npm test -- --run src/server/playerDirectoryRepair.test.ts src/server/playerDirectoryRosterEvidence.test.ts src/server/playerIdentityResolver.test.ts
```

Expected:

- Resolver prefers season registration when season context exists.
- Alias scope prevents cross-team false positives.

Gate pass criteria:

- Unresolved rows are grouped by root cause, not only counted.
- Punctuation, team-alias, short-name, and match-code drift are fixed in normalization/resolver code, not in ad hoc repair rows.
- True player-directory gaps have roster/source evidence before repair.
- Unresolved rows that cannot be safely resolved are quarantined and excluded from published projections.
- A post-repair verifier run shows repaired identity rows no longer cause `dropped_before_raw`.

## Task 5: Finish Bounded Rematerialization

**Files:**
- Review/modify: `Scripts/build-player-read-models.ts`
- Review/modify: `src/server/readModels/playerReadModels.ts`
- Review/modify: `src/app/api/etl/import-rounds/route.ts`
- Test: `src/server/readModels/playerReadModels.test.ts`
- Test: `src/app/api/etl/import-rounds/route.test.ts`

- [ ] **Step 1: Confirm bounded parameters**

Ensure rebuild entry points accept and preserve:

- `season`
- `rounds`
- `playerIds`
- `leagueId` where roster publication is league-scoped

Acceptance:

- Round repairs do not default to full-season rebuild unless no bounded scope can be computed.

- [ ] **Step 2: Rebuild affected read models only**

Implementation must update only affected rows for:

- `PlayerSeasonSummary`
- `PlayerRecentFormSummary`
- `PlayerLatestSnapshot`
- `PlayerMatchLogProjection`

Acceptance:

- Scoped rebuild deletes/replaces rows for targeted players/rounds without wiping unrelated season rows.
- Publication state marks dependent rankings/rosters dirty when summaries change.

- [ ] **Step 3: Verify bounded rebuild behavior**

Run:

```bash
npm test -- --run src/server/readModels/playerReadModels.test.ts src/app/api/etl/import-rounds/route.test.ts
```

Expected:

- Targeted rounds are refreshed.
- Unrelated rounds remain untouched.
- Rankings/rosters are not falsely published after partial summary changes.

Gate pass criteria:

- Import and repair paths compute affected scope as rounds, matches, and/or player IDs.
- Partial refresh updates player summaries, recent form, latest snapshot, and match logs for affected players without wiping unrelated season rows.
- Dependent ranking and roster projections are marked dirty after partial summary changes.
- Full-season rebuild remains available as an explicit recovery/backfill mode, not the default repair behavior.
- Audit output states whether projections were rebuilt, marked dirty, or published.

## Task 6: Harden Import, Repair, And Rebuild Operations

**Files:**
- Review/modify: `src/app/api/etl/import-rounds/route.ts`
- Review/modify: `src/app/api/cron/daily/route.ts`
- Review/modify: `src/lib/serverAuth.ts`
- Review/modify: `Scripts/repair-player-directory.ts`
- Review/modify: `Scripts/build-player-read-models.ts`
- Test: `src/app/api/etl/import-rounds/route.test.ts`
- Test: `src/app/api/cron/daily/route.test.ts`

- [ ] **Step 1: Make authorization explicit**

Acceptance:

- Local/dev paths may use documented bypasses.
- Shared/staging/production mutation routes require explicit secret/session/service authorization.
- No route relies on permissive defaults for mutation.

- [ ] **Step 2: Emit audit output for mutations**

Mutation commands/routes must log:

- season
- rounds
- player count or player IDs where bounded
- source names
- raw docs written
- projections rebuilt
- publication dirty/published state
- verifier command to rerun

- [ ] **Step 3: Verify route/security behavior**

Run:

```bash
npm test -- --run src/app/api/etl/import-rounds/route.test.ts src/app/api/cron/daily/route.test.ts
```

Expected:

- Unauthorized mutation attempts fail.
- Authorized mutation attempts trigger bounded rebuild and return audit metadata.

Gate pass criteria:

- Shared/staging/production mutation routes require explicit authorization.
- Local/dev bypasses are environment-scoped and documented.
- Import, repair, and rebuild scripts print enough metadata to rerun verification for the affected scope.
- Mutation logs include season, rounds, source names, raw docs written, player IDs/counts, projection rows affected, publication state, and verifier command.
- Failure responses do not leave projections marked published when rebuild/rematerialization failed.

## Task 7: Run Full Convergence Verification Matrix

**Files:**
- Use: `Scripts/verify-player-read-models.ts`
- Use: `Scripts/verify-match-logs.ts`
- Use: `Scripts/build-player-read-models.ts`

- [ ] **Step 1: Verify repaired scope persisted mode**

Run:

```bash
npm run verify:player-read-models -- --season 2026 --rounds 0,1 --json
```

Expected:

- `status` is `pass`.
- `matchLogIssues.byCode` is empty.
- `rawDriftDiagnostics` is empty.
- `aggregateMismatchPlayers` is `0`.

- [ ] **Step 2: Verify repaired scope live merged mode**

Run:

```bash
npm run verify:player-read-models -- --season 2026 --rounds 0,1 --include-merged-live --json --merged-timeout-ms 120000
```

Expected:

- `status` is `pass`.
- Merged, raw, and projection coverage match for supported stat surface.
- Any surplus merged rows are classified, not silently ignored.

- [ ] **Step 3: Verify full target season**

Run:

```bash
npm run verify:player-read-models -- --season 2026 --json
```

Expected:

- If pass: proceed to Task 8.
- If fail: do not proceed to Task 8 until a failure-class blocker plan exists.
- The blocker plan groups issues by likely cause and fixes only one class at a time.

- [ ] **Step 4: Verify failure classes explicitly**

Search verifier output for:

- `dropped_before_raw`
- `dropped_in_projection`

Expected:

- Both are zero for the claimed completed scope.
- If non-zero, completion is blocked until classified and repaired.

- [ ] **Step 5: Verify aggregate and publication consistency**

Inspect verifier JSON for:

- `publication.summaryCount`
- `publication.rankingCount`
- `publication.rosterCount`
- `counts.rawRows`
- `counts.projectionRows`
- `counts.seasonSummaries`
- `aggregateMismatchPlayers`

Expected:

- Raw and projection row counts match for the claimed scope.
- `aggregateMismatchPlayers` is `0`.
- Publication counts are non-zero and correspond to the target season.
- If projection rows match but aggregate mismatches remain, create an aggregate-calculation blocker plan instead of calling completion.

Gate pass criteria:

- Repaired-slice persisted verifier passes.
- Repaired-slice live merged verifier passes or the live source limitation is explicitly documented with persisted proof.
- Full target season verifier passes before claiming full-season completion.
- Every remaining verifier issue is classified by root cause.
- No unclassified `dropped_before_raw`, `dropped_in_projection`, raw drift diagnostic, projection mismatch, or aggregate mismatch remains in the claimed completion scope.

## Task 8: Package Release Into Reviewable Groups

**Files:**
- Use: `docs/superpowers/plans/2026-04-26-change-inventory.md`
- Use: `git status --short --untracked-files=all`
- Use: `git diff --name-only`

- [ ] **Step 1: Split final staging groups**

Create groups:

- Group 1: verifier/runtime/canonical contract/read-model convergence.
- Group 2: migration/schema/identity curation.
- Group 3: bounded rematerialization/import hardening.
- Group 4: docs/runbooks/tests.

Acceptance:

- UI/product changes are not staged with convergence unless explicitly approved.
- Local/generated artifacts are not staged.
- Each group can be reviewed independently without requiring unrelated product context.

- [ ] **Step 2: Run final quality checks**

Run:

```bash
npm run typecheck
npm run lint
npm test
npx prisma validate --schema prisma/schema.prisma
```

Expected:

- All pass, or failures have a written blocker plan before merge.

Gate pass criteria:

- Staged files match the release inventory.
- `git diff --cached --name-only` contains no local/generated artifacts.
- Each staged group has a short review note explaining why it belongs to the convergence release.
- Final checks pass after staging, not only before staging.

## Task 9: Create Final Completion Report

**Files:**
- Create: `docs/superpowers/plans/2026-04-26-footywire-program-completion-report.md`
- Update: `docs/DATA_RELIABILITY.md`
- Update: `docs/FOOTYWIRE_DATA_ARCHITECTURE_REVIEW.md`

- [ ] **Step 1: Record final status**

The report must include:

- completed gates
- exact commands run
- verifier results
- repaired scope
- remaining unresolved player-directory gaps
- whether gaps are true source/directory gaps or normalization drift
- migration replay result
- excluded files/classes

- [ ] **Step 2: Add runbook commands**

Document rerun commands for:

- import rounds
- repair player directory
- bounded rebuild
- persisted verifier
- live merged verifier
- full-season verifier

- [ ] **Step 3: State completion decision**

Completion decision must be one of:

- Complete for repaired slice only.
- Complete for full 2026 season.
- Not complete; blocked by listed failure classes.

Gate pass criteria:

- Completion report includes the exact scope being claimed.
- Completion report includes command summaries for typecheck, lint, tests, migration validation/replay, persisted verifier, and live verifier.
- Completion report lists remaining true unresolved source/directory gaps with owner and next action.
- Completion report explicitly says whether the whole program is complete or only a bounded slice is complete.

## Stop Conditions

Stop and create a focused blocker plan if any of these occur:

- Prisma migration replay fails.
- Full-season verifier returns `dropped_before_raw` or `dropped_in_projection`.
- A downstream reader still needs raw/top-level semantic fallback after canonical stats exist.
- A player repair cannot be supported by roster/source evidence.
- Import or repair route mutates raw/projection data without explicit authorization.
- Final staging includes local artifacts or unrelated UI/product changes.

## Recommended Execution Order

1. Complete Tasks 1-3 first because they protect architecture and review scope.
2. Complete Task 4 before any full-season rebuild, because true identity gaps should be repaired before rematerialization.
3. Complete Task 5 after identity curation, so bounded rebuilds publish corrected rows.
4. Complete Task 6 before relying on API/cron mutation paths.
5. Complete Task 7 as the release acceptance gate.
6. Complete Tasks 8-9 only after verification passes or blockers are documented.
