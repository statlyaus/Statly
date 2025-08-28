# Firebase Setup

This project uses Firebase Authentication and Firestore. The Admin SDK is initialized from a base64-encoded service account stored in an environment variable.

## Requirements

- A Firebase project
- Service account JSON (Project Settings → Service accounts)
- Do NOT commit the JSON file to the repository

## Environment Variables

- FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: base64 of the service account JSON
- NEXT_PUBLIC_API_BASE_URL: your app origin (e.g., https://localhost:3000). Do not include `/api`.
- METRICS_BACKEND: leave unset or set to `firestore` (default)
- METRICS_ALLOWED_ORIGINS: comma-separated list of allowed origins for analytics ingestion

### Where to put them

Place these in a local env file so Next.js loads them automatically:

```bash
# .env.local (preferred for local dev, overrides .env) or .env (CI/production)
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
FIREBASE_SERVICE_ACCOUNT_JSON_BASE64="<paste-your-base64-service-account-json-here>"
# Optional
# METRICS_BACKEND=firestore
# METRICS_ALLOWED_ORIGINS=http://localhost:3000
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
