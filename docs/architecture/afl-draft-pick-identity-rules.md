# Draft-pick identity rules

Status: implemented 2026-10-12 (statlyaus/Statly#853, #789): migration
`0273_draft_pick_identity_rules` enforces rules 1 to 6 at finalization, and the reconciler change in the
same change set builds candidates that satisfy them ([Implementation](#implementation)). Repairing the
promoted canonical state is a separate, owner-approved promotion. This is the contract for
what one `draft-pick:` id in an external reconciliation candidate may join, and which rules the
database, not the reconciler's judgement, enforces. Every count below was measured on 2026-10-12 against
batch ten (`realized-trade-grade-batch:6ec831a7…`, candidate `external-reconciliation:0b696b3b…`) unless
another scope is named. The same day, read-only on the grading database, every rule was measured across
all 36 stored candidates and against the promoted canonical state ([Measured across stored and promoted
state](#measured-across-stored-and-promoted-state)).

The architecture already states the principle: a nominal pick number is not a stable entitlement
identity ([source capability table](afl-trade-intelligence.md#source-capability-and-evidence-hierarchy)).
Nothing checks that one id names one pick: the finalize check only requires each lineage row's transfer
and selection to share its pick id with a usable custody row, and no trigger or index on the candidate
tables checks more.

## How pick ids are formed

`externalEvidenceReconciliation.ts` forms five kinds of pick id. Batch ten's 878 pick transfers, classified
by recomputing each kind's content address:

| Kind                  | Formed from                                                                                                                                                                                                                                                             | Transfers |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Entitlement (custody) | Draft year, draft type, round and original club; an Official AFL order observation carries the same id. The transfer matched it, except 157 of the 240 future picks here, whose own future-pick id coincides with it without a usable observation at the receiving club | 674       |
| Entitlement, no order | The same fields for a future pick no order observation confirms                                                                                                                                                                                                         | 52        |
| Eventual selection    | The player Draftguru states every hop of the pick was used on (#889); identified by elimination                                                                                                                                                                         | 90        |
| Number only           | Draft year, type, pick number and round, when nothing else matched (`currentPickNumberKey`)                                                                                                                                                                             | 61        |
| Unresolved transfer   | The transfer's own evidence row, for a future pick with no resolved original club                                                                                                                                                                                       | 1         |

An entitlement id is the pick itself (a club's round-N pick of a year; two picks of one club in one round
collapse to one id, which the reconciler already flags as `pick_identity_conflict` when one order page
shows both; batch ten has three such disputed entitlements, none traded yet). It legitimately carries
different
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

Cause, traced transfer by transfer on 2026-10-12 by re-running the reconciler, instrumented, on batch
ten's exact input (it reproduces candidate `0b696b3b…` byte for byte): every failure starts at a join that
compares a transfer's pick number with the pre-draft order, which was observed at another time. Draftguru
records no trade date, so the order's observation date cannot tell a trade-period hop from a draft-night
hop numbered by the live order that bids had shifted.

| Step that formed the wrong id                                                               | Rule 1 transactions | Rule 2 ids | Rule 3 ids |
| ------------------------------------------------------------------------------------------- | ------------------- | ---------- | ---------- |
| Chain spread: `joinSlotChains` gave a hop with no match of its own the chain's custody pick | 3                   | 4          | 3          |
| `uniqueShiftedSlot`: a differently numbered slot with the same original club and holder     | 1                   | 4          | 1          |
| `slotTransfersCorroborate`: a draft-night number equal to a pre-draft slot's number         | 0                   | 8          | 2          |

The eventual-selection join then grouped the mis-keyed transfer with the hops Draftguru states were used
on the same player, and kept the transfer's original club, which came only from the number join (a
current pick states no original club): that is every rule 2 failure. Rule 6 is the number-only key itself
(`currentPickNumberKey`), shared by any two transfers or a selection with one number. Of the 25 rule 5
failures, 17 are those number-only collisions and 8 are selections joined, by number and holder, to the
pre-draft slot sharing their number. 33 of batch ten's 40 lineage rows join a transfer to a selection of
a player other than the one Draftguru states that transfer's pick was used on.

## Rules

| Rule | Statement                                                                                                                                                                                                                                                                | Batch ten                     | Enforced                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- | ------------------------------ |
| 1    | One transaction moves an id at most once from one resolved club and at most once into one resolved club, and its numbered transfers of that id carry one number.                                                                                                         | 4 transactions, all merges    | Finalize: refuse               |
| 2    | An id's transfers and custody rows name at most one original club (rows with none are ignored).                                                                                                                                                                          | 16 ids                        | Finalize: refuse               |
| 3    | The stated outcomes on one id name at most one drafted player.                                                                                                                                                                                                           | 6 ids                         | Finalize: refuse               |
| 4    | One selection per pick id, and a pick's lineage rows name at most one selection.                                                                                                                                                                                         | 0 in all 36 stored candidates | Unique index; finalize check   |
| 5    | Where a staged Footyinfo route covers a selected pick, a transfer on the selection's pick id that is not a hop of the route is recorded as a conflict on that pick.                                                                                                      | 25 of 30 checkable picks      | Finalize: refuse if unrecorded |
| 6    | A number-only id is a placeholder: no two transfers in different transactions, and no transfer and selection, share one.                                                                                                                                                 | 44 transfers                  | Finalize: refuse               |
| 7    | When evidence cannot decide, the candidate records `pick_identity_conflict` under a `pick-custody:<pick id>` subject key (the pick may be a custody, entitlement or eventual-selection id) and leaves each transfer on the id its own evidence formed; it never chooses. | n/a                           | Reconciler; rules 1 to 6       |

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
Recording a rule 5 conflict under a `pick-custody:` key defers that pick: under the pick-side deferral its
custody and lineage rows are left out of promotion (`pickLineageDeferral.ts`). For a number-only id the
key is `pick-custody:<pick id>` with no observation time, which the deferral parses as the whole pick id.

How rule 6 is checked: eventual-selection ids legitimately span transactions, so the check must know an
id's kind. The database can work it out: `outcome_afl_trade_canonical_json` with `sha256` recomputes the
number-only, entitlement and unresolved-transfer addresses in SQL, and doing so reproduced batch ten's
classification exactly (674, 52, 90, 61 and 1), so no candidate contract change is needed. Of batch ten's
61 number-only transfers, 41 share an id with a selection and 44 break the rule in all. Number-only ids
affect no grade today: none of the 123 onward links uses one, and their 61 legs are graded without the pick
id (50 unused picks, 10 blocked for missing access evidence, 1 selected pick). In the candidate this is an
identity fix, not a grade fix; in promoted state it is not (below). Scoping number-only ids to their
transfer also means a number-only id can never carry an onward link (none does today), and the classifier
must name every id form explicitly: an unrecognised form would otherwise fall into the eventual-selection
bucket, which is identified by elimination.

## Measured across stored and promoted state

All 36 stored candidates, rules as stated above:

- **Rule 1** breaks in four candidates: batch ten (4 transactions), batch nine (2) and two from 2026-10-10
  (13 and 11). Two earlier candidates whose pick transfers have no resolved clubs at all (878 and 31
  transfers) are not violations, which is why the rule compares resolved clubs only.
- **Rule 2** breaks only in batch nine (12 ids) and batch ten (16), the two candidates prepared with the
  eventual-selection join (batch nine's run notes record #889 deployed before it was prepared): independent
  confirmation of the cause traced in the code.
- **Rule 3** breaks in every candidate since 2026-10-07: 29 ids at most, 17 in the promoted candidate
  `external-reconciliation:819c3cd4…`, 6 in batch ten. These merges predate the eventual-selection join,
  which merged 2026-10-11 at 21:33 UTC.
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
- **Rule 1 as a unique index.** An index on (candidate, transaction, sending club, pick) cannot be built:
  four of the 36 stored candidates already hold 15, 13, 1 and 2 duplicate groups. Finalization runs only on
  the open-to-finalized transition, so a finalize check binds new candidates without touching stored ones.
- **Lineage as a unique index on pick.** Ten picks in batch ten legitimately have several lineage rows.

## Enforcement

- Rules 1, 2, 3, 5 and 6 and the lineage half of rule 4 are added to
  `finalize_outcome_external_reconciliation_candidate` by migration `0273_draft_pick_identity_rules`, by
  the exact-anchor `replace()` pattern of migrations 0264 and 0272: the checks run just before the
  evidence-conservation check, and a refused candidate's error starts `Pick-identity rule N:`. Rule 6
  recomputes the number-only address with `outcome_afl_trade_canonical_json`; it is the only id form the
  rule needs to recognise, because the reconciler no longer writes it on a transfer (below).
- The selection half of rule 4 is the unique index
  `outcome_external_reconciliation_draft_selection_pick_key (candidate_id, pick_id)`. The lineage half
  follows from it, since a lineage row's pick must be its selection's (migration 0208), and is checked
  anyway.
- `src/server/aflTradeIntelligence/source/pickIdentityRules.ts` states the same rules over candidate
  content (`aflTradePickIdentityViolations`), so tests and read-only audits name exactly what
  finalization refuses.
- Each rule has an integration test that it refuses a violating candidate and accepts a lawful one: a
  renumbered entitlement, a future pick numbered later, a pick with no original club, a pick swapped back
  on draft night, a future-pick trade of a disputed entitlement, and one pick passed through three clubs
  in one transaction (`tests/outcomes-integration/afl-draft-pick-identity-rules-postgres.test.ts`).
- The read-only measurement above is repeated with the migration's exact SQL before it merges, and the PR
  lists every stored candidate and pick it would refuse.

## Implementation

The reconciler changes, in the order the reconciler applies them (`externalEvidenceReconciliation.ts`):

- **Number-only ids are scoped to their transfer** (`currentPickNumberOnlyId`): a numbered transfer no
  custody observation resolves takes its number plus its own evidence row, so it shares an id with no
  other transfer or selection (rule 6). A selection with no custody keeps the plain number key, which no
  transfer now carries.
- **A disputed entitlement's future-pick transfers take transfer-scoped ids**: when the order shows two
  picks of one club in one round, each transfer of that entitlement is its own pick until reviewed
  evidence says which.
- **No chain spread**: `joinSlotChains` no longer gives a hop with no custody match of its own the
  chain's custody pick. The hops it used to join are joined by the eventual-selection join where
  Draftguru states they were used on one player.
- **Number joins a transfer's own statement contradicts are refused** (`refuseContradictedNumberJoins`).
  A transfer's statement is what Draftguru says its pick became: the giving side's eventual selection
  and the receiving side's stated selection or "not used", keyed by the player's reviewed canonical id
  (else its Draftguru id); two that disagree state nothing. These are the statements the candidate's
  outcomes record, so the guards see every player rule 3 counts. Each transfer's tie to its custody pick is `stated` (a future pick whose own round and original club
  form the entitlement), `exact` (its sender, receiver and number are the slot's original club, holder
  and number, or a repeated observation proves the hop) or `number`. A drafted player whose stated or
  exact ties name one custody pick has that pick as its home, and its number joins to any other pick
  leave it; so do number joins to a pick whose original club the Footyinfo route for the player's
  selection does not start with. On each custody pick the remaining statements are compared by their
  strongest tie: every transfer stating anything but the strictly strongest leaves the pick, and a
  stated or exact one that leaves is recorded as a rule 7 conflict; when no statement is strictly
  strongest, every transfer with a statement leaves and the conflict is recorded. A transfer that leaves
  takes an id of its own: its number, or a future pick's entitlement scoped to the transfer.
- **The eventual-selection join keeps rules 1 to 3**: every hop of an admitted walk takes the original
  club of the pick the walk settles on (a current pick states none of its own; the trace shows each one
  it carried came from a number join). It records a conflict and re-keys nothing when a future-pick hop
  states another round or original club, when the walk would move the pick twice, or under two numbers,
  in one exchange, or when transfers already on the pick state another eventual selection.
- **A selection is keyed by the statements on its pick**: its pick is the one pick id every transfer
  Draftguru states was used on the selected player shares (one of them received by the selecting club).
  Only without such transfers is it joined to the order slot with its number and holder, and never to a
  slot whose transfers state another player, one another selection's transfers claim, or one whose
  original club the selection's Footyinfo route contradicts. Two selections joined to one pick (two
  observations of one slot under different numbers) both keep their number keys.
- **Rule 5 conflicts are recorded** (`recordBoardRouteConflicts`), and a pick with a recorded
  `pick-custody:` conflict gets no lineage row until reviewed evidence settles it.

Measured offline on batch ten's exact input (completion `d916ad94…`, the same identity resolutions and
deferral decision; read-only):

| Measure                         | Batch ten (`0b696b3b…`)                | New reconciler                                      |
| ------------------------------- | -------------------------------------- | --------------------------------------------------- |
| Rule 1 / 2 / 3 / 6 failures     | 4 transactions / 16 / 6 / 44 transfers | 0 / 0 / 0 / 0                                       |
| Rule 5 checkable / unrecorded   | 30 / 25                                | 240 / 0 (1 recorded conflict)                       |
| `pick_identity_conflict` issues | 3 (disputed order rows)                | 4 (the same 3, and 1 rule 5)                        |
| Traded-on legs the grader links | 257 of 263                             | 262 of 263                                          |
| Lineage rows                    | 40, 33 to another player's selection   | 402, each to the selection its transfer's player is |
| Pick transfers whose id changed | n/a                                    | 91 of 878                                           |

The one traded-on leg left unlinked is the 2025 Pick 46 North Melbourne sent Carlton. Its onward trade is
captured (Draftguru `2025-picks-brisbane-carlton-41`, Carlton to Brisbane as "Pick 38") and both hops
state Koby Evans, whom the Footyinfo board routes North Melbourne > Carlton > Brisbane at 38. Koby Evans
has no reviewed Draftguru identity, so the route cannot be read, and the walk reaches two custody picks
(North Melbourne's 46 and, by a shifted-slot join, Carlton's 51): a recorded `lineage_unresolved` issue,
not a source absence.

## Reconciler changes

Specified before the trace and carried out as [Implementation](#implementation) describes. The trace
refined one point: a current pick states no original club, so the eventual-selection join gives its hops
the settled pick's original club instead of refusing them; only a future pick's stated round and original
club can contradict the pick a walk settles on.

## Owner decisions

- **Sequencing.** Decided 2026-10-12: one change set, migration and reconciler together, then a regrade
  and a repair of promoted state.
- **Repairing promoted state.** The rules bind new candidates only. Canonical state already holds 16
  merged pick ids, and number-only ids that join 125 assets to other trades and 145 to draft selections by
  number alone. Repairing it means a new promotion that supersedes the affected event versions, and 173 traded-player arrival spells start at events of the
  current promotion, so a repair must carry or re-register them. Whether and when to repair is the owner's
  decision; the rules and reconciler change come first so a repair promotes correct ids. The repair is
  an ordinary deferred-lineage promotion of a new candidate (migration 0274): a promoted trade counts
  as already promoted only when every pick transfer keeps its promoted asset's pick id, so exactly the
  trades whose pick ids changed get a superseding version (a trade whose current version came from a
  promotion of reviewed pick lineage keeps its reviewed ids); custody whose observation is already
  canonical with the candidate's facts (matched by pick, time and holder, since the re-captured order
  pages give it new custody ids) is recorded as `promotedCustodyIds` and left unwritten. The arrival spells that
  start at a superseded version are re-registered afterwards.
- **Repairing promoted players.** The same promotion carries a player identity repair (migration 0277).
  When an external identity decision is re-targeted (a later revision of the same subject names the AFL
  Tables twin of a Draftguru-created player), the next candidate names the new player under unchanged
  transaction and transfer ids, which are keyed by the provider's native ids. A promoted trade counts as
  already promoted only when every player transfer also names its promoted asset's player, so a trade
  whose player was re-targeted gets a superseding version whose player asset cites the new decision. A
  re-review that keeps the same player changes nothing. A trade whose current version came from reviewed
  pick lineage is exempt here too, because rewriting it from the candidate would replace the reviewed pick
  ids. Such a trade keeps the old player until a reviewed path re-versions it.
- **Repairing promoted draftees.** The same promotion re-promotes a re-targeted draftee (migration 0278).
  A reviewed session correction cannot do it: it conserves every selection fact except evidence, so it
  can never change who was drafted. A draft counts as already promoted (`promotedDrafts`) only when every
  candidate selection is current canonical under the candidate's own player (a selection with no player,
  an unresolved and deferred identity, still compares its id alone). A draft that is current canonical
  except for re-targeted draftees records those selections as `resyncedSelectionIds`. The deferred
  promotion writes nothing of such a draft as a draft night, because its proposal has no session and
  writing the night again would create a second, session-less root (migration 0265). Instead the
  proposal carries one `promoted_session_resync` coverage entry per current session version holding a
  re-synced slot, with that version's date, precision and official name read from canonical state when
  the proposal is derived. The promoter writes one later version of that session root carrying only the
  changed slots, each naming the new player and citing its current identity decision, and refuses if
  the approved version is no longer current or its root is not session-keyed. A re-sync repairs the
  player alone (migration 0279). It keeps the pick id of the selection it re-versions and refuses a
  club change. So a changed selection needs its player and club resolved and must not be `disputed`,
  but it may be `unresolved` on the pick side, where its pick custody is not uniquely resolved. In the
  first rehearsal, 38 of 73 re-synced selections were in that state, and the candidate's pick id
  differed from the promoted one for 45 of them. Re-keying a promoted selection's pick is left to the
  pick identity repair, exactly as for the unchanged selections of the same night. Whole nights are never
  re-listed: under asset-scoped supersession (migration 0256) a version carrying fewer than half of the
  other slots is additive, so every other draftee's selection, asset and the spells that start at them
  stay current. This holds when the changed slot sits on version 1 of a night whose current version is a
  small scoped version 2 (the 2019 to 2021 nights the Cameron promotion re-versioned): the re-sync
  supersedes version 2 and retires only its own slot. The promoter checks this before it commits and
  refuses any re-sync version that would retire a slot it does not carry. Only the re-sync is relaxed
  this way; an ordinary draft write must still carry every recorded slot of its predecessor (#721). A
  re-review that keeps the same player changes nothing.

  What the re-sync leaves behind:
  - **The old draftee's selection** at that number is retired (0256 judges a selection by number). **The
    old draftee's asset** is not: 0256 retires an asset only when a later version carries an asset for
    the same player, and the re-sync carries the twin's. So the old asset stays current. It is excluded
    from arrival evidence only through identity currency: its decision was superseded by one naming
    another player, and `outcome_external_identity_current_decision` follows only same-target successors
    (migration 0254). A release-membership or archive reader that lists the current assets of a night
    sees both the old draftee's asset and the twin's at number N.
  - **Special entitlements.** An exercise that cites the old selection is no longer current, because
    the selection is retired. A special-entitlement custody edge that cites the old player's asset stays
    current, because the asset is not. Either needs its own reviewed special correction.
  - **Arrivals.** The twin's draft asset is evidence for a reviewed arrival-only (v4) spell, with the
    session's date bounds (`outcome_acquisition_arrival_event_current` accepts a re-sync version through
    `outcome_external_promoted_session_resync_version`). The v1 to v3 check
    (`outcome_acquisition_promoted_event_current`) has no such clause: a v1 to v3 spell cannot start at
    a re-sync version. Since migration 0280 the arrival check does not re-run
    `outcome_external_draft_sessions_exact` for a deferred candidate. It reads the re-sync version's
    stored coverage entry instead. The promotion insert guard already proved the exact coverage, and the
    candidate facts and proposal it read cannot change once the promotion exists. On the grading
    database one such check took 9 min 38 s before 0280. A migration that tightens the deferred branch
    of `outcome_external_draft_sessions_exact` must re-check existing deferred promotions explicitly.

- **Expected effect.** Splitting the 22 merged ids should let the 4 merged unlinked legs link if evidence
  allows, and may change the 20 route-confirmed links and 24 blocked legs on those ids. The net is measured
  after the reconciler change, not predicted.
