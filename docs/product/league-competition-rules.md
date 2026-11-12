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
category is drawn. A season DE% (the standings tie-break and the team category profile) is season
effective disposals / season disposals, never a sum or mean of round percentages; a team with no
season disposals has none and ranks below every team that has one. Points for adds up the counting
categories only, without DE%. Time on ground % is display-only and cannot be selected as a scoring category
(both owner decisions, 2026-11-11). Category direction decides whether higher or lower wins; equal
values are draws. Screens follow the stored direction: the draft
room's category sort puts the best value first (lowest for `LOW_WINS`), and the matchup totals mark
each `LOW_WINS` category as "lower wins". Statly Z, the default draft and waiver ranking and the
auto-pick choice, sums each selected category's z-score against the available pool, negated for a
`LOW_WINS` category, so a higher value there lowers the score. Its breakdown shows the raw stat and
the signed z-score, so the entries add up to the total.

A `LOW_WINS` counting category is summed like any other: an empty lineup slot or a starter who did not
play adds 0, which helps that team in a lower-wins category. This is the accepted rule, not a defect
(owner decision 2026-11-11, closes process-map finding roster-scoring-16).

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
- **Draft structure** (position limits and bench, so roster and bench size, draft type, pick order,
  the league format and the Bloodsucker member) locks once the league's draft has started: it has
  left `SCHEDULED`, has a start time, has opened a live room, or has any pick. Picks count on their
  own because rescheduling a LIVE draft puts it back to `SCHEDULED` with its picks kept. The same
  test (`hasDraftStarted`, `src/server/leagues/draftStarted.ts`) closes member removal and joining.
  Code `DRAFT_STRUCTURE_LOCKED`.

A save re-checks both locks inside its write transaction, under the League row lock and the
settings row lock. The draft start takes the same League row lock, so a save racing a draft start
either commits first (the start then reads the new values) or sees the started draft and is refused.

The settings response carries `locks.scoring` and `locks.draftStructure` (the reason, or `null`),
and the commissioner settings page shows locked fields read-only with that reason. Owned by
`src/server/leagues/settingsLocks.ts`.

## League formats

A league's format is `STANDARD` (the default), `BLOODSUCKER` (epic #1275) or `NO_LOSERS` (epic #1290).
A league has exactly one format. It is stored in
`LeagueSettings.leagueFormat`, not in the competition rules, and is independent of scoring mode and
category selection: every combination is valid.

In a **Bloodsucker** league one member, the Bloodsucker, skips the draft and takes a player from each
team it beats.

**Held back until the epic ships.** Only the setup (#1278) and the shared roster swap (#1282) are
built; bites, deadlines, protections, the exclusive window and waiver priority (#1279-#1281,
#1283-#1286) are not, so a Bloodsucker league would play as a standard one. Choosing Bloodsucker is
therefore off unless `NEXT_PUBLIC_STATLY_ENABLE_BLOODSUCKER=true` (`isBloodsuckerSelectable`,
`src/lib/leagueFormatOptions.ts`). With the flag off the create page and settings do not offer it,
and create and settings refuse it with code `BLOODSUCKER_UNAVAILABLE`. A league already stored as
`BLOODSUCKER` keeps its format, sees the option, and can still change its Bloodsucker. Turn the flag
on (and remove it) when the epic ships.

The setup rules (implemented in #1278, owned by `src/server/leagues/leagueFormat.ts`):

- The commissioner chooses the Bloodsucker (`LeagueSettings.bloodsuckerMemberId`) from the active
  members in league settings. A league is created with the format only; the member is chosen once
  managers have joined.
- Waivers must be `ROLLING` with no FAAB budget. Create and settings refuse anything else with code
  `BLOODSUCKER_REQUIRES_ROLLING`; a Bloodsucker league created without a waiver rule gets rolling.
- The format and the Bloodsucker lock with the draft structure (see [Settings locks](#settings-locks)).
- If the Bloodsucker leaves or is removed, the setting is cleared and the change audited. A
  Bloodsucker who is no longer active also counts as unset everywhere it is read.
- The draft cannot start while no Bloodsucker is set (readiness shows "Choose a Bloodsucker.") or
  while the league has fewer than 8 teams; 12 is recommended.
- Publication refuses a Bloodsucker league with no Bloodsucker (code `BLOODSUCKER_MISSING`).
- Every format or Bloodsucker change writes a `LEAGUE_FORMAT_CHANGED` competition audit row with the
  actor, the before and after values, and the reason.

Draft exclusion, the exclusive free-agency window, pinned waiver priority and bites are later epic
tickets and are not live yet.

In a **No Losers** league a player's stats count only as far as his AFL club's result allows. The
setup rules (implemented in #1291, owned by `src/server/leagues/leagueFormat.ts`):

- No Losers works with either scoring mode and any category selection and directions. It has no
  settings of its own, no Bloodsucker (choosing it clears one), and no setup rules beyond a standard
  league's: any waiver rule and FAAB, the standard team counts, and no extra readiness blockers.
- The format locks with the draft structure (see [Settings locks](#settings-locks)). Because No Losers
  changes scoring, moving into or out of it also locks with scoring when the competition is published
  (409 `SCORING_SETTINGS_LOCKED`), even before the draft starts. Every change is audited as
  `LEAGUE_FORMAT_CHANGED`, as above.
- League creation and settings explain the rule wherever the format is chosen (text in
  `src/lib/leagueFormatOptions.ts`): a win counts in full; a draw or a loss by 1 to 5 points counts
  half; a loss by 6 or more counts nothing. It applies to every category, low-wins included, so a
  losing player's clangers, frees against and turnovers are zeroed too.

Scoring (#1294; the rule is `src/server/leagues/noLosersResultRule.ts`, its wiring
`src/server/leagues/noLosersScoring.ts`):

- Each counted player's stats are multiplied by his club's stored result in the game his stat row
  belongs to: win 1, draw or loss by 1 to 5 points 0.5, loss by 6 or more 0, abandoned 1. Bench and
  interchange stay uncounted, a player with no stat row is unavailable as in any league, and
  autosubs never replace a starter because his club lost.
- The join uses the Statly match id (`matchUid`, e.g. `2025-R18-GEE-HAW`) that stat rows and
  `AflMatchResult` both carry, compared by season, round and the two club abbreviations in either
  order, since the stats feed and Footywire's match page may disagree on home and away (#1315); the
  stat row's club abbreviation then picks its side. The provider's club spelling is never compared
  with the result's club names.
- Footywire posts stats and results only for finished games, so there is no in-game scoreline. While
  a round is live, a player whose game has a stored result shows his multiplier and counted stats;
  one whose finished game has no stored result yet shows "Result pending" with raw stats, and the
  team total stays provisional.
- A round cannot become FINAL while a finished game has no stored result or a counted player cannot
  be joined to his game's result. It stays LIVE, the matchup shows "Waiting on the result of {home}
  v {away}", a commissioner finalize is refused (`AFL_RESULTS_MISSING`), and the scheduled job
  reports the stalled round as `afl-results-missing` with the same lines.
- Season figures (`pointsFor`, category season totals, season DE%) use counted totals; raw totals
  remain on player pages.
- Standard and Bloodsucker leagues score exactly as before.

Screens (#1296; read-model helpers in `src/server/leagues/noLosersScreens.ts`, components in
`src/components/league/noLosers/`). Every state has words as well as colour, and works at 375 px:

- Each matchup box-score row shows a letter badge and text for the player's club result: "Won by
  12", "Half: drew", "Half: lost by 4", "Zeroed: lost by 20", "Abandoned: counted", "Result
  pending" or "Result unavailable". A halved or zeroed row keeps the raw line: the counted value with
  "of {raw}" under it, or the raw value struck through when zeroed. Screen readers hear the full
  sentence ("Zeroed: club lost by 20, not counted").
- A FINAL matchup is shown from its stored `LeagueMatchupPlayerScore` rows, so it always shows what
  was scored even if a result is later corrected; a live one from the stored results so far.
- The matchup page has an AFL results strip: every game of the round with its stored score and
  winner in words ("GEE won by 20"), "Result pending", "Playing · result at full time" (no in-game
  score exists) or the start time, and how many of each manager's counted (on-field) players are on
  each club.
- My Team squad rows and the free-agent list show the club's season win-loss-draw record from
  stored results (abandoned games left out), and free agents also show the league's current or next
  round's opponent. Facts only, no win probability.

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

The same rule keeps a free agent whose AFL game has started in the round in progress from joining a
roster until the round ends (owner decision 2026-11-11): free-agent Add
(`POST /api/leagues/[id]/roster/add`, through `src/server/rosters/freeAgentAdd.ts`) answers 409 with
code `PLAYER_LOCKED` ("<name>'s game has started; he can be picked up after the round ends."), and 503
with code `TIMING_UNAVAILABLE` when match timing cannot be read.

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

A round becomes `FINAL` only when every AFL match in it is final and every matchup with two teams was
scored. A commissioner's finalize request on a round with an AFL match not yet final is refused
(`AFL_MATCHES_NOT_FINAL`, HTTP 409). A `FINAL` round may still be recalculated, for example after a stat
correction, but every change to a `FINAL` matchup's stored result (status, winner, category
wins/draws, each side's category rows and points for) writes one `FINAL_ROUND_RESCORED` competition
audit entry per changed matchup, in the same transaction as the new scores. Its payload holds the
season, round, matchup, trigger (`manual` with the commissioner as actor, `cron`, or
`result-correction`), and the result before and after. A recalculation that reproduces the stored
result writes none. Standings are recomputed from the corrected round as usual (owner decision
2026-11-11, process-map finding roster-scoring-11).

In a No Losers league an AFL result can be corrected after the round is `FINAL` (epic #1290 BR-23,
#1295). The ingest supersedes the stored result row with its reason. The hourly scoring job then
finds every round whose per-player scores (`LeagueMatchupPlayerScore`) still name a superseded result
and recalculates it the same way, with no actor (system). Each changed matchup's audit entry has
trigger `result-correction` and lists `resultCorrections` (superseded result id, the id that replaced
it, the reason). A matchup winner may change; standings follow. After the re-score the round names
only current results, so it is not picked again, and an unchanged re-ingest triggers nothing. Only
the league's active season and current fixture version are re-scored. A round the recalculation
cannot re-score yet (its stats are unavailable) is reported as pending in the scoring job's response
and summary, not as re-scored, and is tried again on the next run. A FINAL round is never demoted:
if a corrected result can no longer be joined to its game, the recalculation is refused
(`FINAL_ROUND_RESULTS_UNJOINED`), the stored FINAL scores stay, and the scoring job logs the failure
(#1315).

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
