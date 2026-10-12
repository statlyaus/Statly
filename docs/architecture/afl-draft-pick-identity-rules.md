# Draft-pick identity rules

Status: proposed 2026-10-12 for owner approval (statlyaus/Statly#853, #789). The rules below are the
contract for what one `draft-pick:` identity in an external reconciliation candidate means. The
database enforces them when a candidate is stored or finalized; the reconciler must produce candidates
that pass them, and records a conflict instead of guessing when evidence cannot decide.

The architecture already states the principle these rules make enforceable: a nominal pick number is
not a stable entitlement identity
([source capability table](afl-trade-intelligence.md#source-capability-and-evidence-hierarchy)).

## Why

Batch ten (`realized-trade-grade-batch:6ec831a7…`, candidate `external-reconciliation:0b696b3b…`) merged
distinct picks into one identity. For example, one trade sends Gold Coast's 2025 picks 7 and 8 to
Melbourne, and both carry one pick id. Proven merges are the 4 transactions that break rule 1 and the 16
picks that break rule 2. A wider set is suspect: 59 pick ids carry more than one pick number, which a
legitimately renumbered pick also does, so they are not all wrong. The grader links picks only by id
equality, so a merged pick can follow the wrong onward trade without any signal: 200 pick legs on 155
trades sit on one of the 59 suspect ids, and 56 of them are valued through an onward link that may be
wrong. The merges came from heuristics that let
one chain member's match decide another's (`joinSlotChains`, `uniqueShiftedSlot`), from the
eventual-selection join spreading one custody pick along a path, and from number-only keys that join a
trade-period "Pick N" to draft-night selection N. Nothing in the database checked pick identity.

## Rules

Counts are read-only measurements on the genuine grading database, 2026-10-12, against batch ten's
candidate unless stated.

| Rule | Statement                                                                                                                                                                                                                     | Batch ten | Enforced                                                          |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------- |
| 1    | One transaction moves a pick at most once from one club and at most once into one club, and every numbered transfer of that pick in the transaction carries one number.                                                       | 4         | Finalize check                                                    |
| 2    | A pick names at most one original club across its transfers and custody rows. Rows with no original club (concession picks under the deferral) are ignored.                                                                   | 16        | Finalize check                                                    |
| 3    | A pick number alone is never an identity across dates: a trade-period "Pick N" shares a pick with draft-night selection N, or with another dated "Pick N", only when a custody observation or a staged board route ties them. | see below | Reconciler; rules 4 and 5 catch the failures the database can see |
| 4    | Where a staged Footyinfo board route covers a selected pick, every transfer of that pick is a consecutive hop of the route.                                                                                                   | 26 of 31  | Finalize check                                                    |
| 5    | All pick outcomes on one pick that name a drafted player name the same player.                                                                                                                                                | 6         | Finalize check                                                    |
| 6    | A pick has at most one selection, a selection at most one pick, and a pick's lineage rows name at most one selection.                                                                                                         | 0         | Unique indexes                                                    |
| 7    | When evidence cannot decide which pick a transfer moves, the candidate records `pick_identity_conflict` (deferred under the pick-side deferral) and leaves the transfer on its own key; it never chooses.                     | n/a       | Reconciler; rules 1 to 6 refuse what it must not do               |

Notes:

- Rule 1 cannot be a unique index: four of the 36 stored candidates already break it (two from
  2026-10-10 with 15 and 13 duplicate groups, batch nine's with 1, batch ten's with 2). Stored
  candidates are immutable and none of the four was promoted, so the rule applies to every candidate
  finalized after the migration.
- Rule 4 can check only selected board picks: passed and removed board picks carry no number and so no
  pick. Of 253 selected board picks with a route, 222 cannot be checked today because no transfer
  carries the drafted selection's pick id. Most of the 31 that can be checked break the rule through
  number-only keys (rule 3), for example a 2025 "Pick 21" traded Essendon to Carlton sharing an id with
  draft-night selection 21, whose board route is Gold Coast to Western Bulldogs. Whether the 222 are keyed
  apart correctly or split from their real transfers is measured again once rule 3 is implemented.
- A pick's number legitimately changes between the trade period and draft night (bids, academy
  matches, compensation, order changes), Draftguru numbers each page as it then stood, and future picks
  have no number. A "one number per pick" rule would refuse real picks, and all 878 pick transfers in
  batch ten have a season but no exact date, so a date-ordered renumbering test is unusable. Rule 3 is
  therefore stated as what may join two numbers, not as a ban on numbers changing.
- Rule 7 keeps the grade honest because the grader never reads transfer status: it follows a traded-on
  pick only through exactly one onward transfer of the same id (`realizedTradeGrade.ts`), so a transfer
  left on its own key grades `traded_on_return_unlinked`, blocked, rather than following a guess.

## Enforcement

- Rules 1, 2, 4 and 5 are added to `finalize_outcome_external_reconciliation_candidate` in one
  migration, patched by the exact-anchor `replace()` pattern of migrations 0264 and 0272, so a
  candidate that breaks one is refused with a message naming the rule.
- Rule 6 is unique indexes on `outcome_external_reconciliation_draft_selection (candidate_id, pick_id)`
  and the lineage table, created after confirming no stored row breaks them.
- Every rule ships with an integration test that it refuses a violating candidate and accepts a lawful
  one, including a renumbered pick joined by a custody observation, a future pick numbered later, and a
  concession pick with no original club.
- Before the migration merges, the rules run read-only against the genuine database and the PR lists
  every stored candidate and pick they would refuse.

## Reconciler changes this requires

- `joinSlotChains` gives a chain member a custody pick only when that member's own evidence matches it.
- `uniqueShiftedSlot` no longer joins a transfer to a slot by endpoints alone when a board route or
  custody observation contradicts it.
- `joinEventualSelections` records `pick_identity_conflict` when a path reaches two custody picks,
  instead of keeping the earliest.
- Number-only fallback keys are scoped so a trade-period "Pick N" and draft-night selection N never
  share an id without a tying observation (rule 3).

These changes will turn some legs that are linked today into conflicts, blocked or deferred. That is the
intended outcome: those links were guesses.
