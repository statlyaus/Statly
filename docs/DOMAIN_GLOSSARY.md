# Statly Domain Glossary

## Purpose

This glossary defines preferred Statly domain terms before terminology is changed in code, APIs, database fields, UI copy, analytics, or documentation.

Use this file with `docs/UBIQUITOUS_LANGUAGE_GOVERNANCE.md` and `docs/STRUCTURED_LANGUAGE_AUDIT_2026-04-27.md`.

When a term touches persisted fields, public APIs, analytics events, or canonical Footywire contracts, do not rename it without a migration plan.

## Term: AFL Club

Definition:
The real-world AFL club a player represents in football source data or player identity facts.

Use when:
Referring to a player's real AFL club, current display club, historical club registration, or AFL fixture participant.

Do not use for:
A user's fantasy team, draft roster, league member team name, or source row value before it has been interpreted.

Preferred code terms:

- `aflClub`
- `currentPlayerClub`
- `seasonRegisteredClub`

Avoid:

- `team` when the concept is a real AFL club
- `club` without a qualifier in new shared domain code

Related terms:

- Fantasy Team
- Source Team Name
- Season Registered Club

## Term: Fantasy Team

Definition:
The team controlled by a Statly user inside a fantasy league.

Use when:
Referring to league rosters, draft ownership, trade participants, matchup participants, or user-managed team names.

Do not use for:
An AFL club, source data team value, or historical player club registration.

Preferred code terms:

- `fantasyTeam`
- `fantasyTeamName`
- `leagueFantasyTeam`

Avoid:

- `team` in shared code where AFL club and fantasy team could both apply

Related terms:

- AFL Club
- League Roster

## Term: Source Team Name

Definition:
The team or club text observed directly in imported source data before canonical identity interpretation.

Use when:
Reading Footywire, AFL Tables, fitzRoy, unresolved identity rows, or raw imported payloads.

Do not use for:
Canonical AFL club facts or fantasy teams after identity resolution.

Preferred code terms:

- `sourceTeamName`
- `sourceTeamAbbreviation`
- `normalizedSourceTeamName`

Avoid:

- `team` in new ingestion or identity code
- `club` before the source value has been resolved

Related terms:

- AFL Club
- Season Registered Club
- Canonical Raw Match Document

## Term: Current Player Club

Definition:
The player's current display/search AFL club on the canonical player profile.

Use when:
Showing the player's current club or filtering current player listings.

Do not use for:
Historical season-specific identity, source-row team context, or fantasy team ownership.

Preferred code terms:

- `currentPlayerClub`
- `currentAflClub`

Avoid:

- `club` in new shared code without lifecycle context

Related terms:

- AFL Club
- Season Registered Club

## Term: Season Registered Club

Definition:
The AFL club a player is registered with for a specific season.

Use when:
Resolving source rows with season context or preserving historical player identity.

Do not use for:
Current display club when historical accuracy matters, fantasy teams, or unresolved source team text.

Preferred code terms:

- `seasonRegisteredClub`
- `playerSeasonRegisteredClub`
- `normalizedSeasonRegisteredClub`

Avoid:

- `currentPlayerClub` for historical source rows
- bare `club` in new identity logic

Related terms:

- AFL Club
- Source Team Name

## Term: Canonical Raw Match Contract

Definition:
The semantic schema persisted at the Firestore raw-match boundary for Footywire-derived player-match data.

Use when:
Referring to the contract shape that defines canonical stat keys, availability, provenance, source priority, and supported raw-match semantics.

Do not use for:
Source rows before persistence, Prisma read models, UI projections, or compatibility fallback shapes.

Preferred code terms:

- `canonicalRawMatchContract`
- `footywireCanonicalRawMatchContract`

Avoid:

- `data`
- `payload`
- `stats` when the full contract is meant

Related terms:

- Canonical Raw Match Document
- Published Player Read Model

## Term: Canonical Raw Match Document

Definition:
A Firestore player-match document that contains the canonical raw-match contract.

Use when:
Reading or writing persisted raw player-match documents from Firestore.

Do not use for:
Prisma projections, API response bodies, source rows, or materialized read-model rows.

Preferred code terms:

- `canonicalRawMatchDocument`
- `rawMatchDocument`

Avoid:

- `data`
- `record`
- `payload`

Related terms:

- Canonical Raw Match Contract
- Published Player Read Model

## Term: Published Player Read Model

Definition:
A serving projection derived from canonical raw-match documents and published for product/API use.

Use when:
Referring to Prisma player summaries, ranking snapshots, recent form summaries, latest snapshots, match-log projections, or roster player summaries after rebuild/rematerialization.

Do not use for:
Canonical raw Firestore data or source import payloads.

Preferred code terms:

- `publishedPlayerReadModel`
- `playerReadModelProjection`
- `playerReadModelPublication`

Avoid:

- `data`
- `projection` without a domain qualifier

Related terms:

- Canonical Raw Match Document
- Ranking Value

## Term: Fixture Result Status

Definition:
The lifecycle state of an AFL fixture or match result.

Use when:
Describing whether an AFL fixture is scheduled, in progress, or final.

Do not use for:
Draft, trade, waiver, health, import, or league season lifecycle states.

Preferred code terms:

- `fixtureResultStatus`
- `matchResultStatus`

Avoid:

- `status` in new shared types

Related terms:

- League Season Round Status

## Term: League Season Round Status

Definition:
The lifecycle state of a fantasy league's season round or schedule week.

Use when:
Describing schedule weeks, league matchups, and materialized league season state.

Do not use for:
AFL fixture result state, draft lifecycle, trade review state, waiver claims, or health checks.

Preferred code terms:

- `leagueSeasonRoundStatus`
- `scheduleWeekStatus`

Avoid:

- `status` in new shared types

Related terms:

- Fixture Result Status

## Term: Draft Lifecycle Status

Definition:
The lifecycle state of a draft room or draft process.

Use when:
Describing draft states such as scheduled, lobby, countdown, live, paused, or completed.

Do not use for:
League season rounds, fixture results, trade review, or waiver state.

Preferred code terms:

- `draftLifecycleStatus`
- `draftRoomStatus`

Avoid:

- `status` in new shared draft APIs

Related terms:

- Fantasy Team

## Term: Trade Review Status

Definition:
The lifecycle state of a fantasy trade proposal or review decision.

Use when:
Describing proposed, accepted, review-pending, executed, declined, rejected, cancelled, or superseded trades.

Do not use for:
Draft, fixture, waiver, league, or health state.

Preferred code terms:

- `tradeReviewStatus`
- `tradeLifecycleStatus`

Avoid:

- `status` in new shared trade APIs

Related terms:

- Fantasy Team

## Term: Waiver Claim Status

Definition:
The lifecycle state of a fantasy waiver claim.

Use when:
Describing submitted, pending, successful, failed, cancelled, or rejected waiver claims.

Do not use for:
Trade review, draft lifecycle, fixture state, or health checks.

Preferred code terms:

- `waiverClaimStatus`
- `waiverLifecycleStatus`

Avoid:

- `status` in new shared waiver APIs

Related terms:

- Fantasy Team

## Term: Ranking Value

Definition:
The scalar value used to sort players for a named ranking method and version.

Use when:
Referring to the published ranking number used for player discovery, acquisition, or comparison.

Do not use for:
Actual fantasy scores, projected fantasy scores, source stat values, prices, salaries, or legacy weighted totals.

Preferred code terms:

- `rankingValue`
- `playerRankingValue`

Avoid:

- `value`
- `score`
- `totalValue` for new ranking work

Related terms:

- Legacy Total Value
- Fantasy Value Rating

## Term: Legacy Total Value

Definition:
The existing compatibility field for Statly's older weighted stat model.

Use when:
Maintaining backwards compatibility with existing Prisma fields, APIs, or UI that still depend on `totalValue`.

Do not use for:
New ranking semantics or user-facing ranking method names.

Preferred code terms:

- `legacyTotalValue`
- `totalValue` only when reading or writing existing compatibility fields

Avoid:

- Treating `totalValue` as the canonical future ranking term

Related terms:

- Ranking Value
- Fantasy Value Rating

## Term: Fantasy Value Rating

Definition:
A user-facing valuation concept derived from Statly's scoring or ranking model when it is not actual AFL fantasy points.

Use when:
Explaining a player value estimate, ranking score, or comparison metric to users.

Do not use for:
Actual match fantasy score, projected fantasy score, salary, price, or ownership.

Preferred code terms:

- `fantasyValueRating`
- `playerFantasyValueRating`

Avoid:

- `value`
- `score`

Related terms:

- Ranking Value
- Projected Fantasy Score
- Actual Fantasy Score

## Term: Projected Fantasy Score

Definition:
The estimated fantasy score a player is expected to record for a future or incomplete AFL round.

Use when:
Referring to forward-looking fantasy scoring estimates.

Do not use for:
Actual match scores, ranking values, weighted stat ratings, or historical averages.

Preferred code terms:

- `projectedFantasyScore`
- `roundProjectedFantasyScore`

Avoid:

- `projectedScore` in new public contracts without the fantasy qualifier
- `score`

Related terms:

- Actual Fantasy Score
- Fantasy Value Rating

## Term: Actual Fantasy Score

Definition:
The fantasy score a player recorded after a match is final.

Use when:
Referring to completed match scores or historical fantasy scoring output.

Do not use for:
Projected scores, ranking values, source stat values, or weighted custom ratings.

Preferred code terms:

- `actualFantasyScore`
- `roundActualFantasyScore`

Avoid:

- `score` without a qualifier

Related terms:

- Projected Fantasy Score
- Fixture Result Status
