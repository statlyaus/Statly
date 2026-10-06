# Drafts and waivers

## Authority

The draft is a server-authoritative command system. Prisma owns draft configuration, order, picks,
queue/watchlist state, event/outbox records, and canonical roster projection. Socket.IO publishes
persisted results; it does not decide or store picks independently.

Key implementation boundaries:

- Live draft room route: `src/app/(app)/drafts/[id]/page.tsx`.
- Live room shell: `src/components/draft/UnifiedDraftRoom.tsx`.
- `src/server/draft/domain`: capacity, snake order, and draft rules.
- `src/server/draft/services`: application commands, readiness, scheduling, projections, and realtime
  publication.
- `src/server/draft/repository`: persisted read/write boundary.
- `src/app/api/drafts`: authenticated HTTP transport adapters.
- `src/server/rosters`: canonical roster capacity and projection.

## Pick flow

An accepted pick is persisted before it is broadcast. A pick command must:

1. authenticate the actor and authorize league/draft participation;
2. read the current persisted draft version and turn;
3. validate status, player availability, roster capacity, and pick authority;
4. commit the pick, next turn, roster projection, and event/outbox state in one
   `DraftRepository.transaction` Prisma transaction;
5. schedule or reconcile the next timer with an idempotent identity; and
6. publish or enqueue external effects only after commit, using the outbox retry/reconciliation path.

Stale, duplicate, or concurrent commands must be rejected or converge to the same committed result.
Client success is never inferred from a local timer reaching zero or an optimistic row update.

Every shared draft mutation also increments the draft-scoped event sequence and writes its sequenced
outbox record in the same transaction. Sequence values are never inferred from timestamps, Redis
ordering, or browser receipt order. Pre-v2 outbox rows with no sequence remain legacy history and are
not synthesized into the v2 stream.

## Snake order and availability

Snake order reverses the league member order on alternating rounds. Persisted overall pick, round,
slot, and member identifiers must agree; do not derive an alternative order only in the browser.

A player is available only when the canonical league-scoped ownership and draft state allow the pick.
Roster projection after a pick must make that player unavailable to the next manager and to league
waiver/free-agent surfaces. Player identity aliases may be accepted for compatibility, but persisted
ownership uses the canonical ID.

## Queue and watchlist

Queues and watchlists are user- and draft-scoped. Server commands validate membership, player identity,
duplicates, and visibility. Auto-pick consumes the current eligible priority list and records the same
command path as a manual pick; it must not write a separate roster shortcut. Shared room snapshots,
state broadcasts, and Pub/Sub events never contain queue contents or queue size. The authenticated
actor-scoped queue and watchlist APIs are the only browser hydration boundaries for that private
strategy. `DraftPrivateStateService` resolves the active draft member from the authenticated user;
transport payloads cannot select a member. Legacy `memberId` input is tolerated only for migration and
is ignored. Private responses are non-cacheable, and Prisma remains the only authority—local or
in-memory shadow stores must not restore stale strategy state.

## Scheduling

Draft start times are stored as instants with an explicit league timezone for display and scheduling.
Clock commands commit Prisma timing state and an outbox event without depending on Redis. Outbox
delivery and the worker's startup/periodic repair loop both reconcile the latest persisted LIVE clock
into an immutable, revision-addressed BullMQ job. They never schedule from stale event data. Missing
jobs are recreated, while older revision jobs may wake but must fail the worker's persisted-version
guard. Cron may wake reconciliation, but is not a second source of truth for turn expiry.

Pause, resume, commissioner intervention, and completion must cancel or replace stale timers. A late
timer job validates the current draft version and turn before doing anything.

### Live clock contract

Prisma `pickStartedAt`, `pickDeadlineAt`, `pausedRemainingSeconds`, and `schedulingVersion` are the
durable clock state. BullMQ is a wake-up mechanism: an expiry job must pass its scheduling version and
`requireExpired` guard into the transactional auto-pick command. Socket.IO must not run a second
countdown or accept a client request to start one.

`clockDurationSeconds` is captured for the current turn and is immutable for that scheduling revision.
Changing league settings affects a later turn; it cannot stretch or reset the clock already on the
clock. A LIVE clock is valid only when it has a positive captured duration, start, deadline, no paused
remainder, and a deadline at or after its start. Durable convergence repairs malformed legacy anchors
with a compare-and-swap transition, increments the scheduling revision, and writes a
`draft:clock-repaired` outbox intent. If another process wins, the loser reloads the winner rather than
applying a second repair.

HTTP hydration and Socket.IO reconnects expose the same discriminated clock payload:

- `LIVE` includes an absolute persisted start and deadline;
- `PAUSED` includes the persisted remaining seconds;
- non-running states carry no synthetic deadline; and
- every payload includes the scheduling revision and a server-time anchor.

The browser interpolates a LIVE deadline once per second for display. Missing clock anchors render as
syncing, local zero renders as finalizing, and neither state initiates an auto-pick. Pause freezes the
persisted remainder. A reconnect snapshot is applied by revision without clearing an already hydrated
player catalogue, then events after the snapshot boundary are replayed. Revision gaps force a fresh
persisted snapshot.

## Reconnect and recovery

On direct load, refresh, or reconnect, the client buffers v2 events, requests an authenticated
generation-scoped baseline, and atomically applies the persisted snapshot, contiguous replay, and live
suffix. Gaps trigger resynchronization; exact duplicates are ignored; conflicting duplicates are
rejected. A generation that loses to navigation, retry, disconnect, or v1 fallback cannot later commit
its acknowledgement. Current turn, drafted players, roster projection, queue state, and readiness must
converge without relying on the previously open tab.

Persisted reconciliation remains active in both LIVE and PAUSED states so a missed resume event cannot
strand the room on a frozen clock. Because shared snapshots omit private strategy state, every winning
socket baseline also refreshes the authenticated member's queue and watchlist through scoped HTTP
routes. Hydration requests are generation-ordered and cancellable: an older response cannot overwrite
a newer reconnect, visibility refresh, or successful mutation.

Recovery is snapshot-relative, not full event sourcing. The snapshot establishes sequence `S`; replay
captures a fixed head `H` and returns only persisted events in `(S, H]`; the buffered socket stream
continues at `H + 1`. An absent row, unsupported event, invalid payload, cursor ahead of the durable
head, or incomplete replay requires another authoritative snapshot rather than a partial commit.

## Waivers

Waiver ownership is league-scoped and derived from canonical roster/player identity. A draft pick or
roster mutation must update the same ownership boundary used to calculate availability. Firestore may
hold a compatibility projection, but relational state remains authoritative and projections must be
rebuildable from it. The waivers page reads a member's claims, FAAB balance and activity feed from Prisma.
Processed claims (won or lost) are published as `WAIVER_SUCCESSFUL` and `WAIVER_FAILED` system messages
in the league's social Activity channel; submitted and cancelled claims, and their bids, stay private.

Claims validate membership, league settings, player availability, optional drop ownership, roster
capacity, and priority/FAAB rules at the server boundary. Processing must be deterministic and safe to
retry; failures do not partially assign the same player to multiple teams.

Waiver settings live in Prisma's `LeagueSettings`. A league uses FAAB when `faabBudget` is set (each
member's budget); otherwise a `ROLLING` league uses priority order. Commissioners set or clear the
budget through the league settings API (`waiver.faabBudget`: a whole number of at least 1, or
`null`). The minimum bid is 1 and the waiver period is 24 hours. The budget is locked once the league has any waiver
claim, because members' balances are derived from it when a claim first touches them. Firestore holds no waiver settings.

### Concurrent writers

PostgreSQL runs writers concurrently, so budget and pick state are written as guarded updates rather
than values read earlier and written back. A FAAB reservation increments the reserved total first and
then checks it against the balance, rolling back when it is over. A FAAB debit is a decrement guarded
by the balance, so two debits both apply or the second is refused. Waiver transactions stay at READ
COMMITTED; draft transactions run at Serializable and retry serialization failures. A pick that hits a
unique key is re-read outside the aborted transaction: it is replayed as idempotent only when the slot
holds the player that call sent, and refused otherwise. Two first claims in a league can both create
priority rows; the second keeps the first's rows, but the two members can end up sharing a priority
number, because priority is not unique. That is accepted. Waivers run automatically once a day, at 6 am Melbourne time: a Netlify scheduled function calls
`/api/cron/waivers` hourly, and only the run in the 6 am Melbourne hour processes leagues with due
claims, so the time holds through daylight saving. Only one waiver processing run per league proceeds at a
time: it holds a lease in `League.waiverRunStartedAt`, and a second run is refused as already running
(HTTP 409) rather than debiting and awarding the same claims again. A run that dies releases the
lease implicitly after 15 minutes. `tests/integration/postgresConcurrency.test.ts`
exercises each of these races against PostgreSQL.

## Reliability verification

For affected flows, verify:

- direct load, refresh, reconnect, sequence gap, and duplicate event handling;
- manual pick, queue/auto-pick, pause/resume, completion, and stale timer rejection;
- concurrent pick attempts and server error recovery;
- roster capacity and projection after every accepted pick; and
- drafted/owned player removal from waiver and free-agent availability.

Use `.agents/skills/draft-reliability-loop/SKILL.md` for the focused recurring workflow.
