# Fantasy basketball

Statly's fantasy basketball section helps a manager run their own NBA category league, hosted
elsewhere (Yahoo, ESPN, Sleeper, Fantrax), from one private profile. It is a separate product track
from AFL fantasy: it shares the app shell, sign-in and database, and nothing else. It does not host
leagues, run drafts or sync with any platform.

## Scope

A signed-in user creates one or more **league profiles**. Each profile records the league's settings,
the user's team and roster, and optionally other teams and the current opponent. From that, Statly
shows player values with the user's punts, the week's head-to-head projection, streaming pickups and
a trade check.

Not in scope: hosting a league, platform sync (Yahoo needs an owner-registered OAuth app), roto
scoring, draft tools, and betting data.

## Categories and formats

`src/types/basketball.ts` defines the nine supported categories and their direction:

| Id       | Shown as | Kind                         | Direction |
| -------- | -------- | ---------------------------- | --------- |
| `FG_PCT` | FG%      | field goals made / attempted | high wins |
| `FT_PCT` | FT%      | free throws made / attempted | high wins |
| `THREES` | 3PM      | three-pointers made          | high wins |
| `PTS`    | PTS      | points                       | high wins |
| `REB`    | REB      | rebounds                     | high wins |
| `AST`    | AST      | assists                      | high wins |
| `STL`    | STL      | steals                       | high wins |
| `BLK`    | BLK      | blocks                       | high wins |
| `TO`     | TO       | turnovers                    | low wins  |

Presets: 9-category (all nine) and 8-category (without turnovers). A percentage category is always
compared as total makes over total attempts, never as an average of percentages.

Formats:

- **Head-to-head, most categories** (`H2H_MOST_CATEGORIES`): the team that wins more categories in a
  week wins the matchup.
- **Head-to-head, each category** (`H2H_EACH_CATEGORY`): every category is its own win, loss or tie.

A **punted** category is one the manager has chosen to concede. It is excluded from player value but
still shown in matchup projections.

## Seasons and weeks

- An NBA season is identified by the year it ends: 2026-27 is `2027`, as ESPN numbers it.
- Game dates are US Eastern calendar dates. Fantasy weeks count Eastern dates too.
- Fantasy weeks are seven Eastern dates, starting on `weekOneStartsOn`. A league can mark weeks that
  span 14 dates instead (`twoWeekMatchups`, commonly the All-Star break on Yahoo and ESPN); every later
  week starts seven days later than it otherwise would.
- Only regular-season games are stored. Preseason, play-in and playoff games and the NBA Cup final
  (whose stats do not count in season totals) are excluded.

## Entities and authority

| Entity                                               | Owner                           | Notes                                                                                                                |
| ---------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `NbaTeam`, `NbaPlayer`, `NbaPlayerIdentity`          | `src/server/basketball/ingest`  | Global reference data. Player identity is the provider's ID, never a name match.                                     |
| `NbaGame`, `NbaPlayerGameStat`                       | `src/server/basketball/ingest`  | One row per player listed in a box score. Season averages are computed from these rows.                              |
| `NbaPlayerInjury`                                    | `src/server/basketball/ingest`  | Current injury report, replaced as a whole list.                                                                     |
| `NbaIngestRun`                                       | `src/server/basketball/ingest`  | Audit row per ingest run; the only write on a rejected run.                                                          |
| `BasketballLeague` and its teams, spots and matchups | `src/server/basketball/leagues` | Private to `ownerId`. Every query filters by owner and league; non-owners get 404. A profile is bound to one season. |

A roster spot with no team means the player is rostered by a team the user has not entered, which
removes him from the free-agent list.

Player positions are stored as the data provider lists them. Providers list fewer positions than
Yahoo or ESPN fantasy grant, so lineup eligibility in projections is conservative: a player may count
for fewer slots than in the user's real league. A roster spot's `acquiredOn` date is the first Eastern game date
it counts for that team.

Adding players from a pasted list is an explicit, reviewed operation: the server proposes candidate
matches for each line and nothing is saved until the user confirms each one.

## Data source and licensing

The NBA ingest reads ESPN's public site API (schedule, box scores, injuries, rosters) behind a
provider adapter. ESPN's terms of use (Disney) allow personal, non-commercial use only and prohibit
automated scraping, so this adapter is marked as not licensed for commercial use. The ingest refuses
to run in production with an unlicensed provider unless `NBA_STATS_ALLOW_UNLICENSED_PROVIDER=true`
is set deliberately. A licensed feed (for example balldontlie's paid tier, which permits commercial
use, or an enterprise feed) is required before a public launch. The schema stores provider-neutral
values (seconds played, standard team codes, a did-not-play reason enum) so the adapter can be
swapped without a migration.
