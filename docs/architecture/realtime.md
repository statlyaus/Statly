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

### Draft protocol v2

Protocol v2 makes the catch-up contract explicit. A client starts buffering `draft:event:v2` before
it asks to join and supplies a monotonically increasing, tab-local generation. The server authenticates
the socket, authorizes durable draft membership, subscribes the canonical `draft:<id>` room, and then
builds one acknowledgement containing:

- a canonical snapshot at sequence `S`;
- a contiguous replay of persisted outbox events in `(S, H]`; and
- the fixed replay head `H`.

The acknowledgement is successful only when the replay is complete through `H`. The client validates
the entire snapshot, replay, and buffered live suffix before applying one reducer commit. It ignores
duplicates, rejects conflicting duplicates or gaps, and advances its cursor only after every event in
the commit is valid. Any malformed envelope, sequence gap, buffer overflow, or incomplete baseline
abandons that generation and starts a fresh snapshot cycle.

One generation owns shared draft state at a time. After a v2 acknowledgement wins, v1 snapshots and
shared v1 deltas cannot mutate the draft. Private queue/watchlist updates remain actor-scoped and are
hydrated only after the winning shared baseline. A client may fall back to v1 only before v2 ownership
is established. The server invalidates and drains pending v2 cleanup before accepting that v1 join, so
a late rollback cannot remove the fallback subscription.

Protocol v1 remains a temporary compatibility path for clients that omit capabilities or explicitly
request v1. An explicit unsupported capability set fails; it does not silently downgrade. The legacy
in-memory websocket manager is v1-only and is not an authority for Prisma-backed v2 rooms.

## Timers and workers

BullMQ owns delayed auto-pick and background execution. Expiry jobs use immutable identities scoped by
draft scheduling revision. Outbox delivery reconciles the latest Prisma clock immediately, and workers
repeat that reconciliation at startup and on a bounded interval under a distributed lease. Stale jobs
are harmless because execution revalidates persisted status, deadline, and revision. Cron and Firebase
Functions may wake or enqueue work, but they do not decide which player is selected.

Production startup fails closed when required Redis connectivity is unavailable. Tests and production
builds may use explicit repository-supported disabled modes; they must not silently carry into a real
deployment.

## Operational signals

Draft metrics use bounded labels only; draft, league, user, socket, generation, revision, and error
message values must never be labels.

- `draft_clock_convergence_total{outcome}` records exactly one terminal result per convergence call:
  `not_live`, `valid`, `repaired`, `concurrent`, or `failed`.
- `draft_outbox_flushes_total{source,outcome}` records command, per-draft repair, and batch-repair
  drains as `empty`, `success`, or `failed`.
- `draft_outbox_events_total{outcome}` counts events in successful or failed delivery attempts. It is
  attempt volume, not a unique-event count: a retry may first be `failed` and later `published`.
- `draft_realtime_state_preparation_retries_total{reason="concurrent_clock_transition"}` records a
  scheduling/projection revision race that required another authoritative read.
- `draft_realtime_v2_joins_total{outcome}` records one terminal acknowledgement per v2 join.
- `draft_realtime_v2_baseline_attempts` and `draft_realtime_v2_replay_events` describe successful or
  exhausted baseline work and the accepted replay size.

Alerting should be ratio- and duration-based rather than firing on a single self-healed event. Treat
any sustained `failed` convergence, outbox failure, or `internal_error` join rate as actionable. A
rising `sync_unavailable` share, baselines repeatedly reaching three attempts, or replay sizes near the
250-event ceiling indicates catch-up pressure and should trigger inspection of outbox continuity,
Redis delivery, and database latency. `repaired`, `concurrent`, and preparation-retry increases are
early warnings; confirm they return to baseline after deployments or traffic spikes.

Operator order of operations is: verify Prisma clock and event sequence first, inspect pending/failed
outbox rows second, verify worker/Redis health third, and only then inspect client reconnect logs. Do
not repair a stuck room by emitting a socket event or editing Redis; run the persisted reconciliation
path so the outbox, expiry job, and reconnect snapshot converge together.

## Security

- Authenticate connections before joining protected rooms.
- Authorize every command again at the domain boundary; room membership is not authorization.
- Authenticate private queue and watchlist transports before parsing their payloads, then resolve the
  active draft member from the authenticated actor inside the server service boundary. Legacy
  `memberId` input is ignored and never selects another member's state.
- Include league and season scope in room names, cache keys, locks, and events.
- Keep user-scoped queue and watchlist contents out of shared room snapshots and Pub/Sub payloads.
- Mark private strategy responses `private, no-store`; Prisma is their only authority. Do not retain
  an in-memory or browser-local shadow store as a fallback.
- Restrict production origins and transports through environment configuration.
- Do not log tokens, full service-account values, or private payloads.

## Verification

Realtime changes need focused service tests plus browser or API evidence for the affected flow. For
drafts, verify direct load, refresh, reconnect/catch-up, concurrent or stale commands, roster
projection, and resulting waiver availability. The project-local
`draft-reliability-loop` skill contains the focused checklist.
