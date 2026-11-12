# Drafts and waivers

## Authority

The draft is a server-authoritative command system. Prisma owns draft configuration, order, picks,
queue/watchlist state, event/outbox records, and canonical roster projection. Socket.IO publishes
persisted results; it does not decide or store picks independently.

Every draft belongs to a league. A commissioner creates and schedules it from the league's Draft tab
(`/leagues/<id>?tab=draft`); `POST /api/drafts` refuses a request without a `leagueId` (400), so no
draft creates its own league. Only the development tool `/api/create-test-draft` does that. The
`/drafts` hub lists the drafts of the leagues the viewer has an active team in
(`src/server/draft/readModels/memberLeagueDraftsReadModel.ts`, also behind `GET /api/drafts/list`),
each linking to its league's Draft tab. `/drafts/create` and `/drafts/settings` redirect to `/drafts`.

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

The pick that completes the draft writes every `LeagueRosterPlayer` row and seeds `WaiverPriority`
(`RosterProjectionService.projectDraftInTx`) in that same transaction. If the projection fails, the
final pick and the `COMPLETED` status roll back together, the draft stays `LIVE`, and the pick can be
retried. Only the Firestore waiver availability projection runs after the commit, and its failure is
logged without changing the outcome.

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
command path as a manual pick; it must not write a separate roster shortcut. Drafting from the
watchlist takes the same two steps as the player grid's Select: the first press arms the pick and the
second confirms it. Shared room snapshots,
state broadcasts, and Pub/Sub events never contain queue contents or queue size. The authenticated
actor-scoped queue and watchlist APIs are the only browser hydration boundaries for that private
strategy. `DraftPrivateStateService` resolves the active draft member from the authenticated user;
transport payloads cannot select a member. Legacy `memberId` input is tolerated only for migration and
is ignored. Private responses are non-cacheable, and Prisma remains the only authority—local or
in-memory shadow stores must not restore stale strategy state.

## Scheduling

Draft start times are stored as instants with an explicit league timezone for display and scheduling.
The lobby-open and draft-start BullMQ jobs are keyed by draft id and carry it with the league id; the
worker acts on that draft only after checking it still belongs to the league and is `SCHEDULED`.
Rescheduling or cancelling replaces only that draft's jobs, never another draft's in the same league.
A start job without a draft id (enqueued before this keying) is refused and logged rather than
resolved to "the league's draft"; rescheduling the draft enqueues a keyed job.
Draft structure (position limits and bench, draft type, pick order) can change only while the draft
is `SCHEDULED`; the league settings API refuses a change after that with 409
`DRAFT_STRUCTURE_LOCKED`. See [settings locks](../product/league-competition-rules.md#settings-locks).
Clock commands commit Prisma timing state and an outbox event without depending on Redis. Outbox
delivery and the worker's startup/periodic repair loop both reconcile the latest persisted LIVE clock
into an immutable, revision-addressed BullMQ job. They never schedule from stale event data. Missing
jobs are recreated, while older revision jobs may wake but must fail the worker's persisted-version
guard. Cron may wake reconciliation, but is not a second source of truth for turn expiry.

Pause, resume, commissioner intervention, and completion must cancel or replace stale timers. A late
timer job validates the current draft version and turn before doing anything.

### Who manages the draft

Start, pause, resume and forced auto-pick belong to the league's managers: the owner and
co-commissioners, while each is an active member (`leagueManagerUserIds` in
`src/server/leagues/activeMembership.ts`, the same rule as `getLeagueMembershipAccess().canManage`).
The draft order does not grant or remove these rights, so a commissioner who is not in the order, such
as the Bloodsucker (#1279), keeps the controls and still never picks. The draft aggregate carries
`managerUserIds` for the server check, and the room snapshot and `GET /api/drafts/[id]` carry it so
the room shows the controls to the same users.

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
syncing, local zero renders as finalizing, and neither state initiates an auto-pick. While the room's
connection is not `connected` or a resync is pending, the board may be out of date: the room treats the
clock anchors as missing, so the clock renders as syncing rather than counting, and it disables Select
and Draft with the reason "Reconnecting. Picks are paused until the board is up to date." The server
clock is unaffected and keeps running. Pause freezes the
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
rebuildable from it. Each league's Waivers tab reads a member's claims, FAAB balance and activity feed
from Prisma. Its player list leaves out only rostered players: a waiver-only player (a pending claim,
or a drop since the last run or still inside its waiver period; see `docs/domain/fantasy-model.md`)
is listed and claimable there, because free-agent Add refuses him. Free-agent Add also refuses (409)
a player whose AFL game has started in the round in progress, until the round ends, and refuses (503)
when match timing cannot be read (see [league competition rules](../product/league-competition-rules.md)). `/waivers`, linked from the main navigation and the dashboard, redirects to that tab for
the requested league (`?league=`) or the viewer's most recently joined one, and to the dashboard when
the viewer has no league. `/rosters` does the same for the league's Roster tab; it no longer reads
Firestore free agents or offers its own claim buttons.
Processed claims (won or lost) are published as `WAIVER_SUCCESSFUL` and `WAIVER_FAILED` system messages
in the league's social Activity channel; submitted and cancelled claims, and their bids, stay private.

Waiver state is season-scoped (2026-11-08). Claims and drops (`TeamAction`) and each member's priority
and FAAB balance (`WaiverPriority`, one row per member per season) carry the season they were created
in. Every waiver read and write is filtered to the league's active season, so a claim from an earlier
season never shows, settles or holds a player, and balances start again in a new season.

Claims validate membership, league settings, player availability, optional drop ownership, roster
capacity, and priority/FAAB rules at the server boundary. Roster capacity is the league's
`rosterSize` plus `benchSize`, the same total the draft fills (`src/server/rosters/rosterCapacity.ts`,
shared with trades), so a team with a full drafted roster can still claim with a drop. Only an active
member can submit a claim, and a pending claim whose member has since been removed from the league is
rejected at settlement ("Team no longer active"), which releases its bid. Submit refuses, before
storing the claim or reserving a bid: a drop player who is not on the member's roster in that league
(409), a claim that would not fit the roster without a drop (409), a second pending claim this season
by the same member for the same player (409), and a bid that is not a whole number (400). Roster fit
uses the same `checkClaimFitsRoster` helper settlement uses
(`src/server/waivers/WaiverProcessingService.ts`), and settlement checks again because the roster can
change while a claim waits. At settlement a claim whose drop player's AFL game has started in the
round in progress fails ("<name>'s game has started; he can be moved after the round ends."), with no
debit and no roster change; submit does not refuse it, because the claim may settle after the round
ends. If match timing cannot be read the run stops and the claim stays pending. A settled drop also
removes the player from the member's unlocked lineups from the round in progress onward (see
[league competition rules](../product/league-competition-rules.md)). The duplicate check runs after the submit locks the member's waiver
priority row, so two identical submits at once store one claim. Processing must be deterministic and
safe to retry; failures do not partially assign the same player to multiple teams.
The submit route returns the claim it stored (id, canonical player, drop player, bid). The Waivers tab
waits for it: it confirms only that stored claim, and on a refusal keeps the bid and shows the server's
reason. FAAB Remaining shows a loading state until the first waiver snapshot answers, "Not used" in a
league with no budget, and "Unavailable" when a FAAB league's balance (or, after a failed first load,
the league's settings) did not load. Bids are refused while the balance is loading or unavailable,
rather than standing in the league budget.

Waiver settings live in Prisma's `LeagueSettings`. A league uses FAAB when `faabBudget` is set (each
member's budget); otherwise a `ROLLING` league uses priority order. Commissioners set or clear the
budget through the league settings API (`waiver.faabBudget`: a whole number of at least 1, or
`null`). The minimum bid is 1 and the waiver period is 24 hours. The budget is locked once the active season has any waiver
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
claims, so the time holds through daylight saving. Leagues are processed one at a time; a league
whose run throws keeps its claims pending and the others still run, but the route then answers
HTTP 500 with the failed league ids and logs an error, so the scheduler records a failed run. Only one waiver processing run per league proceeds at a
time: it holds a lease in `League.waiverRunStartedAt`, and a second run is refused as already running
(HTTP 409) rather than debiting and awarding the same claims again. A run that dies releases the
lease implicitly after 15 minutes. Each claim settles in one transaction: it is taken only while still
`PENDING`, then the roster check, the FAAB debit, the roster change, the pending-bid release and the
priority advance commit together. The roster check comes before the debit, so a claim that cannot be
awarded is never charged. A run that dies part way leaves the claim untouched for the next run to
settle once, and an unexpected error ends the run rather than settling later claims ahead of it.
Firestore projections and activity are written after the commit and cannot change an outcome.
`tests/integration/postgresConcurrency.test.ts` exercises each of these races, and a run that dies
after the debit, against PostgreSQL.

## Reliability verification

For affected flows, verify:

- direct load, refresh, reconnect, sequence gap, and duplicate event handling;
- manual pick, queue/auto-pick, pause/resume, completion, and stale timer rejection;
- concurrent pick attempts and server error recovery;
- roster capacity and projection after every accepted pick; and
- drafted/owned player removal from waiver and free-agent availability.

Use `.agents/skills/draft-reliability-loop/SKILL.md` for the focused recurring workflow.
