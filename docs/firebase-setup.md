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
- `METRICS_BACKEND`: `firestore` (default), `clickhouse`, or `postgres` / `timescale` / `timescaledb`
- `METRICS_ALLOWED_ORIGINS`: comma-separated list of allowed origins for analytics ingestion
- ClickHouse (when `METRICS_BACKEND=clickhouse`): `CLICKHOUSE_HOST`, optional `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_DATABASE` (defaults to `default`), `CLICKHOUSE_TZ` (must match `DateTime64` timezone in `clickhouse/schema/web_vitals.sql`). Optional tuning: `CLICKHOUSE_ASYNC_INSERT_MAX_DATA_SIZE`, `CLICKHOUSE_ASYNC_INSERT_BUSY_TIMEOUT_MS`. Apply the schema in `clickhouse/schema/web_vitals.sql` before enabling the writer. The worker uses larger default `METRICS_BATCH_SIZE` for ClickHouse unless you set it explicitly; async insert still coalesces smaller flushes server-side.

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
- Backend: Firestore by default; optional ClickHouse or Postgres/Timescale via `METRICS_BACKEND`
- Firestore collection: `analytics_web_vitals` (override with `METRICS_COLLECTION`)
- ClickHouse: create the table from `clickhouse/schema/web_vitals.sql`, set `CLICKHOUSE_HOST` and related env vars (see Server section above)
- Restrict ingestion with `METRICS_ALLOWED_ORIGINS`

## Troubleshooting

- Invalid private key/ASN.1: ensure FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 is set to the raw JSON; newline normalization is handled.
- 403 on analytics: ensure METRICS_ALLOWED_ORIGINS includes the exact origin.
- Missing NEXT_PUBLIC_API_BASE_URL: set it to your app origin, or omit to use relative URLs.

## Local Firebase Emulators (optional)

Run the Firebase emulators locally to develop without touching production data.

1. Start emulators

```bash
firebase emulators:start --only auth,firestore
```

2. Environment variables

Client (.env.local):

```dotenv
NEXT_PUBLIC_USE_EMULATORS=true
```

Server/Admin (.env or shell):

```dotenv
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
```

3. Client SDK connection snippet

Add this conditional block to your `src/lib/firebaseClient.ts` after initializing `auth`/`db`:

import { connectAuthEmulator } from 'firebase/auth';
import { connectFirestoreEmulator } from 'firebase/firestore';

if (process.env.NEXT_PUBLIC_USE_EMULATORS === 'true' && db && auth) {
try {
connectFirestoreEmulator(db, '127.0.0.1', 8080);
} catch (e) {
if (process.env.NODE_ENV !== 'production') console.debug('Firestore emulator connect failed:', e);
}
try {
connectAuthEmulator(auth, 'http://127.0.0.1:9099');
} catch (e) {
if (process.env.NODE_ENV !== 'production') console.debug('Auth emulator connect failed:', e);
}
}

```

4) Admin SDK

The Admin SDK auto-targets the emulators when `FIRESTORE_EMULATOR_HOST`/`FIREBASE_AUTH_EMULATOR_HOST` are set. No code changes are required in `src/lib/firebaseAdmin.ts`.
```
