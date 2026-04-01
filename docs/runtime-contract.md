# Runtime Contract

This repo currently has multiple historical runtimes. The intended contract is:

- Primary application runtime: Next.js app router and route handlers in `src/app` and `src/app/api`
- Primary draft persistence: Prisma models in `prisma/schema.prisma`
- Primary realtime server: `src/server/socketioServer.ts`
- Auxiliary legacy runtime: Express server in `src/server/index.ts`
- Auxiliary legacy socket runtime: `src/server/socket.cjs`
- Separate ingestion runtime: `etl/`
- Separate Firebase Functions package: `functions/`

Operational defaults:

- Local app dev: `npm run dev`
- Local socket dev: `npm run dev:socket`
- Production build entry: `npm run build:production`
- Deploy-safe Prisma migrations: `npm run migrate`

Notes:

- New application features should prefer Next.js route handlers over adding Express routes.
- Realtime should fan out authoritative state changes; it should not become an alternative write path.
- Legacy runtimes remain in the repo for compatibility, but they are not the default path for new work.
