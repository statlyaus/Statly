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
duplicate the registry in documentation or UI-specific constants.

## League and season scope

A league is the tenancy boundary for membership, roles, teams, drafts, rosters, fixtures, trades, and
waivers. Season-dependent features also carry a `LeagueSeason` identity. Every protected query, write,
cache key, room, or event must retain the league and applicable season scope.

Every league has an active season (`League.activeSeasonId`): league creation sets one, and the
2026-11-08 season-scope migration gave one to every league that lacked it. Season-scoped rows carry
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
manager, and a manager may leave, only until the draft starts; removal renumbers the remaining draft
slots and rebuilds the draft order. After the draft, rosters, fixtures, and standings depend on every
team, so managers are not removed. Ownership transfer makes the previous owner a manager.
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
- the real-data nine-category preset
- normalized active lineup slots and category directions
- the AFL season of the draft date, or of the creation date when there is none: next season once
  that year's Grand Final has passed (see
  [league competition rules](../product/league-competition-rules.md#calendar-and-fixtures))

Clients may expose additional choices, but they must submit values supported by the server contract.

## Matchup calculation

For each category, active player totals are aggregated for both teams and compared in the configured
direction. Missing or non-finite values normalize to zero at the scoring boundary. The result records
home/away totals, the category winner or draw, category win counts, and the overall matchup result.

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

Rolling lockout: once a player's AFL game has started in the round in progress, he cannot be dropped
or traded until that round ends. `src/server/leagues/playerLockout.ts` decides it from the official
match times lineups use; a player whose game time is unknown is locked too. A direct drop, a trade
proposal, a counter, an acceptance, and a commissioner approval that include him are refused with
HTTP 409 and code `PLAYER_LOCKED`; a veto-review trade that falls due stays in review and completes
at a later run once the round ends. If match times can't be read, these answer HTTP 503
`LOCK_TIMING_UNAVAILABLE` instead of guessing.

## Data boundaries

Prisma owns protected fantasy state. Firestore match-stat documents are external scoring evidence and
compatibility projections. Normalize category names and player identity before they reach scoring;
never repair ambiguous identity by silently creating or merging protected rows in a read path.
