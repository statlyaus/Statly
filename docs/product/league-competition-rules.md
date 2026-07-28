# League competition rules

This document records the intended competition contract. Implemented rules are owned by
`src/server/leagues`, `src/types/leagues.ts`, and the Prisma schema; a product change must update code,
tests, and this document together.

## Publication and scope

- Competition state is scoped to a league and `LeagueSeason`.
- Commissioners configure scoring, fixtures, lineup slots, locks, and finals before publication.
- Publication records the rules/version used to calculate the competition.
- Commissioner overrides are authorized at the server boundary and retained in the competition audit
  history.
- Missing official AFL fixture data is represented as pending state; the UI must not invent a reliable
  lock time.

## Category scoring

Each matchup aggregates the selected categories for active lineup players. Category direction decides
whether higher or lower wins; equal values are draws.

- `H2H_EACH_CATEGORY` adds each category win/loss/draw to standings.
- `H2H_MOST_CATEGORIES` awards the weekly matchup to the team winning more categories; equal category
  wins produce a matchup draw.

The default preset and valid category registry live in `src/types/fantasyCategories.ts`. See
[fantasy model](../domain/fantasy-model.md).

## Calendar and fixtures

- Fantasy rounds are distinct from AFL rounds and retain stable fantasy-round identities.
- An excluded AFL round can be a fantasy no-matchup week. It is not a win, loss, or draw.
- An AFL club bye does not cancel the fantasy matchup; affected players have no game.
- Automatic fixtures use deterministic round-robin generation. Odd-team leagues require a schedule
  that distributes fantasy byes fairly.
- Manual or commissioner fixture changes invalidate/recalculate affected future competition state and
  create an audit entry. Completed finals remain historical records.

## Lineups and locks

Active scoring slots are `DEF`, `MID`, `RUC`, `FWD`, and optional `UTIL`. `INTERCHANGE` and legacy
`BENCH` state do not score unless a persisted lineup/autosub transition makes the player active.

Lineups autosave through authenticated, league-scoped server commands and expose saving, saved,
unsaved, failed, and locked states. The latest saved lineup may carry to the next playable round under
the current competition rules.

The default lock policy is the official start of each player's AFL match. A configured round deadline
is the alternative. Locked players cannot be moved, removed, or replaced manually. Official fixture
updates can change an unlocked player's lock time; an unknown start time remains explicitly pending.

## Interchange autosubs

- Autosubs resolve from official participation evidence after the applicable AFL round is complete.
- Candidates are considered in persisted interchange order and must be eligible for the vacated slot.
- A non-playing candidate is skipped. If no candidate qualifies, the active slot scores zero.
- Each replacement contributes once; active/interchange state and the decision reason are persisted.
- Manual movement of an unlocked interchange player changes the later autosub candidates.

Autosub results must be deterministic and auditable from saved lineup state, fixture/participation
evidence, slot eligibility, and candidate order.

## Standings and finals

Standings preserve matchup and category wins/losses/draws plus totals used for deterministic ordering.
The selected standings tie-break category must be one of the league's enabled categories; its configured
direction applies to ordering. Remaining ties use stable competition data rather than browser order.

Supported finals sizes are 4, 6, and 8 teams. Seeding comes from finalized regular-season standings.
Finals progression is persisted and recalculated only through the competition service. A drawn final is
resolved by the higher qualifying seed unless the published rules explicitly change before play.

## Commissioner changes

Commissioner authority never bypasses authentication, league membership, or the published-rules
boundary. Consequential overrides record the actor, time, reason, prior/new values, and affected state.
The UI must explain recalculation or invalidation before confirmation.

## Required regression coverage

Changes to these rules need focused tests for normalization, category direction/draws, standings,
round-robin/byes, locks, autosubs, finals progression, authorization, and audit records. User-visible
changes also require direct-load and responsive browser verification.
