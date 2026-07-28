# Firebase Setup

This project uses Firebase Authentication and Firestore. The Admin SDK is initialized from a base64-encoded service account stored in an environment variable.

## Requirements

- A Firebase project
- Service account JSON (Project Settings → Service accounts)
- Do NOT commit the JSON file to the repository

## Environment Variables

### Client SDK (.env.local)

Set these so the web SDK can initialize on the client:

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` (optional)

Note: We use relative URLs for internal API calls, so `NEXT_PUBLIC_API_BASE_URL` is not required.

### Server (Admin SDK) (.env or platform env)

- `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64`: base64 of the service account JSON
  - Alternatively use ADC via `GOOGLE_APPLICATION_CREDENTIALS` or local `gcloud auth application-default login`
- `INTERNAL_TASK_SECRET`: shared secret for internal jobs (e.g., reconcilePendingBidTotals)
- `LOG_LEVEL`: `debug` | `info` | `warn` | `error` (defaults to `debug` in dev, `info` in prod)
- `LEAGUE_REVALIDATE_SECONDS`: optional override for ISR revalidate seconds (defaults to `3600` with validation)
- `METRICS_BACKEND`: leave unset or `firestore` (default)
- `METRICS_ALLOWED_ORIGINS`: comma-separated list of allowed origins for analytics ingestion

The legacy development-auth fallback is disabled by default. To opt into it for an isolated local
process, set both `NEXT_PUBLIC_STATLY_ENABLE_DEV_AUTH=true` and
`STATLY_ENABLE_DEV_AUTH=true`. The public flag allows the browser to emit a development credential;
the server flag separately authorizes local servers to trust it. Neither flag enables the fallback
when `NODE_ENV=production`.

Development and debug routes are also disabled by default. The canonical local and Playwright
harnesses set `STATLY_ENABLE_DEV_TOOLS=true`; set it manually only for an isolated local server that
needs `/test-draft` or its supporting APIs. The flag has no effect when `NODE_ENV=production`.

Note: `FIRESTORE_EMULATOR_HOST` and `FIREBASE_AUTH_EMULATOR_HOST` are for local/dev servers only. Do not set them in production.

### Where to put them

Place these in a local env file so Next.js loads them automatically:

```bash
# .env.local (preferred for local dev, overrides .env)
# Client SDK
NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
NEXT_PUBLIC_FIREBASE_APP_ID=1:your-sender-id:web:your-app-id
# Optional
# NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=G-XXXXXXXXXX

# .env (CI/production) — server settings
FIREBASE_SERVICE_ACCOUNT_JSON_BASE64="<paste-your-base64-service-account-json-here>"
# Optional
# INTERNAL_TASK_SECRET=some-strong-random-string
# LOG_LEVEL=info
# LEAGUE_REVALIDATE_SECONDS=3600
# METRICS_BACKEND=firestore
# METRICS_ALLOWED_ORIGINS=https://yourapp.com
# METRICS_COLLECTION=analytics_web_vitals
```

Note: `.env*` files are already gitignored; use `.env.example` as a reference.

### Base64 commands (to generate the value to paste)

macOS (zsh):

```bash
export FIREBASE_SERVICE_ACCOUNT_JSON_BASE64="$(base64 -b 0 secrets/serviceAccountKey.json)"
```

Linux:

```bash
export FIREBASE_SERVICE_ACCOUNT_JSON_BASE64="$(base64 -w 0 secrets/serviceAccountKey.json)"
```

## Admin SDK Initialization

The code in `src/lib/firebaseAdmin.ts` reads FIREBASE_SERVICE_ACCOUNT_JSON_BASE64, decodes it, and initializes Admin:

- Normalizes private key newlines (replaces `\\n` literal with actual newlines)
- Exposes `adminAuth` and `adminDb`

## Authentication (Session Cookies)

1. Client signs in with Firebase Web SDK and gets an `idToken`.
2. POST `{ idToken }` to `POST /api/auth/session`.
3. Server sets `statly_session` HTTP-only cookie on success.
4. Protected routes verify the cookie with `adminAuth.verifySessionCookie`.

Sign out via `DELETE /api/auth/session`.

## Web Vitals (Firestore by default)

- Endpoint: `POST /api/analytics/performance`
- Backend: Firestore by default; no ClickHouse/Postgres needed
- Collection: `analytics_web_vitals` (override with `METRICS_COLLECTION`)
- Restrict ingestion with `METRICS_ALLOWED_ORIGINS`

## Troubleshooting

- Invalid private key/ASN.1: ensure FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 is set to the raw JSON; newline normalization is handled.
- 403 on analytics: ensure METRICS_ALLOWED_ORIGINS includes the exact origin.
- Missing NEXT_PUBLIC_API_BASE_URL: set it to your app origin, or omit to use relative URLs.

## Local Firebase Emulators

Use the local full-stack command for draft-room and league testing. It starts Firebase Auth,
Firestore, the Next app, Socket.IO, and the worker without touching production Firebase data.

```bash
npm run dev:full:local
```

The command:

- starts Firebase Auth on `127.0.0.1:9099`
- starts Firestore on `127.0.0.1:8080`
- seeds the local test user in Auth, Firestore, and Prisma
- starts the app on `http://localhost:3000`
- starts Socket.IO on `http://localhost:3002`
- starts the web vitals worker

Local test login:

```text
admin@statly.dev
Use the local password printed by `npm run dev:full:local`.
```

The local password is generated from the shared dev-auth resolver unless you set
`STATLY_LOCAL_AUTH_PHRASE` before starting the stack.

After the stack is ready, run the smoke check:

```bash
npm run dev:smoke:local
```

The smoke check verifies the Next app, Socket.IO health, Firebase Auth emulator sign-in,
Firestore seeded user, and a full 12-team test draft through `/api/create-test-draft`.

Manual emulator startup is still available when you only need Firebase:

```bash
npm run dev:firebase
```

Required local environment values are set by `npm run dev:full:local`. If you run services
manually, use:

```dotenv
NEXT_PUBLIC_USE_EMULATORS=true
NEXT_PUBLIC_FIREBASE_PROJECT_ID=statly-4cbed
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=statly-4cbed.firebaseapp.com
NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL=http://127.0.0.1:9099
NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST=127.0.0.1
NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT=8080
STATLY_ENABLE_DEV_TOOLS=true
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
GOOGLE_CLOUD_PROJECT=statly-4cbed
```

Set `NEXT_PUBLIC_FIREBASE_API_KEY` to any non-empty local-only value when starting services
manually. `npm run dev:full:local` generates this value when it is omitted.

The app already connects the client SDK to the emulators when `NEXT_PUBLIC_USE_EMULATORS=true`.
The Admin SDK auto-targets the emulators when `FIRESTORE_EMULATOR_HOST` and
`FIREBASE_AUTH_EMULATOR_HOST` are set.

The legacy development-auth fallback remains available only when Firebase client config is absent
and both explicit development-auth flags are enabled. For full-stack testing, prefer the Auth
emulator path above. For an isolated fallback session, add these local-only values:

```dotenv
NEXT_PUBLIC_STATLY_ENABLE_DEV_AUTH=true
STATLY_ENABLE_DEV_AUTH=true
# Optional override for the generated local-only phrase
STATLY_LOCAL_AUTH_PHRASE=replace-with-a-local-only-phrase
```
