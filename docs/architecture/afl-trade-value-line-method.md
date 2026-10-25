# AFL trade value-line method

Status: proposed 2026-10-17 for owner approval (statlyaus/Statly#789). It replaces the realized grade as a single
number and the traded-on-return valuation. Grade rules v11 and v13 to v18 are retired once this is built.
Every decision marked **Owner** was given by the owner on 2026-10-17; merging this document approves it as a
whole.

## What the product answers

For every supported trade, the product shows what each club has got so far, judged on what was known when
the trade was made, and how that changes over time. **Owner:** values, not letter grades, and an ongoing
assessment. The first release does not need the 0 to 1 score, letter grade or finish-ahead probability. If
they are wanted later, they are computed from the value lines.

## The value line

Every asset a club receives or gives up has a **value line**: one value at each checkpoint, in PAV.

- **Checkpoints (Owner):** the trade date, the draft (for a pick), and the end of each season, once that
  season's HPN PAV is official. Nothing updates mid-season.
- **Value at a checkpoint:** the PAV already produced plus the expected PAV still to come.
- **Unit (Owner):** PAV for the club that holds the asset, during its first stint there. A player's seasons
  at another club never count. For a pick, this is the drafted player's first stint at the drafting club. In
  the owner's worked example, a pick 10 whose player scores 40 for the drafting club and 60 more elsewhere
  is worth 40.
- **State:** `open` while the stint is running (the value is provisional). `closed` when the player leaves
  the club, is delisted or retires. A closed asset's expected PAV still to come is 0, so its value is exactly
  what it produced.

A club's position in a trade at a checkpoint is the sum of the value lines it received, minus the sum of
those it gave up. The value on trade day is the at-trade view. It is shown, and never subtracted from a
later checkpoint.

## Expected PAV still to come

One rule covers picks and players (**Owner**).

```text
expected_remaining(asset, checkpoint) = Σ over future seasons s:
    P(still at club in s) × (expected_games(s) + u_games) × (expected_rate(s) + u_rate)
```

- **Own form (Owner, 2026-10-19):** a player's own seasons move the line by how far he is above or below
  what his prior expects at the same stage, not by his own early level. Two effects, each additive and
  shrunk by its own credibility, and added to every expected season still to come:
  - **games:** his games in each in-stint season minus the prior's expected games at that tenure, summed
    and shrunk by `seasons / (seasons + k_games)`. A season with no game is evidence about playing time.
  - **rate:** his PAV minus his games times the prior's expected PAV per game at that tenure, summed and
    shrunk by `games / (games + k_rate)`. A season with no game says nothing about his level.
    A 19-year-old's first-year output is a young player's level; comparing it with players of the same slot
    at the same tenure keeps normal development from reading as bad form. This replaces the 2026-10-17
    rate blend (`Z × own_rate + (1 − Z) × prior_rate`), which the back-test showed undervalues open stints
    by about 12 PAV after year 1 and 10 after year 3 in every pick range.
- **prior:**
  - For a drafted player, the expected games and PAV per game for his draft slot at each tenure.
  - For a traded player, what traded players at the same career stage (seasons since his draft, standing
    in for age) produce from there, at each tenure at the receiving club
    ([Traded-player fit](#traded-player-fit); owner decision 2026-10-19). Position waits for a source.
- **k (Owner: fitted from history):** `k_games` is the number of seasons, and `k_rate` the number of
  games, at which a player's own record counts as much as the prior. Each is the ratio of the noise in
  one season (or one game) to how much players genuinely differ, estimated from past draft classes, not
  chosen by hand. `k_rate` has a 10-game guard against a degenerate fit; `k_games` has no floor
  ([Owner decisions](#owner-decisions-2026-10-19)).
- **expected_games(s):** games per season expected from the player's availability history and age. An injury
  lowers this. It does not set it to zero.
- **P(still at club in s):** a survival curve fitted from history. It runs by draft slot and seasons at the
  club for a drafted player, and by career stage and tenure at the receiving club for a traded one.

Overperformance and underperformance move the line through the same formula. As seasons accumulate, the
shrinkage tends to 1 and the slot or age prior fades.

## Picks

- **Trade date, pick not yet used:** the value is the expected first-stint PAV of its slot, from the fitted
  **first-stint pick curve**. That curve replaces HPN's whole-career DPVC, which measures a different unit.
  The slot comes from the live Official AFL order, as grade rule v6 already does. A draft with no order yet
  uses the original club's slot in the latest order. The proxy is flagged. A pick of a held draft that no
  captured order places takes the number a reviewed Footyinfo board states it held before the draft
  (parser v3, owner decision 2026-10-18), as grade rule v19's at-trade view does.
- **At the draft:** the pick becomes the player, valued at the same slot expectation. From then on it
  follows the player's value line.
- **Pick not used (no player taken):** 0 from the draft onward when it lapsed with the draft. Draftguru
  says "not used" of three different things (owner decisions 2026-10-25, rules R1 and R2): a pick the
  holder traded on on draft night, which Draftguru records under a new pick id, follows that pick (R1,
  a `pick_relay` link in the trade structure); a pick that stood within 12 of the draft's last
  selection, or states no number, lapsed and is 0; a pick that stood mid-draft was consumed in a bid at
  a shifted number or moved outside the trade-period sources, so it is pending, never 0 (R2).
- **Pick spent matching a bid (Owner):**
  - **Instant realization:** the picks a club spends to match a bid on an academy or father-son nominee
    are realized at the bid.
  - **Shares:** each spent pick takes a share of the nominee's value line, in proportion to the AFL draft
    points it covered. A pick that covered 600 of the 1,000 points the bid required owns 60% of the
    nominee's line from the bid onward.
  - **The nominee pick:** it is valued at the slot where the bid landed. That is the inherent value of the
    father-son or academy pick.
- **Compensation and concession picks (Owner):** valued like any pick, at the slot where it was used, then
  following the player. A free-agency compensation pick is also linked to the player whose departure earned
  it, so the chain view shows "lost player P, compensated with pick N, which became player Q". A concession
  pick (for example Gold Coast's 2020 mid-first-round pick) is linked to its concession. Grade rule v7's
  custody chain finds the slot.
- **Rookie and mid-season drafts (Owner):** out of scope, because their picks cannot be traded. Checked against
  batch twenty-nine: none of its 879 traded picks is a rookie or mid-season pick. Its one "MID" label is Gold
  Coast's national-draft concession.

## Each trade is zero-sum; chains are linked (Owner)

Each trade is assessed on its own. Every asset has **one intrinsic value line**, and it is the same in every
trade it passes through:

- **A player:** his first stint at the club that receives him in that trade.
- **A pick:** what the pick itself became. That is its slot expectation, then the drafted player's first
  stint at the club that used it (or its share of a nominee, for a matched bid), whoever ends up holding it.

So in any one trade, what one club gives is exactly what the other receives, and the trade is zero-sum.

**Every trade the asset passed through moves with its line (Owner).**

- **Example.** Pick 19 is valued at 100 on trade day, and the player drafted with it delivers 190. Its line
  rises to 190, and so does the net of every trade the pick passed through, including a trade before the one
  in which it was used.
- **What stays fixed:** the 100 remains the at-trade view, shown beside the result.
- **What a later trade cannot change:** what the holder got for the asset when it traded it on. That belongs
  to the later trade.

**Chains.** When a club trades an asset on, the trades that share it are linked into a **chain view**:

- **Example.** Club B gets an orange from Club A for an apple, then trades the orange to Club C for seven
  pears.
- **Trade 1** (A and B): orange against apple. The orange's own line (what it turned out to be worth) moves
  trade 1's result. What B got for it from C does not.
- **Trade 2** (B and C): seven pears against orange.
- **Chain view for B:** trade 1 plus trade 2. The orange appears once received and once given, so it
  cancels, and the chain shows B turned the apple into seven pears.
- **What the chain does not do:** it does not move A's result. B's good onward trade is B's, and the chain
  shows it.

This replaces "a traded-on pick is worth its club's return", and with it the bundle splits that rule needed
(rules v1, v3, v11, and v13 to v18). Chain totals are now simply additive. Each club's chain view lists its
linked trades, with each trade's own result and the chain's sum.

## Bundles (Owner)

Because every asset carries its own value line, a trade's result for a club is just the sum of the value
lines it received minus those it gave up. No return has to be split among the given assets. Where a split is
still shown (for example a chain view that attributes a return to the assets that bought it), it uses each
asset's value at the same checkpoint.

## Data needed

| Input                                              | Source                                                                                                                                                                                                                          | Status                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Season PAV, 2019 to 2026                           | HPN PAV calculations, official                                                                                                                                                                                                  | In the outcomes database |
| Games per player-season, 2019 onward               | Match appearances already used by the PAV inputs: `source.gamesPlayed` on each finalized HPN PAV calculation's player rows, cross-checked against its factual appearances (`modeling/playerSeasonGames.ts`)                     | Read model in place      |
| Season PAV and games, 2011 to 2018                 | Statly's own HPN PAV calculation from AFL Tables and Footywire captures, on the grading VM (**Owner:** calculated, not imported; HPN's published PAV is a cross-check only)                                                     | Being calculated         |
| Draft slot, club, first-stint boundaries           | Reconciled candidate and acquisition spells                                                                                                                                                                                     | In place                 |
| AFL draft points table, bid points, matching picks | Bid points and spent picks from the reviewed Footyinfo boards, 2019 to 2025 (parser v2, **Owner:** approved 2026-10-17); the price from each draft year's AFL rule (`matchedBidPriceRules.ts`), never the board's `points_used` | In the outcomes database |

## Fitting and validation

1. **Fit:** the first-stint pick curve, the survival curves and k, from draft classes and trades whose
   first stints have ended, with busts kept in.
2. **Back-test:**
   - Hold out whole draft classes.
   - For each one, compare the value line at draft, after year 1 and after year 3 with the PAV that class
     finally produced.
   - Report the bias and error by draft range (picks 1–10, 11–30, 31+) and by checkpoint.
3. **Published:** every fitted parameter is published with its fit window, so a value line can be
   reproduced from the stored inputs.
4. **No hindsight:** a value line at a checkpoint may use only seasons up to that checkpoint.

### Fit specification (step 2)

Built in `modeling/valueLineFit.ts` (pure) and run by `npm run outcomes:grading:value-line-fit`. Every
choice below is published in the fit artifact (`afl-trade-value-line-fit/v2`, from 2026-10-19; v1 is the
superseded rate blend) with its fit window. This section fixes how the spec above is fitted; it changes
none of the owner's rules.

- **Data.** Every current canonical AFLM national-draft selection of the classes fitted
  (`outcome_current_canonical_draft_selection_picks`), with its slot (selection number), drafting club
  and player, and the player-season games read model for every season after the first class. The fit
  refuses a season that is not available and any games discrepancy. Busts stay in: a draftee who never
  plays contributes 0.
- **First stint.** Season `t` after the draft (season 1 is the season after the draft) is in the stint
  until the first of:
  - the player appears for another club (that season is out);
  - he is drafted again (the seasons after the later draft are out);
  - three consecutive in-stint seasons with no game at the club (the stint closes after the third).
    Appearances cannot show a delisting, and a year-3 debut is common (67 of 1,029 selections), so two
    empty seasons would close live stints. A return after three empty seasons is not first-stint PAV; the
    fit reports how many there are and their PAV.
- **Ended stints and censoring.** No class has every stint ended (2011 still has open ones), so the fit
  does not wait for whole classes. Every class contributes each season it has observed. An open stint is
  censored at the last season read and never counted as ended. Draft classes from 2011 to the season
  before the last are in the fit window.
- **Model forms.** Three curves, each with its own intercept for tenure 1 to 9 and a shared one for 10
  and later, and a continuous piecewise-linear effect of ln(slot) with knots at picks 10 and 30, fitted
  separately for tenures 1 to 3 and 4 and later. One shared slot effect (v1) under-predicted picks 1 to 10
  early (+1.4 PAV per season at tenure 1) and over-predicted them late (−2.6 from tenure 7): top picks play
  more early and plateau lower. With the two bands every pick range is within ±1.2 PAV per season at every
  tenure. The curves:
  - survival: the per-season hazard of leaving the stint (logit link), with half an event and half a
    non-event added per tenure group so a group with no exits stays finite;
  - expected games in a season in the stint (quasi-Poisson, log link);
  - expected PAV per game in a season in the stint with a game (quasi-Poisson, log link, offset
    ln games).
    A single ln(slot) slope was tried first and rejected: it put pick 1 at 265 PAV, while the pick 1s of
    2011 to 2020 averaged 86.
- **First-stint pick curve.** `V(p) = Σ_{t=1..20} S(t, p) × games(t, p) × rate(t, p)`, with `S` the
  probability that season `t` is in the stint. Twenty seasons covers the longest stints; the pooled
  10+ tenure group carries the tail. A class with more than twenty observed seasons is refused, so no curve is
  read past its horizon.
- **Value at a checkpoint.** At the draft, `V(p)`. After season `τ` of an open stint: PAV produced, plus
  the remaining value below. A closed stint is worth what it produced.
  - **Player effects (Owner, 2026-10-19):** `u_games = Σ_{s≤τ} (games(s) − games(t_s, p)) / (n + k_games)`
    over the `n` in-stint seasons through `τ`, and `u_rate = Σ_{s≤τ} (pav(s) − games(s) × rate(t_s, p)) /
(G + k_rate)` over the `G` games in them, each against its own tenure's expectation for the slot. The
    remaining value is `Σ_{t>τ} S(t)/S(τ) × max(0, games(t, p) + u_games) × (rate(t, p) + u_rate)`. A ratio
    form (own ÷ prior) was rejected: it overvalued picks 1 to 10 by 18 after year 1. One effect on PAV per
    season was tried first: it read a season with no game as low level, so a league where one pick in
    five never plays put playing stints 12% high, against 10% for the two effects (the survival
    limitation below).
- **k_games and k_rate.** One-way random-effects analysis of variance (method of moments, unbalanced)
  on the residuals against the slot's expectation at each tenure: games per in-stint season, weight 1;
  PAV per game in each in-stint season with a game, weighted by its games. Each `k` is the within-player
  variance (of one season, or one game) over the between-player variance. `k_rate` is raised to a 10-game
  guard if the ratio falls below it; `k_games` is not floored. The variance components are published as
  estimated, so a `k_rate` on its guard shows as a ratio below it. The fit refuses a variance that is not
  positive.
  v1 searched a grid for its two weights against the next three seasons' PAV and landed
  on an edge, because the rate blend's error came from development the blend could not see, not from
  noise.
- **Back-test.** Each class with at least six observed seasons is held out in turn. All curves and `k` are refitted on the other classes, and the held-out class is valued at the draft, after year 1
  and after year 3.
  - **No hindsight:** at a checkpoint, the held-out class's own seasons count only up to it. The
    parameters come from the other classes' seasons through the last season read. A strictly
    forward-only fit would leave the 2011 to 2014 checkpoints with almost nothing to fit on.
  - **Compared with:** the first-stint PAV the class produced through the last season read, against the
    value line's expected PAV summed over the same seasons. Report bias (mean predicted minus realized),
    mean absolute error and RMSE per selection, for picks 1–10, 11–30 and 31+ and all, at each checkpoint.
  - **Baseline:** the draft-slot-only line (own form moves nothing) at the same checkpoints.
  - **Calibration:** mean realized against mean predicted in bins of predicted value (0, 5, 10, 20, 40, 80,
    160 PAV) at each checkpoint.
  - **Interval:** the 10th and 90th percentiles of realized minus predicted, by pick range and checkpoint.
  - **Prior comparison:** at the draft, the fitted curve against HPN DPVC v3 on the same selections
    (slots 1 to 90). Both are reported for every held-out class and for the mature classes (at least
    twelve observed seasons), where cutting the comparison at the last season read matters least.
- **Known limitations (review 2026-10-19).** Survival is by slot and tenure only, so a player above his
  slot's expectation is treated as leaving as often as one below it; in truth he stays longer, so the
  effect is somewhat under-credited for overperformers and over-counted for underperformers. It also
  spreads the inactivity closures of draftees who never play over every stint: in a synthetic league
  where one pick in five never plays and the rest develop identically, playing stints come out about 10%
  low at year 3 (18% low with no own form at all; with every pick playing, within 1%). A survival
  model where an inactivity closure follows the player's own run of empty seasons is the fix. The two effects are estimated
  separately and multiplied, so their covariance is dropped: if players who play more also score more per
  game, an overperformer is slightly under-credited, the same direction as the survival limitation. Each `k` pools
  every tenure's variance, although early seasons vary less. A future season's games are floored at 0;
  its rate `rate(t, p) + u_rate` is not; the calibration's first bin (below 0) shows how often a value line
  goes negative (never in the 2026-10-19 fit). A hazard term in the effect, or a tenure-varying `k`, is a
  later refinement, not part of step 2.

### Traded-player fit

Built in `modeling/tradedPlayerValueLineFit.ts` (pure) and run by
`npm run outcomes:grading:traded-player-value-line-fit`. Owner decision 2026-10-19: a traded player's open
stint is **estimated** like a pick, not shown as produced-only or pending. Every choice below is published in
the fit artifact (`afl-trade-traded-player-value-line-fit/v3`, sealed as `traded-player-value-line-fit:<sha256>`;
v3 added the `birth` stage basis for mature-age draftees, owner decisions 2026-10-24).

- **Legs.** Every player leg of a candidate trade in the 2019 to 2025 trade periods
  (`source/officialAflTradePeriodSourceScope.ts`): a transfer with `asset.kind = 'player'`, a canonical
  player and a receiving club, its trade season `Y`, and its first stint at the receiving club from `Y + 1`
  by the shared first-stint rule (`valuation/stints.ts` via `createAflTradeAssetLedgerStintValue`, the asset
  ledger's stint). A leg is trained on only when its arrival is reviewed (v4), the reviewed-arrival check. Unreviewed legs, and legs with no
  canonical player or receiving club, are counted per trade season and left out of training; the
  calculator still values them, flagged. The #869 record has 173 reviewed traded arrivals, Cameron's the
  one unreviewed; re-count on the VM at the next real run.
- **Career stage.** Stage of season `s` is `s − origin`, the count the pick fit calls tenure for a player
  who never moves; season 1 is the season after his draft. A player traded in `Y` starts his stint in
  `Y + 1` at stage `(Y − origin) + 1`; tenure at the receiving club is `t = s − Y`. Origin, in order
  ([Owner decisions, 2026-10-24](#owner-decisions-2026-10-24)):
  1. `birth`: his real age, only for a mature-age draftee: a player with a draft origin (origin 2) and a
     known `outcome_player.birth_date` whose earliest draft year less his birth year is at least 21
     (`matureAgeDraftAge`). Origin = birth year + 18, so stage 1 is the season he turns 19. Never
     left-censored. The origin is never later than the season before his career begins (the season after
     his earliest draft, or his first game up to his first trade if earlier), so no season he played or
     was listed in is stage 0 or less. His career (own form, the games curve) is read from that first
     career season, not from stage 1, so his seasons before his draft are not empty seasons
     (`careerFromSeason` on the stage, set only when it is not `origin + 1`). A draft origin at or after
     his first trade is still refused. Every other player, including one with a known birth date who was
     drafted at 18 to 20 and one with no draft origin, takes the rules below exactly as before
     2026-10-24.
  2. `draft`: his earliest `draft_year` in `outcome_current_canonical_draft_selection_picks('AFLM')`,
     read for every draft type and year (a re-drafted player's first draft, since stage stands in for age).
     With no canonical row, his earliest national selection on the reviewed Draftguru 2000 to 2010 year
     pages (parser v5, finalized issue-free batches), joined only through an approved Draftguru player
     identity decision, never by name. Owner decision 2026-10-20 ("Draftguru only"): these give a career
     origin only and are never canonical drafts. The origin's `selectionId` is the evidence id it read.
  3. `first_game`: no canonical draft row, so origin = his first season with a game at any club, up to his
     first trade, minus 1. When that is the first season read (2011) the stage is a lower bound
     (`leftCensored`).
  4. `assumed_youngest`: no draft row and no game up to his first trade, so origin = `Y − 1` and his first
     stint season is stage 2, the youngest a traded player can be. A player drafted in November `Y`
     cannot be traded in October `Y`, so stage 1 never follows a trade.
- **Stage bands** (curve intercepts): 1, 2-3, 4-5, 6-7, 8-9, 10-11, 12-13, 14+. Band 1 holds only
  pre-trade seasons. A left-censored player's season is in a known band only when its lower bound is in
  the open top band, 14+ (from 2024 for a player first seen in 2011); his other seasons have an unknown
  band and are out of the curve fit, the variance components and own form. Until 2026-10-20 the top band
  was 10+, which valued a stage-18 veteran as a stage-10 one: with the 2000 to 2010 national origins
  read, the back-test put pre-2011 entrants 16 PAV high at the trade under 10+, and 8 under the split
  (genuine dry runs `traded-player-value-line-fit:8b04f9d8…` and `05b9a248…`, issue 789). Position is not used (the outcomes database has none). Birth date is used
  only to stage a mature-age draftee (the `birth` basis, 2026-10-24): the genuine dry run put 10 legs
  on it. Using it for every dated player (150 of the 169 traded players in the 2026-10-24 review) failed
  the store gate. The fit publishes the count per trade season (`byStageBasis.birth`), so re-count it
  there at the next run.
- **Phase** of a season, relative to his most recent trade before it (a trade in `Y` comes after season
  `Y`): `pre_trade` (before his first trade in the window), `tenure_1`, `tenure_2`, `tenure_3+`.
  `tenure_1` is the reference (effect 0).
- **Coverage classes**, published per trade season with counts and carried on every value as
  `stageBasis`: (0) `birth`, mature-age draftees (drafted at 21 or older) with a birth date, exact to
  the calendar year; then, for every other player: (a) `draft`, national draftees of 2000 to 2025, exact (2000 to 2010 from Draftguru, see
  origin 2); (b) drafted 1999 or earlier, or outside the national draft, first game in 2011:
  `first_game`, left-censored, in a known band only from 14+; (c) rookie, pre-season, mid-season
  and SSP listings, and pre-2011 draftees who first played in 2012 or later: `first_game`, stage understated
  by the seasons listed before a debut, in the fit; (d) no draft row and no game before the trade:
  `assumed_youngest`; (e) mature-age draftees with no birth date: `draft`, stage understating age. Until
  2026-10-24 every mature-age draftee was (e), accepted under "career stage stands in for age"; the owner
  review of Tim Kelly (drafted 2016 at 22) found the fit expecting 109 more PAV from his West Coast stint
  at the end of 2026, aged 32, as if he were 28. A dated player drafted at 18 to 20 is (a), staged by his
  draft, never by his birth date. Invisible, as in the ledger: delisting and re-signing at the same club, and a
  re-draft through a non-canonical pathway.
- **Stint.** Seasons and status from the ledger stint (a two-club departure season counts if he played
  for the receiving club, as the ledger stint counts it), with the pick fit's inactivity closure on top: three
  consecutive in-stint seasons with no game close it after the third. Closed reasons: `moved` (the ledger
  closed it) or `inactive`. A ledger closure ending in season `e` is visible at the end of `e` when he also
  played elsewhere in `e`, and otherwise at the end of `e + 1`, so no checkpoint reads a closure early. An
  open stint is censored at the last season read.
- **Curves.** Each is `link = stageIntercept[band(stage of s)] + phaseEffect[phase]`:
  - survival: the per-season hazard of leaving the stint (logit), on bands 2-3 to 14+ and the tenure
    phases, with half an event and half a non-event per band and tenure phase. A move is an exit once
    seen, even when the departure season is the last read. **Retirement (2026-10-20):** an inactivity
    closure is an exit in the season after his last game in the stint, not after the third empty season,
    and an open stint ending in 1 or 2 empty seasons adds, at that season, an exit weighted by the chance he
    does not return and a survived season weighted by the chance he does. Before this the exit landed three
    seasons late, every 14+ veteran who had stopped playing was still "open" at year 3, and the back-test put
    14+ at +9 PAV there;
  - games per season (quasi-Poisson, log) and PAV per game (quasi-Poisson, log, offset ln games, seasons
    with a game), on every band and phase. `pre_trade` is a phase, so his history at the old club informs
    the prior without being read as a season at the new club.
    About 9 coefficients per curve on 1,000 to 2,000 player-seasons; the pick fit's 10 tenure intercepts
    and slot slopes would overfit about 280 legs.
- **Seasons fitted.** Per player, every career season through his last trade (he was on a list to be
  traded), then his last reviewed leg's stint. Seasons after a stint with no later trade (a retirement, or
  a move by free agency) are left out: survival already carries the exit, and counting a retired player's
  empty seasons as low games would charge it twice. For the same reason the empty seasons that end his last
  stint are out of the games curve.
- **Return after empty seasons** (2026-10-20). Each time a stint's empty run reaches 1 or 2 seasons, did he
  play in it again? Resolved by a later game (yes) or the stint's close (no); a run still open at the last
  season read is not counted. One probability per run length and stage group (under 10, 10 and up), with
  half a return and half a non-return added; published as `inactiveReturn`. Genuine, 2026-10-20: after one
  empty season 24% of under-10s and 8% of veterans played again; after two, 4% and 3%.
- **Prior along a stint.** For tenure `t`, band = band(`(Y − origin) + t`) and phase = `tenure_min(t,3)`.
  A young player traded moves into the older bands as he ages, where the veterans' higher hazard applies, so
  ageing out comes from career stage, not from unobserved tenure past 7.
- **Own form.** The owner's credibility rule (decision 3, 2026-10-19), read over every career season
  through the checkpoint, pre-trade at any club included, so a traded star is not valued as an average
  player at his stage. Counting pre-trade seasons is an implementation choice, not an owner rule (the
  pick rule counts in-stint seasons only): the back-test's post-trade-only baseline tests it, and it
  waits on owner review alongside the back-test result:
  `u_games = Σ (games(s) − E_games(band_s, phase_s)) / (n + k_games)` over all `n` seasons, zero-game seasons
  included; `u_rate = Σ (pav(s) − games(s) × E_rate(band_s, phase_s)) / (G + k_rate)` over his `G` games.
  Post-trade seasons are the stint's seasons at the receiving club.
- **k.** From the pick fit's `varianceComponents` (one-way random effects, method of moments, unbalanced),
  grouped by player, on the residuals of every fitted season with a known band. `k_rate` keeps its 10-game
  guard; `k_games` has no floor; both components are published as estimated, and a between-player
  variance that is not positive is refused.
- **Value at checkpoint `c ≥ Y`,** `τ = c − Y`: a closed stint is worth what it produced. An open one is
  `produced(stint seasons ≤ c) + Σ_{t=τ+1..20} S(t)/S(τ) × max(0, E_games(t) + u_games) × (E_rate(t) + u_rate)`.
  `τ = 0` is the at-trade view, its own form from seasons up to the trade only. Only seasons `≤ c` are read.
  When the stint's seasons up to `c` end in an empty run of 1 or 2, the sum is multiplied by that run's
  return probability for his stage at `c`, and the run is left out of his own form (it is the retirement
  signal, not form).
  `aflTradeTradedPlayerValueAt` computes it from the published parameters alone
  (`aflTradeTradedPlayerValueLineParameters` refuses another schema or a fit id that does not match its
  content), so a value line is reproducible from the stored fit; it takes the player's earlier trade
  seasons, which set his earlier seasons' phases.
- **Refusals.** A season that is not available or any games discrepancy; a leg whose ledger stint has
  seasons missing PAV, or whose stint PAV in a season differs from the games read model; a grading-input PAV
  calculation id that differs from the games read model's for the same season; a draft origin at or after
  the trade season; a trade season with no season, or more than 20 seasons, observed after it.
- **Back-test.** Leave one trade season out: every trade season with at least two observed seasons (2019 to
  2024 when the last season is 2026) is held out in turn, and all three curves and both `k` are refitted
  without it, on the fit's own training set (players with a reviewed leg). Every player with any leg in that season is removed from the fold entirely, his career
  included, because his other legs and pre-trade seasons overlap the held-out stint. Each held-out
  reviewed leg is valued at checkpoints 0, 1 and 3, counting only seasons up to `Y + checkpoint`; a
  checkpoint is scored for a trade season only when more seasons than it are observed (checkpoint 3 covers
  2019 to 2022). Realized: the leg's signed first-stint PAV at the receiving club through the last season
  read; predicted: the value line's expected PAV summed over the same seasons. Reported: bias (mean
  predicted minus realized), MAE, RMSE and the bias's standard error (the residuals' sample SD over √n; until 2026-10-20 it
  was RMSE / √n, which counts the bias itself as noise and understates large biases) per leg, by checkpoint
  and by stage band at trade, bands 10 and up pooled (`byVeteranBandsAndCheckpoint`), by entry
  (`byEntryAndCheckpoint`: `career_began_by_first_read` (draft or `birth` basis, his career's first
  season, not his age, in or before the first season read; one rule for both bases, so a player keeps
  his group whether or not his birth date is known), `left_censored`, `entered_from_first_read`, and
  `entered_before_first_read` pooling the first two), by `stageBasis` (`birth` first, `first_game` split by
  left-censoring) and by trade season; the
  baselines produced-only (expected remaining 0: the display the owner rejected), stage-only (own form
  moves nothing) and post-trade-only own form (tests the at-trade use of history); calibration bins
  (below 0, then 0, 5, 10, 20, 40, 80, 160); the 10th and 90th percentiles of realized minus predicted;
  per-season totals and each fold's `k`. Expect 25 to 45 legs per fold, so judge every bias against its
  standard error. Checkpoint 3 rests on four trade seasons, and the tail past tenure 7 cannot be
  back-tested; the artifact says so.
- **Known limitations.** Survival reads own form only through the previous season's shrunk PAV-per-game
  effect (2026-10-23). The 14+ band pools every veteran from stage 14. The mature-age gap is closed where
  the birth date is known (v3); a mature-age draftee without one is still staged by career, so still
  staged young. Birth date stages no one else: a player drafted at 19 or 20 is staged as if drafted at
  18, and a player with no draft origin (rookie, pre-season and SSP listings) by his first game, so
  either can be staged up to two seasons young or more. A birth year is a calendar year, so players born early and
  late in one year share a stage. Players with no birth date who entered before 2011 through a pre-draft
  zone listing (no pick number) stay left-censored. A retirement is seen only once the stint ends in empty seasons;
  until then the stage prior carries it, so a veteran is still high at the trade (pre-2011 entrants +7.9,
  SE 4.3, genuine fit `044703d9…`). First-game stages are understated for players listed before their debut. Recency is not
  weighted: a veteran's effect is his career average, so decline shows only through the stage prior.

### Value lines (step 3)

Built in `valuation/valueLines.ts` (pure) and run by `npm run outcomes:grading:value-lines`; the
artifact is `afl-trade-value-lines/v3`, which reads its trades, legs and onward links from the trade
structure (`afl-trade-structure/v1`, step 5), never a realized grade, and carries each trade leg's
points at the trade's checkpoints, so a reader takes a leg's value from the point its nets count. Every rule is published in it
(`rules`). This section fixes how
the spec above is applied; it changes none of the owner's rules.

- **Checkpoints.** Each point names its kind: `season_end` (season Y's HPN PAV official), `trade` (the
  trade period of Y) and `draft` (the national draft of Y), in that order within a year. A checkpoint
  reads only seasons through Y. A trade's nets are at its picks' drafts and every season end after it,
  through `--through-season`, which may not pass the fit's last season.
- **At-trade view.** Each leg carries its asset's value at the trade, beside the trade's nets; the
  per-club at-trade net is shown, never subtracted from a later one.
- **Picks before the draft.** `V(at-trade slot)`, never the eventual selection. The at-trade slot is the
  number the trade states, else rule v6's slot in the live Official AFL order (the previous draft's order
  is a flagged `order_proxy`), else the reviewed board's pre-draft number (rule v19); with none the
  point is pending (`slot_unknown`). A season end between trades takes the slot of the pick's latest hop
  (by year, then trade id).
- **Picks from the draft.** A used pick is `V(used slot)` at the draft, then the drafted player's first
  stint at the drafting club. A passed pick is 0. A pick not used, including one the boards show was not spent on a bid (owner, 2026-10-21), is 0 when the ledger says it lapsed (rule R2: its latest Official AFL order number under its id, else its last trade's stated number, within `notUsedLateWindow` of the draft's last selection, or no number stated) and pending from the draft (`not_used_holder_matched_bid` when its holder matched a bid that draft, else `not_used_mid_draft`) when it stood mid-draft; one the ledger relays (rule R1) is never a line of its own: the structure's `pick_relay` link carries its legs onto the next pick id's line, and a relayed pick the structure does not link is refused. A matched-bid spent pick is its share of
  the nominee's line (at the bid slot) from the bid; before it, its own slot. A pick whose draft is not in
  evidence stays at its slot, and an unresolved outcome is pending.
- **One evaluator.** A drafted player's point is `aflTradeValueLinePointAt` in `modeling/valueLineFit.ts`,
  the evaluator the fit's back-test uses, on curves rebuilt from the stored fit's published parameters.
  The ledger's stint end closes a stint from the season that reveals it (its last counted season when
  he also played elsewhere then, else the season after), never earlier. Three in-stint seasons with no
  game also close it, for good: a later return is not first-stint PAV. A tenure past the 20-season
  horizon is refused.
- **Signed values.** No floor: a closed asset is exactly what it produced, negative PAV included.
- **Traded players.** A player's line is his first stint at the club that received him in that trade
  (never followed on). A closed stint is what it produced. An open stint takes produced plus expected
  remaining from the stored traded-player fit (`modeling/tradedPlayerValueLineContracts.ts`), on the
  input the fit builds for the same leg: the stage by the fit's one rule (`aflTradeTradedPlayerStage`)
  against his first trade in the fit's window: his real age for a mature-age draftee (drafted at 21 or
  older) whose birth date is known (the fit's birth years, `loadAflTradeTradedPlayerBirthYears`), else
  from the fit's merged draft origins (every canonical
  AFLM draft type and the reviewed Draftguru 2000 to 2010 rows), else the season before his first game
  (left-censored when it is in the fit's first read season), else assumed youngest (no draft and no
  game: the season before that first trade); his career from the fit's games read model; and his
  earlier trades in the window (every resolved leg, reviewed or not) for the phases. A leg is pending
  (`unavailable`) only where the fit refuses it: a trade season outside its window, or a draft origin at
  or after his first trade. With no fit given the point is pending (`traded_player_fit_not_stored`) and
  the trade's net is provisional.
- **Traded-on picks.** A pick leg follows the trade structure's onward links (a pick trail, or a special
  entitlement's reviewed custody successor) to its final hop, so every trade it passed through carries
  the same line. A link is followed whatever became of the onward trade, even when its other side cannot be
  valued. A later trade's own assets never change an earlier trade's
  result (in the orange example, the pears' value leaves trade 1 unchanged; the orange's drafted player
  moves both).
- **Refusals.** The fit, ledger and games read model must pin the same calculation per shared season
  (the structure holds no value, so it pins none), the games read model must be of the fit's method with
  every season available, the structure must match its content address, and the ledger, structure and
  candidate must be of one candidate. Each structure leg's clubs must be its candidate transfer's, and
  each onward link must continue the asset: given on by the club that received it, as the same pick (a
  pick trail) or as the same special entitlement's next transfer (a successor). Any caller can seal a
  structure, so a link that names another club's or another pick's transfer is refused, never valued.

## What this retires

- **Grade rules v14 to v18.**
  - v14 and v15 split bundles by projection.
  - v16 and v18 value matched-bid picks at their projection inside the realized return.
  - v17's round-position proxy feeds v18.
  - Both break the 2026-10-08 rule that a projection never feeds the realized value or the bundle split.
- **A traded-on pick valued at its club's return** (rules v1, v3, v11, v13): replaced by intrinsic value lines
  and the chain view.
- **The realized grade as a single number:** replaced by the value line at the latest checkpoint.
- **Whole-career DPVC as the pick prior:** replaced by the first-stint pick curve. DPVC can still be shown for
  reference.

## Owner answers, 2026-10-17

1. **Pick traded on before use:** each trade is zero-sum on intrinsic value lines, and linked trades are
   shown as a chain ([above](#each-trade-is-zero-sum-chains-are-linked-owner)).
2. **Bundles:** by value at each checkpoint, where a split is still shown at all.
3. **Rookie and mid-season drafts:** their picks cannot be traded, so they are out of scope (the data check
   agrees).
4. **Compensation picks:** linked to the slot and to the player whose departure earned them.

## Owner decisions, 2026-10-19

1. **Relative own form:** "Yes, compare to pick average." Own form is read against the pick's average at
   the same tenure ([Fit specification](#fit-specification-step-2)).
2. **Credibility speed:** "Slow it down" was asked of the v1 grid search, where `k_rate` = 0 and a year-1
   player with 16 or more games was 14.8 PAV high. The variance-component estimate (#1003) fixed that
   group (-3.4, SE 5.7) with `k_games` = 1.43 seasons. Floors of 3 seasons and 10 games followed (#1010),
   but on genuine inputs the 3-season games floor made every year-3 bias more negative (all -1.01 to
   -1.34) and every post-draft RMSE worse (year 1 37.6 to 38.2, year 3 28.6 to 29.1), with the bias
   changes inside their standard errors. Owner, after review: "Revert games floor". `k_games` is the
   estimate; `k_rate` keeps its 10-game guard, which does not bind (13.85).
3. **Traded players are estimated:** a traded player's open stint is valued like a pick's, not shown as
   produced-only or pending (owner: "estimated"). The prior is what traded players at the same career stage
   (seasons since the draft, standing in for age; owner: "Yes, career stage") produce from there, with no
   position because there is no position data; his own form is blended in by the same credibility rule
   (games and PAV per game, `k` from variance components); survival is at the receiving club; all fitted
   from past trades with a held-out back-test ([Traded-player fit](#traded-player-fit)). Position can be
   added later if it is sourced.

## Owner decisions, 2026-10-24

1. **Stage by real age where known:** "Fix these two (Recommended)" and "Yes, split them (Recommended)",
   after the review of Tim Kelly (drafted 2016 at 22, so career stage staged him four years young: at the
   end of 2026, aged 32, the fit expected 109 more PAV from his West Coast stint). The first build staged
   every player with a known `outcome_player.birth_date` by his age less 18, career stage the fallback.
   Full birth-date age for everyone was tried. Its genuine dry run failed the store gate: pre-2011
   entrants 13.3 (SE 5.8) = 2.3 SE.
2. **Mature-age only:** "Yes, try it (Recommended)" to "real age only for players drafted at 21 or
   older; everyone drafted at 18-20 stays exactly as now". The `birth` basis applies only to a player
   with a draft origin and a known birth date whose draft year less birth year is at least 21; every
   other player keeps the career-stage rule exactly (`draft`, `first_game`, `assumed_youngest`)
   ([Traded-player fit](#traded-player-fit)). Genuine dry run, 10 legs on the `birth` basis: pooled 10+
   within 1.6 SE; pre-2011 entrants 10.6 (SE 4.9) = 2.17 SE at trade and 7.5 (SE 3.7) = 2.04 at year 1,
   against the 2.0 gate; RMSE 22.33 / 18.25 / 11.28 versus 22.26 / 18.40 / 11.49; Tim Kelly's line at the
   end of 2026 goes from 220.9 to 153.3.
3. **Saved by owner exception:** "Yes, save it (Recommended)" to saving it even though the pre-2011-entrant
   check is 2.17 SE at the trade and 2.04 at year 1, against the 2.0 gate. This is a one-off exception
   for this fit, not a change to the gate.

These refine 2026-10-19 item 3 ("career stage", standing in for age) for mature-age draftees only. The
fit and the value lines share the one stage rule (`aflTradeTradedPlayerStage`), so they cannot disagree;
the fit's `stageDigest` refuses a re-read whose birth years moved a stage.

## Owner decisions, 2026-10-25

The 24 Oct review of real trades found 109 traded pick ids valued 0 as plain Draftguru "not used"
(statlyaus/Statly#1050). A pick traded more than once often gets a different pick id per trade, and a
draft-night trade's pick never joins the trade-period pick that became it. The offline analysis of the
109 split them, and the owner answered "Yes, both" to the two rules:

1. **R1, relay join.** A stated not-used pick relays to another pick id when that pick's first trade
   hands the same draft's same stated number from the not-used pick's last holder to another club, in a
   different trade no earlier than the not-used pick's last, and each is the only such match for the
   other. Numbers alone never join (owner, 2026-10-24): the holder, the order of trades and uniqueness
   both ways are all required. A round-only pick whose trade states no number relays by its latest
   usable Official AFL order number under its own pick id (R1 by order; owner, 2026-10-25: "Yes,
   extend R1"); the next trade must still state the number. The asset
   ledger records the relay (`relayed`), the trade structure links the leg on (`pick_relay`, checked
   against the candidate like a special entitlement's successor), and the value lines follow the link, so
   every trade the pick passed through carries the next pick id's line. 14 of the 109 relay: 9 land on a
   valued pick (Annable 35.6, Tom Green 25.4, Maginness 17.1, Ethan Read 11.4, Ashcroft 6.1, Ruscoe
   6.1, Liam Henry 2.1), 5 on another not-used pick whose chain is listed.
2. **R2, pending instead of 0.** A not-used pick that did not relay is 0 only when the evidence shows it
   lapsed: it stood within 12 selections of the draft's last selection (its latest Official AFL order
   number under its own pick id, else the number its last trade stated; an unordered trail's hops must
   agree, and a newest order capture that is unusable makes the fate unknown), or it states no number (a
   round-only future pick). Every other not-used pick stood mid-draft, so it was consumed matching a bid
   at a shifted number the boards do not join (`not_used_holder_matched_bid`, its holder matched a bid
   that draft) or moved on draft night outside the trade-period sources (`not_used_mid_draft`); it is
   pending from the draft, never 0, and stays on #1050 for per-pick review. Every selection in evidence
   counts toward the draft's last selection, whatever its status: an unresolved status disputes which
   pick or player a selection was, not that it happened.

Stored on genuine 2026-10-25 (value lines `e6a321d9…`, bundle `6f34f73b…`, checkout 347cf63c): 14 relays
as the analysis listed, 13 pending (the analysis's 12 plus Brisbane's 2020 R2 pick given to Gold Coast in
the 2019 Ah Chee trade, which the 2020 order held at 37 and Gold Coast traded on with no stated number),
82 at 0. Against the stored 24 Oct lines nothing else moved: 14 legs re-keyed, 13 assets 0 to pending, 50
club nets changed, every pair zero-sum.

The review of the 13 (owner, 2026-10-25: "Approve all 7", "Yes, extend R1", "Do them in this wake"):

- **7 same-pick links** (`assetLedgerReviewedPickLinks.ts`): each holder-matched-bid pick is a draft-night
  id of an order pick the holder's board spend already joins by custody, so it takes that share: 2019
  Sydney→Brisbane "#47" = Sydney R3 44 (Keidean Coleman); 2020 "#29" chain = Fremantle R2 29
  (Ugle-Hagan); 2020 Fremantle→Brisbane "#35" = Melbourne R2 32 (Blake Coleman); 2020 Gold Coast→Sydney
  "#37" = Brisbane R2 37 (Campbell); 2023 Carlton→Gold Coast "#26" = Hawthorn R2 26 (Walter); 2023
  Melbourne→Gold Coast "#35" = Melbourne R2 36 (Read); 2023 Gold Coast→Footscray "#46" = Gold Coast R3 48
  (Croft).
- **R1 by order**: the Ah Chee hop relays into Gold Coast→Sydney "#37", so one line carries all three
  trades.
- **One reviewed selection** (`AFL_TRADE_ASSET_LEDGER_REVIEWED_SELECTED`): 2023 North Melbourne→Carlton
  "#25" (Sydney→North Melbourne "#25" relays into it) is the R1 pick the 2023-11-16 order lists at 22 held
  by Carlton, used at selection 29 on Ashton Moir; Draftguru says not used only because no selection 25 was
  Carlton's. The ledger refuses the entry unless the selection, order row and board row all name the holder.
- **4 stay pending** with no evidence in the system of where the pick went: 2022 GWS→Collingwood "#40"
  (Bobby Hill trade), 2023 Sydney→Melbourne "#46" (Grundy), 2023 Melbourne→Brisbane "#47" (Fullarton),
  2025 West Coast→Fremantle→Melbourne "#23" (McVee). They need a draft-night source (the AFL's
  draft-night trade reports or Draftguru's per-pick pages) captured under a gate decision, not a rule.

## Implementation order

1. **Pre-2019 data:** calculate HPN PAV and games for 2011 to 2018 on the VM with the same governed season
   pipeline as 2019 to 2026, cross-checked against HPN's published values, and add the games read model
   for 2019 onward. The read model is in place (`modeling/playerSeasonGames.ts`) and reads each 2011 to
   2018 season the same way once its calculation is finalized. Seasons before 2011 have no second
   statistics source, so they fail closed and stay out of the fit window.
2. **Fit and back-test:** fit the first-stint pick curve, the survival curves and k; publish the back-test.
   Done: the fit and back-test command is in place ([Fit specification](#fit-specification-step-2)),
   with own form read against the pick's average at the same tenure and `k` from variance components
   (owner decisions 2026-10-19, items 1 and 2). The curves beat whole-career DPVC as the prior at the
   draft.
3. **Value lines:** build the value-line calculator and contract, at every checkpoint, for players and
   picks. The calculator, contract and command are in place
   ([Value lines (step 3)](#value-lines-step-3)). The traded-player fit (owner decision 2026-10-19, item 3) is stored (`044703d9…`, v1) and wired in by `--traded-player-fit`, which values traded players' open
   stints on the fit's own leg inputs. The calculator needs a v3 fit (its per-season `stageDigest` ties the re-read stages, birth years included, to the fit's), so genuine needs a
   refit before the value lines are computed with it.
4. **Matched bids:** load the AFL points table and calculate each spent pick's share. Done for the asset
   ledger (#971: prices, shares, leftover picks and deficits); the value lines value each spent pick by its
   share and the trade story reads them (step 5).
5. **Retire the old rules:** retire the traded-on-return valuation (grade rules v11 and v13 to v18) and the
   bundle split, then regrade on intrinsic value lines. Done (#789 step 5): the trade structure (trades,
   legs and onward links with no value) is in place, the value lines read it (`afl-trade-value-lines/v3`,
   with each leg's points), and the trade story reads the structure and value lines: signed values at
   the latest checkpoint (each leg at the point its trade's net counts), the at-trade view beside them,
   matched-bid shares and future picks valued, and each club's net on the trade alone as the page
   headline (owner, 2026-10-21). The realized grade (rules v1 to v19: first-stint legs, traded-on
   returns, the bundle and hybrid splits, the projected legs and the at-trade views it sealed) and its
   command are deleted. The regrade is the value lines' per-club nets, which the trade story reads. The
   pick-slot lookups (`valuation/pickSlots.ts`), the first-stint rule (`valuation/stints.ts`) and the
   input loader (`development/postgresGradingInputs.ts`) are kept for the asset ledger, the trade
   structure and the value lines.
6. **Chains:** build the chain view, linking trades that share an asset, plus the compensation links.
7. **Preview:** a value line per club per trade over time, with each club's chains. The private page UI
   is in place on sample data (`/dev/afl-trade-stories`, "Private trade page" in the AFL trade intelligence
   architecture); it reads sample value lines until sealed ones are served to it.
