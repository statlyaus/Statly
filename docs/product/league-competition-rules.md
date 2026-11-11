# League competition rules

This document records the intended competition contract. Implemented rules are owned by
`src/server/leagues`, `src/types/leagues.ts`, and the Prisma schema; a product change must update code,
tests, and this document together.

## Publication and scope

- Competition state is scoped to a league and `LeagueSeason`.
- Commissioners configure scoring, fixtures, lineup slots, locks, and finals before publication.
- Publication records the rules/version used to calculate the competition.
- Publication happens once, from setup. Published rules are read-only: the server refuses another
  save or publish (409), so a live season's scores, standings, and lineups are never reset. Later
  changes go through commissioner overrides.
- Commissioner overrides are authorized at the server boundary and retained in the competition audit
  history.
- Missing official AFL fixture data is represented as pending state; the UI must not invent a reliable
  lock time. A round published before its AFL fixture was loaded stays pending until the hourly
  scoring job finds the fixture: it then takes the round's first bounce as its start time and becomes
  scheduled, the same as if the fixture had been there at publication, and is scored once it starts.
  Publication is not reopened.

## Category scoring

Each matchup aggregates the selected categories for active lineup players. Counting categories are
summed. Disposal efficiency is the team's ratio, total effective disposals / total disposals x 100,
never a sum or average of player percentages; a team with no disposals has no DE% ("–") and that
category is drawn. Time on ground % is display-only and cannot be selected as a scoring category
(both owner decisions, 2026-11-11). Category direction decides whether higher or lower wins; equal
values are draws. Screens follow the stored direction: the draft
room's category sort puts the best value first (lowest for `LOW_WINS`), and the matchup totals mark
each `LOW_WINS` category as "lower wins". Statly Z, the default draft and waiver ranking and the
auto-pick choice, sums each selected category's z-score against the available pool, negated for a
`LOW_WINS` category, so a higher value there lowers the score. Its breakdown shows the raw stat and
the signed z-score, so the entries add up to the total.

- `H2H_EACH_CATEGORY` adds each category win/loss/draw to standings.
- `H2H_MOST_CATEGORIES` awards the weekly matchup to the team winning more categories; equal category
  wins produce a matchup draw.

The default preset and valid category registry live in `src/types/fantasyCategories.ts`. See
[fantasy model](../domain/fantasy-model.md).

## Settings locks

Settings that shape a season stop being editable once the season they shape has started. The
league settings API refuses a changed value with 409, a `code`, and the reason; resending the
current value is accepted, so the commissioner can still save the rest of the form.

- **Scoring** (categories, category directions, scoring mode, lineup slots) locks when the
  competition is published. Publication writes `LeagueSettings.scoringSettingsLockedAt`; a league
  published before that write is locked from `competitionPublishedAt`. Code
  `SCORING_SETTINGS_LOCKED`.
- **Draft structure** (position limits and bench, so roster and bench size, draft type, pick order)
  locks once the league's draft leaves `SCHEDULED`. Code `DRAFT_STRUCTURE_LOCKED`.

The settings response carries `locks.scoring` and `locks.draftStructure` (the reason, or `null`),
and the commissioner settings page shows locked fields read-only with that reason. Owned by
`src/server/leagues/settingsLocks.ts`.

## Calendar and fixtures

- Fantasy rounds are distinct from AFL rounds and retain stable fantasy-round identities.
- An excluded AFL round can be a fantasy no-matchup week. It is not a win, loss, or draw.
- An AFL club bye does not cancel the fantasy matchup; affected players have no game.
- Automatic fixtures use deterministic round-robin generation. Odd-team leagues require a schedule
  that distributes fantasy byes fairly.
- Manual or commissioner fixture changes invalidate/recalculate affected future competition state and
  create an audit entry. Completed finals remain historical records.
- A league plays one AFL season, its active `LeagueSeason.year`. A league created (or drafting)
  after the AFL Grand Final defaults to next season; the Grand Final is taken as the last Saturday
  of September, Melbourne time, a fixed rule that does not wait for the finals fixture to be
  loaded. The commissioner can change
  the season only while the competition is in `SETUP` (`PUT /api/leagues/[id]/season-state`, 409
  otherwise), because publication builds fixtures and round timings from it. Owned by
  `src/server/leagues/seasonYear.ts`.

## Lineups and locks

Active scoring slots are `DEF`, `MID`, `RUC`, `FWD`, and optional `UTIL`. `INTERCHANGE` and legacy
`BENCH` state do not score unless a persisted lineup/autosub transition makes the player active.

Lineups autosave through authenticated, league-scoped server commands and expose saving, saved,
unsaved, failed, and locked states. The latest saved lineup may carry to the next playable round under
the current competition rules.

The default lock policy is the official start of each player's AFL match. The alternative locks the
whole round at Thursday 7:00 pm Sydney time (`Australia/Sydney`), whatever the league's timezone, so
the lock always falls before the Thursday night game; a configured round deadline overrides it. A
league has one configurable timezone, `LeagueSettings.timeZone` (default `UTC`), and it is for
display only. Competition rules carry no timezone; a `leagueTimeZone` key left in older stored rules
is ignored. Locked players cannot be moved, removed, or replaced manually. Official fixture
updates can change an unlocked player's lock time; an unknown start time remains explicitly pending.

A player whose AFL game has started in the round in progress cannot leave his roster until the round
ends (owner decision 2026-11-08), whatever the lock policy: a free-agent drop answers 409, a waiver
claim that would drop him fails at settlement, and a trade that includes him is refused at proposal,
counter, acceptance and commissioner approval (409, code `PLAYER_LOCKED`); a vetoable trade whose
review ends mid-round waits and completes at the first run after the round ends. The check reads the
official fixture start times (the source lineup locks use), not a lineup row's stamped `lockedAt`; a
player whose game start is unknown is held once the round has started, and unreadable match timing
refuses the move (503) rather than guessing. A player who does leave a roster is removed from that
member's unlocked lineup rows from the round in progress onward; scored rounds keep him. Owned by
`src/server/leagues/playerMoveLock.ts`.

## Interchange autosubs

- Autosubs resolve from official participation evidence after the applicable AFL round is complete.
  A player did not play when his stat row in a final match shows zero minutes, or when his club has
  a confirmed bye (recorded as a club bye). The provider writes rows only for players who took the
  field, so a player his club did not select has no row: he also did not play once his club's match
  in that AFL round is final and that same match has stat rows for his club that all map to Statly
  players (the club's team sheet is ingested and identity-mapped; an unmapped row may be the player
  himself under an unreviewed provider id). In every other case a lineup player without a row keeps
  the round waiting; it is never scored as a zero.
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
