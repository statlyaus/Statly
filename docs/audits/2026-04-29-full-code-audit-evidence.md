# Full Code Audit Evidence - 2026-04-29

## Repository Baseline

- Repository root: `/Users/robert/Developer/Statly`
- Branch: `chore/harden-firebase-20250910-163519`
- Recent commits:
  - `099d9a0 fix: Next build TS boundary, compile-phase auth bypass, seedRoomMeta import`
  - `0c5c623 chore: read-model health, CI, tsconfigs, scripts, and app hardening`
  - `8a47c77 chore(trade): archive PHP trade module under archive/php-trade-module`
  - `f5e0d62 chore: drop tracked local DB and export artifacts; add pre-push hook`
  - `3535dc3 refactor: update environment configuration and enhance deployment scripts`
- Diff stat: 76 tracked files changed with 8,365 insertions and 3,470 deletions.
- Worktree note: numerous untracked files are present, including audit docs, Footywire architecture docs, migrations, route tests, canonical contract files, repair scripts, ranking modules, and draft-room components.

## Native Subagent Review

- Primary review source: native Codex review with four read-only subagents.
- Workstreams completed:
  - Security and operations.
  - Footywire contract convergence.
  - Tests, tooling, and release gates.
  - Frontend, accessibility, and shadcn alignment.
- Subagent editing status: no subagent edited files.
- Coordinator merge rule: duplicate findings were merged by root cause; unsupported findings were excluded.

### Security and Operations Subagent

- P0: tracked `.env.production` contains production-sensitive variable names and is copied into `.next/standalone/.env.production`; `npm run guard:secrets` fails on private-key markers.
- P0: `/api/admin/workers` and `/api/admin/queue` expose operational controls without route-level auth.
- P1: public read endpoints call `refreshLiveStatsIfNeeded`, which can mutate live stats/import state.
- P1: cron/admin repair routes fail open when secrets are absent outside production.
- P2: public `admin-check` exposes credential metadata and Firestore status.
- P2: tracked-artifact guard misses pglite internals.
- P2: test/dev mutation endpoints are blocked only in production, not explicit local-only mode.
- Commands included `npm run guard:secrets`, `npm run guard:tracked-artifacts`, `npm run guard:routes`, `git ls-files .env.production dataconnect/.dataconnect/pgliteData`, and targeted route tests.
- Blocked: no tests exist for `/api/admin/workers`, `/api/admin/queue`, or `/api/admin-check`.

### Footywire Contract Subagent

- P1: verifier can exit 0 with `dropped_before_raw` or `dropped_in_projection` still present because small mismatch counts return `warn`.
- P1: import route returns a verifier command that cannot detect `dropped_before_raw` because it omits `--include-merged-live`.
- P1: successful import refreshes player read models but leaves rankings/rosters dirty rather than publishing or enqueueing dependent projections.
- P2: source-priority vocabulary is duplicated across canonical contract, ingestion, and ETL.
- P2: provenance is not persisted through match-log projection storage.
- Commands included targeted `rg`/`nl` inspections and `npx vitest run tests/verify-player-read-models-core.test.ts`.
- Blocked: no live Firestore/R/Prisma import/rebuild verification was run.

### Tests and Tooling Subagent

- P1: `npm run guard:secrets` fails and CI uploads `.next/standalone` after the secret guard step.
- P1: `npm test` is red; player search tests return 500 and one full-suite Footywire test is load/order sensitive.
- P2: read-model scripts treat `--help` as a live operation.
- P2: `typecheck:data` is broken and absent from CI/prepush.
- P2: `npm run format:check` fails across 46 files.
- Commands included `npm test`, `npm run format:check`, `npm run guard:secrets`, `npm run guard:tracked-artifacts`, `npm run typecheck`, `npx eslint --no-cache src`, `npm run guard:routes`, `npm run guard:deps`, `npm run env:check:firebase`, and `git diff --check`.
- Blocked: `npm run build` was not run because this was a read-only audit and the existing `.next` output was enough for secret-guard evidence.

### Frontend and Accessibility Subagent

- P1: production draft room exposes debug and force-entry controls.
- P2: tools navigation dropdown lacks complete disclosure/menu accessibility semantics.
- P2: draft player grid uses pseudo-table roles without a parent grid/table and is not actually virtualized.
- P2: `LeagueTabs.tsx` is a 2,778-line all-client surface mixing navigation, mutation, settings, roster actions, and player research.
- P3: design-system token drift across public and draft surfaces.
- P3: high-impact roster actions use native `confirm`/`alert` instead of app dialogs.
- Commands included targeted source inspection, `npx eslint --no-cache`, `npm run typecheck:app`, and focused UI tests.
- Blocked: none.

## Secondary Review Tooling: CodeRabbit

- CLI version: `0.4.4`
- Auth status: authenticated as GitHub user `statlyaus`.
- Attempt 1 command: `/Users/robert/.local/bin/coderabbit review --agent -c AGENTS.md -c .coderabbit.yaml -c CLAUDE.md`
- Attempt 1 result: failed before emitting findings.
- Exact failure:

```text
Review failed: Failed to get file changes: Failed to get committed diff for dataconnect/.dataconnect/pgliteData/pg17/base/5/6176: Command failed with EAGAIN: git diff main...HEAD -- dataconnect/.dataconnect/pgliteData/pg17/base/5/6176
EAGAIN: resource temporarily unavailable, posix_spawn '/usr/bin/git'
```

- Artifact blocker:
  - `git ls-files dataconnect/.dataconnect/pgliteData` shows tracked pglite database internals.
  - `git status --short dataconnect/.dataconnect/pgliteData` shows no current working-tree modifications under that path.
  - `git diff --name-only main...HEAD -- dataconnect/.dataconnect/pgliteData` shows pglite database internals present in the committed branch diff.
- Recommended unblock: remove generated `dataconnect/.dataconnect/pgliteData/` database internals from version control in a separate cleanup task, keep the ignore rule, and ensure `npm run guard:tracked-artifacts` prevents recurrence.

## Static Checks

- `npm run typecheck`: PASS.
  - `next typegen` completed for app and test projects.
  - `tsc -p tsconfig.app.json --noEmit` passed.
  - `tsc -p tsconfig.test.json --noEmit` passed.
- `npm run lint`: PASS.
  - ESLint completed for `src`.
- `npm run format:check`: FAIL.
  - Prettier reported 46 files with formatting drift.
  - Affected areas include `docs/DATA_RELIABILITY.md`, multiple `docs/superpowers/plans/*`, `etl/processFootywireData.ts`, read-model scripts, canonical Footywire files, API routes, player UI, repair scripts, and tests.

## Test Runs

- `npm test`: FAIL.
  - Test files: 2 failed, 80 passed.
  - Tests: 4 failed, 348 passed.
  - Failures:
    - `src/app/api/players/search/route.test.ts`
      - `returns filtered players enriched with canonical precomputed stats`: expected 200, received 500.
      - `keeps same-name players distinct when canonical ids differ`: expected 200, received 500.
      - `falls back to local player data when precomputed stats are missing`: expected 200, received 500.
    - `src/components/__tests__/AuthForm.test.tsx`
      - `handles form submission with valid credentials`: timed out after 5000ms.
- Focused Footywire/read-model convergence tests: PASS.
  - Command: `npx vitest run src/lib/stats/footywireCanonicalContract.test.ts src/lib/footywireStatsIngestion.test.ts src/server/processFootywireData.test.ts src/server/readModels/playerReadModels.test.ts tests/verify-player-read-models-core.test.ts`
  - Result: 5 test files passed, 42 tests passed.
- Focused import/repair/identity tests: PASS.
  - Command: `npx vitest run src/app/api/etl/import-rounds/route.test.ts src/app/api/cron/daily/route.test.ts src/server/playerDirectoryRepair.test.ts src/server/playerDirectoryRosterEvidence.test.ts src/server/playerIdentityResolver.test.ts`
  - Result: 5 test files passed, 19 tests passed.
- Focused UI/stat-column tests: PASS.
  - Command: `npx vitest run src/app/players/PlayersPageClient.test.ts src/components/league/LeagueTabs.test.tsx src/hooks/__tests__/useLeagueStatColumns.test.ts`
  - Result: 3 test files passed, 8 tests passed.

## Guard Runs

- `npm run guard:routes`: PASS.
  - Checked 8 ETL routes and 113 API routes for admin runtime usage.
- `npm run guard:secrets`: FAIL.
  - Secret-like content detected in build outputs, including `.next/standalone/.env.production`.
  - Other hits were `.next/server/chunks/*` and `.next/standalone/node_modules/*` files containing private-key pattern strings.
- `npm run guard:tracked-artifacts`: PASS.
  - Reported no tracked local artifacts.
  - Audit caveat: `git ls-files dataconnect/.dataconnect/pgliteData` still shows tracked pglite internals, so the guard does not cover the artifact class that blocks CodeRabbit.
- `npm run guard:deps`: PASS.
  - `forbid-server-imports` scanned 665 files.
- `npm run env:validate`: PASS.
  - Environment OK for development.
- `npm run env:check:firebase`: PASS with warnings.
  - `.env.local` found.
  - Required `NEXT_PUBLIC_FIREBASE_*` variables present.
  - `.env` missing `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64`.
  - `secrets/serviceAccountKey.json` not found.
  - Emulators disabled.

## Footywire Contract Review Notes

- Canonical contract module exists at `src/lib/stats/footywireCanonicalContract.ts`.
- `FOOTYWIRE_CANONICAL_STAT_FIELDS` covers base and advanced fields, including availability and provenance helpers.
- `etl/processFootywireData.ts` writes `canonical_stats`, `source_provenance`, `canonical_match_identity`, and `canonical_match_metadata`.
- `src/server/readModels/playerReadModels.ts` reads stats through `readFootywireCanonicalStatNumber` / `readFootywireCanonicalStatPresence`; if `canonical_stats` exists but a field is missing, it returns zero rather than falling back to legacy top-level stats.
- Focused convergence tests passed.
- Remaining convergence concern: identity fallback remains in `selectBestCanonicalRawRows` through `resolveCanonicalPlayerIdFromRecord`; this is observable through `fallbackResolvedPlayerProfiles`, but the audit did not find a documented removal threshold for repaired scopes.
- `npm run build:player-read-models -- --help`: FAIL.
  - The command initialized Firebase and attempted live Prisma reads instead of printing help.
  - Failure: `The table main.Player does not exist in the current database.`
- `npm run verify:player-read-models -- --help`: FAIL.
  - The command initialized Firebase and attempted live Prisma reads instead of printing help.
  - Failure: `The table main.Player does not exist in the current database.`

## Security and Operations Review Notes

- `src/app/api/etl/import-rounds/route.ts` has explicit token authorization via `ETL_IMPORT_TOKEN`, development-only permissive default, bounded round resolution, and invokes `refreshPlayerReadModels` after non-dry-run imports.
- `src/app/api/cron/daily/route.ts` has explicit token authorization via `CRON_SECRET`, development-only permissive default, and runs refresh, ranking publication, and roster publication.
- `middleware.ts` does not enforce API authentication. For `/api/*`, it only injects dev auth headers for `Bearer dev:*`, handles CORS preflight, and otherwise returns `NextResponse.next()`.
- `src/app/api/admin/workers/route.ts` exposes unauthenticated GET worker stats/health and unauthenticated POST worker pool start, stop, restart, add, and remove operations.
- `src/app/api/admin/queue/route.ts` exposes unauthenticated queue stats, job lists, health, and metrics.
- `src/app/api/add-test-data/route.ts` and `src/app/api/dev/test-user/route.ts` are development-only.
- `/admin/workers` page is not covered by middleware protected prefixes, but the API route exposure is the primary risk.

## UI and Accessibility Review Notes

- Focused UI tests passed for players page, league tabs, and league stat columns.
- Search found broad design-token drift in app/components, including hard-coded `text-gray-*`, `bg-blue-*`, `bg-slate-*`, arbitrary hex gradients, and inline styles.
- High-signal examples:
  - `src/app/page.tsx:75` uses arbitrary hex gradient colors in the first viewport.
  - `src/app/fantasy/page.tsx:66` uses the same hard-coded palette pattern.
  - `src/components/matchup/LiveScoringMatchup.tsx` contains many hard-coded color utility classes and inline progress width styles.
  - `src/components/OfferDock.tsx` uses hard-coded gray/white styling rather than semantic theme tokens.
- Interaction search found accessible labels on several key controls, including sortable players columns and navigation menu toggles.

## Blockers and Assumptions

- This audit is running in the current dirty worktree because the requested target is the current code state.
- No production-code remediation will be applied as part of the audit.
- CodeRabbit is blocked until tracked pglite data internals are removed from the branch review surface.
- Full release verification is blocked by failing `npm test`, failing `npm run format:check`, and failing `npm run guard:secrets`.
