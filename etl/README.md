# AFL ETL

Statly's ETL package fetches AFL match statistics from Footywire through fitzRoy, streams normalized
rows through TypeScript, and writes live-stat evidence to Firestore. It is separate from protected
league/draft ownership, which remains in Prisma.

There is one supported source path and there is no mock-data fallback.

## Pipeline

```text
fetch_fw_round.R → NDJSON stdout → fetchPipeline.ts → processFootywireData.ts → Firestore
```

- `fetch_fw_round.R` loads Footywire data through fitzRoy and emits one JSON row per line.
- `fetchPipeline.ts` resolves the same assets from source and compiled runtimes. It **streams the R
  fetcher output directly** into the compiled processor and propagates process/pipe failures.
- `processFootywireData.ts` validates numeric fields, normalizes team/player identifiers, adds checksums,
  and writes match/player-stat documents.
- `liveGuard.ts` runs the shared pipeline only while Firestore reports a live match window.
- `backfill.ts` uses the same shared pipeline for bounded historical seasons/rounds and fails the command
  if any requested round fails.
- `validateMatchData.ts` checks match and player-stat invariants.

## Requirements

- Node.js and npm (the package currently declares Node 18+, while the root repository standard is Node 22)
- R with `fitzRoy`, `jsonlite`, `janitor`, `dplyr`, and `stringr`
- an authorized Firebase project and server-only service-account credential for remote writes

Install the package:

```sh
cd etl
npm ci
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
# Compile TypeScript
npm run build

# Verify that the R fetcher can run for a bounded round (external read)
npm run test-r

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
protected player ownership silently.

A player-match document contains season, round, clubs, normalized player identity, supported numeric
stats, source checksum, source label, and update time. Category keys must stay aligned with
`src/types/fantasyCategories.ts`, including the real-data nine-category preset.

## Failure policy

- Missing R or required packages blocks the pipeline.
- Fetch, stream, parse, validation, and Firestore write failures produce a failed exit.
- Live cycles may retry after their configured delay, but a failed cycle is never reported as success.
- Backfill reports every failed season/round and exits non-zero.
- There is no alternate Python scraper, browser scraper, or mock production source.

## Deployment

`Dockerfile` builds the ETL runtime. `deploy.sh` is the existing explicit Cloud Run deployment command;
it builds, verifies R packages, deploys a no-traffic revision, and requires a separately authorized
traffic switch. It is not called by the repository's GitHub Actions and must not be treated as an
automatic deployment.

Do not use `Dockerfile.backup`, `Dockerfile.new`, or one-off upload/debug scripts as production source
of truth. Removal of those non-document artifacts should happen in a separately reviewed ETL cleanup.

## Verification

For ETL code or documentation changes, run:

```sh
cd etl
npm ci
npm run build
cd ..
npm run test:unit -- tests/unit/etlSourceOfTruth.test.ts
npm run docs:check
```

External fetch/Firestore verification requires explicit target and credential authorization. Report it
as skipped when those prerequisites are unavailable; do not replace it with fabricated evidence.
