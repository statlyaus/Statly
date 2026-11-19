# Development setup

## Requirements

- Node.js 22 and npm
- Git
- Firebase CLI for emulator-backed authentication/Firestore work
- Redis for live Socket.IO and worker flows
- R for work inside `etl`

## Install

```sh
npm ci
if [ ! -e .env ]; then cp .env.example .env; fi
npm run prisma:generate
```

Use the ignored `.env` file for the canonical local stack because both Next.js and the Prisma CLI
load it. A Next.js-only override may live in `.env.local`, but values needed by Prisma commands must
also be exported or present in `.env`. Only `.env.example` and clearly named credential-free examples
may be tracked.

To intentionally regenerate the local file, back up any required values first, then copy
`.env.example` to `.env` explicitly.

## Environment boundaries

The example file groups variables by purpose. Common local flows use:

- `DATABASE_URL`: the PostgreSQL 16 development database. `DIRECT_DATABASE_URL` is the same server
  without a connection pooler and is what Prisma migrations use; locally both can be identical.
- `DATABASE_URL_TEST`: a separate disposable PostgreSQL database for integration tests. Never point
  it at the development database.

The example file points both at a PostgreSQL 16 server on `127.0.0.1:5432`, the port Homebrew's
`postgresql@16` listens on. There is no shared development server: each machine runs its own.

```sh
brew install postgresql@16
brew services start postgresql@16
psql -d postgres -c "CREATE ROLE statly LOGIN PASSWORD 'change-me' CREATEDB"
createdb -O statly statly_fantasy_dev
createdb -O statly statly_fantasy_test
npx prisma migrate deploy
```

Apply migrations with `npx prisma migrate deploy`. The history starts at the
`20261004000000_postgresql_baseline` migration; the earlier SQLite history is archived in
`prisma/migrations-sqlite-archive/` for reference only and must never be replayed.

- `NEXT_PUBLIC_FIREBASE_*`: public Firebase Web SDK configuration.
- `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64`: server-only encoded service-account JSON for admin/ETL
  operations that genuinely require a remote project.
- `NEXT_PUBLIC_USE_EMULATORS`: explicit client emulator opt-in.
- `FIRESTORE_EMULATOR_HOST` and `FIREBASE_AUTH_EMULATOR_HOST`: server emulator endpoints.
- `REDIS_URL` or the documented Redis host/port fields: realtime and worker coordination, and the
  shared rate-limit counters.
- `RATE_LIMIT_TRUSTED_PROXY_COUNT` (default `1`): how many proxies in front of the web app append to
  `x-forwarded-for`; rate limits key anonymous callers by the hop that many entries from the right.
  On Netlify (`NETLIFY=true`) `x-nf-client-connection-ip` takes precedence. See
  [rate limits](../architecture/data-platform.md#rate-limits).
- `NEXT_PUBLIC_GIPHY_WEB_SDK_KEY`: optional browser-only GIPHY key for league chat GIFs; the GIF
  button is hidden while it is unset.
- `INTERNAL_TASK_SECRET` and cron/metrics credentials: server-only; use deployment secret storage.

Variables prefixed `NEXT_PUBLIC_` are included in browser bundles. Never put a private key, service
account, internal secret, or server token in one.

Do not commit `.env`, `.env.local`, `.env.production`, `.Renviron`, credential JSON, encoded secrets,
or local databases. If a real credential may have entered Git, stop using it and coordinate rotation;
removing the current file does not remove it from history.

## Firebase authentication

The browser signs in through the Firebase Web SDK. Statly's generated auth service worker attaches a
current Firebase ID token to eligible same-origin app requests. Server boundaries verify the token and
then authorize membership/role against canonical domain state. If the worker cannot start (an
insecure origin, an unsupported or private browser), sign-in signs the Firebase user back out and says
so, rather than leaving a Firebase session the app ignores.

The legacy `statly_session` cookie remains a compatibility fallback where implemented. New code must
not treat middleware routing checks or cookie presence as domain authorization.

Build the generated auth worker directly when needed:

```sh
npm run auth-worker:build
```

Production builds fail when required public Firebase configuration is missing. The generated worker is
build output and is not tracked.

## Local Firebase stack

Start emulators only:

```sh
npm run dev:firebase
```

Start the complete isolated stack, seed it, and run its smoke checks:

```sh
npm run dev:full:local
npm run dev:smoke:local
```

The seed/smoke commands use the `statly-4cbed` emulator project name by default but connect to local
emulator hosts. They must not receive production credentials.

Development authentication requires both client and server opt-in and a non-production environment.
Use it only with local fixtures. Production code must fail closed when those conditions are absent.

The full local harness enables development tools:

```sh
STATLY_ENABLE_DEV_TOOLS=true
```

Its shared Firebase Auth fixture identity is `admin@statly.dev`. Use the local password printed by
`npm run dev:full:local`; it is derived from the local-only `STATLY_LOCAL_AUTH_PHRASE` boundary and is
not a production credential.

The legacy development-auth fallback is not enabled by that harness. It remains available only when
`NEXT_PUBLIC_STATLY_ENABLE_DEV_AUTH=true` and `STATLY_ENABLE_DEV_AUTH=true` are both set explicitly and
`NODE_ENV` is not `production`.

Bloodsucker leagues are built (epic #1275) and switched off: the format is offered and accepted only
when `NEXT_PUBLIC_STATLY_ENABLE_BLOODSUCKER=true`. Set it locally to try the format; see
[League formats](../product/league-competition-rules.md#league-formats).

### Switching Bloodsucker on in production

This is an owner step. Do it in this order:

1. In Netlify, confirm `CRON_SECRET` is set. The 5-minute Bloodsucker sweep
   (`netlify/functions/cron-bloodsucker.mts` → `/api/cron/bloodsucker`) closes exclusive windows
   and runs bites at their deadline, and the route refuses every call without the secret.
2. In Netlify, confirm `SENTRY_DSN` is set. Without it the sweep's failures and missed runs alert
   nobody.
3. Set `NEXT_PUBLIC_STATLY_ENABLE_BLOODSUCKER=true` in Netlify.
4. Redeploy. A `NEXT_PUBLIC_` value is inlined into the bundle at build time, so changing the
   variable does nothing until a new build is deployed.
5. Within 10 minutes, confirm Sentry Crons shows a `cron-bloodsucker` monitor with successful
   check-ins. The first run creates the monitor; no monitor means the sweep is not running, so
   switch the flag back off until it is. See
   [Bloodsucker sweep](../runbooks/monitoring-and-alerts.md#bloodsucker-sweep).

**Rollback.** Remove the variable (or set it to anything but `true`) and redeploy. That only stops
new leagues choosing the format: leagues already set to Bloodsucker keep it, and the sweep keeps
running their windows and bites. It does not undo any bite.

## Ordinary development

```sh
npm run dev
```

The default development bundler is Turbopack. Use the Webpack path only to isolate a bundler-specific
regression, and enable Turbopack tracing when a route still compiles unexpectedly slowly:

```sh
npm run dev:webpack
npm run dev:trace
```

Ordinary development records Web Vitals in the console and browser storage without posting them to
the analytics endpoint, avoiding an unrelated API compilation while profiling routes. `dev:trace`
explicitly enables those development beacons so the complete telemetry path can be inspected.

Stop the running server before switching bundlers. If a comparison has mixed both bundlers in the
same `.next` directory, run `npm run clean` once before the next cold-start measurement; routine
development should reuse the Turbopack cache.

For a controlled investigation, collect at least three cold traces with the same services, fixture,
machine load, and representative routes. Vary the route order between runs so shared compilation does
not consistently benefit one route. Stop the server before copying each generated trace:

```sh
npm run clean
npm run dev:trace
cp .next/dev/trace /tmp/statly-route-trace-1
npm run perf:dev:report -- /tmp/statly-route-trace-1
```

Pass multiple trace paths to aggregate their median, p95, maximum, and run counts. Add `--json` for a
machine-readable report and `--all` to include internal compilation such as instrumentation and the
proxy. Compare `compile-path` values rather than total request time; database, proxy, and application
work are separate performance boundaries. Record a warm navigation control after every cold route
sequence.

Inspect the production client graph separately. This writes Turbopack analysis artifacts without
starting the analyzer server and requires the same public build configuration as a production build:

```sh
npm run perf:bundle
```

Additional process commands:

```sh
npm run socket
npm run draft-worker:dev
npm run dev:up
npm run dev:down
```

Redis-disabled/test modes are for repository-supported builds and tests. Do not use them to mask a
missing required production dependency.

## Serving a worktree

`dev:serve` runs the web app from the current checkout or worktree on the first free port from 3100,
so several worktrees can each serve their own branch alongside the usual `localhost:3000`:

```sh
eval "$(npm run -s db:scratch -- up mybranch)"   # optional: a throwaway database
npm run dev:serve -- start
npm run dev:serve -- stop
```

`start` uses `npm run dev:webpack`, because worktrees share the main checkout's `node_modules`
through a symlink and Turbopack rejects it. It waits up to 90 seconds (`SERVE_WORKTREE_TIMEOUT`
changes that) for the server to answer, then prints the URL. Running `start` again prints the URL of
the server that is already up. `stop` ends only the server this checkout started: its PID and port
are in `tmp/serve-worktree.pid` and its output in `tmp/serve-worktree.log`. Without an exported
`DATABASE_URL` the server uses the checkout's `.env`, and a worktree usually has none. `next dev`
rewrites `AGENTS.md` and `next-env.d.ts` on start; `start` restores them when it finishes waiting,
unless they already had changes.

The server starts with development sign-in switched on. When no Firebase client configuration is
present (the usual worktree case), sign in as `admin@statly.dev` with the default phrase that
`resolveLocalDevelopmentAuthPhrase()` in `src/lib/devAuth.ts` builds. The browser checks it, so
`STATLY_LOCAL_AUTH_PHRASE` does not change it there: that variable is not `NEXT_PUBLIC_` and never
reaches client code. It is a local-only fixture credential, never a production one.

## Firebase Admin credentials

Prefer workload identity or the deployment platform's secret manager. For an authorized local admin
or ETL operation, encode the complete service-account JSON outside the repository and place the value
in ignored local environment. The server validates structure and project identity before use.

Never commit the JSON file, encoded value, shell history containing the value, or a copied environment
file. Example JSON contains placeholders only and is not a usable credential.

When rotating a credential, create the replacement, update authorized environments, verify dependent
flows, disable the old key, and monitor failures. Suspected compromise also requires history and access
review; it is not solved by a documentation change.

## Next steps

- [Testing and disposable data](testing.md)
- [AFL ETL setup](../../etl/README.md)
- [Runtime and data ownership](../architecture/data-platform.md)
