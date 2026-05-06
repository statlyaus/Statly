# Statly - Fantasy AFL Platform

This is a comprehensive fantasy sports platform for the Australian Football League (AFL), built with Next.js, React, TypeScript, and Firebase, featuring real-time player statistics and live scoring.

## 🏗️ Architecture

- **Frontend**: Next.js 15 with React and TypeScript
- **Styling**: Tailwind CSS with custom AFL team themes
- **Backend**: Firebase (Firestore, Authentication)
- **Real-time Data**: Custom ETL pipeline with Python/R data fetchers
- **Deployment**: Vercel (frontend) + Google Cloud Run (ETL)

## 🚀 Tech Stack

- **Framework**: [Next.js](https://nextjs.org/) 15.4.6
- **Language**: [TypeScript](https://www.typescriptlang.org/) with strict mode
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) + [Framer Motion](https://www.framer.com/motion/)
- **Database**: [Firebase Firestore](https://firebase.google.com/docs/firestore)
- **Authentication**: [Firebase Auth](https://firebase.google.com/docs/auth)
- **Data Pipeline**: Python + TypeScript ETL system
- **UI Components**: Custom component library with accessibility
- **Icons**: [Heroicons](https://heroicons.com/)
- **Linting**: [ESLint](https://eslint.org/)
- **Formatting**: [Prettier](https://prettier.io/)

## 📊 Features

### ✅ Implemented

- **Universal Navigation**: Familiar fantasy sports tabs across all pages
- **Team Analytics Dashboard**: Comprehensive team performance metrics
- **Live Scoring & Matchups**: Real-time match tracking and head-to-head comparisons
- **Player Analysis**: Advanced player statistics and performance insights
- **Waiver/FAAB System**: Free agent acquisition with budget management
- **Commissioner Tools**: League management and administrative features
- **Help Documentation**: Complete user guides and tutorials
- **Draft Management**: Snake draft system with real-time updates
- **Responsive Design**: Mobile-first design with desktop optimization
- **Real-time Data Integration**: Live AFL statistics via ETL pipeline
- **Trade System**: Player trading with analysis tools

## 📡 ETL Data Pipeline

Statly includes a sophisticated ETL pipeline for real-time AFL data ingestion:

### Data Sources

- **Primary**: Footywire (via custom Python scraper)
- **Backup**: AFL Official, AFL Tables (via fitzRoy when R available)
- **Update Frequency**: 30-second polling during live matches

### Pipeline Components

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│   Python    │───▶│  Data Fetch  │───▶│ NDJSON File │
│   Scraper   │    │   Script     │    │             │
└─────────────┘    └──────────────┘    └─────────────┘
                                              │
                                              ▼
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│  Firestore  │◀───│ TypeScript   │◀───│   Node.js   │
│ Collections │    │ Ingestor     │    │   Poller    │
└─────────────┘    └──────────────┘    └─────────────┘
```

### Firestore Schema

- **matches/{matchUid}**: Match details and status
- **players/{playerUid}**: Player profiles and team affiliations
- **player*match_stats/{matchUid}*{playerUid}**: Real-time player statistics

### ETL Setup

```bash
# Navigate to ETL directory
cd etl/

# Install dependencies
npm install

# Test data fetcher
python3 fetch_fw_round.py 2025 18 /tmp/test.json

# Configure Firebase credentials
cp .env.template .env
# Edit .env with your GOOGLE_SERVICE_ACCOUNT JSON

# Run ETL pipeline
npm run dev
```

See `etl/README.md` for detailed ETL documentation.

Identity and unresolved-row operations are documented in [`docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md`](docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md).

## Getting Started

### Prerequisites

1.  Node.js (v18 or later)
2.  `npm` or your favorite package manager
3.  A Firebase project.

### Installation

1.  Clone the repository.
2.  Install dependencies: `npm install`. The **`prepare`** script runs automatically and points Git at **`.githooks/`** (and `chmod +x` for `pre-push` on macOS/Linux). The hook file is tracked as **executable** in Git for Windows-friendly checkouts. If you use **`npm install --ignore-scripts`**, run **`npm run setup:hooks`** once. CI skips hook setup (`CI=true`). Emergency push bypass: **`STATLY_SKIP_PREPUSH=1 git push`**.
3.  Create a `.env.local` file for local development only (required for `npm run env:check:firebase`, which is part of `npm run prepush` / pre-push hooks).
4.  Keep production secrets in `.env.production`, `.env.production.local`, or your deployment platform secret store.

Parallel features: use a separate clone or `git worktree add` so one branch stays focused; each worktree runs its own **`npm install`** (which re-applies hook config for that checkout).

### Environment Variables

Service account credentials should be loaded from environment variables instead of committed JSON files. Use
`secrets/serviceAccountKey.example.json` as a template and set `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` to the base64-encoded
contents of your key.

#### Local development

Use `.env.local` for browser Firebase config and local-only flags:

```bash
# Firebase web config used by the Next.js app
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=...

# Optional local-only auth bypass. Never enable these in production.
BYPASS_AUTH=false
NEXT_PUBLIC_BYPASS_AUTH=false

# Required only when running npm run seed:auth.
SEED_AUTH_USER_PASSWORD=replace-with-a-local-password
# Optional: print the seed password after seeding.
SEED_AUTH_PRINT_PASSWORD=false
```

#### Server and production

Use `.env.production`, `.env.production.local`, or platform-managed secrets for server/runtime values:

```bash
# Required in production
DATABASE_URL=...
NEXTAUTH_URL=https://your-production-domain.com
NEXTAUTH_SECRET=...

# Supported Firebase admin credential shapes: use one of these
FIREBASE_SERVICE_ACCOUNT_JSON_BASE64=...

# Or provide the service-account triplet directly
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY=replace_with_newline_escaped_private_key

# Optional compatibility alias. The deploy script derives this from NEXTAUTH_SECRET when omitted.
JWT_SECRET=...

# Optional app configuration
NEXT_PUBLIC_API_URL=https://your-production-api.com
LOG_LEVEL=error
```

Production guardrails:

- Do not load `.env.local` into production deploys.
- Do not set `BYPASS_AUTH=true` or `NEXT_PUBLIC_BYPASS_AUTH=true` in production.
- Do not set `FIRESTORE_EMULATOR_HOST` or `FIREBASE_AUTH_EMULATOR_HOST` in production.
- Prefer `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` unless your platform makes the Firebase triplet easier to manage.

Other optional variables used by specific jobs and integrations:

```bash
# Service account JSON used by some Scripts/ helpers
GOOGLE_SERVICE_ACCOUNT='{"type":"service_account",...}'

# Token for GitHub-hosted language models used in the weekend summary
GITHUB_TOKEN=...

# Standard OpenAI API key if you prefer using OpenAI directly
OPENAI_API_KEY=...
```

### Emulator Hosts: Public → Private (Server)

When using local Firebase emulators:

- Client reads public vars: `NEXT_PUBLIC_USE_EMULATORS`, `NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST` (default `localhost:8080`), `NEXT_PUBLIC_AUTH_EMULATOR_HOST` (default `http://localhost:9099`).
- Server prefers private vars: `FIRESTORE_EMULATOR_HOST` and `FIREBASE_AUTH_EMULATOR_HOST`.

For compatibility, if private vars are not set, the server falls back to the public values and logs a one-time warning. Prefer setting the private vars in `.env` for a clean ops story.

Single source of truth (Admin SDK)

- The Admin SDK uses env vars only to connect to emulators. We do not call `db.settings({ host, ssl: false })` to avoid drift.
- Precedence for server emulator hosts (set before `getFirestore()`/`getAuth()`):
  - `FIRESTORE_EMULATOR_HOST` (preferred) → falls back to `NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST` (host:port)
  - `FIREBASE_AUTH_EMULATOR_HOST` (preferred) → falls back to `NEXT_PUBLIC_AUTH_EMULATOR_HOST` (host[:port] or URL)
- Example `.env` for local dev:

```
FIRESTORE_EMULATOR_HOST=localhost:8080
FIREBASE_AUTH_EMULATOR_HOST=localhost:9099
NEXT_PUBLIC_USE_EMULATORS=true
NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST=localhost:8080
NEXT_PUBLIC_AUTH_EMULATOR_HOST=http://localhost:9099
```

The weekend summary endpoint relies on external language models. These services impose rate limits, so caching the summary or limiting how often it is refreshed is recommended.

Copy `secrets/serviceAccountKey.example.json` to `secrets/serviceAccountKey.json` and fill it with your Firebase service account credentials.

`GOOGLE_SERVICE_ACCOUNT` should contain the raw JSON from that file. You can set it on the command line:

```bash
export GOOGLE_SERVICE_ACCOUNT="$(cat secrets/serviceAccountKey.json)"
```

`FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` should contain a base64-encoded version of the same file for admin use in [`src/lib/firebaseAdmin.ts`](src/lib/firebaseAdmin.ts). For example:

```bash
# macOS (zsh)
export FIREBASE_SERVICE_ACCOUNT_JSON_BASE64="$(base64 -b 0 secrets/serviceAccountKey.json)"

# Linux
export FIREBASE_SERVICE_ACCOUNT_JSON_BASE64="$(base64 -w 0 secrets/serviceAccountKey.json)"
```

---

## Production Deployment

The checked-in production script is [`Scripts/deploy-production.sh`](Scripts/deploy-production.sh). It assumes a PM2-based deploy on a host that can run the Next.js app and the Socket.IO worker.

### Before you deploy

1. Run the required checks:

```bash
npm run typecheck
npm run lint
npm run build
```

2. Make sure production secrets are available through `.env.production`, `.env.production.local`, or the deployment platform.
3. Apply Prisma migrations with `npx prisma migrate deploy`. Do not use `prisma db push` for production rollouts.
4. Confirm auth bypass and emulator flags are disabled.

### Deploy command

```bash
bash Scripts/deploy-production.sh
```

The script loads `.env.production.local`, `.env.production`, and `.env`, validates required server secrets, derives the Firebase triplet from `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` when available, builds the app, and starts PM2 processes.

### Post-deploy smoke checks

1. Verify login/session creation works.
2. Verify the main app loads without bypass auth enabled.
3. Verify a Prisma-backed write flow succeeds.
4. For trade changes, verify propose, accept, review, decline, cancel, and counter flows.

## Firebase Setup

See docs/firebase-setup.md for complete setup, environment variables, session cookie flow, and web vitals ingestion details.

### Authentication flow (session cookies)

1. The client signs in with Firebase Web SDK and obtains an `idToken`.
2. POST `{ idToken }` to `POST /api/auth/session`.
3. The API validates the token with `adminAuth`, then sets a `statly_session` HTTP-only cookie.
4. Protected server routes (e.g., draft pick) verify this cookie with `adminAuth.verifySessionCookie`.

To sign out, call `DELETE /api/auth/session` which clears the cookie.

### Web Vitals ingestion (Firestore by default)

- Endpoint: `POST /api/analytics/performance`.
- Default backend: Firestore (no ClickHouse/Postgres required). Leave `METRICS_BACKEND` unset or set to `firestore`.
- Collection name: `analytics_web_vitals` (override with `METRICS_COLLECTION`).
- Allowed origins: set `METRICS_ALLOWED_ORIGINS` to a comma-separated list of allowed origins. Requests from other origins are rejected (403).
- Public origin: set `NEXT_PUBLIC_API_BASE_URL` to your app origin (e.g., `https://localhost:3000` or your deployed URL). Do not include `/api`.
- Rate limiting & de-dup: Redis is used when available; if unavailable, the API fails open for rate limiting and falls back to in-memory de-dup.

### Troubleshooting

- Invalid private key / ASN.1 errors: ensure `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` is set and contains the raw JSON; the code replaces `\\n` with real newlines at runtime.
- 403 on analytics ingestion: ensure `METRICS_ALLOWED_ORIGINS` includes the requesting origin exactly.
- Missing env: `NEXT_PUBLIC_API_BASE_URL` can be set to your app origin; if omitted, client calls default to relative URLs.
- Production build fails with auth bypass enabled: unset `BYPASS_AUTH` and `NEXT_PUBLIC_BYPASS_AUTH` in production env sources.
- Deploy script fails with missing Firebase admin vars: provide `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` or the full `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` triplet.

### Running the Development Server

Run the following command to start the development server:

```bash
npm run dev
```

### Seeding Draft Metadata

Use the `Scripts/seedRoomMeta.ts` script to initialize draft metadata for a room:

```bash
# Seed the default room
npx ts-node Scripts/seedRoomMeta.ts

# Seed a specific room and shuffle draft order
npx ts-node Scripts/seedRoomMeta.ts <roomId> --shuffle
```

Pass `--test` to generate placeholder team names instead of loading teams from the database.

### Migration: league_members → leagueMembers

To backfill the canonical collection from the legacy name:

```bash
npx tsx Scripts/migrate-league-members.ts
# or:
# npm exec tsx Scripts/migrate-league-members.ts

Requires `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` to be set (see `.env.example`).

### Sample Player Data

Sample AFL player records for local development are now kept in `src/Data/aflPlayers.ts`. The previous `public/data/aflPlayers.js` has been removed.
```
