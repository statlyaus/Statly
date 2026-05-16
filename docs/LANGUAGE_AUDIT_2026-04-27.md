# Vague Language Audit - 2026-04-27

## Summary

This is the first pass of the complete Statly language audit using `docs/UBIQUITOUS_LANGUAGE_GOVERNANCE.md`.

The audit found broad candidate volume, so findings below focus on language that affects shared domain meaning, persisted contracts, projection correctness, API/UI interpretation, or migration safety. Local framework terms such as `response.status`, `URLSearchParams`, Prisma `data`, and tiny callback variables were not treated as findings.

## Candidate Inventory

Searches excluded `node_modules`, `.git`, `.next`, `dist`, TypeScript build info, and `etl/*.ndjson`.

| Category                     | Candidate hits |
| ---------------------------- | -------------: |
| Generic object names         |         10,810 |
| Weak action words            |          2,992 |
| Ambiguous state words        |          2,165 |
| Placeholder technical names  |          4,052 |
| Overloaded AFL fantasy terms |         11,728 |

Highest-risk files by candidate density:

- `src/server/readModels/playerReadModels.ts`
- `src/lib/leagueSeason.ts`
- `src/lib/footywireStatsIngestion.ts`
- `etl/processFootywireData.ts`
- `src/services/tradeService.ts`
- `src/app/api/leagues/[id]/matchup/route.ts`
- `prisma/schema.prisma`

## Findings

### 1. Raw Firestore documents are repeatedly named `data`

- Location: `src/server/readModels/playerReadModels.ts`, `src/lib/leagueSeason.ts`, `src/app/api/leagues/[id]/matchup/route.ts`
- Current language: `data`
- Risk category: Generic noun, missing domain distinction
- Issue: In read-model and matchup paths, `data` often means a raw Firestore document, a canonical Footywire raw-match document, a materialized league season document, or an API response body depending on the function. This makes it harder to verify whether a reader is consuming canonical contract fields or a transitional source shape.
- Suggested replacement: use scope-specific names such as `rawMatchDocument`, `canonicalRawMatchDocument`, `materializedSeasonDocument`, `matchupResponseBody`, or `leagueScheduleDocument`.
- Replacement score: 3
- Severity: Should change
- Scope: Shared domain, read-model, API

### 2. `status` and `current` are overloaded across unrelated lifecycles

- Location: `src/lib/leagueSeason.ts`, `src/app/api/leagues/[id]/matchup/route.ts`, `src/hooks/useDraftState.ts`, `prisma/schema.prisma`
- Current language: `status`, `current`
- Risk category: Ambiguous state, placeholder lifecycle name
- Issue: `status` can mean league lifecycle, draft lifecycle, AFL round state, fixture/match state, trade review state, waiver state, import state, or HTTP status. `current` is used for the active league schedule week but does not say current for whom or which season workflow.
- Suggested replacement: preserve persisted fields until migrated, but use explicit internal terms such as `leagueSeasonRoundStatus`, `draftLifecycleStatus`, `fixtureResultStatus`, `tradeReviewStatus`, `isCurrentScheduleWeek`, and `isCurrentLeagueMatchup`.
- Replacement score: 3
- Severity: Should change
- Scope: Database, API, UI, shared domain

### 3. `team` and `club` represent different identity concepts without one enforced vocabulary

- Location: `etl/processFootywireData.ts`, `src/lib/footywireStatsIngestion.ts`, `shared/player-identity/playerIdentityResolver.ts`, `shared/player-identity/playerMatchStats.ts`, `src/server/playerDirectoryRepair.ts`, `prisma/schema.prisma`
- Current language: `team`, `club`, `normalizedTeam`, `normalizedClub`
- Risk category: Overloaded domain term, inconsistent synonym
- Issue: Source rows use `team`, player records use `club`, season registrations use `club`, and fantasy league surfaces also use `team`. This is risky because player identity resolution depends on distinguishing source team, AFL club, season-registered club, and fantasy team.
- Suggested replacement: standardize glossary terms before renaming: `sourceTeamName`, `aflClub`, `currentPlayerClub`, `seasonRegisteredClub`, and `fantasyTeam`. Rename one boundary at a time because these terms touch persistence and APIs.
- Replacement score: 3
- Severity: Must change for new contract work; migration follow-up for existing persisted fields
- Scope: Database, canonical ingestion, identity resolution, UI

### 4. `value`, `totalValue`, `averageScore`, and `projectedScore` need glossary ownership

- Location: `src/types/fantasyCategories.ts`, `src/server/readModels/playerReadModels.ts`, `src/server/stats/StatsReadService.ts`, `src/types/players.ts`, `prisma/schema.prisma`
- Current language: `value`, `totalValue`, `averageScore`, `projectedScore`
- Risk category: Overloaded AFL fantasy term
- Issue: `value` can mean a generic numeric stat, a weighted fantasy category output, a player ranking metric, price efficiency, or raw object value. `totalValue` is persisted and sorted like a ranking score, while `projectedScore` suggests forward-looking fantasy points. The distinction is not documented in one place.
- Suggested replacement: define glossary entries for `fantasyValueRating`, `seasonFantasyValueTotal`, `averageFantasyValueRating`, `projectedFantasyScore`, and `actualFantasyScore` before schema/API renames.
- Replacement score: 3
- Severity: Should change
- Scope: Database, API, ranking, UI

### 5. Transitional language around `legacy` and `fallback` lacks consistent exit criteria

- Location: `docs/FOOTYWIRE_DATA_ARCHITECTURE_REVIEW.md`, `docs/runtime-contract.md`, `src/app/api/players/[id]/route.test.ts`, `src/app/api/leagues/route.ts`, `src/hooks/useEnhancedInjuryData.ts`
- Current language: `legacy`, `fallback`
- Risk category: Placeholder technical name
- Issue: Some fallback language is legitimate, but the term is used for runtime compatibility, route compatibility, source-data conversion, and test expectations. Without a named migration boundary, fallback code can become permanent.
- Suggested replacement: use explicit transitional names such as `legacyPlayerSlugCompatibility`, `leagueCreationLegacyRequestAdapter`, `injuryLegacyResponseAdapter`, and include removal criteria in docs or tests.
- Replacement score: 3
- Severity: Should change
- Scope: API, tests, migration docs

### 6. Boolean state names should be made domain-specific when they cross component or persistence boundaries

- Location: `src/lib/leagueSeason.ts`, `src/server/readModels/playerReadModels.ts`, `src/types/leagues.ts`
- Current language: `active`, `current`, `canEdit`, `canJoin`, `isOwner`
- Risk category: Ambiguous boolean
- Issue: Local UI booleans are mostly understandable, but persisted or shared booleans such as `current` and selected player profile `active` do not state the rule being tested. This creates future ambiguity around current season, current matchup, active league, active player, and selectable player.
- Suggested replacement: prefer `isCurrentScheduleWeek`, `isCurrentLeagueMatchup`, `isPlayerActiveInDirectory`, `canCurrentUserEditLeague`, and `canCurrentUserJoinLeague`.
- Replacement score: 3
- Severity: Should change
- Scope: Shared domain, database, UI

## Recommended Glossary Updates

Add or standardize these terms before broad rename work:

- `AFL Club`
- `Fantasy Team`
- `Source Team Name`
- `Current Player Club`
- `Season Registered Club`
- `Fixture Result Status`
- `League Season Round Status`
- `Draft Lifecycle Status`
- `Trade Review Status`
- `Fantasy Value Rating`
- `Projected Fantasy Score`
- `Actual Fantasy Score`
- `Canonical Raw Match Document`
- `Published Player Read Model`

## Suggested Follow-Up

1. Create a small glossary file and define the terms above before code renames.
2. Start with one bounded migration: `team` vs `club` in the player identity pipeline, because that language directly affects canonical raw-match convergence.
3. Next audit `src/server/readModels/playerReadModels.ts` as its own task, replacing generic `data` names only where they clarify canonical contract consumption.
4. Avoid schema/API renames for `value`, `status`, or `current` until compatibility and migration steps are written.
