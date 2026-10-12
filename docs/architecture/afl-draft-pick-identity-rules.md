# Draft-pick identity rules

Status: proposed 2026-10-12 for owner approval (statlyaus/Statly#853, #789). This is the contract for
what one `draft-pick:` id in an external reconciliation candidate may join, and which rules the
database, not the reconciler's judgement, enforces. Every count below was measured on 2026-10-12 against
batch ten (`realized-trade-grade-batch:6ec831a7…`, candidate `external-reconciliation:0b696b3b…`) unless
another scope is named. The same day, read-only on the grading database, every rule was measured across
all 36 stored candidates and against the promoted canonical state ([Measured across stored and promoted
state](#measured-across-stored-and-promoted-state)).

The architecture already states the principle: a nominal pick number is not a stable entitlement
identity ([source capability table](afl-trade-intelligence.md#source-capability-and-evidence-hierarchy)).
Nothing enforces it: neither the finalize check nor any trigger or index on the candidate tables checks
pick identity today.

## How pick ids are formed

`externalEvidenceReconciliation.ts` forms five kinds of pick id. Batch ten's 878 pick transfers, classified
by recomputing each kind's content address:

| Kind                  | Formed from                                                                                                  | Transfers |
| --------------------- | ------------------------------------------------------------------------------------------------------------ | --------- |
| Entitlement (custody) | Draft year, draft type, round and original club, from an Official AFL order observation the transfer matched | 674       |
| Entitlement, no order | The same fields for a future pick no order observation confirms                                              | 52        |
| Eventual selection    | The player Draftguru states every hop of the pick was used on (#889); identified by elimination              | 90        |
| Number only           | Draft year, type, pick number and round, when nothing else matched (`currentPickNumberKey`)                  | 61        |
| Unresolved transfer   | The transfer's own evidence row, for a future pick with no resolved original club                            | 1         |

An entitlement id is the pick itself (a club's round-N pick of a year; two picks of one club in one round
collapse to one id, which the reconciler already flags as `pick_identity_conflict` when one order page
shows both). It legitimately carries different
numbers on different pages: Draftguru numbers each page as it then stood, and bids shift numbers on draft
night (the reconciler's own note on the eventual-selection join). So "more than one number on an id" is
not evidence of a merge: of 59 such ids, 19 are contradicted by any rule below.

## What reads pick ids

- The realized grader uses a pick id for one thing: following a traded-on pick to its onward trade
  (`realizedTradeGrade.ts`, the pick trail and the same-id fallback). A traded pick's outcome (selected,
  not used, traded on) comes from Draftguru's per-transfer disposition matched by player, receiving club
  and draft year, never from the pick id. The grader never reads a transfer's status.
- The trail walk chains every transfer on one id from club to club, so two picks on one id can form one
  plausible trail and be followed without any signal.
- The pick-side deferral treats `pick_identity_conflict` as pick-side for every subject key, but works out
  which picks to leave unpromoted only from `lineage:<transfer>` and `pick-custody:<pick id>|…` subject
  keys (`pickLineageDeferral.ts`).

## What is wrong today

Rules 1 to 3 below each show one id holding two picks, unless a source misstates the pick. Together they
find **22 ids** in batch ten, all entitlement ids, carrying 79 pick legs. Their measured effect on the
grade:

- 4 of the 6 `traded_on_return_unlinked` legs sit on them (two onward trades on one id). A fifth, 2023
  Pick 62, is very likely a merge the rules do not prove: Brisbane passes on a pick of that id that no
  captured trade gave it. The sixth, 2025 Pick 46, has no captured onward trade at all.
- 24 of the 134 `traded_on_return_blocked` legs sit on them.
- 20 onward-valued legs sit on them, and every one is confirmed by a Footyinfo route naming the same three
  clubs in order. Of all 123 onward links, 119 are confirmed that way and none of the other 4 sits on one
  of the 22 ids, so no grade measured here follows a link the evidence contradicts.

Cause, where verified: the eventual-selection join is the only step that changes a transfer's pick id
after it is formed, and it keeps the transfer's own original club when it assigns another entitlement's
id (`joinEventualSelections`). Every rule 2 failure therefore comes from it. Rule 1 and rule 3 failures
have not been traced to a step; the slot-chain join (which deliberately gives a chain one custody pick so
traded-on links survive) and the shifted-slot join are candidates, not established causes.

## Rules

| Rule | Statement                                                                                                                                                                 | Batch ten                     | Enforced                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------ |
| 1    | One transaction moves an id at most once from one resolved club and at most once into one resolved club, and its numbered transfers of that id carry one number.          | 4 transactions, all merges    | Finalize: refuse               |
| 2    | An id's transfers and custody rows name at most one original club (rows with none are ignored).                                                                           | 16 ids                        | Finalize: refuse               |
| 3    | The stated outcomes on one id name at most one drafted player.                                                                                                            | 6 ids                         | Finalize: refuse               |
| 4    | One selection per pick id, and a pick's lineage rows name at most one selection.                                                                                          | 0 in all 36 stored candidates | Unique index; finalize check   |
| 5    | Where a staged Footyinfo route covers a selected pick, a transfer on the selection's pick id that is not a hop of the route is recorded as a conflict on that pick.       | 25 of 30 checkable picks      | Finalize: refuse if unrecorded |
| 6    | A number-only id is a placeholder: no two transfers in different transactions, and no transfer and selection, share one.                                                  | 44 transfers                  | Finalize: refuse               |
| 7    | When evidence cannot decide, the candidate records `pick_identity_conflict` under a `pick-custody:` subject key and leaves each transfer on its own id; it never chooses. | n/a                           | Reconciler; rules 1 to 6       |

The four rule 1 transactions: Port Adelaide and West Coast 2021 (Pick 14 one way, Sydney's Pick 12 the
other), the Starcevich trade (Picks 16 and 22), the Petracca trade (Picks 7 and 8) and Brisbane and
Hawthorn 2025 (Pick 22 one way, Pick 17 the other). Rule 2 examples: Brisbane's own 2024 Pick 47 on the
Western Bulldogs' round-3 entitlement; Gold Coast's own 2023 Pick 27 on Fremantle's round-2 entitlement.
Rule 3 examples: Petracca Picks 7 and 8 name Xavier Taylor and Latrelle Pickett.

Why rule 5 records rather than refuses: the route and the transfers disagree, but the evidence does not say
which side is wrong. In 8 of the 25 the selection is on an entitlement id, and in at least one of those the
selection, not the transfers, appears mis-keyed: 2021 selection 32 was tied to Greater Western Sydney's
round-2 entitlement because the pre-draft order had that entitlement at 32 with Geelong, while Footyinfo
routes the pick Geelong used at 32 from Essendon. The other 17 are number-only collisions (rule 6). Of 253
selected board picks with a route, rule 5 can check 30 today: for 211 no transfer carries the selection's
pick id, and 12 are excluded because the selection's club differs or only Footyinfo states it.

How rule 6 is checked: eventual-selection ids legitimately span transactions, so the check must know an
id's kind. The database can work it out: `outcome_afl_trade_canonical_json` with `sha256` recomputes the
number-only, entitlement and unresolved-transfer addresses in SQL, and doing so reproduced batch ten's
classification exactly (674, 52, 90, 61 and 1), so no candidate contract change is needed. Of batch ten's
61 number-only transfers, 41 share an id with a selection and 44 break the rule in all. Number-only ids
affect no grade today: none of the 123 onward links uses one, and their 61 legs are graded without the pick
id (50 unused picks, 10 blocked for missing access evidence, 1 selected pick). In the candidate this is an
identity fix, not a grade fix; in promoted state it is not (below).

## Measured across stored and promoted state

All 36 stored candidates, rules as stated above:

- **Rule 1** breaks in four candidates: batch ten (4 transactions), batch nine (2) and two from 2026-10-10
  (13 and 11). Two earlier candidates whose pick transfers have no resolved clubs at all (878 and 31
  transfers) are not violations, which is why the rule compares resolved clubs only.
- **Rule 2** breaks only in batch nine (12 ids) and batch ten (16), the first two candidates prepared with
  the eventual-selection join: independent confirmation of the cause traced in the code.
- **Rule 3** breaks in every candidate since 2026-10-07: 29 ids at most, 17 in the promoted candidate
  `external-reconciliation:819c3cd4…`, 6 in batch ten. These merges predate the eventual-selection join.
- **Rule 4** holds in all 36. **Rule 5** applies only to batch ten, the one candidate with board picks.
- **Rule 6** breaks in 23 of the 29 candidates that have pick transfers: 220 transfers in the promoted
  candidate, 44 in batch ten.

Promotion `external-canonical-promotion:0d44778c…` (from candidate `819c3cd4…`, 2026-10-11):

- It copies the candidate's pick ids: all 870 promoted pick assets carry exactly the candidate's id.
  Batch ten has since re-keyed 213 of those 870.
- **16 current canonical pick ids each stand for at least two picks**: the promoted candidate's own
  outcomes name two or more different drafted players on each (its rule 3 merges).
- None of the four rule 1 merges reached canonical state; each pair is two distinct canonical picks, and no
  current canonical event holds one pick twice.
- 181 canonical pick ids on 252 assets are number-only. 125 of those assets share an id with an asset of
  another trade, and 145 share an id with a canonical draft selection, by number alone; in 95 of the 148
  asset-and-selection pairs the selecting club is not the club that received the pick (legitimate only if
  it was traded on).
- No entitlement id of this promotion is shared with a canonical selection, and it wrote no pick
  realization rows, so its only links from a traded pick to a selection are those number coincidences. (The only realization
  rows in canonical state are 7 from promotion `external-canonical-promotion:3aeb1161…` of 2026-09-30.)
- 173 approved acquisition spells (the traded-player arrivals) start at events of this promotion.

## Rejected after measurement

- **One number per pick.** Refuses real picks: numbers change legitimately, and all 878 pick transfers in
  batch ten have a season but no exact date, so no date order can tell a renumbering from a merge.
- **Follow onward picks only through custody or route-backed ids.** Aimed at number-only links, of which
  there are none. Custody-only would cut 15 onward links on eventual-selection ids, 14 of them confirmed by
  a Footyinfo route; custody-or-route would cut the 1 that is not, which Draftguru states hop by hop.
- **Every sender held the pick (continuity) as a refusal.** 16 of 355 entitlement ids break it, only 3 of
  them proven merges; candidates start in 2019, so a pick acquired earlier breaks it legitimately. It is a
  review signal.
- **Rule 1 as a unique index.** Four of the 36 stored candidates break it (15, 13, 1 and 2 duplicate
  groups); finalization runs only on the open-to-finalized transition, so a finalize check binds new
  candidates without touching stored ones.
- **Lineage as a unique index on pick.** Ten picks in batch ten legitimately have several lineage rows.

## Enforcement

- Rules 1, 2, 3, 5 and 6 and the lineage half of rule 4 are added to
  `finalize_outcome_external_reconciliation_candidate` in one migration by the exact-anchor `replace()`
  pattern of migrations 0264 and 0272; a refused candidate names the rule. Rule 6 recomputes id kinds with
  `outcome_afl_trade_canonical_json`.
- The selection half of rule 4 is a unique index on
  `outcome_external_reconciliation_draft_selection (candidate_id, pick_id)`.
- Each rule ships with an integration test that it refuses a violating candidate and accepts a lawful one:
  a renumbered entitlement, a future pick numbered later, a pick with no original club, and a pick swapped
  back on draft night.
- The read-only measurement above is repeated with the migration's exact SQL before it merges, and the PR
  lists every stored candidate and pick it would refuse.

## Reconciler changes

- `joinEventualSelections` never gives a transfer an entitlement id whose original club differs from the
  transfer's own, and never gives two transfers of one transaction the same id; it records rule 7's
  conflict instead.
- Each rule 1 and rule 3 failure is traced to the step that produced it before the slot-chain or
  shifted-slot join is changed.
- Number-only ids are scoped to their transfer (rule 6).

## Owner decisions

- **Repairing promoted state.** The rules bind new candidates only. Canonical state already holds 16
  merged pick ids, and number-only ids that join 125 assets to other trades and 145 to draft selections by
  number alone. Repairing it means a new promotion that
  supersedes the affected event versions, and 173 traded-player arrival spells start at events of the
  current promotion, so a repair must carry or re-register them. Whether and when to repair is the owner's
  decision; the rules and reconciler change come first so a repair promotes correct ids.
- **Expected effect.** Splitting the 22 merged ids should let the 4 merged unlinked legs link if evidence
  allows, and may change the 20 route-confirmed links and 24 blocked legs on those ids. The net is measured
  after the reconciler change, not predicted.
