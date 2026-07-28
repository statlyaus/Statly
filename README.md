# Statly

Statly is an AFL fantasy platform for category head-to-head leagues. Managers draft AFL players,
set positional lineups, compare selected statistical categories each round, and manage rosters through
trades and waivers.

Leagues support two category scoring modes:

- `H2H_EACH_CATEGORY`: every won, lost, or drawn category contributes to the standings.
- `H2H_MOST_CATEGORIES`: the team winning more categories receives the matchup result.

The default real-data preset is goals, tackles, inside 50s, intercepts, contested marks, rebound 50s,
contested possessions, effective disposals, and score involvements. Commissioners can choose other
supported categories and whether higher or lower values win.

## Architecture

Statly is a Next.js 15 and React 19 application written in TypeScript.

- Prisma with SQLite currently owns protected relational state. Managed PostgreSQL is the accepted
  production target, but that cutover is not complete.
- Firebase Authentication owns user identity; server services enforce league and season access.
- Firestore receives live-stat ingestion and temporary compatibility projections. It is not the
  canonical store for protected league state.
- Redis supports queues, short-lived coordination, and Socket.IO fan-out.
- Socket.IO provides bidirectional draft and social delivery; BullMQ runs scheduled work.
- The `etl` package fetches Footywire data through fitzRoy, normalizes it, and writes live-stat
  evidence to Firestore.

See [runtime and data ownership](docs/architecture/data-platform.md) for the complete boundary map.

## Prerequisites

- Node.js 22 and npm
- A local SQLite-compatible environment for ordinary development and tests
- A Firebase project or the Firebase emulators for authenticated/live-data flows
- Redis for realtime and worker flows that are not run with the repository's disabled/test mode
- R plus the packages documented in [the ETL guide](etl/README.md) for ingestion work

## Install

```sh
git clone https://github.com/statlyaus/Statly.git
cd Statly
npm ci
if [ ! -e .env ]; then cp .env.example .env; fi
npm run prisma:generate
```

Fill only the values needed for the flow you are running. Never commit `.env.local`, service-account
JSON, encoded credentials, or local databases. The example file contains placeholders and documents
which values are optional.

For Firebase emulator setup, credential boundaries, and environment details, see
[local setup](docs/development/setup.md).

## Local development

Start the Next.js application:

```sh
npm run dev
```

Start web, Socket.IO, draft worker, Firebase emulators, deterministic seed data, and smoke checks:

```sh
npm run dev:full:local
```

The full local stack is intentionally isolated. Development authentication must be explicitly enabled
and must never be enabled in production.

## Verification

| Purpose                  | Command                |
| ------------------------ | ---------------------- |
| Documentation/repo rules | `npm run docs:check`   |
| Formatting               | `npm run format:check` |
| Lint                     | `npm run lint:ci`      |
| TypeScript               | `npm run typecheck`    |
| Unit tests               | `npm run test:unit`    |
| Integration tests        | `npm run test:int`     |
| Browser tests            | `npm run test:e2e`     |
| Production build         | `npm run build`        |

Integration and browser verification must use the configured test database or another disposable
database. Do not point tests at `prisma/dev.db`.

## Data and ETL

The ingestion path is:

```text
Footywire → fitzRoy/R → NDJSON → TypeScript normalization → Firestore live-stat evidence
```

The pipeline fails closed when its source, parser, or write boundary fails; there is no mock-data
fallback. Protected league, draft, roster, trade, and waiver state remains owned by Prisma.

Read [the ETL guide](etl/README.md) before running ingestion commands. Player identity consolidation
is a separate reviewed data operation described in the
[player identity runbook](docs/runbooks/player-identity.md).

## Documentation

The [documentation index](docs/README.md) is the entry point for current architecture, domain rules,
development setup, product standards, and operational runbooks. Historical implementation reports and
completed plans belong in Git and merged pull-request history, not in the live documentation tree.

## Pull requests and delivery

Create feature branches from fetched `origin/main`, keep unrelated local state out of the diff, and use
a pull request for every change to `main`. Required documentation, lint, typecheck, test, build, and
security gates must pass before GitHub's native squash auto-merge completes the pull request.

The merged pull request is the durable archive: it records rationale, review, checks, discussion, and
the source diff. GitHub deletes the temporary remote branch after merge; tags are reserved for releases
or explicit recovery milestones. See [delivery and archival policy](docs/development/delivery.md).

## Deployment status

The repository contains a Netlify build configuration (`npm run build:production`) and Vercel cron
configuration, but GitHub Actions does not perform a production deployment. A successful `main` build
therefore proves the application build, not a deployment. Any deployment supplied by an external
GitHub integration must be verified independently from its commit status and a non-destructive smoke
check; do not infer production health from the build job alone.
