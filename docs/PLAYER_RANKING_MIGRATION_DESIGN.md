# Player Ranking Migration Design

## Purpose

This document defines the migration from the current player ranking model to a scalable season-wide ranking system intended for acquisition and discovery.

It is implementation-focused. Its purpose is to lock the ranking contract before schema, API, and publication changes land.

## Problem Statement

Statly currently ranks players by sorting `PlayerSeasonSummary.totalValue` descending.

Today, `totalValue` is produced by `calculateTotalValue()` in `src/types/fantasyCategories.ts`, which:

- applies hard-coded weights to per-game stats
- applies multiplicative utilization modifiers from TOG% and disposal efficiency
- returns a rounded scalar score

This is serviceable as a heuristic score, but it is not the optimal long-term ranking model for a season-wide acquisition surface.

## Goal

Build a season-wide player ranking system that:

- ranks all players with publishable season data, including free agents and unrostered players
- helps users identify who to acquire, not just who is already rostered
- scales operationally as a global published index
- supports future ranking methods without schema churn
- separates ranking semantics from legacy `totalValue`

## Current Shortcomings

### 1. Current rankings are a custom weighted score, not a category valuation model

The current score is effectively a custom points-style heuristic. It does not normalize players relative to the player pool and does not measure value above market availability.

Impact:

- poor acquisition guidance relative to waiver-level alternatives
- hard to explain externally
- difficult to tune systematically

### 2. Current rankings do not encode replacement-level value

For acquisition use, absolute score is less useful than value above what is freely available. The current model has no explicit replacement-level adjustment.

Impact:

- overstates players who are good in isolation but not scarce
- understates roster construction and waiver-wire context

### 3. Ranking semantics are overloaded into `totalValue`

`totalValue` is used across summaries, rankings, and downstream reads. That makes it risky to evolve ranking logic without accidentally changing other behaviors or contracts.

Impact:

- ranking method and summary score are too tightly coupled
- backward compatibility is harder than it needs to be

### 4. Publication is not modeled as its own artifact

Rankings are currently derived directly from season summaries inside the read-model refresh path. This is convenient but mixes:

- player-scoped projection refresh
- season-scoped ranking publication

Impact:

- global ranking publication is harder to evolve independently
- nightly publication behavior is not explicit

### 5. No explicit method/version contract exists

The system does not currently identify which ranking method produced a published ranking snapshot.

Impact:

- rankings are hard to audit
- future method upgrades will be brittle

## Design Principles

The migration should follow these rules:

1. Canonical Firestore raw-match docs remain the only semantic source for player stat inputs.
2. `PlayerSeasonSummary` remains the canonical season aggregate for player-level publication.
3. Rankings become a first-class published global season index.
4. Ranking method identity and version must be explicit.
5. Full ranking publication is allowed nightly because rankings are globally scoped.
6. Player projection refresh remains bounded by changed players.
7. Legacy score compatibility is preserved during cutover.

## Chosen Target Model

### Primary public ranking method

The new default public ranking method will be:

- `zscore_replacement_v1`

This will become the canonical method for the rankings surface.

### Why this method

This method best matches the product goal:

- category-based comparison is normalized across stats
- negative categories can be intentionally penalized
- free agents remain comparable to rostered players
- replacement-level adjustment makes the output useful for acquisition decisions

### What this method is not

It is not:

- a pure points score
- a league-roster-only ranking
- an H2H matchup-optimized simulator

This method is a general season-wide acquisition and discovery index.

## Scope Rules

### Included players

A player is eligible to appear in the published ranking if all are true:

- they have season data in `PlayerSeasonSummary`
- they have played at least `MIN_GAMES_FOR_RANKING`
- they have a canonical player identity
- they are not filtered out by explicit publication rules

### Default minimum games rule

`MIN_GAMES_FOR_RANKING = 2`

Rationale:

- avoids one-game outlier spikes
- allows earlier in-season discovery of free agents and breakout players
- can be raised later if publication noise is too high

This value should be stored with ranking publication metadata, not hard-coded invisibly.

### Small-sample visibility

Because a two-game threshold increases early-season ranking noise, ranking publication should expose a small-sample indicator.

Initial v1 rule:

- players with `gamesPlayed <= 3` are marked as small-sample in ranking metadata or API output

This does not affect eligibility. It is a transparency signal for ranking consumers.

### Roster status

Roster status does not affect eligibility.

Included:

- rostered players
- free agents
- unrostered players

Excluded:

- players with no publishable season summary
- players below the minimum games threshold

## Valuation Method

### Base inputs

The ranking model uses per-game season summary stats from `PlayerSeasonSummary`.

### Category universe

The default public ranking will use the canonical selected category set configured for the global ranking profile.

Initial default category set:

- goals
- kicks
- handballs
- marks
- tackles
- hitouts
- clearances
- inside50s
- rebound50s
- clangers
- contestedPossessions
- uncontestedPossessions
- freesFor
- freesAgainst
- onePercenters
- goalAssists
- turnovers
- intercepts
- metresGained
- contestedMarks
- effectiveDisposals
- scoreInvolvements

Excluded from direct z-score weighting in v1:

- `timeOnGroundPct`
- `disposalEffPct`

Reason:

- they are better treated as explanatory or optional quality signals than as multiplicative ranking modifiers in the default public model
- this avoids hidden nonlinear distortion

### Normalization

For each included category:

1. compute the population mean across eligible players
2. compute the population standard deviation across eligible players
3. compute player z-score as:

`z = (player_value - mean) / stddev`

If standard deviation is zero, category contribution is zero for that publication.

### Negative categories

These categories are inverted before contribution is summed:

- clangers
- freesAgainst
- turnovers

Equivalent implementation:

- use `-z` for negative categories

### Replacement-level adjustment

After summing weighted category z-scores, convert raw z-value into value above replacement.

Initial v1 rule:

- replacement pool is position-aware
- replacement threshold is the lowest publishable player in the rosterable band for each position bucket

Initial position buckets:

- DEF
- MID
- FWD
- RUC
- dual-position players use their best eligible bucket for public ranking display

Initial rosterable band rule:

- derive from the top `N` players per position, where `N` is based on the current configured default fantasy roster assumptions
- if default roster assumptions are not yet stable, use an explicit config constant and store it in metadata

Public value:

- `rankingValue = totalWeightedZ - replacementThresholdForBucket`

### Weighting

Default public weights in v1:

- each included category weight = `1`

Reason:

- the public ranking should represent a neutral category-market baseline
- league-specific weights should be overlays, not the canonical global ranking

### Future methods

The system must be designed to support additional ranking methods later, including:

- `weighted_score_legacy`
- `h2h_gscore_v1`
- `league_weighted_zscore_v1`

These methods are out of scope for this migration, but the storage contract must allow them.

## Schema and Contract Changes

### Keep existing season summary contract

Do not redefine `PlayerSeasonSummary` in this migration.

It remains:

- the player-level season aggregate
- the source input for ranking publication

### Ranking snapshot contract

Extend ranking storage to identify method and version explicitly.

Required additions to `playerRankingSnapshot`:

- `method`
- `methodVersion`
- `eligibilityRule`
- `minimumGames`
- `populationSize`
- optional `metadataJson`

If the current table shape makes this too disruptive, add:

- a new ranking publication table keyed by season, scope, method, version
- and extend snapshot rows minimally with method/version

### Publication record contract

Extend publication tracking to capture:

- ranking method
- ranking method version
- ranking publication timestamp
- minimum-games rule
- eligible player count
- replacement-level config version

## Publication Model

### Canonical publication cadence

The canonical ranking publication runs:

- nightly at `11:00 PM Australia/Melbourne`

This is the main global publication pass.

### Why nightly

Rankings are season-scoped and global. A nightly publication provides:

- predictable cadence
- lower operational churn than per-import global rebuilds
- one canonical publication point users can trust

### Daytime behavior

Daytime imports should:

- update canonical Firestore rows
- refresh affected player projections
- mark ranking publication as dirty for the active season

Daytime imports should not trigger a full season-wide ranking rebuild by default.

### Nightly job behavior

Nightly job steps:

1. resolve target season
2. load eligible `PlayerSeasonSummary` rows
3. compute `zscore_replacement_v1`
4. write ranking snapshot rows for the season and scope
5. update publication metadata
6. clear dirty flag

### Recovery behavior

Manual full ranking rebuild remains supported for:

- backfills
- schema migrations
- ranking method upgrades
- corruption/drift recovery

## API and UI Contract

### Public ranking API

The ranking API should return:

- `method`
- `methodVersion`
- `snapshotAt`
- `minimumGames`
- `populationSize`
- `rank`
- `playerId`
- `playerName`
- `club`
- `position`
- `gamesPlayed`
- `isSmallSample`
- `rankingValue`
- `stats`
- optional category breakdowns

### `totalValue` compatibility

During migration:

- keep `totalValue` in summaries
- do not redefine its meaning silently
- do not use it as the canonical ranking score once the new ranking method is live

If the ranking API still exposes `totalValue`, label it as legacy or internal score until removal.

## Migration Plan

### Phase 1: Introduce ranking method infrastructure

- add method/version fields to ranking storage
- add publication metadata support
- add dirty-flag support for ranking publication
- keep existing ranking output as default

Exit criteria:

- schema supports multiple ranking methods
- no behavior change yet

### Phase 2: Implement `zscore_replacement_v1`

- build ranking engine from `PlayerSeasonSummary`
- implement eligibility rules
- implement z-score computation
- implement replacement-level adjustment
- generate ranking breakdown metadata

Exit criteria:

- new method can be computed in parallel with legacy method

### Phase 3: Dual-run verification

- compute both legacy and `zscore_replacement_v1`
- compare top-N outputs
- inspect positional and free-agent quality
- check for small-sample anomalies

Exit criteria:

- method is considered product-valid for public exposure

### Phase 4: Nightly publication cutover

- schedule canonical nightly ranking publication at 11 PM Australia/Melbourne
- switch ranking API default to `zscore_replacement_v1`
- preserve legacy fallback for rollback window

Exit criteria:

- ranking API and UI default to the new method

### Phase 5: Legacy cleanup

- remove hard dependency on `totalValue` for rankings
- retain legacy score only where still intentionally used
- document future H2H-specific method work separately

Exit criteria:

- rankings no longer depend on legacy ranking semantics

## Verification Requirements

Before cutover, verify:

- eligible free agents appear in rankings
- unrostered players with season data appear in rankings
- players below minimum-games threshold are excluded
- players with 2 or 3 games are included but marked as small-sample
- negative categories correctly penalize rank
- replacement-level adjustment changes ordering in expected ways
- nightly publication writes the correct method/version metadata
- imports mark rankings dirty without forcing immediate season-wide rebuild
- ranking API surfaces the new method metadata

## Operational Requirements

The nightly ranking job must:

- run at 11:00 PM Australia/Melbourne
- require explicit cron authentication
- emit structured logs with season, method, version, player count, and duration
- fail safely without corrupting the last published ranking snapshot

## Deferred Work

This migration does not implement:

- H2H-specific ranking optimization
- G-score or win-probability ranking methods
- fully league-customized public ranking publication
- intra-day incremental rank maintenance

Those remain future enhancements after the canonical season ranking migration is complete.

## Decision Summary

The migration will:

- keep player summaries as the canonical season aggregate
- move rankings to a dedicated published global season index
- replace default ranking semantics with `zscore_replacement_v1`
- include all publishable season players, including free agents
- publish rankings nightly at 11:00 PM Australia/Melbourne
- use `MIN_GAMES_FOR_RANKING = 2` with explicit small-sample visibility
- preserve legacy `totalValue` during cutover but stop treating it as the canonical ranking score
