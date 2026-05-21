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
