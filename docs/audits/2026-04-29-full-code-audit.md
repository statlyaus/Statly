# Full Code Audit - 2026-04-29

## Scope

- Repository: `/Users/robert/Developer/Statly`
- Branch: `chore/harden-firebase-20250910-163519`
- Base branch: `main`
- Worktree state: large dirty worktree with 76 modified/deleted tracked files plus untracked docs, scripts, tests, migrations, server modules, and UI modules.
- Audit objective: identify the highest-value long-term fixes needed for correctness, reliability, security, accessibility, and maintainability.
- Out of scope: applying production-code fixes during the audit unless separately approved.

## Executive Summary

- Overall risk: Critical. Native coordinator checks and four read-only subagent reviews found tracked production env secrets, unauthenticated admin operational controls, public read paths that can trigger live ETL mutation, unresolved Footywire verification gaps, failing release tests, formatting drift, and frontend/debug controls exposed in production UI.
- Release recommendation: Block release until P0 findings are fixed and verified.
- Highest-priority architectural risk: Footywire verification can return warning status while `dropped_before_raw` / `dropped_in_projection` remain, and the import route's suggested verifier command does not include merged live-source comparison.
- Highest-priority operational risk: `/api/admin/workers` and `/api/admin/queue` expose admin and worker/queue operations without route-level authorization.
- Highest-priority UI/accessibility risk: production draft UI exposes debug/force-entry controls, and key draft/navigation components have accessibility semantics gaps.

## Decision Standard

A recommendation is accepted only if it moves Statly toward a durable target state:

- one canonical persisted raw-match contract for Footywire-derived player-match data
- no permanent downstream semantic fallbacks when canonical data exists
- explicit missing, zero, absent, provenance, source priority, match identity, and player identity semantics
- successful imports paired with bounded rebuild or rematerialization for affected projections
- mutation routes with explicit authorization and observable operational behavior
- shadcn-style UI using semantic tokens, accessible primitives, keyboard support, and predictable composition
- tests and scripts that prove behavior at the same boundary where the risk exists

## Findings

### P0: Tracked production env secrets are present and copied into standalone output

- Severity: Critical
- Area: security / operations
- Evidence: `git ls-files .env.production` returns `.env.production`; variable-name inspection shows production-sensitive entries including `DATABASE_URL`, `NEXTAUTH_SECRET`, and `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64`; `npm run guard:secrets` fails on `BEGIN_PRIVATE_KEY`, including `.next/standalone/.env.production`.
- Invariant at risk: secrets must not be tracked in git or copied into deployable build artifacts.
- Impact: production database/session/Firebase credential material can leak through repository history, local clones, build artifacts, or standalone deployment uploads.
- Best long-term fix: rotate exposed credentials, remove `.env.production` from tracking and git history, prevent standalone builds from bundling env files, and extend secret guards to scan tracked env files before build outputs.
- Migration or rollout risk: high; rotation and deployment secret injection must be coordinated to avoid outage.
- Verification required: `git ls-files .env.production` returns nothing, `npm run guard:secrets` passes, and deployment still receives runtime secrets from the environment.
- Source: security subagent / native coordinator
- Status: Open

### P0: Admin worker and queue APIs are unauthenticated

- Severity: Critical
- Area: security / operations
- Evidence: `middleware.ts:9-36` lets `/api/*` routes pass through without enforcing authentication; `src/app/api/admin/workers/route.ts:15-66` exposes worker stats/health and `src/app/api/admin/workers/route.ts:68-164` exposes start, stop, restart, add, and remove worker operations; `src/app/api/admin/queue/route.ts:36-59` exposes queue monitoring and the security subagent found queue mutation actions later in the file.
- Invariant at risk: mutation and operational routes must have explicit authorization and observable operational behavior.
- Impact: an unauthenticated caller can inspect queue/worker state and can stop, restart, add, or remove workers through `/api/admin/workers`.
- Best long-term fix: centralize an admin-route authorization helper that verifies a server-side admin session or an explicit admin token, apply it to every `/api/admin/*` route, add tests for authorized and unauthorized access, and protect `/admin/*` pages through middleware or server-side auth.
- Migration or rollout risk: medium; existing admin UI clients must send the accepted credential or rely on verified session context.
- Verification required: add route tests for `/api/admin/workers` and `/api/admin/queue`, run `npx vitest run src/app/api/admin`, and verify unauthenticated requests return 401/403 while authorized requests still work.
- Source: security subagent / native coordinator
- Status: Open

### P1: Public read endpoints trigger live ETL writes and imports

- Severity: Major
- Area: security / operations
- Evidence: `rg -n "refreshLiveStatsIfNeeded" src/app/api src/lib` shows public GET/read paths including `src/app/api/live-player-stats/route.ts`, `src/app/api/etl/live-player-stats/route.ts`, `src/app/api/etl/live-matches/route.ts`, league matchup routes, and season-state routes call `refreshLiveStatsIfNeeded`; the security subagent verified that helper writes `_system/live_stats_refresh`, imports Footywire rounds, and primes matchup slates.
- Invariant at risk: public read paths must not mutate canonical raw data or run import/repair work outside explicit authorization and observability.
- Impact: public traffic can trigger raw-data mutation, external scraping, operational load, and a separate import path from the bounded import/rematerialization contract.
- Best long-term fix: split reads from mutation. Move live refresh to cron/admin-controlled paths with explicit auth, observability, and projection refresh semantics; public reads should consume current projections only.
- Migration or rollout risk: medium; product freshness expectations must be preserved by scheduled or admin-triggered refresh.
- Verification required: `rg -n "refreshLiveStatsIfNeeded" src/app/api` only shows authorized mutation paths, plus `npx vitest run src/app/api/etl/import-rounds/route.test.ts src/app/api/cron/live-stats/route.test.ts`.
- Source: security subagent
- Status: Open

### P1: Cron and admin repair routes fail open when secrets are absent outside production

- Severity: Major
- Area: security / operations
- Evidence: security subagent found `src/app/api/cron/live-stats/route.ts`, `src/app/api/cron/reminders/route.ts`, and `src/app/api/admin/draft-repair/route.ts` allow mutation/repair work when secrets are absent in non-production environments.
- Invariant at risk: high-impact mutation paths need explicit authorization by environment; shared preview/staging environments must not inherit local-dev permissiveness.
- Impact: staging, preview, or misconfigured shared environments can run mutation/repair jobs without credentials.
- Best long-term fix: use a shared operational-auth helper that allows unauthenticated access only for explicit local development, and make deploy validation require `CRON_SECRET`/admin tokens for shared environments.
- Migration or rollout risk: medium; previews and local scripts need explicit token setup.
- Verification required: `npx vitest run src/app/api/cron/live-stats/route.test.ts src/app/api/cron/daily/route.test.ts src/app/api/admin/draft-repair/route.test.ts`.
- Source: security subagent
- Status: Open

### P1: Verifier can pass automation while dropped rows remain

- Severity: Major
- Area: Footywire contract / projection
- Evidence: Footywire subagent found `Scripts/verify-player-read-models-core.ts:614` can return `warn` for small mismatch counts, and `Scripts/verify-player-read-models.ts:78` exits non-zero only for `fail`; `dropped_before_raw` and `dropped_in_projection` are normal mismatch records.
- Invariant at risk: repaired scopes must trend `dropped_before_raw` and `dropped_in_projection` to zero and fail verification when they remain.
- Impact: a repair can be reported operationally acceptable while the explicit failure classes remain unresolved.
- Best long-term fix: make any `dropped_before_raw` or `dropped_in_projection` fail for claimed repair scopes; reserve `warn` for explicitly non-blocking diagnostics.
- Migration or rollout risk: medium; existing repair slices may start failing until drift is repaired.
- Verification required: `npx vitest run tests/verify-player-read-models-core.test.ts`.
- Source: Footywire subagent
- Status: Open

### P1: Import audit command cannot detect `dropped_before_raw`

- Severity: Major
- Area: Footywire contract / operations
- Evidence: Footywire subagent found `src/app/api/etl/import-rounds/route.ts:101` returns a verifier command without `--include-merged-live`, while `Scripts/verify-player-read-models-core.ts:478` emits `dropped_before_raw` only when merged and raw stages are both populated.
- Invariant at risk: import repair verification must validate convergence between source, raw, and projection stages.
- Impact: operators can run the route-provided verification and miss source-to-raw drops.
- Best long-term fix: return and/or run a bounded verifier command with `--include-merged-live`, and fail the route/audit result when dropped classes remain.
- Migration or rollout risk: medium; live merged-source verification may require R/runtime availability and clear timeout behavior.
- Verification required: `npm run verify:player-read-models -- --season 2026 --rounds 0,1 --data-source afltables,footywire_match --include-merged-live --json`.
- Source: Footywire subagent
- Status: Open

### P1: Successful import leaves app-facing rankings and rosters stale

- Severity: Major
- Area: Footywire projection / operations
- Evidence: Footywire subagent found `src/app/api/etl/import-rounds/route.ts:101` only calls `refreshPlayerReadModels`; `refreshPlayerReadModels` marks `rankingsDirty` and `rostersDirty`, while `Scripts/build-player-read-models.ts:67` separately publishes rankings and roster summaries.
- Invariant at risk: successful imports must trigger rebuild or rematerialization needed for app-facing correctness.
- Impact: raw and match-log projections can be current while rankings and roster read models remain stale after import.
- Best long-term fix: make import repair operationally complete by refreshing bounded player/match-log projections, then publishing or enqueueing dependent ranking/roster projections with the smallest valid scope.
- Migration or rollout risk: medium; publication scope must be bounded to avoid expensive full-season work.
- Verification required: `npm run build:player-read-models -- --mode full --season 2026 --rounds 0,1`.
- Source: Footywire subagent
- Status: Open

### P1: Production draft room exposes debug and force-entry controls

- Severity: Major
- Area: UI / operations
- Evidence: `rg -n "Force Lobby|Force Enter Draft Room|FORCED MODE|Debug: Status|Test API|/test-draft" src/components/draft src/app/drafts` shows `src/components/draft/DraftContainer.tsx` renders `/test-draft`, debug status, forced mode, force lobby, force draft-room entry, and `Test API` controls.
- Invariant at risk: production UI must not expose debug or bypass controls for live operational flows.
- Impact: users can bypass intended lobby flow in the UI, creating trust and live-draft integrity risk even if APIs reject later actions.
- Best long-term fix: remove force/debug controls from production UI; keep diagnostics behind a dev-only, server-authorized diagnostics surface.
- Migration or rollout risk: low; dev workflow needs a replacement local diagnostics path.
- Verification required: `rg -n "Force Lobby|Force Enter Draft Room|FORCED MODE|Debug: Status|Test API|/test-draft" src/components/draft src/app/drafts` returns no production UI matches.
- Source: frontend subagent / native coordinator
- Status: Open

### P1: Tracked pglite database internals block secondary external review tooling

- Severity: Major
- Area: maintainability / operations
- Evidence: CodeRabbit failed while running `git diff main...HEAD -- dataconnect/.dataconnect/pgliteData/pg17/base/5/6176`; `git ls-files dataconnect/.dataconnect/pgliteData` and `git diff --name-only main...HEAD -- dataconnect/.dataconnect/pgliteData` both show pglite database internals are tracked and present in the branch diff.
- Invariant at risk: generated local artifacts should not be part of the source contract or review surface.
- Impact: CodeRabbit cannot complete a full review; large volatile DB files increase review noise and can destabilize local/CI tooling.
- Best long-term fix: remove `dataconnect/.dataconnect/pgliteData/` from version control in a dedicated cleanup task, keep it ignored, and enforce the artifact guard in pre-push/CI.
- Migration or rollout risk: low if the files are local emulator state; verify no deterministic fixture depends on these binary/internal database paths before removal.
- Verification required: `git ls-files dataconnect/.dataconnect/pgliteData` returns no files, `npm run guard:tracked-artifacts` passes, and CodeRabbit completes.
- Status: Open

### P1: Player search API now fails its route contract under test

- Severity: Major
- Area: test coverage / user-facing API
- Evidence: `npm test` failed three `src/app/api/players/search/route.test.ts` cases; each expected HTTP 200 but received HTTP 500. The route now calls `statsReadService.resolveSeason`, `statsReadService.ensureSeasonReady`, and `statsReadService.getSeasonSummaryMap` at `src/app/api/players/search/route.ts:85-90`, while the test still mocks the old precomputed-stats path and expects local-data fallback behavior.
- Invariant at risk: read APIs should either consume current projections reliably or degrade through an intentional, tested fallback when projections are unavailable.
- Impact: player search can fail entirely when read-model materialization or Prisma availability is not ready, even though the route has enough local player data to return useful search results.
- Best long-term fix: make player search use a single StatsReadService-backed contract with explicit fallback semantics, inject or mock that service in tests, and decide whether projection unavailability should be a 500 or a degraded 200 response. If degraded behavior is desired, catch projection-read failures around the stats enrichment boundary, log them, and return local player results with empty stats.
- Migration or rollout risk: medium; changing fallback behavior affects API consumers that may currently rely on error signaling.
- Verification required: `npx vitest run src/app/api/players/search/route.test.ts`, full `npm test`, and one manual API check against a database with no materialized summaries.
- Status: Open

### P1: Full Vitest suite is failing

- Severity: Major
- Area: test coverage / release verification
- Evidence: `npm test` failed with 2 failed files and 4 failed tests: three `/api/players/search` status failures and one `AuthForm` valid-submit timeout at `src/components/__tests__/AuthForm.test.tsx:138`.
- Invariant at risk: release verification must prove behavior, not only typecheck and focused suites.
- Impact: regressions can ship in user-facing search and authentication flows even though focused convergence tests pass.
- Best long-term fix: fix the player-search service contract and make the AuthForm submit test deterministic by aligning it with the component's async validation/submission behavior rather than increasing timeout as a first response.
- Migration or rollout risk: low to medium; fixes should be test-only or narrowly scoped route/component behavior.
- Verification required: `npm test`.
- Status: Open

### P2: Formatting drift spans source, scripts, tests, and docs

- Severity: Minor
- Area: maintainability
- Evidence: `npm run format:check` failed across 46 files, including `etl/processFootywireData.ts`, `Scripts/build-player-read-models.ts`, `Scripts/verify-player-read-models-core.ts`, `src/lib/stats/footywireCanonicalContract.ts`, `src/server/readModels/playerReadModels.ts`, route tests, and docs.
- Invariant at risk: diffs should remain reviewable, especially in large architectural repair branches.
- Impact: formatting noise hides semantic changes and makes CodeRabbit/manual review less effective.
- Best long-term fix: run Prettier as a dedicated formatting cleanup after deciding the branch scope, then keep `format:check` in pre-push/CI.
- Migration or rollout risk: low, but formatting should be isolated from semantic fixes.
- Verification required: `npm run format:check`.
- Status: Open

### P2: Tracked-artifact guard misses the pglite artifact class that blocks CodeRabbit

- Severity: Minor
- Area: operations / maintainability
- Evidence: `npm run guard:tracked-artifacts` passed, but `git ls-files dataconnect/.dataconnect/pgliteData` and `git diff --name-only main...HEAD -- dataconnect/.dataconnect/pgliteData` show tracked pglite internals. `Scripts/check-tracked-local-artifacts.mjs:3` only checks `.firebase/**`, `firebase-export-*/**`, `prisma/*.db`, and `tmp-*.png`.
- Invariant at risk: local generated artifacts must not become part of the source contract or review surface.
- Impact: the guard gives false confidence while CodeRabbit and branch review remain blocked by generated database internals.
- Best long-term fix: add `dataconnect/.dataconnect/pgliteData/**` and any other local emulator/database output paths to the guard and `.gitignore`, then remove currently tracked artifacts in a dedicated cleanup.
- Migration or rollout risk: low after confirming no deterministic fixture depends on those files.
- Verification required: `npm run guard:tracked-artifacts`, `git ls-files dataconnect/.dataconnect/pgliteData`, and CodeRabbit review.
- Status: Open

### P2: Read-model scripts treat `--help` as a live operation

- Severity: Minor
- Area: operations / verification
- Evidence: `npm run build:player-read-models -- --help` and `npm run verify:player-read-models -- --help` both initialized Firebase and attempted Prisma reads, failing with `The table main.Player does not exist in the current database.` `Scripts/build-player-read-models.ts:11-40` parses known args but has no help branch, and `Scripts/verify-player-read-models.ts:24-30` goes straight into verification.
- Invariant at risk: repair and verification operations should be bounded, repeatable, and operationally safe.
- Impact: operators cannot safely discover usage without touching live dependencies; missing local DB setup produces noisy failures instead of actionable usage.
- Best long-term fix: implement explicit `--help` handling before importing or initializing live services, document required environment/database prerequisites, and return exit code 0 for help.
- Migration or rollout risk: low.
- Verification required: both `npm run build:player-read-models -- --help` and `npm run verify:player-read-models -- --help` print usage and exit 0 without Firebase/Prisma initialization.
- Status: Open

### P2: Source-priority vocabulary is duplicated and can drift

- Severity: Minor
- Area: Footywire contract
- Evidence: Footywire subagent found `src/lib/stats/footywireCanonicalContract.ts:65` ranks `fitzroy_merged`, `footywire_match`, `afltables`, `legacy_top_level`; `src/lib/footywireStatsIngestion.ts:102` ranks `footywire_match`, `fryzigg`, `afltables`; `etl/processFootywireData.ts:351` has another source-priority path.
- Invariant at risk: canonical source priority must be defined once and reused across ETL, ingestion, reconciliation, and read models.
- Impact: merged-source reconciliation can select a different value/provenance than the Firestore canonical writer.
- Best long-term fix: centralize source priority in the canonical contract and normalize producer source names at ingestion boundaries.
- Migration or rollout risk: medium; changing priority can alter selected values in repaired slices.
- Verification required: `npx vitest run src/lib/footywireStatsIngestion.test.ts src/server/processFootywireData.test.ts src/lib/stats/footywireCanonicalContract.test.ts`.
- Source: Footywire subagent
- Status: Open

### P2: Provenance is dropped at match-log projection persistence

- Severity: Minor
- Area: Footywire projection
- Evidence: Footywire subagent found raw reconciliation reads canonical stat provenance in `src/server/readModels/playerReadModels.ts:294`, but `PlayerMatchLogProjectionRow`, `PlayerMatchLogProjection.statsJson`, and Prisma projection storage persist stats/availability without provenance.
- Invariant at risk: provenance must survive canonicalization, persistence, repair, rebuild, and projection.
- Impact: projected-stage reconciliation cannot detect provenance loss, and downstream app data cannot be traced back to source priority.
- Best long-term fix: persist projection provenance alongside stats/availability and include it in projected-stage reconciliation.
- Migration or rollout risk: medium; requires Prisma schema and projection migration.
- Verification required: `npx vitest run src/server/readModels/playerReadModels.test.ts tests/verify-player-read-models-core.test.ts`.
- Source: Footywire subagent
- Status: Open

### P2: `typecheck:data` is broken and not part of CI/prepush

- Severity: Minor
- Area: test coverage / release gates
- Evidence: tooling subagent ran `npx tsc -p tsconfig.data.json --noEmit` and found hundreds of strict optional/indexing errors; `package.json` exposes `typecheck:data`, but `prepush:ci` and CI only run `npm run typecheck`.
- Invariant at risk: named health checks should either pass and be part of the gate or be retired so the checked surface is honest.
- Impact: stricter data/read-model drift can accumulate outside normal release checks.
- Best long-term fix: make `typecheck:data` pass and add it to prepush/CI, or retire/rename it with an explicit replacement.
- Migration or rollout risk: medium; fixing the data TS project may surface real ETL/read-model typing gaps.
- Verification required: `npm run typecheck:data`.
- Source: tooling subagent
- Status: Open

### P2: Broad UI styling drift from shadcn semantic-token principles

- Severity: Minor
- Area: UI / maintainability
- Evidence: style search found hard-coded color utilities and arbitrary hex gradients in `src/app/page.tsx:75`, `src/app/fantasy/page.tsx:66`, `src/components/matchup/LiveScoringMatchup.tsx`, and `src/components/OfferDock.tsx`.
- Invariant at risk: UI should prefer semantic theme tokens, accessible primitives, and predictable shadcn-style composition.
- Impact: light/dark mode support and visual consistency become harder to maintain, and future design-system changes require broad one-off edits.
- Best long-term fix: create a design-system alignment work package that replaces hard-coded palettes with semantic tokens and existing component primitives, starting with active app surfaces before older/demo surfaces.
- Migration or rollout risk: medium if done as a broad visual refactor; lower if handled one surface at a time with screenshots and focused tests.
- Verification required: focused UI tests plus browser screenshots for updated surfaces.
- Status: Open

## Native Subagent Review

Native Codex subagent review is the primary review source for this audit.

Completed native subagent workstreams:

- Security and operations
- Footywire contract convergence
- Tests, tooling, and release gates
- Frontend, accessibility, and shadcn alignment

The previously installed `codex-code-review` skill is not used as the primary gate for this audit.

## Secondary Review Tooling: CodeRabbit

CodeRabbit is now treated as the secondary external review pass. It did not complete, so it raised 0 reportable issues for this audit.

Blocked by:

```text
Review failed: Failed to get file changes: Failed to get committed diff for dataconnect/.dataconnect/pgliteData/pg17/base/5/6176: Command failed with EAGAIN: git diff main...HEAD -- dataconnect/.dataconnect/pgliteData/pg17/base/5/6176
EAGAIN: resource temporarily unavailable, posix_spawn '/usr/bin/git'
```

Required unblock before relying on secondary CodeRabbit:

- Remove generated `dataconnect/.dataconnect/pgliteData/` internals from version control in a separate cleanup task.
- Keep the ignore rule and artifact guard so local database internals cannot re-enter the review surface.

## Local Verification Result

| Check | Command | Status | Evidence | Long-term implication |
| --- | --- | --- | --- | --- |
| Typecheck | `npm run typecheck` | PASS | App and test TypeScript projects passed after `next typegen`. | Type contracts compile. |
| Lint | `npm run lint` | PASS | ESLint completed for `src`. | Current source passes configured lint rules. |
| Format | `npm run format:check` | FAIL | Prettier reported 46 unformatted files. | Reviewability is degraded until isolated formatting cleanup runs. |
| Route guards | `npm run guard:routes` | PASS | 8 ETL routes and 113 API routes checked for runtime/admin usage. | Runtime boundaries pass, but auth posture is not covered by this guard. |
| Secret guard | `npm run guard:secrets` | FAIL | Private-key-like content found in build outputs, including `.next/standalone/.env.production`. | Release artifact safety is blocked. |
| Artifact guard | `npm run guard:tracked-artifacts` | PASS WITH GAP | Guard passed, but pglite internals are tracked and block CodeRabbit. | Guard coverage is incomplete. |
| Dependency guard | `npm run guard:deps` | PASS | `forbid-server-imports` scanned 665 files. | Server/client import boundary currently passes. |
| Full tests | `npm test` | FAIL | 4 tests failed across player search and AuthForm. | Release verification is blocked. |
| Focused convergence tests | `npx vitest run ...footywire/read-model tests` | PASS | 42 tests passed. | Canonical contract/read-model unit coverage is healthy for tested paths. |
| Focused import/repair tests | `npx vitest run ...import/repair tests` | PASS | 19 tests passed. | Import route, cron route, repair, roster evidence, and identity focused tests passed. |
| Focused UI tests | `npx vitest run ...UI tests` | PASS | 8 tests passed. | Tested players/league tab interactions remain stable. |

## Footywire Contract and Projection Review

- Canonical contract ownership exists in `src/lib/stats/footywireCanonicalContract.ts`, including canonical stat fields, availability, provenance, source priority, and stat-key mapping.
- ETL writes canonical payloads through `etl/processFootywireData.ts`, including `canonical_stats`, `source_provenance`, `canonical_match_identity`, and `canonical_match_metadata`.
- Read-model stat consumption in `src/server/readModels/playerReadModels.ts` is canonical-first and does not fall back to legacy stat values once `canonical_stats` exists.
- Successful imports in `src/app/api/etl/import-rounds/route.ts` call `refreshPlayerReadModels` with bounded `season` and `rounds`, and the response includes a verifier command.
- Focused convergence tests passed, including canonical contract, ingestion, ETL, read model, and verifier-core tests.
- Remaining risk is operational, not core stat semantics: verification scripts need safe help/usage behavior, and identity fallback for raw rows remains observable but does not yet have a documented removal threshold for repaired scopes.

## Security and Operational Review

- Import and cron mutation paths reviewed in this audit have explicit token checks with development-only permissive defaults.
- `/api/admin/workers` and `/api/admin/queue` do not have route-level authorization and are not protected by middleware. This is a P0 release blocker.
- Build-output secret scanning fails because `.next/standalone/.env.production` contains private-key-like material. This is a P0 release blocker if standalone artifacts can be deployed, archived, or shared.
- Read-model verification scripts do not expose safe `--help` behavior and fail against the current local database.

## UI and Accessibility Review

- Focused UI tests passed for player table behavior, league tabs, and league stat-column selection.
- Key interactive controls inspected in the focused files generally include accessible labels where needed, such as sortable player columns and navigation toggles.
- Broad design-token drift remains across app/components. This should be handled as a dedicated design-system alignment work package, not mixed into data-pipeline repair.

## Test Coverage Review

- Test inventory: 81 test files under `src` and `tests`.
- Strong coverage exists around Footywire canonical contract, ingestion, ETL, read-model projection, verifier-core behavior, import route, cron route, repair, roster evidence, and identity resolver.
- Current full-suite blockers:
  - `/api/players/search` route contract is failing.
  - `AuthForm` valid-submit test is nondeterministic or no longer aligned with component behavior.
- Missing proof to add after fixes:
  - `/api/admin/workers` and `/api/admin/queue` unauthorized/authorized route tests.
  - Artifact guard test or fixture covering `dataconnect/.dataconnect/pgliteData/**`.
  - Secret guard verification after standalone build changes.
  - Script help behavior tests or snapshot checks for read-model scripts.

## Long-Term Remediation Roadmap

### Work Package 1: Admin Route Authorization

Goal: close unauthenticated admin and worker/queue operational surfaces.

Files:

- `src/app/api/admin/workers/route.ts`
- `src/app/api/admin/queue/route.ts`
- `middleware.ts`
- new or existing route tests under `src/app/api/admin/**`

Risks addressed: P0 admin mutation exposure.

Verification: route tests for unauthorized and authorized requests, `npm run guard:routes`, `npm run guard:deps`, and manual request checks.

### Work Package 2: Secret and Generated-Artifact Hygiene

Goal: remove tracked production env files, generated local database internals, and secret-bearing standalone build outputs from review/deploy surfaces.

Files:

- `.gitignore`
- `Scripts/check-tracked-local-artifacts.mjs`
- `scripts/scan-secrets.ts`
- deployment/build configuration if it copies `.env.production`

Risks addressed: tracked production env secrets, P0 secret-like standalone output, P1 CodeRabbit blocker, and P2 artifact guard gap.

Verification: `git ls-files .env.production`, `npm run guard:secrets`, `npm run guard:tracked-artifacts`, `git ls-files dataconnect/.dataconnect/pgliteData`, and successful secondary CodeRabbit review.

### Work Package 3: Player Search Read-Model Contract

Goal: make player search reliably consume projections or intentionally degrade when projections are unavailable.

Files:

- `src/app/api/players/search/route.ts`
- `src/app/api/players/search/route.test.ts`
- possibly `src/server/stats/StatsReadService.ts`

Risks addressed: P1 route contract failure and full-suite test failure.

Verification: `npx vitest run src/app/api/players/search/route.test.ts`, `npm test`, and manual API check against a DB without materialized summaries.

### Work Package 4: AuthForm Test Determinism

Goal: align the valid-submit test with actual async form behavior.

Files:

- `src/components/__tests__/AuthForm.test.tsx`
- component file if the test reveals a real submit bug

Risks addressed: P1 full-suite blocker.

Verification: `npx vitest run src/components/__tests__/AuthForm.test.tsx` and `npm test`.

### Work Package 5: Read-Model Script Operator UX

Goal: make repair and verification scripts safe and discoverable before live dependencies initialize.

Files:

- `Scripts/build-player-read-models.ts`
- `Scripts/verify-player-read-models.ts`
- `Scripts/verify-player-read-models-core.ts`

Risks addressed: P2 unsafe `--help` behavior.

Verification: both script `--help` commands print usage and exit 0 without Firebase/Prisma initialization.

### Work Package 6: Isolated Formatting Cleanup

Goal: restore reviewable diffs without mixing formatting with semantic repairs.

Files: the 46 files reported by `npm run format:check`.

Risks addressed: P2 formatting drift.

Verification: `npm run format:check`.

### Work Package 7: UI Design-System Alignment

Goal: reduce hard-coded styling drift and improve long-term shadcn/theme-token maintainability.

Files:

- active app surfaces first, including `src/app/page.tsx`, `src/app/fantasy/page.tsx`, `src/app/players/PlayersPageClient.tsx`, and active navigation/league components
- older/demo surfaces later

Risks addressed: P2 UI styling drift.

Verification: focused UI tests and browser screenshots for changed surfaces.

## Blocked Checks

- Secondary CodeRabbit review is blocked by tracked pglite internals in `dataconnect/.dataconnect/pgliteData/`.
- Release verification is blocked by `npm test` failures.
- Release verification is blocked by `npm run guard:secrets` failures.
- Formatting verification is blocked by 46 unformatted files.
