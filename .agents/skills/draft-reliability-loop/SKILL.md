---
name: draft-reliability-loop
description: Use for Statly draft-room picks, queue/watchlist, timers, reconnects, roster projection, waiver availability, and realtime regressions.
---

# Statly draft reliability

Use this skill for recurring draft behavior where persisted commands, realtime delivery, browser state,
and roster/waiver projections must converge.

## Read first

- `AGENTS.md`
- `docs/domain/draft-and-waivers.md`
- `docs/architecture/realtime.md`
- the affected services, transports, read models, and focused tests
- `git status --short --branch`

## Trace the failing path

Identify the owning boundary before editing:

1. authentication and league/draft authorization;
2. persisted command/repository transaction;
3. snake order, availability, capacity, or timer rule;
4. event/outbox publication and Socket.IO delivery;
5. snapshot, sequence, reconnect, or client reconciliation;
6. roster projection and waiver/free-agent availability; or
7. presentation/accessibility only.

Do not fix a browser symptom until the persisted state and event sequence are known.

## Invariants

- An accepted pick is persisted before it is broadcast.
- The actor, current turn, draft version, player availability, and roster capacity are checked together.
- Duplicate, concurrent, late, or stale commands cannot create a second ownership result.
- Queue/auto-pick uses the same command boundary as a manual pick.
- Timer jobs have idempotent identities and revalidate persisted draft state when they run.
- Refresh/reconnect loads a canonical snapshot and catches up sequenced events.
- Roster projection and waiver availability use canonical league-scoped ownership/player identity.
- Firestore or browser state never becomes draft authority through a fallback.

## Verification matrix

Choose the rows affected by the change and record concrete evidence:

- direct load and refresh;
- disconnect/reconnect, duplicate event, and sequence gap;
- manual pick and queue/auto-pick;
- two concurrent/stale pick attempts;
- pause/resume, late timer, completion, and commissioner intervention;
- roster capacity/projection; and
- drafted/owned player removal from waiver/free-agent views.

Use focused service/race tests for deterministic concurrency and browser/API verification for transport,
hydration, navigation, and accessible interaction. Run relevant lint/typecheck plus the broader tests
guarding the changed boundary.

## Protected state

Never use `prisma/dev.db`, `.env*`, `.Renviron`, secrets, service-account files, shared Firebase data,
or generated output for verification. Use safe fixtures, emulators, or an explicit disposable database.

Report the owning cause, change, checks, observed flow, and any state not reproduced. Do not claim the
draft path is reliable from a component test or successful socket emission alone.
