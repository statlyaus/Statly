# AGENTS.md

## Cursor Cloud specific instructions

### Services overview

Statly is a Next.js 15 AFL Fantasy platform. See `README.md` and `package.json` scripts for standard commands.

| Service | How to run | Notes |
|---|---|---|
| Next.js app | `npm run dev` | Runs on port 3000 with Turbopack |
| Socket.IO server | `npm run socket` | Optional; only for live draft features |
| BullMQ worker | `npm run worker:dev` | Optional; requires Redis |
| All together | `npm run dev:full:all` | Runs web + socket + worker via concurrently |

### Node version

The project requires Node.js `>=18.18.0 <21` (see `engines` in `package.json`). Use `nvm use 20` before running commands.

### Database (Prisma + SQLite)

- Dev uses SQLite at `prisma/dev.db` (`DATABASE_URL="file:./dev.db"` in `.env`).
- After `npm install`, run `npx prisma generate` then `npx prisma migrate dev` to create/update the database.

### Firebase

- The app gracefully handles missing Firebase credentials (see `src/lib/firebaseClient.ts`).
- `NEXT_PUBLIC_FIREBASE_*` env vars and `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` should be set via Cursor secrets or `.env.local`.
- Without valid Firebase credentials, routes that fetch from Firestore (e.g. `/players`) will show auth errors, but auth pages and static UI pages (e.g. `/tradecentre`) still work.

### Known issues

- `src/providers/QueryProvider.tsx` imports `Hydrate` from `@tanstack/react-query` v5, but this export was renamed to `HydrationBoundary` in v5. This causes a build error on dashboard routes. Auth pages (`/`, `/auth/*`) and `/tradecentre` are unaffected.

### Lint / test / typecheck

- Lint: `npm run lint` (ESLint on `src/`)
- Unit tests: `npm run test:unit` (Vitest)
- Typecheck: `npm run typecheck`
- Full suite: `npm run test:all`

### Redis / Docker (optional)

Redis and Postgres are optional for local dev. The app degrades gracefully without them. If needed, use `docker-compose up redis` (port 6379).
