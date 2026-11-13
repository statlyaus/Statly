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

**Held back until the epic ships.** The setup (#1278), draft exclusion (#1279), exclusive window
(#1280), shared roster swap (#1282), pinned waiver priority (#1281), bites (#1283) and the auto-bite
sweep (#1284) are built; trade rules and screens (#1285, #1286) are not, so a Bloodsucker league would still play much as a standard one. Choosing Bloodsucker is
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

- The Bloodsucker is left out of the draft order on every path that builds it and drafts nothing;
  the draft is sized for the other teams, and readiness blocks a player pool too small to fill the
  Bloodsucker's roster afterwards (#1279; see
  [Drafts and waivers](../domain/draft-and-waivers.md#snake-order-and-availability)).

- After the draft the Bloodsucker has an **exclusive free-agency window** (#1280). It opens when the
  draft completes and closes at the earlier of 24 hours later or 2 hours before round 1's first
  game (`computeBloodsuckerWindow`, `src/server/leagues/bloodsuckerWindow.ts`). An unpublished
  competition has no round 1 yet, so the window runs 24 hours.
  - Inside it the Bloodsucker adds and drops freely, and waiver-only holds do not apply to it.
  - Every other member's adds, drops, waiver claims and trade proposals, accepts and counters are
    refused with HTTP 409, code `BLOODSUCKER_WINDOW_OPEN`, the close time in the reason (Melbourne
    time) and `closesAt` in the response. Pending trades stay pending until it closes.
  - If under an hour would be left (the draft finishes within 3 hours of round 1), there is no
    window: nobody is refused and the auto-fill runs as the draft completes.
- When the window closes, each empty Bloodsucker roster spot is filled with the highest-Statly-Z
  unowned active player for the league's categories, ties to the lower player id
  (`closeBloodsuckerWindow`, `src/server/leagues/bloodsuckerAutoFill.ts`). The Bloodsucker also gets
  the default lineup for the first open round if it saved none, and one activity message is posted.
  The close writes one `BLOODSUCKER_WINDOW_CLOSED` competition audit row per completed draft, with
  the window, the rule version and the players added; a second run finds that row and adds nothing.
  Auto-filled roster rows carry `acquiredBy = BLOODSUCKER_AUTO_FILL`. The close runs from
  `/api/cron/bloodsucker` every 5 minutes (see
  [Drafts and waivers](../domain/draft-and-waivers.md#concurrent-writers)), so other members can add
  for up to 5 minutes after the close time before the fill has run; the fill takes whoever is left.
- The Bloodsucker is **pinned at waiver priority 1** (#1281, BR-15, BR-16). The order seeded at the
  end of the draft puts it at 1 and the drafters from 2 in the usual reverse-final-pick order. Its
  own wins never move it, so it wins every contested claim, including a second claim in the same
  run; any other winner goes last among positions 2 and up (`pinnedWaiverPriority.ts`,
  `src/server/waivers/`).

### Bloodsucker bites

A **bite** is a one-for-one roster swap the Bloodsucker earns by beating a team (#1283). Each right is
one `LeagueBite` row, unique per `(roundId, matchupId)`.

- **Grant (BR-17 to BR-19).** A right is granted inside the scoring transaction that writes a
  matchup's FINAL result, on the cron and the commissioner path alike
  (`syncBloodsuckerBites`, `src/server/leagues/bloodsuckerBiteGrant.ts`), only when the matchup is
  FINAL, in a `REGULAR` round, has the Bloodsucker in it, and `winnerMemberId` is the Bloodsucker.
  This is the same in both scoring modes. A draw, a fantasy bye, a `NO_MATCHUP` round or any
  `FINALS` matchup grants nothing. Re-running FINAL grants nothing new. The row records the winner
  and its score version (`grantedScoreVersion`, 1 on the first grant).
- **Deadline (BR-27, E4, E9).** The earlier of 48 hours after the grant or 2 hours before the next
  regular round's first lock, but never sooner than 24 hours after the grant. No next regular round
  (a grant in the last regular round, whose bite executes during finals) or an unknown start gives
  48 hours. A right never expires unused (BR-20); the deadline only starts the auto-bite.
- **Result changes (BR-33, E4, E5).** Bites follow the matchup's own status, not the round's.
  - A re-score that takes the win away cancels an open or waiting right
    (`cancelledBy = RESULT_CHANGED`).
  - An executed bite always stands; a re-score that changes its winner is recorded and grants
    nothing new (BR-36).
  - A re-score that turns a loss or draw into a Bloodsucker win grants a right, or reactivates the
    same row a re-score cancelled (new `grantedScoreVersion`, new deadline), so win-loss-win gives
    one bite. A right a commissioner cancelled is never reactivated.
  - A matchup that drops back from FINAL leaves its right as it is until it is FINAL again.
- **Audit (BR-38).** Every grant, cancellation and result change writes a `LeagueCompetitionAudit`
  row (`BITE_GRANTED` with reason `FINAL` or `GRANTED_ON_RESCORE`, `BITE_CANCELLED`,
  `BITE_RESULT_CHANGED`) with the actor (the commissioner who re-scored, or the system), the time,
  the matchup, the victim and the winner before and after.

- **Execution (BR-21, BR-24 to BR-26, E2, E5, E7, E8).** `POST /api/leagues/[id]/bites/[biteId]`
  with `{ takenPlayerId, returnedPlayerId }`, Bloodsucker only (`executeBite`,
  `src/server/leagues/bloodsuckerBites.ts`). The Bloodsucker takes any one player from the victim
  and returns any one of its own, whatever their slots or positions (E2 replaced the slot-group
  rule). Refusals, each HTTP 409 with its code unless noted:
  - `FORBIDDEN` (403): the caller is not the Bloodsucker.
  - `INVALID_INPUT` (400): the pair is missing.
  - `BITE_NOT_OPEN`: the bite is done, or changed since it was read.
  - `EARLIER_BITE_PENDING`: an older open bite comes first (E7, oldest grant first).
  - `BITE_SUSPENDED`: its matchup is not FINAL (E5).
  - `ROUND_IN_PROGRESS`: any round is between its first lock and its end (E8, no bites during lock
    periods; this replaces the per-player lock check for bites).
  - `ROSTER_CHANGED`: a player is no longer where the bite expects him.

  The swap runs through the shared roster-swap primitive under the League row lock, so it is atomic
  and a concurrent trade, waiver run or second execution gives no lost or double move. Moved roster
  rows carry `acquiredBy = BLOODSUCKER_BITE`. In each side's unlocked future lineups the incoming
  player takes the outgoing player's slot; scored and locked lineups never change. Pending trades
  with either player are invalidated and pending waiver claims that would drop either player are
  rejected, both with reason `PLAYER_BITTEN`. The bite records the taken player's slot in the
  victim's lineup for that round, a `BLOODSUCKER_BITE` team action is written, and after commit the
  ownership projection is refreshed and one activity message is posted: "The Bloodsucker beat
  {team} {score} and took {player}, sending back {player}." (BR-39, idempotent per bite version).

- **Victim freeze (BR-30, E7).** While any bite on a member is `OPEN` or `WAITING_LOCK`, that member's
  drops and trade proposals, acceptances and counters are refused with HTTP 409, code
  `BITE_PENDING`. The drop check runs under the League row lock. Waiver claims that drop a player
  stay pending, and settle at the first waiver run after the last bite is done.
- **Commissioner (BR-34, BR-35, E1).** `POST /api/leagues/[id]/bites/[biteId]/commissioner` with
  `{ action: 'cancel' | 'redo', reason, takenPlayerId?, returnedPlayerId? }`. The reason is required.
  A commissioner who is the Bloodsucker or the victim gets 403; another commissioner or the owner
  can act. `cancel` ends an open bite unused (`cancelledBy = COMMISSIONER`, never reactivated), or
  swaps an executed bite's players back as a new move. `redo` swaps an executed bite's players back
  and makes the new pair's swap, in one transaction. Nothing in history is rolled back (BR-36), and
  each writes `BITE_CANCELLED` or `BITE_REDONE` and posts an activity message. A commissioner who
  is the Bloodsucker or plays it in a round cannot recalculate or force-finalize that round: HTTP
  403, code `BLOODSUCKER_SELF_OVERRIDE`.
- Every execution audit row (`BITE_EXECUTED`) holds the actor, time, reason, matchup, both players
  and both rosters before and after.

- **Auto-bite (BR-27 to BR-29, E7, E8).** The `cron-bloodsucker` sweep runs every 5 minutes
  (`sweepDueBloodsuckerBites`, `src/server/leagues/bloodsuckerAutoBite.ts`). It picks up every `OPEN`
  bite past its deadline and every `WAITING_LOCK` bite, oldest grant first, each in its own
  transaction under the League row lock with a `version` re-check, so two sweeps at once execute a
  bite once.
  - The system takes the victim's highest-Statly-Z player and returns the Bloodsucker's lowest,
    ties to the lower player id (BR-28). Any rostered player is eligible (E2, E8). Statly Z is the
    draft room's score over all active players under the league's categories and directions; a
    player with no stat in any category ranks below every scored one.
  - The bite becomes `AUTO_EXECUTED` with no executing user, and stores `autoBiteRuleVersion` and
    `autoBiteSnapshotJson` (the time, the categories and both rosters with each player's Z, in rank
    order), so the pick can be replayed from stored data (NFR-2). The swap, lineups, invalidations
    and team action are the same as a manual bite. The audit row is `BITE_AUTO`, actor `system`,
    reason `DEADLINE` or `LOCK_RELEASED`; the activity message adds that the system made the pick.
  - A deadline that falls while a round is in progress (E8) turns the bite `WAITING_LOCK` once
    (audit `BITE_WAITING_LOCK`); it runs at the first sweep after the round ends. The Bloodsucker
    can still bite it manually once the round is over.
  - A bite whose matchup is not FINAL (E5), or behind an older unexecuted bite (E7), waits for a
    later sweep. Lock periods come from the stored round windows, so no live match timing is read;
    any other failure stops that league's sweep, the run answers 500, and the next run retries.

The Bloodsucker trade rules (#1285) and the screens (#1286) are later epic tickets and are not live
yet.

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
