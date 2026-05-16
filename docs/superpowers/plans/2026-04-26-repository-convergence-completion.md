# Repository Convergence Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current broad dirty repair branch into a reviewed, testable, long-term convergence release where Footywire raw data, identity data, Prisma read models, and operational controls follow one explicit data contract.

**Architecture:** Treat Firestore `player_match_stats` as the canonical persisted semantic contract for Footywire player-match data, and Prisma tables as normalized identity/configuration plus denormalized serving projections. Work proceeds in narrow vertical slices: freeze the current baseline, validate schema and data-design concerns, remove duplicate semantic readers, bound rematerialization, verify convergence, then package reviewable changes.

**Tech Stack:** TypeScript, Next.js App Router, Prisma/SQLite migrations, Firebase Admin Firestore, Vitest, ESLint, tsx scripts, existing Footywire ETL and read-model pipeline.

---

## Research Baseline

This plan is grounded in these design rules:

- Microsoft database design basics: define purpose first, divide data by subject, choose stable primary keys, define relationships, refine with sample data, and apply normalization so non-key facts depend on the key and nothing else.
- Lucidchart database design principles: start from requirements, model entities and relationships, normalize OLTP-style data, preserve integrity rules, and add indexes/views for access patterns.
- Firestore data-model guidance: store data in collections/documents, keep document fields consistent for queryability, keep documents lightweight, use subcollections/collections for growing sets, and model around query patterns.
- Firestore best practices: avoid hotspotting from lexicographically close or monotonically increasing document IDs/indexes, avoid unsafe document IDs, and keep indexes aligned with high-rate access patterns.

## Goal Assessment

The current repository is not missing one small fix. The remaining work is completion and hardening of a migration already in progress:

- Many files are modified or untracked, so review risk is now as important as implementation risk.
- The verifier blocker is repaired for 2026 rounds 0-1, including live merged source, raw Firestore, projection rows, and aggregate checks.
- The broader repository still needs a systematic pass to decide which changes are part of the Footywire/read-model convergence release, which are unrelated product work, and which are local artifacts that should not ship.
- Data-design concerns must be reviewed against normalized relational principles for Prisma and document/query-shape principles for Firestore.

## Reassessment After Task 1-2

The original plan was directionally correct but too broad as a single release plan. It correctly identified the work categories, but it did not force enough separation between:

- already-verified infrastructure repairs
- schema/migration hygiene
- canonical semantic reader cleanup
- player-directory curation
- bounded rematerialization
- operational hardening
- unrelated UI/product changes

That matters because the dirty tree is large enough that a broad “convergence release” would be hard to review and easy to regress. The optimal long-term approach is gated delivery: each gate must leave the system safer, independently testable, and closer to one semantic contract.

Completed during reassessment:

- Created `docs/superpowers/plans/2026-04-26-change-inventory.md`.
- Created `docs/superpowers/plans/2026-04-26-schema-design-review.md`.
- Moved legacy standalone SQL files out of `prisma/migrations/` into `prisma/legacy-migrations/`.
- Verified `npx prisma validate --schema prisma/schema.prisma`.
- Verified clean Prisma migration replay applies all 32 timestamped migrations after migration-directory cleanup.

New key finding:

- The migration chain itself was not the blocker; invalid directory shape was. Prisma expects timestamped migration directories and `migration_lock.toml` in `prisma/migrations/`. Root-level SQL files in that directory caused schema-engine failure before replay could proceed.

## Shortcomings To Address

- The dirty tree mixes canonical data-contract work, player identity work, ranking/read-model work, UI work, generated files, local Firebase exports, local database files, and docs.
- Schema changes exist without a single acceptance checklist proving replay-from-zero migrations, stable keys, relationship integrity, and access-pattern indexes.
- Firestore canonical raw contract convergence is improved, but downstream compatibility/fallback readers still need exit criteria and removal where safe.
- Import, repair, replay, rebuild, and verifier scripts are spread across the tree; operational runbooks and command sequencing need to be made explicit.
- Full-season refresh remains the default in some paths; bounded rematerialization needs to be finished so repairs have a smaller blast radius.
- Security and observability for high-impact mutation paths need explicit environment rules and audit evidence.

## Rewritten Long-Term Solution

The optimal long-term solution is not another patch layer. It is a gated convergence program with these invariants:

- Canonical semantic meaning is defined once at the Firestore raw-match contract boundary.
- Prisma owns normalized identity and application relational data with stable primary keys and explicit relationships.
- Prisma read models are serving projections, not a second semantic source.
- Denormalization is allowed only for read performance and must be traceable to the canonical source.
- Repair and rebuild operations are scoped, observable, repeatable, and authorized.
- Verification proves both failure classes trend to zero for repaired scopes: `dropped_before_raw` and `dropped_in_projection`.

The release gates are:

1. Migration hygiene gate - Prisma migration directory is valid, replayable from zero, and local artifacts are excluded.
2. Verified blocker gate - verifier runtime, live merged source mode, shared team identity, and raw/projection convergence for 2026 rounds 0-1 are packaged as one reviewable slice.
3. Canonical contract gate - downstream readers either consume the canonical contract or use one isolated temporary adapter with exit criteria.
4. Identity curation gate - true player-directory gaps become evidence-backed Prisma facts, not hidden fallback logic.
5. Bounded rematerialization gate - imports/repairs rebuild only affected scopes unless full-season recovery is explicitly requested.
6. Operational hardening gate - mutation paths have explicit auth, audit output, and runbook coverage.
7. Release hygiene gate - unrelated UI/product/local/generated changes are excluded or split.

## File Map

- Review/modify: `prisma/schema.prisma`
  - Responsibility: normalized relational model, stable keys, constraints, relation integrity, indexes.
- Review/modify: `prisma/migrations/**/migration.sql`
  - Responsibility: replayable schema history.
- Review/modify: `src/lib/stats/footywireCanonicalContract.ts`
  - Responsibility: one canonical Footywire stat contract, availability, provenance, source priority.
- Review/modify: `etl/processFootywireData.ts`
  - Responsibility: canonical raw writer at persistence boundary.
- Review/modify: `src/lib/footywireStatsIngestion.ts`
  - Responsibility: merged source construction and live/source comparison helpers.
- Review/modify: `src/server/readModels/playerReadModels.ts`
  - Responsibility: projection from canonical raw docs only; no permanent semantic fallback.
- Review/modify: `Scripts/build-player-read-models.ts`
  - Responsibility: rebuild/rematerialization entry point.
- Review/modify: `Scripts/verify-player-read-models.ts`
  - Responsibility: runtime convergence verification.
- Review/modify: `Scripts/verify-player-read-models-core.ts`
  - Responsibility: pure verifier engine.
- Review/modify: `src/app/api/etl/import-rounds/route.ts`
  - Responsibility: authorized import plus bounded publication trigger.
- Review/modify: `src/server/playerDirectoryRepair.ts`
  - Responsibility: evidence-backed identity curation.
- Review/modify: `docs/DATA_RELIABILITY.md`, `docs/FOOTYWIRE_DATA_ARCHITECTURE_REVIEW.md`, `docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md`
  - Responsibility: runbooks and architecture contract.

## REWRITTEN PROPOSED EDIT PLAN

Working with: repository-wide convergence branch
Total planned edits: 10

### Edit sequence:
1. Freeze and classify the dirty tree - Purpose: prevent unrelated changes or local artifacts from being accidentally shipped. Status: complete.
2. Complete database/schema design review - Purpose: validate normalized relational design, Firestore contract shape, primary keys, relationships, indexes, and denormalized projections. Status: complete with follow-ups.
3. Enforce migration directory hygiene - Purpose: keep Prisma migration history replayable from zero and separate legacy/manual SQL from executable migrations. Status: implemented, needs final status check.
4. Package the verified verifier/match-identity fix - Purpose: isolate the already-passing blocker repair into a reviewable slice.
5. Finish canonical contract ownership audit - Purpose: identify and remove remaining duplicated stat/presence/provenance readers.
6. Finish player identity curation workflow - Purpose: convert true unresolved directory gaps into evidence-backed Prisma identity facts.
7. Implement bounded rematerialization - Purpose: rebuild only affected rounds/matches/players after import or repair.
8. Harden import/rebuild security and observability - Purpose: make high-impact mutation paths explicit by environment and auditable.
9. Run full convergence verification matrix - Purpose: prove raw, projection, summaries, rankings, and APIs align for scoped and broader seasons.
10. Prepare review/merge package - Purpose: split or document changes so the branch is reviewable and safe to land.

Dependencies:

- Edit 1 must happen before further broad implementation.
- Edit 2 must happen before schema or migration edits.
- Edit 3 depends on Edit 2 and must stay complete before any new migration work.
- Edit 4 can be packaged immediately because its tests already pass.
- Edit 5 depends on Edit 2 because contract ownership and schema design must agree.
- Edit 6 depends on current player-directory schema/migration review.
- Edit 7 depends on contract and identity repair boundaries.
- Edit 8 depends on knowing the mutation entry points from Edits 5-7.
- Edit 9 depends on all implementation edits.
- Edit 10 depends on verification passing or documented residual risks.

## Task 1: Freeze And Classify Dirty Tree

**Files:**
- Create: `docs/superpowers/plans/2026-04-26-change-inventory.md`
- Read: all files from `git status --short`

- [ ] **Step 1: Generate a tracked/untracked inventory**

Run:

```bash
git status --short > /tmp/statly-status.txt
git diff --stat > /tmp/statly-diff-stat.txt
```

Expected:

- `/tmp/statly-status.txt` lists every dirty path.
- `/tmp/statly-diff-stat.txt` lists tracked file change volume.

- [ ] **Step 2: Classify each path**

Create `docs/superpowers/plans/2026-04-26-change-inventory.md` with sections:

```markdown
# Change Inventory

## Ship In Convergence Release

## Split Into Separate Product/UI Release

## Generated Or Local Artifact - Do Not Ship

## Needs Manual Review
```

Classification rules:

- Ship in convergence release: Footywire canonical contract, ETL, ingestion, read models, verifier, player identity, migrations directly supporting identity/read-model convergence, tests, and related docs.
- Split into separate release: unrelated UI/design/navigation/dashboard/trade screens unless required by data-contract changes.
- Generated/local artifact: `.firebase-data/**`, `prisma/dev.db`, local screenshots, local export metadata, cache files.
- Needs manual review: files that combine unrelated product changes with data-convergence changes.

- [ ] **Step 3: Verify no local artifacts are required by tests**

Run:

```bash
rg -n "\\.firebase-data|prisma/dev\\.db|firebase-export-metadata" .
```

Expected:

- Any references are documentation/setup only.
- If code depends on local artifacts, stop and create a separate environment-fixture plan.

## Task 2: Complete Database And Schema Design Review

**Files:**
- Modify: `docs/superpowers/plans/2026-04-26-schema-design-review.md`
- Read: `prisma/schema.prisma`
- Read: `prisma/migrations/**/migration.sql`
- Read: Firestore contract docs and helper files.

- [ ] **Step 1: Create schema review checklist**

Create `docs/superpowers/plans/2026-04-26-schema-design-review.md` with this structure:

```markdown
# Schema Design Review

## Relational Purpose

## Entity And Subject Boundaries

## Primary Keys

## Relationships And Foreign Keys

## Normalization Review

## Intentional Denormalization

## Index And Access Pattern Review

## Firestore Contract Review

## Migration Replay Review

## Required Fixes
```

- [ ] **Step 2: Review Prisma identity models**

Check:

- `Player` has stable canonical identity.
- `PlayerAlias` maps observed provider strings to canonical players without duplicating player facts.
- `PlayerSeasonRegistration` expresses season/club facts without overwriting mutable current club history.
- `UnresolvedPlayerStatRow` quarantines unresolved facts instead of publishing them.

Expected:

- Any violation becomes a concrete item under `Required Fixes`.

- [ ] **Step 3: Review read-model tables as intentional denormalization**

Check:

- `PlayerSeasonSummary`, ranking snapshots, roster summaries, and latest snapshots are projections.
- Each projection has a source publication/version field or clear derivation path.
- No projection table is treated as canonical input for Footywire semantics.

Expected:

- If a projection is reused as semantic input, add a required fix to redirect it to canonical raw docs or identity tables.

- [ ] **Step 4: Review indexes against access patterns**

For each high-use query path, list required composite or single-column indexes:

- player by season/active/club/position
- summaries by season/player
- rankings by season/scope/method/rank
- unresolved rows by season/status/source
- trade and league transactional lookups

Expected:

- Missing indexes become migration tasks.
- Redundant indexes become cleanup tasks only if safe.

- [ ] **Step 5: Review Firestore contract**

Check:

- `player_match_stats` has one canonical contract shape.
- canonical stat keys, availability, provenance, source priority, match identity, player identity, and match metadata are defined in shared helpers.
- duplicate match documents are reconciled by canonical metadata and do not create permanent parallel semantics.

Expected:

- Any stage reading legacy top-level fields as permanent semantics becomes a Task 4 fix.

## Task 3: Enforce Migration Directory Hygiene

**Files:**
- Move: `prisma/migrations/add_draft_lobby.sql` -> `prisma/legacy-migrations/add_draft_lobby.sql`
- Move: `prisma/migrations/add_timezone_support.sql` -> `prisma/legacy-migrations/add_timezone_support.sql`
- Modify: `docs/superpowers/plans/2026-04-26-change-inventory.md`
- Modify: `docs/superpowers/plans/2026-04-26-schema-design-review.md`

- [x] **Step 1: Identify non-Prisma files in migration directory**

Run:

```bash
find prisma/migrations -maxdepth 1 -type f -print | sort
```

Expected after cleanup:

```text
prisma/migrations/migration_lock.toml
```

- [x] **Step 2: Move legacy standalone SQL out of executable migration path**

Moved:

```text
prisma/migrations/add_draft_lobby.sql -> prisma/legacy-migrations/add_draft_lobby.sql
prisma/migrations/add_timezone_support.sql -> prisma/legacy-migrations/add_timezone_support.sql
```

Purpose:

- Preserve manual SQL history.
- Prevent Prisma schema engine from treating root-level SQL files as invalid migration entries.
- Keep `prisma/migrations/` replayable from zero.

- [x] **Step 3: Verify schema and replay**

Run:

```bash
npx prisma validate --schema prisma/schema.prisma
DATABASE_URL=file:./tmp-migration-review.db npx prisma migrate deploy --schema prisma/schema.prisma
rm -f prisma/tmp-migration-review.db
```

Expected:

- Schema validation passes.
- All 32 timestamped migrations apply successfully to a clean SQLite database.
- Temporary replay DB is removed.

## Task 4: Package Verified Verifier And Match-Identity Fix

**Files:**
- Review/modify: `Scripts/verify-player-read-models-core.ts`
- Review/modify: `Scripts/verify-player-read-models.ts`
- Review/modify: `src/lib/footywireStatsIngestion.ts`
- Review/modify: `etl/processFootywireData.ts`
- Review/modify: `shared/player-identity/teamNames.ts`
- Review/modify: verifier and ingestion/read-model tests.

- [ ] **Step 1: Review diff for this slice only**

Run:

```bash
git diff -- Scripts/verify-player-read-models.ts Scripts/verify-player-read-models-core.ts src/lib/footywireStatsIngestion.ts etl/processFootywireData.ts shared/player-identity/teamNames.ts tests/teamNames.test.ts tests/verify-player-read-models-core.test.ts src/lib/footywireStatsIngestion.test.ts src/server/readModels/playerReadModels.test.ts src/server/readModels/playerReadModels.ts
```

Expected:

- Diff only contains verifier runtime, shared team identity, ingestion timeout/progress, raw stage scoping, and tests.

- [ ] **Step 2: Re-run acceptance checks**

Run:

```bash
npm test -- --run tests/teamNames.test.ts tests/verify-player-read-models-core.test.ts src/lib/footywireStatsIngestion.test.ts src/server/readModels/playerReadModels.test.ts
npm run typecheck
npm run lint
npm run verify:player-read-models -- --season 2026 --rounds 0,1 --json --trace --limit 5
npm run verify:player-read-models -- --season 2026 --rounds 0,1 --include-merged-live --data-source afltables,footywire_match --json --trace --merged-timeout-ms 240000 --limit 5
```

Expected:

- Unit tests pass.
- Typecheck passes.
- Lint passes.
- Persisted verifier passes.
- Live verifier passes.

## Task 5: Finish Canonical Contract Ownership Audit

**Files:**
- Modify: `src/lib/stats/footywireCanonicalContract.ts`
- Modify: `src/server/readModels/playerReadModels.ts`
- Modify: `src/lib/footywireStatsIngestion.ts`
- Modify: `etl/processFootywireData.ts`
- Test: relevant contract/read-model tests.

- [ ] **Step 1: Find duplicate semantic readers**

Run:

```bash
rg -n "canonical_stats|raw_row|data\\.stats|legacy|fallback|availability|provenance|source_priority|TEAM_ABBR|TEAM_NAME_MAP" src etl Scripts shared
```

Expected:

- Every legacy/fallback reader is classified as temporary compatibility, test fixture, or required bug.

- [ ] **Step 2: Move remaining stat/presence/provenance interpretation into contract helpers**

Implementation rule:

- ETL writes through the shared contract helper.
- Ingestion diagnostics build snapshots through the shared contract helper.
- Read models consume the shared contract helper.
- Compatibility readers remain in one isolated adapter with an exit comment and test.

- [ ] **Step 3: Add tests for zero/missing/absent semantics**

Required tests:

- zero value with availability true is present.
- missing value with availability false is absent.
- absent availability falls back only according to contract helper rules.
- provenance survives merged source to raw to projection.

Expected:

- `dropped_in_projection` cannot be masked by projection-only interpretation logic.

## Task 6: Finish Player Identity Curation Workflow

**Files:**
- Modify: `src/server/playerDirectoryRepair.ts`
- Modify: `src/server/playerDirectoryRepair.test.ts`
- Modify: `Scripts/audit-unresolved-player-directory.ts`
- Modify: `src/data/playerDirectoryRepairs2026.ts`
- Use: `Scripts/repair-player-directory.ts`

- [ ] **Step 1: Run unresolved audit**

Run:

```bash
npx tsx Scripts/audit-unresolved-player-directory.ts --season 2026 --limit 50
```

Expected:

- Output groups unresolved rows by player/team/source and classifies likely repair type.

- [ ] **Step 2: Apply evidence-backed repair batch**

Rules:

- Add `Player` only for genuinely missing canonical players.
- Add `PlayerSeasonRegistration` for season/club facts.
- Add scoped `PlayerAlias` for observed provider strings.
- Dismiss only with explicit evidence.

- [ ] **Step 3: Dry-run and apply repair**

Run:

```bash
npx tsx Scripts/repair-player-directory.ts --season 2026 --dry-run
npx tsx Scripts/repair-player-directory.ts --season 2026
```

Expected:

- Dry run reports intended player/alias/registration/decision changes.
- Apply mutates Prisma identity data only after validation passes.

## Task 7: Implement Bounded Rematerialization

**Files:**
- Modify: `Scripts/build-player-read-models.ts`
- Modify: `src/server/readModels/playerReadModels.ts`
- Modify: `src/app/api/etl/import-rounds/route.ts`
- Test: read-model and import route tests.

- [ ] **Step 1: Confirm current scope support**

Run:

```bash
rg -n "rounds|playerId|matchId|refreshPlayerReadModels|buildPlayerSeasonSummaries|PlayerProjectionPublication" Scripts/build-player-read-models.ts src/server/readModels/playerReadModels.ts src/app/api/etl/import-rounds/route.ts
```

Expected:

- Identify which loaders already accept bounded scope and which still force full-season refresh.

- [ ] **Step 2: Add bounded rebuild API**

Target shape:

```ts
type ReadModelRefreshScope = {
  season: number;
  rounds?: number[];
  matchIds?: string[];
  playerIds?: string[];
  publish?: boolean;
};
```

Rule:

- Full-season rebuild remains available but must be explicit for broad backfill/recovery.

- [ ] **Step 3: Wire import success to bounded rebuild**

For import route:

- successful import of season/rounds triggers rebuild for those rounds.
- response includes rebuild scope, publication status, and verification hint.

Expected:

- Importing rounds 0,1 does not rebuild unrelated rounds unless explicitly requested.

## Task 8: Harden Security And Observability

**Files:**
- Modify: `src/app/api/etl/import-rounds/route.ts`
- Modify: rebuild/repair scripts where applicable.
- Modify: `docs/DATA_RELIABILITY.md`
- Test: route auth tests.

- [ ] **Step 1: Define environment policy**

Policy:

- Local development may use explicit local bypass.
- Shared staging and production require configured credentials.
- Mutation routes must log actor, scope, dry-run/apply mode, and result counts.

- [ ] **Step 2: Add structured audit output**

Every import/rebuild/repair response or log must include:

- `operation`
- `season`
- `rounds` or scope
- `dryRun`
- `actor` or credential label
- `rawRowsWritten`
- `projectionRowsPublished`
- `durationMs`
- `status`

Expected:

- A failed mutation path is diagnosable without re-running broad commands.

## Task 9: Run Full Verification Matrix

**Files:**
- Read only unless failures are found.

- [ ] **Step 1: Run static checks**

Run:

```bash
npm run typecheck
npm run lint
npm test
```

Expected:

- All pass, or failures are classified into convergence vs unrelated product work.

- [ ] **Step 2: Run scoped convergence checks**

Run:

```bash
npm run verify:player-read-models -- --season 2026 --rounds 0,1 --json --trace --limit 25
npm run verify:player-read-models -- --season 2026 --rounds 0,1 --include-merged-live --data-source afltables,footywire_match --json --trace --merged-timeout-ms 240000 --limit 25
```

Expected:

- `dropped_before_raw: 0`
- `dropped_in_projection: 0`
- `raw_presence_mismatch: 0`
- aggregate mismatches: `0`

- [ ] **Step 3: Expand verification scope**

Run the same verifier for the next bounded slice, not the full season first:

```bash
npm run verify:player-read-models -- --season 2026 --rounds 2,3 --json --trace --limit 25
```

Expected:

- Any failures become the next bounded repair plan with classified causes.

## Task 10: Prepare Review And Merge Package

**Files:**
- Modify: docs and final release notes.
- Stage only reviewed files.

- [ ] **Step 1: Split unrelated files**

Rules:

- Do not include `.firebase-data/**` or `prisma/dev.db`.
- Do not include unrelated UI/product changes in the data-convergence package unless explicitly required.
- If mixed changes cannot be separated safely, document them under `Needs Manual Review`.

- [ ] **Step 2: Produce final verification summary**

Summary must include:

- contract/invariant changes
- schema design findings
- files changed
- migration risks
- verification performed
- remaining gaps

- [ ] **Step 3: Stage reviewed files only**

Run:

```bash
git add <reviewed file list>
git status --short
```

Expected:

- Staged files match the convergence release package only.

## Acceptance Criteria

- Dirty tree is classified and local artifacts are excluded from ship set.
- Database/schema review exists and all required fixes are either implemented or tracked.
- Canonical stat, presence, provenance, source priority, team identity, match identity, and player identity semantics are defined once or isolated behind temporary adapters with exit criteria.
- Prisma identity facts are normalized and evidence-backed.
- Read models are serving projections only.
- Import/repair/rebuild paths are scoped, authorized, and observable.
- 2026 rounds 0-1 pass persisted and live verifier modes.
- Next bounded slice has either passed or has a concrete follow-up repair plan.
