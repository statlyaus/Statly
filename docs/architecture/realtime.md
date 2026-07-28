# Realtime delivery

## Ownership

Socket.IO transports live draft and social updates. Redis supplies multi-process Pub/Sub and ephemeral
coordination. Neither owns durable fantasy state.

Draft commands are accepted only through the server application boundary. That boundary authenticates
the actor, checks league membership and pick authority, writes the command result and outbox/event state
through Prisma, and then publishes realtime notification. A successful socket emission without a
successful persisted command is not a successful pick.

## Process model

- Next.js serves pages and HTTP transport routes.
- The Socket.IO process owns rooms, connections, and bidirectional delivery.
- Draft and telemetry workers consume BullMQ jobs.
- Redis coordinates Socket.IO Pub/Sub, queues, locks, rate limits, and short-lived caches.
- Prisma services own durable draft, pick, queue/watchlist, roster, and event records.

Production Socket.IO is a long-running process, not a serverless request handler. Multi-instance
deployments require the official Redis adapter and load-balancer affinity when polling transport is
enabled.

## Connection and catch-up contract

Clients must be able to recover after refresh, reconnect, duplicate events, and out-of-order delivery:

1. Join only rooms the authenticated user may access.
2. Load the persisted snapshot/read model before treating the room as ready.
3. Apply sequenced events after that snapshot.
4. Ignore duplicates and request resynchronization when a sequence gap is detected.
5. Recompute current turn, availability, and roster projection from persisted state.

Optimistic UI may improve responsiveness, but it must reconcile to the server result and surface a
rejected command. Browser state must not become a second draft authority.

## Timers and workers

BullMQ owns delayed auto-pick and background execution. Jobs use stable/idempotent identifiers and are
reconciled from persisted draft state during startup. Cron and Firebase Functions may wake or enqueue
work, but they do not decide which player is selected.

Production startup fails closed when required Redis connectivity is unavailable. Tests and production
builds may use explicit repository-supported disabled modes; they must not silently carry into a real
deployment.

## Security

- Authenticate connections before joining protected rooms.
- Authorize every command again at the domain boundary; room membership is not authorization.
- Include league and season scope in room names, cache keys, locks, and events.
- Restrict production origins and transports through environment configuration.
- Do not log tokens, full service-account values, or private payloads.

## Verification

Realtime changes need focused service tests plus browser or API evidence for the affected flow. For
drafts, verify direct load, refresh, reconnect/catch-up, concurrent or stale commands, roster
projection, and resulting waiver availability. The project-local
`draft-reliability-loop` skill contains the focused checklist.
