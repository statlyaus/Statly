# AFL trade value-line method

Status: proposed 2026-10-17 for owner approval (statlyaus/Statly#789). It replaces the realized grade as a single
number. Grade rules v14 to v18, which add pick projections into realized value, are retired once this is
built. Every decision marked **Owner** was given by the owner on 2026-10-17. Every one marked
**Proposed** is a recommendation that this document asks the owner to approve.

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
  uses the original club's slot in the latest order. The proxy is flagged.
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
- **Pick traded on before use (Proposed):** realized at the onward trade, the same way. The pick takes its
  share of what its club got back, and follows those assets' value lines from then on.

## Bundles (Proposed)

When a club gives several assets for one return, each given asset's share of the return is split at each
checkpoint by the given assets' own values at that checkpoint. Once those values are known, this is the same
split by realized value as today. Before then it uses their expected values, which are now in the same unit,
so no projection is mixed into a measured figure.

## Data needed

| Input                                              | Source                                                                                                                               | Status                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| Season PAV, 2019 to 2026                           | HPN PAV calculations, official                                                                                                       | In the outcomes database   |
| Games per player-season, 2019 onward               | Match appearances already used by the PAV inputs                                                                                     | Stored; needs a read model |
| Season PAV and games before 2019                   | HPN's published PAV (**Owner:** fetched on the grading VM only, stored as immutable evidence, reviewed before use, as for Footyinfo) | To import                  |
| Draft slot, club, first-stint boundaries           | Reconciled candidate and acquisition spells                                                                                          | In place                   |
| AFL draft points table, bid points, matching picks | Official AFL bid-matching records                                                                                                    | To source                  |

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

## What this retires

- **Grade rules v14 to v18.**
  - v14 and v15 split bundles by projection.
  - v16 and v18 value matched-bid picks at their projection inside the realized return.
  - v17's round-position proxy feeds v18.
  - Both break the 2026-10-08 rule that a projection never feeds the realized value or the bundle split.
- **The realized grade as a single number:** replaced by the value line at the latest checkpoint.
- **Whole-career DPVC as the pick prior:** replaced by the first-stint pick curve. DPVC can still be shown for
  reference.

## Open questions for the owner

1. **Pick traded on before use:** realize it at the onward trade, as matched bids are (Proposed above)?
2. **Bundles:** split by each given asset's value at the same checkpoint (Proposed above)?
3. **Rookie and mid-season drafts:** same method on their own pick curves, or out of scope for the first
   release?
4. **Compensation and concession picks** (free agency, the Gold Coast and GWS concessions): value at the slot
   they were used at, like any pick?

## Implementation order

1. **Pre-2019 data:** import HPN PAV and games from before 2019 on the VM, and add the games read model for
   2019 onward.
2. **Fit and back-test:** fit the first-stint pick curve, the survival curves and k; publish the back-test.
3. **Value lines:** build the value-line calculator and contract, at every checkpoint, for players and
   picks.
4. **Matched bids:** load the AFL points table and calculate each spent pick's share.
5. **Retire the old rules:** retire grade rules v14 to v18 and regrade.
6. **Preview:** a value line per club per trade over time.
