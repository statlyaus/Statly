# Draft-pick identity rules

Status: proposed 2026-10-12 for owner approval (statlyaus/Statly#853, #789). The rules below are the
contract for what one `draft-pick:` identity in an external reconciliation candidate means. The
database enforces them when a candidate is stored or finalized, the grader enforces the one rule only
it can see, and the reconciler must produce candidates that pass them, recording a conflict instead of
guessing when evidence cannot decide. The rules bind candidates finalized after they ship; stored
candidates and promoted state are covered under [Owner decisions](#owner-decisions).

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
wrong.

The merges came from heuristics that let one chain member's match decide another's (`joinSlotChains`,
`uniqueShiftedSlot`), from the eventual-selection join spreading one custody pick along a path, and from
number-only keys that let a trade-period "Pick N" and draft-night selection N share an id. Nothing in the
database checked pick identity.

## Rules

Counts are read-only measurements on the genuine grading database, 2026-10-12, against batch ten's
candidate unless stated.

| Rule | Statement                                                                                                                                                                                                 | Batch ten                    | Enforced                                     |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | -------------------------------------------- |
| 1    | One transaction moves a pick at most once from one club and at most once into one club, and every numbered transfer of that pick in the transaction carries one number.                                   | 4 transactions               | Finalize check                               |
| 2    | A pick names at most one original club across its transfers and custody rows. Rows with no original club (concession picks under the deferral) are ignored.                                               | 16 picks                     | Finalize check                               |
| 3    | A traded-on pick is followed to an onward transfer only through an id backed by a custody observation or a staged board route. A number-only id never links two transfers; the leg grades unlinked.       | 15 of 123 onward-linked legs | Grader, checkable in the grade batch         |
| 4    | Where a staged Footyinfo board route covers a selected pick, every transfer of that pick is a consecutive hop of the route.                                                                               | 25 of 30 checkable picks     | Finalize check                               |
| 5    | All pick outcomes on one pick that name a drafted player name the same player.                                                                                                                            | 6 picks                      | Finalize check                               |
| 6    | A pick has at most one selection, a selection at most one pick, and a pick's lineage rows name at most one selection.                                                                                     | 0 (all 36 stored candidates) | Unique indexes                               |
| 7    | When evidence cannot decide which pick a transfer moves, the candidate records `pick_identity_conflict` (deferred under the pick-side deferral) and leaves the transfer on its own key; it never chooses. | n/a                          | Reconciler; rules 1 to 6 refuse its failures |

Notes:

- Rule 1 counts transactions. In the narrower form of a unique index on (candidate, transaction,
  sending club, pick), four of the 36 stored candidates already break it: 15 and 13 duplicate groups in
  two candidates from 2026-10-10, 1 in batch nine's, 2 in batch ten's. Stored candidates are immutable,
  so the rule is a finalize check on new candidates, not an index.
- Rule 3 is enforced by the grader because the database cannot see it: a number-only id is never
  custody-resolved and cannot form lineage (finalization already requires custody for lineage), so its
  only effect is the grader's onward link. 204 of 878 pick transfers sit on ids with no custody row, and
  15 onward-linked legs rest on one.
- Rule 4 can check only selected board picks: passed and removed board picks carry no number and so no
  pick. A selected board pick is tied to the selection with the same draft year and number and the same
  club; Footyinfo-only selections are excluded so a board cannot corroborate itself. Of 253 selected
  board picks with a route, 30 are checkable today; for the rest no transfer carries the selection's pick
  id. Most failures are number-only joins, for example a 2025 "Pick 21" traded Essendon to Carlton on the
  same id as draft-night selection 21, whose route is Gold Coast to Western Bulldogs.
- A pick's number legitimately changes between the trade period and draft night (bids, academy
  matches, compensation, order changes), Draftguru numbers each page as it then stood, and future picks
  have no number. A "one number per pick" rule would refuse real picks, and all 878 pick transfers in
  batch ten have a season but no exact date, so a date-ordered renumbering test is unusable. The rules
  therefore state what may join two numbers, not a ban on numbers changing.
- Rule 7 keeps the grade honest because the grader never reads transfer status: it follows a traded-on
  pick only through exactly one onward transfer of the same id (`realizedTradeGrade.ts`), so a transfer
  left on its own key grades `traded_on_return_unlinked`, blocked, rather than following a guess.

## Enforcement

- Rules 1, 2, 4 and 5 are added to `finalize_outcome_external_reconciliation_candidate` in one
  migration, patched by the exact-anchor `replace()` pattern of migrations 0264 and 0272, so a
  candidate that breaks one is refused with a message naming the rule.
- Rule 6 is unique indexes on `outcome_external_reconciliation_draft_selection (candidate_id, pick_id)`
  and the lineage table, created after confirming no stored row breaks them.
- Rule 3 is a grader change with a new grade-rule version, so batches before and after it are not
  silently compared.
- Every rule ships with an integration test that it refuses a violating candidate and accepts a lawful
  one, including a renumbered pick joined by a custody observation, a future pick numbered later, and a
  concession pick with no original club.
- Before the migration merges, the rules run read-only against the genuine database and the PR lists
  every stored candidate and pick they would refuse.

## Reconciler and grader changes this requires

- `joinSlotChains` gives a chain member a custody pick only when that member's own evidence matches it.
- `uniqueShiftedSlot` no longer joins a transfer to a slot by endpoints alone when a board route or
  custody observation contradicts it.
- `joinEventualSelections` records `pick_identity_conflict` when a path reaches two custody picks,
  instead of keeping the earliest, and does not spread a custody pick onto a hop whose number matches
  no custody observation unless the board route names that hop.
- The grader follows a traded-on pick only through a custody- or route-backed id (rule 3).

## Owner decisions

- **Expected drop.** These changes turn guessed links into conflicts: up to 15 onward links from rule 3,
  and the 56 onward-valued legs on suspect ids are re-decided, each either confirmed by evidence or
  blocked. Batch counts will get worse before they get better.
- **Promoted state.** Promotion `external-canonical-promotion:0d44778c…` holds 870 promoted pick assets.
  The proven rule 1 merges did not reach it: there, Gold Coast's picks 7 and 8 and West Coast's 16 and 22
  are four distinct picks, and no current canonical event holds one pick twice. But candidates since the
  promotion re-keyed 157 promoted transfers, so candidate and canonical pick keys disagree for those. The
  rules bind new candidates only; whether to reconcile the promoted keys (and the 173 arrival
  registrations that cite this promotion) is a separate decision.
- **Coverage.** Rule 4 checks 30 of 253 routed picks today. Its coverage grows only as rule 3's fixes
  tie selections to their real transfers.
