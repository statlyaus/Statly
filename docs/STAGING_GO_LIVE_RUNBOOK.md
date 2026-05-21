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
