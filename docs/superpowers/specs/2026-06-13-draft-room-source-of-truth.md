# Draft Room Source Of Truth

This document is the standing reference for the current Statly fantasy draft room. It exists to stop old draft room variants, demo tables, or branch-specific notes from being treated as the current product surface.

## Current Runtime Surface

- Live draft room route: `src/app/(app)/drafts/[id]/page.tsx`
- Live room shell: `src/components/draft/UnifiedDraftRoom.tsx`
- Live player table: `src/components/draft/PlayerGrid.tsx`
- Live left rail: `src/components/draft/DraftLeftRail.tsx`
- Live pick feed: `src/components/PickFeed.tsx`
- Live pick header and sequencing: `src/components/LivePickHeader.tsx` with `src/lib/draftRoomSequencing.ts`
- Draft history list and detail: `src/app/(app)/drafts/history/page.tsx` and `src/app/(app)/drafts/history/[id]/page.tsx`
- Draft history read model: `src/server/draft/readModels/draftHistoryReadModel.ts`

The active `/drafts/[id]` route must render `UnifiedDraftRoom` inside `DraftProvider` and `SocketProvider`. It must not import `AvailablePlayersTable`, `AvailablePlayersTable_new`, or a standalone draft-room shell.

## Reference And Legacy Surfaces

These files can remain as historical reference or development helpers, but they are not the live draft room implementation:

- `src/components/AvailablePlayersTable.tsx`
- `src/components/AvailablePlayersTable_new.tsx`
- `src/components/demos/AvailablePlayersDemo.tsx`
- `src/app/(app)/test-draft/page.tsx`
- Older draft-room plans/specs that explicitly describe prior branches or HTML references.

Do not wire these files into `/drafts/[id]` unless the council explicitly approves replacing the active runtime surface and the guardrail tests are updated in the same change.

## Mandatory Close-Out Checklist

Every substantive draft-room change must close with these checks documented in the final summary:

1. Council review: Decision 1 before implementation and Decision 2 before commit.
2. Runtime route audit: confirm `/drafts/[id]` still routes through `UnifiedDraftRoom`.
3. Component consistency audit: confirm the active room still uses the current table, rails, pick feed, sequencing, and history surfaces.
4. Deployment surface check: identify whether the change requires Next.js app/API deployment, Socket.IO deployment, Firebase rules/indexes/functions, Prisma migration, workers, or ETL changes.
5. Environment consistency check: state where the change must run across local, preview/staging, and production.
6. Archive/deprecation audit: identify any legacy/demo/reference components touched or intentionally left untouched.
7. Dirty-file callout: list unrelated local generated files, databases, env files, or user changes excluded from the commit.

## Deployment Rule

Draft-room UI, App Router pages, API route, read-model, and client context changes require a Next.js app/API deployment in every environment that serves Statly. Deploy preview or staging first, smoke test a live draft and draft history route, then promote or deploy production.

Do not deploy or commit `prisma/dev.db`; it is local runtime state. A Prisma migration is required only when `prisma/schema.prisma` changes. Firebase rules/indexes/functions and Socket.IO server deployment are required only when those owning files change.
