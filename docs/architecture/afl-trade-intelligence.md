# Public AFL trade intelligence

- Status: WP1 pure deterministic foundations, Gate 1 decision/transition contracts, and the WP7A
  prepublication public boundary are implemented with local contract coverage; Gates 0A and 1 have
  no production approval, and analytical persistence, model development, numerical publication
  services, and numerical product delivery are not complete
- Last verified against source: 2026-08-02

## Purpose

Statly's AFL Draft & Trade Archive is a public research product for historical AFL transactions. The
trade-intelligence capability may add reproducible estimates of what clubs exchanged and subsequently
received, but it must not turn public AFL records into fantasy assets or user-owned records.

The capability is distinct from protected fantasy trading:

- public reads do not require a Statly account, fantasy league, membership, or roster;
- no Statly user owns a public AFL trade, player, pick, valuation, or lineage record;
- club custody means control by a real AFL club at an effective point in time;
- `LeagueTradeThread`, `LeagueTradeOffer`, fantasy roster ownership, and league authorization remain
  owned by the protected fantasy domain; and
- internal model review or publication controls use operational authorization, not fantasy roles.

## Product contract

The archive must remain useful when numerical valuation is unavailable, withdrawn, stale, or not
supported for a cohort. A published model may answer four separate questions:

1. **At-trade decision value:** the distribution of future contribution knowable at the transaction
   date.
2. **Realized club contribution:** contribution delivered to a club after the transaction, stopping
   when the player leaves that club.
3. **Remaining value:** forecast contribution after a stated valuation date.
4. **Current outcome distribution:** a present-day combination of realized contribution and remaining
   value using an explicitly named model version.

These views must never be silently combined. Every numerical response identifies its value unit,
valuation view, effective date, knowledge cutoff, publication, model version, and uncertainty.

Permitted language describes model estimates, distributions, assumptions, and evidence. Public copy
must not claim objective fairness, causal certainty, or an unqualified winner or loser.

## Current repository state

The current archive is served from versioned Firestore collections through server-only read helpers.
The browser-facing pages and APIs are public. Firestore currently contains archive documents and an
active-collection pointer, but it is a legacy serving store rather than a demonstrated rebuildable
analytical projection.

The current Firestore path resolves `draftMeta/currentVersion`, caches the selected collection in the
server process for 60 seconds, and catches pointer-read failures by falling back to default collection
names. Its conversion helpers can coerce missing or malformed numeric fields to zero. The search path
performs a separate pointer lookup and fallback, so two reads do not yet have a durable shared
collection revision. The import script writes versioned collections and then mutates the pointer, but
does not implement expected-revision compare-and-swap, demonstrated parity, or a recorded last-good
rollback. These behaviors are current-state risks to replace deliberately; they are not evidence that
Firestore is ready to become the new engine's projection authority.

The source-independent WP1 foundation is implemented separately from those existing archive reads. It
currently provides strict public contracts, source-governance and artifact-manifest schemas,
bitemporal lineage rules, deterministic fabricated fixtures, attribution invariants, and publication
state transitions. These modules do not read production evidence, write a database, fit a model,
publish numerical values, or activate a public projection. The separate WP7A prepublication boundary
adds an honest unavailable-state experience and general methodology page; it is not a numerical
valuation experience.

WP1 completion therefore means that later work has a deterministic boundary to build on. It does not
mean that a historical source is approved, managed PostgreSQL is operational, an analytical corpus
exists, a model is approved, a publication is active, or the feature is release-ready.

The Prisma schema currently targets SQLite. Managed PostgreSQL is the proposed production target, but
the platform-wide cutover described in [the PostgreSQL runbook](../runbooks/postgresql-cutover.md) is
planned and unexecuted. The repository has no implemented immutable artifact repository and no
trusted external decision-evidence registry for this capability. Do not describe PostgreSQL or object
storage as ready, replay SQLite migrations against PostgreSQL, or introduce the analytical schema into
an unapproved target.

The repository's Footywire/fitzRoy ETL supplies live-stat evidence for fantasy calculations. That
existing technical path does not establish permission to train or publish this separate historical
trade-intelligence product from the same upstream data.

## Proposed target architecture

This is the architecture proposed for Gate 1 review, not evidence that its infrastructure is ready or
authorized. The generic gate-decision ledger records any eventual Gate 1 decision. There is no
separate Gate 1 receipt: an immutable decision is audit evidence, not a replayable runtime permission.

```text
source-rights proposal
  -> externally authorized Gate 0A decision
  -> content-addressed Gate 0A evaluation receipt
  -> immutable, content-addressed evidence manifest
  + pre-registered data-sufficiency protocol
  -> content-addressed coverage report
  -> externally authorized Gate 0B decision
  + content-addressed current-state snapshot
  -> complete architecture decision package
  -> externally authorized Gate 1 decision
  -> normalized bitemporal corpus manifest in approved managed PostgreSQL
  -> externally authorized Gate 2 decision
  -> feature dataset and reproducible model-run manifests
  -> externally authorized Gate 3 decision
  -> immutable candidate-publication manifest
  -> rebuildable projection manifest
  -> externally authorized Gates 4 and 5
  -> atomic active-publication pointer
  -> public service and transport adapters
  -> archive and trade-detail UI
```

### Authority by concern

| Concern                                   | Proposed long-term authority                                     | Constraint                                   |
| ----------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------- |
| Source permission and intended use        | Reviewed source-rights register                                  | Technical access is not permission           |
| Retrieved evidence                        | Immutable content-addressed storage                              | Retention follows source terms               |
| Evidence metadata and quality issues      | PostgreSQL analytical domain                                     | References immutable evidence                |
| Public AFL identities                     | PostgreSQL analytical domain linked to canonical identity policy | Does not create fantasy ownership            |
| Trades, parties, assets, and club custody | PostgreSQL analytical domain                                     | Normalized and bitemporal                    |
| Asset lineage and attribution             | PostgreSQL analytical domain                                     | Typed edges with conservation invariants     |
| Feature and model artifacts               | Immutable artifact storage with PostgreSQL metadata              | Reproducible from manifests                  |
| Valuation snapshots                       | Append-only PostgreSQL publications                              | Candidates never leak into active reads      |
| Public serving representation             | Versioned Firestore/cache projection                             | Rebuildable and never canonical              |
| Public HTTP routes                        | Thin transport adapters                                          | Validate input and call shared read services |

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

- the relational provider is currently SQLite;
- the legacy archive uses a cached Firestore pointer and default-collection fallback;
- malformed or missing legacy numerical fields may be coerced to zero;
- search performs a separate pointer lookup and fallback;
- archive import mutates the pointer without revision CAS, demonstrated parity, or last-good rollback;
- the PostgreSQL cutover is unexecuted;
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
work therefore remain blocked. FootyWire-derived ingestion is not approved for this use: an open-source
client or adapter licence does not grant rights to upstream data.

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
window, embargo, and exclusion. The coverage report records one measured ratio or explicit
unmeasurable reason for every prespecified measure/cohort pair. It cannot add post-hoc observations or
hide a failing cohort behind an aggregate.

The Gate 0B decision pins the protocol and report. A later corpus manifest pins that decision and owns
normalized identity, real-club custody, lineage, reconciliation, quality, and quarantine artifacts.
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
  -> feature dataset manifest
  -> model-run manifest
  -> Gate 3 decision
  -> publication manifest
  -> projection manifest
  -> Gate 4 decision
  -> Gate 5 decision
  -> active-publication pointer
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
valuation time, unit, per-club estimate and uncertainty, structured factors, comparison probabilities,
practical-equivalence probability, assessment, methodology link, and asset coverage. Probabilities
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

Publication and dataset identifiers are lowercase SHA-256 content addresses with `publication:` and
`dataset:` prefixes. Public projection builds use the same rule with a `projection:` prefix. A response
selects one active publication, one explicit historical publication, or none. Numerical results require
one immutable selected publication; active selection references only a published publication; withdrawn
results identify the withdrawn publication; and list items cannot override the response publication.
Serving, publication, calculation, and knowledge-cutoff times must be chronologically consistent.

### Prepublication public delivery boundary

Until the required evidence use is approved and an immutable publication is active, the public trade
explorer and trade-detail route receive one server-created `source_blocked` result for the `current`
view. That result has no publication reference, model vintage, temporal context, numerical payload,
winner, or estimated release time. Its reason is `valuation-source-use-not-approved`, and its only
action links to the general methodology page at `/draft/trades/methodology`.

This unavailable result applies only to the additional evidence needed for Statly valuation. It does
not disable the existing historical AFL archive. The archive remains anonymous and separate from the
fantasy domain: public AFL trades and assets have no user, league, roster, or membership owner.

The prepublication constructor is a temporary composition dependency, not a read service, serving
authority, or exception fallback. WP6 must replace it at the server-component boundary with the
approved, publication-consistent read service. After numerical publication begins, read failures or
withdrawals must resolve to their truthful contract state (`stale`, `failed_previous_available`,
`withdrawn`, or another applicable unavailable state); they must never fall back to the hard-coded
prepublication result or to legacy archive numbers.

Imported archive fields labelled Expected and Actual remain visible only as legacy fields. Their
original source definition and methodology are unverified, so the UI must not describe them as
Statly value, fairness, or a winner. A missing legacy value is rendered as a dash and must remain
distinguishable from a recorded zero. The general methodology page explains planned views and release
requirements but is not publication-specific methodology and must not imply that a model is running.

WP7A demonstrates this safe prepublication product boundary only. It does not establish source
approval, Gate 1 approval, model approval, Gate 5 publication approval, publication activation,
responsive browser verification, release readiness, or numerical product completion.

## Model and validation boundary

The target, value unit, role taxonomy, replacement baseline, feature availability, censoring rules,
pick-distribution method, package simulation, and acceptance thresholds are frozen in a protocol before
candidate training.

Validation uses chronological train, calibration, validation, and final-test windows. Features are
joined as known at each transaction cutoff. Random row splits cannot establish deployable historical
performance.

Every candidate is compared with declared baselines and reports:

- primary and secondary predictive metrics;
- calibration and interval coverage;
- subgroup behavior by era, role, position, age, asset class, and evidence quality;
- sensitivity to material assumptions;
- missingness and unsupported cohorts; and
- data, feature, code, configuration, seed, model, and environment identifiers.

Failure leaves the public archive available without numerical valuation. Product design must not turn
a failed or missing model into hidden fallback numbers.

## Immutable publication

Model runs are not public publications. Registration validates the actual content-addressed
publication manifest. The source-independent state machine moves it through candidate, validated,
approved, published, superseded, rejected, or withdrawn states. Validation requires the exact
downstream projection manifest, approval requires an effective Gate 4 decision that pins both
artifacts, and publication requires an effective Gate 5 decision with the same pins. Only a published
publication may be selected by the active pointer for a declared product/model scope.
Publishing a replacement supersedes the prior active publication atomically. Withdrawing the active
publication selects the most recent eligible superseded publication or leaves the scope without an
active publication.

WP1 implements and tests these transitions as pure deterministic state. Mechanical decision
resolution does not approve Gate 4 or Gate 5, persist a registry, authorize operational reviewers,
construct a projection, or mutate a live active pointer. Those responsibilities begin only after their
source, persistence, model, product, and serving gates pass.

The eventual serving boundary captures one publication identifier and registry revision for each
read. List, detail, export, and methodology responses must not mix publication versions. Cache and
projection keys include the publication identifier and relevant query dimensions. Candidate,
rejected, or partially built projection data is isolated from active public reads. Public availability
uses the complete closed vocabulary in the public response contract above; availability outcomes are
domain results, not generic server errors.

## Migration and rollback

After the platform PostgreSQL cutover, exact Gate 1 package, and real target are separately approved:

1. introduce the reviewed analytical schema through PostgreSQL-native migrations;
2. rehearse migrations and rollback on disposable infrastructure;
3. observe and record the package's integrity, temporal, query, retention, and capacity criteria;
4. import approved evidence through idempotent adapters;
5. reconcile source-to-canonical counts and hashes;
6. build lineage and attribution with deterministic invariants;
7. build and validate an isolated candidate publication;
8. project the approved publication to versioned public collections;
9. obtain separate operational authorization and record a `prepared` transition;
10. engage the write barrier and re-run the declared parity checkpoint; and
11. append `activated` with expected-revision CAS. Do not infer cutover from deployment success.

Before the first analytical write, rollback may remove the unused target schema. After writes are
accepted, preserve the database and use a forward fix or reviewed reverse migration. Published output
is rolled back by selecting the last approved publication or withdrawing numerical valuation; public
history is never rewritten in place.

An authority rollback is a separate append-only event from a publication rollback. It must occur
inside the recorded rollback window, restore the declared prior authority, and advance the authority
epoch. After the window closes, retire the prior authority only through the reviewed retirement
conditions; do not silently fall back through an exception path.

## Release evidence

WP1 is locally verified when the strict schemas, temporal rules, lineage fixtures, attribution
invariants, manifest contracts, publication state machine, Gate 1 package and authority-transition
contracts, response contracts, terminology checks, and ownership-boundary tests pass using fabricated
data. This is engineering evidence for the pure foundation only.

The capability is production-verified only when source approval, Gate 1 architecture approval,
trusted infrastructure-readiness evidence, separately authorized authority transitions, coverage,
migration rehearsal, lineage invariants, model validation, publication parity, API contracts,
responsive and accessibility evidence, operational alerts, rollback exercises, and representative
production reads/jobs all pass.

WP1 completion does not mean data/source approved, architecture-approved, database-ready,
authority-transferred, model-approved, publication-active, release-ready, or production-verified.
Reports must use those states separately, name every skipped or failed gate, and preserve unavailable
public product states when later gates do not pass.

## Related documentation

- [Runtime and data platform](data-platform.md)
- [PostgreSQL cutover](../runbooks/postgresql-cutover.md)
- [Product design principles](../product/design-principles.md)
- [Player identity consolidation](../runbooks/player-identity.md)
