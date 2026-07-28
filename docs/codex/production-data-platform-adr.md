# Production Data and Runtime Platform

- Status: Accepted target architecture; database cutover not yet executed
- Decision date: 2026-07-28
- Applies to: production deployments, persistence, realtime delivery, and background work

## Context

Statly currently uses Prisma with SQLite for protected relational state, Firebase Authentication for
identity, Firestore for selected live-stat and compatibility projections, Redis for ephemeral state
and queues, Socket.IO for bidirectional delivery, and BullMQ for scheduled work. SQLite remains useful
for isolated local development and disposable test fixtures, but it is not an acceptable shared
production writer for horizontally scaled web, socket, cron, and worker processes.

This ADR defines the target ownership boundaries. It does not claim that the PostgreSQL migration has
occurred. Until the cutover runbook is completed against provisioned infrastructure, production launch
remains blocked on the relational database.

## Decision

### PostgreSQL owns protected structured state

A managed PostgreSQL service will replace SQLite as the production Prisma datasource. The provider
must offer automated backups, point-in-time recovery, encrypted connections, monitoring, and a tested
restore path.

- `DATABASE_URL` is the pooled application connection used by web, Socket.IO, and worker processes.
- `DIRECT_DATABASE_URL` bypasses transaction pooling for Prisma migrations and administrative work.
- Connection limits are set from the combined maximum concurrency of every process class, not from the
  web tier alone.
- Read replicas are optional. Add them only after measured read pressure justifies their operational
  cost and the application has an explicit consistency policy.

The production database must never be a repository file or network-mounted SQLite file. SQLite remains
supported only for local and disposable verification paths that explicitly use a safe temporary URL.

### Firebase Authentication remains the identity provider

Firebase Authentication continues to own sign-in, OAuth provider integration, token issuance, and
account identity. Server boundaries verify Firebase ID or session tokens, then use the verified UID to
authorize access to relational data.

Authentication identity is not application authorization. League membership, commissioner rights,
draft participation, roster ownership, and waiver eligibility remain protected relational concerns.

### Firestore becomes a bounded compatibility and ingestion surface

Firestore is not the long-term source of truth for transactional fantasy state. Existing Firestore
surfaces are migrated deliberately rather than removed in one release:

| Data class                                             | Target owner                        | Transition rule                                                                                 |
| ------------------------------------------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| Authentication identities                              | Firebase Authentication             | Retain                                                                                          |
| League, membership, draft, roster, trade, waiver state | PostgreSQL through Prisma           | Prisma is canonical; remove Firestore fallbacks after parity and migration evidence             |
| Raw or externally sourced live-stat evidence           | Ingestion boundary, then PostgreSQL | Firestore may remain an input during migration; normalize before protected fantasy calculations |
| Compatibility projections                              | Firestore temporarily               | Rebuild from canonical relational state; never reverse ownership silently                       |
| Web-vitals telemetry                                   | Configured telemetry backend        | Keep isolated from transactional domain data                                                    |

Every remaining dual-write or fallback path needs an owner, parity check, removal condition, and failure
policy. A compatibility projection failure must not make Firestore canonical by accident.

### Redis owns ephemeral coordination, not durable domain truth

Redis remains the shared substrate for BullMQ, rate limits, short-lived room projections, distributed
locks, and Socket.IO Pub/Sub. Durable picks, memberships, rosters, and event records belong in
PostgreSQL.

Production Redis must use private networking, authentication, transport encryption where supported,
bounded retention, and memory/eviction settings appropriate to queues. Queue keys and cache keys should
be namespaced so operational cleanup cannot delete unrelated state.

### Socket.IO remains the realtime transport

Socket.IO remains appropriate because draft and social flows are bidirectional, server-authoritative,
room-oriented, and must recover from reconnects. Multi-instance deployments use the official Redis
adapter and load-balancer affinity for polling transports. Startup fails closed in production when the
adapter cannot connect.

Socket.IO is hosted as a long-running service rather than in serverless request handlers. A managed
realtime provider is a future operational alternative, not a current requirement.

### BullMQ remains the scheduling and worker system

BullMQ remains the owner of delayed draft jobs and background processing. Workers run as explicit
long-lived processes with idempotent job IDs, bounded completed/failed retention, coordinated startup
reconciliation, graceful shutdown, and queue-depth/stalled-job monitoring.

Firebase Functions and cron invocations are not substitutes for authoritative pick expiry. They may
enqueue coarse scheduled work but must not create a second draft timer owner.

### Keep the modular monolith and separate process classes

The application remains one codebase and one transactional domain. Deployment may separate process
classes without splitting domain ownership:

- Next.js web and API process
- Socket.IO process
- draft worker process
- telemetry worker process
- ETL/ingestion process

This preserves shared services and transactional boundaries while allowing independent scaling and
failure isolation. Microservices are deferred until a domain has demonstrably independent ownership,
throughput, and release cadence.

### Use a hybrid relational and JSONB schema

PostgreSQL `jsonb` is appropriate for configuration read as a cohesive document, such as scoring rules
or flexible draft settings. Normalize data that participates in joins, uniqueness, authorization,
capacity checks, ordering, or frequent predicates.

The provider migration and JSON-shape redesign are separate changes. The first PostgreSQL cutover should
preserve current string-JSON semantics unless a rehearsed converter proves every row and consumer. A
later migration can convert selected fields to Prisma `Json` or normalized tables with independent
rollback evidence.

### Keep the transactional outbox; do not adopt full event sourcing yet

The existing draft event/outbox boundary is retained for reliable publication. Mutable aggregate state
continues to be stored transactionally alongside append-only delivery records. Full event sourcing and
CQRS are not adopted until replay, event versioning, operational tooling, and team capacity justify the
additional failure modes.

## Consequences

### Benefits

- One transactional source of truth for protected fantasy state
- Horizontal web, socket, and worker scaling without a shared SQLite writer
- Explicit ownership between durable state, compatibility projections, and ephemeral coordination
- Managed backup, restore, and observability capabilities
- Realtime and scheduling choices remain aligned with draft latency and authority requirements

### Costs

- Managed PostgreSQL and Redis operations, connection budgets, backups, and restore drills
- A staged Firestore migration with temporary compatibility code
- A rehearsed data conversion and cutover window
- Additional deployment processes beyond the Next.js web tier

## Rejected alternatives

- **Production SQLite on local or network storage:** insufficient concurrent-write and failover model.
- **Firestore as the only database:** weak fit for relational authorization, cross-aggregate
  transactions, joins, and constrained roster operations.
- **Immediate Firestore removal:** too risky without parity and backfill evidence.
- **SSE for drafts:** unidirectional and would add a separate command channel.
- **WebRTC for drafts:** bypasses the server-authoritative validation boundary.
- **Firebase Functions as the pick clock:** unsuitable as the sole sub-second timer authority.
- **Microservices now:** would distribute transactions before domain ownership warrants it.
- **Full event sourcing now:** adds replay and migration complexity without a demonstrated need.
- **Provider switch plus JSON redesign in one cutover:** combines independent data risks and weakens
  rollback.

## Completion criteria

This ADR is implemented only when the PostgreSQL cutover runbook has been rehearsed and executed, all
runtime process classes use the managed connections, restore evidence exists, health checks are green,
and the old production SQLite writer is retired. Firestore phase-out is complete only when each listed
compatibility path has migrated or has an explicitly accepted long-term owner.

## Related sources

- [PostgreSQL cutover runbook](./postgresql-cutover-runbook.md)
- [Draft-room source of truth](../superpowers/specs/2026-06-13-draft-room-source-of-truth.md)
- [Player data convergence brief](./player-data-convergence-brief.md)
- [Socket.IO setup](../SOCKET_IO_SETUP.md)
- [Firebase setup and credential rotation](../firebase-setup.md)
