# Runtime and data platform

- Status: accepted ownership model; PostgreSQL production cutover is not complete
- Last verified against source: 2026-07-28

## Current state

Statly is a modular Next.js application with separate process entry points for web/API, Socket.IO,
workers, and ETL. The current Prisma schema uses SQLite. SQLite is supported for local development and
disposable tests, but it is not a safe shared production writer for horizontally scaled processes.

Managed PostgreSQL is the accepted production target. This document does not claim that it has been
provisioned, rehearsed, or deployed. Production database migration remains blocked until the
[cutover runbook](../runbooks/postgresql-cutover.md) is satisfied.

## Ownership map

| Concern                                                                           | Owner                                         | Boundary                                                                   |
| --------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------- |
| User identity and tokens                                                          | Firebase Authentication                       | Server code verifies identity before domain authorization.                 |
| Leagues, seasons, membership, drafts, rosters, lineups, matchups, trades, waivers | Prisma services                               | Canonical protected state; every operation is league- and season-scoped.   |
| Live AFL stat evidence                                                            | Footywire/fitzRoy ETL and Firestore ingestion | External data is normalized before fantasy calculations.                   |
| Compatibility projections                                                         | Firestore, temporarily                        | Rebuild from canonical relational state; never reverse ownership silently. |
| Queues, locks, caches, rate limits, Pub/Sub                                       | Redis                                         | Ephemeral coordination only, never durable fantasy truth.                  |
| Bidirectional realtime delivery                                                   | Socket.IO                                     | Transport for server-authoritative events and commands.                    |
| Delayed/background work                                                           | BullMQ workers                                | Idempotent jobs with durable results written through domain services.      |
| Web-vitals telemetry                                                              | Configured telemetry backend                  | Isolated from transactional league data.                                   |

Authentication is not authorization. A valid Firebase UID does not imply membership, commissioner
rights, roster ownership, draft participation, or waiver eligibility.

## Relational target

Managed PostgreSQL will replace SQLite for production Prisma workloads. The provider must supply
encrypted connections, automated backups, point-in-time recovery, monitoring, and a rehearsed restore
path.

- `DATABASE_URL` is the pooled application connection for web, Socket.IO, and workers.
- `DIRECT_DATABASE_URL` is the direct migration/administrative connection.
- Connection budgets include every process class, not only the web tier.
- The first provider cutover preserves IDs, relationships, enums, timestamps, and current string-JSON
  semantics. JSON redesign is a separate migration.

The repository's SQLite migration history is provider-specific. It must not be replayed blindly on
PostgreSQL; the cutover requires a reviewed baseline and transfer process.

## Firebase boundaries

Firebase Authentication remains the identity provider. Firebase Admin credentials are server-only,
must come from the deployment secret manager or local ignored environment, and must be validated
against the expected project.

Firestore is not the long-term authority for transactional fantasy state. Every remaining fallback or
dual-write path needs an owner, parity check, removal condition, and failure policy. A projection
failure must not cause the application to treat stale Firestore state as canonical.

## Realtime and workers

Socket.IO remains the realtime transport because draft and social flows are bidirectional,
room-oriented, and require reconnect recovery. Multi-instance production uses the official Redis
adapter and appropriate load-balancer affinity. Production startup must fail closed if required Redis
coordination is unavailable.

BullMQ owns draft delays and background jobs. Timers use idempotent IDs, bounded retention, startup
reconciliation, graceful shutdown, and queue monitoring. Cron or Firebase Functions may enqueue coarse
work but must not become a second authoritative draft clock.

See [realtime delivery](realtime.md) for command and catch-up invariants.

## ETL and player identity

The supported source is Footywire through fitzRoy. The pipeline streams source rows through TypeScript
normalization and writes live-stat evidence to Firestore. Fetch, parse, validation, or write failure
fails the cycle; production does not substitute mock data.

Player identity may be tolerant at read boundaries, but canonical repairs are explicit data
operations. Firestore match-stat evidence must not create or merge protected player ownership by
guessing. Use the [player identity runbook](../runbooks/player-identity.md) for reviewed consolidation.

## Rejected alternatives

- Production SQLite on local or network storage: insufficient concurrency and failover behavior.
- Firestore as the only database: poor fit for relational authorization, joins, uniqueness, and
  cross-aggregate transactions.
- Immediate Firestore removal: unsafe without migration and parity evidence.
- Firebase Functions as the draft clock: unsuitable as the sole sub-second timer authority.
- Microservices or full event sourcing now: additional failure modes without independent domain
  ownership or replay operations to justify them.

## Completion criteria for PostgreSQL

The target is implemented only after the cutover has been rehearsed and executed, all process classes
use the managed connections, backup/restore evidence exists, domain validation and smoke checks pass,
and the former production SQLite writer is retired. Until then, documentation and deployment reports
must describe PostgreSQL as a target, not current production state.
