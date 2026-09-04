# Testing and verification

## Supported checks

Run the narrowest check while editing, then the complete relevant set before publishing:

```sh
npm run docs:check
npm run format:check
npm run lint:ci
npm run typecheck
npm run typecheck:tests
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

For the current valuation evidence coordinator, run the focused unit and disposable PostgreSQL
boundaries while editing:

```sh
npx vitest run --config vitest.config.unit.ts --coverage.enabled=false \
  tests/unit/afl-trade-intelligence-current-valuation-evidence-orchestration.test.ts \
  tests/unit/afl-trade-intelligence-local-egress-signing-authority.test.ts \
  tests/unit/afl-trade-intelligence-private-valuation-worker.test.ts

AFL_OUTCOMES_TEST_DATABASE_URL='<owned-disposable-loopback-postgresql>' \
  npx vitest run --config vitest.config.outcomes-int.ts \
  tests/outcomes-integration/afl-current-valuation-evidence-orchestration-postgres.test.ts
```

The PostgreSQL proof applies the complete migration history and runs all seven exact source lanes
through the real Gate resolver, cryptographically signed capture receipt, artifact custody, source
snapshot, contract-faithful offline fixture decoder, normalizer, stage-receipt, and
reconciliation-fence boundaries. Only the external fitzRoy/network execution and decoded provider
rows are bounded no-network fixtures. The scenario first retains the missing-reconciliation stop,
then supplies explicit fixture-owned human review markers, retains the reviewed-authority stop, and
uses a bounded reviewed-bundle assembler. With production SQL guards still enabled, it first proves
that this incomplete fixture is rejected and leaves no reviewed bundle, decision, or head. It then
expands a disposable corpus containing 48,769 historical candidates and 12 official candidates with
all 146,343 current decisions. The fixture temporarily suppresses immutable-ledger triggers only
while expanding already-finalized normalization runs; normal trigger behavior is restored before
reviewed-evidence evaluation. The scenario proves the real
`outcome_private_reviewed_evidence_is_current()` result and exercises the real `recordDecision`
transaction, head persistence, and private factual-refresh authority through the unchanged production
exact-set admission guard. It also proves new operation keys reuse the seven effective
normalizations, the captured lineage reaches the private factual head without duplicate normalization
runs, and the public active release and registry remain unchanged. Production construction does not
inject the fixture assembler; it uses the complete exact reviewed-provider evidence loader and the
same unchanged SQL guards.

The three distinct operation keys each retain seven fresh observed captures. Because the fixture raw
bytes and governing authority are unchanged, all three operations converge on seven effective
normalization claims and create only seven finalized normalization runs. The test also covers restart
after observed-capture custody and verifies that a later receipt may intentionally bind a new observed
capture to a historical effective capture and normalization.

`npm run test:all` runs lint, application and test typechecks, unit, integration, and browser tests. Its integration stage
includes the persisted 12-team, 22-player-roster, 264-pick draft convergence contract. CI exposes
these boundaries as stable merge checks so a failure identifies its owning verification stage. The
standard browser command excludes tests tagged `@draft-worker`; CI runs those separately with the real
draft worker enabled.

## Local full stack

`npm run dev:full:all` starts the normal local web, Socket.IO, draft-worker and Firebase emulator
boundaries plus a persistent loopback-only PGlite service for the isolated AFL outcomes schema. The
launcher refuses an already-occupied outcomes port and authenticates its newly spawned database through
a per-launch nonce stored inside a local-only identity schema before it deploys migrations or seed data.
While it is running, the database process also writes that nonce to the mode-`0600`, ignored
`.statly-local/afl-trade-outcomes-runtime-nonce` handoff and removes the file on shutdown. A separately
invoked seed can therefore authenticate the same exact loopback process without printing the nonce.
It then deploys all outcomes migrations, exact-replays a deterministic `test_fixture` factual release,
and rehearses a separately governed synthetic valuation publication before Next starts. PostgreSQL and
content-addressed artifact bytes live under ignored `.statly-local/`; they are never a production
database, durable hosted custody, real AFL evidence, or source authority.

The `0045_fixture_filesystem_custody_assurance` migration deliberately stops describing local files as
provider-managed storage. A disposable outcomes store created before that migration contains immutable
legacy fixture receipts and must not be rewritten in place. Preserve or remove only the ignored
`.statly-local/afl-trade-outcomes-pgdata` and `.statly-local/afl-trade-artifacts` directories once, then
restart the stack to create honest fixture-filesystem evidence. Never apply this reset to a shared or
hosted database.

Migration `0081_corrected_local_review_lineage` has the same no-rewrite rule for the separately
reviewed local provider lane. A disposable database that already contains decisions under the
superseded historical evidence digest cannot migrate in place. Preserve that database and its private
artifact roots read-only. Retained artifact bytes cannot authenticate corrected pre-capture Gate
lineage and must not be relabeled as a new capture. In a new empty loopback
`statly_outcomes_test` database, deploy the complete migration history and use the current-evidence
coordinator to create the replacement governed capture and normalization chain. It stops at the
separately retained human reconciliation and reviewed-head authorities before continuing. The exact
hard stop, preservation,
seven-capture/three-rights preflight, and retirement conditions are
in [AFL trade intelligence operations](../runbooks/afl-trade-intelligence-operations.md#inspecting-the-governed-five-season-workbook-evaluation).
Never use this replacement procedure for shared or hosted state.

The local AFL fixture is generated code rather than workbook-backed. It contains 783 deterministic
archive trades across 1988–2025: one source-shaped 2025 GWS–Western Bulldogs pick exchange and 782
records whose titles, clubs, players and source references explicitly identify them as synthetic local
volume data. The source-shaped member includes nominal Pick 14 resolving through a typed draft
selection to Harry Kyle and one unresolved 2026 future pick. The valuation fixture fabricates baseline
and replacement values only for that governed rehearsal trade, activates both in sequence, rolls back,
withdraws to the original empty value scope, and leaves the recovered replacement active. Synthetic
archive-only trades must remain `not_calculated` even while that valuation publication is active. Every
fixture artifact remains `test_fixture`, `productionEligible: false`, and independent of Draftguru
model-training rights.

Both generated evidence batches are persisted under provider `statly_local_fixture` with
`fixture://statly/` source references. They never claim Draftguru, Footywire or official-AFL
provenance, and the live provider-ingestion boundary rejects `statly_local_fixture` entirely.

### Private workbook evaluation lane

Use the separate workbook evaluation launcher when product testing needs the historical transaction
volume in a privately held workbook. This lane is development-only, production-disabled and excluded
from every factual-release, public API, export and archive-reader boundary. It evaluates recorded
transactions and Statly's local model outputs; it never treats workbook `Expected`, `Actual` or grade
cells as source evidence or a publication value.

The route deliberately presents two independent lanes:

- the factual-evidence lane retains reconciled acquisition-spell observations and remains unavailable
  when reviewed evidence is missing, ambiguous or incomplete; and
- the synthetic-scenario lane sends each structurally valid workbook trade through the same lineage,
  joint-draw, realized-ledger, four-view, snapshot and explanation machinery used by the valuation
  kernel. Its component numbers are deterministic fabricated test evidence, not AFL observations,
  calibrated estimates or release facts.

Workbook rows identify the receiving club but not the sending club for each asset. A two-party
scenario explicitly assumes that the other party sent the asset. A multi-party scenario uses the
versioned deterministic fixture transfer map. Both assumptions are content-addressed and rendered in
the detail page. They must never be silently promoted into transaction facts.

Pin the exact private file for each run without adding its path or digest to repository configuration:

```sh
export AFL_OUTCOMES_DATABASE_URL="postgresql://<local-user>:<local-password>@127.0.0.1:<port>/statly_outcomes_test?sslmode=disable"
npm run dev:outcomes:authenticate
npm run dev:outcomes:review-afl-tables-2021-2025
npm run dev:outcomes:review-official-2026
export AFL_OUTCOMES_DEV_WORKBOOK_PATH="/absolute/private/path/to/workbook.xlsx"
export AFL_OUTCOMES_DEV_WORKBOOK_SHA256="<64-character-sha256>"
npm run dev:full:workbook-evaluation
```

The authentication command first requires the exact loopback database name and installs a private
runtime nonce. Capture staging and the launcher must re-authenticate that nonce before mutation or
reuse. Neither review command performs capture. The five-season command pins 48,769 reviewable
appearances from the exact 2021–2025 candidate set, records identity, match and player-match receipts
in bounded transactions, and exposes them only after one complete-set admission decision. It retains
32,883 ambiguous zero-like goals rows as quarantined. The official command atomically records 12
identity, 12 match and 12 player-match approvals for the exact pinned Sam Flanders match/date set.
The launcher then fails closed in production mode, verifies the workbook digest and structure, and
runs `Scripts/dev/verify-local-workbook-synthetic-valuations.ts`. That verifier requires every
projected workbook trade to produce finite received, given-up and net values across all four views;
it also rejects any scenario that is not publication-prohibited. A malformed trade or unsupported
asset stops launch instead of receiving a made-up zero. The launcher then selects only the local
`test_fixture` public-read adapter, enables the private reader for the child stack, and starts the same
disposable local services as `dev:full:all`. Sign in through the Firebase Auth emulator as
`admin@statly.dev` using the local password printed by the stack, then open
`http://localhost:3000/dev/afl-trade-evaluation` to filter the private archive and review each trade's
scenario-ready state and synthetic net for at-trade, realized, remaining and current views, then open
a detail to inspect each view's received, given-up and net values. Every page must label fabricated test
evidence, show production authority `none` and publication authority `none`, and retain the separate
asset-level factual evidence state. The route requires that verified emulator session before it reads
the workbook or disposable outcomes database; the credential-free development-auth fallback is not
accepted. Missing or rejected credentials return not found. No export or activation control exists in
this route.

To prove withdrawal, stop the launcher and explicitly override any local environment-file value:

```sh
AFL_OUTCOMES_DEV_WORKBOOK_READ_ENABLED=false \
DATABASE_URL="file:$PWD/.statly-local/statly-app.db" \
npm run dev:full:all
```

The `/dev/afl-trade-evaluation` route must return not found while the governed fixture archive, APIs,
projections and exports retain their prior local release identity. This removes only private evaluation
access; it does not activate, roll back or alter a factual release. Unsetting variables alone is not a
withdrawal proof because Next development environment files may supply a configured value.

After `npm run dev:full:all` reports that the web process is ready, open
`http://localhost:3000/draft/trades`. Verify the 38 year filters, the 783-trade archive, the 21 trades
in 2025, and the 20 trades in 1988. Then compare the governed 2025 trade detail page with:

- `GET /api/draft-trades/valuations?tradeId=<tradeId>&view=current&limit=1`;
- `GET /api/draft-trades/<tradeId>/valuation`;
- `GET /api/draft-trades/<tradeId>/export`; and
- `GET /api/draft-trades/export?year=2025`.

The valuation APIs and detail page must name one publication/projection pair; both CSV routes must
retain the same factual trade identity. Open an archive-only synthetic trade and confirm its factual
detail still renders while its valuation API and UI display `not_calculated` against that same active
publication. That fallback is permitted only after the trade is found in the active governed factual
archive; an unknown trade ID must remain `TRADE_NOT_IN_PROJECTION`. Run the seed again with
`npm run dev:outcomes:seed` to prove an idempotent replay. Run the
database or seed independently with `npm run dev:outcomes-db` and `npm run dev:outcomes:seed`; the
standalone database command generates its own local identity nonce, while the full-stack launcher
supplies the nonce it subsequently authenticates before writes. The seed always targets the fixed
loopback URL on port `55432`; it rejects an absent or mismatched nonce and does not accept a
caller-supplied database URL.

PGlite's PostgreSQL socket compatibility layer is for local development only and is serialized through
a one-connection `test_fixture` read pool. Migration triggers and concurrent repository behavior remain
owned by the disposable real-PostgreSQL outcomes integration job described below.

## CI architecture

The CI workflow has five explicit ownership boundaries:

- root jobs own documentation, root lint, application and test typechecks, unit/integration/browser tests, and the
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
native triggers, rollback, concurrency behavior, the 783-trade idempotent local seed and valuation
isolation for archive-only trades, and removes those schemas afterward. The harness attempts bounded
force-removal by immutable container ID after success, failure, `SIGINT`, or `SIGTERM`, and reports
cleanup failure alongside any check failure.

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
