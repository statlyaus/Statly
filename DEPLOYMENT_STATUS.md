# Production Deployment Runbook

This document is the operational reference for deploying Statly with the checked-in PM2 deployment script at [`Scripts/deploy-production.sh`](Scripts/deploy-production.sh).

## Scope

This runbook covers:

- production environment requirements
- Prisma migration rollout
- application build and PM2 startup
- post-deploy smoke checks

It does not replace feature-specific guides such as the ETL docs. Use this file for the main application deployment path.

## Required production environment

Provide these values through `.env.production`, `.env.production.local`, or your platform secret store:

```bash
DATABASE_URL=...
NEXTAUTH_URL=https://your-production-domain.com
NEXTAUTH_SECRET=...
```

Firebase admin credentials must be provided in one of these supported shapes:

```bash
# Preferred
FIREBASE_SERVICE_ACCOUNT_JSON_BASE64=...

# Or explicit triplet
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Notes:

- `JWT_SECRET` is optional if `NEXTAUTH_SECRET` is set. The deploy script maps it automatically.
- `.env.local` is for local development and must not be used as a production secret source.
- `BYPASS_AUTH` and `NEXT_PUBLIC_BYPASS_AUTH` must remain `false` in production.
- `FIRESTORE_EMULATOR_HOST` and `FIREBASE_AUTH_EMULATOR_HOST` are local-only and must not be set in production.

## Pre-deploy checklist

Run these checks from the repo root before shipping:

```bash
npm run typecheck
npm run lint
npm run build
```

If the release contains schema changes, apply checked-in Prisma migrations with:

```bash
npx prisma migrate deploy
```

Do not use `prisma db push` for production rollouts.

## Deploy sequence

1. Confirm the production env source contains the required values.
2. Run Prisma migrations:

```bash
npx prisma migrate deploy
```

3. Start the production deployment:

```bash
bash Scripts/deploy-production.sh
```

The script will:

- load `.env.production.local`, `.env.production`, and `.env`
- reject production deploys with auth bypass enabled
- derive Firebase triplet fields from `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` when present
- install dependencies
- build the Next.js app
- build the worker
- restart PM2 processes

## Common failure modes

### Missing Firebase admin credentials

Symptom:

- deploy script stops with missing `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, or `FIREBASE_PRIVATE_KEY`

Fix:

- set `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64`
- or set the full Firebase triplet directly

### Production build fails because auth bypass is enabled

Symptom:

- build or prerender fails with a message indicating `BYPASS_AUTH` must remain disabled in production

Fix:

- remove `BYPASS_AUTH=true`
- remove `NEXT_PUBLIC_BYPASS_AUTH=true`
- rerun the deploy

### Migration drift or schema mismatch

Symptom:

- `prisma migrate deploy` fails

Fix:

- resolve migration drift before deployment
- use the migration guides under [`docs/`](docs/) for reconciliation
- do not switch to `db push` as a shortcut

## Post-deploy smoke checks

Verify these flows immediately after deployment:

1. Sign in and create a valid session cookie.
2. Load an authenticated page without bypass auth.
3. Confirm a Prisma-backed write succeeds.
4. Confirm Firebase-backed reads succeed.
5. If trade changes are included, verify:
   - propose
   - accept
   - commissioner review
   - veto review
   - decline
   - cancel
   - counteroffer

## Current recommendation

Treat this runbook and [`README.md`](README.md) as the canonical deployment references. Feature-specific docs may describe their own subsystems, but production deployment decisions should align with this document and the current deploy script.
