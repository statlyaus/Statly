# Public AFL Draft & Trade Outcomes operations

## Purpose and authority

This runbook owns operational procedure for the public AFL Draft & Trade Outcomes capability and its
separately governed valuation layer. It does not operate fantasy leagues, user-owned teams, fantasy
rosters, or the authenticated fantasy trade system. Public AFL players, clubs, draft picks, trades,
source facts, calculations, and publications have no Statly-user ownership. AFL club custody is not
fantasy ownership.

The source-independent contracts, legacy archive, fail-closed factual-outcome page/API, factual
candidate/projection manifests, and deterministic expected-revision factual lifecycle are implemented,
along with provider-neutral byte-custody and source-snapshot contracts, but the page/API intentionally
select no factual release and serve no checked rows. The only custody implementation is fixture-only.
Approved workbook/upstream capture, durable immutable object storage, hosted public-outcomes
PostgreSQL, durable factual release infrastructure, job infrastructure, real model releases, real Gate
decisions, deployment, and production verification are not evidenced by the repository. Do not
interpret possession of a workbook, successful fitzRoy call, passing fixture test, build, model-change
review, import, or calculation as permission to retain or publish data or numbers.

The durable runtime adapters eventually selected for this subsystem must preserve these authorities:

- the calculation-run store owns append-only run and attempt records;
- the scheduler store owns an atomic unique constraint on each content-addressed dispatch key;
- immutable object storage owns original approved workbook and fitzRoy/upstream response bytes;
- the isolated outcomes PostgreSQL database owns normalized public facts, exceptions, and release
  metadata;
- the factual release registry alone owns the active factual-outcome pointer;
- the valuation publication registry separately owns the active valuation pointer;
- the Gate decision ledger owns approval; and
- approved source-rights evidence remains a prerequisite for collection, calculation, and serving.

The operations contracts live under `src/server/aflTradeIntelligence/operations`. Factual release,
valuation publication, and Gate state remain separate boundaries under `outcomes`, `publication`, and
`governance`. Never route a factual outcome through the valuation pointer or infer fantasy ownership.

## Before enabling live work

Do not configure a recurring job or analytical writer until all of the following are evidenced for the
target environment:

1. Gate 0A source-rights evidence is effective for each workbook or fitzRoy-backed upstream and permits
   the exact capture, fields, derivation, retention, caching, public fact display, generated export,
   model, and public-output uses requested by the operation.
2. The current authority-transition package permits analytical writes to the selected isolated store.
3. Gate 1 and the applicable corpus/data decision permit the exact immutable source objects,
   PostgreSQL schema, source-grain facts, metric definitions, and acquisition-spell rules used by a
   factual candidate. Gates 2–3 additionally permit exact datasets, protocols, model runs, and
   valuation bundles when model work is requested.
4. Object storage, public-outcomes PostgreSQL, factual release, calculation-run, schedule-claim,
   valuation artifact, projection, and publication stores used by the operation have approved durable
   adapters, backup/restore evidence, retention rules, and least-privilege identities.
   The projection byte source must reject an object above the repository's declared 128 MiB limit
   before allocating or returning the complete payload; an adapter-side check after an unbounded load
   is not sufficient.
5. The dispatch adapter enforces `dispatchKey` uniqueness atomically. Read-then-enqueue without a
   unique claim is not sufficient.
6. Workbook/source reconciliation, factual release parity, generated-export parity, projection parity,
   both release rollback paths, source withdrawal, and last-good recovery have been rehearsed on
   disposable infrastructure as applicable.
7. Monitoring routes every critical health alert to an accountable operator.
8. Preview behavior is verified from the exact candidate commit. Production behavior is verified only
   after a deployment record identifies that same commit.

Until the source and factual checklist passes, the public archive may expose only its current legacy
records and truthful factual-unavailable states. Until the additional model checklist passes, it may
expose reviewed factual outcomes but must keep valuation numerical states unavailable.

## Capturing workbook and fitzRoy evidence

The workbook is an immutable evidence input and interchange format, never a live serving store. The
site, API, workers, and calculation jobs must not open a local or uploaded workbook at request time.
Generated workbooks are release outputs and cannot be edited to mutate the active database.

For each capture or import:

1. Resolve current Gate 0A evidence from the trusted complete durable decision ledger immediately
   before retrieval for the exact source object, source register/provider/dataset/version, environment,
   competition, season range, fields, intended uses, retention period, and redistribution behavior.
   Stop before retrieval when any requested use is absent or blocked; an embedded receipt alone cannot
   rule out an omitted withdrawal or superseding decision.
2. For a workbook, record its externally assigned source identity and dataset version, original
   filename as metadata, byte length, media type, digest, received time, provenance evidence, and
   rights decision; require its filename extension, workbook format, and approved media type to agree.
   For fitzRoy, also pin the package version, exact upstream source and dataset version, function,
   pre-authorized content-addressed arguments, rate/cache policy, retrieval time, response media type,
   byte length, and digest. Never rely on a fitzRoy default source.
3. Store the original bytes once in the approved immutable object store under a content-addressed key.
   Verify a read-back digest before creating an import run. Do not put source bytes, local paths, or
   credentials in Git, logs, PostgreSQL payload columns, or public responses.
   The implemented port requires content-addressed `putIfAbsent`, returns the first-writer canonical
   reference for a same-byte/same-media retry, requires a declared maximum before loading, and emits a
   content-addressed read-back receipt for that canonical reference. A provider adapter must preserve
   those semantics and must not add overwrite or mutable `latest` behavior.
4. Create one import run that references the immutable object and a reviewed mapping/schema version.
   Load into release-scoped staging; do not upsert directly into active public tables or views.
5. Validate every field before normalization. At minimum check type, required/null state, finite and
   allowed numeric range, controlled vocabulary, natural key, duplicate grain, season/round/match
   references, club and player identities, effective time, source field permission, and provenance.
6. Preserve games, goals, votes, and awards at their declared source grain. Do not infer awards from
   statistics, copy a season fact into match rows, treat a missing field as zero, or count both a pick
   and its resolved player as separate contribution.
7. Reconcile every input row and governed field to normalized, unresolved, conflicting, quarantined,
   not-applicable, or rejected status. Persist exceptions with public-safe reason codes and protected
   review evidence; no row may disappear from the accounting report.
8. Resolve identities and pick lineage only through reviewed evidence. Manual overrides are append-only
   decisions with actor, reason, evidence, effective time, knowledge time, and supersession history.
9. Build acquisition spells using the exact reviewed rule version. Confirm contribution begins at the
   supported acquisition boundary, stops when the player leaves the receiving AFL club, and does not
   double-count ancestors, descendants, packages, or return assets.
10. Produce a candidate reconciliation report containing object digests, source/staging/canonical row
    and field counts, duplicate counts, identity/lineage outcomes, exceptions, metric coverage, and
    aggregate checks. An import success only means the candidate was built; it does not publish it.

A failed capture or import preserves its run and diagnostics, marks no release active, and leaves the
previous reviewed release unchanged. Retrying creates a new attempt or import run referencing the same
immutable object; it never overwrites the failed evidence.

## Publishing a factual outcome release

A factual candidate is independent from a valuation candidate. It may publish governed descriptive
outcomes without approving a model, and its approval cannot activate valuation.

1. Capture the current factual pointer and registry revision. Pin the exact archive dataset, immutable
   source objects, import/reconciliation report, identity and lineage decisions, metric registry,
   acquisition-spell rule version, exception dispositions, effective-through time, schema version, and
   candidate content digest.
2. Verify source rights remain effective for public fact display and every generated export field.
   Withdrawal, expiry, or a narrower current decision blocks the candidate.
3. Re-run structural, field, identity, lineage, acquisition-spell, null-versus-zero, aggregate, and
   release-completeness checks from the immutable inputs. Reviewers must see unresolved and quarantined
   evidence; do not calculate coverage only from accepted rows.
4. Generate candidate list, trade-detail, club, player, year, dashboard, and export views under the
   candidate release identifier. No active/public query may select them yet.
5. Reconcile representative and total counts across normalized tables, release views, XLSX, CSV, and
   JSON. Confirm each output identifies the same release and effective-through date and that legacy
   `Expected`/`Actual` fields remain labelled as unverified archive data rather than factual metrics.
6. Exercise measured zero, missing, partial, unresolved identity, unresolved lineage, unsupported
   metric, stale, withdrawn, source-object failure, and release-mismatch cases. The public contract must
   distinguish each without fabricating a value or falling back to the workbook or Firestore default
   collections.
7. Obtain the exact Gate 4 factual/API review and Gate 5 comprehension/accessibility decisions, each
   pinning the candidate release and projection. Separately obtain the operational activation
   authorization. Record reviewers, authority evidence, target environment and scope, release and
   projection identifiers, parity-report identifier, expected registry revision, authorization expiry,
   rollback window, and engaged write barrier.
8. Engage the factual write barrier, repeat the declared parity checkpoint, and use expected-revision
   compare-and-swap to activate the candidate once. A concurrent winner requires fresh capture and
   review; never force the pointer.
9. Confirm representative public reads and generated downloads resolve the activated release. Record
   cache/projection invalidation and monitor errors, latency, release mismatches, and exception counts
   through the observation window.
10. Preserve the previous factual release and immutable evidence for the authorized rollback and
    retention periods. Retire the legacy Firestore pointer only through its separately reviewed
    migration plan after parity and observation pass.

The public site reads reviewed PostgreSQL release views, optionally through a release-bound cache. It
never reads staging, exceptions, raw object bytes, a candidate release, or a mutable spreadsheet.

The repository's pure factual lifecycle is the executable conformance rule for steps 1, 7, and 8. The
candidate hashes the complete Gate 0A receipt for each source snapshot, including exact operations,
fields/uses, audience, retention, and cache terms; the candidate and projection are content-addressed;
and validation requires current Gate 0A source-rights decisions. Activation re-evaluates each complete
source-rights proposal and bound request at the activation timestamp—including terms, conditions,
restrictions, exact consumed fields/uses, retention, and cache—then rechecks the Gate 4 review, verifies
the separate Gate 5 decision, and requires a distinct content-addressed operational authorization for
the exact revision with the parity checkpoint and write barrier pinned while both its authorization and
rollback windows remain open. Strict command parsing rejects unknown fields and executable accessors.
Every mutation authenticates strict registry, record, and pointer envelopes; validates the full
transition history and authority identities; and extends a content-addressed global event chain that
commits every historical affected-record snapshot and revalidates its projection and authority state.
The public selector must load the current Gate 0A
ledger and evaluate the bound rights at its serving timestamp; activation is never a permanent rights
cache. A
future PostgreSQL adapter must implement those transitions transactionally and preserve the emitted
history. Running the pure fixture state machine is not activation, and the application must remain on
the prepublication selector until that adapter, real decisions, and production verification are
approved.

## Scheduling an optional valuation occurrence

This section begins only after an eligible factual release exists and the independent model Gates pass.
It does not apply to factual imports or factual release activation.

1. Resolve the effective source and calculation Gate decisions at the occurrence time. Never reuse a
   stale Boolean from a previous job.
2. Build calculation inputs that pin the environment, public scope, as-of time, knowledge cutoff,
   valuation bundle, datasets, evidence manifests, source registers, views, code commit, and
   configuration artifact.
3. Evaluate the schedule occurrence with `evaluateAflTradeCalculationSchedule`.
4. Act on its decision:
   - `not_due`, `skip_late`, `blocked`, and `defer_overlap`: record the decision and do not enqueue;
   - `deduplicate`: acknowledge the already-claimed occurrence and do not enqueue again;
   - `enqueue`: atomically insert `proposedClaim` using `dispatchKey` as a unique key, then enqueue only
     if that insert succeeds.
5. If another worker wins the unique claim, treat the delivery as `deduplicate`. Do not create a second
   job with a random identifier.
6. Persist the schedule decision and claim as operational evidence. Queue delivery itself is not the
   durable calculation record.

The periodic calculation `calculationAsOf` must equal the aligned schedule occurrence. A full
historical recalibration is not a normal scheduled calculation; use the model-change procedure below.

## Running and retrying an optional valuation calculation

1. Create the run with `queueAflTradeCalculationRun`, capturing the active publication pointer as
   `lastGoodAtStart`. This snapshot is evidence, not a mutable serving pointer.
2. Atomically persist the queued run before dispatching worker work.
3. Start only the current queued attempt and issue a bounded lease. Persist the resulting running state
   using compare-and-swap on the expected attempt identifier.
4. Heartbeat before lease expiry. A late worker cannot renew an expired lease.
5. Persist one terminal outcome:
   - success pins the exact publication and projection candidate but does not activate either;
   - failure records classification, retry eligibility, public-safe summary, and diagnostics artifact;
   - cancellation retains execution and lease evidence when work had started.
6. Accept a successful result only from the current attempt and current unexpired lease. Stale workers
   and mismatched leases must fail closed.
7. Retry only a failure explicitly marked retryable. A retry appends a new content-addressed attempt;
   it does not rewrite or delete the failed attempt.
8. Do not retry a terminal failure until its cause and evidence have been reviewed.

Persist transitions transactionally or with revision compare-and-swap. The pure transition functions
validate state; a runtime adapter must still prevent concurrent writers from both persisting divergent
successors.

## Valuation publication after calculation

A successful calculation is a candidate, not an active publication.

1. Verify all candidate manifests and artifacts by identifier and digest. For publication v3, replay
   the complete evidence-source, trade-materialization, aggregate-materialization, document-set, stored
   document, schema-bundle, and parity envelope and derive projection v2 from that replay. A compact
   projection v1 manifest is valid only for the legacy publication v2 migration path.
2. Complete model-change review when the candidate changes or recalibrates a model release.
3. Resolve fresh effective Gate 3, Gate 4, and Gate 5 decisions for the exact candidate and environment.
4. Configure the candidate artifact source to open only the requested projection identifier and to
   enforce the repository byte limit before returning data. Mount the exact release once; do not query
   by scope or `latest`. Verify the concrete source rejects an oversized object before complete-payload
   allocation with a contract test against the deployed adapter.
5. Rehearse representative list, detail, methodology, and explicit valuation-export reads using one
   captured registry selection. Confirm publication, projection, scope, value unit, bundle, views,
   cohorts, exclusions, registry revision, document counts, export ordinals, and calculation/knowledge
   times match. Confirm no artifact or external source is read after mount.
6. Exercise current, stale, failed-candidate-retained, expired, source-error, malformed-release, and
   clock-regression cases. Expired or unavailable output must not serve, and moving a clock backward
   must not reactivate it. Restart or remount the serving process and confirm it restores a trusted
   durable monotonic minimum before freshness evaluation, so restart cannot reactivate an expired
   release.
7. Apply publication-registry commands in their allowed order. Only the registry's governed publish
   transition may change the active pointer.
8. Confirm the resulting active pointer, registry revision, projection identity, and representative
   public reads all refer to the same release.
9. Preserve the previous release and recovery evidence for the declared rollback window.

Never update the active pointer from the calculation worker, scheduler, health evaluator, API route, or
UI. Never substitute an ungoverned candidate when a published projection is unavailable.

## Health evaluation and alerts

### Factual outcome health

No durable factual-outcome health adapter is implemented. The selected runtime must monitor immutable
source-object retrieval and digest verification, PostgreSQL connectivity and restore status, import
failures, rejected/quarantined field counts, unresolved identity and lineage counts, acquisition-spell
coverage, factual pointer consistency, release-view parity, export parity, freshness, and cache release
mismatches. Alerts must use bounded labels and link to the exact import or release evidence; source
rows, names, local paths, and protected review payloads do not belong in telemetry labels.

An object-integrity failure, rights withdrawal, active factual-release mismatch, or failed release
parity immediately suppresses affected factual metrics and blocks new publication. A transient read
failure does not authorize the workbook, a candidate release, legacy Firestore defaults, or an older
release to become current. The factual registry remains unchanged until an authorized withdrawal or
recovery command succeeds.

### Valuation health

Build `AflTradeOperationalHealthInput` from fresh source-rights evidence, the exact active valuation
pointer, projection verification, latest calculation run, and reviewed thresholds. Persist the
resulting content-addressed snapshot and route every alert. The implemented evaluator recommends
action; adapters and authorized operators execute it.

| Alert                                | Immediate response                                                        | Publication handling                                                  |
| ------------------------------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `source_rights_not_approved`         | Stop new collection and calculation; open the source-withdrawal procedure | Withdraw an active numerical publication through the registry         |
| `active_projection_integrity_failed` | Quarantine the projection and investigate artifacts and storage           | Withdraw the affected active publication                              |
| `active_projection_unavailable`      | Investigate serving/storage and suppress numerical reads                  | Keep registry history unchanged during a transient outage             |
| `active_publication_stale`           | Confirm ingestion and calculation freshness                               | Serve only with the public stale warning while still eligible         |
| `calculation_attempt_stalled`        | Fence the lease, record an expiry failure, and investigate the worker     | Keep the active publication unchanged                                 |
| `calculation_failed_retryable`       | Apply bounded retry policy                                                | Retain last-good if it remains source- and projection-eligible        |
| `calculation_failed_terminal`        | Stop automatic retry and investigate diagnostics                          | Retain eligible last-good; otherwise suppress or withdraw as required |
| `candidate_awaiting_governance`      | Begin validation and Gate review                                          | Do not activate the candidate                                         |
| `no_active_publication`              | Confirm whether this is expected pre-release state                        | Suppress numbers; do not fabricate a fallback                         |

Recommended thresholds must be reviewed per environment and evidence velocity. Changing a threshold is
an operational configuration change with its own artifact and delivery record.

## Withdrawal and recovery

Withdrawal stops serving the affected release and preserves its audit trail. It is not deletion, and
it is not permission to reactivate an older release automatically. Factual and valuation withdrawals
use separate registries and must be evaluated independently.

### Factual release withdrawal

1. Stop source capture, imports, and new factual candidates when the incident affects rights,
   provenance, object integrity, mappings, identity/lineage, metric definitions, or acquisition-spell
   validity.
2. Capture the exact source-object, import, exception, factual pointer, release-view, export,
   deployment, cache, health, and incident evidence before mutation.
3. Apply the factual registry's governed withdrawal command with the expected revision, authorized
   actor, evidence identifier, timestamp, affected scope, and reason.
4. Confirm affected factual API/UI responses are unavailable or explicitly partial, generated download
   links do not present the withdrawn release as current, and caches cannot serve it after the captured
   selection is invalidated.
5. Follow source-specific retention, deletion, or access-revocation duties without deleting the
   append-only decision and incident evidence that the rights decision permits Statly to retain.
6. Correct evidence through a new immutable source object, mapping/rule version, import run, exception
   review, and factual candidate. Never edit normalized facts or release exports in place.
7. Recover only through the complete factual publication procedure with a fresh expected revision and
   authorization. Never fall back to the workbook, staging, Firestore default collections, an
   unreviewed candidate, or a backward clock.

The deterministic lifecycle enforces the same no-fallback rule: withdrawing the active factual release
clears its pointer and does not reactivate a superseded release. A superseded release may return only
after fresh validation, Gate 4 and Gate 5 decisions, and a separate current operational activation
authorization advance the registry revision.

Withdrawing a factual release requires reassessing every valuation publication that depends on it. It
does not silently withdraw or reactivate a valuation; the valuation registry must record its own
governed action.

### Valuation publication withdrawal

1. Stop new work if the incident affects source permission or calculation validity.
2. Capture source, projection, health, registry, deployment, and incident evidence before mutation.
3. Apply the publication registry's `withdraw` command with an authorized actor, evidence identifier,
   timestamp, and reason.
4. Confirm the active pointer no longer selects the withdrawn publication and numerical API responses
   resolve to a truthful non-numerical contract state.
   Also confirm a previously mounted adapter cannot serve after its captured selection is no longer
   active; repository freshness does not override registry authority.
5. Purge downstream caches or projections only where the approved withdrawal duties require it; retain
   audit evidence according to policy.
6. Investigate and prepare a new or previously published candidate through fresh validation and Gates.
7. Activate recovery only through the normal governed publication path. Never backdate activation or
   decrement registry revision. Do not use a backward clock, failed-candidate retention, a `latest`
   lookup, or an exception fallback to make expired or superseded output active again.

An analytical authority rollback is separate from publication withdrawal. Follow the authority event
ledger and its recorded rollback window; do not use a publication incident to switch the protected
fantasy database or credentials.

## Recalibration and model change

Full historical recalibration occurs only through an explicit model release:

1. Pre-register the change plan before proposal and candidate evaluation.
2. Build a distinct candidate valuation bundle containing both governed component protocols and model
   runs.
3. Create an append-only model-change review record describing every changed area and its materiality.
4. Attach baseline, temporal, calibration/coverage, subgroup, sensitivity, leakage, lineage, public
   contract, shadow, and rollback-rehearsal evidence.
5. Obtain at least two unique reviewers independent of the proposer. Advancement requires every
   reviewer to recommend it.
6. Treat `recommend_gate_3_review` as a recommendation only. Submit the exact protocols, runs, bundle,
   review, and evidence to the Gate 3 decision ledger.
7. Keep the candidate in shadow until subsequent product and publication Gates pass.
8. Monitor the published release under its declared plan and retain the rollback evidence.

A value-unit change requires a new value unit and explicit compatibility treatment. It must not
silently rewrite prior values or comparisons.

## Verification and incident record

For every source capture, import, factual publication, live valuation schedule enablement, valuation
publication, withdrawal, recovery, or model release, record:

- exact deployed commit and deployment identifier;
- effective source and Gate decision identifiers;
- immutable source-object identifiers, byte lengths, digests, upstream/provider, fitzRoy version and
  arguments, mapping/schema version, and retention disposition as applicable;
- import run, reconciliation report, exception review, identity/lineage decision, metric registry,
  acquisition-spell rule, factual release, and effective-through identifiers as applicable;
- schedule decision, dispatch claim, run, attempt, health, review, bundle, publication, and projection
  identifiers as applicable;
- commands/checks run and their outcomes;
- representative PostgreSQL release-view, generated XLSX/CSV/JSON, public API, and responsive UI smoke
  evidence as applicable;
- operator, reviewer, and incident timestamps; and
- residual risks and follow-up owner.

Use disposable fixtures for rehearsal. Never point tests at `prisma/dev.db`, protected fantasy data, or
production public-outcomes data. A local build or fixture pass is not workbook provenance, upstream
permission, object-storage readiness, PostgreSQL readiness, factual release approval, deployment, Gate
approval, production health, or valuation publication evidence.
