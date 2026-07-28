# PostgreSQL Cutover Runbook

Status: Planned and unexecuted. This runbook does not authorize production data access or deployment.

## Purpose

Move Statly's canonical Prisma data from a production SQLite database to managed PostgreSQL without
losing IDs, relationships, draft state, or compatibility projections. The cutover is complete only
after a rehearsed restore, verified data transfer, controlled traffic switch, and signed observation
window.

Never use `prisma/dev.db` as a migration source, test target, or backup destination. It is protected
local state and is not production evidence.

## Required roles

Assign named people before scheduling the change:

- Change owner: coordinates the window and makes the go/no-go decision.
- Database owner: provisions PostgreSQL, pooling, backups, and restore access.
- Data migration owner: owns the transfer tool and validation report.
- Application owner: deploys web, Socket.IO, workers, cron, and ETL configuration.
- Observer: watches health, errors, queues, and domain invariants independently.

The change owner and database owner must both approve crossing the point of no return.

## Hard prerequisites

Do not schedule production cutover until every item is evidenced:

- Managed PostgreSQL provisioned in the production region
- TLS required and credentials stored in the deployment secret manager
- Pooled application URL and direct migration URL tested separately
- Automated backups and point-in-time recovery enabled
- A PostgreSQL backup restored into an isolated environment and application smoke checks passed
- Redis, Socket.IO, worker, cron, and ETL connection budgets included in the database connection plan
- Current production SQLite source identified explicitly, with size, checksum, and owner
- SQLite `PRAGMA integrity_check` succeeds on a consistent copy
- Data migration tool is idempotent or restartable and has no hard-coded repository database path
- Full rehearsal completed from a recent production-shaped snapshot
- Maintenance/write barrier is implemented and tested
- Rollback command set, deployment versions, and responsible operators recorded
- User communication and expected write-unavailable window prepared

## Migration design

### First cutover scope

The first cutover changes the database provider and preserves domain semantics. It should preserve IDs,
timestamps, enum values, nullable fields, and current string-encoded JSON fields. Do not combine the
provider migration with Firestore removal, broad relation redesign, or JSONB normalization.

Later migrations may convert selected configuration blobs to Prisma `Json` or normalized tables after
independent parse audits and consumer tests.

### Prisma migration history

SQLite migration SQL is provider-specific and must not be replayed against PostgreSQL. In the migration
branch:

1. Change the Prisma datasource to PostgreSQL and add `directUrl = env("DIRECT_DATABASE_URL")`.
2. Generate a fresh PostgreSQL baseline from the reviewed target schema in an empty disposable
   PostgreSQL database.
3. Review generated SQL for types, defaults, indexes, foreign keys, cascades, uniqueness, and enum
   behavior.
4. Apply the baseline to an empty rehearsal database with `prisma migrate deploy`.
5. Record the legacy SQLite migration head and the new PostgreSQL baseline identifier in the cutover
   evidence.

Do not mark a migration applied unless the corresponding schema exists and has been independently
inspected.

### Transfer tool requirements

Use a reviewed, one-purpose TypeScript transfer command. It must:

- require explicit source and target URLs;
- reject repository-local source or target paths unless running a declared disposable test;
- refuse identical source and target URLs;
- preserve primary keys and stable external IDs;
- insert parent tables before dependent tables;
- use bounded transactions and deterministic ordering;
- report inserted, skipped, failed, and reconciled rows per table;
- validate every JSON string before copying it;
- stop on unknown enum values or broken foreign keys;
- be safe to restart without duplicating rows; and
- write no secrets or record payloads to logs.

Bulk SQL or provider-native import is acceptable only if it produces the same validation report and is
rehearsed against the exact schema.

## Rehearsal

Run at least one full rehearsal from a recent sanitized or access-controlled production snapshot:

1. Create a consistent SQLite snapshot and record its checksum.
2. Restore/provision an empty PostgreSQL rehearsal target from the reviewed baseline.
3. Run the complete transfer tool with production-shaped volume.
4. Run structural validation.
5. Run domain validation.
6. Start every process class against the rehearsal target.
7. Run authenticated web, API, Socket.IO, worker, queue, draft, roster, waiver, trade, and health smoke
   checks.
8. Exercise a rollback before any rehearsal writes are accepted as canonical.
9. Record duration, connection peaks, failures, fixes, and the expected production window.

A rehearsal using an empty fixture database is useful but does not satisfy this gate.

## Validation contract

### Structural checks

Capture before/after evidence for:

- row count per table;
- distinct primary-key count per table;
- null count for required migrated fields;
- orphan count for every foreign key;
- duplicate count for every unique business key;
- minimum and maximum timestamps;
- parse failures for string-encoded JSON;
- expected index and constraint names; and
- Prisma migration status.

Any unexplained difference blocks cutover.

### Domain checks

At minimum, verify:

- every league owner is a valid user/member according to current rules;
- memberships remain league-scoped;
- every draft references the intended league;
- pick order is unique and contiguous where the domain requires it;
- live drafts retain status, current pick, scheduling version, and deadline;
- drafted-player ownership matches canonical roster projection;
- no player is duplicated within a league roster when prohibited;
- waiver availability agrees with roster ownership;
- pending trades reference valid members and players;
- outbox/draft events preserve ordering and publication state; and
- Firestore compatibility projections can be rebuilt from relational state.

Run the repository regression suite and focused migration tests against the rehearsal target. A schema
that accepts connections but violates domain invariants is not a successful migration.

## Production cutover

### T-minus 24 hours

- Confirm backup/PITR health and the latest restore drill.
- Confirm deployment artifacts and rollback versions are immutable and available.
- Confirm no unrelated schema, ETL, or Firebase change shares the window.
- Capture current audit, queue depth, error rate, and database health baselines.
- Reconfirm source path, target cluster, environment, and named operators verbally.

### Enter maintenance mode

1. Enable a server-side write barrier that returns a deliberate maintenance response for mutations.
2. Stop or pause cron triggers, ETL writers, BullMQ workers, and draft start/expiry scheduling.
3. Prevent Socket.IO command handlers from accepting mutations while allowing a maintenance notice.
4. Wait for in-flight database transactions and queue jobs to settle.
5. Record final queue depths and process states.

Do not rely on a frontend banner as the write barrier.

### Capture the source

1. Create a consistent SQLite backup using the SQLite backup API or an equivalent reviewed mechanism.
2. Run `PRAGMA integrity_check` against the backup.
3. Record file size, cryptographic checksum, timestamp, source host, and operator.
4. Store the backup in encrypted, access-controlled storage outside the repository.
5. Make the cutover copy immutable for the retention period.

### Load and validate PostgreSQL

1. Confirm the target is empty or contains only the reviewed baseline.
2. Apply pending PostgreSQL migrations through the direct URL.
3. Run the transfer tool from the immutable SQLite cutover copy.
4. Run the full structural and domain validation contract.
5. Save machine-readable counts plus human sign-off as release evidence.

If any required invariant fails, stop and roll back before enabling writes.

### Switch process classes

Update secrets without printing them:

- web/API: pooled `DATABASE_URL`;
- Socket.IO: pooled `DATABASE_URL` plus production Redis;
- workers: pooled `DATABASE_URL` plus production Redis;
- migrations: direct `DIRECT_DATABASE_URL`;
- cron/ETL: the connection appropriate to their runtime and budget.

Deploy in this order:

1. health-only or maintenance-mode web/API;
2. Socket.IO in mutation-disabled mode;
3. one worker instance with consumption paused;
4. remaining web/socket instances;
5. validation smoke checks;
6. workers and cron/ETL only after the database is declared canonical.

### Point of no return

The point of no return is immediately before the first production mutation is accepted by PostgreSQL.
Before that moment, rollback may restore the previous deployment and SQLite source because the write
barrier prevented divergence.

The change owner and database owner must explicitly record:

- all validation gates passed;
- the PostgreSQL backup/restore path is healthy;
- every process class points to the intended environment; and
- rollback artifacts remain available.

Only then remove the write barrier and resume workers, cron, ETL, and Socket.IO commands.

## Observation window

For the agreed window, monitor:

- connection utilization and pool wait time;
- query latency, locks, deadlocks, and transaction failures;
- application 5xx/4xx changes and Sentry regressions;
- `/api/health` relational status;
- Redis queue depth, stalled jobs, and duplicate job conflicts;
- Socket.IO authorization, reconnects, and cross-node broadcasts;
- draft deadlines, pick progression, and roster projection;
- waiver/trade mutations; and
- Firestore compatibility projection failures.

Keep the SQLite source immutable and offline. Do not use it for reads after PostgreSQL becomes
canonical.

## Rollback

### Before the point of no return

1. Keep the write barrier active.
2. Stop PostgreSQL-connected workers and mutation-capable processes.
3. Restore the prior application deployment and SQLite connection configuration.
4. Start health-only web/API, verify the SQLite checksum/integrity, then restore process classes.
5. Remove the write barrier only after relational, queue, Socket.IO, and auth smoke checks pass.

### After PostgreSQL has accepted writes

Do not point traffic back to the old SQLite snapshot. That would discard accepted production writes.

1. Re-enable the write barrier and stop background writers.
2. Preserve PostgreSQL and queue state.
3. Choose a forward fix or a reviewed reverse-transfer plan based on the incident.
4. Reconcile every PostgreSQL mutation since the cutover boundary before any rollback.
5. Require incident-command approval and a new validation report.

An emergency restore uses managed PostgreSQL backup/PITR unless a separately rehearsed reverse migration
proves no data loss.

## Completion record

Attach or link:

- change ticket and named owners;
- target environment and deployment versions;
- source and backup checksums;
- PostgreSQL baseline and migration status;
- structural/domain validation reports;
- restore-drill evidence;
- smoke and regression results;
- monitoring snapshots from the observation window;
- point-of-no-return sign-off; and
- any residual risk acceptance.

After the retention and observation requirements are met, retire the production SQLite deployment
path in a separate reviewed change. Local disposable SQLite verification remains supported.

## Related sources

- [Runtime and data platform](../architecture/data-platform.md)
- [Testing and disposable databases](../development/testing.md)
- [Player identity consolidation](player-identity.md)
- [Dependency override policy](../development/dependency-overrides.md)
