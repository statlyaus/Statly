# Fantasy model

## Category head-to-head

Statly leagues compare the aggregate statistics of active lineup players in a weekly head-to-head
matchup. Each league selects categories and a direction for each category (`HIGH_WINS` or `LOW_WINS`).
Bench and interchange players do not contribute until a valid lineup or autosub transition makes them
active.

The two supported scoring modes are defined in `src/types/leagues.ts` and implemented by
`src/server/leagues`:

- `H2H_EACH_CATEGORY`: category wins, losses, and draws are added directly to the standings.
- `H2H_MOST_CATEGORIES`: the team winning more categories receives one matchup win; equal category
  wins produce a matchup draw.

The default real-data preset is defined in `src/types/fantasyCategories.ts`:

1. goals
2. tackles
3. inside 50s
4. intercepts
5. contested marks
6. rebound 50s
7. contested possessions
8. effective disposals
9. score involvements

The supported category registry, labels, formats, and aliases live in that same source file. Do not
duplicate the registry in documentation or UI-specific constants. League scoring maps each category to
the stats field the ETL stores through `src/server/leagues/liveStatsAdapter.ts`; every category has an
ETL source (see `etl/README.md`).

## League and season scope

A league is the tenancy boundary for membership, roles, teams, drafts, rosters, fixtures, trades, and
waivers. Season-dependent features also carry a `LeagueSeason` identity. Every protected query, write,
cache key, room, or event must retain the league and applicable season scope.

Every league has an active season (`League.activeSeasonId`): league creation and the development
test draft set one in the transaction that creates the league
(`startLeagueSeason`), and the 2026-11-08 season-scope migration gave one to every league that
lacked it. A draft's final pick needs it: the roster projection seeds waiver priority in that season. Season-scoped rows carry
`seasonId`, a foreign key to `LeagueSeason` that cascades on delete:

- social and trade rows, since they were added;
- `LeagueCompetitionRound` (nullable);
- since 2026-11-08: `LeagueLineup` (and its players and autosubs through the lineup),
  `LeagueMatchupScore`, `LeagueStanding`, `WaiverPriority` and `TeamAction` (waiver claims and drops).
  Existing rows were backfilled to the league's active season, and all five columns are required. Keys:
  one lineup per member, season and round; one ladder row and one waiver priority row per member and
  season.

Season-scoped services take the season from `League.activeSeasonId` through
`src/server/leagues/activeSeason.ts`, which throws `ActiveSeasonMissingError` instead of falling back
to league-wide rows. Waiver queries use the `inActiveSeason(leagueId)` where-filter from the same file
(the row's season is the league's active season), so a write needs no extra read. Republishing a competition clears only the active season's lineups, matchup
scores and standings, and standings are rebuilt from that season's final scores only.

Not yet season-scoped, pending a season-rollover decision: `LeagueMatchup` (only through its
competition round), `LeagueRosterPlayer` and `Draft`.

Firebase identity establishes who the user is. Prisma membership and role data decide what that user
may see or change in a league. Owner, commissioner, member, roster owner, draft participant, and waiver
claimant permissions are domain decisions, not client navigation decisions.

Every league is created in Prisma, so a league with no Prisma row is legacy data and is treated as not
found. The user league list (`GET /api/leagues/user/[userId]`) and the league draft read
(`GET /api/leagues/[id]/draft`) answer from Prisma only and never read Firestore league documents.

Membership changes run as Prisma commands in `src/server/leagues/memberCommands.ts`, which check the
persisted owner and active membership in the same transaction as the write. The owner may remove a
manager, and a manager may leave, only until the draft starts or the competition is published,
whichever comes first; removal renumbers the remaining draft slots and rebuilds the draft order.
After either, rosters, fixtures, and standings depend on every team, so managers are not removed: the
command refuses with 409, code `draft-started` or `competition-published`, and the commissioner page
shows the same reason (`memberRemovalBlock`). Ownership transfer makes the previous owner a manager.
Firestore member documents are written afterwards as a compatibility projection. The member list,
member update and team settings routes treat a league with no Prisma row as not found; they never
decide existence, membership or a write from Firestore.

## League creation defaults

The normalization boundary in `src/server/leagues/createLeagueContract.ts` supplies defaults when a
client omits optional values:

- 12 maximum teams
- private visibility
- UTC timezone
- automatic fixture generation
- `H2H_EACH_CATEGORY` scoring
- the `STANDARD` league format; a `BLOODSUCKER` league is independent of scoring mode, needs rolling
  waivers with no FAAB (it defaults to rolling), and has its Bloodsucker member chosen later in
  settings; a `NO_LOSERS` league is independent of scoring mode and has no setup rules of its own
  (see [league formats](../product/league-competition-rules.md#league-formats))
- the real-data nine-category preset
- normalized active lineup slots and category directions
- the AFL season of the draft date, or of the creation date when there is none: next season once
  that year's Grand Final has passed (see
  [league competition rules](../product/league-competition-rules.md#calendar-and-fixtures))

Clients may expose additional choices, but they must submit values supported by the server contract.

## Matchup calculation

For each category, active player totals are aggregated for both teams and compared in the configured
direction. The result records home/away totals, the category winner or draw, category win counts, and
the overall matchup result. Each category's aggregation rule lives on its definition in
`src/types/fantasyCategories.ts` (`aggregation`, `sum` by default) and is applied in one place,
`aggregateLineupCategoryTotals` in `src/server/leagues/matchupScoringEngine.ts`.

Disposal efficiency is a ratio, not a sum or an average of player percentages (owner decision,
2026-11-11): team DE% = total effective disposals / total disposals x 100 across the team's counted
players. A player with no disposals adds 0 to both totals. A team with no disposals has no DE%: its
value is stored as `null`, shown as "–", and the category is a draw, since neither side can be
compared. The player totals therefore carry `disposals` (the ETL's `disposals`, or kicks plus
handballs when both are reported) even though it is not a category.

A season DE% follows the same rule: season effective disposals / season disposals x 100, never a
sum or mean of round percentages. Each round's stored category row for a ratio category
(`LeagueMatchupScore.categoriesJson`) keeps both sides' numerator and denominator as `homeRatio` and
`awayRatio` (`{ numerator, denominator }`), so no schema change is needed. The standings tie-break
total and the team category profile pool these (`aggregateFinalizedCategoryTotals` in
`matchupReadModel.ts`); the profile's league average for DE% is the league's pooled ratio. A round
with no disposals adds 0 to both sides and is not counted as 0%. A team with no season disposals has
no season DE%: it ranks below every team with a value, in the tie-break and the profile, whatever the
direction. A round stored before the parts were kept adds nothing to the season ratio until it is
recalculated.

In a No Losers league each counted player's totals are multiplied by his club result before
aggregation (see [league formats](../product/league-competition-rules.md#league-formats)); ratio
inputs are multiplied too, so a halved player's disposals count at half weight in DE%.
`LeagueMatchupScore.categoriesJson` stays team totals only. The per-player breakdown is its own
table, `LeagueMatchupPlayerScore` (league- and season-scoped, cascading with the matchup): one row per
counted lineup player per scored side, with the outcome (`RESULT`, `NO_STAT_ROW`, `RESULT_PENDING`
or `UNRESOLVED`), club result, signed margin, multiplier, the `AflMatchResult` row id used, raw and
counted totals, and the result rule version. A row was chosen over a versioned block inside the
score so each result row id is a real foreign key (a result row cannot be deleted while a score
uses it) and a result correction can find the scores it touches: the hourly scoring job re-scores
any round whose rows name a superseded result (#1295). Rows are replaced on
every recalculation of the matchup, and aggregating a side's counted totals re-derives its stored
categories. Standard and Bloodsucker leagues write no rows. The matchup read model shows a FINAL
No Losers matchup's player rows from these stored rows (counted values, raw values where halved or
zeroed, and the club result), never from a recomputation (#1296).

`pointsFor` (and each player's `total` on the matchup card) adds up the count categories only. A
ratio category is a rate, so DE% is left out. Neither value orders the standings or is shown on a
screen; they are kept on score and standing rows and in the matchup API.

Time on ground % is read and shown for players but is not a scoring category (owner decision,
2026-11-11): it is marked `selectable: false`, and league creation and the settings save refuse it.

A stat the provider did not report is unavailable, never a real 0 (owner decision, 2026-11-09);
a reported 0 stays 0. `src/server/leagues/liveStatsAdapter.ts` leaves a missing, null or non-numeric
value out of a player's totals and lists it in the row's `unreportedCategories`. A lineup player who
played but whose row lacks a stat one of the league's scoring categories is computed from (for DE%,
effective disposals and disposals) counts as missing, exactly like a
player with no row: the round stays unscored, the player is in `missingPlayerIds`, and the stalled-round
alert reports him once the grace period passes. Players confirmed as not playing (zero minutes in a
final match, a club bye, or left out of a mapped team sheet) are not affected.

A player with no disposals is the one exception. He has no efficiency and no effective disposals to
report, so when the row reports 0 disposals (or 0 kicks and 0 handballs) those missing values are
empty, not missing: he adds 0 to both sides of his team's DE% and does not hold the round.

Standings retain both matchup and category records. `H2H_EACH_CATEGORY` ranks by the accumulated
category result; `H2H_MOST_CATEGORIES` ranks by matchup wins/losses/draws while retaining category
totals for deterministic secondary ordering and display.

## Fixtures, lineups, and finals

League settings own the fantasy schedule, selected AFL window, lock policy, lineup slots, fixture
generation, and finals format. A fantasy bye/no-matchup week is different from an AFL club bye. Player
locks follow the configured policy and must not be inferred from browser time alone. The Thursday round
lock is always 7:00 pm `Australia/Sydney`; `LeagueSettings.timeZone`, the league's only timezone
setting, is for display.

Autosubs are resolved from saved lineup state and participation evidence. They must be deterministic,
persisted, and auditable; a player contributes at most once. Commissioner changes to published
competition state require an audit record and recalculation of affected future state.

The full product contract is in [league competition rules](../product/league-competition-rules.md).

## Transactions

Free-agent adds, waiver claims, and trade proposals, counters, and acceptances open only once the
league's draft is `COMPLETED`. Every transaction route asks one server guard,
`src/server/leagues/transactionWindow.ts`, before it writes; until then the request is refused with
HTTP 409, code `DRAFT_NOT_COMPLETE`, and the reason "Adds, waiver claims and trades open once the
league draft is complete." A league with no draft is treated the same way. Withdrawing, declining,
cancelling, and commissioner review are not transactions and stay available.

In a Bloodsucker league the same guard then keeps adds, drops, waiver claims, and trade proposals,
counters, and acceptances closed to every member but the Bloodsucker until its exclusive window ends:
HTTP 409, code `BLOODSUCKER_WINDOW_OPEN`, with the close time (see
[league formats](../product/league-competition-rules.md#league-formats)). Callers pass the acting
member, so the guard can tell the Bloodsucker from everyone else.

A player is waiver-only, winnable only by a claim at the next 6 am Melbourne waiver run, while he has
a `PENDING` waiver claim in the league's active season (until a run settles it, even once it is due),
or was dropped since the last waiver run or is still inside a drop's waiver period.
`src/server/waivers/waiverOnlyPlayers.ts` decides this for both the free-agent add, which refuses
with HTTP 409 and code `PLAYER_ON_WAIVERS`, and the player availability panel, which offers Claim
instead of Add.

## Data boundaries

Prisma owns protected fantasy state. Firestore match-stat documents are external scoring evidence and
compatibility projections. Normalize category names and player identity before they reach scoring;
never repair ambiguous identity by silently creating or merging protected rows in a read path.
