# Public AFL Draft & Trade Outcomes

- Status: the legacy public archive, exact approved AFL Tables/Footywire/Fryzigg policy factories,
  persisted Gate and release registries, factual and valuation read contracts, normalized outcomes
  PostgreSQL migrations, durable object adapters, and the server-only public runtime composition
  exist. Public callers use that runtime and no longer hard-wire prepublication services. Disposable
  PostgreSQL rehearsals now cover the factual-release lifecycle, a separately governed,
  factual-release-bound synthetic valuation lifecycle, and a governed workbook-evaluation path over
  five completed AFL Tables seasons plus current official AFL evidence. Hosted infrastructure,
  production-grade provider custody, reviewed real-data releases, real-data model development,
  deployment, and production verification remain incomplete.
- Last verified against source: 2026-08-14

## Purpose

Statly's AFL Draft & Trade Outcomes capability is a public, non-fantasy research domain for historical
AFL transactions and the factual outcomes attached to them. Its first responsibility is to preserve
what moved, resolve public AFL identities and pick lineage, and report governed acquisition-spell
facts such as games, goals, votes, and awards. Its second mandatory program milestone is a separately
governed Trade Value Engine that publishes reproducible at-trade and current-outcome estimates only
after its real-data models pass the declared validation and release gates. Factual outcomes may ship
first and remain useful independently, but they do not replace the valuation milestone and do not
complete the overall program goal by themselves.

The original workbook is a private, frozen migration baseline and golden fixture only. It is not a
production source, interchange format, request-time dependency, downloadable product, generated
release output, or manually maintained competitor to the reviewed public release. The long-term
authority target is an isolated hosted PostgreSQL database; permitted raw HTTP responses and the
temporary migration workbook belong in immutable object storage under their exact retention policy.
After historical reconciliation closes, production contains no workbook reader, fallback, export
job, workbook-shaped table, or public workbook link. Neither PostgreSQL nor object storage is
authoritative merely because it is described here.

The capability is distinct from protected fantasy trading:

- public reads do not require a Statly account, fantasy league, membership, or roster;
- no Statly user owns a public AFL trade, player, pick, valuation, or lineage record;
- club custody means control by a real AFL club at an effective point in time;
- `LeagueTradeThread`, `LeagueTradeOffer`, fantasy roster ownership, and league authorization remain
  owned by the protected fantasy domain; and
- internal model review or publication controls use operational authorization, not fantasy roles.

## Program milestones and version-one scope

The program has two mandatory, independently releasable milestones:

1. **Factual AFL Draft & Trade Outcomes:** reviewed transaction, identity, lineage, acquisition-spell,
   games, goals, coaches-vote, Brownlow-vote, and supported achievement facts published from one
   release-scoped PostgreSQL authority.
2. **AFL Trade Value Engine:** separately reviewed at-trade, realized, remaining, and current-outcome
   distributions and grades derived from the approved factual corpus and validated model releases.

Milestone one must not be delayed by an unavailable model. Milestone two must not infer approval from
a factual release. The overall program is complete only when both milestones are production-verified.

Version one is constrained as follows:

- AFL men's transactions are the initial competition scope;
- the initial historical migration covers transactions from 1988 through 2025, after which recurring
  source captures and reviewed superseding releases replace workbook imports;
- annual acquisition evidence covers 2000 through 2025 and preserves `National`, `Rookie`,
  `Mid-Season`, `Pre-Season`, `Mini-Draft`, `Trade`, `Free Agency`, `Pre-Draft`, `Post-Draft`, and
  `Training Squad Selection` as distinct mechanisms;
- factual publication starts with games, goals, coaches votes, Brownlow votes, and evidence-bearing
  achievements where the approved source set and acquisition-spell rules support them;
- the richer valuation cohort is selected only after the provider, field, identity, and temporal
  coverage audit; source visibility or a successful fitzRoy call does not establish model support;
- salaries, contract amounts, injury histories, commercial value, and causal-impact claims are out of
  scope unless a later reviewed source and model release explicitly adds them;
- an at-trade assessment is a football-value estimate within those declared inputs, not a complete
  claim about every list-management consideration;
- a trade with unresolved required assets or unadjusted exclusions cannot receive a complete-trade
  grade; and
- workbook grades and legacy `Expected` and `Actual` fields are migration-only evidence and can never
  become Statly's authoritative assessment, grade, training label, or value unit.

## Source capability and evidence hierarchy

Source authority is field-specific. No provider wins globally, agreement is not treated as proof of
independence, and conflicts are never resolved by majority vote or silent overwrite. Each material
fact is published as `single_source`, `corroborated`, `disputed`, or `unresolved`. A dispute or
unresolved claim affecting a party, transfer direction, entitlement identity, custody edge, final
selection, or selected-player identity blocks every lineage-dependent assessment while preserving
the factual evidence for review.

| Fact                                                 | Primary evidence                                                 | Corroborating evidence                                            | Prohibited inference                                                          |
| ---------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Transaction occurrence and parties                   | Draftguru trade records                                          | Official AFL transaction reporting where available                | A missing page does not delete a transaction                                  |
| Assets received and surrendered                      | Reconciled Draftguru party packages                              | Uniquely addressable detail and official transaction evidence     | Display order does not imply transfer direction                               |
| Pick entitlement and custody                         | Statly reconstruction from transaction evidence                  | Official AFL current-order and trade-chain reporting              | A nominal pick number is not a stable entitlement identity                    |
| Final draft type, round, selection, club, and player | Footywire full draft tables                                      | Draftguru year pages and fitzRoy official-AFL player details      | Squad membership does not create a trade or custody edge                      |
| AFL player identity                                  | Official AFL provider identifiers through fitzRoy player details | Reviewed Footywire identities and aliases                         | Display-name equality does not merge players                                  |
| Games, goals, votes, and supported outcomes          | Governed fitzRoy provider observations                           | Other approved fitzRoy providers under field-specific policy      | Missing evidence is not zero and Footywire draft-table games are not imported |
| At-trade pick-value reference                        | Versioned HPN DPVC v3 formula artifact                           | Statly's independently fitted pick benchmark and held-out reports | HPN values are not transaction facts, grades, or current player outcomes      |
| Trade assessment and optional grade                  | Statly valuation publication                                     | None; this is derived output                                      | Source grades or provider values are never imported as Statly results         |

fitzRoy 1.7.0 exposes no draft-order, pick-custody, pick-lineage, or trade-transaction function. Its
official-AFL player-details adapter is valuable for provider player identity, draft year, draft type,
draft position, recruited-from, club, and season evidence from 2012 onward, while its statistical
providers remain the outcomes lane. Footywire's structured full-draft history and official AFL
current-order reporting therefore require separate bounded HTTP capture adapters; they must not be
misrepresented as fitzRoy capabilities.

HPN DPVC v3 is a public reference formula, not a recurring scraped dataset or a source of factual
transaction claims. Its immutable benchmark artifact records the formula
`careerPav(p) = -30.36 * ln(p) + 146.95`, the `career_pav` value unit, supported national-draft
selection domain 1 through 90, 1993 through 2006 Draftguru cohort, father-son exclusion, reported
`R² = 0.73`, source URL, capture digest, version, and attribution. It is benchmark-only, permits no
extrapolation, and is ineligible for rookie, pre-season, mid-season, mini-draft, restricted-access, or
unresolved selection claims. HPN PAV cannot be added to a Statly player or pick estimate in another
unit; complete-trade composition requires an identical authenticated value-unit definition or a
separately validated conversion model.

## Product contract

The factual product answers three questions before any valuation is considered:

1. **What happened:** which AFL clubs participated and which players, picks, future-pick
   entitlements, or other recorded consideration moved.
2. **What each club received:** the resolved public identity, pick lineage, and real-club acquisition
   spell for every supported asset.
3. **What was subsequently recorded:** source-grain games, goals, votes, and awards, with an exact
   evidence cutoff, metric definition, coverage status, and release identifier.

A measured zero is distinct from missing, unavailable, unresolved, or not-applicable evidence. Public
outcomes describe recorded contribution and coverage; they do not by themselves establish causal
impact, objective fairness, or a trade winner. Each public response must identify the reviewed factual
release and its effective-through date.

The archive and factual outcomes must remain useful when numerical valuation is unavailable,
withdrawn, stale, or unsupported for a cohort. The mandatory valuation milestone answers four
distinct questions when an eligible model publication is active:

1. **At-trade decision value:** the distribution of future contribution knowable at the transaction
   date.
2. **Realized club contribution:** contribution delivered to a club after the transaction, stopping
   when the player leaves that club.
3. **Remaining value:** forecast contribution after a stated valuation date.
4. **Current outcome distribution:** a present-day combination of realized contribution and remaining
   value using an explicitly identified valuation bundle.

These views must never be silently combined with each other or with factual metrics. Every numerical
response identifies its value unit, valuation view, effective date, knowledge cutoff, publication,
valuation bundle, and uncertainty.

Permitted language describes model estimates, distributions, assumptions, and evidence. Public copy
must not claim objective fairness, causal certainty, or an unqualified winner or loser.

## Current repository state

The public archive now resolves one immutable active release from the isolated AFL-outcomes
PostgreSQL database. Server-only read helpers load only approved transaction, party and asset versions
that belong to that captured release, then project the public trade, detail and club views without a
Firestore fallback. No active release produces an honest empty archive. The separate development
workbook adapter remains available only when explicitly enabled with a pinned local artifact; the
workbook is never queried by the production request path.

The previous versioned Firestore collections and mutable `draftMeta/currentVersion` pointer are legacy
compatibility data, not an archive authority. Public archive reads no longer resolve that pointer or
default collection names. PostgreSQL release registration, typed membership, validation and active
pointer changes use the isolated factual release boundary. This keeps public AFL records anonymous and
prevents fantasy User, League, roster or membership state from owning them.

The public `/draft/outcomes` page and `/api/draft-trades/outcomes` route now expose a strict
`afl-draft-trade-outcomes/v1` read contract for games, goals, coaches votes, Brownlow votes, and
evidence-bearing achievements. The boundary preserves checked zero, missing, partial, differing,
single-source, and unavailable states; requires exact release metadata, metric definitions, scope,
effective-through dates, and source references; structurally rejects fantasy/user identifiers; and
prevents unresolved player identities from carrying checked facts. An active read uses the metric
definitions captured with that exact release, validates each evidence reference and fact cutoff
against them, and rejects repository rows outside exact requested year and metric/status predicates.
The repository owns governed alias, abbreviation, normalization, and text-index matching semantics.
The production-shaped composition reads an active factual release when one exists, never calls a
workbook or Firestore fallback, and returns no rows when no release is active. The annual-workbook
evaluator is a pure staging/evaluation boundary, not a request-time importer or permission to publish
its values.

An explicitly enabled non-production adapter may load one absolute-path, SHA-256-pinned workbook for
local development. It projects archive transactions and acquisition-link candidates from the same
cached workbook load. Workbook-recorded game totals remain labelled source text and cannot satisfy a
factual outcome input. A development calculation admits games, goals and votes only through an
explicit reconciled acquisition-spell result with an effective-through date; when no such result is
supplied, every outcome metric remains unavailable rather than becoming zero or a workbook-derived
partial value. Conservative linkage requires an exact same-year receiving-club match plus player
identity evidence for traded players, or supported draft selection and player evidence for drafted
players. Future picks, missing drafted players, ambiguous matches, and missing reconciled outcomes
remain unresolved rather than receiving invented value.

The development model uses only reconciled fixed-horizon historical outcomes known before each trade,
optionally augmented by genuinely reconciled AFL Tables, Footywire, or Fryzigg season observations
when supplied.
It emits bounded at-trade, realized, remaining, and current summaries with explicit coverage and
confidence. A single versioned policy converts the at-trade and current comparison distributions to
Statly grades from A+ through D. The policy uses an equal-party baseline, conditions out practical
equivalence, withholds a grade below 70% coverage, and labels partial, stale, retained, or
low-confidence results provisional. Workbook grade, `Expected`, and `Actual` cells are prohibited
model inputs. The adapter is `publicationEligible: false`, is disabled in production, and cannot
substitute for a governed real-data model publication.

This development adapter is transitional. It exists only to exercise historical reconciliation and
golden cases while the sourced pipeline is built. Cutover deletes it from runtime composition and
removes its public preview path; it is not retained as a local or production fallback.

The migration-only workbook staging boundary treats the immutable `.xlsx` bytes as the raw evidence. A
bounded OPC/OOXML evidence reader validates content types, relationship types, and well-formed XML;
preserves physical sheet order and visibility, row and cell coordinates, complete cell/formula
attributes, styles, shared-string structures, workbook date epoch, cached values, errors, explicit
styled blanks, and every hyperlink relationship before a separate cooked-value reader interprets observable cell values. Cooked values
are staging conveniences, never a claim to be the original cell representation. One workbook creates
one artifact-level, append-only import run containing the all-row ledger and every issue. Its annual
and trade-year partitions are deterministic membership views over those same row identities, not
fabricated captures or duplicated source rows. The capture explicitly lists every AFL season covered
by the artifact, and persistence reloads and reparses the exact custody bytes under a transaction-level
advisory lock before writing authenticated raw-plus-cooked rows, independent sheet/hyperlink evidence,
partition membership, and exceptions atomically. Staging status
never grants release eligibility: reviewed normalization creates later evidence-bearing canonical
records and release membership. No workbook is generated from a release, offered to a user, or
accepted as a recurring production update after sourced cutover.

The trade-ledger subset has a separate content-addressed review boundary. It authenticates the exact
workbook import, every transaction row, every party row, and complete transaction grouping while
excluding the annual metric rows and their independent review issues. Each transaction begins
`pending`; an approval must bind that exact subject, resolve every party to a distinct canonical club,
and explicitly confirm that the assets beside a listed club were received by that club. Decisions
remain private migration-oracle evidence with publication prohibited. A workbook shadow-oracle fact
set can be constructed only when every exact subject has one current approved decision. Pending,
rejected, duplicate, superseded, or subject-mismatched decisions fail closed and cannot become factual
release members. Even a complete workbook review does not replace provider capture and reviewed
canonical promotion: it makes the frozen oracle comparable to provider-backed facts, not authoritative
on its own.

Migration `0049_workbook_transaction_reviews` retains that set, its exact subjects, immutable
decision history, and one guarded current-head pointer per subject in disposable PostgreSQL. Set
registration re-authenticates the approved private workbook capture, exact staging manifest, raw
artifact digest, and complete staged trade-row membership. Decisions use trusted database time and
must advance the exact current head; stale writes and mutation of retained evidence fail closed. The
three local commands are deliberately separate: `outcomes:workbook:prepare-transaction-review`
registers a set against an explicit retained import run,
`outcomes:workbook:inspect-transaction-review` exports pending/current review work, and
`outcomes:workbook:record-transaction-review` records one explicit operator decision with party-order
canonical club identities and direction confirmation. Each command authenticates the disposable
loopback runtime before reading private evidence or decisions. None auto-approves subjects, creates
provider facts, grants model rights, prepares a release, publishes, or activates anything.

The source-independent factual release boundary now defines content-addressed candidate, projection,
and activation-authorization manifests. A candidate pins the archive dataset, source snapshot and
evaluation sets, acquisition-spell rule, metric definitions, reconciliation and exception evidence,
counts, scope, effective-through time, and the complete Gate 0A receipt for every source snapshot. Each
receipt preserves the exact audience, access method, operations, field uses, retention, cache, rights
artifact, and decision that were evaluated. Its projection pins the exact list, trade-detail, club,
player, year, dashboard, and supporting API datasets plus a passed parity report. A separate
deterministic registry requires expected-revision compare-and-swap for registration and every
transition, rechecks current Gate 0A and Gate 4 decisions at activation, and requires Gate 4 and Gate 5
decisions to pin the exact factual release/projection. Gate 5 remains the comprehension/accessibility
decision; a distinct expiring operational authorization pins the environment, scope, release,
projection, parity report, expected revision, rollback window, and engaged write barrier. Activation
supersedes the prior release atomically; withdrawal removes the active pointer without silently
selecting a predecessor; recovery requires fresh validation, review, and authorization. Strict command
parsing and a content-addressed global event chain make malformed, accessor-bearing, forged, or
tampered in-memory state fail closed. A registry-derived selector can produce the exact public read
snapshot, but it is not mounted by the application because no durable approved registry exists.

The activation-time Gate 0A check re-evaluates the complete bound source-rights proposal and original
request at the activation timestamp. It therefore rechecks terms expiry, conditions, decision scope,
audience and commercial/geographic restrictions, operations, retention, cache, and the exact sorted
source fields consumed by each snapshot; every consumed field must have exactly one public-display use.
The operational authorization must also remain inside both its expiry and rollback windows at
activation. Selection is not permanently authorized by activation: every active capture loads the
current Gate 0A ledger and re-evaluates the bound source terms at the serving timestamp, so an expired,
withdrawn, superseded, or narrowed source decision fails closed even before an operator withdraws the
release.

The source-independent WP1, modeling, and valuation foundations are implemented separately from those
existing archive reads. They provide strict public contracts, source-governance and artifact-manifest
schemas, bitemporal lineage rules, deterministic fabricated fixtures, attribution invariants,
publication state transitions, a player-contribution baseline harness, draft-pick and future-pick
distribution harnesses, and a complete-trade valuation artifact chain. The operational layer adds
immutable calculation runs and attempts, pure lease and retry transitions, content-addressed schedule
decisions and dispatch claims, operational-health recommendations, and append-only model-change
reviews. The modeling and valuation modules can fit deterministic benchmarks, run simulations,
compose aligned component draws, calculate package distributions, produce snapshots and structured
explanations, and evaluate locked predictions supplied through their contracts. Fabricated fixtures
now establish the complete local publication lifecycle against disposable PostgreSQL, but the modules
still do not read production evidence, configure a live queue or scheduler, establish approved
real-data performance, or activate a production projection. The separate WP7A public boundary adds an
honest unavailable-state experience, contract-ready numerical views, and a general methodology page;
the local fixture publication is not evidence that a real-data numerical valuation exists.

The governed calculation-input boundary now separates a stable, non-production pre-execution
`valuation-input-bundle` from its later execution/output manifest. Prepared-input-set v1 is a
source-policy preflight only: it classifies every transaction in the exact factual-release membership
as blocked and cannot assert a model-ready calculation input. Migration
`0048_prepared_valuation_input_sets` re-authenticates that complete transaction membership and the
exact release and membership artifact references. It names the exact
`valuation_model_training_and_derived_feature_creation` operation, distinguishes the year-specific
valuation scope from the factual release's own scope, retains the complete durable source-rights
ancestry declared by that release, and records only the subset of sources that actually block the
operation as per-trade blockers. The PostgreSQL qualification writer obtains trusted database time,
the exact release membership, and exact rights rows before constructing an immutable qualification
report for both blocked and eligible outcomes. Registration re-authenticates those parents,
recomputes the exact policy result, finalizes atomically, and enforces exact replay and append-only
custody. A blocked prepared-input set must reference that exact report and repeat its complete blocker
decision; a raw rights proposal or transient positive result cannot grant dataset or model authority.
The current local AFL Tables 2021-2025 player-stat policies permit private derived-feature creation
and model training under their exact non-production Gate 0A receipts. The separate official-AFL 2026
and AFL Tables 2026 results policies still block model training, and every policy blocks public use.
The local readiness command
and admitted private workbook UI therefore read the latest retained report for its still-active
factual release and its bound blocker set from disposable PostgreSQL. If no current report exists,
readiness says qualification has not run; it does not reconstruct policy from code, invoke a scorer,
infer new rights, or substitute a zero value. The workbook
review service no longer imports or exports the legacy name/year/pick value projection: it exposes
factual transaction records plus a separately labelled, publication-prohibited synthetic scenario.
A later ready-input contract must use the existing authenticated dataset admission and
admitted-model-run authorities, require both exact current Gate 3 component runs, and retain and
exactly read back every bounded input and trace artifact before finalization.
There is intentionally no caller-injected "governed" writer or real scorer in this phase: the next
stage must obtain trusted database time and authenticate the exact release, input-bundle custody,
dataset admissions, and both current Gate 3 model runs in one PostgreSQL snapshot before it may create
the first ready-capable construction plan.

Migration `0050_private_valuation_evaluation_authority` adds the narrower authority needed before
that next stage can use retained real evidence for internal calculations. This append-only decision
is supplemental to source rights: it binds one non-production factual release, its exact membership
artifact, and the complete exact source-rights ancestry declared by the release, without changing any
provider proposal. An authorization permits only private local non-production derived calculations
for internal evaluation. Its schema and PostgreSQL trigger fix model training, public display,
redistribution, production activation, live capture, and publication to false; direct insertion of a
content-addressed decision that grants any of them fails authentication. Decisions use trusted
database time, advance one exact current head, and can be withdrawn so calculation admission fails
closed immediately while the immutable history remains.

The five-season provider rehearsal has reviewed player-match evidence that is not a member of the
transaction-shaped factual release contract. Migration
`0051_private_reviewed_evidence_evaluation` therefore adds a separate
`retained_private_review` lane instead of inventing factual-release ancestry. Migrations
`0081_corrected_local_review_lineage` and `0082_complete_local_reviewed_evidence` correct its local
capture lineage and define the completed-bundle contract that includes AFL Tables 2026 results. A
current content-addressed bundle must authenticate the two exact current review sets, every
deterministic current review receipt, seven retained source captures and immutable source
artifacts—five AFL Tables player-stat
captures for 2021–2025, one official-AFL player-stat capture for 2026, and one AFL Tables results
capture for 2026—and three exact source-rights artifacts. The current rehearsal bundle contains
48,781 reviewed candidates and 146,343 current decisions. PostgreSQL rechecks the complete review-set
health and exact artifact custody when the bundle is registered, whenever the append-only
authorization head changes, and whenever calculation admission is assessed. One missing,
superseded, altered, or normalization-incomplete capture invalidates the whole lane; partial counts
and zero-valued fallback are not admitted.

This lane is permanently private and non-production. It is not a factual release, dataset admission,
model-training input, public fact set, publication candidate, production activation, or live-capture
authority. Its decision schema and database trigger permit only derived calculations for internal
evaluation and fix every broader permission to false. The workbook readiness read model prefers this
lane when present, reports its exact counts and bundle identity, and fails closed if its review sets
stop being current. The operator command is
`outcomes:modeling:record-private-reviewed-evaluation-authority`; it requires the authenticated
disposable loopback `statly_outcomes_test` runtime and an exact expected current decision ID for every
withdrawal or restoration.

Operators record or withdraw this authority only through
`outcomes:modeling:record-private-evaluation-authority`, against a runtime-authenticated loopback
`statly_outcomes_test` database and either an exact release ID or the currently active release in an
explicit factual-release scope. The private archive and detail views read the same current decision.
Authorization is not a numerical result: until exact reviewed player/pick inputs and their governed
model execution boundary exist, readiness continues to say calculations are unavailable and never
substitutes workbook values, synthetic values, or zero.

WP1 completion therefore means that later work has a deterministic boundary to build on. It does not
mean that a historical source is approved, object storage or managed PostgreSQL is operational, a
reconciled factual corpus exists, a factual outcome release is reviewed, a model is approved, a
publication is active, or the feature is release-ready.

The protected fantasy Prisma schema currently targets SQLite. Its platform-wide PostgreSQL cutover is
planned and unexecuted, but it is not the migration path for this public capability. The trade engine
now has a separate normalized Prisma schema and forward-only PostgreSQL migration history, but no
deployed or authoritative relational store. Its selected deployment target is an independently
migrated managed PostgreSQL database, or an isolated database and role on an approved managed
PostgreSQL service, with separate credentials, connection budgets, migrations, backups, and restore
evidence. The public schema contains no `User`, fantasy `League`, membership, roster, or fantasy-trade
ownership relation.

The repository has an authenticated, exact-identifier, in-memory valuation-artifact read adapter and a
pure factual release selector over deterministic registry state. It also contains a separate,
source-independent PostgreSQL schema and native migration history plus an injected-client registry
adapter that persists the pure registry's emitted event chain and expected-revision pointer in one
read-committed transaction with an explicit global-head row lock and revision compare-and-swap. The
second migration adds immutable artifact custody, capture attempts and successful snapshots, idempotent
imports and source rows, public clubs and players, reviewed identity assignments, matches and
null-preserving metric observations, versioned AFL events and typed assets, every workbook acquisition
mechanism, draft selections, pick lineage, corrections, acquisition-spell rules and versions,
reconciliation, exceptions, and typed release membership. Raw provider identities remain immutable;
review creates an append-only assignment rather than rewriting source evidence. Release and
event-chain foreign keys prevent dangling evidence; native triggers bind the active pointer to its
exact activation event, require gap-free version chains, reject mutation of analytical evidence, and
admit only approved typed release members within the release cutoff. Shared transaction-scoped locks
serialize child insertion, release membership, and registry publication. Event versions and their
parties, assets, selections, observations, and lineage require same-release source-capture provenance;
player-bearing facts also require the exact reviewed identity assignment in that release. Metric
definitions are immutable versions, measured zero remains distinct from unavailable evidence, and
spell evidence cannot extend beyond the release cutoff. Finalized import and reconciliation runs are
append-only. Projection manifests remain append-only versions so a superseded release can complete a
fresh validation cycle, and projection items carry an explicit non-null identity key within their
exact projection.
The injected `pg` pool adapter commits or rolls back as one unit and never discovers configuration.
This persistence slice remains inactive for production. The complete normalized migration history,
disposable real-PostgreSQL rehearsal, supported repository verification, production build, cleanup,
and review complete the engineering foundation only. Exact command results and execution identities
belong in the delivery record. No provider credentials are configured, and application composition
still selects no factual release. There is no provisioned durable object repository, hosted factual
PostgreSQL target, production registry, or trusted external decision-evidence registry for this
capability. These local contracts and rehearsals do not establish production durability, approve any
fixture decision, or make a release active in the application. Do not describe the analytical
PostgreSQL target, object storage, factual release views, or valuation artifact source as ready; do not
apply the protected fantasy schema or SQLite migration history to them or introduce the public schema
into an unapproved target.

The source-independent Stage 2A rehearsal now exercises two explicit fitzRoy factual layers in the
disposable real-PostgreSQL harness. First, a deterministic `non_production` provider envelope passes
the Gate, attested capture, custody, decoder, field-map, normalization, governed player/club and match
resolution, appearance/metric fact, and factual-reconciliation contracts. That layer conserves and
exactly replays one private content-addressed candidate without publication. Second, the local release
rehearsal promotes reviewed baseline and replacement generations into separate immutable captures,
events, assets and gap-free acquisition-spell versions; seals their release candidates; and executes
registration, validation, approval, activation, supersession, explicit rollback, no-fallback
withdrawal, and freshly authorized recovery. The recovered replacement is verified across the
PostgreSQL read service, local API adapter, archive-page response, persisted projection, all declared
view artifacts, and release-pinned JSON, CSV and valid OOXML export bytes. This activation exists only
inside the generated disposable schema. It uses no live provider access, cloud service, schedule,
hosted deployment, valuation model, production authority, or protected fantasy data.

The same disposable harness now proves local database recovery for that exact release state. It uses
the container's PostgreSQL 16 tools to create a custom-format dump, closes the scoped pool, destroys
the generated schema, verifies the schema is absent, and restores it in one transaction. New
connections must reproduce the sealed candidates, full 15-event lifecycle, recovered active pointer,
projection, service, API, archive response, and authenticated JSON, CSV and OOXML exports byte for
byte. This is disposable local recovery evidence only; it is not evidence for hosted retention,
point-in-time recovery, cross-host recovery, disaster recovery, or production restore authority.

The development-only current-evidence coordinator owns exactly seven governed source lanes in a
caller-owned disposable `statly_outcomes_test` PostgreSQL database: five completed AFL Tables
player-stat seasons for 2021–2025, official-AFL current-season player-stat evidence for 2026, and one
separately governed AFL Tables completed-results capture for 2026. The six player-stat captures are
expected to contain 57,621 staged player-match rows in a real-data run. The seventh capture supplies
the third source-rights artifact and completed-match universe required by the corrected
reviewed-evidence contract. Capture rights, field maps, receipts, decoder provenance, raw-object
digests, and staging outcomes remain independently attributable to their source decisions. Local raw
custody uses the explicit `local_non_production_filesystem` profile and confers no hosted durability,
redistribution, production, or recurring-capture authority.

Those local capture-rights artifacts permit bounded capture, raw/hash retention, internal quality
evaluation and private derived-feature creation. Model training, public derived output, public fact
display and raw redistribution are blocked at both field-use and operation scope. Before any staging mutation,
the caller must authenticate the exact loopback `statly_outcomes_test` runtime nonce. Retained
historical rows become eligible only after the exact five-season evidence digest has three current
local receipts per admitted row and one complete-set admission decision. Retained official rows
become eligible only after one atomic exact-set review records current per-candidate identity,
concluded-match and local reconciled player-match approvals. Finalized normalization alone is
insufficient in either path.

The private workbook evaluator may project only accepted, unambiguous staged rows into reconciled
acquisition-spell outcomes. Zero-valued source cells that are indistinguishable from missing data,
unresolved identities, and unsupported workbook links remain review work and cannot silently become
facts. The official 2026 evidence currently supports 12 concluded St Kilda appearances and one goal
for Sam Flanders through 28 May 2026; that season remains explicitly right-censored. The workbook's
recorded zero is preserved as source input but does not override those post-trade observations.
Missing evidence remains unavailable rather than becoming zero. This path is private development
evidence only: it does not itself approve a public factual release or make the workbook authoritative.

The same private page may also render a **private calculation scenario** beside the reviewed evidence.
A scenario is a content-addressed, deterministic set of explicitly synthetic assumptions used only to
exercise the source-independent valuation calculation. Its assumed transfer directions, asset
lineage, contribution draws and package policy are not observations, reconciled facts, review
decisions or release members. The scenario result must retain its assumption-set identity and
`publicationEligible: false`; it cannot satisfy factual-release ancestry, valuation-publication
preparation or a public-read repository. Reviewed evidence and scenario output are separate lanes:
an unavailable fact remains unavailable even when the corresponding scenario produces a number.

For a two-party workbook trade, the scenario may assume that an asset received by one party was sent
by the other party. Because the workbook does not record a sending club for each asset, a multi-party
scenario requires an explicit deterministic fixture transfer map. Both forms are labelled assumptions
and are prohibited from becoming canonical lineage. Structurally malformed trades remain unavailable
with an exact reason rather than receiving fabricated completeness.

The interactive `test_fixture` archive uses a separate deterministic volume corpus so local archive
behavior is not judged from a one-record page. It seals 783 transactions across 1988–2025: one
source-shaped 2025 rehearsal transaction and 782 unmistakably synthetic generated transactions. All
members traverse the same reviewed-identity, reconciliation, canonical-promotion, factual-release,
public-archive and projection boundaries. The expanded source-rights artifact authorizes only this
checked-in local fixture across its 1988–2026 evidence span; it grants no access to a provider,
workbook, live source or production environment. The private migration workbook remains outside
runtime composition and is not copied into this corpus. Generated evidence is labeled
`statly_local_fixture` with `fixture://statly/` references throughout identity, capture and
reconciliation state. The live provider-ingestion boundary does not accept that provider value.

A separate valuation-publication rehearsal consumes that governed factual archive without changing
its release authority. It fabricates deterministic `test_fixture` contribution evidence for the
exact active archive, the one source-shaped trade, factual candidate, and release identifiers; seals
baseline and replacement valuation bundles, custody indexes, publication manifests, projection
manifests, and fixture-only Gate 4 and Gate 5 decisions; and activates only the valuation publication
pointer in the same disposable PostgreSQL schema. The active value scope is the actual public-read scope,
`public-afl-trades-current`, while the factual scope and release pointer remain unchanged. Direct
value reads, both valuation APIs, projection exports, and the source-shaped archive detail page must
resolve the same publication and projection identifiers. Archive-only synthetic trades remain factual
members of the same release but return `not_calculated`; they never inherit or fabricate the governed
trade's numerical result. The lifecycle proves baseline activation, replacement,
explicit rollback to baseline, no-fallback withdrawal to the prior empty value scope, and recovery
through a still-eligible non-withdrawn candidate. A withdrawn publication cannot be republished.

The valuation rehearsal is intentionally not a rights or readiness transition. Its authority kind is
`fixture`, its environment is `test_fixture`, and its evidence is fabricated and
`productionEligible: false`. It performs no live capture and grants no Draftguru model-training,
derived-feature, or public-display rights. Factual release approval does not authorize a valuation;
valuation approval does not mutate, replace, or strengthen the factual release. The harness dumps,
destroys, and restores the combined schema, then re-authenticates both registries and reproduces the
archive detail, value service, API data, archive-page inputs, and projection export exactly. This is
local restore evidence only and confers no hosted backup, deployment, production activation, or
provider authority.

Interactive local serving uses the same immutable-artifact repository interface as hosted serving,
but a distinct `test_fixture` adapter persists canonical envelopes below the ignored
`.statly-local/afl-trade-artifacts` root. The seed process and Next.js therefore resolve the same
content-addressed projection bytes across process boundaries without S3, AWS credentials, or a
network fallback. Runtime configuration is discriminated by environment: `test_fixture` requires an
absolute local artifact root, while `non_production` and `production` continue to require complete S3,
KMS, repository-policy, and region configuration. Local filesystem custody must never be selected for
a hosted environment. It reports the distinct `fixture_filesystem` assurance with no custody profile
and an unencrypted-local-filesystem identity; it does not claim provider durability, encryption,
retention, residency, transport, or recovery assurance.

### Maturity-review acceptance criteria

The broader Statly data-platform maturity review identified contract drift, name-derived player IDs,
perspective-dependent match IDs, direct partial writes, missing-to-zero coercion, fragile live loops,
component-only tests, and multiple legacy writers in the fantasy statistics path. Those findings are
accepted as failure patterns to prevent here, not as a reason to combine the two authorities. The
public archive continues to use public AFL identities and has no foreign key to a fantasy player,
lineup, user, league, or roster.

The archive program therefore adds these explicit acceptance criteria:

- one versioned archive contract owns field names and metric-definition versions across capture,
  staging, PostgreSQL release records, public reads, supporting API datasets, and tests;
- provider player identities remain immutable observations and can publish only through a reviewed
  canonical public-player assignment; duplicate or renamed people remain quarantined until resolved;
- match identity uses a provider fixture identifier or a reviewed order-independent fallback over
  competition, season, round, home club, and away club; player perspective never forms the key;
- every capture writes to an immutable run and staging scope, records a manifest and checkpoint, and
  becomes visible only through one complete validated factual release; a failed run cannot mutate the
  active release;
- missing, unavailable, partial, quarantined, and measured zero remain distinct through capture,
  reconciliation, spell calculation, valuation, and public display;
- the end-to-end golden corpus executes representative Draftguru, Footywire-draft, official-AFL,
  fitzRoy, and migration-workbook fixtures through staging, identity review, release publication, and
  public reads, including duplicate names, renamed players, missing fields, a DNP, a bye, a disputed
  selection, and a corrected source row;
- production scheduling must provide durable locks, retries, checkpoints, missed-period
  reconciliation, freshness/completeness SLOs, alerts, quarantine counts, and rollback evidence; and
- every legacy writer is classified as supported, read-only diagnostic, historical migration, or
  prohibited. Firestore may receive a validated release projection during migration but cannot be a
  fallback authority or a direct ingestion target.

fitzRoy is the selected technical adapter family for obtaining compatible AFL statistical evidence.
Standing production approval covers the named AFL Tables, Footywire, and Fryzigg player-stat
capabilities for their exact reviewed fields and uses; it does not extend to other upstreams. Every
capture must name the
exact upstream, function/parameters, package version, retrieval time, source grain, and permitted
fields. The repository's existing Footywire-through-fitzRoy ETL supplies live-stat evidence for
fantasy calculations; that path neither supplies historical trade/pick lineage nor establishes
permission to retain, derive, display, or model data for this separate public product.

The executable capability contract is
`src/server/aflTradeIntelligence/source/fitzRoyProviderCapabilities.ts`. It pins fitzRoy `1.7.0`,
calls direct provider functions rather than source-selecting wrappers, and deliberately returns a set
of technical candidates rather than one global provider priority. A capability is not publishable
until its upstream has an approved source decision and representative capture evidence confirms its
season, schema, identity, null, duplicate, and correction behaviour.

| Evidence lane            | Direct functions in the capability contract                                                                            | Selection rule                                                                                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Match-grain player facts | `fetch_player_stats_afl`, `fetch_player_stats_afltables`, `fetch_player_stats_footywire`, `fetch_player_stats_fryzigg` | Official AFL and AFL Tables are primary candidates for different measured eras; FootyWire is a supplementary candidate from 2010; Fryzigg remains reconciliation-only until capture reliability is proven. |
| Match universe           | `fetch_results_afl`, `fetch_results_afltables`                                                                         | Select by competition, season, identifier coverage, and parity with the chosen player-stat lane. Never count a returned player row without a reconciled match universe.                                    |
| Player identity          | `fetch_player_details_afl`, `fetch_player_details_afltables`, `fetch_player_details_footywire`                         | Prefer stable provider identifiers; names and club/season context support review but cannot automatically merge ambiguous people.                                                                          |
| Coaches votes            | `fetch_coaches_votes`                                                                                                  | Treat AFLCA as its own upstream lane, available from 2006 subject to capture verification; per-round scrape failures are missing evidence, not zero votes.                                                 |
| Brownlow votes           | `fetch_player_stats_afltables`, `fetch_awards_brownlow`                                                                | Prefer match-grain evidence when supported; use the FootyWire season table as a separately captured reconciliation source.                                                                                 |
| Achievements             | `fetch_awards_allaustralian`, `fetch_rising_star`                                                                      | Verify each season and mode independently; fixed-position HTML parsing cannot establish completeness by itself.                                                                                            |

Three player-stat functions ignore `round_number` and return season data:
`fetch_player_stats_afltables`, `fetch_player_stats_footywire`, and
`fetch_player_stats_fryzigg`. Scheduling and idempotency are therefore provider-specific. AFL Tables
may combine a `fitzRoy_data` cache with a live delta and can conditionally replace numeric missing
values with zero; FootyWire may combine cached matches with newly scraped matches; and Fryzigg reads a
complete remote RDS object before filtering. Capture records must preserve those origins, and Statly
must never infer a measured zero solely from the normalized returned cell.

## Proposed target architecture

This is the architecture proposed for Gate 1 review, not evidence that its infrastructure is ready or
authorized. The generic gate-decision ledger records any eventual Gate 1 decision. There is no
separate Gate 1 receipt: an immutable decision is audit evidence, not a replayable runtime permission.

```text
source-rights proposal
  -> externally authorized Gate 0A decision
  -> content-addressed Gate 0A evaluation receipt
  -> immutable Draftguru, Footywire-draft, official-AFL, and fitzRoy/upstream snapshots in object storage
  + private frozen workbook evidence during migration only
  -> content-addressed evidence manifest
  + pre-registered data-sufficiency protocol
  -> content-addressed coverage report
  -> externally authorized Gate 0B decision
  + content-addressed current-state snapshot
  -> complete architecture decision package
  -> externally authorized Gate 1 decision
  -> staging, field validation, identity resolution, and exception review
  -> normalized source-grain facts in the approved isolated PostgreSQL target
  -> externally authorized Gate 2 decision
  -> immutable factual-outcome candidate
  -> reviewed factual-outcome release and atomic release pointer
  -> release-scoped public outcome views and supporting API datasets
  -> public factual service, outcome explorer, trade detail, club, and year views
  + mandatory program milestone 2 through an independently releasable valuation path:
      feature dataset manifest
      -> pre-registered player-contribution model protocol
      -> reproducible model-run manifest
      -> externally authorized Gate 3 decision pinning the protocol and run
      -> immutable candidate-publication manifest
      -> rebuildable projection manifest
      -> externally authorized Gates 4 and 5
      -> atomic active-publication pointer
      -> valuation service and trade-detail model views
```

### Authority by concern

| Concern                                        | Proposed long-term authority                         | Constraint                                                      |
| ---------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------- |
| Source permission and intended use             | Reviewed source-rights register                      | Technical access is not permission                              |
| Raw upstream snapshots and migration workbook  | Immutable content-addressed object storage           | Workbook is migration-only; retention follows exact terms       |
| Import runs, evidence metadata, and exceptions | Isolated outcomes PostgreSQL database                | References immutable source objects; failed rows remain visible |
| Public AFL identities                          | Isolated outcomes PostgreSQL database                | Source identities; no fantasy ownership or foreign key          |
| Trades, parties, assets, and club custody      | Isolated outcomes PostgreSQL database                | Normalized, relational, and bitemporal                          |
| Games, goals, votes, and awards facts          | Isolated outcomes PostgreSQL database                | Preserve source grain and null-versus-zero semantics            |
| Asset lineage and acquisition spells           | Isolated outcomes PostgreSQL database                | Versioned rules with conservation and custody invariants        |
| Reviewed factual-outcome releases              | Append-only PostgreSQL release records and views     | Independent pointer; candidates never leak into public reads    |
| Supporting public API datasets                 | Release-derived PostgreSQL projections               | Rebuildable from one reviewed release; never reverse authority  |
| Feature and model artifacts                    | Immutable object storage with analytical metadata    | Optional valuation path; reproducible from manifests            |
| Valuation snapshots                            | Append-only analytical PostgreSQL/artifact releases  | Separate lifecycle and pointer from factual outcomes            |
| Public HTTP routes                             | Thin transport adapters over release-scoped services | No workbook, raw object, staging, or unreviewed-candidate reads |

### Isolation contract

The public engine uses a separate database boundary even if an approved provider hosts it on the same
managed PostgreSQL service as another Statly workload. It has its own database, least-privilege roles,
pooled and direct connection secrets, migration history, backup and restore policy, connection budget,
monitoring, retention controls, and operational owners. The protected fantasy `DATABASE_URL` and
Prisma migration history are never accepted as trade-engine configuration.

The analytical schema owns public AFL source identities. It may store reviewed cross-source mappings,
but it must not reference fantasy users, leagues, memberships, rosters, league trades, or ownership
records. AFL club custody is a public football fact, not Statly-user ownership. A future cross-product
link is an explicit read-model mapping with independent authorization, not a relational ownership
edge.

The public site reads only release-scoped PostgreSQL read models selected by one atomic factual-release
pointer. A cache or rebuildable serving projection may accelerate those reads, but it does not become
authority and cannot select a different release independently. `draftMeta/currentVersion` continues
to select the legacy Firestore archive only during migration and is not the target release mechanism.
The engine can join an archive trade, factual outcome, or published valuation only through stable
public source identifiers and an exact archive dataset identity recorded by the corresponding
release. A missing or mismatched join yields an honest unavailable state; it never falls back to a
workbook lookup or legacy `Expected`/`Actual` field.

Redis may coordinate locks, queues, and caches but never owns durable analytical state. A projection
failure must not cause Firestore, CSV, or a client fallback to become canonical.

## Gate 1: architecture and authority

Gate 1 exists to approve or reject a complete design. It does not make a proposed database, artifact
store, projection, or active pointer authoritative. Four states must remain separate:

1. **Architecture decision:** an externally authorized Gate 1 decision accepts an exact
   content-addressed design package.
2. **Infrastructure readiness:** controlled observations demonstrate that the selected real stores
   satisfy the package's integrity, temporal, bounded-read, capacity, retention, parity, and rollback
   criteria.
3. **Operational authorization:** a separate, current decision authorizes named operators to perform
   one bounded authority-transfer operation.
4. **Authority transfer:** an expected-revision compare-and-swap event activates the target for one
   authority concern. Until this succeeds, the prior authority remains current.

A content address proves that bytes are unchanged. It does not authenticate an issuer, prove a
capability claim, establish independent review, or authorize an operation. Production evidence must
therefore be resolved through a trusted external registry at the owning command boundary. Runtime
code must re-resolve current decisions and current authority; it must not treat a previously returned
decision, package, or event as bearer authority.

### Current-state snapshot

Every Gate 1 package references an exact `architecture-current-state:` snapshot. The snapshot pins a
repository revision, inspection commands, evidence references, one current observation for every
authority concern, unresolved questions, and the following required findings:

- the protected fantasy relational provider is currently SQLite and is not the engine's target;
- the legacy archive uses a cached Firestore pointer and default-collection fallback;
- malformed or missing legacy numerical fields may be coerced to zero;
- search performs a separate pointer lookup and fallback;
- archive import mutates the pointer without revision CAS, demonstrated parity, or last-good rollback;
- the protected fantasy PostgreSQL cutover is unexecuted and the independent analytical PostgreSQL
  target is not provisioned;
- an approved durable immutable artifact adapter is absent; and
- a trusted decision-evidence registry is absent.

The snapshot is a reproducible repository assessment with `productionClaim: false`. It cannot claim
that inspected infrastructure is production-ready or that its evidence is independently true.

The source-independent custody boundary now supports arbitrary byte artifact references, exact
put-if-absent repository semantics with first-writer canonical metadata, bounded exact reads, and content-addressed complete-reference
read-back receipts. A source-snapshot manifest distinguishes workbook capture from fitzRoy capture and
binds the source register/provider/dataset/version, original filename or exact
upstream/package/function/arguments, raw artifact, Gate 0A proposal/decision/receipt, captured fields,
retention duties, and chronology. Source-rights proposals and Gate 0A receipts use versioned v2
contracts, while the v3 source snapshot requires a successful content-addressed fitzRoy capture
receipt for automated captures. A workbook must match its approved provided-artifact media type,
while a fitzRoy request and capture must identify one capability in the pinned capability registry,
fitzRoy version, and direct provider function. Workbook snapshots require a closed
extension/format/media-type match; fitzRoy argument artifacts must predate authorization. Its
in-memory repository is named and documented as fixture-only. Immutable object creation time is
separate from each capture's observation time, so a retry may reuse identical bytes while retaining a
new authorization, read-back, and capture receipt.

The durable-custody layer adds content-addressed profiles for raw source, capture metadata,
private derived artifacts, and public projections. Profiles separate encryption requirements,
maximum deletion deadlines, withdrawal duties, optional WORM minimums, residency, object limits, and
immutable infrastructure evidence. An impossible WORM/withdrawal or WORM/maximum-retention policy is
rejected. The provider-neutral repository derives profile-scoped fanout keys, performs only atomic
create-if-absent, preserves first-writer metadata, HEAD-checks before allocation, version-pins bounded
reads, and independently hashes returned bytes; an ETag is always opaque. Its injected S3 transport
uses `If-None-Match: *`, full SHA-256 checksums, KMS encryption, immutable metadata, version/ETag
preconditions, and bounded streaming. It cannot construct clients, discover credentials, list, copy,
delete, change ACLs, or manage buckets. Read-back v2 exposes fixture versus durable assurance and the
custody profile; source snapshots require raw-source custody appropriate to their decision
environment. fitzRoy capture uses separate raw-source and capture-metadata repositories.

These contracts and adapters neither capture the local workbook, choose or provision a storage
provider, authorize source use, nor prove that an external bucket's encryption, lifecycle, lock,
residency, audit, restore, or access policies are ready.

The provider-specific capture runtime seals direct fitzRoy execution behind Gate 0A. Its
R 4.5.1 image is pinned by immutable Rocker digest, its fitzRoy 1.7.0 dependency graph is locked, and
its R allowlist mirrors the executable capability registry. The coordinator content-addresses the
exact canonical invocation before evaluation, persists and read-back verifies it only after mechanical
eligibility, executes no provider process when Gate 0A is blocked, and accepts only the exact
unmodified RDS object plus canonical diagnostics.
It rejects runtime/image/lock drift, argument-digest mismatch, timeouts, oversized or zero-row output,
exact duplicates, warnings, missing or out-of-scope season/round evidence, and any returned field
outside the complete Gate authorization. Returned
field order, R class/storage semantics, missing/NaN/infinity counts, factor levels, timezones, and
observable season/round/date evidence are retained before normalization. It neither invents minutes
nor imports the fantasy FootyWire normalizer, Firestore processor, or public request path.
Every season-bearing function must match its one authorized season. Broader AFL Tables rescrapes,
historical official-player-detail requests, and player-detail functions without a season-bound source
request are technically disabled until Gate 0A can represent and authorize their full retrieval
scope.

fitzRoy does not expose raw upstream response bytes or dependable cache-versus-live origin for every
function. The exact RDS is therefore exact fitzRoy-returned evidence, not a claim of raw upstream
custody or source completeness; the diagnostic records `not_exposed_by_fitzroy`, and that limitation
remains a Gate 0B concern. Source policy for the exact AFL Tables, Footywire and Fryzigg player-stat
capabilities, exact per-capability decision factories, atomic durable Gate 0A persistence,
provider-keyed distributed admission, signed egress receipts, durable object custody and
capture-to-PostgreSQL staging composition are implemented. Production execution is permitted only
after the reviewed command has loaded the exact current field manifests and provider-condition
evidence and the deployment injects a conformance-tested object repository, pinned image executor,
clustered admission store, trusted egress keyring and isolated outcomes database. The fixture path
remains explicitly no-network. A production capture resolves Gate 0A and the exact rights artifact
from the durable repository immediately before retrieval, and staging independently authenticates the
signed egress receipt before accepting the source capture. Replaying a manifest's
embedded decision chain proves internal consistency but cannot by itself prove that no later
withdrawal or superseding decision exists.

After exact RDS custody, provider observations pass through a second, deliberately narrower boundary.
The pinned R decoder has explicit row, field, cell, cell-byte and output-byte bounds, verifies the RDS
digest and runtime identities, rejects unknown column or frame attributes, and emits ordered typed
values that keep integer, finite double, signed zero, typed missing, NaN, infinities, factor, date and
timestamp evidence distinct. TypeScript recomputes the ordered schema fingerprint and requires the
capture receipt value; a caller-supplied schema label cannot authorize drift.
The authenticated diagnostics row count is also an equality condition, not only an upper bound: a
decoder that emits a subset fails before normalization.

Normalization requires an immutable reviewed field map bound to the exact capability, fitzRoy version,
ordered schema, competition, invocation-argument digest and season range. Reviewed source fields define
natural keys, and required bindings or non-finite key components quarantine the row. Identity-only
player-detail maps may omit a source season field but remain scoped by the authorized capture season;
they cannot carry match, metric, or achievement claims. AFL Tables player-stat zeroes remain
quarantinable because that pinned path may replace missing numerics with zero. Missing votes, awards,
or player rows are never negative facts. Games are
not calculated here: a validated match-grain player row is only an appearance candidate until the
match universe and identities are reconciled.

Every decoded RDS row is staged once even when interpretation fails. Attached match, player, metric,
and achievement records are unresolved candidates, not canonical entities. Name-only candidates are
row occurrences; order-independent match fingerprints are review inputs rather than automatic match
assignments. One content-addressed normalization run binds the decoder version and digest, normalizer
version, exact field-map interpretation, and a digest of the ordered rows, candidates, and issues. It
writes the package under the capture-scope lock, then performs one database-enforced finalization
transition. Exact row/candidate/issue counts, a required-finalization trigger, late-child guards,
append-only triggers, and exact replay checks prevent partial or conflicting imports. Both successful
and failed attempts authenticate the embedded fitzRoy capture receipt rather than trusting caller
labels. This lane is always `publicationEligible: false` and cannot write canonical,
release, projection, Firestore, or fantasy state. Reviewed identity and match resolution is the next
boundary.

### Governed provider identity and match resolution

Provider candidates can enter canonical AFL reference data only through a versioned resolution case;
normalization itself never merges a name. Each proposal is bound to the finalized normalization run,
the exact approved field map, source row and candidate digest, the complete blocking-issue set, and an
approved native-ID namespace whose competition, capability, scope and season interval cover the
candidate. Overlapping current namespaces are forbidden. A provider-native player or club identifier
may therefore resolve only inside one current governed namespace, while a name-only player remains a
candidate occurrence and cannot create a reusable provider identity.

The decision boundary authenticates an operational principal independently of fantasy users and
requires current, retained custody for the review method, target snapshot, supporting evidence,
reviewer authority, alias policy and normalization policy. Caller-supplied roles or hash-shaped
references are insufficient. Each governed evidence reference is the SHA-256 of an exact canonical
JSON payload whose bytes are retained under the same digest and environment; the payload does not
contain its own digest or artifact identifier. Non-fixture evidence approval is commit-gated to an
environment-specific governance-registry database role that is distinct from the resolution writer,
so the resolution boundary cannot mint its own trust root. Reviewer authority is additionally bounded to the
proposal's provider, capability, competition and season. Blocking normalization issues require a
one-to-one set of current, approved issue-closure decisions. Native-ID namespaces carry the capture
environment and their approvals use the isolated governance-registry role; production and
non-production issue decisions use separately provisioned identity-issue reviewer roles. The
resolution application writer cannot self-approve either prerequisite, and fixture-only approvals
cannot cross into another environment. Resolution, review-decision and reusable-assignment histories are
single-root, linear, gap-free correction chains with monotonic knowledge time and serialized
compare-and-swap heads. Superseding or withdrawing a decision cannot leave an earlier assignment
silently current.

Canonical player and club targets must already be approved. A reviewed match target must bind the
same competition, season, round, UTC date and order-independent home/away fixture evidence as the
staged proposal, plus the exact current club-resolution and active provider-assignment decisions for
both sides. Canonical match rows are provider-neutral; provider-native and reviewed fixture keys live
only in governed match identities. Pre-existing provider keys are moved once into an append-only legacy
migration table and cannot be written back to the canonical row. Provider identity roots and
decision-versioned occurrences are append-only; only protected
derived heads are mutable. Rejected, ambiguous, incomplete or stale evidence remains quarantined and
publication-ineligible. This boundary still does not create match/player statistical facts, calculate
games or goals, publish a release, or write any fantasy ownership state.
Legacy NULL-namespace identities and legacy assignments are grandfathered for migration reads only;
new non-fixture inserts are rejected. Disposable `test_fixture` captures retain an isolated bridge for
the existing PostgreSQL regression harness and cannot authorize another environment.

### Gate 1 decision package

An `architecture-decision-package:` artifact must include every section below exactly once:

- `current_state`;
- `target_schema_integrity`;
- `temporal_correction`;
- `bounded_reads`;
- `immutable_artifacts`;
- `projection_parity`;
- `migration`;
- `rollback`;
- `retention`;
- `capacity`;
- `operations_ownership`;
- `activation_retirement`; and
- `rejected_alternatives`.

The package carries one current and proposed target authority for each concern: relational domain
state, legacy archive, analytical records, immutable artifacts, public projection, and publication
activation. A changed authority must declare a transition; an unchanged authority must not. Every
target remains `proposed_not_authoritative`, and every current authority remains unchanged until an
authorized activation. The package schema fixes readiness to `not_asserted`, operational authorization
to `not_granted`, authority transfer to `not_executed`, and production claims to false. A Gate 1
proposal may reference the package as governed evidence; only the generic gate-decision ledger can
record the external approval.

### Operation prerequisites

`afl-trade-architecture-operation-policy/v1` is a declarative necessary-condition matrix. It never
returns an authorization result. Gate 1 is one prerequisite for feature datasets and model runs, and
the design prerequisite for corpus materialization and authority transfer, but transfer also requires
current authority and a separate operational authorization. Projection candidates require Gate 3 and
are then reviewed by Gate 4; making Gate 4 a prerequisite to build its own review artifact would be
circular. Publication activation and public numerical serving require both Gates 4 and 5. All upstream
source, sufficiency, lineage, and model gates remain conjunctive.

The existing public archive read is explicitly scoped as `legacy_trade_archive_only`. Missing new
engine gates do not retroactively disable that non-numerical archive path. Conversely, the exemption
cannot be used to serve a new trade-intelligence number.

### Authority-transition ledger

The append-only `authority-transition:` ledger starts with exactly one authority for every concern and
derives current authority from immutable events:

- `prepared` records the exact design package, Gate 1 decision, observed readiness evidence,
  operational authorization, operator authorization, passed parity checkpoint, planned write barrier,
  and rollback window; the old authority remains current;
- `activated` requires the latest registry revision, the same transition identity, an engaged write
  barrier, and an open rollback window; only this event changes current authority;
- `rolled_back` may restore the prior authority only inside that window and advances the authority
  epoch so stale readers cannot confuse the restored authority with its earlier incarnation; and
- `retired` may close an unactivated preparation or retire the prior authority after an activated
  transition's rollback window has closed.

Events form both a global hash chain and a per-concern hash chain. Transition keys are globally unique,
only one transition may be active per concern, revisions are contiguous, and every actual authority
change advances an epoch. Invalid or tampered ledgers resolve no current authority.

The implemented ledger is pure deterministic contract code and resolves authority only in
`test_fixture`. Non-fixture ledgers fail closed until a trusted evidence verifier exists. It does not
persist a registry, inspect a real PostgreSQL or object-store capability, authenticate a production
operator, verify an external decision issuer, execute a write barrier, migrate data, or change a live
pointer. Those adapters begin only after real targets and a trusted verification boundary are
approved.

## Source and data gates

Source permission and data sufficiency are separate decisions. Passing either gate cannot imply that
the other has passed.

### Gate 0A: permission to evaluate

Before collecting historical evidence, the exact proposed source use must be captured in an immutable
`source-rights:` artifact. A proposal may be human-authored or agent-assisted, but a production
approval must be an externally recorded human decision with immutable authority evidence. A content
address proves that reviewed bytes have not changed; it does not prove authorship, legal authority,
permission, or the truth of the evidence.

The source-rights artifact must declare:

- provider, exact dataset and version, intended purpose, competitions, season ranges, access mechanism,
  terms dates, and rights evidence;
- the exact acquisition profile: provided-artifact media type and delivery method, direct-provider
  client and version, or the pinned fitzRoy capability-contract version, package version, capability
  identifier, upstream provider, and direct function;
- an explicit allow, block, or not-applicable disposition for bounded evaluation capture, raw and
  metadata retention, internal evaluation, model training, feature derivation, public derived output,
  public fact display, and raw redistribution;
- field-level mappings and dispositions for archive facts, training, derived features, and public
  display, with omitted fields denied by default;
- automated-access identification, rate limits, burst limits, and cache limits when automation is
  proposed;
- raw-evidence, metadata, and derived-artifact retention limits and withdrawal deletion duties;
- exact attribution requirements, redistribution rights, geographic, commercial, and audience
  restrictions; and
- conditions and withdrawal actions, including collection stops, new-work stops, publication
  reassessment, deletion instructions, and retainable audit material.

The Gate 0A evaluator is fail-closed. It resolves the current append-only decision for the exact
environment, source-rights artifact, competition, season, access mechanism, geography, commercial
context, audience, requested operations, fields and uses, retention, cache duration, conditions, and,
for fitzRoy, the exact approved capability. It also enforces the capability's documented competition
and minimum-season limits. It returns only `mechanically_eligible` or `blocked`. Mechanical
eligibility means that the supplied records are internally consistent with the encoded decision; it
is not legal advice and does not create authority.

Each evaluation produces a `gate0a-evaluation:` receipt that hashes the complete request and result.
Raw evidence items reference that receipt and list their captured source fields. Full-chain validation
rejects evidence retrieved before its receipt, fields absent from the receipt, blocked evaluations,
and rights, decision, scope, or environment mismatches.

Decision environments are isolated as `test_fixture`, `non_production`, and `production`. Fixture
authority is valid only in `test_fixture` and can never authorize non-production or production use.
Approved records expire at their revalidation time, can be superseded only by the next version in the
same gate, key, and environment, and can be withdrawn with explicit downstream actions. Durable ledger
persistence, deterministic provider-policy/Gate-record builders, atomic three-provider recording,
durable authority resolution, signed egress verification, provider-keyed admission, separate
raw/metadata custody, and the reviewed season-ingestion command are implemented. A deployed capture
still requires exact current field manifests and condition evidence plus provisioned isolated
PostgreSQL, Redis, KMS-backed object storage, the pinned R image, and the trusted signed egress
endpoint; implementation alone does not create an active factual release.

AFL Tables, Footywire, and Fryzigg player-stat capabilities have standing approval for bounded
capture, governed retention, internal evaluation, model training, derived features, public numerical
output, and public factual display. Raw upstream field redistribution remains blocked. Each capability
still requires its current content-addressed source-rights artifact, exact returned-field set, and
finite Gate 0A decision in the durable ledger. Product-owner approval also covers the bounded
Draftguru transaction/draft facts, Footywire draft-result facts, official AFL current-order facts, and
the attributed HPN formula described above; production execution still requires one exact current
machine record per capability, field set, use, environment, retention profile, and access method. The
workbook is governed only as private migration evidence, not as a recurring transaction or draft
source. The maintained [source-rights assessment](afl-trade-source-rights-assessment.md) records the
approved scope, controls, revalidation, and withdrawal duties.

The external page lane models these approvals as `provider_web`, never as provider APIs. Five
separate content-addressed policies bind exact capability, provider, dataset version, field set and
conditions, including a discovery-only Draftguru trade-index capability. One atomic ledger command
records or renews all five. The production ingestion
composition injects PostgreSQL, Redis admission, identified bounded HTTPS clients and KMS-backed
object custody; it resolves durable Gate authority both before and after retrieval. Every changed or
unchanged observation retains a content-addressed execution receipt for the full source-rights
artifact, exact Gate decision and ledger revision, complete request digest and URL, admission lease
and token digest, parser/field manifest, rate/cache/retention controls, egress evidence, and exact
observed artifact or prior capture. PostgreSQL re-authenticates that receipt against the current
unsuperseded Gate head and the proposal's exact source-rights reference before persistence; evidence
finalization additionally requires the lease to remain unexpired on the PostgreSQL clock. Every
non-null emitted claim leaf must also have an exact reviewed normalized-field mapping and matching
`archive_fact` Gate use, so parser output cannot silently broaden an approved manifest. Its
page-scoped operator command stages evidence only. A separate governed discovery command captures the
bounded Draftguru trade index, seals the complete in-range link inventory and atomically registers a
content-addressed historical plan containing every discovered detail schedule plus every year-page
schedule, including years with no trade link. The parser records no invented transaction date, and a
`304` resolves to the exact prior finalized index batch. A durable bounded-tick scheduler consumes
these immutable reviewed URL schedules, content-addresses each aligned occurrence, serializes competing workers,
retains immutable lease claims and append-only state events, reclaims expired work, applies bounded
deterministic retry and provider circuit state, and binds terminal success to the exact staged batch or
unchanged-observation attempt. It delegates retrieval to the same governed ingestion composition; it
does not implement another HTTP path. A restartable plan worker pages the frozen target rows in ordinal
order and advances only across terminal occurrences, so retries, leases and provider deferrals cannot
silently skip a source page. A plan-wide completion boundary then re-derives every target result from
the current terminal occurrence and exact finalized issue-free evidence batch under one PostgreSQL
lock. Fresh captures bind their batch directly; unchanged observations bind their attempt, prior
capture and prior batch. Late skips, dead letters, missing targets and parser issues cannot produce a
completion even when the worker cursor has advanced past an operationally terminal state. The
content-addressed completion conserves the frozen target set one-to-one and remains private. A
versioned reconciliation source-authority envelope binds its completion, plan, target/result roots,
completion-order batch root and canonical sorted candidate-batch root. That exact completion also
owns a content-addressed identity-review package. Provider-native subjects group only the exact
provider identifier; name-only subjects remain scoped by exact recorded spelling and season. Each
decision binds the complete observation work item, reviewed package, current revision, predecessor,
approved canonical target snapshot and independently retained reviewer authority. New observations
cannot inherit an older decision, and no normalized-name or fuzzy merge is an authority path. The
historical preparation command accepts only the completion ID; it loads batches and current reviewed
identity heads from PostgreSQL and never accepts a copied batch list or identity-resolution JSON.
Candidate v2 canonical bytes commit the
authority and exact source membership. PostgreSQL independently proves completion-to-candidate set
equality, issue-free finalized batches and two-way evidence conservation before finalization. The
first pass preserves unresolved names as blocking review issues; it never auto-merges identities.
Exact completion/current-decision inputs replay to the same candidate, while a successor decision creates
a new immutable interpretation. The v1 candidate remains readable for explicit legacy/correction
work, but it cannot claim the v2 completion authority. None of these commands
discovers an unbounded site, publishes a fact, chooses an identity, activates a release or calculates
a valuation. A separate reviewed promotion boundary derives its candidate scope, exact
draft-selection membership and counts from PostgreSQL. The only supplemental reviewed inputs are
draft-event date and official name because the selection sources do not expose those fields as stable
facts. A typed content-addressed decision and single CAS head bind the exact proposal, revision,
predecessor and current scoped promoter authority; direct generic review rows cannot authorize
promotion. An approved current decision then materializes the issue-free candidate into append-only
canonical event versions, directed assets, draft selections, selected-player assets,
pick-custody observations and pick realizations. It requires the candidate's exact current approval,
current player-identity decisions and independently retained `afl_trade_canonical_promoter`
authority; it is atomic, idempotent and cannot write release or publication pointers. One traded pick
entitlement and its eventual selection retain the same stable `pick_id`: `exercised_as` is a
realization relation, while `OutcomePickLineageEdge` remains reserved for genuine entitlement
transformations such as splitting, combining or substitution. Recurring production still requires
deployment scheduling, execution and monitoring of the reviewed discovery plan, missed-period monitoring, reviewed
promotion of the historical candidate set, and a completed non-production backfill and reconciliation
rehearsal described below.

### Gate 0B: data sufficiency

Gate 0B begins only after approved Gate 0A evidence has been captured and reconciled. Its protocol must
freeze the estimand, required cohorts, denominators, null-versus-zero semantics, identity ambiguity and
quarantine rules, coverage measures, unsupported cohorts, and acceptance thresholds before evaluation.
This repository intentionally defines no default Gate 0B thresholds: inventing defaults before those
choices are externally reviewed would turn an unapproved policy judgment into executable authority.

An evidence manifest contains raw captured evidence only. It pins each source authorization to the
exact `source-rights:`, Gate 0A `gate-decision:`, and `gate0a-evaluation:` receipt for its environment;
identity resolution, custody, lineage, and reconciliation cannot be inserted into this earlier
boundary.

A content-addressed Gate 0B protocol must exist before measurement starts. It names every cohort,
measure, numerator, denominator, exact rational acceptance floor, null-versus-zero rule, candidate
window, embargo, and exclusion. It must cover transactions and lineage, player contribution and
availability, and point-in-time current state as three explicit evidence lanes. Every lane/cohort pair
requires at least one approval measure; merely declaring a cohort or lane cannot satisfy the gate.

Automatic identity merging is prohibited. Ambiguous, unresolved, or conflicting identities are
quarantined, excluded from approval numerators, and retained in eligible denominators so missing or
uncertain evidence cannot improve coverage. Manual resolution requires evidence.

The coverage report records one measured ratio or explicit unmeasurable reason for every prespecified
measure/cohort pair. A wholly unmeasurable cohort is reported as unsupported with a structured reason;
it is not post-hoc excluded. The report cannot add unknown observations, label measured cohorts as
unsupported, or hide a failing cohort behind an aggregate. Structural validity and approval
eligibility are separate: every required observation must be present, measurable, and at or above its
exact floor before Gate 0B can support downstream work.

The Gate 0B decision pins the protocol and report. A later corpus manifest pins that decision plus the
exact current-state snapshot, architecture decision package, and Gate 1 decision; Gate 0B and Gate 1
are parallel prerequisites rather than substitutes. The corpus owns normalized identity, real-club
custody, lineage, reconciliation, quality, and quarantine artifacts. Its identity outcomes reconcile
every candidate to resolved, ambiguous, unresolved, or conflicting status; manual resolutions are a
documented subset of resolved identities, and automatic merging remains prohibited. Immutable
identity-decision and temporal-correction ledgers preserve review evidence and knowledge-time changes.
Each of the three required evidence lanes accounts for every input as reconciled or quarantined and
pins its evidence-to-canonical mapping artifact. Unsupported cohort identifiers must exactly match the
approved coverage report, and a feature dataset must explicitly exclude every unsupported cohort.
The private factual candidate and its approved or published release establish the exact typed facts.
A separate corpus-to-factual-candidate lineage commitment proves that those facts belong to the
Gate 2 corpus. Gate 2 approves that exact corpus, lineage commitment, factual candidate, and release
before a feature dataset can be admitted; it does not approve a future dataset or require the public
factual pointer to be active. A successful reproducible run and Gate 3 decision precede any valuation
publication; the projection is a separate downstream manifest. Cross-manifest validation requires
exact parents, source sets, environments, effective decisions, and chronology throughout.

The required provenance chain is:

```text
source-rights proposal
  -> Gate 0A decision
  -> Gate 0A evaluation receipt
  -> evidence manifest
  + pre-registered Gate 0B protocol
  -> coverage report with exact rational observations
  -> Gate 0B decision
  + current-state snapshot
  -> architecture decision package
  -> Gate 1 decision
  -> corpus manifest
  -> reviewed factual-outcome release
  -> sealed factual-release candidate
  -> corpus-to-factual-candidate lineage commitment
  -> Gate 2 decision
  -> private valuation feature-dataset candidate
  -> dataset-admission receipt
  -> valuation model-protocol manifest
  -> valuation model-run manifest
  -> Gate 3 decision pinning protocol and run
  -> valuation publication manifest
  -> valuation projection manifest
  -> Gates 4 and 5
  -> active valuation-publication pointer
```

Source-independent contracts, deterministic lineage fixtures, manifest schemas, and unavailable
product states may be implemented while these gates are unresolved. Synthetic or fixture data must
never be represented as production evidence or used to approve a production gate.

### Factual feature-dataset admission

The factual-to-valuation seam uses two distinct content-addressed records. An
`afl-trade-valuation-dataset/v4` candidate is decision-free and binds the exact factual release,
sealed factual candidate, private source-member root, corpus-lineage commitment, point-in-time row
set, executable feature/target/split policy, cohorts, extractor code and configuration. A later
`afl-trade-dataset-admission/v3` receipt binds that already-hashed candidate to the current Gate 2
decision and the exact modelling-rights evaluations. Gate 2 pins the corpus, corpus-to-factual
lineage commitment, factual release, and sealed factual candidate; the admission receipt—not Gate 2—
binds the resulting dataset candidate. This ordering prevents a content-address cycle and preserves
Gate 2 as the pre-dataset lineage decision.

Dataset admission is not factual publication, model fitting, valuation, or grading. It is always
`publicationEligible: false`. Dataset v4 with row v3 admits only player contribution and availability
at player/acquisition-spell prediction grain; draft-pick modelling requires a later discriminated row
contract with draft-selection and pick-lineage identities. Every row has a stable source-native key,
prediction origin, feature knowledge cutoff, future target window, explicit split, current identity
decisions, AFL event/acquisition-spell lineage, typed factual member revisions, and leakage-group
identifiers. Leakage values are not producer-defined aliases: they equal the row's canonical player
and stable event/acquisition-spell subject IDs, while exact version IDs remain provenance. One event
may legitimately produce multiple acquisition spells, and each event/spell pair is authenticated
independently. Factual member identifiers and record digests remain
independent v3 fields; admission verifies both against the authenticated sealed candidate without
inventing a new digest preimage. Round-grain achievements are ineligible until their authoritative
round valid-time coordinate is represented explicitly. Reconciled metrics are likewise ineligible
until factual membership distinguishes match from season grain and carries authoritative match/valid
time; no season-start date is fabricated for either case.
The dataset declares one knowledge-join policy. The default
`point_in_time_as_known_by_prediction_cutoff` policy requires feature knowledge to predate the row
cutoff and each earlier partition's labels to be known before the next partition prediction origin
plus its embargo. The explicit
`retrospective_as_captured_at_dataset_creation` policy instead preserves the evidence's real
capture/recording timestamps and requires them to be no later than dataset creation. It may support a
current retrospective diagnostic over historical effective time, but it must never be described as
an original-vintage backtest or as evidence available at the historical prediction cutoff. Under
either policy, target effective time must fall strictly after the prediction origin and within the
factual release cutoff. Player, event, and acquisition-spell groups cannot cross model partitions.
Missing, unavailable, unresolved, conflicting, quarantined, and not-applicable evidence remains
distinct from measured zero.

Public factual-display authority is insufficient for this seam. Admission derives the contributing
source set from every source capture in the sealed factual candidate. For each source it authenticates
one Gate 0A evaluation that predates feature extraction and a fresh evaluation at the admission
instant, both covering every consumed field for `model_training` and `derived_feature_creation`.
Terms remain expiry-exclusive. Admission also requires content-addressed analytical and operational
authority for the exact dataset command. A model run must repeat the modelling-rights check because
admission cannot preserve authority after terms expire or are withdrawn.

The dataset-admission command accepts only a dataset and admission instant. Authority evidence comes from an injected
authenticator that must load and authenticate the complete canonical release registry, exact approval
event in the latest validation cycle and current head, factual candidate and member records,
corpus-to-candidate lineage artifact, per-capture consumed-field artifacts and exact retained source
snapshot manifests, current Gate ledgers, Gate 0A rights artifacts and receipts, canonical provider
resolution decisions plus their exact current resolution and assignment heads, and retained bytes for
the dataset and every executable specification artifact. Identity evidence must cover the exact
dataset environment and scope, row competition and season, governed native-ID namespace, and any
temporal alias validity interval. Event/spell/edge mappings are derived from an
exhaustive authenticated member join, not accepted by set inclusion. The command recomputes member,
field-use, row and byte roots rather than trusting copied status flags. Candidate finalization and the
candidate creation timestamp are the same canonical seal instant; finalization and the current release
approval must precede lineage creation; lineage and Gate 2 must precede dataset
materialization.

Model execution is a second, separately durable seam. A registered
`afl-trade-player-contribution-model-protocol/v2`, exact admitted dataset, sealed player-observation
set, executable intent, current Gate 2 decision, fresh Gate 0A model-training receipts and retained
bytes for every dataset, protocol and runtime artifact are authenticated before one short-lived
`afl-trade-model-run-authorization/v1` is issued. The start boundary also requires a distinct
`afl-trade-model-run-operational-authorization/v1` receipt for one exact intent, dataset, admission,
protocol and observation set; it cannot reuse the earlier dataset-materialization authorization or
authorize a different attempt. The normal path requires a human operational principal and a separately
retained, currently approved governed operator-authority evidence record whose environment, scope,
competition, season coverage, principal, role and validity cover the exact admitted rows. The fixed
non-production dispatch-bound private-valuation path instead derives operational authority from the
current live dispatch claim and its exact retained factual and HPN input binding. Callers cannot select
that policy principal, role, environment, execution mode or publication posture. The model-run writer
may consume either authenticated trust root but cannot create or approve one. Database time owns both
authorization windows and expiry.
The authorization is unique per intent and consumed once before execution; the completed
`afl-trade-model-run/v3` is append-only and binds the same dataset, admission, protocol, observation
set, intent and authorization. PostgreSQL stores each immutable parent and enforces exact replay,
current analytical authority, exact current Gate 2 artifacts, the complete admitted Gate 0A source
set and request/use parity, their exclusive rights and revalidation deadlines, one governed
operational receipt, one authorization, one consumption and one completed run. A
failure after consumption is persisted as an immutable failed run and may also raise an operational
incident, but the same intent cannot be run again. A new attempt requires a new content-addressed
intent and a new exact operational receipt from the applicable human or dispatch-bound policy path.

This durable authority path remains private and unmounted. It authorizes no model merely because the
records exist, and it does not fit coefficients, select a champion, issue Gate 3 approval, calculate a
trade grade or publish a valuation. Real source evidence, an executable fitting implementation,
independent numerical validation and their reviewed publication transitions remain required.

The local admitted player runner now implements one named methodology,
`afl-trade-admitted-player-candidate/v1`, behind that authority boundary. It estimates future
acquisition-spell contribution above a role-and-era replacement baseline in the protocol's additive
contribution unit. The target is the separately governed scalar transform of Brownlow votes,
coaches votes, games and goals observed strictly inside the future target window. Predictors are the
exact admitted feature members and hashes joined under the dataset's declared knowledge policy:
expected games and prior contribution per game, with governed role and era assignments. Target
members are never reused as predictors, and the executor rejects a protocol whose knowledge policy
differs from its sealed observation set.

The protocol binds the exact feature-value artifact, role and era definitions, scalar transform,
partition windows and embargo. The run intent binds the exact candidate configuration artifact.
That versioned configuration declares the role-and-era replacement-baseline policy, ridge penalty,
interval coverage level, minimum comparable observations and required relative MAE and RMSE
improvements. Version 1 fixes the replacement level at the games-played-weighted 25th percentile
within each role-and-era training group, admits players with at least one game and groups with at
least one training observation, uses ridge lambda `1`, and targets 80% interval coverage. Validation
requires at least one comparable observation and at least 1% relative improvement over the
games-only comparator in both MAE and RMSE; incomplete prediction coverage fails closed. Fitting uses
`train` only; interval residuals use `calibration`; candidate selection uses `validation`;
`final_test` is evaluated once after the candidate lock and cannot retune the candidate. The native
execution retains the fitted coefficients, baseline, validation,
calibration, interval-coverage, subgroup, sensitivity, leakage-audit, model-card and diagnostics
artifacts. These records are evidence only and remain publication-ineligible.

The dispatch-bound local composition accepts no caller-supplied operational principal, role,
environment, execution mode or publication posture. Before materialization it re-authenticates the
live claim, exact request-to-operation binding, private factual output and the factual
release/candidate/member root shared by the dataset and admission. A different dataset, admission,
protocol, observation set or source-rights lineage fails closed. Multiple admitted captures may
share one rights proposal; they produce one current run-start receipt only when every retained
receipt has identical request-to-proposal ancestry. Conflicting ancestry is rejected. The existing
human operational-authorization branch is unchanged.

The superseded restricted five-season rehearsal proposal is not a player-model training authority.
A genuine admitted-player run must use the current AFL Tables player-stat policy through fitzRoy,
materialized as exact non-production Gate 0A records that explicitly permit `model_training`. The
capture must occur under that authority and retain its original receipts; an earlier rehearsal
capture cannot be relabelled after retrieval. The scoped AFLCA lane separately permits only the
reconciled `Coaches.Votes` field as a private training input. Canonical promotion must cover both the
transaction/event and player asset ancestry before factual lineage, dataset admission or execution
may proceed.

The issue 574 genuine non-production diagnostic is deliberately small and retrospective. It uses
five genuine Draftguru player trades—Adam Saad to Carlton, Jeremy Cameron to Geelong, Jordan Dawson
to Adelaide, Josh Dunkley to Brisbane and Brodie Grundy to Sydney—joined to genuine AFL Tables match
statistics and the scoped AFLCA `Coaches.Votes` field. For each acquisition spell, the first five
home-and-away appearances form the prior-contribution feature window and the remaining appearances
in that AFL season form the target window. The registered additive scalar is
`0.05 * games + 0.08 * goals + 0.01 * Brownlow votes + 0.01 * coaches votes`. The two 2021 rows are
training, 2022 is calibration, 2023 is validation and 2024 is final test; player, trade-event and
acquisition-spell identities do not cross partitions. This slice demonstrates authorized ingestion,
exact admission, native execution and retained replay only. Its five selected transfers, one-row
validation partition, retrospective capture in 2026, hand-selected scalar and lack of role diversity
make it unsuitable for population inference, historical point-in-time claims, Gate 3 approval,
production valuation or publication.

The local execution entry point is request-bound rather than target-bound. Its public input is the
retained dispatch request identifier plus live claim custody. Inside the coordinator database role it
loads the request-to-operation binding and constructs the exact execution input from the immutable
operation's factual and HPN digests, player and pick targets, and qualification policy. Request scope
and operation scope must agree. A caller cannot supply a replacement dataset, admission, protocol,
model version or source-rights receipt through this boundary.

Successful native runs are wrapped by the existing governed component manifest with exact protocol,
dataset, admission and Gate-ledger ancestry. Replay first authenticates a retained component against
the original immutable dispatch attempt and the current live claimant. When it matches, the runner
returns that component without reconstructing observations, issuing another authorization or
retraining. No new retry ledger, current pointer or outcomes table is required for this player slice.

## Temporal contract

Canonical evidence is bitemporal:

- **effective time** records when a fact was true in the AFL domain; and
- **knowledge time** records when Statly could first use or later correct that evidence.

Publication time is separate from both. Queries must support:

- original-vintage results using only evidence knowable at the historical cutoff;
- frozen historical restatements using a named publication; and
- current resolution using the latest approved identity and lineage evidence.

Corrections append knowledge-time history. They do not overwrite the evidence used by an earlier
publication.

## Public domain model

The closed asset vocabulary contains players, current-pick entitlements, future-pick entitlements,
draft selections, packages, unresolved assets, and unsupported consideration. Players and pick
entitlements may carry numerical credit. Draft selections are intermediate identity records; packages
are structural containers; unresolved and unsupported consideration remain explicit but cannot
silently receive a numerical value.

An asset custody spell records the real AFL club controlling one asset over a half-open effective-time
interval in a particular knowledge version. Movement of the same asset between AFL clubs changes
custody; it does not create a value-lineage edge or a new asset. Custody deliberately has no `userId`,
fantasy `leagueId`, fantasy `seasonId`, membership, or roster relation.

Value-lineage edges exist only when one asset produces a different successor asset. The supported
transformations are:

- a future-pick entitlement resolving to a current-pick entitlement;
- a current-pick entitlement being renumbered as another current-pick entitlement;
- a current-pick entitlement being exercised at a draft selection;
- a draft selection creating a player identity;
- a value-bearing asset being exchanged for another asset or a package;
- a package containing its constituent assets; and
- a player's exit returning one or more successor assets.

Every transformation carries effective time, a half-open knowledge interval, evidence, and rule
version. An asset may have multiple successors only for the explicitly supported exchange, package,
and player-exit cases. The graph rejects missing endpoints, self-edges, invalid endpoint types,
conflicting active successors, invalid temporal ordering, empty packages, and cycles in any knowledge
snapshot.

Voiding and expiry are unary terminal dispositions. They remove an asset from the attribution
frontier without inventing a successor. A terminal asset cannot also have an active successor in the
same knowledge version. Identity corrections and evidence supersession are knowledge-only provenance
relations; they are not traversed as value lineage and cannot move or duplicate value.

Club-specific contribution follows a conserved attribution frontier at an explicit effective time and
knowledge cutoff. A transformed asset is replaced by its supported successors rather than counted
beside them. Every frontier asset must be credited exactly once or explicitly excluded with a reason;
ancestors and descendants cannot both receive credit. Terminally voided or expired assets leave the
frontier. Player contribution to an AFL club stops when the player leaves that club. Multi-party trades
remain multi-party; the system must not fabricate independent bilateral trades.

### Factual outcome grain and validation

The factual corpus preserves evidence at the finest approved source grain rather than storing only a
dashboard total. Transaction rows, asset movements, player-match or player-season statistics, votes,
and awards remain distinct facts with their own natural keys, effective times, knowledge times, source
object references, and field-level rights dispositions. A derived acquisition spell joins those facts
under one reviewed rule version; it is not rewritten into a raw source row.

The initial public metric vocabulary may include games, goals, votes, and awards only where the
approved source supplies and defines them. Their source grains may differ: for example, games and goals
may be match observations while a vote or award may be an event- or season-level observation. The
normalizer must not fabricate a common grain, infer an award from statistics, or duplicate an
observation across both a player and its predecessor pick. Aggregates retain the exact metric
definition version, acquisition-spell rule, numerator, denominator, coverage status, and
effective-through date.

Every captured field passes checks appropriate to its declared source contract before it can enter a
candidate factual release:

- structural type, required/null, finite-number, range, and controlled-vocabulary checks;
- natural-key and duplicate checks at the declared source grain;
- season, round, match, club, player, and award/vote referential checks where applicable;
- public identity and real-club custody checks at the fact's effective time;
- source-object digest, upstream/provider, fitzRoy version and parameters, retrieval time, and Gate 0A
  field-use checks; and
- explicit reconciliation to measured, unresolved, conflicting, quarantined, not applicable, or
  unavailable status.

Missing, malformed, ambiguous, or unapproved fields are quarantined or published as unavailable. They
are never coerced to zero. A factual release records row and field counts, exceptions, unresolved
identities, lineage gaps, and metric coverage so incomplete evidence cannot improve its own quality
claim.

#### Implemented private factual authority boundary

The isolated outcomes PostgreSQL schema now implements the private factual boundary that precedes a
release. A finalized provider-normalization run is promoted atomically into an immutable source-fact
batch only when every decoded row is accounted for exactly once. The batch retains exact staged-row,
candidate, issue, closure, capability, source-scope, and finalization digests. Match-universe,
player-appearance, numeric metric, and achievement claims remain separate typed facts. Each accepted
player or match reference must bind the current reviewed provider resolution and active reusable
assignment; represented clubs are real AFL clubs and must match the reviewed match side and occurrence
evidence. No fantasy user, league, roster, or ownership identity enters this boundary.

Reconciliation is a second immutable step. An approved, versioned policy selects exact source facts,
records every input, preserves same-priority disagreements as conflicts, and advances a subject head by
compare-and-swap. A measured zero is retained as evidence. Missing, quarantined, unavailable,
not-applicable, or conflicting input never becomes zero. `games = 1` exists only as a derived
match-grain result when an observed player appearance and a reconciled completed match agree; providers
cannot submit `games` as a source metric.

Acquisition-spell aggregation is also versioned rather than written into the legacy total. Each metric
version binds one approved real-club acquisition spell, one governed metric definition, exact current
reconciled match facts for the same player and club inside the spell interval, coverage counts,
effective-through date, and a compare-and-swap head. Partial coverage remains labelled partial and
conflicting or quarantined evidence withholds the value. Achievements and awards deliberately remain
separate season-, round-, or event-grain facts: they are never inferred from numeric statistics or
summed merely to fit the acquisition-spell metric shape.

Achievements now have their own governed reconciliation lane. Provider achievement claims remain
private inputs. A versioned achievement policy records every selected input, preserves unresolved and
conflicting evidence, and advances a canonical achievement head by compare-and-swap. Only the current
reconciled achievement version may enter a factual release; a raw provider award or vote is never a
public release member.

This boundary is private and dormant with respect to public publication. It does not authorize a
provider, run an external capture, activate a factual release, calculate a trade value or grade, or
write a public projection. Those actions remain behind their later rights, release, valuation, and
operational gates.

The next private Current Valuation Refresh boundary retains one content-addressed model-evidence
operation against the exact current private factual candidate and revision. Its player observation
set, pick benchmark evidence, two governed runs, release-level qualification, Gate 3 decisions, and
qualification work remain exact ancestry rather than reconstructed labels. A passing pair must be the
single pair that advanced current model authority by one revision. A failed qualification retains its
run evidence and failure codes while leaving the previous current pair unchanged. Replay returns the
retained result, and factual or model-head drift fails closed before downstream preparation. This
boundary remains local, private, non-production, and publication-prohibited.

### Independent factual and valuation releases

A factual-outcome release binds an exact archive dataset, source snapshot set, metric registry,
acquisition-spell rule version, effective-through time, exception disposition, review decision, and
release identifier. The active factual pointer changes atomically only after reconciliation and review.
Public outcome list, trade detail, club, player, year, dashboard, and supporting API views all resolve
that same captured release.

The implemented source-independent manifest makes those bindings content-addressed and requires the
projection to name every public view and supporting API dataset plus passed parity evidence. The pure
registry models expected-revision registration, validation, review, activation, supersession,
rejection, withdrawal, and freshly authorized recovery. Every mutation extends a content-addressed
global event chain and authenticates the complete registry before selection or mutation.
Authentication validates every state transition, exact duplicated global/record metadata, stored
authority identifiers, pointer envelope, replayed pointer history, and every historical affected-record
snapshot and content address. Release-event histories must be continuous: each transition must begin
at the preceding transition's state. Historical snapshots apply the same release/projection pairing,
state-dependent projection, and Gate 4/Gate 5/activation-authority checks as the current record.
Activation
re-evaluates the exact Gate 0A source terms and request, rechecks Gate 4, separately requires the Gate 5
product decision, and requires an expiring exact-revision operational authorization with an open
rollback window and the write barrier engaged. The PostgreSQL adapter now persists this contract under
one locked expected-revision chain and is exercised in generated disposable schemas. Those local
`test_fixture` and `non_production` decisions and authorizations carry no external reviewer or
production authority.

The factual publication lane uses explicit compatibility versions. Existing archive-only records keep
the release-v1/projection-v1 contract unchanged. A factual candidate uses
`afl-trade-factual-release-candidate/v3` and must embed the exact
`afl-draft-trade-outcome-release/v2` manifest it is building. Release v2 carries a required
`sourceMemberSetSha256`; its typed members include finalized factual and achievement reconciliation
runs, current reconciled metrics and achievements, acquisition-spell metric versions, source captures,
archive event/lineage/spell records, and exact review evidence. The candidate is private and
unpublishable while open.

The PostgreSQL writer follows one fail-closed sequence under a release-membership advisory lock:

1. stage or verify the exact release-v2 manifest;
2. insert the complete, sorted typed membership and its private member-set root;
3. finalize the candidate only after current-head, cutoff, count, source-rights, and legacy-lane checks;
4. freeze every archive and factual membership table for that release;
5. insert or verify the staged manifest and append the registry event; and
6. admit only a projection-v2 that names the same candidate and source-member root.

Registration therefore cannot race a late member, and an exact retry remains idempotent after
registration. Candidate-backed releases cannot use release v1, release v2 cannot use legacy stat,
identity-assignment, or reconciliation membership, and mixed v1/v2 release-projection pairs fail
closed.

Release v2 deliberately preserves three different integrity roots. `sourceMemberSetSha256` commits
the private evidence and governed factual membership. `publicListItemSetSha256` commits the exact,
canonically ordered searchable list rows and no other view bytes. The projection's
`logicalDatasetSha256` commits the complete public website and supporting API dataset.
Projection v2 carries a derivation digest over its candidate and all three roots, so neither a
same-count list-row substitution nor a public-output substitution can pass parity. The roots must not
be equated: private custody, searchable rows, and public datasets are different evidence domains.

The searchable list rows are written before release validation through one atomic PostgreSQL boundary.
Each row retains canonical JSON, its SHA-256, and denormalized indexed fields whose parity is enforced by
the database. Finalization recomputes the versioned `publicListItemSetSha256` from the complete ordered
row membership, records the count and root once, and rejects all later rows. Validate, approve, and
activate events require that exact sealed set. Public reads authenticate the active projection and
sealed set once, then use indexed SQL filters and signed, query-bound keyset cursors; each returned row
is still checked against its retained canonical bytes and digest. This avoids re-reading and hashing the
entire projection on every page request without weakening the publication boundary.

This is a source-independent, dormant publication boundary. The contracts, migration gates, and
fixture repositories prove sequencing and integrity but do not provision hosted PostgreSQL or object
storage, grant provider access, create a production Gate 0A approval, materialize real public output,
or activate a production release.

Valuation publications remain independent. A reviewed factual release neither approves a model nor
activates a numerical valuation; a blocked or withdrawn valuation does not hide an otherwise approved
factual release. When a page composes both, each response retains its own release/publication envelope
and the valuation manifest must bind the exact factual/archive inputs it used. Mixed-version joins fail
closed.

Version one publishes through the website and its supporting APIs only. It produces no public XLSX,
workbook sheets, spreadsheet download, or spreadsheet export job. The private migration workbook
cannot be resubmitted as a recurring update after sourced cutover and cannot mutate the active
database or release.

## Public response contract

The public contract uses a closed 13-state availability vocabulary:

| State                       | Numerical payload | Meaning                                                                     |
| --------------------------- | ----------------- | --------------------------------------------------------------------------- |
| `not_calculated`            | No                | No calculation has been attempted for the requested view                    |
| `source_blocked`            | No                | Required source use is not approved                                         |
| `insufficient_data`         | No                | Approved evidence cannot support a result                                   |
| `identity_unresolved`       | No                | A required public AFL identity remains unresolved                           |
| `lineage_unresolved`        | No                | The attribution frontier cannot be reconciled                               |
| `model_not_approved`        | No                | No model is approved for the requested scope                                |
| `calculating`               | No                | An approved calculation is in progress                                      |
| `available`                 | Yes               | A current result with complete asset coverage                               |
| `available_partial`         | Yes               | A current result with explicit exclusions and narrower or adjusted scope    |
| `stale`                     | Yes               | The last approved result remains visible with an explicit freshness warning |
| `failed_previous_available` | Yes               | A prior approved result remains visible after the latest attempt failed     |
| `withdrawn`                 | No                | The selected publication was withdrawn                                      |
| `unsupported_trade`         | No                | The trade is outside the declared model or product scope                    |

Only `available`, `available_partial`, `stale`, and `failed_previous_available` may carry numerical
values. Every other state returns a reason, public message, constrained next action where applicable,
warnings, and methodology link without placeholder estimates, zero values, inferred winners, or model
internals. Payloads are strict and reject Statly user, fantasy league, membership, season, roster, and
ownership fields.

Every numerical result declares its valuation view, model vintage, effective time, knowledge cutoff,
valuation time, unit, per-club mean estimate and uncertainty, structured factors, comparison
probabilities, practical-equivalence probability, assessment, methodology link, and asset coverage. A
mean is explicitly identified and is not incorrectly constrained to lie inside a central quantile
interval. Probabilities
name the complete multi-club comparison set and reconcile to one with practical equivalence.

Coverage reconciles valued and excluded asset counts to the total. Every excluded asset has one public
reason. A comparison then declares exactly one basis:

- `complete_trade` requires complete coverage and supports only a complete-trade assessment;
- `included_assets_only` names exactly the excluded assets and limits the assessment to the included
  assets; or
- `model_adjusted_for_exclusions` names exactly the excluded assets, the approved adjustment method,
  and a public explanation, and may support a complete-trade assessment.

An incomplete result can never silently present included-assets-only probabilities as a whole-trade
conclusion. Comparison exclusions must exactly equal coverage exclusions, including for stale or
previously available results that retain partial coverage.

The public consistency envelope is `afl-trade-value/v2`. Publication, valuation-bundle, and projection
identifiers are lowercase SHA-256 content addresses with `publication:`, `valuation-bundle:`, and
`projection:` prefixes. The publication reference names the exact bundle and value unit; it does not
misrepresent one component model or dataset as the identity of the whole calculation. A response
selects one active publication, one explicit historical publication, or none. Numerical results require
one immutable selected publication and must use its declared value unit; active selection references
only a published publication; withdrawn results identify the withdrawn publication; a withdrawn
publication cannot serve any value-bearing result; and list items cannot override the response
publication. The retired v1 single-model metadata shape is rejected rather than silently interpreted.
Serving, publication, calculation, and knowledge-cutoff times must be chronologically consistent.

### Immutable projection and serving chain

Numerical serving now has a complete source-independent artifact chain. A projection build must:

1. verify each trade's exact public evidence sources against the governed evidence index;
2. create one deterministic trade materialization receipt and its non-methodology documents;
3. assemble bounded materialization shards and a compact aggregate root;
4. add the exact publication methodology, then create bounded document-set shards and root;
5. replay every stored document against that authenticated set and produce a passing parity report;
6. derive projection manifest v2 from the replayed publication v3, inventory index, freshness policy,
   presentation policy, public-evidence index, schema bundle, materialization root, document-set root,
   and parity report; and
7. validate publication v3 only from that total materialization-verification envelope.

Every stage is content addressed and binds exact parent identifiers, artifact references, public scope,
value unit, document lattice, digests, and chronology. Same-count artifacts from independently valid
pipelines cannot be spliced. The boundary descriptor-admits and bounds the complete verification graph
before replay, and consumers receive replay-derived output rather than reparsing caller-owned state.
Projection v1 remains a migration-only validation path for publication v2. Publication v3 cannot use
that compact path.

`projectionArtifactReadRepository.ts` mounts one exact projection identifier from a byte source that
must enforce the declared 128 MiB limit before returning data. Mounting authenticates the complete
verification envelope once, indexes the exact summary, detail, methodology, and supporting-API
documents, and performs no artifact or external-source request during page reads. Each read requires
an exact captured registry selection and evaluates the authenticated freshness policy. The mounted
adapter retains a monotonic evaluation high-water mark: a clock regression cannot make a previously
expired projection servable again during that mounted adapter instance. This is not durable across a
remount or process restart; live serving must restore a trusted monotonic minimum from durable state
before evaluating freshness. Failed-candidate context may retain only an explicitly active prior
publication that is still current or stale; it never changes the registry pointer.

The adapter currently exposes ordered `afl-trade-valuation-csv/v1` projection rows as an unmounted
legacy interface. Version-one sourced cutover does not mount or publish that interface and removes it
with the workbook/spreadsheet surfaces. Supporting APIs return the authenticated web read contract;
they do not relabel imported `Expected` or `Actual` columns.

### Governed public delivery boundary

The public explorer, trade-detail and methodology server pages read through the same
publication-aware runtime as the value APIs. The explorer requests a bounded list page for the
`current` view; a full trade page requests all four views. With no active immutable publication, the
service returns `not_calculated` with reason `no-active-publication`. `source_blocked` is reserved for
an active publication whose exact serving authority is expired, withdrawn or otherwise ineffective.
Neither state has a publication reference, model vintage, temporal context, numerical payload,
winner, or estimated release time.

An active publication may intentionally cover fewer trades than the factual archive. When its
authenticated projection reports that a requested archive trade is not a member, the resolving read
adapter preserves the active publication metadata but returns `not_calculated` with reason
`trade-not-in-active-projection` for that trade. Mixed list batches retain available values for
projection members. Before creating the fallback, the adapter must also find the requested trade in
the active governed factual archive. Unknown trade IDs and archive-selection failures preserve the
projection error or fail closed. Only that doubly authenticated membership miss is recoverable; projection mount,
integrity, selection, freshness and other read failures still fail closed and never fall back to
legacy numbers.

This unavailable result applies only to the additional evidence needed for Statly valuation. It does
not disable the existing historical AFL archive. The archive remains anonymous and separate from the
fantasy domain: public AFL trades and assets have no user, league, roster, or membership owner.

The prepublication constructor is confined to explicit disabled mode. Public pages and APIs call the
server-only runtime getter. `disabled` returns honest no-publication services; `postgres` requires the
isolated database, signed-cursor key, exact object bucket/prefix/KMS identity, custody-policy evidence,
and region, and fails startup rather than falling back. PostgreSQL mode re-evaluates current Gate 4
and Gate 5 records, resolves each captured projection ID through its exact custody binding, and reads
bounded digest-verified bytes through a rotating immutable projection cache. A PostgreSQL
compare-and-set freshness high-water record survives process restarts and rejects wall-clock rollback.
Read failures never fall back to legacy archive numbers.

Imported archive fields labelled `Expected` and `Actual` remain retained only in staging, audit, and
source-compatible export records. They are not rendered as public trade grades and never feed Statly
value, fairness, or winner calculations. Public archive and club-history surfaces instead render the
derived at-trade/current grade or an explicit unavailable state. The general methodology page explains
planned views and release requirements but is not publication-specific methodology and must not imply
that a production model is running.

The current UI has local desktop and 390-pixel evidence for the no-publication archive and detail
states, including keyboard focus, no horizontal overflow, and no observed console or hydration error.
That evidence does not cover a numerical publication. The three named statistics providers are
policy-approved, but this work does not establish real capture completion, Gate 1/model approval,
publication activation, deployment readiness, or numerical product completion.

## Model and validation boundary

Player contribution and availability use a dedicated, content-addressed protocol prepared after the
feature dataset and before training. It fixes the target estimands, additive value unit, role taxonomy,
era definitions, replacement baseline, feature availability, censoring rules, split windows, embargo,
validation plan, acceptance criteria, and known limitations. Public player identities are source-native
and carry no fantasy ownership.

Replacement levels are stratified by role and era and estimated from the training partition only;
validation or test refitting is prohibited. Role assignments, corrections, and features are available
only as known at the prediction cutoff. Unknown and observed zero remain distinct, while target-derived
and post-outcome features are prohibited. Realized club contribution stops at real-club departure or
the observation boundary, and active careers are right-censored under an immutable definition.

The executable player baseline boundary lives in `src/server/aflTradeIntelligence/modeling`. Its
strict, content-addressed observation contract requires source-native public player-season identities,
all four chronological partitions, point-in-time role evidence, explicit contribution availability,
games played and available, and either completed-career or right-censored evidence. It rejects fantasy
user, league, roster, membership, and ownership fields by construction. The deterministic fitter uses
games-played weighting to estimate the declared replacement quantile for each sufficiently supported
training-only role/era cohort. Every input then reconciles to either an auditable season score or an
explicit unavailable, zero-game, or unsupported-cohort result. Contribution per game, impact above
replacement, availability, total season contribution above replacement, and censoring treatment remain
separate outputs; games played is not treated as quality by itself.

Held-out evaluation consumes a content-addressed prediction set rather than fitting or inventing a
candidate predictor. The set must cover the evaluated validation or final-test partition exactly, bind
to the same observation set, baseline fit, and value unit, and use each observation's declared feature
cutoff. A validation candidate may be selected from train and calibration only. A final-test candidate
may also use validation, but final-test refitting remains prohibited. The evaluator compares candidate
and point-in-time expected-games-only predictions using MAE, RMSE, bias, absolute deltas, and declared
relative-improvement thresholds. Missing or otherwise unscored outcomes remain visible as exclusions;
insufficient comparable observations, incomplete prediction coverage, mismatched cutoffs, or broken
artifact lineage fail closed.

These contracts and deterministic fixture tests establish an executable, reproducible Stage 3
baseline and evaluation harness. They do not establish that a real candidate outperforms the
games-only baseline. No lawfully approved player-stat observation set, trained candidate, held-out
performance report, source approval, Gate approval, or production readiness is represented by the
fixture evidence. Stage 3 exit criteria remain unmet until approved source data and a locked candidate
produce reviewed real-data evidence through this boundary.

### Stage 4 draft-pick and future-pick foundation

Draft-pick and future-pick distributions use a separate content-addressed protocol aligned to the
same player-contribution value unit. Its observations and assets are source-native public AFL records:
clubs may hold draft entitlements, but no Statly user or fantasy league owns a player, pick,
entitlement, observation, scenario, or result.

The executable observation boundary requires complete, mature whole-draft cohorts at one fixed
football-contribution horizon. Each observation retains actual selection number separately from
nominal position and bid-match context and belongs to exactly one of six ordered, mutually exclusive
and exhaustive contribution categories, including a true no-return category. Active or otherwise
incomplete horizons are right-censored instead of being converted to completed zero-value outcomes.
Draft pathway and selection-access evidence remain explicit so that a benchmark cannot quietly treat
incomparable access rules as ordinary national-draft selections. Chronological train, calibration,
validation, and sealed final-test partitions are label-purged and preserve the declared embargo.

Two benchmarks serve different purposes and remain visibly distinct. The immutable HPN DPVC v3
artifact is the external, human-auditable reference for the original expected career PAV of an exact
open national-draft selection. For example, it records pick 14 as approximately `66.83 career_pav`.
It provides no residual distribution, interval, success probability, era correction, future-pick
state model, or evidence for another draft pathway. `R² = 0.73` is fit evidence, not 73% confidence.
The product may show an HPN baseline only with its attribution, unit, version, supported domain, and
benchmark label. It may not call that baseline a Statly production estimate or mix it with assets in
another value unit.

For a selection known at the transaction cutoff, the at-trade benchmark uses the position and rule
state knowable at that cutoff. The player eventually selected never changes that historical estimate.
A future pick uses the expected value across its contemporaneous joint final-selection distribution,
`E[value(P)]`, rather than its eventual position with hindsight. After selection, lineage links the
original entitlement to the final selection and player for realized and remaining evidence without
rewriting the at-trade view.

The first executable Statly benchmark is deliberately narrower than the eventual model. It fits
training-only, mature, open-access national-draft observations at actual selection number and records
every other observation under an explicit exclusion reason. Player-count weights feed a deterministic
non-increasing weighted isotonic regression, sparse adjacent positions pool under declared support
rules, and each supported block retains its empirical outcome distribution. Unsupported ranges remain
unsupported: the benchmark does not extrapolate a convenient value. Its fitted value unit is the same
declared player-contribution unit used by the candidate player model. HPN comparison evaluates curve
shape, ordering, relative decay, and sensitivity under an explicit comparison protocol; it does not
convert career PAV into Statly contribution by assumption. This is an auditable baseline for
comparison, not an approved production candidate.

National, rookie, pre-season, mid-season, and mini-draft observations are separate pathways. A model
for one pathway cannot value another without its own supported cohort, protocol, validation, and
publication evidence. Modern father-son, academy, compensation, bid-match, and selection-order rules
remain explicit scenario inputs rather than being absorbed into nominal pick number.

Uncertainty and sampling are versioned, content-addressed protocol inputs. The deterministic sampler
uses semantic streams and counter-based SHA-256 coordinates so iteration order cannot change a result.
The bootstrap resamples whole draft classes within declared strata to preserve cohort dependence;
data-sampling uncertainty, model uncertainty, future-state uncertainty, and Monte Carlo error remain
separate and cannot be relabelled as one confidence interval.

A future-pick scenario is one coherent joint state model rather than independent pick marginals. It
binds correlated club ladder outcomes, a dated selection-rule vintage with a complete nominal-to-actual
mapping, open entitlements, a shared draft-class effect, category-conditional productive-contribution
delay, and reachable pick-distribution blocks. Simulation follows one fixed causal order: joint ladder
state, selection-order mapping, shared class effect, player outcomes, then productive delay. Delay is
football timing only and must not embed market discounting or impatience. The simulator enumerates the
exact finite state space when it is within the declared bound and otherwise uses the deterministic
counter sampler; reported Monte Carlo error is separate from football and model uncertainty.

Held-out validation is bound to one successful, immutable model-run manifest, dataset, protocol,
value unit, benchmark, and locked prediction set. Every target observation is either scored or has an
explicit exclusion. The report includes multiclass Brier score, log loss, ranked probability score,
contribution CRPS, MAE, RMSE, interval coverage, subgroup sufficiency, monotonicity, and stability
against an explicitly compatible reference fit. Assigning zero probability to the observed outcome
invalidates the report rather than being hidden behind a probability floor. Candidate selection uses
train and calibration evidence; a candidate is locked before final-test evaluation, and final-test
retuning is prohibited. Random row splits cannot establish deployable historical performance.

The Stage 4 modules and deterministic fixture tests establish source-independent contracts,
mathematical invariants, reproducibility, exact-enumeration checks, convergence checks, and validation
failure behavior. They do not establish an approved observation corpus, a real fitted model, acceptable
held-out calibration or stability, a production scenario set, source approval, Gate approval, or
publication readiness. Stage 4 exit criteria remain unmet until lawfully approved evidence is processed
through a locked real-data run and the required independent reviews accept its results.

Every successful run retains separate immutable evidence for:

- primary and secondary predictive metrics;
- comparison with declared baselines;
- calibration and interval coverage;
- subgroup behavior by era, role, position, age, availability state, and evidence quality;
- sensitivity to material assumptions;
- a point-in-time leakage audit;
- missingness and unsupported cohorts; and
- data, feature, code, configuration, seed, model, and environment identifiers.

### Stage 5 complete-trade valuation foundation

Package valuation composes the independently governed player and pick/future-pick components through
a third content-addressed valuation-bundle manifest. The bundle contains public, source-native AFL
assets only and carries no fantasy user, league, roster, or membership ownership. It fixes one common
football-contribution unit and records the exact dataset, protocol, run, and Gate 3 decision for each
component.

The executable Stage 5 boundary lives in `src/server/aflTradeIntelligence/valuation`. Its immutable
artifact chain is:

```text
valuation bundle + public lineage graph
  -> valuation case
  + aligned component draw set
  + realized-contribution ledger
  + package policy
  -> complete-trade calculation
  -> four-view snapshot set
  -> structured explanation
  -> structural validation report
```

The valuation case pins the exact bundle, graph, draw set, realized ledger, package policy, trade
parties, lineage roots, and the temporal context for all four views. Parties are real AFL clubs and
roots are public AFL assets. The case and every downstream artifact reject user, fantasy, roster,
owner, and legacy-value fields. Content addressing makes a changed parent a different artifact rather
than an in-place update.

The component draw set is either an exactly enumerated weighted joint distribution or a deterministic
sampled distribution. Each draw contains all supported lineage roots, keeps shared factors aligned
across components and clubs, and retains season paths and the separate declared data, model,
future-state, and sampling-uncertainty treatments. Product iteration order cannot redefine a draw.
Football timing is represented in component paths; market discounting, contract value, commercial
value, and opaque preference discounts are not inserted into component forecasts.

The realized-contribution ledger distinguishes observed contribution from unavailable evidence,
references immutable evidence, and validates time, club custody, player identity, and root
attribution. Realized contribution is credited once to the receiving real AFL club and stops at club
departure. It is not reconstructed from a forecast, defaulted to zero when missing, or adjusted by
later list-spot or scarcity policy.

The canonical product aggregate is one complete **trade transaction**, containing every directed
transfer between two, three, or four participating AFL clubs. It is never decomposed into independent
bilateral trades for calculation, grading, explanation, or projection. Each participating club has
exactly one **club package assessment** within that transaction. The assessment contains the club's
complete **received package**, complete **given-up package**, aligned estimated-advantage distribution,
and one package-level grade when the transaction is complete enough to grade. A trade therefore
produces two, three, or four club package assessments together; it does not produce one overall winner
card or a detached list of graded assets.

An **asset contribution** is one original transaction root viewed from a club package: positive in the
receiving club's received package and negative in the sending club's given-up package. Those two
placements reference the same authenticated root and lineage rather than creating duplicate asset
identities. Every asset remains subordinate to its club package assessment and may explain that
assessment, but it never receives an independent letter grade.

The calculation unit is the complete trade transaction. Joint draws preserve shared factors and
correlated outcomes rather than summing independent point estimates. Lineage-frontier attribution
credits each root exactly once, follows pick and player successors, and rejects missing or duplicated
frontier coverage. Unavailable inputs propagate an unavailable value with reasons; the kernel does not
coerce missing evidence to zero. Every club package assessment is derived from this same aligned draw
set, so a missing root or unbalanced endpoint makes every affected package comparison and grade
unavailable rather than allowing one club to appear complete in isolation.

Every transfer root has one sending club and one receiving club. In each aligned draw and valuation
view, the calculator derives three balancing party quantities in one named value unit:

- **package received** is the sum of supported root values received by the club;
- **package given up** is the sum of supported root values sent by the club; and
- **estimated advantage** is `package received - package given up`.

These are model estimates, not dollars, AFL Draft Value Index points, games, profit, or objective
fairness. In a closed two-party trade, one club's received package is the other's given-up package. In
a multi-party trade, all directed endpoints must balance across the complete ledger before any club
comparison is available. The public interface uses the explanatory labels above rather than naked
`received`, `surrendered`, or `net` values. Every figure carries its view, unit definition, mean,
median, uncertainty interval, effective date, evidence cutoff, coverage status, and major asset
drivers. An optional letter grade is a secondary summary of the same distribution and cannot replace
the calculation.

The server compiles a separate content-addressed trade-valuation explanation only after it has
authenticated the calculation, valuation case, content-addressed private assumption set, transfer
directions, and exact party/root coverage in every aligned draw. Its
per-asset contributions use probability-weighted means because means remain additive: received and
given-up asset rows must reconcile exactly to the displayed package subtotals and expected net. The
package median and central interval remain statistics of the aligned joint distribution and are not
presented as sums of asset medians. The explanation derives practical-equivalence mass from the
aligned draws and the value-unit band retained inside the admitted, content-addressed assumption set
before assigning the remaining probability mass to finish-ahead outcomes. The explanation retains
that policy identity, exact four-view bands, and basis beside its methodology. A caller cannot
substitute a different band or transfer map after admission. The central grade policy derives one
provisional package grade from those
reconciled probabilities; asset letter grades are prohibited because
they would discard lineage, interaction, and uncertainty context. Missing roots or mismatched ancestry
make the explanation unavailable rather than contributing zero. This first Adapter is deliberately
complete-only: the explanation derives full coverage from the authenticated draw membership and
retains the assumption set's effective window rather than accepting caller-supplied coverage. Private
synthetic explanations retain fabricated-evidence and publication-prohibited authority and cannot
satisfy a governed release lane; no governed-release authority variant exists until a real governed
Adapter can authenticate that ancestry. The retained archive-summary artifact is projected from this
same complete explanation, so partial root values cannot produce totals that disagree with trade
detail. Wiring that artifact into archive cards remains part of the later atomic-batch reader cutover.

The retained explanation contract is a deterministic **calculation narrative**, not a restatement of
the final score. It tells the calculation's evidence-backed story at two connected levels:

- the club package narrative shows the selected view, named value unit, received-package mean,
  given-up-package mean, exact subtraction producing estimated advantage, joint uncertainty interval,
  finish-ahead probabilities, grade-policy result, and the assets that materially drive the result;
- each asset narrative shows the authenticated facts and model components that produced its additive
  contribution, followed by its ordered lineage and its place in the club subtotal.

A player asset narrative identifies the player and receiving acquisition spell, the evidence cutoff,
games and complete seasons included, each season's measured contribution, the total realized
contribution, the admitted remaining-value model run, and the arithmetic producing the selected-view
asset contribution. A pick asset narrative identifies the stable pick entitlement separately from its
displayed number, the trade-date selection estimate, the admitted comparison cohort's selection range,
observation count, draft-class count, empirical outcome distribution and method, then follows every
authenticated custody, renumbering, on-trade, transformation, final selection, resulting player, and
realized or remaining contribution. Nominal pick numbers are labels inside that story, not pick
identity.

The current development panel renders authenticated package arithmetic and aggregate player and pick
evidence from this narrative. Rendering every retained season, empirical distribution, method, and
lineage step is target reader work; retaining those details does not by itself prove that every detail
is already visible in the UI.

Every numerical or factual sentence in a calculation narrative is regenerated from retained,
content-addressed source facts, model artifacts, lineage events, calculation draws, or policy
artifacts. Fixed templates may turn those structured facts into plain language; operators and callers
cannot supply prose, substitute values, or add unbound claims, and unconstrained generated numerical
or causal explanations are prohibited. The retained narrative binds every displayed claim to its
source artifact and calculation identity so exact replay can reproduce the same claim set. When a
required fact is unavailable, the narrative names the missing evidence or authority and makes the
dependent contribution and grade unavailable instead of inventing a smooth story around the gap.

At-trade package values use only the contemporaneous information set. Current package values retain
realized receiving-club contribution separately from projected remaining contribution and enforce
`current = realized + remaining`. A resolved final selection and player may explain why the current
assessment changed, but cannot leak backward into the at-trade estimate. Missing or disputed material
lineage makes the complete-party assessment unavailable rather than partially balancing against zero.

Universal football value remains visible in three ordered layers: gross contribution, list-spot
adjusted contribution, and scarcity-adjusted contribution. Their evidence-backed parameters live in
an immutable package-policy artifact and are not production defaults. Optional club utility applies
club timing and role-congestion assumptions in a separate layer and never relabels universal value.
Market, contract, and commercial value remain separate and unavailable in this kernel.

The four immutable snapshots implement four synchronized **view lenses** over the same transaction:
at-trade, realized, remaining, and current. They are not separate trades, asset collections, model
runs, or independently selectable club results. A reader selects one lens for the transaction, and
every club package, asset contribution, comparison, narrative, and lineage annotation resolves under
that same lens. At-trade knowledge cannot follow the real trade, while realized, remaining, and
current share one present temporal context.

The retained ordered weighted draw set is the single numerical source for all four lenses. Replay
must verify for every draw and selected value layer that:

- draw keys and weights are identical across roots and parties;
- every transaction root appears exactly once with one authenticated sender and receiver;
- total received value equals total given-up value and the global estimated advantage is zero;
- `current = realized + remaining` for every root, club, draw, and layer;
- means, intervals, event probabilities, pairwise comparisons, asset contributions, package grades,
  and calculation narratives derive from that same draw set; and
- the numeric representation, rounding, quantile, tolerance, and grade-policy versions are pinned.

Weighted snapshots report mean, median, an 80% central interval, downside and upside quantiles,
low-return and elite probabilities, all pairwise club comparison probabilities for every participating
club pair, confidence evidence, and exact-versus-sampled uncertainty. A failed root, direction,
weight, identity, balance, temporal, or policy check makes every dependent club comparison and grade
unavailable together. Partially available distributions may expose a clearly labelled conditional
asset summary, but never a whole-trade statistic or comparison over missing probability mass.

Explanations are rendered only from fixed templates and structured reason codes. Their statements
separate measured facts, model estimates, assumptions, unavailable information, and low-confidence
warnings. Numerical claims are regenerated from the calculation and snapshot artifacts and must pass
parity validation; unconstrained generated numerical claims remain prohibited. Legacy Expected and
Actual source fields are excluded from the kernel and cannot be relabelled as Statly value.

Four fully fabricated fixture families exercise two-party, three-party, future-pick, and on-traded-pick
chains end to end. The validator checks schemas and content addresses, graph and case lineage,
realized attribution, exactly-once terminal frontiers, deterministic calculation/snapshot/explanation
replay, explanation parity, and the public ownership boundary. Tamper tests cover changed hashes,
parents, lineage, realized evidence, snapshots, explanations, and forbidden fields.

The target MVP historical-coverage contract indexes every retained canonical trade transaction rather than
publishing only trades that happen to calculate successfully. Each indexed transaction resolves to
exactly one reader state:

- **calculated** means an admitted model automatically derived every club package assessment,
  contribution, view, narrative, and grade from complete authenticated inputs; or
- **unavailable** means the transaction remains visible but one or more named factual-evidence,
  lineage, cohort-support, model-authority, temporal, or reconciliation requirements failed closed.

There is no operator-entered score, manually completed asset value, partial package grade, or silent
archive omission. A transaction with an ambiguous later split, merge, or multi-asset exchange retains
and displays its authenticated known lineage, but its dependent contributions and club grades remain
unavailable until an admitted economic-allocation rule resolves the ambiguity. Supporting every
historical transformation shape therefore means representing, authenticating, and explaining its
state; it does not mean inventing a numeric allocation for every shape at launch.

Reader coverage reports count calculated and unavailable transactions separately by reason. A beta or
public launch cannot rely on fabricated fixtures or manually assembled values: at least one real,
admitted end-to-end model release must automatically calculate its supported historical cohort, while
every transaction outside that cohort remains explicitly unavailable rather than inheriting a score
from a different model version or evidence set.

The local private runtime now performs automatic cohort calculation after an exact current prepared-v3
input set and an automatically qualified player/pick model pair exist. It captures the factual-release,
prepared-head, model-pair, and current-batch revisions; attempts every ready trade with bounded
concurrency; retains expected unavailability per trade; and refuses the whole candidate batch when an
unexpected construction or custody failure occurs. Each ready calculation is staged under the fixed
`system:weekly-valuation-coordinator` principal. Only after exhaustive membership and ancestry checks
pass does one fenced PostgreSQL transition make the batch current. Readers therefore see the previous
complete batch or the replacement complete batch, never a partly advanced cohort.

Execution is durable and restart-safe. A content-addressed cohort capture, work cycle, per-trade work
record, attempt, result, and batch binding survive process failure. Ready work uses targeted
`(prepared_input_set_id, trade_id)` reads and shared cohort parents are cached; the worker runs at most
eight trades concurrently. Transient PostgreSQL and transport failures receive three attempts across
durable leases with heartbeats, capped backoff, claim fencing, and an exact terminal cause. Exhausted
work remains closed until a backend repair operation opens a new three-attempt cycle. Repeating an
unchanged successful run returns the exact current batch without reconstructing trades.

The local full-stack worker drains retained pending dispatches at startup and enqueues only the latest
missed Monday 19:00 `Australia/Melbourne` occurrence. A newly qualified model pair separately enqueues
immediate work. The calendar calculation preserves local wall-clock time across daylight-saving
changes and coalesces missed weekly occurrences. An authenticated backend-only command can enqueue the
same coordinator ad hoc using a caller-supplied stable operation key.

The upstream path now has a claim-fenced HPN preparation boundary, but it is not yet wired into the
weekly worker. Given one exact dispatch and live claim, it requires the exact immutable private
factual output already retained for that request,
accepts one result capture plus primary and corroborating player-stat captures under distinct source
roles, and resolves one current reviewed HPN map for each exact provider/capability/schema/season lane.
Before input construction, PostgreSQL admits each role independently under a live dispatch claim.
The immutable, content-addressed receipt binds the original accepted claim attempt, capture binding, source capture,
normalization run, source role, and projected map. That transaction alone may advance the exact capture
from `staged` to `approved`; it rechecks the current provider-map review, projected-map review,
reviewed source-use decision, and source rights after taking the same candidate and reviewed-evidence
locks as their owning writers. Concurrent calls converge on one receipt per request and role. After a
lease handoff, only the new live claimant may admit or replay the original accepted binding; an expired
claimant and superseded authority fail closed.

Only after all three receipts exist does preparation delegate input construction and calculation to
the existing content-addressed HPN repositories. Both repositories run inside one outer PostgreSQL
transaction that heartbeats and locks the live claim before input persistence, then revalidates the
claim immediately before commit. Claim loss or any calculation failure rolls back the input set,
calculation, and head together. Restart reloads accepted captures, revalidates and replays the
admissions, and reuses the existing HPN input/calculation records. The HPN receipts grant
private calculation source authority only: they are separate from factual admission and grant no
model-training, model-qualification, prepared-head, public-display, publication, production, or
activation authority. Missing or stale source custody, map approval, identity resolution,
factual-universe coverage, or method authority fails closed before downstream authority changes. The
current public release pointer and publication Gates remain untouched.

The next boundary composes the existing admitted player runner, governed pick execution, and governed
qualification service for the exact factual output and finalized HPN calculation returned by that
preparation. One content-addressed substantive operation excludes dispatch identity, trigger time,
request identity, capture identity, and other fresh custody metadata. Different requests with the same
factual values, HPN values, model targets, and qualification policy therefore converge on one model
pair. PostgreSQL retains only two new bindings: immutable request-to-exact-input lineage and monotonic
substantive-operation progress. It does not introduce another retry ledger, component-run store,
qualification store, or current-pair pointer.

The dispatch attempt remains the sole retry number and is capped at three by the scheduling boundary.
A successful component is retained independently, so a transient failure of the other component does
not rerun it. Deterministic, stale-authority, and unavailable outcomes return without blind retry.
Restart reconstructs progress after either component, pair acceptance, or qualification; a failed
qualification remains immutable evidence and cannot advance the existing current-pair authority.
The dispatch terminal `already_current` means no authority change is required because the same or a
newer qualified pair is already current; it never identifies an older retained qualification as the
current pointer.
Every operation or authority mutation is fenced by the request's current live claim. Dispatch-bound
pick execution, component registration, and qualification/current-pair advancement hold the request
and attempt rows through their owning PostgreSQL transactions; immutable artifact writes may be
orphaned after a process failure but cannot acquire accepted authority. Concurrent requests may
run for different scopes. Requests for the same scope claim serially; after the live claim ends, the
next request can bind to and resume the same substantive operation without duplicating its components.
The qualification transaction also binds its exact retained result to that substantive operation;
failure to bind rolls back the qualification, Gate 3 records, work item, and current-pair advancement
together.

Acceptance also proves component ancestry rather than trusting the coordinator callback. The player
component's admitted authorization must name the same request, substantive operation, claim attempt,
lease digest, factual output, HPN calculation, and substantive input digests. The governed pick
execution uses the dispatch-bound v4 envelope with the same fields; retained v2/v3 executions remain
valid for their existing flows but cannot satisfy this boundary. Qualification binding verifies the
retained pair, outcome, scope, and the operation's exact content-addressed qualification policy.

Automated player execution uses the admitted runner's existing rights, dataset, protocol, custody,
and publication checks. The only new operational-authority branch is a fixed non-production local
policy for `system:weekly-valuation-coordinator`; callers cannot select its principal, role,
environment, execution mode, or publication posture. The human-authorized path remains unchanged.
Operational authority recording and final run-authorization issuance independently recheck the live
dispatch claim, attempt, lease window, and exact input binding, so a stale claimant cannot begin new
model spend.
Neither the exact-input loader nor either new binding reads or writes a public release or publication
pointer.

The dispatch-bound pick component now has a genuine exact-authority runner behind the existing pick
executor seam. It loads the request-to-operation binding while the dispatch claim is live, requires
the bound private factual output and finalized governed HPN calculation, and materializes draft
observations from the factual output's exact retained release. This private materialization mode does
not consult `outcome_active_release`; the existing public materializer retains its active-release
default. The selected policy, protocol, dataset, finalized admission, HPN method and calculation,
factual member digest, operation, claim and attempt must all agree before fitting begins.

The runner reuses the existing pick-PAV observation materializer, distribution benchmark,
validation harness, governed v4 execution envelope, immutable artifact custody and governed
component manifest. Live-claim checks bracket observation persistence and precede each execution and
component custody write. Exact replay revalidates the retained policy and selection membership and
returns the retained observation set. If a process stops after component registration but before
operation acceptance, a reclaimed claim for the same request authenticates the retained execution
against its original immutable dispatch attempt and separately proves the replacement claim is live
before lookup and acceptance. The accepted operation records the replacement claim while the
execution retains its historical creation claim; the component is not rematerialized, refitted or
registered again. The model-pair coordinator also skips an already accepted pick component.
Migration 0086 preserves the public active-release finalization path and adds only the exact live
dispatch-binding alternative for a retained factual release, including the bound pick policy and HPN
calculation. Deterministic authority, materialization and validation failures remain closed; only
storage or runtime failures may return through the dispatch attempt ledger. No new retry ledger,
component store, public pointer or pick methodology is introduced.

This is still not a complete new-game-data pipeline. The deployed weekly runner continues to consume
whatever exact prepared-v3 head is current. Observation rebuild and prepared-v3 activation still need
to be composed around this dispatch-bound model-pair coordinator before the worker can run raw data
through to recalculation without manual orchestration.

### Current valuation refresh trace

The backend current-valuation refresh operation now retains the restart-safe terminal case where no
downstream work is required. Here, `no_change` has a narrow structural meaning: the current factual
release, qualified model pair, prepared-v3 input set, and private evaluation batch all exist and agree
on their exact IDs and revisions. It does not compare numerical outputs, authorize a calculation, or
claim that newly ingested observations have already been prepared.

Callers provide a valuation scope, one of the existing `weekly`, `model_qualified`, or `ad_hoc`
triggers, and a stable operation key. One PostgreSQL-owned operation captures the aligned authority,
content-addresses the scope, trigger, stable key, authority, and trusted capture time, and retains the
result append-only. Exact retry returns the retained result without downstream writes. Reusing the
stable key for another scope or trigger fails, and missing or incoherent authority fails closed. The
result explicitly remains local, private, non-production, publication-ineligible, and
publication-prohibited.

The factual stage first retains an authenticated snapshot of the exact current private
reviewed-evidence head. It then independently composes a content-addressed private factual candidate
whose custody digest binds the admitted source captures, verified artifacts, finalized normalization
runs, exact reconciliation review sets, and current source-rights records represented by that bundle.
The candidate retains the canonical normalization-run snapshots behind the digest, including each
run ID, field map, decoder and normalizer versions, content digests, receipt digests, row counts, and
trusted finalization time. Its composition receipt also binds the exact predecessor private-factual
head; a delayed candidate cannot overwrite a newer head from the same reviewed source.
Source authentication and candidate composition are separate durable stage receipts under the same
stable operation key. A restart resumes those receipts before the private factual compare-and-swap;
it does not duplicate a candidate or head transition. The operation either advances the candidate,
reports it already current, or retains one exact unavailable cause: missing, stale, mismatched, or
unauthenticated source authority.

The upstream current-evidence operation composes those existing boundaries before factual refresh.
It resolves the durable Gate decision and source-rights proposal for each of the seven exact
provider/season tuples, requires the exact current reviewed field map, and either reuses one finalized
normalization or normalizes a fresh observation through the reviewed fitzRoy runtime. Every distinct
outer operation performs a new timestamped observation. Capture persistence atomically binds that
observed capture to the operation and source before decoding starts, so a crash after capture resumes
the exact retained source snapshot instead of recapturing. The effective normalization is a separate
append-only claim keyed by source, raw-content digest, and the complete rights, Gate, field-map,
decoder, and normalizer authority digest. Unchanged bytes under unchanged authority therefore reuse
the claimed normalization and its review without pretending that the new observation did not occur;
changed bytes or authority require a new normalization. Each completed source receipt retains both
the observed capture and the effective capture/normalization. A crash after that receipt skips the
lane, and concurrent equivalent normalizations converge on the one immutable claim.

The local runtime retains its Ed25519 capture-receipt signing key as a mode-`0600` file beneath the
ignored private artifact root. A restarted process therefore reconstructs the same verifier before it
authenticates a retained non-fixture snapshot. The key is local non-production custody only; it is not
a production KMS identity or provider-egress attestation. Runtime construction requires an absolute
artifact root and rejects a signing path that is a symlink, a non-regular or multiply linked file,
owned by another user, or not exactly mode `0600`; it does not silently repair insecure custody.

After all seven lanes, a separate reconciliation fence authenticates the two exact current provider
review sets and reconstructs the complete normalized/reconciled bundle in one database snapshot. It
does not insert identity, match, fact, review-set, bundle-authority, or head decisions. Missing review
sets stop at `reconciliation_authority`; superseded or malformed decisions stop as stale or
unauthenticated; a custody/count mismatch stops at `reconciliation`. Once the human reconciliation
reviews exist, the operation separately requires the exact authorized reviewed-evidence head consumed
by factual refresh. A missing head returns `review_required`. Human review therefore remains an
explicit authority transition, not an internal worker stage.

Every unavailable result is terminal and append-only for its stable operation key. Exact retry
returns that result and performs no provider work. After the required review or authority repair, the
caller supplies a new stable operation key; the new operation discovers and reuses the retained
effective normalizations after freshly observing each source before rechecking reconciliation and
reviewed authority. Only
an authenticated reviewed head permits the content-addressed handoff to the private factual refresh.
The local launcher maps an unavailable result to one completed, exhausted dispatch rather than a
transient retry loop.

This is deliberately a private factual candidate and authority, not a factual release. The retained
reviewed bundle is evidence for composition rather than activation authority in its own right, and it
does not authorize public display or redistribution, so the factual refresh cannot write a release
manifest, registry event, registry head, or `outcome_active_release`. The original `no_change` result
keeps its narrow four-head meaning. Prepared-v3 rebuild and activation and the calculation branch
remain separate work that must be composed before newly admitted facts flow to recalculation.

A structurally valid fixture report always retains `publicationReady: false` and the remaining
external blockers: a real historical-data run, component-model calibration exit criteria, downstream
Gate approvals, and production storage and release evidence. Stage 5 therefore establishes the
source-independent calculation architecture and its invariants only. It does not establish
calibrated real-data inputs, acceptable historical trade performance, production
policy parameters, an approved valuation bundle, durable storage, numerical publication, or release
readiness.

The broader bundle contract records a clean source revision, configuration, runtime, seed, execution
identity and chronology, immutable snapshots and simulation draws, attribution and replay reports,
coverage and exclusion evidence, confidence and sensitivity reports, and bundle-level validation and
model-card artifacts. These remain contracts for reproducibility and review; they are not evidence
that a real bundle has been calculated successfully.

Gate 3 first pins each component's exact model protocol and run. A separate effective Gate 3 decision
then pins the exact valuation bundle selected by a publication. Cross-manifest validation requires the
provided dataset, protocol, and run inventories to match the bundle exactly; verifies every component's
model kind, value unit, feature definitions, prespecified windows, successful outcome, environment,
source set, cohort exclusions, and chronology; and binds the publication's scope, views, validation
report, and model card to the bundle. A missing component, borrowed single-model report, ineffective
component decision, or ineffective bundle decision fails closed. These contracts do not assert that a
protocol or bundle has been approved, a run has succeeded on real data, or Gate 3 has production
authority.

Failure leaves the public archive available without numerical valuation. Product design must not turn
a failed or missing model into hidden fallback numbers.

### Local private valuation reader surface

The current implementation remains a local development surface admitted only to the explicit signed-in
development reader. Each current read joins the single current private-evaluation batch pointer to the
trade's exact batch entry before loading a generation. The generation's one projection manifest binds
the `archive_summary`, `detail`, `reader_api`, and `json_export` artifacts; all four are authenticated
from retained bytes and therefore resolve one batch entry, generation, and manifest. The workbook
archive still supplies factual transaction membership and readiness, while governed numerical
documents remain private and publication-prohibited.

The current reader is the authenticated local development operator. A future registered-reader surface
may admit registered users to archive, detail, and permitted JSON calculation evidence without exposing
construction authority or lifecycle operations. Internal authenticated routes serve the present local
screen and export; the MVP does not document or promise a third-party valuation API.

Every activated valuation generation retains one content-addressed projection manifest that binds:

- the canonical archive-card data document for the transaction;
- the canonical trade-detail document containing every club package and expandable asset narrative;
- the generation artifact and exact calculation identities; and
- the exact retained JSON export byte artifact, including its media type, digest, and byte length.

Runtime HTML, React output, authentication state, filters, pagination, and build identifiers are not
retained as calculation evidence. Governed detail, internal transport, and export authenticate and
replay the same retained derivation before serving it. They expose the same generation and projection
manifest identities, and export serves the retained bytes directly rather than serializing a fresh
runtime object. The workbook archive currently supplies factual transaction membership and readiness;
replaying its retained `archive_summary` projection through the governed reader remains future work.
The registered-reader export contains the public facts, model summaries, arithmetic, reason codes, and
lineage needed to verify the published calculation; it excludes private source custody, review material,
credentials, operator authority, and publication controls.

The sole governed workspace interface remains `inspect`, `execute`, and exact `read`; automated staging
is internal to the PostgreSQL workspace factory and is not a caller-mintable authority. Its selector is
the composite `(valuationScopeKey, tradeId)` identity. `read` accepts only current selection or one
explicit generation identifier; it has no latest-generation alias or silent fallback. Withdrawal makes
the current valuation explicitly unavailable, while an authenticated exact historical generation read
remains available with its inactive, superseded, or withdrawn lifecycle label. Retained legacy
generation versions use exhaustive version dispatch and either an authenticated compatible projection
or an explicit `projection_unavailable` state; the reader never invents missing projection bytes.

Construction first retains an authenticated automated intent, dormant generation, projection
documents, projection manifest, and exact export bytes. Per-trade lifecycle receipts remain immutable,
but current visibility is owned by the batch head: a serializable compare-and-swap activates all batch
members together. A stable operation identifier makes retry resume or return that same attempt rather
than creating another generation. An individually withdrawn batch member becomes unavailable without
selecting a fallback generation. Whole-batch rollback selects only a previously active complete batch
and records a new transition; historical parents may be selected without pretending they are the
current factual/model cohort. Reconstruction verification is read-only.

The proof has explicitly separate lanes. Pure deterministic, non-production fixtures prove two-,
three-, and four-club projection construction and the eight-worker concurrency bound. Migrated
PostgreSQL fixtures separately prove authenticated staging/replay, exhaustive atomic batches, pinned
projection reads, member withdrawal, whole-batch rollback, and exact replay of a 783-member blocked
cohort. The multi-club PostgreSQL test retains deterministic projection bytes and exercises batch/read
behavior; it does not claim to run the production construction workspace end to end. The private-input
lane proves missing factual or model evidence remains explicitly unavailable and never borrows
authority from a fixture. These are engineering proofs, not evidence of real AFL calibration, a factual
release, registered-reader availability, hosted operation, or publication readiness. In the
user-facing private screen an unavailable package grade is `—`; detailed blocker and retry causes stay
in backend evidence.

## Immutable publication

Model runs and valuation bundles are not public publications. Publication manifest v2 references the
exact valuation bundle rather than choosing one component dataset or model run as a proxy for the
whole calculation. Registration validates the actual content-addressed publication manifest. The
source-independent state machine moves it through candidate, validated, approved, published,
superseded, rejected, or withdrawn states. Validation requires the exact downstream projection
manifest, approval requires an effective Gate 4 decision that pins both artifacts, and publication
requires an effective Gate 5 decision with the same pins. Only a published publication may be selected
by the active pointer for a declared product/model scope.
Publishing a replacement supersedes the prior active publication atomically. Withdrawing the active
publication removes the active pointer. A superseded publication may become active again only through
a fresh, current validation and gate-authorized activation; withdrawal never backdates or silently
reactivates fallback output.

WP1 implements and tests these transitions as pure deterministic state. Mechanical decision
resolution does not approve Gate 4 or Gate 5, persist a registry, authorize operational reviewers,
construct a projection, or mutate a live active pointer. Those responsibilities begin only after their
source, persistence, model, product, and serving gates pass.

The source-independent serving boundary now captures one publication, valuation bundle, projection,
scope, and registry revision for each read. Its selector and projection-repository ports keep storage
choices outside request orchestration. List and detail composition validates bounded inputs, supported
views, exact trade/view membership, projection metadata, timestamps, pagination, value unit, and the
final v2 response schema. Export and publication-specific methodology must consume the same captured
selection when their concrete adapters are implemented; no response may mix publication versions.

`GET /api/draft-trades/valuations` accepts a bounded page of public trade IDs and one view.
`GET /api/draft-trades/[tradeId]/valuation` first confirms the trade exists in the legacy public
archive, then returns one to four requested views. Both are anonymous transport adapters over the same
runtime-selected read service.

The list projection is intentionally distinct from the full detail projection. A numerical list item
contains side expected and median values, one central interval, finishes-ahead probabilities,
practical equivalence, assessment, value unit, compact coverage, warnings and confidence. Strict
validation rejects detail-only uncertainty components, explanation factors and exclusion records in
list items, preventing the explorer from becoming a batch simulation-detail endpoint. Full detail
reads retain the richer valuation result contract, including fifth/tenth-percentile downside,
ninetieth/ninety-fifth-percentile upside, low-return probability and elite-outcome probability.

The public UI consumes those contracts without recalculating value distributions. One central grade
policy derives presentation grades from the validated summaries so explorer cards, trade detail,
valuation detail, and club history cannot drift. When any list item is value-bearing, mobile and
desktop explorer cards render per-trade summaries with the assessment, grade, expected and median side
values, central interval, finishes-ahead and practical-equivalence probabilities, coverage,
confidence, calculation date and methodology link. Full detail renders the published club grades and
distributions, asset attribution, resolved lineage, per-view values, current
realized-plus-remaining components and explanation factors. Balanced assessments remain explicitly
too close to call. Partial, stale and previous-available states retain their public caveat; below-threshold
coverage renders `Grade unavailable`.

Numerical detail also requires a public asset-attribution projection. Each original traded asset has
a stable asset ID, canonical public kind, receiving AFL club, lineage root, uniquely credited lineage
frontier, and a value or explicit exclusion for every numerical view in the response. Current asset
value must equal realized plus remaining value. Per-view exclusions must match coverage records and
valued asset estimates must sum exactly to each receiving club's published total, preventing ancestor
and successor double-counting from passing the API boundary. This is real AFL club attribution only;
the contract rejects user, fantasy league, roster and owner fields.

When no numerical publication is selected, detail returns no asset attribution and a lineage summary
whose counts, edge total and maximum depth are `null`. Unknown lineage is never represented as zero.
Raw evidence, lineage graphs and operational review data remain behind the analytical boundary.

Every numerical result and numerical list summary has structured confidence dimensions for model
calibration, data coverage, identity, lineage and source freshness as applicable. The public overall
confidence level must equal the weakest included dimension. Confidence therefore cannot be raised by
averaging strong model evidence over a weak identity, lineage, coverage or freshness boundary.

`GET /api/draft-trades/methodology` is the stable public model-metadata boundary. A published response
must identify the exact valuation bundle and value unit, both governed model components, the primary
outcome definition, training period, calculation time, all four valuation views, supported data
coverage, known limitations and material changes from the previous release. Those fields must match
the same captured publication and projection metadata used by value reads. With no active
publication, the endpoint returns `methodology: null` and `no-active-publication`; it
does not invent a model version, training period, calculation date or outcome definition.

When the selector reports no active publication, list and detail reads return the requested views as
`not_calculated` and do not call a projection repository. A current publication with ineffective
source authority returns `source_blocked`. Once a publication is
active, repository failure, revision drift, mismatched publication/projection/scope, missing trade or
view members, and invalid chronology fail closed as typed serving errors; none may reuse the
prepublication source blocker as a fallback. Methodology reads apply the same rules: incomplete
four-view selections, registry revision drift, projection identity mismatch, repository failure and
invalid publication-bound metadata fail closed. PostgreSQL/object-storage composition now exists and
is selected only by explicit runtime configuration. It authenticates persisted Gate/publication
state, uses the exact projection-to-artifact custody row, rejects objects above the fixed bound before
full read, and mounts the captured projection rather than a latest alias. This does not create a real
publication: candidate, rejected, partially built, or unactivated data remain incapable of reaching
an active public read.

## Calculation operations

The source-independent operations boundary is deliberately separate from transport, infrastructure,
and publication authority:

- calculation inputs pin the public scope, environment, as-of time, knowledge cutoff, valuation
  bundle, datasets, evidence manifests, source registers, views, code commit, and configuration;
- a content-addressed logical run contains append-only content-addressed attempts and captures the
  last-good publication at queue time;
- queued, running, succeeded, failed, and cancelled transitions preserve chronology and reject stale
  attempt or lease ownership;
- only the current unexpired lease may commit success, and a retry appends a new attempt only after a
  retryable failure;
- success creates an exact publication/projection candidate; it never changes the publication
  registry or converts the captured last-good snapshot into a serving pointer;
- aligned schedule occurrences produce deterministic dispatch keys, and an adapter may enqueue only
  after winning a durable atomic unique claim for that key;
- source or calculation approval absence, excessive lateness, and active same-scope work prevent
  enqueue;
- content-addressed health snapshots combine current source-rights evidence, active-publication and
  projection evidence, latest run state, and explicit freshness thresholds into serve, retain,
  suppress, withdraw, retry, stop, or investigate recommendations; and
- a model recalibration or material change produces a distinct candidate release and an append-only,
  independently reviewed model-change record. Its strongest outcome is a recommendation for Gate 3
  review, not approval or publication.

Operational recommendations are declarative. The selected runtime adapters must persist run
transitions transactionally or with revision compare-and-swap, enforce dispatch-key uniqueness,
preserve immutable artifacts, and route health alerts. Only the Gate ledger and publication registry
may approve or activate a release. The [public AFL trade-intelligence operations
runbook](../runbooks/afl-trade-intelligence-operations.md) owns scheduling, execution, health, incident,
withdrawal, recovery, recalibration, and exact-commit verification procedure.

## Remaining production delivery milestones

The repository contains the governed engineering foundation for source custody, reconciliation,
factual releases, point-in-time valuation inputs, player approximate value, pick-value observations,
model-execution evidence, complete-trade assessment contracts, and independent publication state.
That foundation is not equivalent to a live factual dataset or an approved trade grade. Completion is
reported by milestone, never as one blended percentage:

| Milestone                 | Current state | Completion evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Engineering foundation    | Complete      | Normalized migrations and contracts, disposable real-PostgreSQL rehearsal, supported checks, build, cleanup, and review are complete.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Non-production operations | Partial       | The source-independent fitzRoy private-candidate, full factual-release, and disposable dump/destroy/restore PostgreSQL rehearsals are complete, including local parity, rollback, no-fallback withdrawal, recovery, and restored parity. A separate governed local rehearsal retains, stages, and explicitly reviews five completed AFL Tables seasons plus the exact current official evidence set for private workbook evaluation. A reviewed real-data factual release, hosted services, hosted restore, and alert burn-in still need execution evidence. |
| Factual production        | Not complete  | No reviewed real-data factual release has been activated and verified across every public read/export surface.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Valuation production      | Not complete  | No locked real-data player/pick model and complete-trade valuation publication has passed Gates 3, 4, and 5 and been activated.                                                                                                                                                                                                                                                                                                                                                                                                                              |

The remaining work proceeds through these independently verifiable gates:

1. **Provision the isolated production boundary.** Create hosted outcomes PostgreSQL, immutable object
   storage, Redis-backed scheduling/leases, least-privilege service roles, secrets, backups, restore
   targets, dashboards, alerts, and a tested deployment path. Provisioning grants no data or
   publication authority.
2. **Operate recurring source capture.** Load the exact current Gate 0A records and field manifests,
   then schedule Draftguru trade/draft capture and fitzRoy-backed player-detail/stat capture with
   conditional requests, rate limits, immutable readback, drift quarantine, retries, and complete
   historical backfill accounting.
3. **Reconcile and promote canonical facts.** Resolve provider identities and clubs without display-name
   joins; conserve every source row and issue; promote reviewed transactions, directed assets, draft
   selections, pick entitlements, and stable pick lineage. A future pick remains unresolved until its
   exact selection and player are authenticated.
4. **Activate factual production independently.** Build the exact factual corpus and candidate,
   generate sealed public projections and exports, complete factual and operational review, activate
   the pointer atomically, and verify trades, drafts, outcomes, clubs, years, APIs, and exports resolve
   the same release and effective-through instant. Valuation may remain unavailable.
5. **Lock real-data player and pick models.** Run the admitted Stage 3 player-contribution model and
   Stage 4 selection-specific pick distribution through chronological train, calibration, validation,
   and untouched final-test partitions. Add separately validated future-pick distributions using
   season, entitlement, club trajectory, draft mechanism, and correlated ladder uncertainty.
6. **Assess the complete exchange.** Value each party from joint draws of all assets received minus all
   assets surrendered, including multi-party correlations and pooled lineage. Publish no grade when
   identity, lineage, coverage, or numerical validation is unresolved. The explanation must expose
   expected net value, uncertainty range, finish-ahead probability, source coverage, original pick
   value, eventual selection, observed contribution, and remaining uncertainty.
7. **Approve and activate valuation separately.** Gate 3 pins the reproducible model run and bundle;
   Gate 4 accepts numerical validity; Gate 5 accepts product comprehension. Only then may an immutable
   valuation publication bind to the exact active factual release and be activated under its own
   pointer and rollback path.
8. **Retire migration-era runtime paths.** Remove workbook and Firestore selection from public runtime,
   remove legacy wording and spreadsheet access, and retain the workbook only as private offline
   reconciliation evidence when its retention decision permits it. Finish real-PostgreSQL concurrency,
   browser, accessibility, load, security, canary, withdrawal, rollback, and restore verification.

The program is complete only when both factual and valuation production milestones pass, the public UI
can reconstruct and explain every assessment from immutable database members, scheduled capture no
longer depends on a workbook, and withdrawal/last-good recovery has been rehearsed against the exact
deployed release.

## Migration and rollback

After the exact Gate 1 package and a real isolated analytical target are separately approved, the
public engine may proceed independently of the protected fantasy PostgreSQL cutover:

1. record the exact Draftguru, Footywire-draft, official-AFL, AFL Tables, Footywire-stat, Fryzigg,
   fitzRoy player-details, HPN-formula, and migration-workbook decisions and uses, then provision
   isolated object storage and the hosted PostgreSQL database, roles, pooled/direct secrets, backups,
   monitoring, and restore target without granting either authority;
2. review the isolated public-outcomes schema against the approved package, then apply only its
   PostgreSQL-native migration history to that isolated target;
3. rehearse database migration, object retrieval, backup restore, and rollback on disposable
   infrastructure;
4. capture permitted Draftguru, Footywire-draft, official-AFL, and fitzRoy/upstream responses as
   immutable source objects with digests and retention metadata; retain the workbook only as a frozen
   private migration object;
5. stage and validate every field, resolve public AFL identities, and retain all exceptions without
   coercing missing evidence to zero;
6. reconcile source-to-canonical row, field, natural-key, identity, lineage, and digest counts;
7. build acquisition spells and source-grain factual metrics with deterministic, versioned rules;
8. create a factual-outcome candidate, generate its website and supporting API views, and prove
   release parity;
9. obtain factual review and separate operational authorization, then atomically activate the exact
   factual release under an expected-revision write barrier;
10. verify the outcome explorer, trade, club, player, year, dashboard, and supporting API reads all
    resolve the same release and effective-through date;
11. seal the HPN formula artifact, fit and validate Statly's same-unit player and pathway-specific pick
    models, and keep at-trade information separate from selected-player outcomes;
12. calculate and validate complete-party Trade Assessments before approving valuation publications
    and serving projections on their separate release path;
13. remove workbook runtime composition, public preview, spreadsheet access, and spreadsheet export
    jobs after sourced shadow reconciliation passes; and
14. verify the retired Firestore and workbook read paths cannot be selected and retain legacy evidence
    only under its separately approved retention plan. Do not infer authority from provisioning,
    migration, import, deployment, or projection success.

Before the first analytical write, rollback may remove the unused target database and objects according
to the approved retention policy. After writes are accepted, preserve the database and immutable source
evidence and use a forward fix or reviewed reverse migration. An analytical rollback never switches the
protected fantasy database or its credentials. A factual rollback withdraws or supersedes the factual
release through its own append-only registry; a valuation rollback separately withdraws numerical
valuation. Reactivating an eligible prior release requires fresh validation and authorization, and
public history is never rewritten in place.

An authority rollback is a separate append-only event from a publication rollback. It must occur
inside the recorded rollback window, restore the declared prior authority, and advance the authority
epoch. After the window closes, retire the prior authority only through the reviewed retirement
conditions; do not silently fall back through an exception path.

## Release evidence

WP1 is locally verified when the strict schemas, temporal rules, lineage fixtures, attribution
invariants, manifest contracts, publication state machine, Gate 1 package and authority-transition
contracts, response contracts, terminology checks, and ownership-boundary tests pass using fabricated
data. This is engineering evidence for the pure foundation only.

The factual capability is production-verified only when exact upstream and migration-evidence
decisions, Gate 1
architecture approval, immutable-object retention/retrieval evidence, hosted PostgreSQL and credential
isolation from protected fantasy state, separately authorized authority transitions, field-level
validation, identity/lineage/acquisition-spell reconciliation, and factual website/API release parity,
migration and restore rehearsal, API contracts, responsive and accessibility evidence, operational
alerts, rollback exercises, and representative production reads/jobs all pass. Numerical valuation
additionally requires an authenticated HPN reference artifact, approved common-unit feature/model
evidence, pathway-specific pick support, model validation, complete-party assessment parity, valuation
publication parity, and its own product and release Gates.

Passing the factual manifest and lifecycle fixture tests proves content integrity, transition rules,
stale-revision rejection, exact selection, and no-fallback withdrawal behavior. The disposable
fitzRoy factual-release rehearsal additionally proves the implemented PostgreSQL transactions and
local API, projection, export, and archive-page parity against its deterministic candidate. Neither
that fixture lifecycle nor the separate governed local capture proves complete human review, parity
against a fully reconciled real corpus, hosted cache invalidation, hosted backup/restore, disaster
recovery, or a production release.

Selecting the isolated target in design does not mean it is provisioned, ready, authoritative, or
approved. The current external blockers are exact machine-recorded source decisions and field uses,
approved retention/redistribution terms, provisioned object storage and hosted PostgreSQL, reconciled
real identities and lineage, reviewed metric and value-unit definitions, real-data player and pick
model evidence, and authorized factual and valuation releases. WP1 completion does not satisfy any of
them. Reports
must name every skipped or failed gate and keep factual outcomes and valuation independently
unavailable when their own requirements do not pass.

## Related documentation

- [Runtime and data platform](data-platform.md)
- [Protected fantasy PostgreSQL cutover](../runbooks/postgresql-cutover.md) — related platform context,
  not an analytical-engine prerequisite
- [Product design principles](../product/design-principles.md)
- [Player identity consolidation](../runbooks/player-identity.md)
- [Public AFL Draft & Trade Outcomes operations](../runbooks/afl-trade-intelligence-operations.md)
