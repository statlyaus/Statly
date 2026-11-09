# AFL ETL

Statly's ETL package fetches the AFL fixture and AFL match statistics from Footywire through fitzRoy,
streams normalized rows through TypeScript, and writes them to Firestore. It is separate from protected
league/draft ownership, which remains in Prisma.

There is one supported source path and there is no mock-data fallback.

## Pipeline

```text
fetch_fw_fixture.R → NDJSON stdout → fetchPipeline.ts → fixtureIngest.ts → processFixtureData.ts → Firestore matches
fetch_fw_round.R → NDJSON stdout → fetchPipeline.ts → normalizePlayerRow.ts → processFootywireData.ts → Firestore player_match_stats
```

- `fetch_fw_fixture.R` reads a season's Footywire fixture with `fetch_fixture(source = "footywire")`
  and the count of games Footywire has posted match stats for. It emits one JSON row per game.
- `fixtureIngest.ts` turns those rows into `matches` documents (`match_uid`
  `<season>-R<round>-<HOME>-<AWAY>`, `season`, `round_number`, `round`, `home_team`, `away_team`,
  `venue`, `start_time_utc`, `status`, `confirmed_bye_teams`). Lineup locks, competition round timing,
  live matchup totals, the `/matches/[round]` page and `GET /api/matches`, `liveGuard.ts` and the
  stats processor's live gate all read this collection.
  - Footywire prints start times in the venue's local time (fitzRoy labels them UTC). Each venue maps
    to its time zone; an unknown venue fails the run.
  - `status` is `final` for the first N games of the season, where N is Footywire's posted-stats count
    (Footywire posts match stats in fixture order), `in_progress` for a game that has started without
    posted stats, and `scheduled` otherwise. A count larger than the number of started games fails the
    run.
  - Home-and-away rounds keep Footywire's number (`Round 0` is the Opening Round). Footywire names
    finals instead of numbering them, so each finals week is numbered on from the season's last
    home-and-away round, as the AFL does: Qualifying and Elimination Finals are last + 1, Semi Finals
    - 2, Preliminary Finals + 3 and the Grand Final + 4 (2025: Round 24, then finals rounds 25 to 28,
      so the Grand Final is `2025-R28-<HOME>-<AWAY>`). `fetch_fw_round.R` numbers stats rows by the same
      rule, so a final's stats carry the fixture's `match_uid`. Any other round label fails the run.
  - Clubs with no game in a round are its `confirmed_bye_teams`; in a finals round that is every club
    not playing that week.
  - Every row is checked before the first write, and only documents whose fields changed are written.

- `fetch_fw_round.R` loads Footywire data through fitzRoy and emits one JSON row per line, for the
  requested round or, when none is given, the season's latest round (finals included). Finals are
  numbered by the fixture rule above; an unknown round label fails the fetch.
- `fetchPipeline.ts` resolves the same assets from source and compiled runtimes. It **streams the R
  fetcher output directly** into the compiled processor and propagates process/pipe failures.
- `normalizePlayerRow.ts` validates required identity fields and converts supported numeric values into
  the canonical row shape without initializing Firebase or performing writes.
- `processFootywireData.ts` consumes normalized rows, adds deterministic identifiers and checksums, and
  writes match/player-stat documents. A row's `match_uid` is the fixture's `<HOME>-<AWAY>` match for
  its two clubs, whichever club the row belongs to (the stats feed lists the player's own club first).
  A row whose game is not in the loaded fixture fails and is not written; load the fixture first.
  Live runs store a game's stats while it is `in_progress` or `final` (Footywire posts match stats
  after full time, when the fixture marks the game final) and skip a `scheduled`, unknown or missing
  status. Backfill (`BACKFILL_MODE=true`) stores historical games whatever their status.
- `liveGuard.ts` refreshes the fixture every `FIXTURE_REFRESH_MS` (default 15 minutes), then runs the
  stats pipeline only during a live window: a game is `in_progress`, or a game that started in the
  last 6 hours is `final`, so the last game of a day still has its stats fetched once they are posted.
  A failed fixture refresh skips the cycle.
- `backfill.ts` loads each season's fixture, then uses the same shared pipeline for bounded historical
  seasons/rounds, and fails the command if the fixture or any requested round fails.
- `validateMatchData.ts` checks match and player-stat invariants.

## Requirements

- Node.js 22 and npm
- R 4.6.1 or a newer compatible release, with `fitzRoy`, `jsonlite`, `janitor`, `dplyr`, and `stringr`
- an authorized Firebase project and server-only service-account credential for remote writes

Install the package:

```sh
cd etl
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

Install or verify the R dependencies using `setup_r.sh` or the equivalent reviewed R environment.

## Environment

`liveGuard.ts` and backfill load an ignored `etl/.env` through `dotenv`. Start from the safe root
example and keep all real values untracked:

```sh
cp ../.env.example .env
```

Required for Firestore access:

- `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64`: complete encoded service-account JSON.

Optional live selection:

- `SEASON`: defaults to the current year.
- `ROUND`: when omitted, the fetcher chooses its supported default/current behavior.

Do not commit `.env`, raw/encoded keys, downloaded service-account JSON, NDJSON output, or temporary key
files. Prefer workload identity or deployment secret management when supported.

## Commands

```sh
# Lint JavaScript, TypeScript, tests, and package configuration, then parse the R fetcher
npm run lint

# Parse the R fetcher without loading packages or accessing Footywire
npm run lint:r

# Type-check without emitting build output
npm run typecheck

# Build and run deterministic tests that do not require R or Firebase credentials
npm test

# Compile TypeScript
npm run build

# Verify that the R fetcher can run for a bounded round (external read)
npm run test-r

# Load the current season's fixture into Firestore matches (writes to the configured project)
npm run fixture

# Run the complete fetch/process path (writes to the configured Firestore project)
npm run test-pipeline

# Start the live-window guard
npm start

# Backfill a bounded range through the canonical pipeline
npm run backfill -- 2024 2024 1 24

# Validate already-ingested match documents
npm run validate -- 2025-R18-ADE-COL
```

Commands that reach Firestore are data operations. Confirm the target project without printing
credentials, use the narrowest season/round, and do not run them against production without explicit
authorization.

## Identity and schema

The processor creates deterministic match/player identifiers and retains source checksum/evidence.
External names are weak evidence: ambiguous rows must be reported, not used to merge canonical
protected player ownership silently. Stats reach a Statly player only through a reviewed `footywire`
identity link (`npm run player-identity:footywire`, see `docs/runbooks/player-identity.md`).

A player-match document contains season, round, clubs, normalized player identity, supported numeric
stats, source checksum, source label, and update time. Category keys must stay aligned with
`src/types/fantasyCategories.ts`, including the real-data nine-category preset.

## Failure policy

- Missing R or required packages blocks the pipeline.
- Fetch, stream, parse, validation, and Firestore write failures produce a failed exit.
- A fixture row with an unknown club, venue or start time, or a posted-stats count the fixture cannot
  explain, fails the fixture run before any write.
- Live cycles may retry after their configured delay, but a failed cycle is never reported as success.
- Backfill reports every failed season/round and exits non-zero.
- There is no alternate Python scraper, browser scraper, or mock production source.

## Deployment

`Dockerfile` builds the ETL runtime: Node 22 for the live guard and processor, and R 4.5.1 with
fitzRoy 1.7.0 on the same pinned base and CRAN snapshot as the trade capture image. The ETL CI job
builds it on every change and checks that Node, the R packages and `fetch_fw_round.R` are present.
`deploy.sh` is the existing explicit Cloud Run deployment command;
it builds, verifies R packages, deploys a no-traffic revision, and requires a separately authorized
traffic switch. It is not called by the repository's GitHub Actions and must not be treated as an
automatic deployment.

`Dockerfile` is the only ETL image definition; the stale `Dockerfile.backup` and `Dockerfile.new` copies
have been removed. Do not use one-off upload/debug scripts as production source of truth.

## Verification

For ETL code or documentation changes, run:

```sh
cd etl
npm ci
npm run lint
npm run typecheck
npm test
npm run build
cd ..
npm run test:unit -- tests/unit/etlSourceOfTruth.test.ts
npm run docs:check
```

External fetch/Firestore verification requires explicit target and credential authorization. Report it
as skipped when those prerequisites are unavailable; do not replace it with fabricated evidence. The
required `lint:r` check is intentionally limited to deterministic source parsing, while `test-r` and
`test-pipeline` remain opt-in external checks.
