# Team and Club Language Audit - 2026-04-27

## Goal

Audit `team` and `club` language in the player identity and Footywire ingestion path against `docs/DOMAIN_GLOSSARY.md`.

The goal is to prevent AFL club, source team name, season registration, and fantasy team concepts from drifting into interchangeable terminology.

## Scope Reviewed

Files reviewed:

- `shared/player-identity/playerIdentityResolver.ts`
- `shared/player-identity/playerMatchStats.ts`
- `src/server/playerDirectoryRepair.ts`
- `src/data/playerRosterEvidence2026.ts`
- `src/lib/footywireStatsIngestion.ts`
- `etl/processFootywireData.ts`
- `prisma/schema.prisma`
- `docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md`

## Summary

The current code is operationally understandable, but `team` and `club` are not governed consistently enough for long-term identity correctness.

The biggest risk is that `team` sometimes means source-row team context, sometimes fallback AFL club context, and elsewhere in the app means fantasy team. Existing persisted fields should not be renamed casually, but new identity and ingestion work should use `sourceTeamName`, `aflClub`, `currentPlayerClub`, and `seasonRegisteredClub` from the glossary.

## Findings

### 1. Player identity input uses bare `team`

- Location: `shared/player-identity/playerIdentityResolver.ts`
- Current language: `PlayerIdentityInput.team`
- Risk category: Overloaded domain term
- Issue: The field means source-row team context used to resolve player identity, not a fantasy team and not necessarily a canonical AFL club. Because this type is shared across ingestion and unresolved-row recording, bare `team` makes the resolution contract less explicit.
- Suggested replacement: Add a new `sourceTeamName` input alias and migrate internal code to prefer it while preserving `team` for compatibility.
- Replacement score: 3
- Severity: Must change for new identity work
- Scope: Shared domain, ingestion, unresolved-row persistence

### 2. Identity diagnostics expose `normalizedTeam`

- Location: `shared/player-identity/playerIdentityResolver.ts`
- Current language: `diagnostics.normalizedTeam`
- Risk category: Missing domain distinction
- Issue: Diagnostic output describes normalized source context, not a fantasy team. This matters because unresolved identity rows become operational review material.
- Suggested replacement: `normalizedSourceTeamName`
- Replacement score: 3
- Severity: Should change
- Scope: Diagnostics, repair workflow

### 3. Directory helpers accept both `team` and `club`

- Location: `shared/player-identity/playerMatchStats.ts`
- Current language: `team?: string`, `club?: string`, `normalizedTeam`
- Risk category: Inconsistent synonym
- Issue: `createPlayerDirectory` accepts both `team` and `club` and then calls `normalizeTeamLookup(player.team ?? player.club)`. This is a useful compatibility adapter, but the type does not say which input is source context and which is canonical AFL club.
- Suggested replacement: Keep compatibility fields, but introduce preferred fields `sourceTeamName?: string` and `aflClub?: string`; derive `normalizedSourceTeamName` or `normalizedAflClub` depending on caller intent.
- Replacement score: 3
- Severity: Should change
- Scope: Shared identity helper

### 4. Prisma schema encodes both `club` and `team` without glossary anchors

- Location: `prisma/schema.prisma`
- Current language: `Player.club`, `PlayerAlias.club`, `PlayerSeasonRegistration.club`, `UnresolvedPlayerStatRow.team`
- Risk category: Persisted overloaded domain term
- Issue: The persisted model is mostly coherent: `club` belongs to player identity facts and `team` belongs to unresolved source rows. The risk is that the schema itself does not document this distinction, and renaming would require migration planning.
- Suggested replacement: Do not rename fields now. Add schema comments or documentation that `UnresolvedPlayerStatRow.team` is source team name, while player and registration `club` fields are AFL club facts.
- Replacement score: 2
- Severity: Should change
- Scope: Database, migration docs

### 5. Ingestion source row types use `team`

- Location: `etl/processFootywireData.ts`, `src/lib/footywireStatsIngestion.ts`
- Current language: `team`
- Risk category: Source-data field ambiguity
- Issue: Source payloads likely arrive with a `team` field, so the field name may be externally constrained. The local code, however, also uses derived variables like `teamAbbr` and `normalizedTeam`, which could be clearer as source terms.
- Suggested replacement: Preserve source row field names, but prefer local names such as `sourceTeamName`, `sourceTeamAbbreviation`, and `normalizedSourceTeamName`.
- Replacement score: 3
- Severity: Should change
- Scope: ETL, canonical ingestion

### 6. Repair evidence uses `club` and `sourceTeam`

- Location: `src/data/playerRosterEvidence2026.ts`, `src/server/playerDirectoryRepair.ts`
- Current language: `club`, `sourceTeam`
- Risk category: Mostly acceptable, minor inconsistency
- Issue: This is the strongest area reviewed: repair evidence already distinguishes roster club facts from source team evidence. The only issue is that `sourceTeam` should align with the glossary term `sourceTeamName`.
- Suggested replacement: Prefer `sourceTeamName` in future repair evidence. Existing `sourceTeam` can remain until the repair plan types are migrated.
- Replacement score: 3
- Severity: Nice to change
- Scope: Repair data, evidence docs

## Recommended Migration Plan

1. Update docs first:
   - Add a section to `docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md` defining `sourceTeamName`, `aflClub`, `currentPlayerClub`, and `seasonRegisteredClub`.

2. Add compatibility aliases in shared identity types:
   - Accept `sourceTeamName` alongside existing `team`.
   - Internally prefer `sourceTeamName ?? team`.
   - Keep persisted `UnresolvedPlayerStatRow.team` unchanged until a schema migration is planned.

3. Rename local variables in identity code:
   - `normalizedTeam` to `normalizedSourceTeamName` where the value comes from source input.
   - `normalizedTeam` to `normalizedAflClub` where the value comes from `Player.club`, `PlayerAlias.normalizedClub`, or `PlayerSeasonRegistration.normalizedClub`.

4. Rename local variables in ingestion code:
   - `teamAbbr` to `sourceTeamAbbreviation` where it derives from source rows.
   - `normalizedTeam` to `normalizedSourceTeamName` in match context resolution.

5. Only after the above:
   - Consider schema comments or migrations for `UnresolvedPlayerStatRow.team`.
   - Do not rename Prisma fields without a migration design and tests.

## Do Not Do

- Do not globally replace `team` with `club`.
- Do not rename source payload fields that mirror external data.
- Do not rename Prisma fields in this terminology slice.
- Do not mix this with fantasy team UI terminology cleanup.

## Acceptance Criteria for Implementation

The first implementation slice should be considered complete when:

- `PlayerIdentityInput` supports `sourceTeamName`.
- Internal identity diagnostics use `normalizedSourceTeamName`.
- Existing callers using `team` still work.
- Existing unresolved-row persistence remains backward compatible.
- Identity resolver tests cover the compatibility path and the preferred `sourceTeamName` path.
