# Schema Design Review

Review started on 2026-04-26 as Task 2 of `2026-04-26-repository-convergence-completion.md`.

## Goal Assessment

The goal of this review is to prove the data model supports the long-term architecture rather than merely passing Prisma validation.

The schema should satisfy two different design constraints:

- Prisma should model normalized relational subjects with stable keys, explicit relationships, and intentional indexes.
- Firestore should remain the canonical document boundary for Footywire player-match semantics, with Prisma read models acting only as denormalized projections.

Success means the database design supports single-contract convergence, repeatable repair, scoped rebuilds, and operational auditability.

## Shortcomings Against That Goal

The first review identified useful facts, but it did not go far enough as an execution guide:

- It says projection lineage needs follow-up but does not turn that into a schema/API decision.
- It identifies omitted `onDelete` policies but does not specify the desired long-term policy.
- It notes that `Player.club` must be current display/search state only, but does not require resolver tests proving season registrations take precedence.
- It confirms migration replay after cleanup, but does not make "no root SQL files in `prisma/migrations/`" a permanent rule.
- It allows `PlayerProjectionPublication` to cover broad publication status, but does not require match-log projection lineage to be explicit.
- It identifies Firestore duplicate match IDs as backlog, but does not define the acceptance rule: duplicates may be tolerated only if canonical resolution is deterministic and verified.

## Rewritten Long-Term Design Decision

The schema direction is sound, with these binding decisions:

- `Player`, `PlayerAlias`, `PlayerSeasonRegistration`, and `UnresolvedPlayerStatRow` are normalized identity/quarantine facts.
- `Player.club` is current display/search state, not historical identity authority.
- `PlayerSeasonRegistration` is the season-aware club/position source for identity resolution when season context exists.
- `PlayerSeasonSummary`, `PlayerRankingSnapshot`, `PlayerRecentFormSummary`, `PlayerLatestSnapshot`, `PlayerMatchLogProjection`, and `LeagueRosterPlayerSummary` are read models only.
- Read models may store JSON payloads for performance, but those payloads are derived artifacts and must be rebuildable.
- `PlayerProjectionPublication(scope='season')` is the publication ledger for the player projection family for a season, including `PlayerSeasonSummary`, `PlayerRankingSnapshot`, `PlayerRecentFormSummary`, `PlayerLatestSnapshot`, `PlayerMatchLogProjection`, and `LeagueRosterPlayerSummary`.
- Individual projection tables intentionally do not store separate contract versions today. Their lineage is the season/scope publication row plus deterministic rebuild code from canonical Firestore raw docs. If future partial publication requires independently publishing match logs/latest snapshots, add explicit projection-family lineage columns or a child publication table rather than overloading stat payload JSON.
- `Trade`, `TradeItem`, and audit/vote/action tables are normalized transactional records. Audit records should be retained with restrictive parent deletion policies unless product policy explicitly permits cascade.
- `prisma/migrations/` must contain only Prisma migration directories and `migration_lock.toml`; legacy/manual SQL belongs outside the executable migration path.

## Rewritten Required Fix Plan

1. Projection lineage decision:
   - Decision closed for this gate: `PlayerProjectionPublication(scope='season')` covers all player projection families for the season.
   - Future independent match-log/latest publication requires a new explicit lineage model, not stat JSON overloading.
2. Add resolver precedence tests:
   - Season registration must beat mutable `Player.club` when resolving source rows with season context.
3. Audit downstream stat readers:
   - Any reader using top-level Firestore fields, `data.stats`, or `raw_row` after canonical stats exist must be isolated as temporary compatibility with exit criteria.
4. Document deletion policy:
   - Trade/audit-bearing relations default to retention/restrict; cascading must be explicit and justified.
5. Preserve migration hygiene:
   - Add a check or review rule that `find prisma/migrations -maxdepth 1 -type f` returns only `migration_lock.toml`.
6. Add Firestore duplicate match handling rule:
   - Duplicate match docs are acceptable only during migration if canonical resolver deterministically selects one match ID and verifier proves no raw/projection drift for affected scope.

## Relational Purpose

Prisma should own normalized application and identity data:

- users, sessions, credentials, leagues, league members, drafts, trades, waivers
- canonical AFL player identity and aliases
- unresolved player-stat quarantine
- denormalized serving projections derived from canonical Firestore raw documents

Firestore should own canonical Footywire player-match raw documents. Prisma projections should not become a second semantic source for Footywire stats.

## Entity And Subject Boundaries

Aligned:

- `Player` is the canonical player entity.
- `PlayerAlias` represents observed provider names and scoped alias facts, not duplicated players.
- `PlayerSeasonRegistration` represents season/club/position facts without mutating historical identity.
- `UnresolvedPlayerStatRow` quarantines unresolved inbound source rows.
- `PlayerSeasonSummary`, `PlayerRankingSnapshot`, `PlayerRecentFormSummary`, `PlayerLatestSnapshot`, `PlayerMatchLogProjection`, and `LeagueRosterPlayerSummary` are projection/read-model tables.
- Trade tables are separated into `Trade`, `TradeItem`, `TradeAudit`, `TradeReviewVote`, `TradeAction`, and `TradePlayerLock`.

Closed for this gate:

- Projection family lineage is represented by `PlayerProjectionPublication(scope='season')`, publication dirty flags, and deterministic rebuild inputs.
- Projection JSON remains derived output only; it is not a canonical source for Footywire stat semantics.

## Primary Keys

Aligned:

- Most operational tables use stable `cuid()` surrogate IDs.
- `TradePlayerLock` correctly uses a composite primary key of `(leagueId, playerId)` because the lock subject is league-player occupancy.
- `Player.id` is a stable canonical identifier used as a foreign key throughout identity and projection tables.

Needs follow-up:

- Review generated IDs in repair/import scripts to ensure new `PlayerSeasonRegistration.id` values are deterministic and collision-resistant enough for replay.
- Firestore `player_match_stats` document IDs can be match/player derived, but duplicate match IDs such as `KAN` vs `NOR` must remain migration concerns, not permanent identity variants.

## Relationships And Foreign Keys

Aligned:

- Identity child rows cascade from `Player` where deletion should remove dependent facts or projections.
- `UnresolvedPlayerStatRow.resolvedPlayerId` uses `SetNull`, preserving quarantine history if a player is removed.
- `TradeItem.playerId` and waiver player references use `Restrict`, preserving transactional history.
- Trade audit/action/vote rows cascade from `Trade`.

Needs follow-up:

- `Trade` relations to `League` and `User` currently omit explicit `onDelete`. That may be acceptable if Prisma defaults prevent deletion, but the policy should be documented because trades are audit records.
- `Session.user` omits explicit `onDelete`; decide whether user deletion should cascade sessions consistently with `UserCredential`.

## Normalization Review

Aligned with 1NF/2NF/3NF:

- Player aliases are split from players, avoiding repeated alias strings on `Player`.
- Season registrations are split from current `Player.club`, avoiding mutable current-club inference for historical source rows.
- Trade items are split from trades, avoiding repeated player item columns.
- Trade audit records are split from trades, avoiding repeated event columns.
- Read-model JSON fields are projection payloads, not normalized source facts.

Needs follow-up:

- Confirm `Player.club` is treated as current display/search state only. Historical identity resolution should prefer `PlayerSeasonRegistration` where season context exists.
- Confirm projection JSON payloads are never manually edited or used as source facts.

## Intentional Denormalization

Valid denormalized projection tables:

- `PlayerSeasonSummary`
- `PlayerRankingSnapshot`
- `PlayerRecentFormSummary`
- `PlayerLatestSnapshot`
- `PlayerMatchLogProjection`
- `LeagueRosterPlayerSummary`

Design rule:

- These are allowed because they optimize app/API reads.
- They must be rebuildable from canonical Firestore raw docs plus normalized Prisma identity/configuration.
- They must not define stat presence, provenance, player identity, or match identity semantics.

Lineage decision:

- `PlayerProjectionPublication(scope='season')` is the season-level publication ledger for the complete player projection family.
- `rankingsDirty` and `rostersDirty` already represent dependent publication state for ranking and roster families.
- `PlayerMatchLogProjection` and `PlayerLatestSnapshot` are rebuilt as part of the player read-model refresh and are covered by the season/scope publication record for this program.
- Do not add per-row lineage columns in this gate; that would add schema surface without solving a current verifier failure.
- If future product requirements publish match logs independently from summaries, add an explicit projection-family publication table keyed by `(season, scope, family)` with counts, dirty flags, and published timestamps.

## Index And Access Pattern Review

Aligned:

- `PlayerAlias` has lookup indexes on normalized alias, club/scope, player, and seasons.
- `PlayerSeasonRegistration` has season/club, player/season, and season/active indexes.
- `UnresolvedPlayerStatRow` has season/status and normalized player/team indexes.
- `PlayerSeasonSummary` has season and season-based sort/filter indexes.
- `PlayerRankingSnapshot` has unique and lookup indexes by season/scope/method/version.
- `PlayerMatchLogProjection` has player/season/round/date and season/round/date indexes.
- Trade and waiver tables have status/time query indexes.

Needs follow-up:

- Add an index review against actual route queries after bounded rematerialization is finalized.
- Check sort direction needs for ranking values and total values. SQLite can scan indexes in reverse, but future Postgres migration should make sort usage explicit.

## Firestore Contract Review

Aligned:

- Current architecture docs identify Firestore `player_match_stats` as the canonical persisted semantic source.
- `src/lib/stats/footywireCanonicalContract.ts` exists to centralize stat keys, availability, provenance, and source priority.
- Recent verifier work proves 2026 rounds 0-1 can converge across live source, raw docs, projections, and summaries.

Needs follow-up:

- Continue removing permanent downstream reads from top-level legacy fields, `data.stats`, and `raw_row` where canonical stats exist.
- Keep compatibility adapters isolated with removal criteria.
- Keep shared team identity aliases in `shared/player-identity/teamNames.ts`; do not reintroduce stage-local `TEAM_ABBR` maps.
- Duplicate Firestore match docs such as `2026-R1-KAN-POR` and `2026-R1-NOR-POR` should be treated as data repair/migration issues, not permanent alternate match identities.

## Migration Replay Review

Reviewed new migration files:

- `20260423000000_add_player_projection_publication_ranking_metadata`
- `20260423001000_add_player_ranking_snapshot_metadata`
- `20260426000000_add_player_season_registration_and_alias_scope`

Initial findings:

- Ranking/publication metadata migrations are additive and replayable in shape.
- Ranking snapshot migration drops old unique/index names before creating method/version-aware indexes.
- Season registration migration backfills 2026 registrations from current `Player` rows, which is operationally useful but must be documented as a seed/backfill assumption.
- Initial clean replay failed with a schema-engine error because tracked standalone SQL files existed directly under `prisma/migrations/`.
- Moving those legacy/manual SQL files to `prisma/legacy-migrations/` restored a valid Prisma migration directory shape.

Verification:

```bash
npx prisma validate --schema prisma/schema.prisma
touch /tmp/statly-program-completion.db
DATABASE_URL=file:/tmp/statly-program-completion.db npx prisma migrate deploy --schema prisma/schema.prisma
rm -f /tmp/statly-program-completion.db
```

Result:

- Prisma schema validation passed.
- `find prisma/migrations -maxdepth 1 -type f -print` returned only `prisma/migrations/migration_lock.toml`.
- Clean migration replay applied all 32 Prisma migrations successfully after the legacy SQL files were moved.
- Prisma 6.16.1 reports P1003 if the SQLite replay database file does not exist before deploy; creating an empty temporary SQLite file before replay is the verified local procedure.
- Temporary replay database was removed after verification.

Required follow-up:

- Confirm the `PlayerAlias.scopeKey` default and backfill match resolver expectations.
- Confirm `INSERT OR IGNORE` for 2026 registrations is acceptable and does not hide bad duplicate source data.

## Required Fixes

1. Projection lineage review for `PlayerMatchLogProjection` and `PlayerLatestSnapshot` is closed for this gate: they are covered by season/scope `PlayerProjectionPublication`.
2. Audit all downstream stat readers and isolate/remove permanent legacy fallbacks.
3. Document deletion policy for audit-bearing trade/session relations where `onDelete` is omitted.
4. Review bounded rematerialization requirements before changing import/rebuild APIs.
5. Treat Firestore duplicate match IDs as a data-repair backlog item after canonical raw/projection convergence remains stable.
6. Keep `prisma/migrations/` free of standalone SQL files; place manual/legacy SQL under `prisma/legacy-migrations/` or another non-Prisma path.
