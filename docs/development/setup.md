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

- `DATABASE_URL`: use a disposable or explicitly chosen SQLite file URL. Tests override this with
  their test database; do not use `prisma/dev.db` for verification.
- `NEXT_PUBLIC_FIREBASE_*`: public Firebase Web SDK configuration.
- `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64`: server-only encoded service-account JSON for admin/ETL
  operations that genuinely require a remote project.
- `NEXT_PUBLIC_USE_EMULATORS`: explicit client emulator opt-in.
- `FIRESTORE_EMULATOR_HOST` and `FIREBASE_AUTH_EMULATOR_HOST`: server emulator endpoints.
- `REDIS_URL` or the documented Redis host/port fields: realtime and worker coordination.
- `INTERNAL_TASK_SECRET` and cron/metrics credentials: server-only; use deployment secret storage.

Variables prefixed `NEXT_PUBLIC_` are included in browser bundles. Never put a private key, service
account, internal secret, or server token in one.

Do not commit `.env`, `.env.local`, `.env.production`, `.Renviron`, credential JSON, encoded secrets,
or local databases. If a real credential may have entered Git, stop using it and coordinate rotation;
removing the current file does not remove it from history.

## Firebase authentication

The browser signs in through the Firebase Web SDK. Statly's generated auth service worker attaches a
current Firebase ID token to eligible same-origin app requests. Server boundaries verify the token and
then authorize membership/role against canonical domain state.

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

## Ordinary development

```sh
npm run dev
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
