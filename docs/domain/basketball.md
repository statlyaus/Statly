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

## Valuation and matchup maths

The engine in `src/lib/basketball/` is pure TypeScript with no database or network access, so it
runs on the server and in client components. It ports the formulas of the fantasy basketball
spreadsheet this section rebuilds ("the sheet"), with the changes noted here.

### Projections (`projection.ts`)

- Per-game line = season totals ÷ games played; minutes from seconds played.
- Blend: `w = min(1, gamesThisSeason / 15)`, each stat `w·now + (1 − w)·last`. Makes and attempts
  are blended as counts, so FG% and FT% are blended makes over blended attempts.
- A player with no last season is blended with the rookie baseline (the sheet's Rosters row 2):
  FGM 3, FGA 7, FTM 1.1, FTA 1.5, 3PM 0.9, PTS 8, REB 3.2, AST 1.6, STL 0.6, BLK 0.4, TO 1.0.
  Minutes and three-point attempts have no prior; his own numbers stand. The baseline applies to
  any player with no last-season games, including a veteran who missed all of last season.
- Before a player's first game this season, last season stands alone. No games in either season:
  no projection.

### Player value (`valuation.ts`)

Value is Statly's own volume-weighted z-score. It replaces the Basketball Monster values the sheet
used, which are a paid feed.

- Pool: blended minutes of at least 20 a game and at least one game in either season. Pool means
  and spreads come from these players only.
- Every player with at least one game in either season gets a z, in the pool or not, so
  replacement level never runs out of players.
- Counting categories: `z = (x − poolMean) / poolSd`, population SD over the pool.
- Percentages: `poolPct = Σmakes / Σattempts` over the pool, impact = `(pct − poolPct) × attempts`,
  then z of impact over the pool. A 100 % shooter on two attempts is worth less than an 80 % shooter
  on ten.
- Low-wins categories (turnovers) are negated so a higher z is always better. A category with no
  spread in the pool scores 0.
- Total = Σ z over the league's categories that are not punted.
- Auction dollars: replacement = the total of the (teams × roster spots + 1)th best player, or the
  worst if there are fewer. Above replacement:
  `ROUND(1 + (v − repl) / Σ(v − repl)⁺ × (teams × budget − teams × spots))`; everyone else $1.

### Daily lineups (`lineupSimulator.ts`)

Each day, the players with a game who are not on the injured list, not OUT and already acquired are
taken by value, highest first. A player starts only if he raises the maximum matching between
players and starter slots (every slot except BN and IL). Day-to-day players count as playing.

| Position          | Slots it can fill |
| ----------------- | ----------------- |
| PG                | PG, G, UTIL       |
| SG                | SG, G, UTIL       |
| SF                | SF, F, UTIL       |
| PF                | PF, F, UTIL       |
| C                 | C, UTIL           |
| G (ESPN generic)  | PG, SG, G, UTIL   |
| F (ESPN generic)  | SF, PF, F, UTIL   |
| Several positions | the union         |
| Unknown           | UTIL only         |

### Week projection (`matchup.ts`)

- Each side's week = stats already counted + per-game line × games simulated for the remaining days.
- Margin = me − opponent (opponent − me for turnovers). Call: toss-up when
  `|me − opp| / max(|me|, |opp|) < 3 %`, else win or loss by the margin's sign.
- Only the remaining volume is uncertain. Counting categories, per side:
  `σ² = k·R + (0.06·R)²`, R = rest-of-week total, k = 1.1 3PM, 2.5 PTS, 1.2 REB, 1.1 AST, 1.0 STL,
  1.1 BLK, 1.0 TO. Percentages, per side:
  `sqrt(A·p·(1 − p)·1.2 + (0.02·A)²) / max(Atot, 1)`, A = remaining attempts, Atot = the week's
  projected attempts, p = the week's projected percentage. The two sides add in quadrature.
- Win chance = `Φ(margin / σ)` (Abramowitz–Stegun normal CDF); with σ = 0 it is 1, 0 or ½ by sign.
- Expected categories won = Σ win chance. Most categories: a Poisson-binomial DP gives
  P(win) = P(categories won > n/2), P(tie) = P(won = n/2) for an even n, and P(loss). Each category:
  the expected record only.

### Add/drop (`addDrop.ts`) and trades (`trade.ts`)

- For one drop, each free agent is added from his add date and the lineup re-simulated. Category
  points against the opponent's projected week: win 1, toss-up ½, loss 0; options rank by the change
  in points, then fit to needs.
- Need weight from the current week: `rl = margin / max(|me|, |opp|)`; `|rl| ≤ 10 %` → 1.0, behind
  by more → 0.4, ahead by more → 0.1. Fit = `100 × Σ weight × change / scale`, scale = my current
  percentage for FG% and FT%, else `max(opponent, 1)`; turnovers count negatively.
- Trade check: per category, Σ z of players received − Σ z of players given; under 0.25 either way
  is even; punted categories are flagged and left out of the total.

### Simplifications

- There is no lineup log. Days already played are simulated too: the players with a box-score line
  that day compete for slots, the injured list applies, today's OUT status does not.
- A dropped player's games earlier in the week are lost, and the add/drop drop loses every
  remaining day.
- Day-to-day counts as playing; only OUT and injured-list players are left out.

## Rotation Watch

`rotation.ts` ports the sheet's Rotation Watch (its `LineupLog.gs` Apps Script) and reads only the
stored box scores of the season's final regular-season games. The Rotation page
(`/basketball/[leagueId]/rotation`) shows it with each player's owner in the league profile.

- "Last 5" and "last 10" are the team's last games, not calendar days. A player the box score does
  not list was not dressed.
- Per NBA team: games, unique starting fives (season and last 10), games whose starters changed from
  the game before, the last change with why each starter left (not dressed, bench, DNP-CD, rested,
  suspended, injured), coach's-decision DNPs per game and players with 10+ minutes per game over the
  last 10.
- Per player: games, starts, starts in the last 5 (starter 4–5, spot starter 1–3), last game status,
  coach's-decision DNPs in the last 10 and the latest, his latest move into or out of the five in the
  last 10, minutes per game and a one-line summary. A traded player is shown with the team of his
  latest box score, counting that team's games only (the sheet keeps the team whose last game is
  latest, which can be his old team).
- Alerts follow the sheet's rules and priority, at most two items, level the highest: red for a
  coach's-decision DNP in the team's last 2 games (12+ minutes a game over the last 10) or an
  established starter benched in the last 3; green for a new starter (or injury cover, paired with an
  absent starter by listed position) and minutes up; amber for the bench-risk and DNP-risk flags and
  minutes down. Personal and other DNP reasons count as injured, as in the sheet.
- One deliberate difference from the sheet: a starter who was out or not dressed for his team's last
  game gets no bench-risk flag, since an absent player is not about to lose his spot for his
  shooting.
- The season's box scores are cached per finished ingest run (five minutes at most), so the page
  does not reread every row on each visit; names and injuries are read fresh.
- Not ported: the sheet's coach career traits and next-game churn probabilities, which came from a
  hand-built dataset Statly does not have.

Checked against the sheet's Rotation Watch for games to 2 Nov 2026: all 30 team rows matched, the
76 alert texts matched as a set (injury return dates aside), and a sample of 38 player rows matched
field for field.
