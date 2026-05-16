# Structured Language Audit - 2026-04-27

## Goal Assessment

This audit turns `docs/UBIQUITOUS_LANGUAGE_GOVERNANCE.md` into a remediation program for Statly.

The goal is not to rename every vague word. The goal is to protect correctness and maintainability by finding language that can create ambiguity in canonical Footywire contracts, player identity, AFL club versus fantasy team semantics, ranking/value calculations, persisted fields, APIs, UI copy, accessibility labels, analytics, and runbooks.

The optimal long-term outcome is a codebase where core terms have one preferred meaning, compatibility code has exit criteria, and high-risk vocabulary changes happen through bounded migrations rather than broad rename churn.

## Shortcomings in the First Draft

The first structured audit was useful but not strong enough as an execution artifact.

- It described risk areas without defining audit success criteria.
- It did not separate immediate blockers from migration candidates.
- It did not define a glossary seed, even though glossary work is the first remediation step.
- It identified overloaded terms without assigning ownership boundaries.
- It listed candidate files without stable stop conditions.
- It did not make Prisma, Firestore, API, and analytics compatibility risk explicit enough.
- It suggested better names without saying when not to rename.
- It did not tie terminology cleanup tightly enough to single-contract Footywire convergence.

This rewrite makes the audit decision-oriented: each risk area now has target vocabulary, compatibility posture, remediation, and a stop condition.

## Method

Automated searches found candidates; manual review focused on shared, public, persisted, and user-facing surfaces.

Excluded from counts: `node_modules`, `.git`, `.next`, `dist`, `etl/*.ndjson`, and TypeScript build info.

| Risk class                   | Candidate hits |
| ---------------------------- | -------------: |
| Generic object names         |         10,810 |
| Weak action words            |          2,992 |
| Ambiguous state words        |          2,165 |
| Placeholder technical names  |          4,052 |
| Overloaded AFL fantasy terms |         11,728 |

These counts show review pressure. They are not findings by themselves.

## Success Criteria

This audit succeeds when it produces:

- a glossary seed for high-risk domain terms
- a remediation order that starts with contract and identity language
- explicit migration posture for persisted and API terms
- guidance for what to leave alone
- a bounded first implementation slice
- no recommendation for broad mechanical renames

## Priority Model

Use this order when choosing terminology work:

1. Persisted canonical contract language
2. Identity resolution language
3. Projection and ranking language
4. Public API and analytics language
5. User-facing copy and accessibility language
6. Internal tests and docs
7. Local implementation shorthand

Do not spend effort on lower layers while higher layers remain ambiguous for the same concept.

## Findings

### 1. Canonical Footywire Contract Language

Primary files: `etl/processFootywireData.ts`, `src/lib/footywireStatsIngestion.ts`, `src/lib/stats/footywireCanonicalContract.ts`, `src/lib/stats/playerStatSnapshot.ts`, `src/server/readModels/playerReadModels.ts`.

Assessment:

- Strong terms already exist: `canonical_stats`, `availability`, `provenance`, `source_priority`, and canonical stat keys.
- The weak point is downstream generic language around raw documents and transitional fallback readers.
- `playerStatSnapshot.ts` still contains a transitional adapter from `data.stats`, top-level fields, and `raw_row`.
- `playerReadModels.ts` often uses `data` where the meaning is raw match document, canonical raw match document, projection row, or materialized read-model row.

Target vocabulary: `canonicalRawMatchContract`, `canonicalRawMatchDocument`, `rawMatchDocument`, `sourceRawRow`, `publishedPlayerReadModel`, `transitionalRawStatAdapter`.

Compatibility posture:

- Do not rename persisted Firestore fields unless the canonical contract changes.
- Rename local variables and helper names first.
- Transitional readers must have removal criteria.

Remediation:

1. Add exit criteria to the legacy adapter in `playerStatSnapshot.ts`.
2. Audit `playerReadModels.ts` as one file-level task, focused only on canonical raw document versus projection row naming.
3. Keep `canonical_stats` as the persisted field name unless a contract migration is separately approved.

Stop once read-model code clearly distinguishes canonical raw documents from projection rows.

Severity: Must change for new canonical contract work; should change for existing read-model cleanup.

### 2. Player Identity and Team/Club Language

Primary files: `shared/player-identity/playerIdentityResolver.ts`, `shared/player-identity/playerMatchStats.ts`, `src/server/playerDirectoryRepair.ts`, `src/data/playerRosterEvidence2026.ts`, `prisma/schema.prisma`, `docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md`.

Assessment:

- `team` means source-row team context in ingestion and identity resolution.
- `club` means canonical player AFL club and season registration facts.
- `team` also means fantasy team in league and roster UI.
- `normalizedTeam` and `normalizedClub` coexist in identity logic, which can blur source context and canonical identity facts.

Target vocabulary:

- `sourceTeamName`: team value observed in source data.
- `aflClub`: canonical AFL club concept.
- `currentPlayerClub`: mutable current display/search club on `Player`.
- `seasonRegisteredClub`: historical season-specific club fact.
- `fantasyTeam`: user's fantasy league team.

Compatibility posture:

- Existing Prisma fields require migration planning before renaming.
- New shared domain code should stop introducing bare `team` unless it explicitly means fantasy team.

Remediation:

1. Create `docs/DOMAIN_GLOSSARY.md` with these terms.
2. Update identity docs to define `sourceTeamName` versus `seasonRegisteredClub`.
3. Prefer target terms in new code and local variable names around identity resolution.
4. Plan schema/API migration only after glossary and tests make the distinction enforceable.

Stop once new identity work cannot introduce another ambiguous `team` or `club` synonym without violating the glossary.

Severity: Must change for new identity and canonical ingestion work.

### 3. Projection, Ranking, Score, and Value Language

Primary files: `src/types/fantasyCategories.ts`, `src/server/readModels/playerReadModels.ts`, `src/server/stats/StatsReadService.ts`, `src/types/players.ts`, `prisma/schema.prisma`, `docs/PLAYER_RANKING_MIGRATION_DESIGN.md`.

Assessment:

- `totalValue` is persisted and sorted as a ranking metric.
- `rankingValue` exists and better describes ranking semantics.
- `averageScore`, `projectedScore`, `fantasyScore`, `scoreInvolvements`, and generic `value` can be confused without glossary ownership.
- `docs/PLAYER_RANKING_MIGRATION_DESIGN.md` already identifies `totalValue` as legacy compatibility language.

Target vocabulary: `rankingValue`, `legacyTotalValue`, `fantasyValueRating`, `projectedFantasyScore`, `actualFantasyScore`, `averageFantasyValue`.

Compatibility posture:

- Do not rename persisted `totalValue`, `averageScore`, or `projectedScore` yet.
- Treat new API fields and UI labels as the first migration surface.

Remediation:

1. Promote ranking design language into the glossary.
2. Prefer `rankingValue` in new read APIs and UI-facing ranking code.
3. Label `totalValue` as compatibility language in docs and types before schema migration.
4. Avoid new fields named only `value` or `score`.

Stop once ranking surfaces can explain whether a number is a ranking value, projected fantasy score, actual score, or legacy compatibility value.

Severity: Should change now; must change before expanding ranking APIs.

### 4. Lifecycle State Language

Primary files: `src/lib/leagueSeason.ts`, `src/app/api/leagues/[id]/matchup/route.ts`, `src/hooks/useDraftState.ts`, `src/hooks/useRealtimeDraft.ts`, `src/services/tradeService.ts`, `prisma/schema.prisma`.

Assessment:

- `status` appears across league lifecycle, draft lifecycle, AFL round state, fixture result, waiver state, trade state, health state, HTTP status, and import state.
- Enum-backed states are usually acceptable because the type gives meaning.
- Bare `current` and `active` hide lifecycle rules.

Target vocabulary: `leagueSeasonRoundStatus`, `draftLifecycleStatus`, `fixtureResultStatus`, `tradeReviewStatus`, `waiverClaimStatus`, `healthCheckStatus`, `isCurrentScheduleWeek`, `isCurrentLeagueMatchup`, `isPlayerActiveInDirectory`.

Compatibility posture:

- Persisted `status`, `current`, and `active` fields should not be renamed directly.
- New enum/type names should carry the domain qualifier even if serialized fields remain unchanged.

Remediation:

1. Add domain-qualified type aliases around existing status fields.
2. Rename local booleans when they cross file, API, or persistence boundaries.
3. Leave tiny local checks alone when the type or surrounding code is unambiguous.

Stop once public/shared types identify which lifecycle they represent.

Severity: Should change in shared code and new contracts.

### 5. API Response and Error Language

Primary files: `src/app/api/**/route.ts`, `src/lib/apiResponse.ts`, `src/app/api/health/route.ts`, `src/app/api/player-stats/route.ts`, `src/app/api/leagues/**/route.ts`.

Assessment:

- API responses mix `{ success, data }`, `{ ok }`, `{ error }`, direct domain objects, and route-specific fields.
- `details` can mean validation details, health diagnostics, exception details, or UI copy support.
- Many error messages identify the failed operation but not the domain stage or next user action.

Target vocabulary: `message`, `errorCode`, `validationIssues`, `diagnostics`, `serviceHealthDetails`.

Compatibility posture:

- Do not change all API response shapes in one pass.
- Start with new APIs and high-impact mutation routes.
- Public route changes need tests and compatibility notes.

Remediation:

1. Document preferred API error vocabulary.
2. Convert one route family at a time.
3. Reserve raw diagnostics for logs or admin-only responses.

Stop when the selected route family has consistent response language and tests.

Severity: Should change for public and semi-public APIs.

### 6. UI Copy and Accessibility Language

Primary files: `src/components/**`, `src/app/**`, `src/components/ui/DataTable.tsx`, `src/components/dashboard/Sparkline.tsx`, `src/app/drafts/[id]/DraftRoomClient.tsx`.

Assessment:

- Reusable components still expose generic defaults such as `No data`, `No data available`, `Failed to load module`, and `Something went wrong`.
- Many local actions are acceptable because headings provide context.
- Reusable defaults are higher risk because they spread vague language across product surfaces.

Target vocabulary:

- Empty states should name the missing domain object.
- Errors should identify what failed and what the user can try next.
- Icon-only controls should name the specific object being opened, refreshed, cleared, or saved.

Compatibility posture:

- UI copy can be improved incrementally without schema migration.
- Reusable component defaults should be actionable or require caller-provided copy.

Remediation:

1. Start with reusable components, not one-off screens.
2. Replace `No data` with caller-provided empty-state copy.
3. Replace page-level `Something went wrong` with specific failure context where available.

Stop once reusable defaults no longer force vague copy into domain views.

Severity: Should change for reusable components and page-level errors.

## Canonical Glossary Seed

Create `docs/DOMAIN_GLOSSARY.md` with: AFL Club, Fantasy Team, Source Team Name, Current Player Club, Season Registered Club, Canonical Raw Match Contract, Canonical Raw Match Document, Published Player Read Model, Fixture Result Status, League Season Round Status, Draft Lifecycle Status, Trade Review Status, Waiver Claim Status, Ranking Value, Legacy Total Value, Fantasy Value Rating, Projected Fantasy Score, and Actual Fantasy Score.

Each entry should include definition, use when, do not use for, preferred code terms, avoided terms, and related terms.

## Recommended Execution Plan

1. Create the glossary seed.
2. Update identity docs to distinguish source team, AFL club, and fantasy team.
3. Add exit criteria to canonical stat fallback adapters.
4. Perform a bounded `playerReadModels.ts` cleanup focused only on canonical raw document versus projection row naming.
5. Clarify ranking vocabulary in docs and new API/type names before schema changes.
6. Improve reusable UI empty/error defaults.
7. Standardize API error vocabulary one route family at a time.

## Do Not Do

- Do not rename Prisma fields such as `club`, `status`, `totalValue`, `averageScore`, or `projectedScore` without a migration plan.
- Do not run broad substitutions such as `team` to `club` or `data` to `payload`.
- Do not mix language migrations into unrelated product, UI, ETL, or repair work.
- Do not remove compatibility adapters until the repaired scope proves it no longer depends on them.
- Do not introduce new preferred terms without checking the glossary first.

## Next Slice Acceptance Criteria

The next remediation slice is complete only when preferred terms are documented before code changes, public or persisted fields have compatibility notes, relevant checks cover preserved behaviour, no new synonyms are introduced, transitional adapters have exit criteria, and the change moves the repo toward canonical contract convergence.
