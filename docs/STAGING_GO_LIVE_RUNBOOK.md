# Staging Go-Live Runbook

## Purpose

Use this runbook to deploy Statly to a production-like staging environment, run launch smoke, collect release evidence, and decide whether the release can progress to production.

## Staging Contract

- Web runtime: Vercel preview or dedicated staging deployment.
- Data/Auth: separate Firebase staging project.
- Runtime policy: `STATLY_RUNTIME_ENV=staging`.
- Auth bypass: disabled with `BYPASS_AUTH=false` and `NEXT_PUBLIC_BYPASS_AUTH=false`.
- Smoke mutation policy: `GO_LIVE_ALLOWED_MUTATIONS=read-only` for preflight.
- Browser matrix: `chrome,safari,firefox,mobile-safari,chrome-android`.
- Firebase emulators are forbidden in staging.
- Production Firebase and production databases are forbidden in staging.

## Deploy And Preflight

Run local release gates before staging deployment:

```bash
npm run typecheck
npm run lint
npm run guard:routes
npm run guard:design
npm test
npm run build:release
```

Deploy staging:

```bash
vercel deploy
```

Run preflight with staging environment variables loaded:

```bash
npm run go-live:staging-preflight
```

Preflight must return `ok: true` before browser smoke starts.

## Smoke Data Policy

Smoke data must be created in staging only. Do not use production Firebase, production databases, or local emulator exports.

Required smoke identities:

- one standard smoke user
- one league id reachable at `/leagues/:leagueId`
- one draft id reachable at `/drafts/:draftId`
- enough league state to exercise dashboard, league switch, draft room, trade review, waiver flow, player rankings, and admin denial

Fixture inventory must be recorded in the release evidence before use and include: staging Firebase project identifier, dataset version, fixture label or id prefix, owner email, creation method, smoke user uid or email, league id, draft id, and any seeded collection/document prefixes.

The first staging preflight is read-only. Any later mutation smoke must be owned by the release captain or named fixture owner listed in the inventory. Cleanup ownership is recorded beside the fixture inventory and must name the responsible owner email.

Cleanup must remove or reset every mutation-scoped fixture artifact: smoke users, league and draft documents, seeded player/roster/trade/waiver/admin-test documents, auth claims, storage objects, scheduled jobs, and any fixture-prefixed documents created during smoke. Cleanup is complete only when evidence shows the cleanup command or manual checklist, timestamp, staging project identifier, affected fixture label or prefix, owner email, and post-cleanup verification that the smoke ids and fixture-prefixed records no longer exist or have been reset to the documented baseline.
