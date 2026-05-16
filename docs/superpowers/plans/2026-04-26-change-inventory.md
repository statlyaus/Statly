# Change Inventory

Generated from `git status --short --untracked-files=all` on 2026-04-26 after the verifier/match-identity fix passed.

Last refreshed during Gate 1 execution on 2026-04-26.

## Goal Assessment

The goal of this inventory is not merely to list dirty files. Its purpose is to protect the convergence work from accidental scope creep by deciding which paths belong to the Footywire/read-model convergence release, which paths should move to separate product work, and which paths must never be shipped.

The inventory must support three long-term outcomes:

- a reviewable convergence package
- no local/generated artifacts in the release
- no unrelated UI/product changes bundled into data-contract work

## Shortcomings Against That Goal

The first version was directionally useful but too permissive:

- The `Ship In Convergence Release` bucket is very broad and still includes files that may need separate sub-packages.
- It classifies paths by apparent topic, not by verified dependency.
- It does not yet define release gates for staging files.
- It does not distinguish "must ship now" from "valid convergence work but later gate."
- It records generated/local artifacts but does not specify the enforcement command for excluding them during staging.
- It treats observability files as manual review, but does not define the decision rule for including them.

## Rewritten Long-Term Decision Rule

Use four gates before staging any file:

1. **Contract gate:** Ship now only if the file defines, writes, reads, verifies, repairs, or documents the canonical Footywire/raw/read-model contract.
2. **Migration gate:** Ship now only if schema/migration files pass clean replay and belong to executable Prisma history or documented legacy SQL archive.
3. **Operational gate:** Ship now only if scripts/routes are necessary for import, repair, rebuild, verification, authorization, or auditability.
4. **Exclusion gate:** Do not ship local artifacts, generated emulator exports, generated Data Connect output, or unrelated UI/product changes.

This means `Ship In Convergence Release` is a candidate list, not an automatic staging list. Final staging must happen from the gate-specific package list in `2026-04-26-repository-convergence-completion.md`.

## Rewritten Release Buckets

These buckets are the source of truth for final staging. They classify every currently dirty path into implementation, test, migration, docs, generated/local, unrelated product/UI, or manual-review work.

### Gate A - Convergence Release Candidate

These files define, write, read, verify, repair, operate, or document the Footywire canonical raw/read-model convergence path. They may be staged only after their task gate passes.

Implementation:

- `Scripts/verify-player-read-models.ts`
- `Scripts/verify-player-read-models-core.ts`
- `Scripts/verify-match-logs.ts`
- `Scripts/build-player-read-models.ts`
- `Scripts/audit-unresolved-player-directory.ts`
- `Scripts/repair-player-directory.ts`
- `etl/fetch_fw_round.R`
- `etl/fetch_fw_round.py`
- `etl/processFootywireData.ts`
- `shared/player-identity/playerIdentityResolver.ts`
- `shared/player-identity/playerMatchStats.ts`
- `shared/player-identity/teamNames.ts`
- `src/app/api/cron/daily/route.ts`
- `src/app/api/etl/import-rounds/route.ts`
- `src/app/api/health/route.ts`
- `src/app/api/live-player-stats/enriched/route.ts`
- `src/app/api/player-stats/route.ts`
- `src/app/api/players/[id]/matches/route.ts`
- `src/app/api/players/[id]/route.ts`
- `src/app/api/players/[id]/stats/route.ts`
- `src/app/api/players/route.ts`
- `src/app/api/players/search/route.ts`
- `src/app/api/rankings/route.ts`
- `src/data/playerDirectoryRepairs2026.ts`
- `src/data/playerRosterEvidence2026.ts`
- `src/hooks/useLeagueStatColumns.ts`
- `src/lib/firebaseAdmin.ts`
- `src/lib/footywireStatsIngestion.ts`
- `src/lib/matchLogs.ts`
- `src/lib/playerReadModelHealth.ts`
- `src/lib/serverAuth.ts`
- `src/lib/stats/footywireCanonicalContract.ts`
- `src/lib/stats/playerStatSnapshot.ts`
- `src/lib/stats/statColumns.ts`
- `src/server/playerDirectoryRepair.ts`
- `src/server/playerDirectoryRosterEvidence.ts`
- `src/server/playerIdentityResolver.ts`
- `src/server/players/playerPool.ts`
- `src/server/rankings/playerRankingEngine.ts`
- `src/server/readModels/playerReadModels.ts`
- `src/server/stats/StatsReadService.ts`
- `src/types/fantasyCategories.ts`
- `src/types/matchLogs.ts`

Tests:

- `src/app/api/cron/daily/route.test.ts`
- `src/app/api/etl/import-rounds/route.test.ts`
- `src/app/api/health/route.test.ts`
- `src/app/api/player-stats/route.test.ts`
- `src/app/api/players/[id]/matches/route.test.ts`
- `src/app/api/players/[id]/route.test.ts`
- `src/app/api/players/[id]/stats/route.test.ts`
- `src/app/api/players/route.test.ts`
- `src/app/api/rankings/route.test.ts`
- `src/hooks/__tests__/useLeagueStatColumns.test.ts`
- `src/lib/__tests__/playerMatchStats.test.ts`
- `src/lib/footywireStatsIngestion.test.ts`
- `src/lib/matchLogs.test.ts`
- `src/lib/playerReadModelHealth.test.ts`
- `src/lib/stats/footywireCanonicalContract.test.ts`
- `src/server/playerDirectoryRepair.test.ts`
- `src/server/playerDirectoryRosterEvidence.test.ts`
- `src/server/playerIdentityResolver.test.ts`
- `src/server/processFootywireData.test.ts`
- `src/server/rankings/playerRankingEngine.test.ts`
- `src/server/readModels/playerReadModels.test.ts`
- `src/types/fantasyCategories.test.ts`
- `tests/teamNames.test.ts`
- `tests/verify-player-read-models-core.test.ts`

Docs:

- `AGENTS.md`
- `README.md`
- `docs/DATA_RELIABILITY.md`
- `docs/FOOTYWIRE_DATA_ARCHITECTURE_REVIEW.md`
- `docs/PLAYER_RANKING_MIGRATION_DESIGN.md`
- `docs/firebase-setup.md`
- `docs/superpowers/plans/2026-04-26-change-inventory.md`
- `docs/superpowers/plans/2026-04-26-footywire-program-completion-plan.md`
- `docs/superpowers/plans/2026-04-26-player-directory-curation.md`
- `docs/superpowers/plans/2026-04-26-raw-merged-convergence.md`
- `docs/superpowers/plans/2026-04-26-repository-convergence-completion.md`
- `docs/superpowers/plans/2026-04-26-schema-design-review.md`
- `docs/superpowers/plans/2026-04-26-verifier-runtime-blocker.md`

### Gate B - Migration Release Candidate

These support clean Prisma migration replay:

- `prisma/schema.prisma`
- `prisma/migrations/20260423000000_add_player_projection_publication_ranking_metadata/migration.sql`
- `prisma/migrations/20260423001000_add_player_ranking_snapshot_metadata/migration.sql`
- `prisma/migrations/20260426000000_add_player_season_registration_and_alias_scope/migration.sql`
- `prisma/legacy-migrations/add_draft_lobby.sql`
- `prisma/legacy-migrations/add_timezone_support.sql`
- deletion of `prisma/migrations/add_draft_lobby.sql`
- deletion of `prisma/migrations/add_timezone_support.sql`

### Gate C - Generated Or Local Artifact - Do Not Ship

These should not be staged with convergence work without an explicit separate decision:

- `.firebase-data/**`
- `prisma/dev.db`
- `dataconnect/.dataconnect/**`
- `.cursor/settings.json`
- local screenshots, temporary DBs, cache files, and generated export metadata

### Gate D - Separate Product/UI Release

These appear to be UI, design-system, dashboard, draft, league, or homepage product changes. They should not be bundled into the data-convergence release unless a later review proves a direct dependency:

- `STATLY_DESIGN_SYSTEM.md`
- `src/app/dashboard/DashboardClient.tsx`
- `src/app/draft/layout.tsx`
- `src/app/drafts/[id]/available-players/route.ts`
- `src/app/fantasy/page.tsx`
- `src/app/layout.tsx`
- `src/app/leagues/[id]/LeaguePageClient.tsx`
- `src/app/leagues/[id]/page.tsx`
- `src/app/page.tsx`
- `src/app/players/PlayersPageClient.tsx`
- `src/app/players/PlayersPageClient.test.ts`
- `src/app/players/PlayersPageServer.tsx`
- `src/components/PlayerChart.tsx`
- `src/components/PlayerDetail.tsx`
- `src/components/dashboard/NineCategoryDisplay.tsx`
- `src/components/dashboard/TopPicksModule.client.tsx`
- `src/components/draft/DraftHubNav.tsx`
- `src/components/draft/DraftTradesExplorer.tsx`
- `src/components/draft/draftHubChrome.ts`
- `src/components/league/LeagueTabs.tsx`
- `src/components/league/LeagueTabs.test.tsx`
- `src/components/navigation/MainNavigation.tsx`
- `src/hooks/usePlayerStats.ts`

### Gate E - Manual Review Before Inclusion

These may be valid but need a narrower decision before shipping:

- `clickhouse/schema/web_vitals.sql` - observability work; include only if operational hardening explicitly depends on web-vitals persistence.
- `src/services/webVitalsPersistence.ts` - observability/product telemetry; include only if operational hardening explicitly depends on it.
- `src/services/webVitalsMetricsConfig.ts` - observability/product telemetry; include only if operational hardening explicitly depends on it.
- `src/services/webVitalsMetricsConfig.test.ts` - same as above.

## Split Into Separate Product/UI Release

These appear to be UI, design-system, dashboard, draft, league, or homepage product changes. They should not be bundled into the data-convergence release unless a later review proves a direct dependency:

- `STATLY_DESIGN_SYSTEM.md`
- `src/app/dashboard/DashboardClient.tsx`
- `src/app/draft/layout.tsx`
- `src/app/drafts/[id]/available-players/route.ts`
- `src/app/fantasy/page.tsx`
- `src/app/layout.tsx`
- `src/app/leagues/[id]/LeaguePageClient.tsx`
- `src/app/leagues/[id]/page.tsx`
- `src/app/page.tsx`
- `src/app/players/PlayersPageClient.tsx`
- `src/app/players/PlayersPageClient.test.ts`
- `src/app/players/PlayersPageServer.tsx`
- `src/components/PlayerChart.tsx`
- `src/components/PlayerDetail.tsx`
- `src/components/dashboard/NineCategoryDisplay.tsx`
- `src/components/dashboard/TopPicksModule.client.tsx`
- `src/components/draft/DraftHubNav.tsx`
- `src/components/draft/DraftTradesExplorer.tsx`
- `src/components/draft/draftHubChrome.ts`
- `src/components/league/LeagueTabs.tsx`
- `src/components/league/LeagueTabs.test.tsx`
- `src/components/navigation/MainNavigation.tsx`
- `src/hooks/usePlayerStats.ts`

## Generated Or Local Artifact - Do Not Ship

These are local configuration, emulator exports, generated Data Connect files, or local database artifacts. They should be excluded from the convergence package unless explicitly regenerated as a separate tooling change:

- `.cursor/settings.json`
- `.firebase-data/auth_export/accounts.json`
- `.firebase-data/auth_export/config.json`
- `.firebase-data/firebase-export-metadata.json`
- `dataconnect/.dataconnect/schema/main/implicit.gql`
- `dataconnect/.dataconnect/schema/main/input.gql`
- `dataconnect/.dataconnect/schema/main/mutation.gql`
- `dataconnect/.dataconnect/schema/main/relation.gql`
- `dataconnect/.dataconnect/schema/prelude.gql`
- `prisma/dev.db`

## Needs Manual Review

These may be valid but need a narrower decision before shipping:

- `clickhouse/schema/web_vitals.sql` - likely observability work; include only if tied to Task 7 metrics.
- `src/services/webVitalsPersistence.ts` - likely observability/product telemetry; include only if Task 7 depends on it.
- `src/services/webVitalsMetricsConfig.ts` - likely observability/product telemetry; include only if Task 7 depends on it.
- `src/services/webVitalsMetricsConfig.test.ts` - same as above.

## Migration Directory Cleanup

Moved these tracked standalone SQL files out of `prisma/migrations/`:

- `prisma/migrations/add_draft_lobby.sql` -> `prisma/legacy-migrations/add_draft_lobby.sql`
- `prisma/migrations/add_timezone_support.sql` -> `prisma/legacy-migrations/add_timezone_support.sql`

Reason:

- Prisma expects `prisma/migrations/` to contain timestamped migration directories and `migration_lock.toml`.
- Standalone SQL files in that directory caused `prisma migrate deploy` to fail with a schema-engine error before the migration chain could replay.
- These scripts are retained as legacy/manual SQL history, but they are no longer in the executable Prisma migration chain.

## Artifact Dependency Check

Command:

```bash
rg -n "\\.firebase-data|prisma/dev\\.db|firebase-export-metadata" .
```

Findings:

- `.firebase-data` appears in docs and `package.json` emulator scripts.
- `firebase-export-metadata` appears only in this plan inventory context.
- `prisma/dev.db` appears only in this plan inventory context.
- No production code dependency on local emulator export files or `prisma/dev.db` was found.

## Immediate Recommendation

Proceed with schema design review before any additional implementation. The release package should first isolate the already-verified verifier/match-identity slice, then separately review schema, player identity, bounded rematerialization, and security/observability tasks.
