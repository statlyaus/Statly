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
npm run test:race
npm run test:e2e
npm run build
```

`npm run test:all` runs lint, typecheck, unit, integration, race, and browser tests. CI exposes these
boundaries as stable merge checks so a failure identifies its owning verification stage.

## Database isolation

`prisma/dev.db` is protected developer state. Automated checks, smoke tests, migrations, data runners,
and reproduction steps must not read from or write to it.

Integration tests use `DATABASE_URL_TEST` and then assign that value to `DATABASE_URL` inside their
test setup. For an ad hoc Prisma verification, create a disposable path outside the repository:

```sh
STATLY_VERIFY_DB="$(mktemp -u /tmp/statly-verify.XXXXXX.db)"
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
- Race tests exercise concurrency-sensitive draft, roster, queue, and waiver paths.
- Playwright tests cover direct load, navigation, hydration, responsive layout, authentication fixtures,
  and end-to-end interactions.
- Focused architecture tests assert durable source-of-truth and safety rules that are cheaper and more
  reliable than prose review.

## Browser fixtures

Playwright starts an isolated application server and defaults to the repository's deterministic E2E
identifiers. Do not point it at a shared or production environment. Keep screenshots, traces, videos,
and reports in ignored output directories.

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
