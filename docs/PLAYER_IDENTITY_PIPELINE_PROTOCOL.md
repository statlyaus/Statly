# Player Identity Pipeline Protocol

## Purpose

This document defines the operational protocol for Statly's player identity pipeline.

The goal is to keep player identity decisions:

- reproducible
- auditable
- reversible through explicit data changes
- isolated from downstream read-model publication

This protocol treats Prisma as the source of truth for canonical player identity and Firestore as the downstream store for resolved event data and read models.

## System Boundaries

### Identity source of truth

Prisma owns:

- canonical players in `Player`
- aliases in `PlayerAlias`
- unresolved or ambiguous inbound rows in `UnresolvedPlayerStatRow`

### Downstream publication

Firestore owns:

- canonical resolved event rows in `player_match_stats`
- derived read models and query-facing data

### Rule

Rows without a canonical identity must not be published to canonical Firestore collections.

If a row cannot be resolved confidently, it must be quarantined in Prisma.

## Canonical Principles

The pipeline follows these principles:

1. Explicit identity over heuristic publication.
2. Quarantine over silent fallback.
3. Replay over one-off repair writes.
4. Forward-only migrations over local schema patching.
5. Measurable operational health over guesswork.

## Data Model

### `Player`

Canonical player identity record.

Minimum operational meaning:

- one stable canonical `id`
- one current display name
- one current club
- one current position

### `PlayerAlias`

Maps observed provider names and team contexts onto canonical players.

Used for:

- provider-specific naming differences
- short names and alternate spellings
- historic naming or club-specific context

### `UnresolvedPlayerStatRow`

Quarantine table for inbound rows that are not safe to publish.

Used for:

- unresolved identities
- ambiguous identities
- operational backlog review
- replay after alias or player fixes

Statuses:

- `NEW`: no canonical match found
- `REVIEWED`: multiple candidates found and human review is needed
- `RESOLVED`: replay succeeded and canonical player was assigned
- `DISMISSED`: intentionally excluded from active replay workflow

## Ingest Protocol

### Inputs

Inbound player stat rows arrive from ETL sources such as Footywire-derived feeds.

### Resolution path

For each inbound row:

1. Normalize player name and team.
2. Attempt canonical resolution from explicit canonical ID if present.
3. Attempt canonical player match from `Player`.
4. Attempt alias match from `PlayerAlias`.
5. If exactly one canonical player is found, publish canonically.
6. If zero candidates are found, quarantine in `UnresolvedPlayerStatRow`.
7. If multiple candidates are found, quarantine in `UnresolvedPlayerStatRow`.

### Observe mode

Observe mode exists to inspect ETL outcomes without mutating Firestore or Prisma quarantine.

Use observe mode first when validating:

- new ETL logic
- new data sources
- changed identity rules
- changed season backfills

Expected observe outputs:

- `observed_resolved`
- `observed_quarantined_unresolved`
- `observed_quarantined_ambiguous`

### Publication rule

Only resolved rows may be written to Firestore `player_match_stats`.

Unresolved or ambiguous rows must stop before publication.

## Unresolved Review Workflow

### Reporting

Use:

```bash
npx tsx Scripts/report-unresolved-player-stat-rows.ts --limit=25
```

Use `--season=YYYY` when working a bounded backlog.

The report groups unresolved identities by:

- `source`
- `season`
- `playerName`
- `team`

This is the primary operational view for recurring identity failures.

### Review rules

When reviewing unresolved rows:

1. Prefer adding a `PlayerAlias` when the canonical player already exists.
2. Add a new canonical `Player` only when the player is genuinely missing.
3. Keep alias changes explicit and narrow.
4. Preserve season and club context when ambiguity is real.
5. Do not patch Firestore directly as the primary fix.

### Acceptable fixes

- add alias for known player/provider mismatch
- add missing canonical player
- correct canonical player club if the source of truth is wrong

### Unacceptable fixes

- direct manual Firestore-only repair without Prisma identity update
- hidden fallback matching that bypasses quarantine
- source-specific one-off hacks that are not represented in Prisma identity data

## Replay Protocol

After each alias or canonical player update, replay unresolved rows.

Use:

```bash
npx tsx Scripts/replay-unresolved-player-stat-rows.ts --dry-run --limit=25
```

Then:

```bash
npx tsx Scripts/replay-unresolved-player-stat-rows.ts --limit=25
```

### Replay expectations

For resolved rows:

- Firestore `player_match_stats` receives canonical `player_id`
- Prisma row moves to `RESOLVED`
- `resolvedPlayerId` and `resolvedAt` are set

For still-unresolved rows:

- they remain in Prisma quarantine
- no canonical Firestore publication occurs

### Replay rule

Replay is the standard repair mechanism.

Historic backfill or direct repair scripts must not be the primary day-to-day maintenance path once the unresolved queue workflow is stable.

## Read Model Rebuild Protocol

After replaying resolved rows, rebuild affected read models.

Use:

```bash
npx tsx Scripts/build-player-read-models.ts --season=YYYY
```

Expected outputs include:

- `playerSeasonSummaries`
- `rankingSnapshots`
- `rosterSummaries`
- `skippedWithoutCanonicalId`

### Health metric

`skippedWithoutCanonicalId` is the primary read-model health signal for missing canonical identity in downstream event data.

Target:

- trend toward zero

If non-zero:

1. inspect unresolved queue
2. verify replay has been run after identity updates
3. verify canonical Firestore rows actually contain `player_id`

## Season Player Directory Convergence Protocol

When the identity-gap diagnostic reports `player_id_not_in_prisma`, do not patch Firestore and do not add projection fallbacks. The correct repair is to converge the reviewed Prisma player directory with the canonical ids already persisted in Firestore.

Use this workflow:

```bash
npm --silent run diagnose:player-identity-gaps -- --season=YYYY --rounds=R --json --output-jsonl tmp/identity-gap-YYYY-rR.jsonl --output-csv tmp/identity-gap-YYYY-rR.csv
npm --silent run sync:player-directory-season -- --season=YYYY --diagnostic-jsonl tmp/identity-gap-YYYY-rR.jsonl
npm --silent run sync:player-directory-season -- --season=YYYY --diagnostic-jsonl tmp/identity-gap-YYYY-rR.jsonl --apply
npm --silent run diagnose:player-identity-gaps -- --season=YYYY --rounds=R --json
npm --silent run build:player-read-models -- --season=YYYY --rounds=R --mode=refresh
npm --silent run verify:player-read-models -- --season=YYYY --rounds=R --include-merged-live --json
```

The sync command must refuse apply until reviewed roster evidence covers every actionable diagnostic `player_id_not_in_prisma` id. Diagnostic rows without canonical stats and without a raw row are treated as non-semantic stale rows for coverage; do not create duplicate Prisma players solely to satisfy those rows.

Generated `tmp/` artifacts and local SQLite databases are local evidence and must not be committed unless explicitly promoted to reviewed fixtures.

## Full Player Data Convergence Rollout Protocol

The 2026 round 0 repair proves the player-directory convergence path for one bounded slice.
Other rounds and seasons are not considered repaired until they have been run through the same
evidence-gated sequence.

Use the convergence runner for each planned slice:

```bash
npm --silent run converge:player-data -- --season=YYYY --rounds=R --include-merged-live --json
```

This default run diagnoses identity gaps, writes local `tmp/player-data-convergence/` artifacts,
and dry-runs the reviewed roster sync. It does not apply Prisma directory writes.

Apply only when the dry-run reports complete reviewed roster coverage:

```bash
npm --silent run converge:player-data -- --season=YYYY --rounds=R --apply-directory-sync --include-merged-live --json
```

If the dry-run reports missing stored player ids or evidence mismatches, stop and add reviewed
roster evidence first. Do not create players directly from diagnostic rows and do not patch
Firestore as the primary fix.

For broad rollout, prefer small slices:

1. remaining 2026 rounds, one round or short contiguous range at a time
2. 2025 season slices after 2026 is clean
3. older seasons only after product requirements confirm those seasons need app-facing projections

Each claimed slice must exit with:

- `coverageOk: true` from directory sync
- `missingStoredPlayerIds: 0`
- `evidenceMismatchErrors: 0`
- `skippedWithoutCanonicalId: 0` from read-model build
- verifier `status: "pass"`
- no `dropped_before_raw`
- no `dropped_in_projection`

Generated `tmp/player-data-convergence/` artifacts are local evidence. Commit only reviewed source
fixtures or docs, never local database files or transient diagnostic exports.

## Migration Protocol

Schema changes for identity tables must be introduced through forward-only Prisma migrations.

Requirements:

- migration chain must replay from zero
- `npx prisma migrate dev --schema prisma/schema.prisma` must succeed
- identity tables must exist in migration history, not only in local drift

Do not treat local database state as canonical.

The canonical schema is:

- `prisma/schema.prisma`
- committed migration history in `prisma/migrations`

## Verification Checklist

For any identity-pipeline change, verify:

1. `npx prisma migrate status --schema prisma/schema.prisma`
2. `npx prisma generate --schema prisma/schema.prisma`
3. ETL observe mode returns expected outcomes
4. unresolved rows land in Prisma quarantine
5. replay dry-run is side-effect free
6. replay moves resolvable rows to `RESOLVED`
7. Firestore replay writes contain canonical `player_id`
8. read-model rebuild completes
9. `skippedWithoutCanonicalId` is checked

## Normal Operations

The standard operating loop is:

1. ingest
2. quarantine unresolved rows
3. report backlog
4. add alias or canonical player
5. replay unresolved rows
6. rebuild read models
7. verify metrics

This loop should replace old repair-first maintenance flows.

## Incident Guidance

If unresolved volume spikes:

1. stop assuming source data is safe to publish
2. run report by source and season
3. check whether a provider naming pattern changed
4. add targeted aliases or canonical records
5. replay incrementally
6. rebuild affected seasons

If replay resolves nothing unexpectedly:

1. inspect candidate IDs and normalization behavior
2. confirm alias records are in Prisma, not only in Firestore
3. confirm the replayed season and source match the backlog rows

## Future Guardrails

The following follow-up work should remain in scope:

- unresolved queue monitoring in normal ops
- explicit runbook references from ETL docs
- tests around quarantine, replay lifecycle, and idempotency
- retirement of obsolete repair-only identity logic once replay workflow is proven

## Summary

Statly's player identity protocol is:

- Prisma for canonical identity
- Firestore for resolved downstream data
- quarantine for uncertainty
- replay for repair
- rebuild for read-model convergence
- metrics for operational confidence
