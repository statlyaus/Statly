# PostgreSQL Go-Live Checklist

Status: Not started. The fantasy application already runs on PostgreSQL in development and CI; no
production database exists yet. This checklist does not authorize creating cloud resources or
deploying.

## Scope

There is no production data to move. No one has used the application, so there is no SQLite copy,
rehearsal from a snapshot, maintenance window, or rollback after accepted writes. Go-live means:
provision the production database, deploy every process against it, prove it works, and record the
evidence.

The AFL Draft and Trade Outcomes database is separate (`prisma/afl-trade-outcomes`) and is not part
of this checklist.

## Decided targets

- Fantasy database: Google Cloud SQL for PostgreSQL 16, its own instance in the existing Google Cloud
  project.
- Website and API routes: Netlify.
- Draft room (Socket.IO), BullMQ workers, and the stats import: Google Cloud Run.
- Redis: a managed instance reachable from Netlify and Cloud Run.

The code reads plain connection strings (`DATABASE_URL`, `DIRECT_DATABASE_URL`), so a provider
change later is a configuration change, not a code change.

## 1. Provision the database

- [ ] Cloud SQL instance created for PostgreSQL 16 in the production region.
- [ ] Automated backups on, with point-in-time recovery enabled.
- [ ] TLS required for every connection.
- [ ] A dedicated application user and database; no application process uses the `postgres` user.
- [ ] Connection budget written down: web/API, Socket.IO, every worker, cron, and the stats import
      together stay under the instance's connection limit, with pooling where a runtime opens many
      short connections.
- [ ] One backup restored into a scratch instance, and the application smoke checks below passed
      against it. Delete the scratch instance afterwards.

## 2. Choose how Netlify reaches the database

Netlify functions are short-lived and have no fixed egress address. Choose one and record why:

- **Cloud SQL connector** (or Auth Proxy) with IAM authentication, preferred when the function runtime
  supports it; or
- **public IP with TLS required** and a strong password, accepting that Netlify's egress cannot be
  allow-listed.

Cloud Run services use the Cloud SQL connector.

## 3. Store secrets

- [ ] `DATABASE_URL` (pooled application connection) and `DIRECT_DATABASE_URL` (direct connection,
      used only by migrations) set in Netlify's environment for production.
- [ ] The same values, plus `REDIS_URL` and the server-only Firebase credentials, in Google Secret
      Manager and mounted into each Cloud Run service.
- [ ] Nothing printed in build logs, committed, or placed in a `NEXT_PUBLIC_` variable.

## 4. Create the schema

- [ ] `npx prisma migrate deploy` run once against `DIRECT_DATABASE_URL`. The history starts at
      `20261004000000_postgresql_baseline`; the archived SQLite history in
      `prisma/migrations-sqlite-archive/` is never replayed.
- [ ] `npx prisma migrate status` reports the database up to date.
- [ ] The player catalogue loaded through the reviewed import path, and the command and row counts
      recorded. The database starts empty.

## 5. Deploy the processes

Deploy in this order, each against the production database:

1. Website and API routes on Netlify.
2. Draft room (Socket.IO) on Cloud Run, with production Redis.
3. BullMQ workers on Cloud Run, one instance first.
4. The stats import on Cloud Run, failing closed on Footywire through fitzRoy as it does today.

## 6. Smoke checks

- [ ] `/api/health` reports the relational database healthy.
- [ ] Sign in, create a league, invite a second account, and join it.
- [ ] Run a short draft to completion: a manual pick, a queued auto-pick, a reconnect mid-draft, and
      the completed rosters projected.
- [ ] Submit a waiver claim with FAAB and confirm the reserved budget.
- [ ] Propose and accept a trade.
- [ ] Firestore compatibility projections rebuild from relational state.

Any failure blocks go-live. A database that accepts connections but breaks a domain rule has not gone
live.

## 7. Watch the first week

Monitor connection use and pool waits, query latency and lock waits, transaction failures, 5xx rates,
Redis queue depth and stalled jobs, Socket.IO reconnects, draft deadlines, and waiver and trade
mutations. Investigate any serialization-failure or unique-violation spike: those paths are covered
by `tests/integration/postgresConcurrency.test.ts`, and a spike means a race the tests do not cover.

## Completion record

Link from the go-live ticket:

- the Cloud SQL instance, its backup and point-in-time recovery settings, and the restore test;
- the Netlify connection choice and why;
- deployment versions for Netlify and each Cloud Run service;
- `migrate status` output and the player catalogue import record;
- smoke check results; and
- anything accepted as a known risk.

## Related sources

- [Runtime and data platform](../architecture/data-platform.md)
- [Testing and disposable databases](../development/testing.md)
- [Player identity consolidation](player-identity.md)
- [Dependency override policy](../development/dependency-overrides.md)
