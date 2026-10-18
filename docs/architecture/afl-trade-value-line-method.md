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
    P(still at club in s) × expected_games(s) × expected_rate(s)
```

- **expected_rate**, the expected PAV per game, is a credibility blend:
  `Z × own_rate + (1 − Z) × prior_rate`, with `Z = games / (games + k)`.
- **own_rate (Owner):** PAV per game over the player's last three seasons, with recent seasons weighted
  more. A season lost to injury adds no games. It neither lowers nor props up the rate.
- **Credibility by games (Owner):** `games` is the games actually played in that window, not seasons on the
  list, so 30 games of evidence outweighs 5.
- **prior_rate:**
  - For a drafted player, the expected rate for his draft slot.
  - For a traded player, the expected rate for his age and position.
- **k (Owner: fitted from history):** the number of games at which a player's own record counts as much as
  the prior. It is fitted on past draft classes and trades, not chosen by hand.
- **expected_games(s):** games per season expected from the player's availability history and age. An injury
  lowers this. It does not set it to zero.
- **P(still at club in s):** a survival curve fitted from history. It runs by draft slot and seasons at the
  club for a drafted player, and by age and tenure for a traded one.

Overperformance and underperformance move the line through the same formula. As games accumulate, Z tends
to 1 and the slot or age prior fades.

## Picks

- **Trade date, pick not yet used:** the value is the expected first-stint PAV of its slot, from the fitted
  **first-stint pick curve**. That curve replaces HPN's whole-career DPVC, which measures a different unit.
  The slot comes from the live Official AFL order, as grade rule v6 already does. A draft with no order yet
  uses the original club's slot in the latest order. The proxy is flagged. A pick of a held draft that no
  captured order places takes the number a reviewed Footyinfo board states it held before the draft
  (parser v3, owner decision 2026-10-18), as grade rule v19's at-trade view does.
- **At the draft:** the pick becomes the player, valued at the same slot expectation. From then on it
  follows the player's value line.
- **Pick not used (no player taken):** 0 from the draft onward.
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
| Season PAV and games, 2011 to 2018                 | Statly's own HPN PAV calculation from AFL Tables and Footywire captures, on the grading VM (**Owner:** calculated, not imported; HPN's published PAV is a cross-check only)                                                     | In the outcomes database |
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

## Fit and back-test

Built for implementation order step 2 in `modeling/valueLineFit.ts` (the fit and the value line at a
checkpoint) and `modeling/valueLineBacktest.ts` (the back-test). Both are pure. The runbook section
"Fitting the value line" runs them with `npm run outcomes:grading:value-line-fit`, which reads the current
canonical national drafts and the player-season games read model and stores the result as one private
`value-line-fit:` artifact. Every fitted parameter is in that artifact with its fit window, together with
the rules, the draftees and the calculation ids it read. Because it holds realized PAV, it is
publication-prohibited, and none of its numbers are copied here.

**What is fitted, from drafted players' first stints at the drafting club:**

- **Survival:** P(still at the drafting club) by slot band (1–10, 11–30, 31+) and seasons since the draft.
- **Expected games:** mean games for the club by band and season, scaled so that the slot's expected
  first-stint games follow a fitted curve `max(0, c + d ln(slot))`.
- **Prior rate:** PAV per game by slot, `max(0, a + b ln(slot))`.
- **First-stint pick curve:** prior rate × expected first-stint games. This is the same value the
  value line gives the slot at the draft.
- **Availability:** a single weight `rho` that moves expected games toward the player's own recent games.
- **k:** the credibility weight in `Z = games / (games + k)`.

**Owner rules applied:** values change only at season ends; form is PAV per game over three seasons, so a
season without games adds nothing to the rate; the first stint is at the drafting club and is not capped;
only national drafts are read. Compensation, father-son and academy selections are fitted at the slot
where they were used. Their links to the departed player or the bid belong to the chain view (step 6),
not to the fit.

**Back-test:** the latest classes with at least seven seasons are held out whole. At each checkpoint
(the draft, after year 1, after year 3) the parameters are refitted on the earlier classes, using
seasons up to that checkpoint only. Each held-out class's value line is cut at the last season read and
compared with the PAV its first stints produced up to that season. The artifact reports bias, mean
absolute error and RMSE per selection, by draft range and checkpoint and by class. HPN DPVC v3.0, the
old at-trade projection, is reported over the same selections at the draft. DPVC is a whole-career value,
so it is not cut.

**Modelling choices for the owner to confirm.** The spec leaves these open. Each is the simplest
defensible option, and each is also recorded in the artifact's `decisions`:

1. **Stint end:** appearances cannot show a delisting or retirement. A stint is read as ended at the
   first season the player appears for another club, or after two full seasons with no game for the
   club at the end of the record read at the checkpoint. The move season still counts if he also played
   for the drafting club in it. A return to the club after such a gap, with no game elsewhere, reads as
   one stint once the return is read.
2. **Survival and games:** Kaplan–Meier by band. A stint still running is censored. A season with fewer
   than 20 draftees at risk uses the pooled hazard of the last three supported seasons, and the last
   supported mean games stand in beyond support. To fit the expected first-stint games curve only, a
   censored stint is completed with its band's expectation.
3. **Functional forms:** the prior rate and expected first-stint games are log-linear in the slot, the
   same form as DPVC. The rate has no age or tenure term. Survival and expected games use seasons since
   the draft in place of age.
4. **Recent seasons weighted more:** weights 1, 2 and 3, oldest to newest. Z counts the unweighted games
   in the window.
5. **Expected games:** prior games + `rho` × (own mean games − prior mean games) over the form window.
   `rho` is fitted by least squares and clamped to [0, 1]. An injury lowers expected games but does not
   set them to zero.
6. **k:** the integer from 0 to 2,000 that minimises the games-weighted squared error between the
   blended rate and the rest of the observed stint's PAV per game. It is fitted on drafted players only.
   The traded-player prior (age and position) is not fitted yet.
7. **Horizon:** expectations sum the first 20 seasons after the draft. This is arithmetic, not a cap.
8. **Fit window and hold-out:** fit on drafts 2011–2025 with seasons 2012–2026. The back-test holds out
   2017–2019, the latest classes with at least seven seasons (the command refuses fewer).

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

## Implementation order

1. **Pre-2019 data:** calculate HPN PAV and games for 2011 to 2018 on the VM with the same governed season
   pipeline as 2019 to 2026, cross-checked against HPN's published values, and add the games read model
   for 2019 onward. The read model is in place (`modeling/playerSeasonGames.ts`) and reads each 2011 to
   2018 season the same way once its calculation is finalized. Seasons before 2011 have no second
   statistics source, so they fail closed and stay out of the fit window.
2. **Fit and back-test:** fit the first-stint pick curve, the survival curves and k; publish the back-test.
   Built ([Fit and back-test](#fit-and-back-test)). The fit and its back-test are a private artifact.
3. **Value lines:** build the value-line calculator and contract, at every checkpoint, for players and
   picks.
4. **Matched bids:** load the AFL points table and calculate each spent pick's share. Done for the asset
   ledger (#971: prices, shares, leftover picks and deficits); the trade story does not read the shares yet.
5. **Retire the old rules:** retire the traded-on-return valuation (grade rules v11 and v13 to v18) and the
   bundle split, then regrade on intrinsic value lines.
6. **Chains:** build the chain view, linking trades that share an asset, plus the compensation links.
7. **Preview:** a value line per club per trade over time, with each club's chains. The private page UI
   is in place on sample data (`/dev/afl-trade-stories`, "Private trade page" in the AFL trade intelligence
   architecture); it shows the story's values until value lines exist.
