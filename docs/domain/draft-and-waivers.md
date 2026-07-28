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
command path as a manual pick; it must not write a separate roster shortcut.

## Scheduling

Draft start times are stored as instants with an explicit league timezone for display and scheduling.
BullMQ delayed jobs use stable IDs and persisted draft scheduling/version data. Startup reconciliation
repairs missing or stale jobs from canonical state. Cron may enqueue reconciliation, but is not a
second source of truth for turn expiry.

Pause, resume, commissioner intervention, and completion must cancel or replace stale timers. A late
timer job validates the current draft version and turn before doing anything.

## Reconnect and recovery

On direct load, refresh, or reconnect, the client loads a persisted read model, joins the authorized
room, and applies sequenced events after that snapshot. Gaps trigger resynchronization; duplicates are
ignored. Current turn, drafted players, roster projection, queue state, and readiness must converge
without relying on the previously open tab.

## Waivers

Waiver ownership is league-scoped and derived from canonical roster/player identity. A draft pick or
roster mutation must update the same ownership boundary used to calculate availability. Firestore may
hold a compatibility projection, but relational state remains authoritative and projections must be
rebuildable from it.

Claims validate membership, league settings, player availability, optional drop ownership, roster
capacity, and priority/FAAB rules at the server boundary. Processing must be deterministic and safe to
retry; failures do not partially assign the same player to multiple teams.

## Reliability verification

For affected flows, verify:

- direct load, refresh, reconnect, sequence gap, and duplicate event handling;
- manual pick, queue/auto-pick, pause/resume, completion, and stale timer rejection;
- concurrent pick attempts and server error recovery;
- roster capacity and projection after every accepted pick; and
- drafted/owned player removal from waiver and free-agent availability.

Use `.agents/skills/draft-reliability-loop/SKILL.md` for the focused recurring workflow.
