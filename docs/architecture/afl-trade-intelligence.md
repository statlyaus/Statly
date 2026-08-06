# Public AFL Draft & Trade Outcomes

- Status: the legacy public archive, source-independent governance/valuation contracts, strict
  factual-outcome evaluation/read contracts, and truthful prepublication outcome UI/API exist; the
  separate factual-outcomes target is defined, but isolated hosted PostgreSQL, immutable object
  storage, approved source capture, reviewed factual releases, real-data model development,
  deployment, and production verification are not complete
- Last verified against source: 2026-08-06

## Purpose

Statly's AFL Draft & Trade Outcomes capability is a public, non-fantasy research domain for historical
AFL transactions and the factual outcomes attached to them. Its first responsibility is to preserve
what moved, resolve public AFL identities and pick lineage, and report governed acquisition-spell
facts such as games, goals, votes, and awards. A separately approved valuation capability may later
add reproducible estimates, but factual outcome publication must not depend on a model release.

The source workbook is evidence and an import/export format. It is never the request-time authority,
a live database, or a manually maintained competitor to the reviewed public release. The long-term
authority target is an isolated hosted PostgreSQL database; original workbooks and permitted fitzRoy
source snapshots belong in immutable object storage. Neither target is provisioned or authoritative
merely because it is described here.

The capability is distinct from protected fantasy trading:

- public reads do not require a Statly account, fantasy league, membership, or roster;
- no Statly user owns a public AFL trade, player, pick, valuation, or lineage record;
- club custody means control by a real AFL club at an effective point in time;
- `LeagueTradeThread`, `LeagueTradeOffer`, fantasy roster ownership, and league authorization remain
  owned by the protected fantasy domain; and
- internal model review or publication controls use operational authorization, not fantasy roles.

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
withdrawn, stale, or unsupported for a cohort. A separately published model may answer four distinct
questions:

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

The current archive is served from versioned Firestore collections through server-only read helpers.
Those collections originate from imported archive material and expose transactions, parties, assets,
and unverified legacy `Expected` and `Actual` fields. The browser-facing pages and APIs are public.
Firestore currently contains archive documents and an active-collection pointer, but it is a legacy
serving store rather than the proposed factual-outcomes authority or a demonstrated rebuildable
release projection. The workbook is not queried by the application at request time.

The current Firestore path resolves `draftMeta/currentVersion`, caches the selected collection in the
server process for 60 seconds, and catches pointer-read failures by falling back to default collection
names. Its conversion helpers can coerce missing or malformed numeric fields to zero. The search path
performs a separate pointer lookup and fallback, so two reads do not yet have a durable shared
collection revision. The import script writes versioned collections and then mutates the pointer, but
does not implement expected-revision compare-and-swap, demonstrated parity, or a recorded last-good
rollback. These behaviors are current-state risks to replace deliberately; they are not evidence that
Firestore is ready to become the new engine's projection authority.

The public `/draft/outcomes` page and `/api/draft-trades/outcomes` route now expose a strict
`afl-draft-trade-outcomes/v1` read contract for games, goals, coaches votes, Brownlow votes, and
evidence-bearing achievements. The boundary preserves checked zero, missing, partial, differing,
single-source, and unavailable states; requires exact release metadata, metric definitions, scope,
effective-through dates, and source references; structurally rejects fantasy/user identifiers; and
prevents unresolved player identities from carrying checked facts. An active read uses the metric
definitions captured with that exact release, validates each evidence reference and fact cutoff
against them, and rejects repository rows outside exact requested year and metric/status predicates.
The repository owns governed alias, abbreviation, normalization, and text-index matching semantics.
The current composition intentionally captures no active factual release, never calls a workbook or
Firestore fallback, and returns no rows. The annual-workbook evaluator is a pure staging/evaluation
boundary, not a request-time importer or permission to publish its values.

The source-independent WP1, modeling, and valuation foundations are implemented separately from those
existing archive reads. They provide strict public contracts, source-governance and artifact-manifest
schemas, bitemporal lineage rules, deterministic fabricated fixtures, attribution invariants,
publication state transitions, a player-contribution baseline harness, draft-pick and future-pick
distribution harnesses, and a complete-trade valuation artifact chain. The operational layer adds
immutable calculation runs and attempts, pure lease and retry transitions, content-addressed schedule
decisions and dispatch claims, operational-health recommendations, and append-only model-change
reviews. The modeling and valuation modules can fit deterministic benchmarks, run simulations,
compose aligned component draws, calculate package distributions, produce snapshots and structured
explanations, and evaluate locked predictions supplied through their contracts, but only fabricated
fixtures have been used to establish local behavior. These modules do not read production evidence,
write a database, configure a queue or scheduler, establish approved real-data performance, publish
numerical values, or activate a public projection. The separate WP7A public boundary adds an honest
unavailable-state experience, contract-ready numerical views, and a general methodology page; it is
not evidence that a numerical valuation exists.

WP1 completion therefore means that later work has a deterministic boundary to build on. It does not
mean that a historical source is approved, object storage or managed PostgreSQL is operational, a
reconciled factual corpus exists, a factual outcome release is reviewed, a model is approved, a
publication is active, or the feature is release-ready.

The protected fantasy Prisma schema currently targets SQLite. Its platform-wide PostgreSQL cutover is
planned and unexecuted, but it is not the migration path for this public capability. The trade engine
has no implemented relational store. Its selected design target is an independently migrated managed
PostgreSQL database, or an isolated database and role on an approved managed PostgreSQL service, with
separate credentials, connection budgets, migrations, backups, and restore evidence. It contains no
`User`, fantasy `League`, membership, roster, or fantasy-trade ownership relation.

The repository has an authenticated, exact-identifier, in-memory valuation-artifact read adapter, but
no approved durable object-storage adapter, factual PostgreSQL repository, factual release selector,
or trusted external decision-evidence registry for this capability. Do not describe the analytical
PostgreSQL target, object storage, factual release views, or valuation artifact source as ready; do not
apply the protected fantasy schema or SQLite migration history to them or introduce the public schema
into an unapproved target.

fitzRoy is the selected technical adapter family for obtaining compatible AFL statistical evidence,
not a source-rights grant. It can expose multiple upstream providers, and every capture must name the
exact upstream, function/parameters, package version, retrieval time, source grain, and permitted
fields. The repository's existing Footywire-through-fitzRoy ETL supplies live-stat evidence for
fantasy calculations; that path neither supplies historical trade/pick lineage nor establishes
permission to retain, derive, display, or model data for this separate public product.

## Proposed target architecture

This is the architecture proposed for Gate 1 review, not evidence that its infrastructure is ready or
authorized. The generic gate-decision ledger records any eventual Gate 1 decision. There is no
separate Gate 1 receipt: an immutable decision is audit evidence, not a replayable runtime permission.

```text
source-rights proposal
  -> externally authorized Gate 0A decision
  -> content-addressed Gate 0A evaluation receipt
  -> immutable workbook and permitted fitzRoy/upstream snapshots in object storage
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
  -> release-scoped public outcome views and generated XLSX/CSV/JSON
  -> public factual service, outcome explorer, trade detail, and exports
  + optional valuation path:
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
| Source permission and intended use             | Reviewed source-rights register                      | fitzRoy or workbook access is not permission                    |
| Original workbooks and upstream snapshots      | Immutable content-addressed object storage           | Retention and redistribution follow exact source terms          |
| Import runs, evidence metadata, and exceptions | Isolated outcomes PostgreSQL database                | References immutable source objects; failed rows remain visible |
| Public AFL identities                          | Isolated outcomes PostgreSQL database                | Source identities; no fantasy ownership or foreign key          |
| Trades, parties, assets, and club custody      | Isolated outcomes PostgreSQL database                | Normalized, relational, and bitemporal                          |
| Games, goals, votes, and awards facts          | Isolated outcomes PostgreSQL database                | Preserve source grain and null-versus-zero semantics            |
| Asset lineage and acquisition spells           | Isolated outcomes PostgreSQL database                | Versioned rules with conservation and custody invariants        |
| Reviewed factual-outcome releases              | Append-only PostgreSQL release records and views     | Independent pointer; candidates never leak into public reads    |
| Generated XLSX, CSV, and JSON                  | Release-derived export artifacts                     | Rebuildable from one reviewed release; never reverse authority  |
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
- an immutable artifact repository is absent; and
- a trusted decision-evidence registry is absent.

The snapshot is a reproducible repository assessment with `productionClaim: false`. It cannot claim
that inspected infrastructure is production-ready or that its evidence is independently true.

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
context, audience, requested operations, fields and uses, retention, cache duration, and conditions.
It returns only `mechanically_eligible` or `blocked`. Mechanical eligibility means that the supplied
records are internally consistent with the encoded decision; it is not legal advice and does not
create authority.

Each evaluation produces a `gate0a-evaluation:` receipt that hashes the complete request and result.
Raw evidence items reference that receipt and list their captured source fields. Full-chain validation
rejects evidence retrieved before its receipt, fields absent from the receipt, blocked evaluations,
and rights, decision, scope, or environment mismatches.

Decision environments are isolated as `test_fixture`, `non_production`, and `production`. Fixture
authority is valid only in `test_fixture` and can never authorize non-production or production use.
Approved records expire at their revalidation time, can be superseded only by the next version in the
same gate, key, and environment, and can be withdrawn with explicit downstream actions. Durable ledger
persistence and operational authorization remain later implementation work.

There is currently no production source-rights artifact, named approved provider, authority evidence,
or approved Gate 0A decision for this capability. Historical capture, backfill, and all downstream data
work therefore remain blocked. Possession of the local workbook does not establish its provenance or
grant retention, derivation, public-display, or redistribution rights. Likewise, fitzRoy is an adapter
over separately governed upstream sources: its package licence and technical access do not grant rights
to AFL, FootyWire, AFL Tables, or another provider's data. The maintained
[source-rights assessment](afl-trade-source-rights-assessment.md) records the reviewed candidates,
rejection reasons, evidence request, and minimum approval criteria without creating authority.

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
Gate 2 approves that corpus before a feature dataset can be created. A successful reproducible run and
Gate 3 decision precede the candidate publication; the projection is a separate downstream manifest.
Cross-manifest validation requires exact parents, source sets, environments, effective decisions, and
chronology throughout.

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
  -> Gate 2 decision
  -> reviewed factual-outcome release
  -> active factual-release pointer
  + optional feature dataset manifest
  -> optional model-protocol manifest
  -> optional model-run manifest
  -> Gate 3 decision pinning protocol and run
  -> valuation publication manifest
  -> valuation projection manifest
  -> Gates 4 and 5
  -> active valuation-publication pointer
```

Source-independent contracts, deterministic lineage fixtures, manifest schemas, and unavailable
product states may be implemented while these gates are unresolved. Synthetic or fixture data must
never be represented as production evidence or used to approve a production gate.

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

### Independent factual and valuation releases

A factual-outcome release binds an exact archive dataset, source snapshot set, metric registry,
acquisition-spell rule version, effective-through time, exception disposition, review decision, and
release identifier. The active factual pointer changes atomically only after reconciliation and review.
Public outcome list, trade detail, club, player, year, dashboard, and export views all resolve that same
captured release.

Valuation publications remain independent. A reviewed factual release neither approves a model nor
activates a numerical valuation; a blocked or withdrawn valuation does not hide an otherwise approved
factual release. When a page composes both, each response retains its own release/publication envelope
and the valuation manifest must bind the exact factual/archive inputs it used. Mixed-version joins fail
closed.

Generated workbooks, CSV, and JSON are outputs of one factual release and include its identifier and
effective-through date. An operator may also submit an approved workbook as a new immutable import
candidate, but editing an export never mutates the active database or public release.

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
verification envelope once, indexes the exact summary, detail, methodology, and valuation-export
documents, and performs no artifact or external-source request during page reads. Each read requires
an exact captured registry selection and evaluates the authenticated freshness policy. The mounted
adapter retains a monotonic evaluation high-water mark: a clock regression cannot make a previously
expired projection servable again during that mounted adapter instance. This is not durable across a
remount or process restart; live serving must restore a trusted monotonic minimum from durable state
before evaluating freshness. Failed-candidate context may retain only an explicitly active prior
publication that is still current or stale; it never changes the registry pointer.

The adapter also exposes ordered `afl-trade-valuation-csv/v1` projection rows as a distinct interface.
It does not alter the historical archive CSV or relabel its imported `Expected` and `Actual` columns.
Routes may adopt that new interface only as an explicit contract change.

### Prepublication public delivery boundary

The public explorer and trade-detail server pages now read through the same publication-aware service
as the value APIs. The explorer requests a bounded list page for the `current` view; a full trade page
requests all four views. Until the required evidence use is approved and an immutable publication is
active, the service returns a server-created `source_blocked` result for every requested trade and
view. The explorer consolidates an all-blocked page into one archive-level notice, while full detail
selects the current-view blocker. A blocker has no publication reference, model vintage, temporal
context, numerical payload, winner, or estimated release time. Its reason is
`valuation-source-use-not-approved`, and its only action links to the general methodology page at
`/draft/trades/methodology`.

This unavailable result applies only to the additional evidence needed for Statly valuation. It does
not disable the existing historical AFL archive. The archive remains anonymous and separate from the
fantasy domain: public AFL trades and assets have no user, league, roster, or membership owner.

The prepublication constructor is confined to the no-publication branch inside the read-service
composition; public pages do not call it directly. The current route composition deliberately captures
a selector with no active publication. The immutable artifact repository is implemented and tested,
but no approved durable byte source or active registry selector is configured in route composition. A
serving transition must provide those approved adapters through the existing service ports, not bypass
the service. After numerical publication begins, read failures or withdrawals must resolve to their
truthful contract state (`stale`, `failed_previous_available`, `withdrawn`, or another applicable
unavailable state); they must never fall back to the hard-coded prepublication result or to legacy
archive numbers.

Imported archive fields labelled Expected and Actual remain visible only as legacy fields. Their
original source definition and methodology are unverified, so the UI must not describe them as
Statly value, fairness, or a winner. A missing legacy value is rendered as a dash and must remain
distinguishable from a recorded zero. The general methodology page explains planned views and release
requirements but is not publication-specific methodology and must not imply that a model is running.

The current UI has local desktop and 390-pixel evidence for the source-blocked archive and detail
states, including keyboard focus, no horizontal overflow, and no observed console or hydration error.
That evidence does not cover a numerical publication. This work does not establish source approval,
Gate 1 approval, model approval, Gate 5 publication approval, publication activation, release
readiness, or numerical product completion.

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

The first executable benchmark is deliberately narrower than the eventual model. It fits training-only,
mature, open-access national-draft observations at actual selection number and records every other
observation under an explicit exclusion reason. Player-count weights feed a deterministic
non-increasing weighted isotonic regression, sparse adjacent positions pool under declared support
rules, and each supported block retains its empirical outcome distribution. Unsupported ranges remain
unsupported: the benchmark does not extrapolate a convenient value. This is an auditable baseline for
comparison, not an approved production candidate.

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

The calculation unit is the complete multi-party trade. Joint draws preserve shared factors and
correlated outcomes rather than summing independent point estimates. Lineage-frontier attribution
credits each root exactly once, follows pick and player successors, and rejects missing or duplicated
frontier coverage. Unavailable inputs propagate an unavailable value with reasons; the kernel does not
coerce missing evidence to zero.

Universal football value remains visible in three ordered layers: gross contribution, list-spot
adjusted contribution, and scarcity-adjusted contribution. Their evidence-backed parameters live in
an immutable package-policy artifact and are not production defaults. Optional club utility applies
club timing and role-congestion assumptions in a separate layer and never relabels universal value.
Market, contract, and commercial value remain separate and unavailable in this kernel.

The four immutable snapshots represent at-trade, realized, remaining, and current views. At-trade
knowledge cannot follow the real trade, while realized, remaining, and current share one present
temporal context. The calculation enforces `current = realized + remaining` for every root, draw,
club, and value layer rather than checking only aggregate means. Weighted snapshots report mean,
median, an 80% central interval, downside and upside quantiles, low-return and elite probabilities,
all pairwise club comparison probabilities, confidence evidence, and exact-versus-sampled uncertainty.
Partially available distributions may expose a clearly labelled conditional summary, but never a
whole-trade statistic or comparison over missing probability mass.

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

A structurally valid fixture report always retains `publicationReady: false` and the five external
blockers: lawful source rights, a real historical-data run, component-model calibration exit criteria,
effective Gate approvals, and production storage and release evidence. Stage 5 therefore establishes
the source-independent calculation architecture and its invariants only. It does not establish an
approved source, calibrated real-data inputs, acceptable historical trade performance, production
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
read service and currently expose only the verified prepublication state.

The list projection is intentionally distinct from the full detail projection. A numerical list item
contains side expected and median values, one central interval, finishes-ahead probabilities,
practical equivalence, assessment, value unit, compact coverage, warnings and confidence. Strict
validation rejects detail-only uncertainty components, explanation factors and exclusion records in
list items, preventing the explorer from becoming a batch simulation-detail endpoint. Full detail
reads retain the richer valuation result contract, including fifth/tenth-percentile downside,
ninetieth/ninety-fifth-percentile upside, low-return probability and elite-outcome probability.

The public UI consumes those contracts without recalculating them. When any list item is
value-bearing, mobile and desktop explorer cards render per-trade summaries with the assessment,
expected and median side values, central interval, finishes-ahead and practical-equivalence
probabilities, coverage, confidence, calculation date and methodology link. Full detail renders the
published club distributions, asset attribution, resolved lineage, per-view values, current
realized-plus-remaining components and explanation factors. Balanced assessments remain explicitly
too close to call. Partial, stale and previous-available states retain their public caveat, and legacy
Expected and Actual fields remain visually and semantically separate.

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
publication, the endpoint returns `methodology: null` and the verified source-approval blocker; it
does not invent a model version, training period, calculation date or outcome definition.

When the selector reports no active publication, list and detail reads return the requested views as
the current `source_blocked` state and do not call a projection repository. Once a publication is
active, repository failure, revision drift, mismatched publication/projection/scope, missing trade or
view members, and invalid chronology fail closed as typed serving errors; none may reuse the
prepublication source blocker as a fallback. Methodology reads apply the same rules: incomplete
four-view selections, registry revision drift, projection identity mismatch, repository failure and
invalid publication-bound metadata fail closed. The repository can serve authenticated in-memory
release bytes through the value, methodology, and explicit valuation-export interfaces, but the route
and public-page composition do not persist a registry, configure a durable artifact byte source, or
assert that a numerical publication exists. No Firestore or PostgreSQL analytical adapter, live source
pipeline, real publication, or active numerical route composition has been implemented. The UI is
contract-ready, but candidate, rejected, and partially built data remain incapable of reaching an
active public read through this code alone. Live composition additionally requires a concrete byte
source that enforces the declared size limit before allocation, contract tests for that enforcement,
and durable monotonic freshness state so a restart cannot reactivate an expired release.

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

## Migration and rollback

After the exact Gate 1 package and a real isolated analytical target are separately approved, the
public engine may proceed independently of the protected fantasy PostgreSQL cutover:

1. approve exact workbook and upstream uses, then provision isolated object storage and the hosted
   PostgreSQL database, roles, pooled/direct secrets, backups, monitoring, and restore target without
   granting either authority;
2. introduce a separate reviewed public-outcomes schema and PostgreSQL-native migration history;
3. rehearse database migration, object retrieval, backup restore, and rollback on disposable
   infrastructure;
4. capture the approved workbook and permitted fitzRoy/upstream responses as immutable source objects
   with digests and retention metadata;
5. stage and validate every field, resolve public AFL identities, and retain all exceptions without
   coercing missing evidence to zero;
6. reconcile source-to-canonical row, field, natural-key, identity, lineage, and digest counts;
7. build acquisition spells and source-grain factual metrics with deterministic, versioned rules;
8. create a factual-outcome candidate, generate its public views and exports, and prove release parity;
9. obtain factual review and separate operational authorization, then atomically activate the exact
   factual release under an expected-revision write barrier;
10. verify the outcome explorer, trade, club, player, year, dashboard, and generated export reads all
    resolve the same release and effective-through date;
11. develop and approve model datasets, runs, valuation publications, and serving projections only on
    their separate optional path; and
12. retire the Firestore archive pointer only after release-scoped PostgreSQL parity, rollback, and
    observation evidence pass. Do not infer authority from provisioning, migration, import,
    deployment, or projection success.

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

The factual capability is production-verified only when workbook and upstream source approval, Gate 1
architecture approval, immutable-object retention/retrieval evidence, hosted PostgreSQL and credential
isolation from protected fantasy state, separately authorized authority transitions, field-level
validation, identity/lineage/acquisition-spell reconciliation, factual release and export parity,
migration and restore rehearsal, API contracts, responsive and accessibility evidence, operational
alerts, rollback exercises, and representative production reads/jobs all pass. Numerical valuation
additionally requires approved feature/model evidence, model validation, valuation publication parity,
and its own product and release Gates.

Selecting the isolated target in design does not mean it is provisioned, ready, authoritative, or
approved. The current external blockers are exact workbook provenance/use rights, upstream rights for
each fitzRoy-backed source and field, approved retention/redistribution terms, provisioned object
storage and hosted PostgreSQL, reconciled real identities and lineage, reviewed metric definitions,
and authorized factual and valuation releases. WP1 completion does not satisfy any of them. Reports
must name every skipped or failed gate and keep factual outcomes and valuation independently
unavailable when their own requirements do not pass.

## Related documentation

- [Runtime and data platform](data-platform.md)
- [Protected fantasy PostgreSQL cutover](../runbooks/postgresql-cutover.md) — related platform context,
  not an analytical-engine prerequisite
- [Product design principles](../product/design-principles.md)
- [Player identity consolidation](../runbooks/player-identity.md)
- [Public AFL Draft & Trade Outcomes operations](../runbooks/afl-trade-intelligence-operations.md)
