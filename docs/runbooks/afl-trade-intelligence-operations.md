# Public AFL trade-intelligence operations

## Purpose and authority

This runbook owns operational procedure for the public AFL trade-intelligence capability. It does not
operate fantasy leagues, user-owned teams, fantasy rosters, or the authenticated fantasy trade system.
Public AFL players, draft picks, trades, calculations, and publications have no Statly-user ownership.

The source-independent contracts are implemented, but live source approval, analytical persistence,
job infrastructure, real model releases, Gate decisions, deployment, and production verification are
not evidenced by the repository. Do not interpret a passing fixture test, build, model-change review,
or successful calculation as permission to publish numbers.

The durable runtime adapters eventually selected for this subsystem must preserve these authorities:

- the calculation-run store owns append-only run and attempt records;
- the scheduler store owns an atomic unique constraint on each content-addressed dispatch key;
- the publication registry alone owns active-publication pointers;
- the Gate decision ledger owns approval; and
- approved source-rights evidence remains a prerequisite for collection, calculation, and serving.

The operations contracts live under `src/server/aflTradeIntelligence/operations`. Publication state
and Gate state remain separate boundaries under `publication` and `governance`.

## Before enabling live work

Do not configure a recurring job or analytical writer until all of the following are evidenced for the
target environment:

1. Gate 0A source-rights evidence is effective and permits the exact collection, derivation, retention,
   and public-output uses.
2. The current authority-transition package permits analytical writes to the selected isolated store.
3. Gates 1–3 permit the exact datasets, protocols, model runs, and valuation bundle required by the
   calculation inputs.
4. The calculation-run, schedule-claim, artifact, projection, and publication stores have approved
   durable adapters, backup/restore evidence, retention rules, and least-privilege identities.
   The projection byte source must reject an object above the repository's declared 128 MiB limit
   before allocating or returning the complete payload; an adapter-side check after an unbounded load
   is not sufficient.
5. The dispatch adapter enforces `dispatchKey` uniqueness atomically. Read-then-enqueue without a
   unique claim is not sufficient.
6. Projection parity, publication rollback, source withdrawal, and last-good recovery have been
   rehearsed on disposable infrastructure.
7. Monitoring routes every critical health alert to an accountable operator.
8. Preview behavior is verified from the exact candidate commit. Production behavior is verified only
   after a deployment record identifies that same commit.

Until this checklist passes, the public archive may expose source-blocked or other truthful
non-numerical states only.

## Scheduling an occurrence

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

## Running and retrying a calculation

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

## Publication after calculation

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

Build `AflTradeOperationalHealthInput` from fresh source-rights evidence, the exact active pointer,
projection verification, latest calculation run, and reviewed thresholds. Persist the resulting
content-addressed snapshot and route every alert. The evaluator recommends action; adapters and
authorized operators execute it.

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

Withdrawal stops serving the affected publication and preserves its audit trail. It is not deletion,
and it is not permission to reactivate an older release automatically.

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

For every live schedule enablement, publication, withdrawal, recovery, or model release, record:

- exact deployed commit and deployment identifier;
- effective source and Gate decision identifiers;
- schedule decision, dispatch claim, run, attempt, health, review, bundle, publication, and projection
  identifiers as applicable;
- commands/checks run and their outcomes;
- public API and responsive UI smoke evidence;
- operator, reviewer, and incident timestamps; and
- residual risks and follow-up owner.

Use disposable fixtures for rehearsal. Never point tests at `prisma/dev.db`, protected fantasy data, or
production analytical data. A local build or fixture pass is not deployment, source approval, Gate
approval, production health, or release evidence.
