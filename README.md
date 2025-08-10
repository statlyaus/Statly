# Statly - Fantasy AFL Platform

This is a fantasy sports platform for the Australian Football League (AFL), built with Next.js, React, TypeScript, and Firebase.

## Tech Stack

- **Framework**: [Next.js](https://nextjs.org/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **Authentication & Database**: [Firebase](https://firebase.google.com/)
- **Linting**: [ESLint](https://eslint.org/)
- **Formatting**: [Prettier](https://prettier.io/)

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

# OpenAI API key (falls back to GITHUB_TOKEN if set)
OPENAI_API_KEY=...

# Optional base URL for OpenAI-compatible endpoints
OPENAI_BASE_URL=https://models.inference.ai.azure.com

# GitHub token for GitHub-hosted language models (optional fallback)
GITHUB_TOKEN=...
```

The weekend summary endpoint relies on external language models. These services impose rate limits, so caching the summary or limiting how often it is refreshed is recommended.

Copy `secrets/serviceAccountKey.example.json` to `secrets/serviceAccountKey.json` and fill it with your Firebase service account credentials.

`GOOGLE_SERVICE_ACCOUNT` should contain the raw JSON from that file. You can set it on the command line:

```bash
export GOOGLE_SERVICE_ACCOUNT="$(cat secrets/serviceAccountKey.json)"
```

`FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` should contain a base64-encoded version of the same file for admin use in [`src/lib/firebaseAdmin.ts`](src/lib/firebaseAdmin.ts). For example:

```bash
export FIREBASE_SERVICE_ACCOUNT_JSON_BASE64="$(base64 -w0 secrets/serviceAccountKey.json)"
```

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

### Sample Player Data

Sample AFL player records for local development are now kept in `src/Data/aflPlayers.ts`. The previous `public/data/aflPlayers.js` has been removed.
