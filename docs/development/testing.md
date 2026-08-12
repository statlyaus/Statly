# Testing and verification

## Supported checks

Run the narrowest check while editing, then the complete relevant set before publishing:

```sh
npm run docs:check
npm run format:check
npm run lint:ci
npm run typecheck
npm run test:unit
npm run test:int
npm run test:e2e
npm run test:e2e:draft-worker
npm run build
```

For the sourced AFL transaction/draft boundary, run the focused, offline contract set while editing:

```sh
npm run test:unit -- \
  tests/unit/afl-trade-intelligence-approved-external-sources.test.ts \
  tests/unit/afl-trade-intelligence-external-provider-ingestion.test.ts \
  tests/unit/afl-trade-intelligence-external-ingestion.test.ts \
  tests/unit/afl-trade-intelligence-external-discovery-contracts.test.ts \
  tests/unit/afl-trade-intelligence-postgres-external-discovery.test.ts \
  tests/unit/afl-trade-intelligence-external-historical-discovery-command.test.ts \
  tests/unit/afl-trade-intelligence-external-historical-plan-runner.test.ts \
  tests/unit/afl-trade-intelligence-external-historical-completion-contracts.test.ts \
  tests/unit/afl-trade-intelligence-postgres-external-historical-completion.test.ts \
  tests/unit/afl-trade-intelligence-external-historical-completion-command.test.ts \
  tests/unit/afl-trade-intelligence-external-reconciliation-source-authority.test.ts \
  tests/unit/afl-trade-intelligence-external-historical-reconciliation-preparation.test.ts \
  tests/unit/afl-trade-intelligence-postgres-external-historical-reconciliation-source.test.ts \
  tests/unit/afl-trade-intelligence-external-identity-review-contracts.test.ts \
  tests/unit/afl-trade-intelligence-external-identity-review-work-builder.test.ts \
  tests/unit/afl-trade-intelligence-external-identity-review-service.test.ts \
  tests/unit/afl-trade-intelligence-postgres-external-identity-review.test.ts \
  tests/unit/afl-trade-intelligence-external-identity-review-command.test.ts \
  tests/unit/afl-trade-intelligence-external-canonical-promotion-review-contracts.test.ts \
  tests/unit/afl-trade-intelligence-external-canonical-promotion-review-service.test.ts \
  tests/unit/afl-trade-intelligence-postgres-external-canonical-promotion-review.test.ts \
  tests/unit/afl-trade-intelligence-external-canonical-promotion-review-command.test.ts \
  tests/unit/afl-trade-intelligence-prepare-external-historical-reconciliation-command.test.ts \
  tests/unit/afl-trade-intelligence-external-evidence-reconciliation.test.ts \
  tests/unit/afl-trade-intelligence-external-reconciliation-command.test.ts \
  tests/unit/afl-trade-intelligence-postgres-external-reconciliation.test.ts
```

These tests make no network request and grant no source authority. The disposable PostgreSQL outcomes
job remains mandatory for migration triggers, append-only custody/reconciliation behavior and
concurrency. Its external-discovery lifecycle also exercises exact plan completion, `304` prior-batch
reuse, governed identity review, current-head resolution loading and post-finalization child rejection.
Production source commands additionally require reviewed
JSON, durable Gate records, Redis admission and isolated KMS-backed object custody.

`npm run test:all` runs lint, typecheck, unit, integration, and browser tests. Its integration stage
includes the persisted 12-team, 22-player-roster, 264-pick draft convergence contract. CI exposes
these boundaries as stable merge checks so a failure identifies its owning verification stage. The
standard browser command excludes tests tagged `@draft-worker`; CI runs those separately with the real
draft worker enabled.

## Local full stack

`npm run dev:full:all` starts the normal local web, Socket.IO, draft-worker and Firebase emulator
boundaries plus a persistent loopback-only PGlite service for the isolated AFL outcomes schema. The
launcher refuses an already-occupied outcomes port and authenticates its newly spawned database through
a per-launch nonce stored inside a local-only identity schema before it deploys migrations or seed data.
It then deploys all outcomes migrations and exact-replays a deterministic `test_fixture` factual release
before Next starts. Local outcomes bytes live under ignored `.statly-local/`; they are never a production
database or source authority.

The local AFL fixture is source-shaped rather than workbook-backed. It contains one 2025 GWS–Western
Bulldogs pick exchange, including nominal Pick 14 resolving through a typed draft selection to Harry
Kyle and one unresolved 2026 future pick. It intentionally creates no valuation publication, so the
archive is visible while numerical values and grades remain honestly unavailable. Run the database or
seed independently with `npm run dev:outcomes-db` and `npm run dev:outcomes:seed`; the standalone
database command generates its own local identity nonce, while the full-stack launcher supplies the
nonce it subsequently authenticates before writes.

PGlite's PostgreSQL socket compatibility layer is for local development only and is serialized through
a one-connection `test_fixture` read pool. Migration triggers and concurrent repository behavior remain
owned by the disposable real-PostgreSQL outcomes integration job described below.

## CI architecture

The CI workflow has five explicit ownership boundaries:

- root jobs own documentation, root lint, root typecheck, unit/integration/browser tests, and the
  production build;
- `Draft worker E2E` owns the isolated Chromium, Socket.IO, and BullMQ lifecycle against its own Redis
  service and disposable SQLite database;
- `Functions` owns its independent install, flat-ESLint config, typecheck, compiled smoke test, and
  build; and
- `ETL` owns its independent install, Node/R static validation, typecheck, deterministic compiled
  tests, build, and the offline fitzRoy RDS-decoder contract inside the pinned capture image; and
- `AFL outcomes PostgreSQL` owns the isolated analytical Prisma schema, migrations, triggers, and
  repository behavior against a disposable PostgreSQL service.

`CI Gate` depends on every root and nested validation job. It runs even when an upstream job fails or
is cancelled, and succeeds only when every dependency reports `success`. Repository protection should
require this stable aggregate check (plus separately governed security checks) so adding a validation
job to the gate does not require renaming the protected check. Individual jobs remain visible for
diagnosis and keep stable names, but the gate is the merge decision.

The jobs remain explicit rather than using a workspace matrix: Functions and ETL have different
runtime/setup requirements, so a shared abstraction would hide behavior without removing meaningful
duplication. Every third-party action is pinned to a full commit SHA and workflow permissions default
to read-only; the gate requests no permissions.

The independently deployable Functions and ETL packages have their own lockfiles and verification
boundaries. Run their complete local gates under Node.js 22:

```sh
npm --prefix functions ci
npm --prefix functions run lint
npm --prefix functions run typecheck
npm --prefix functions test
npm --prefix functions run build

npm --prefix etl ci
npm --prefix etl run lint
npm --prefix etl run typecheck
npm --prefix etl test
npm --prefix etl run build
```

Root `npm run lint:ci` intentionally excludes `functions/**` and `etl/**`; the stable `Functions` and
`ETL` CI jobs own those package-local lint boundaries. In CI, each nested package builds once and then
runs `test:compiled` against that output. The public `npm test` command remains self-contained by
building before it runs the same compiled tests.

The nested tests load compiled artifacts but remain credential-free and network-free. ETL's nested
Node tests do not invoke R or write to Firestore. CI separately builds the pinned
`etl/afl-trade-intelligence` image and runs `test_decode_contract.R` against its locked R, fitzRoy,
`jsonlite`, and `digest` versions. That test creates only local fixture RDS bytes and makes no provider
request; external capture commands retain their separate authorization and environment requirements.

ETL `npm run lint` composes `lint:node` with `lint:r`. The R check parses `fetch_fw_round.R` without
loading fitzRoy or contacting FootyWire. CI pins R 4.5.1 to match the ETL container's build stage; local
verification requires an available `Rscript` and may use a newer compatible R release.

## Database isolation

`prisma/dev.db` is protected developer state. Automated checks, smoke tests, migrations, data runners,
and reproduction steps must not read from or write to it.

Integration tests use `DATABASE_URL_TEST` and then assign that value to `DATABASE_URL` inside their
test setup. For an ad hoc Prisma verification, create a disposable path outside the repository:

```sh
STATLY_VERIFY_DIR="$(mktemp -d /tmp/statly-verify.XXXXXX)"
STATLY_VERIFY_DB="$(mktemp "${STATLY_VERIFY_DIR}/verify.XXXXXX.db")"
export STATLY_VERIFY_DIR
export STATLY_VERIFY_DB
export DATABASE_URL="file:${STATLY_VERIFY_DB}"
npm run prisma:generate
npx prisma migrate deploy
```

Before and after a data-oriented command, verify that the protected database is unchanged:

```sh
git status --short -- prisma/dev.db
```

Delete the disposable database after verification only when the explicit path is known and it contains
no required evidence. Never use a recursive delete, repository glob, or unresolved environment variable
for cleanup.

The public AFL outcomes authority uses its own PostgreSQL schema and migration history. Its supported
local integration command requires a running Docker daemon and provisions PostgreSQL 16 itself:

```sh
npm run test:outcomes:int
```

The harness invokes Docker directly so Compose cannot load repository environment files. It creates a
uniquely named `postgres:16-alpine` container with test-only credentials, binds Docker's dynamic port
to `127.0.0.1`, stores `PGDATA` on `tmpfs`, and replaces both outcomes database URLs only for its child
checks. It validates and generates the isolated Prisma schema, then runs the PostgreSQL suite. The
suite creates unique temporary schemas, applies the complete ordered migration history, exercises
native triggers, rollback, and concurrency behavior, and removes those schemas afterward. The harness
attempts bounded force-removal by immutable container ID after success, failure, `SIGINT`, or `SIGTERM`,
and reports cleanup failure alongside any check failure.

CI already owns a disposable PostgreSQL service and therefore runs
`npm run test:outcomes:int:provisioned` with explicit test URLs. That command is not the supported local
entry point. Never point either `AFL_OUTCOMES_TEST_DATABASE_URL` or `AFL_OUTCOMES_DATABASE_URL` at a
shared or production PostgreSQL database.

## Test layers

- Unit tests cover pure domain rules, normalization, read-model projection, and component behavior.
- Integration tests cover Prisma/service boundaries with an isolated database and Redis where needed.
  Full-scale draft persistence belongs here: the 12-team by 22-player, 264-pick contract exercises the
  real `DraftApplicationService` and Prisma boundary without browser, dev-server, Redis, or retry noise.
- Playwright tests cover direct load, navigation, hydration, responsive layout, authentication fixtures,
  and representative end-to-end interactions. Draft coverage uses a four-pick lifecycle for manual,
  queued, fallback, completion, history, roster, and fresh-load behavior, plus a separately tagged real
  worker clock lifecycle.
- Focused architecture tests assert durable source-of-truth and safety rules that are cheaper and more
  reliable than prose review.

`npm run test:race` is reserved for a future focused concurrency suite. It currently fails when
`tests/race` has no test files, so it must not be advertised as coverage or added to aggregate CI until
real race specifications exist.

## Browser fixtures

Playwright starts an isolated application server and defaults to the repository's deterministic E2E
identifiers. Do not point it at a shared or production environment. Keep screenshots, traces, videos,
and reports in ignored output directories. The suite exercises the full flow in Chromium and a
deliberately smaller smoke contract in Firefox and WebKit, so CI installs all three browsers; this is
intentional cross-browser coverage rather than an unused browser download.

`npm run test:e2e` keeps Socket.IO enabled, leaves the draft worker disabled, and excludes
`@draft-worker` tests. The representative browser lifecycle intentionally stops at four picks: one
manual pick, one queued auto-pick, one fallback auto-pick, and completion. The full 12-team by
22-player, 264-pick contract runs through the persisted application boundary in integration tests so
browser, dev-server, and SQLite transport pressure cannot masquerade as a product failure.

Use `npm run test:e2e:draft-worker` for the real expiry-worker lifecycle; it requires an isolated Redis
instance and a migrated disposable database. Never combine worker expiry with another progression
authority against the same database or Redis namespace.

For responsive changes, verify at least a phone viewport (390px) and the affected desktop layout.
Realtime and routing changes also need direct-load/refresh evidence, not only client navigation.

## Test data factories

`src/testUtils/playerDataFactory.ts` supplies typed player fixtures:

- `createExamplePlayer(overrides)` for a complete player;
- `createExamplePlayers(count, overrides)` for lists;
- `createMinimalPlayer(overrides)` for edge cases; and
- `PLAYER_VARIATIONS` for injured, suspended, rookie, premium, and bye states.

Prefer these factories over copied production-shaped objects. Override only the fields that matter to
the test so schema changes remain visible through TypeScript.

## Failure handling

When a broad check fails, determine whether the branch introduced it with a focused reproduction and,
where practical, a clean `origin/main` baseline. Do not conceal a pre-existing failure or expand a
documentation/delivery change into unrelated runtime repair. Record the command, failure, evidence, and
residual risk in the pull request.
