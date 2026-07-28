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
npm run build
```

`npm run test:all` runs lint, typecheck, unit, integration, and browser tests. CI exposes these
boundaries as stable merge checks so a failure identifies its owning verification stage.

## CI architecture

The CI workflow has three explicit ownership boundaries:

- root jobs own documentation, root lint, root typecheck, unit/integration/browser tests, and the
  production build;
- `Functions` owns its independent install, flat-ESLint config, typecheck, compiled smoke test, and
  build; and
- `ETL` owns its independent install, Node/R static validation, typecheck, deterministic compiled
  tests, and build.

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
tests do not invoke R or write to Firestore; the external pipeline commands retain their separate
authorization and environment requirements.

ETL `npm run lint` composes `lint:node` with `lint:r`. The R check parses `fetch_fw_round.R` without
loading fitzRoy or contacting FootyWire. CI pins R 4.3 to match the ETL container's build stage; local
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

## Test layers

- Unit tests cover pure domain rules, normalization, read-model projection, and component behavior.
- Integration tests cover Prisma/service boundaries with an isolated database and Redis where needed.
- Playwright tests cover direct load, navigation, hydration, responsive layout, authentication fixtures,
  and end-to-end interactions.
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
