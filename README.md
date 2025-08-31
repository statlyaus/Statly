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

### 🔄 In Development

- **Real-time Data Integration**: Live AFL statistics via ETL pipeline
- **Trade System**: Player trading with analysis tools
- **Advanced Analytics**: Machine learning player predictions
- **Social Features**: League chat and community features

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

## Getting Started

### Prerequisites

1.  Node.js (v18 or later)
2.  `npm` or your favorite package manager
3.  A Firebase project.

### Installation

1.  Clone the repository.
2.  Install dependencies: `npm install`
3.  Create a `.env.local` file in the root of the project and add your Firebase configuration keys. You can get these from your Firebase project settings.

### Environment Variables

Service account credentials should be loaded from environment variables instead of committed JSON files. Use
`secrets/serviceAccountKey.example.json` as a template and set `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` to the base64-encoded
contents of your key.

The application and helper scripts rely on the following environment variables:

```bash
# Firebase web config used by the Next.js app
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=...

# Service account JSON used by scripts in the Scripts/ directory
GOOGLE_SERVICE_ACCOUNT='{"type":"service_account",...}'
# Base64-encoded service account JSON used by src/lib/firebaseAdmin.ts
FIREBASE_SERVICE_ACCOUNT_JSON_BASE64=...

# Token for GitHub-hosted language models used in the weekend summary
GITHUB_TOKEN=...

# Standard OpenAI API key if you prefer using OpenAI directly
OPENAI_API_KEY=...
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

## Firebase Setup

See docs/firebase-setup.md for complete setup, environment variables, session cookie flow, and web vitals ingestion details.

### Authentication flow (session cookies)

1) The client signs in with Firebase Web SDK and obtains an `idToken`.
2) POST `{ idToken }` to `POST /api/auth/session`.
3) The API validates the token with `adminAuth`, then sets a `statly_session` HTTP-only cookie.
4) Protected server routes (e.g., draft pick) verify this cookie with `adminAuth.verifySessionCookie`.

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

Requires `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` to be set (see `ENV.EXAMPLE`).

### Sample Player Data

Sample AFL player records for local development are now kept in `src/Data/aflPlayers.ts`. The previous `public/data/aflPlayers.js` has been removed.

## 🧪 Testing & Automation

- **test:socket**
  - Client-only test requiring the dev server to be running.
  - Use for quick local socket interaction checks.
  - Run with:
    ```bash
    npm run test:socket
    ```

- **test:smoke:socket**
  - Self-contained test that starts a socket server, runs the client test, then shuts down.
  - Ideal for Continuous Integration (CI) environments.
  - Run with:
    ```bash
    npm run test:smoke:socket
    ```

- **test:all**
  - Runs the full suite: lint, typecheck, unit, integration, race, end-to-end, and smoke tests.
  - Use before pushing changes or opening pull requests.
  - Run with:
    ```bash
    npm run test:all
    ```

- **When to use each:**
  - Use `test:socket` for rapid local dev feedback when the server is already running.
  - Use `test:smoke:socket` for isolated socket tests in CI or when you want a clean environment.
  - Use `test:all` to validate all aspects of the codebase before sharing or merging.

- **Typical Codex workflow:**
  1. Branch from main/master.
  2. Commit changes locally.
  3. Run `npm run test:all` to verify code quality and correctness.
  4. Push branch to remote repository.
  5. Open a Pull Request (PR) for review.
  6. Once approved, merge (land) the PR.
