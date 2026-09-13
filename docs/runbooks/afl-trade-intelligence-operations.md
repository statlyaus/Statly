# Public AFL Draft & Trade Outcomes operations

## Purpose and authority

This runbook owns operational procedure for the public AFL Draft & Trade Outcomes capability and its
separately governed valuation layer. It does not operate fantasy leagues, user-owned teams, fantasy
rosters, or the authenticated fantasy trade system. Public AFL players, clubs, draft picks, trades,
source facts, calculations, and publications have no Statly-user ownership. AFL club custody is not
fantasy ownership.

The source-independent contracts, legacy archive, fail-closed factual-outcome page/API, factual
candidate/projection manifests, deterministic expected-revision factual lifecycle, persisted Gate and
valuation registries, and server-only public read composition are implemented, along with
provider-neutral byte custody and source-snapshot contracts. The separate normalized PostgreSQL
schema and forward-only migration history cover custody, capture/import,
public AFL identity review, matches and metrics, versioned events and typed assets, draft selections,
pick lineage, reconciliation, exceptions, acquisition spells, and typed factual-release membership.
Its release and event chains are referentially constrained, normalized evidence and membership are
append-only, and each projection item has an explicit projection-scoped identity. Public callers use
one runtime getter. Explicit `disabled` mode serves no active release; `postgres` mode composes the
isolated database, current Gate ledger, exact projection custody, KMS-backed object reads, and rotating
immutable projection mounts. It never falls back to Firestore or fantasy data.

The AFL Tables, Footywire and Fryzigg player-stat policies are approved. Atomic Gate recording,
durable authority resolution, provider-keyed admission, signed egress verification, immutable custody
and capture-to-PostgreSQL staging are implemented. A target environment must still load its exact
production field manifests and condition evidence and provision the required hosted infrastructure;
no real capture, release, model, activation or deployment is implied by this code. Do not interpret a
successful fitzRoy call, fixture test, import, or calculation as an active reviewed release.

The durable runtime adapters eventually selected for this subsystem must preserve these authorities:

- the calculation-run store owns append-only run and attempt records;
- the scheduler store owns an atomic unique constraint on each content-addressed dispatch key;
- immutable object storage owns original upstream response bytes and the frozen workbook migration
  baseline while its reconciliation window remains open;
- the isolated outcomes PostgreSQL database owns normalized public facts, exceptions, and release
  metadata;
- the factual release registry alone owns the active factual-outcome pointer;
- the valuation publication registry separately owns the active valuation pointer;
- the Gate decision ledger owns approval; and
- approved source-rights evidence remains a prerequisite for collection, calculation, and serving.

The operations contracts live under `src/server/aflTradeIntelligence/operations`. Factual release,
valuation publication, and Gate state remain separate boundaries under `outcomes`, `publication`, and
`governance`. Never route a factual outcome through the valuation pointer or infer fantasy ownership.

## Public read runtime configuration

An unset `AFL_TRADE_PUBLIC_READ_MODE` and the explicit value `disabled` both select the honest local
no-release mode. To mount the production-shaped read boundary, set
`AFL_TRADE_PUBLIC_READ_MODE=postgres` and provide all of:

- `AFL_TRADE_PUBLIC_READ_ENVIRONMENT` (`non_production` or `production` for deployed targets);
- `AFL_OUTCOMES_DATABASE_URL` for the isolated outcomes database;
- `AFL_OUTCOMES_CURSOR_HMAC_SECRET_B64`, canonical base64 encoding at least 32 random bytes;
- `AFL_TRADE_OBJECT_BUCKET`, `AFL_TRADE_OBJECT_PREFIX`, and `AWS_REGION`;
- `AFL_TRADE_OBJECT_KMS_KEY_ID` for the customer-managed object key;
- `AFL_TRADE_OBJECT_REPOSITORY_ID`; and
- `AFL_TRADE_OBJECT_POLICY_EVIDENCE_ID`, the retained immutable infrastructure-policy evidence.

PostgreSQL mode fails startup if any value is missing or malformed. It does not downgrade to disabled
mode and never discovers a fantasy database or Firestore source. The application role needs only the
isolated outcomes queries and the exact object-prefix read operations described below.

## Non-production infrastructure plan validation

`infrastructure/afl-trade-nonproduction` defines the isolated Stage 2A foundation only. It does not
define a dispatcher task, trusted signed-egress endpoint, recurring schedule, or failure alarm. The
worker subnets therefore have no NAT gateway, internet route, or unrestricted HTTPS egress. A later
compute-bearing plan must add the trusted endpoint, private AWS service access, exact task and role
bindings, a disabled schedule, failure monitoring, and a separately reviewed validator revision. The
current foundation gate rejects every compute, schedule and alarm resource rather than partially
approving a future runtime graph.

Every plan must supply `aws_account_id` and `capture_retention_days`. The capture retention value is
the reviewed maximum age for both current and noncurrent objects under `captures/`; the lifecycle
implements that ceiling as current expiration after `N - 1` days and noncurrent expiration after one
further day. The access-log bucket applies the same bounded lifecycle to `access/`, including the
seven-day incomplete-upload cleanup. The runner rejects account IDs that are not exactly 12 decimal
digits, capture retention outside the whole-number range 2–3650, and database backup retention
outside the whole-number range 7–35 before OpenTofu starts. There is no default from which
capture-retention authority can be inferred. An
accountable alert recipient belongs to the later compute-bearing plan that creates failure monitoring;
the current foundation exposes no dormant operator, schedule, CPU, or memory input. The validator
also binds the effective RDS backup retention to the reviewed `database_backup_retention_days` plan
value, whose default and minimum are seven days, and requires the reviewed non-skipped final snapshot
identity. Use the bounded command to snapshot the reviewed
configuration, initialize its locked provider, and validate one exact temporary plan:

```sh
npm run infra:afl-trade:validate-plan -- \
  --aws-account-id REVIEWED_ACCOUNT_ID \
  --capture-retention-days REVIEWED_MAXIMUM_DAYS
```

The command does not accept a pre-existing plan and does not run OpenTofu against the mutable
checkout. It verifies the exact workspace manifest, copies the reviewed source, lockfile and CLI
configuration into a unique owned source snapshot, independently hashes the copied bytes, and makes
that source tree read-only. It gives the snapshot separate provider-data, plan-output and writable
local-state directories, runs `tofu init -backend=true -lockfile=readonly`, and creates one temporary
plan with state locking enabled and `-state` fixed to the owned state path. It reads that same plan
through `tofu show -json` without printing its contents, validates it, and recursively removes the
exact owned snapshot root before reporting success with the snapshot digest and the optional input
state digest. Workspace changes after copying cannot alter the bytes consumed by OpenTofu. It admits
only the default OpenTofu workspace, strips
ambient `TF_*`, `TOFU_*`, AWS endpoint overrides, home-directory configuration and unrelated
environment values, and supplies explicit refresh, state-lock and parallelism semantics. Only the
explicit AWS credential/profile file variables listed by the runner are forwarded; configured AWS
endpoint overrides are forcibly disabled. The command sets `TF_CLI_CONFIG_FILE` to the reviewed empty
`review.tfrc`, preventing user-level provider development overrides. Workspace inspection is limited
to 30 seconds, snapshot initialization to five minutes, planning to 10 minutes and JSON rendering to
60 seconds. `SIGINT` or `SIGTERM` aborts the active child, remains handled through repeated signals,
and waits for exact snapshot cleanup before the wrapper exits. The copied-source digest is checked
before planning, after planning and after plan-policy validation, then emitted only after cleanup. It
covers the exact eight Terraform source files, `.terraform.lock.hcl` and `review.tfrc`. Changing
source, provider selection or CLI provider configuration therefore requires a newly created snapshot
and plan. Additional `.tf`, `.tf.json`, `.tofu` or
`.tofu.json` files, including OpenTofu same-basename precedence files, and symlink/non-regular source
entries are rejected until a reviewed manifest revision explicitly admits them. It derives custody
and logging bucket names from the reviewed account and region rather than trusting mutually
consistent plan-selected names. It also proves the VPC CIDR, private worker/data subnets, route tables
with explicitly managed empty inline-route sets, associations, S3 gateway endpoint, security groups
and database/cache subnet groups remain one exact isolated graph. The validator then binds capture
grants to that plan's custody prefix, Redis group/user and actual custody-key ARN; admits worker HTTPS
egress only to the exact regional S3 managed prefix list; binds runtime and
migration roles to distinct credentials; requires the runtime role to read only its operator-populated
runtime secret; proves every role has exactly the reviewed optional permissions boundary; and rejects
open internet egress. It also requires the complete singleton and keyed
foundation graph, rejects deletion or replacement actions, and proves the exact logging-bucket,
custody-bucket, IAM-role, database-ingress and cache-ingress boundaries. Every custody and IAM policy
that is fully rendered in the saved plan must match its complete reviewed statement semantics. The
first-create custody policy is the sole policy-JSON exception: its exact KMS key ARN is
provider-computed, so the policy may remain unknown only when the plan uses the hard-pinned reviewed
source digest, the custody key ARN is itself provider-unknown, and the configuration graph binds the
bucket policy to the exact five-statement custody document. Any source or lock change requires an
explicit validator digest revision; every other unknown policy JSON remains rejected, so omitted
dynamic or merged statements cannot be approved. Unknown provider-assigned network identifiers are
accepted only when the plan created by the bounded command embeds that same reviewed read-only source
snapshot and provider lock digest.

The base foundation plan must leave `enable_migration_secret_access=false`, which creates the RDS
instance and migration role without granting any secret read. It starts with the owned local state
path absent and produces a first-create plan without reading mutable checkout state. Only after a
separately approved apply has created the database and its RDS-managed master secret may an operator
run the bounded command a second time with one explicitly reviewed prior-state file:

```sh
npm run infra:afl-trade:validate-plan -- \
  --aws-account-id REVIEWED_ACCOUNT_ID \
  --capture-retention-days REVIEWED_MAXIMUM_DAYS \
  --enable-migration-secret-access \
  --state REVIEWED_PRIOR_STATE_PATH
```

The migration flag is rejected without `--state`. The state input must be an exact regular,
non-symlink file no larger than 64 MiB from the separately approved foundation apply. The command
opens it once without following links and in non-blocking mode, rejects special files before reading,
streams only from that admitted handle with cancellation checks, verifies stable source metadata and
matching source/copy digests, makes the owned copy
owner-readable only, and uses only that copy as the locked local-backend state. A pathname swap,
in-place change, oversized input or incomplete copy fails closed before OpenTofu execution. It emits
`inputStateDigest` for review evidence but never prints state contents. Treat the source state as
sensitive operational material: do not
place it in the repository, commit it, attach it to review output, or reuse an unreviewed mutable
checkout state file. The later plan must expose the exact RDS-managed secret ARN and may grant the
migration role access only to that ARN and the reviewed database KMS alias. Do not copy the RDS
credential into an operator-maintained duplicate secret: the RDS-managed secret is the rotation
boundary. Both command executions still require independent review. A passing plan is review
evidence only. It does not authorize `tofu apply`, source capture, schedule enablement, or a release.

## Before enabling live work

Do not configure a recurring job or analytical writer until all of the following are evidenced for the
target environment:

1. Gate 0A source-rights evidence is effective for each Draftguru, Footywire, official AFL or
   fitzRoy-backed upstream and permits the exact capture, fields, derivation, retention, caching,
   public fact display, model, and public-output uses requested by the operation. The workbook is
   covered only as a frozen migration baseline; it is not a recurring source.
2. The current authority-transition package permits analytical writes to the selected isolated store.
3. Gate 1 and the applicable corpus/data decision permit the exact immutable source objects,
   PostgreSQL schema, source-grain facts, metric definitions, and acquisition-spell rules used by a
   factual candidate. Gates 2–3 additionally permit exact datasets, protocols, model runs, and
   valuation bundles when model work is requested.
4. Object storage, public-outcomes PostgreSQL, factual release, calculation-run, schedule-claim,
   valuation artifact, projection, and publication stores used by the operation have approved durable
   adapters, backup/restore evidence, retention rules, and least-privilege identities.
   Factual projection finalization uses PostgreSQL's built-in SHA-256 function to recompute the
   searchable list-row root inside the database rather than trusting the application writer; do not
   add an extension or broader migration privilege for this check.
   The projection byte source must reject an object above the repository's declared 128 MiB limit
   before allocating or returning the complete payload; an adapter-side check after an unbounded load
   is not sufficient.
   The application identity may conditionally create, HEAD, and read only the approved prefix. It has
   no list, overwrite, copy, ACL, bucket-management, lifecycle-management, or delete permission.
   Withdrawal deletion uses a separate reviewed retention-admin identity and emits version-specific
   tombstone/audit evidence. Prove TLS enforcement, block-public-access, KMS policy, lifecycle and
   optional lock compatibility, residency, access logging, conditional-write enforcement, and restore
   against a disposable isolated bucket/prefix before recording infrastructure evidence.
5. The dispatch adapter enforces `dispatchKey` uniqueness atomically. Read-then-enqueue without a
   unique claim is not sufficient.
6. Source reconciliation, factual release parity, API/view parity, projection parity,
   both release rollback paths, source withdrawal, and last-good recovery have been rehearsed on
   disposable infrastructure as applicable.
   Run `npm run test:outcomes:int` locally; it provisions and removes its own loopback-only disposable
   PostgreSQL container. Controlled CI already owns a disposable PostgreSQL service, supplies both
   explicit test URLs, and runs `npm run test:outcomes:int:provisioned` instead. The integration suite
   creates and removes uniquely named test schemas, applies the complete ordered history with Prisma
   Migrate, verifies both migration ledger entries, checks native registry, custody, version-chain,
   typed-membership, and append-only controls, and exercises transaction rollback and
   expected-revision concurrency. Reapplying the history must be a no-op. A schema-only validation or
   unit test is not a substitute for this rehearsal. Never use the provisioned command against shared
   or production PostgreSQL.
7. Monitoring routes every critical health alert to an accountable operator.
8. Preview behavior is verified from the exact candidate commit. Production behavior is verified only
   after a deployment record identifies that same commit.

Until the source and factual checklist passes, the public archive may expose only its current
historical records and truthful factual-unavailable states. Until the additional model checklist passes, it may
expose reviewed factual outcomes but must keep valuation numerical states unavailable.

## Capturing source evidence

Production acquisition is provider-native. The site, API, workers and calculation jobs must not open a
local or uploaded workbook at request time, and no release creates XLSX/CSV workbook substitutes. The
historical workbook is retained privately only as a frozen migration baseline until the sourced corpus
passes shadow reconciliation and its retirement record is approved.

For each capture or import:

1. Resolve current Gate 0A evidence from the trusted complete durable decision ledger immediately
   before retrieval for the exact source object, source register/provider/dataset/version, environment,
   competition, season range, fields, intended uses, retention period, and redistribution behavior.
   Stop before retrieval when any requested use is absent or blocked; an embedded receipt alone cannot
   rule out an omitted withdrawal or superseding decision.
2. Record the exact upstream URL or API identity, provider, dataset and version, media type, byte
   length, digest, retrieval/effective times, response validators, provenance and rights decision. For
   fitzRoy, also pin the package version, exact upstream source and dataset version, function,
   pre-authorized content-addressed arguments, rate/cache policy, retrieval time, response media type,
   byte length, and digest. Never rely on a fitzRoy default source.
3. Store the original bytes once in the approved immutable object store under a content-addressed key.
   Verify a read-back digest before creating an import run. Do not put source bytes, local paths, or
   credentials in Git, logs, PostgreSQL payload columns, or public responses.
   The implemented port requires content-addressed `putIfAbsent`, returns the first-writer canonical
   reference for a same-byte/same-media retry, requires a declared maximum before loading, and emits a
   content-addressed read-back receipt for that canonical reference. A provider adapter must preserve
   those semantics and must not add overwrite or mutable `latest` behavior.
   Raw-source and capture-metadata custody use separate content-addressed profiles and namespaces.
   Every non-fixture source snapshot requires `durable_object_storage` assurance and a raw-source
   profile. Treat ETags as opaque concurrency tokens, never content digests. A maximum deletion age is
   a lifecycle/withdrawal obligation; a WORM retain-until time is a separate minimum and is forbidden
   when it could prevent required withdrawal deletion or exceed the approved maximum retention.
4. Create one provider-native capture/import run for each immutable response and reviewed parser/schema
   version. Persist the complete source-row ledger before normalization. Load immutable staging only;
   do not upsert directly into canonical, active public, or projection tables or views.
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
previous reviewed release unchanged. An exact replay returns the same immutable run; changed bytes
require a new capture, and a corrected parser requires a new parser version and run. No retry
overwrites prior evidence.

### Capturing transactions, draft order and selections

Run these lanes independently. Each produces source claims, not canonical facts:

1. Build a deterministic Draftguru crawl plan from the bounded trades index, supported yearly draft
   pages and linked transaction detail pages. Capture only transaction identity/date/type, parties,
   directed packages, pick/selection facts, stable source identifiers and source URLs. Do not import
   Draftguru grades, games, pick points or other derived values.
   General year-page acquisition requires parser version `draftguru-event-year/v2`. Old schedules
   must be replaced by a newly approved schedule/run; they cannot execute changed semantics under
   an old parser identity. National-only capture retains its separate parser/version contract.
   The reviewed 2020 page's 22 mid-season slots resolve to 2021 using exact ordinal/player/club
   bindings. Unmatched mid-season slots on that anomalous page remain issues; ordinary annual
   pages retain their page-year behavior. Emitted selection years must fall within the approved
   source-rights season ranges, independently of the page's acquisition anchor.
   The general year-page parser retains National, Rookie, Pre-Season, Mid-Season and Mini-Draft
   selections. Its `scopeSummary` accounts for every observed row as included, invalid or excluded
   under the reviewed Trade, Free Agency, Pre-Draft, Post-Draft and Training Squad Selection labels.
   A known non-selection label may occur in the first category cell when the draft cell is empty.
   Selection types still come from the draft cell; a nonempty unknown draft label is not overridden.
   Unknown pathways and malformed selections remain issues; do not suppress them before staging.
   Require exactly one year table, at least one supported selection, and one complete positive safe
   integer per selection-number cell. National-only capture remains a separate capability and must
   not replace the general pathway when mini-draft evidence is required.
2. Capture Footywire's full draft table for each supported draft year and pathway. Preserve selection
   number, round, player, selected club, draft type/year and native identifiers as provider claims.
3. Capture the official AFL current draft order as a point-in-time custody claim. It may corroborate
   current pick ownership, but must not rewrite historical custody or an exercised selection.
4. Capture `fetch_player_details_afl` through the pinned fitzRoy runtime as a corroboration lane for
   player identity, `draftYear`, `draftType`, `draftPosition`, recruited-from and first relevant squad
   club. It does not establish a trade edge, entitlement owner or complete draft order. AFL Tables and
   Footywire player details may provide weaker identity/career corroboration but never manufacture
   missing transaction facts.
5. Use the existing fitzRoy AFL Tables, Footywire and Fryzigg player-stat captures only for outcomes
   such as appearances, games derived from reconciled appearances, goals, votes and achievements.

Every fetch uses conditional validators where supported, a descriptive user agent, per-host admission,
bounded redirects/body/time/retries with jitter, content-type checks and a circuit breaker. A `304`
creates an observation linked to the prior immutable object; a changed body creates a new object. A
`404`, missing link or page disappearance never deletes an earlier fact. Schema drift and partial
coverage quarantine the capture and retain the last good release.

The deployed command boundary keeps discovery, individual retrieval and reconciliation as separate
content-addressed authorities rather than hiding them inside an unreviewed scraper:

Set `AFL_TRADE_CAPTURE_ENVIRONMENT` explicitly to `non_production` or `production` for every
external-source capture job. The runtime has no default: its value must exactly match the reviewed
request environment, Gate-request environment and environment suffix in the Gate decision key.
`test_fixture` is not a deployed capture environment. A non-production job cannot resolve or
supersede production Gate authority, and production execution cannot reuse non-production authority.

1. Prepare one reviewed external-source approval JSON containing the exact field set and dataset
   version for each of `draftguru-trade-index`, `draftguru-trade-detail`, `draftguru-year-page`,
   `footywire-draft-results`, and `official-afl-indicative-draft-order`, dedicated evidence for every
   source condition, finite terms and revalidation times, the explicit `non_production` or
   `production` Gate environment, and the independent reviewer. Record all five atomically with
   `npm run outcomes:sources:record-approved-external -- --input <reviewed-json-path>`. Exact replay
   is idempotent; a changed annual approval appends one linear successor per capability; a partial
   approval batch never becomes current.
   Every normalized field entry must be the exact leaf path emitted by the parser, and every source
   field must permit `archive_fact` in both the rights artifact and Gate request. The staging boundary
   rejects a capture if even one non-null claim leaf is absent from that reviewed mapping. Do not use
   a broad label such as `trade` or `selection` as a substitute for the emitted field set.
2. Prepare one reviewed historical-discovery envelope containing the exact bounded year range, index
   capture and Gate request, deterministic `plannedAt`, detail/year parser and dataset versions, exact
   field-manifest digests, distinct capability rights artifacts and the retry/lease/lateness/circuit
   policy. Run
   `npm run outcomes:sources:discover-external-history -- --input <reviewed-discovery-json-path>`.
   It captures the exact Draftguru `/trades` index, or reuses the exact finalized issue-free batch after
   a `304`; stages every in-range link; seals a content-addressed inventory; registers one immutable
   trade-detail schedule per discovered link and one year-page schedule for every reviewed year,
   including years with no discovered trade; then freezes the complete plan and target-set digest in
   one PostgreSQL transaction. Exact rerun of the same envelope is idempotent. A changed range, parser,
   source policy or planning instant is a new plan. Discovery never infers a transaction date from the
   operator clock and never reconciles, promotes, releases or publishes data.
3. Execute the frozen plan in bounded, restartable pages with
   `npm run outcomes:sources:run-external-history -- --input <worker-page-json-path>`, where the input
   contains only the exact plan ID, last terminal ordinal, maximum targets and worker ID. The worker
   loads target schedules from PostgreSQL, never reconstructs URLs from caller text, and delegates each
   occurrence to the existing schedule claim and governed ingestion path. Advance `afterOrdinal` only
   to the returned `completedThroughOrdinal`. A retry, active lease, circuit break, early occurrence or
   provider admission deferral stops without advancing past that target; rerun after the reported
   condition clears. `completed`, `not_modified`, deduplicated, late-skipped and dead-letter outcomes
   are terminal and cursor-safe. A page result is operational progress, not reconciliation or authority
   to publish.
4. After every page has reached the end of the frozen plan, seal the durable result set with
   `npm run outcomes:sources:complete-external-history -- --plan <plan-id>`. The command ignores
   worker-returned claims and rebuilds completion from the exact finalized plan, current terminal
   occurrence events, source captures and issue-free evidence batches under one PostgreSQL lock. A
   changed capture names its exact batch; a `304` observation must resolve through its immutable
   attempt to the exact prior capture and batch. Deduplicated worker calls are harmless because the
   durable occurrence remains authoritative. A late-skipped, dead-lettered, missing, retrying or
   issue-bearing target blocks completion even though some of those states are cursor-terminal. The
   completion freezes every target and batch exactly once, is idempotent, and remains private and
   `publicationEligible: false`. Operators carry only this completion ID into historical
   reconciliation; they do not copy or curate its batch list.
5. For a one-page correction, corroboration source or explicitly reviewed replay outside that plan,
   prepare one command envelope containing the
   exact capability/provider/year/dataset/version/parser/field-manifest digest, factual effective time,
   maximum bytes, and matching Gate request. Run
   `npm run outcomes:sources:ingest-external -- --input <reviewed-page-json-path>` from the isolated
   job for the configured authority environment. The command derives capture time from its trusted
   clock, rejects an envelope whose request, Gate environment or environment-specific decision key
   differs from `AFL_TRADE_CAPTURE_ENVIRONMENT`, resolves current durable
   authority before and after retrieval, acquires a provider-keyed Redis lease, uses identified HTTPS
   egress, stores exact bytes in KMS-backed raw custody, persists `304` observations, and stages every
   parsed claim and issue in PostgreSQL. Both changed and `304` observations retain a content-addressed
   execution receipt naming the full content-addressed rights artifact, exact current Gate decision
   and ledger revision, complete request digest and URL, lease/token digest and interval,
   parser/field manifest, enforced upstream rate/cache/raw-retention controls, egress-policy evidence,
   and the exact observed artifact or prior capture. PostgreSQL re-authenticates the receipt against
   the current unsuperseded Gate head and proposal-to-rights binding before it stores either a changed
   or unchanged observation, and its evidence-finalization trigger checks the lease against the
   database clock. It emits only stable IDs and status.
   For an approved private set of retained captures, use
   `PostgresAflTradeExternalDiscoveryRepository.persistRetainedPlan` with a v2 plan and an exact byte
   reader, then `PostgresAflTradeExternalHistoricalCaptureCompletionRepository.completeRetainedPlan`.
   Retain the actual capture, execution receipt, source/Gate authority, artifact and finalized batch
   IDs in every target. Use the actual plan/completion creation times; do not backdate these records
   or manufacture an index inventory or scheduler occurrence. Both initial registration and replay
   require current source authority, and plan replay verifies retained bytes again. This is a
   repository operation under the reviewed execution runbook, not a new public CLI command. A replacement
   retained plan may reuse unchanged finalized batches from earlier completions alongside newly
   captured batches. Each batch appears at most once per completion; prior completions remain
   immutable. Reuse still requires exact target evidence and current authority for every batch.
   Scheduled results retain their separate single-completion batch constraint.

   **Migration 0163 maintenance procedure:** Before applying
   `0163_retained_completion_batch_reuse` to a populated outcomes database, the database operator
   must schedule a maintenance window for historical completion reads and writes. Its `ALTER TABLE`
   constraints and ordinary unique-index creation acquire locks and can block concurrent traffic.
   Pause historical discovery/completion workers and application entry points that access
   `outcome_external_historical_capture_completion_result`, drain in-flight transactions, and verify
   that no other completion writer remains active. Keep those controls in place until verification
   finishes; this procedure is separate from the SQLite-to-PostgreSQL cutover.

   Take and verify a recoverable backup, record the current migration state, and inspect active
   transactions/locks on the completion-result table before starting. Apply the checked-in migration
   through the normal outcomes migration runner with operator-selected finite lock and statement
   timeouts appropriate to the measured table size and maintenance window. Do not replace it with an
   unreviewed concurrent-index variant or run it against live writers. If a timeout or DDL error
   occurs, retain the traffic pause, inspect both the migration record and actual constraints/indexes,
   and reconcile any partially applied statements through the reviewed migration-recovery process
   before retrying. Do not mark a failed migration successful merely to unblock deployment.

   Before resuming traffic, verify that migration 0163 finished, the global batch uniqueness was
   removed, `outcome_external_completion_batch_unique` enforces `(completion_id, evidence_batch_id)`,
   and `outcome_external_scheduled_completion_batch_unique` is valid and unique with the predicate
   `capture_mode <> 'retained'`. Confirm that historical completion rows are unchanged and run the
   retained-reuse and scheduled-uniqueness checks against an owned disposable restore. Resume workers
   and application traffic only after these checks pass. Reverting to global uniqueness after reused
   batches exist is not a safe rollback; keep traffic paused and use a reviewed forward repair or
   restore the verified pre-migration backup with its corresponding application version.

6. Turn the finalized plan into a private reconciliation review candidate with
   `npm run outcomes:sources:prepare-external-reconciliation -- --completion <completion-id>`.
   PostgreSQL loads the exact immutable completion, plan and issue-free evidence batches; the command
   accepts no caller-supplied batch IDs and uses the plan's through-year as the candidate anchor. The
   initial candidate deliberately carries blocking unresolved-identity issues rather than joining by
   name. Export the exact completion-scoped work queue with
   `npm run outcomes:sources:export-external-identity-review -- --completion <completion-id>`.
   Provider-native identifiers are stable review subjects; name-only observations remain separate
   exact-name-and-season subjects. The queue preserves every recorded spelling and evidence row and
   never proposes a fuzzy or automatic merge.

   Provision the reviewer independently with current environment/provider/competition/season-scoped
   `afl_trade_external_identity_reviewer` authority for capability
   `external_identity_resolution`. Record each reviewed outcome with
   `npm run outcomes:sources:record-external-identity-resolution -- --completion <completion-id> --subject <subject-id> --decision approved --canonical-id <approved-player-or-club-id> --reviewer <principal-ref> --authority-evidence <reviewer-authority-evidence-id> --rationale <text>`.
   Rejection and withdrawal omit `--canonical-id`. The command derives the exact work item, current
   revision, predecessor and approved canonical-record snapshot from PostgreSQL; operators cannot
   submit those chain fields. A later completion may reuse a current decision only when its exact
   observation work item is unchanged. New spellings, seasons or evidence require a successor review.

   If a canonical target is absent, retain an explicit external canonical-target registration v2
   review before calling `PostgresAflTradeProviderResolutionRepository.registerCanonicalTarget`.
   Bind the complete native-ID work item from the current retained completion, the exact governed
   snapshot, supporting evidence and the actual scoped technical reviewer. Choose `create` only
   after checking existing canonical provenance; choose `reuse` for an exact existing record.
   Keep unsupported biography and club metadata null on creation. This operation creates no
   normalization record or identity assignment; continue through the identity-review command above.
   An internal owner-delegated technical reviewer must be recorded as such, without asserting
   independent human review or provider permission. Withdrawn source authority blocks replay.

   Rerun the preparation command after review. It loads current decisions directly from the durable
   review heads and accepts no identity-resolution JSON. Reconciliation time is derived
   deterministically from the completion and latest applicable decision, so exact replay is
   idempotent and a successor decision produces a new immutable candidate. Candidate v2 canonical
   bytes bind the completion,
   plan, target/result digests and exact sorted batch-set digest; PostgreSQL independently proves set
   equality before finalization. The older `outcomes:sources:reconcile-external` reviewed-envelope
   command remains only for explicit one-page/correction work outside a historical completion.
   A finalized candidate remains private and
   `publicationEligible: false`; disputed,
   unresolved, incomplete or missing-lineage records are retained for review and are not promoted.
   Reconciliation accepts only finalized source batches with zero parser issues and proves exact
   two-way evidence conservation: every candidate reference belongs to a selected batch and every
   staged evidence row is represented by a reconciliation record or issue. A corrected source page
   or parser produces a superseding capture; an issue-bearing batch is never silently treated as
   complete.

7. Prepare one reviewed JSON array containing only the missing draft-event metadata
   (`draftYear`, `draftType`, `eventDate`, `officialName`) for each exact draft represented by the
   candidate. The source selection rows own membership; operators cannot supply selection IDs,
   counts, candidate scope, proposal identity, revision or predecessor. With current scoped
   `afl_trade_canonical_promoter` authority, record the review with
   `npm run outcomes:sources:review-external-promotion -- --candidate <candidate-id> --draft-events <reviewed-json-path> --transaction-dates <reviewed-json-path> --decision approved --rationale <text> --authority-evidence <governed-evidence-id> --reviewer <principal-ref> --decided-at <UTC-millisecond-instant>`.
   The transaction-date file must exactly cover every candidate transaction. A source-recorded date
   must be repeated exactly. For an undated transaction, supply an independently supported day or
   explicit `occurredOn: null` to retain year-only factual precision. Do not invent a completion day.
   A null day selects promotion proposal v4, which binds the candidate's `seasonYear` as well as the
   reviewed date precision. Missing review entries remain invalid. The content-addressed proposal
   and approval bind that coverage before canonical promotion. Year-only factual admission does not
   grant eligibility for historical valuation that requires an exact trade day.
   For retained session proofs, `deriveDraftSessionCanonicalPromotionProposal` produces v5:
   each draft declares `direct_session_claim` or `combined_session_facts`, while trade dates retain
   their reviewed day/year precision. Different drafts may use different proof kinds; one draft
   cannot mix them. Migration0176 checks each draft's retained proof and exact overall selection
   membership, then enforces session finalization and current acquisition evidence. Combined proofs
   require complete inventory and authenticated boundary identities. Migration0182 additionally accepts
   nonconsecutive original numbers when authenticated `draft_completed_inventory` claims enumerate
   exactly every member; migration0184 also accepts the authenticated named-roster join described below.
   Without either membership proof, the inventory must remain contiguous. A scoped
   correction candidate cannot use a partial inventory as full-draft proof. The existing metadata-only
   review command remains on its v1/v4 path; v5 requires the session-aware programmatic owner.
   Retain that timestamp with the review record: an exact retry must reuse it and return the same
   content-addressed decision rather than manufacture a successor.
   PostgreSQL derives and authenticates the proposal, appends one typed decision, and advances its
   single current CAS head atomically. Rejection and withdrawal use the same command and create a
   successor; they never mutate prior evidence. Then run
   `npm run outcomes:sources:promote-external -- --candidate <candidate-id> --approval-decision <decision-id>`.
   The transaction re-authenticates the candidate, proposal, current decision, authority, canonical
   clubs/players/seasons and current player-identity decisions. It creates one import run per exact
   contributing capture and atomically materializes versioned transactions, directed assets, draft
   events and selections, selected-player assets, custody observations and `exercised_as` pick
   realizations. A traded entitlement keeps the same stable `pick_id` when exercised; lineage edges
   are created only for actual entitlement transformations. Exact replay returns the retained
   promotion receipt. Conflict, missing coverage or stale authority rolls back the entire transaction.
   Promotion does not register, validate or activate a factual release and cannot publish a grade.
8. Register each immutable reviewed URL schedule once with
   `npm run outcomes:sources:run-external-schedule -- --input <reviewed-schedule-json-path>`. The
   schedule request-template environment must match `AFL_TRADE_CAPTURE_ENVIRONMENT`. This
   registration command may also execute the envelope's first exact occurrence for an operator-led
   rehearsal, but it is not the recurring production scheduler. PostgreSQL creates one trigger-owned
   dispatch cursor at the schedule anchor. The cursor advances only after a terminal occurrence event
   and always derives the next due time from the immutable interval; clients cannot update it or
   manufacture a later occurrence that skips unfinished work.
9. A deployment scheduler runs bounded ticks with
   `npm run outcomes:sources:dispatch-due-external -- --worker <deployment-worker-id> --limit <1..1000>`.
   The command loads the oldest due active schedules from PostgreSQL for the configured authority
   environment. It selects only new occurrences, retry-ready failures, or expired leases and delegates
   each selected occurrence to the existing Gate-resolved, Redis-admitted, HTTPS/custody/staging use
   case. One occurrence failure is reported without abandoning later selected work. PostgreSQL owns
   exact schedule replay, activation heads, unique dispatch keys, append-only occurrence events,
   immutable lease claims, attempt limits, deterministic retry times, cursor advancement and provider
   circuit state. Two workers contending for one occurrence yield one lease; an expired lease can be
   reclaimed, while terminal success, unchanged observations, late skips and dead letters are not
   rerun.
10. Build the separately deployable one-shot operator with
    `docker build --target afl-trade-external-dispatcher .`. The deployment injects
    `AFL_TRADE_CAPTURE_WORKER_ID`, an optional `AFL_TRADE_CAPTURE_DISPATCH_LIMIT`, the explicit
    `AFL_TRADE_CAPTURE_ENVIRONMENT`, and the exact deployed ingestion secrets at runtime; no secret
    belongs in the image. The container runs as the
    non-root Node user and exits after one bounded tick so the deployment scheduler, rather than a web
    request or hidden process loop, owns cadence and failure observation. Production automation is not
    operational until the selected scheduler actually runs this image, alerts on failed/saturated
    ticks, monitors retry/circuit/dead-letter states, reconciles missed periods, and passes the
    real-PostgreSQL contention and restart tests. A tick does not discover links, activate a release,
    calculate a grade, use the workbook, or publish unreviewed facts. Canonical promotion remains a
    reviewed private-corpus operation; factual and valuation activation remain separate milestones.

### Reconciling provider claims

1. Reconcile field by field, not by global provider priority or majority vote. Transaction identity,
   directed transfer, pick entitlement/custody, draft selection and player identity each have their own
   evidence rule.
2. Preserve all parties in a multi-party transaction. A transfer must name sender, receiver, asset and
   effective/knowledge time. Pick lineage must connect the traded entitlement to later renumbering and
   the final exercised selection without counting the entitlement and selected player twice.
3. Mark each accepted fact `single_source`, `corroborated`, `disputed` or `unresolved` and retain exact
   supporting and contradicting source claims. Disagreement blocks only the dependent facts and
   valuations; it must not erase unrelated accepted evidence.
4. Never resolve a player, club, event or pick by display-name equality. Use provider-native IDs and
   governed temporal aliases; route ambiguous matches to review.
5. Require complete source-row accounting and conservation of directed assets before a factual
   candidate may close. Any unexplained P0/P1 delta blocks release.

### Freezing and retiring the workbook baseline

The workbook may be used once as a private migration oracle. It must not supply public preview grades,
remain on a runtime read path or become a recurring import:

1. Record its exact digest, source date, row/sheet counts and parser version without copying its path or
   contents into Git or logs.
2. Freeze one shadow-comparison report keyed by stable sourced event, party, asset, entitlement,
   selection and acquisition identifiers. Treat workbook `Expected`, `Actual` and letter-grade cells as
   non-authoritative evidence only.
3. Classify every difference as approved correction, scope/coverage difference, parser drift, identity
   ambiguity, unresolved lineage or unexplained. Require 100% input accounting and zero unexplained
   P0/P1 differences before cutover.
4. After the first reviewed sourced factual release and rollback rehearsal, record workbook retirement,
   remove the workbook loader and development projection from runtime composition, delete public
   spreadsheet/export language and keep only minimal non-runtime golden fixtures needed for parser or
   reconciliation regression tests.

No operator procedure after retirement may require the original XLSX. Corrections arrive as new
provider captures, reviewed resolution decisions and superseding releases.

### Staging fitzRoy provider observations

The AFL Tables, Footywire, and Fryzigg player-stat policies are approved. Deployed capture is
available only through the composed command boundary after its exact current field manifests and Gate
0A records are loaded for the target `non_production` or `production` environment, durable custody is
provisioned for that same environment, and the attested executor/decoder/egress boundary plus
provider-keyed distributed admission are active. Fixture verification does not satisfy those runtime
controls or grant authority to either deployed environment.

1. Prepare one reviewed JSON input containing the exact field manifest for each of
   `afl-tables-player-stats`, `footywire-player-stats`, and `fryzigg-player-stats`, the retained terms,
   authority, and egress-policy artifact IDs, finite effective/expiry/revalidation times, the explicit
   `non_production` or `production` Gate environment, and the accountable reviewer. Each environment
   owns an independent decision key and version history; neither may supersede the other. Record it with
   `npm run outcomes:sources:record-approved -- --input <reviewed-json-path>`. The command requires an
   explicit `AFL_OUTCOMES_DATABASE_URL`, atomically CAS-appends all three source-rights/Gate records in
   one transaction, reloads and authenticates the ledger, emits only stable IDs, and never treats one
   provider's fields as another provider's authority. A failure commits none of the three approvals.
2. Prepare one reviewed season-ingestion JSON envelope containing the exact target-environment Gate request,
   direct capability capture request, approved field-map ID and body, and factual `effectiveAt`. The
   Gate and capture sections must name the same capability, competition and season. Run it only from
   the pinned ETL job image with
   `npm run outcomes:sources:ingest-fitzroy -- --input <reviewed-season-json-path>`. The command parses
   the injected deployed configuration, rejects a Gate environment or environment-specific decision
   key that differs from `AFL_TRADE_CAPTURE_ENVIRONMENT`, resolves current rights and the Gate ledger
   from the isolated PostgreSQL database, admits provider/capture keys through Redis, calls the
   reviewed HTTPS egress
   endpoint, verifies its Ed25519 receipt, writes exact raw and metadata bytes to separate KMS-backed
   custody profiles, constructs the source snapshot, persists the source capture, decodes the retained
   RDS and stages every row. It emits only stable capture/snapshot/run IDs and status; it never emits raw
   source bytes or secrets. Never decode a local path or separately downloaded provider file.
3. Inject every required runtime value explicitly: `AFL_TRADE_CAPTURE_ENVIRONMENT` set to exactly
   `non_production` or `production`, `AFL_OUTCOMES_DATABASE_URL`,
   `AFL_TRADE_CAPTURE_REDIS_URL`, `AFL_TRADE_FITZROY_EGRESS_ENDPOINT`, its bearer token and public-key
   JSON, exact egress-policy evidence IDs, object region/bucket/prefix/KMS/repository and infrastructure
   evidence, permitted residency jurisdictions, exact R 4.5.1/renv-lock/image identities and Rscript
   path, plus bounded capture/decoder/source/diagnostic/row/field/cell/output/retention limits. The
   configuration parser rejects absent values, non-HTTPS egress, invalid digests, duplicate evidence,
   and zero or unbounded limits. Do not reuse the web runtime's fantasy database or credentials.
4. Require the deployed executor's signed egress receipt to match the exact provider, capability,
   invocation digest, returned RDS and diagnostics bytes, pinned runtime image and lock, reviewed
   request/burst/cache policy, and egress-policy evidence. Retain it through the capture receipt v2
   metadata-custody binding. The Redis lease coordinates provider-wide concurrency and capture-level
   cooldown; the attested egress boundary must pace fitzRoy's internal upstream fan-out.
5. After capture, reload the durable ledger and rights artifact and re-evaluate Gate 0A at snapshot time.
   The effective decision must still be the exact decision recorded in the capture receipt. Expiry,
   withdrawal, or a successor decision stops snapshot construction and staging even when retrieval
   already succeeded.
6. Run `decode_fitzroy_capture.R` in the pinned image with networking disabled and explicit row, field,
   cell, cell-byte, output-byte, and timeout limits. Verify its R, lock, and image identities.
7. Compare the decoded ordered field descriptors with the capture diagnostics fingerprint. Unsupported
   classes or attributes, changed field order, warning-bearing captures, digest drift, or a decoded
   row count different from the authenticated diagnostics count fail closed.
8. Select a reviewed field map for the exact capability, invocation-argument digest, competition,
   schema fingerprint, and season range. The current unsuperseded review decision must bind the exact
   map digest. There is no default or name-guess fallback.
9. Confirm the capture-to-staging portion persisted source custody/attempt/snapshot authority,
   reload the exact RDS object from immutable storage, decode, normalize, and persist one
   content-addressed normalization run bound to the decoder digest, normalizer version,
   field-map interpretation, and ordered staging-package digest. Every decoded row, including invalid
   rows, must be present. Match, player, metric, and achievement interpretations remain unresolved
   candidates; identity-only rows carry no match or metric claims; `publicationEligible` is false.
10. Finalize the run only after row, identity, match, metric, achievement, and issue counts reconcile.
    Confirm the capture-season foreign key holds and no canonical, public, or fantasy table changed.
    The database rejects unfinalized commits, later child inserts, and later capture-scope expansion. An
    exact retry is the same run; a conflicting retry is an incident.
11. Keep missing, NaN, infinities, and ambiguous provider zeroes distinct. Do not calculate games, infer
    no-vote or no-award facts from absence, or approve name-only identity or match fallbacks here.

### Rehearsing the source-independent fitzRoy factual path

Run `npm run test:outcomes:int` before any separately reviewed non-production provider execution. The
supported command provisions its own loopback-only PostgreSQL 16 container, applies the complete
ordered outcomes migration history to isolated schemas, runs the fitzRoy factual rehearsal with no
network/provider access, and removes the exact container afterward. Do not provide a live source,
shared database, checkout `.env`, protected fantasy database, or `prisma/dev.db` to this rehearsal.
Before any mutation, the rehearsal requires `current_database()` to be `statly_outcomes_test` and
`current_schema()` to match its generated `afl_fitzroy_factual_rehearsal_<pid>_<time>` identity. A
wrong schema fails closed and the real-PostgreSQL oracle proves it leaves zero competition rows.

The rehearsal uses one deterministic `non_production` Footywire-through-fitzRoy envelope and must
prove all of the following on real PostgreSQL:

1. Gate 0A, per-environment custody, the attested capture receipt, retained RDS decoding, the exact
   reviewed field map, and normalization all bind to the same capability, competition, season, and
   source-field set.
2. One decoded player-stat row produces exactly one staged row and zero normalization issues. The
   reviewed player and club namespaces, evidence, assignments, and current resolution heads are
   environment-specific and durable.
3. Row accounting is exhaustive: the one staged row produces one source-fact batch, one measured
   goals fact, one factual-reconciliation run, one reconciled goals result, and one current factual
   head. Missing evidence is never coerced to zero.
4. An exact rerun returns the same capture, normalization, fact-batch, factual-run, and private
   candidate identities with an idempotent replay receipt. Changed decoded evidence under the same
   capture and field-map identity fails closed and adds no accepted normalization run.
5. Candidate construction remains private and non-authorizing. The rehearsal persists no factual
   release candidate, release manifest, projection, registry event, active pointer, valuation output,
   or fantasy record; the release registry remains at revision zero.

The private-candidate checks remain a prerequisite, not the end of the local rehearsal. The same
disposable command now also exercises a release-specific test that:

1. promotes the reviewed identity, match, appearance, goals and games facts into two separate sealed
   factual-release candidates without mutating the original staged capture;
2. registers, validates, approves and activates a baseline release, then repeats that governed path
   for a replacement release with generation-specific capture, event, asset and spell-version
   membership;
3. verifies the read service, `/api/draft-trades/outcomes`, archive page, persisted projection, six
   view artifacts, and release-pinned JSON, CSV and structurally validated OOXML exports all resolve
   the replacement release and projection;
4. revalidates and activates the superseded baseline as an explicit rollback, withdraws that active
   baseline and proves the public selector reports `no_active_release` with no fallback, then
   revalidates and activates the replacement as explicit recovery; and
5. authenticates the complete append-only 15-event registry history and leaves the recovered
   replacement active only inside the disposable schema.

The restore-specific test then creates a custom-format `pg_dump` with the PostgreSQL 16 tools inside
that same harness-owned container, closes the application pool, destroys the exact generated schema,
and proves `to_regnamespace` can no longer resolve it. A single-transaction `pg_restore` recreates the
schema from the dump. Fresh connections must reproduce the exact sealed-candidate rows, 15-event
registry, active release and projection, service result, API response content, archive-page response,
and authenticated JSON, CSV and OOXML exports observed before destruction. The harness supplies only
its parsed immutable container ID to the test process and removes that exact container afterward.

Record the exact commit and command output in the delivery checkpoint. A later code-only change
requires a fresh exact-commit run. This remains local `non_production` engineering evidence. It uses
no network or live source, creates no hosted or billable resource, grants no reviewer or production
authority, and does not satisfy real-source custody, hosted durability or hosted backup/restore,
alerting, scheduling, deployment, or production-activation requirements.

### Retaining private AFLCA coaches-vote evidence

This optional local command performs live upstream retrieval. Run it only after the product-owner
source decision is current, against the authenticated disposable loopback outcomes database, with the
pinned fitzRoy image and private artifact root:

```sh
export AFL_OUTCOMES_DATABASE_URL='postgresql://<local-user>:<local-password>@127.0.0.1:<port>/statly_outcomes_test?sslmode=disable'
npm run dev:outcomes:authenticate

IFS= read -r STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE < .statly-local/afl-trade-outcomes-runtime-nonce
export STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE

npm run dev:outcomes:stage-scoped-aflca-coaches-votes
```

The command derives each requested round set from the current retained AFL Tables home-and-away match
universe, then retains one authenticated private scoped capture for each season from 2021 through
2025 and reuses exact finalized captures on retry. It executes the content-addressed Statly patch to
the verified fitzRoy `1.7.0` source, retains `Award.Scope=home_and_away` on every row, and reconciles
every returned match before review. Completion requires all 1,017 requested matches and exactly 30
coaches votes per match; the scoped capture contains 6,655 vote rows. A player vote becomes a training
fact only when its recorded name and club resolve exactly inside that reviewed match lineup or an
exact retained identity mapping applies. Other vote recipients remain in the conserved match total
but are retained as unresolved and receive no identity or fact approval.

Six provider match exceptions require exact retained reviews: four 2023 round-five rows reverse the
home/away order, while the Brisbane–Geelong and Gold Coast–Essendon Opening Round matches are labelled
as rounds 4 and 25 respectively by the 2025 AFLCA source and round 1 by AFL Tables. The reconciler has
no unordered, season-only, shifted-round, or other fallback. An unreviewed exception fails closed, and
every supplied review must be used by retained source rows.

Two 2025 vote rows are absent from the current AFL Tables player-match rows. They may resolve only
through the retained human-reviewed mappings for historical AFL Tables player `12576` (Jack Graham)
and `12712` (Jack Ross). The mapping decision, historical seasons, recorded names, recorded clubs and
target AFLCA identity are content-addressed into each affected identity review. The reconciler does
not infer a new club identity from display-name equality, and any unreviewed or unused mapping fails
closed.

The scoped source policy permits the reconciled `Coaches.Votes` field for private local
non-production feature construction and model training. Season, round, club and player-name fields
remain reconciliation evidence rather than model features. The command does not promote transaction
facts, admit a model dataset, execute a model, or grant publication authority; those remain separate
governed boundaries. Public display, public derived output, redistribution, production activation
and fantasy use remain prohibited.

The retained 2026-09-02 rehearsal contained 6,854 rows. Normalization quarantined 6, 12, 16, 32, and
48 rows in seasons 2021 through 2025 respectively. Those row counts are diagnostic evidence, not a
completeness threshold. The deeper stop condition is structural: the upstream function combines the
home-and-away and finals award requests from round 19 without retaining award scope, and excludes
non-finals rounds above 23. Some ambiguous rows still contain integer-looking values, so filtering
only decimal text is prohibited. Do not use these normalizations for #574, even after identity review.

The older `dev:outcomes:stage-aflca-coaches-votes` command remains a negative-evidence rehearsal. Its
ambiguous normalizations and superseding map rejections must remain retained and must never be
relabeled. Only the new scoped capability, field map, Gate receipts and reconciliation evidence may
feed the #574 training path.

### Inspecting the governed five-season workbook evaluation

Migration `0081_corrected_local_review_lineage` is an intentional one-time boundary for this
development-only lane. If the database already contains review decisions under the superseded
historical evidence digest, migration deployment stops with
`Corrected local review lineage requires a fresh disposable database before review`. Do not edit,
delete, or relabel those append-only decisions in place, and never apply this procedure to a shared or
hosted database.

Keep the old disposable database and its local artifact roots offline and read-only. The corrected
Gate lineage cannot be reconstructed from retained artifact bytes: its capture execution receipt must
bind the corrected decision that existed before retrieval. There is therefore no authenticated
retained-artifact import and no supported in-place upgrade. The current-evidence coordinator can
create the replacement seven-capture chain, but only after the Gate decisions, source-rights records,
and exact field-map reviews have been separately authorized and retained. It never relabels an old
artifact or creates a review decision. Do not deploy migration `0081` over the superseded database or
attempt the review commands below. Copying, relabeling, or replaying old database rows or artifact
bytes as a new capture is prohibited.

For a separately authorized new retrieval, start a separate empty loopback database named exactly
`statly_outcomes_test`, authenticate its runtime nonce, and deploy the complete migration history.
Use the launcher or ad-hoc valuation command with one stable operation key to enter the coordinator.
Retire the old database only after the new reviewed bundle is current and its capture IDs, artifact
digests, normalization-run IDs, counts, and three rights artifacts have been privately compared with
the preserved evidence record.

The remaining development-only inspection path assumes the replacement provider retrieval was
separately authorized and has completed through its owning boundary. The review commands do not
perform capture or grant factual authority. The replacement disposable database must contain exactly
one governed AFL Tables capture for each completed
season from 2021 through 2025, one separately governed official-AFL current-season player-stat capture
for 2026, and one governed AFL Tables completed-results capture for 2026. Preserve the capture
receipts and local artifact roots; do not substitute workbook values for missing or review-blocked
observations.

Before launch, verify all seven captures have exactly one admitted finalized normalization in the
caller-owned loopback PostgreSQL database named exactly `statly_outcomes_test`, and verify that their
manifests resolve to exactly three source-rights artifacts. Expected staged player-stat coverage for
the six player-stat captures remains 57,621 player-match rows: 9,522 each for 2021 and 2022, 9,936
each for 2023–2025, and 8,769 for official 2026. The seventh capture is the separate AFL Tables 2026
results normalization and is not included in that player-match-row total. A count mismatch, duplicate
season or capability capture, extra or missing finalized normalization, changed field map, unresolved
custody object, rights-count mismatch, or non-loopback database is a stop condition. Do not repeat
provider requests merely to start the UI; the interactive path reads retained PostgreSQL staging and
fails closed when it is absent.

Set the private workbook path and its independently computed SHA-256 only in the invoking shell. Do
not write either value to Git, logs, documentation, or a shared environment file. Then run:

```sh
export AFL_OUTCOMES_DATABASE_URL='postgresql://<local-user>:<local-password>@127.0.0.1:<port>/statly_outcomes_test?sslmode=disable'
npm run dev:outcomes:authenticate
npm run dev:outcomes:review-afl-tables-2021-2025
npm run dev:outcomes:review-official-2026

IFS= read -r STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE < .statly-local/afl-trade-outcomes-runtime-nonce
export STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE

npm run outcomes:modeling:review-local-hpn-field-maps
npm run outcomes:modeling:review-local-hpn-season-universes
npm run outcomes:modeling:calculate-local-private-reviewed-hpn
npm run outcomes:modeling:prepare-local-source-qualification -- \
  --scope afl-men:2025-trades \
  --release-scope public-afl-trades-current
```

Review the exact source-qualification report and the retained reviewed-evidence bundle before making
either private authority decision. If the reviewed result does not justify authorization, stop and
leave the readiness report blocked. An authorized first decision uses `none` as the expected current
decision; a successor must name the exact current decision ID returned by the preceding command.
Never copy these examples into a production environment or treat running them as model-run, Gate 3,
publication, or production approval.

```sh
npm run outcomes:modeling:record-private-evaluation-authority -- \
  --scope afl-men:2025-trades \
  --release-scope public-afl-trades-current \
  --expected-current none \
  --decision authorized \
  --reviewer '<reviewed-local-principal>' \
  --rationale '<reviewed private non-production source-use rationale>'

npm run outcomes:modeling:record-private-reviewed-evaluation-authority -- \
  --scope afl-men:2025-trades \
  --expected-current none \
  --decision authorized \
  --reviewer '<reviewed-local-principal>' \
  --rationale '<reviewed retained-evidence calculation rationale>'

AFL_OUTCOMES_DEV_WORKBOOK_PATH='<absolute-private-workbook-path>' \
AFL_OUTCOMES_DEV_WORKBOOK_SHA256='<verified-sha256>' \
npx tsx Scripts/dev/review-local-workbook-player-identities.ts

npm run outcomes:modeling:inspect-local-valuation-readiness -- \
  --scope afl-men:2025-trades

AFL_OUTCOMES_DEV_WORKBOOK_PATH='<absolute-private-workbook-path>' \
AFL_OUTCOMES_DEV_WORKBOOK_SHA256='<verified-sha256>' \
npm run dev:full:workbook-evaluation
```

The readiness report must retain each missing prerequisite as a blocker. This phase can produce
reviewed completed-season HPN allocations and the right-censored current appearance result; it cannot
produce governed player PAV, pick value, remaining value, club totals, or an overall trade grade
without exact authorized model runs and their required Gate decisions. Missing values remain
unavailable and workbook or synthetic values remain non-factual.

The HPN map review must run before the season-universe review, and both must precede calculation. The
field-map command seals the exact capability, invocation digest, schema and season range. The season
command admits the exhaustive reviewed row universe and preserves unresolved identities as
quarantined rather than silently dropping them. The calculation command then persists one
content-addressed player/team allocation set per completed season and verifies exact retries as
idempotent replays. The workbook identity command is scoped to the pinned private workbook bytes and
authenticates its retained evidence parent; the full-stack wrapper repeats that review safely before
starting the UI.

The authentication command accepts only loopback PostgreSQL named `statly_outcomes_test`, installs a
private runtime nonce, and stores that nonce below the ignored `.statly-local` root. Both staging
entrypoints authenticate it before their first mutation. The review commands perform no provider
request. The historical command checks the pinned 48,769-row five-season evidence digest, records
three local review receipts per row in bounded transactions, and writes the complete-set admission
only after all 146,307 receipts are current. An interrupted run leaves partial receipts dormant. The
official command admits exactly 12 current Sam Flanders rows in one transaction only after recording
12 identity approvals, 12 concluded-match approvals and 12 local reconciled player-match facts; a
changed native entity, match, date, count or goal value fails closed against the pinned digest.

The wrapper pins workbook inspection, then runs the private synthetic-valuation verifier before it
starts any web process. The verifier must report the workbook trade count as `scenarioReadyTrades`,
report finite numerical party views, keep `publicationEligible` false and find no unavailable trade.
It exercises local calculation only: it does not read PostgreSQL facts, perform capture, create a fact
batch or issue release/publication authority. To rerun just this gate with the same exported workbook
path and digest:

```sh
npx tsx Scripts/dev/verify-local-workbook-synthetic-valuations.ts
```

After the gate passes, the wrapper enables the private reader, selects the local `test_fixture`
public-read adapter rather than hosted `non_production` custody, re-authenticates the caller-owned
database, and starts the canonical full local stack in reuse mode. In that mode the launcher must not
migrate, seed, reset, destroy, or stop the supplied outcomes database. It still owns the disposable
app database, emulators, workers, and web process that it starts. Stop the stack normally; dispose of
the outcomes container separately only after the local evidence is no longer needed.

Sign in through the Firebase Auth emulator as `admin@statly.dev` using the local password printed by
the stack. The private evaluator accepts only that revocation-checked local session; it does not accept
the credential-free development-auth fallback, request host headers or feature flags as identity.
Missing or rejected credentials must return not found before any workbook or outcomes read. Then open
`/dev/afl-trade-evaluation`, select the pinned 2025 workbook, and inspect the Sam Flanders
acquisition detail. The current official evidence must show 12 concluded St Kilda appearances, one
goal, right-censored 2026 coverage, acquisition `2025_0016`, and effective-through 28 May 2026. The
workbook-recorded zero may remain visible only as labelled source input. Missing historical outcomes,
ambiguous zeros, incomplete votes, or unsupported links must remain unavailable in the factual lane;
neither the UI nor a model may invent factual completeness.

Independently, the archive card must say `Synthetic scenario ready` and display each party's net for
all four views. The detail page must show received, given-up and net values for all four views, the
content-addressed scenario and calculation identities, and both `Fabricated test evidence — not real
AFL data` and `Publication prohibited`. A two-party trade must disclose that the sender was inferred
as the other participating club; a multi-party trade must disclose the deterministic fixture transfer
map. These values exist only to make the calculation and UI testable. They are not an answer to a
factual evidence gap, a calibrated trade grade, a provider-derived result or a release candidate.

This page is a private evidence-and-scenario review surface, not the public archive. The sealed factual-release
lifecycle, API/projection/export parity, rollback, no-fallback withdrawal, and recovery proof remain
owned by the immediately preceding disposable PostgreSQL rehearsal. Do not describe staged workbook
projection or a synthetic scenario as an activated public release. Real-data release review, model
calibration and validation, hosted deployment, and production activation remain later procedures.

### Rehearsing the governed private package-evaluation workspace

The governed private workspace is a second, narrower local boundary behind the workbook screen. Its
only application-facing operations are `inspect`, `execute`, and exact `read`. It does not accept
caller-supplied player values, pick values, transfer directions, evidence, timestamps, grades,
generation documents, or operator identities. The concrete local adapter derives the authenticated
operator from the server session and binds one loopback outcomes database to one absolute private
artifact root. The retained generation and every reader document remain `test_fixture`,
non-production, and publication-prohibited.

Before exercising this boundary, verify all of the following:

- `NODE_ENV` is not `production`, development tools and private workbook reads are explicitly
  enabled, and the workbook path and SHA-256 digest identify the reviewed private input;
- `AFL_OUTCOMES_DATABASE_URL` is loopback PostgreSQL named exactly `statly_outcomes_test`;
- `STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE` is the 64-character nonce installed in that same database by
  the current local stack launch;
- `AFL_TRADE_LOCAL_ARTIFACT_ROOT` is one absolute, private, ignored filesystem directory; and
- the signed-in identity is the authenticated local operator. A feature flag, Host header, route
  parameter, JSON body, or development-auth literal is not operator authority.

An inspection uses trusted PostgreSQL time and captures the composite `(valuationScopeKey, tradeId)`
lifecycle head inside one repeatable-read transaction. It retains and authenticates the exact snapshot
and inspection bytes before returning. Current real inspections fail closed with the earliest exact
blocker, which may be `insufficient_data`, `model_not_approved`, or another declared unavailable
reason. Externally approved player and pick model runs and the non-synthetic component draw-set
materialization required to build a complete narrative do not yet exist. Therefore the real workspace
must not construct, activate, rollback, or recover a grade. An unavailable inspection still retains
its exact lifecycle head and short validity window so an authenticated operator can withdraw an
already-active fixture generation or verify its retained reconstruction without positive model
authority. Expired or stale inspections must be repeated; never extend their timestamps or edit
retained JSON.

When a fixture generation is active, open its private detail page through the signed-in archive. The
automatic governed section must show one card and one package grade for every participating club,
one global four-view selector, complete Received and Gave up ledgers, exact package subtraction,
player games/seasons/rate evidence, pick cohort/sample evidence, and expandable labelled lineage.
The page must also display the generation and projection-manifest identities. When current selection
is absent, withdrawn, unauthenticated, or fails artifact authentication, the same section must show an
explicit unavailable reason and no grade or export control. The separately labelled synthetic panel
is never a substitute for this state.

The signed-in exact export is internal transport only:

```text
GET /api/dev/afl-trade-evaluation/{tradeId}/export
```

It is not a documented third-party API. A successful response has `Content-Type: application/json`,
`Cache-Control: private, no-store`, an attachment filename, and the exact generation and projection
manifest IDs in response headers. Hash the downloaded bytes directly and compare that digest and byte
length with the retained export artifact. Do not parse and reserialize the response before comparing
it. A concealed reader, withdrawn generation, missing artifact, changed byte, manifest mismatch, or
reconstruction failure returns no export bytes.

Run the focused deterministic proof with the repository unit configuration, then the real PostgreSQL
proof only against a disposable target:

```sh
npx vitest run --config vitest.config.unit.ts \
  tests/unit/afl-trade-intelligence-governed-private-evaluation-workspace.test.ts \
  tests/unit/afl-trade-intelligence-governed-evaluation-panel.test.tsx \
  tests/unit/afl-trade-intelligence-private-local-workbook-reads.test.ts \
  tests/unit/afl-trade-intelligence-current-valuation-cohort-runner.test.ts \
  tests/unit/afl-trade-intelligence-private-valuation-scheduling.test.ts \
  tests/unit/afl-trade-intelligence-private-valuation-hpn-preparation.test.ts \
  tests/unit/local-workbook-trade-evaluation-page.test.tsx \
  tests/unit/local-private-reviewed-trade-calculation-panel.test.tsx \
  tests/unit/afl-trade-intelligence-private-governed-exact-export-route.test.ts \
  --coverage.enabled=false

AFL_OUTCOMES_TEST_DATABASE_URL='<owned-disposable-loopback-postgresql>' \
  npx vitest run --config vitest.config.outcomes-int.ts \
  tests/outcomes-integration/afl-governed-private-evaluation-lifecycle-postgres.test.ts \
  tests/outcomes-integration/afl-private-evaluation-batch-postgres.test.ts \
  tests/outcomes-integration/afl-private-valuation-scheduling-postgres.test.ts \
  tests/outcomes-integration/afl-private-valuation-capture-binding-postgres.test.ts \
  tests/outcomes-integration/afl-hpn-pav-projected-input-postgres.test.ts \
  tests/outcomes-integration/afl-private-valuation-hpn-preparation-postgres.test.ts
```

The provisioned integration command is permitted only when the caller owns the disposable database.
The proof applies the complete forward migration history, retains dormant artifacts before compare and
swap, activates and exactly replays a seeded ready fixture, inspects and withdraws it through the real
workspace, verifies the exact withdrawn generation without reactivation, rejects unavailable recovery
and rollback, rejects mutation of append-only receipts, and proves the composite scope key prevents
cross-scope reads. Remove only the container/schema and artifact directory created for that run.

### Refreshing private factual authority

The automatic launcher and ad-hoc valuation command now enter the current-evidence coordinator before
private factual refresh. The coordinator owns exactly these lanes: AFL Tables player statistics for
2021–2025, official AFL player statistics for 2026, and AFL Tables results for 2026. It requires the
separately retained current Gate/source-rights and field-map review authority before provider access.
It never creates those decisions.

Inspect a completed or exhausted dispatch through its append-only evidence result:

```sql
SELECT stable_operation_key,state,stage,cause,result_json
  FROM outcome_current_valuation_evidence_orchestration_operation
 WHERE scope_key = $1
 ORDER BY completed_at DESC
 LIMIT 1;
```

`capture_authority`, `capture`, `normalization_authority`, or `normalization` identifies the exact
provider boundary to repair. `reconciliation_authority` with `missing` means the seven finalized
normalizations are retained but the required human provider review sets are not yet current. Run the
five-season and official review commands in the preceding inspection procedure. Do not manually run
an out-of-band provider capture. Then intentionally enqueue a new outer operation key; the
coordinator will freshly observe all seven sources and reuse an effective normalization only when the
raw bytes and complete governing-authority digest are unchanged. Inspect the two identities directly:

```sql
SELECT source_key,observed_capture_id,effective_capture_id,normalization_run_id
  FROM outcome_current_valuation_evidence_orchestration_stage_receipt
 WHERE stable_operation_key = $1
 ORDER BY source_key;
```

Different observed and effective capture IDs are expected for unchanged evidence. If the operation then returns
`reviewed_authority` / `review_required`, review the assembled source qualification and use the
private reviewed-evaluation authority command to authorize or reject its exact bundle. Enqueue a
third new outer operation key only after that human decision. The next coordinator operation observes
the sources again, reuses unchanged effective normalization custody, and may enter private factual
refresh.

The local receipt signer is durable private runtime state at
`<AFL_TRADE_LOCAL_ARTIFACT_ROOT>/current-valuation-evidence/egress-signing-key.pem`, with mode
`0600`. Preserve that key while any retained non-fixture source snapshot may need to resume after a
restart. If it is lost, those receipts can no longer be authenticated: the next new outer operation
can freshly capture and sign new receipts with a replacement key, but an exact resume that still
depends on retained source work signed by the lost key must fail at `normalization_authority` /
`unauthenticated` and remain terminal. Enqueue a new outer operation key to perform a fresh capture
under the currently governed source and field-map authority; a new human review is required only
when that capture changes the reviewed evidence or its governing authority. Never copy the key into
Git, an environment file, logs, or shared storage. The configured artifact root must be absolute.
Startup rejects a signing key that is a symlink, non-regular or multiply linked, owned by another
user, or not exactly mode `0600`.

An unavailable outcome is terminal for its derived evidence stable key. Reusing the same outer
operation key is exact replay and must not be used to continue after a human authority transition.
Using a new key after review is deliberate continuation, not a transport retry. A superseded review
set returns stale; malformed authority returns unauthenticated; normalized/reconciled custody drift
returns mismatched. None of these states authorizes public release, publication, production, model
training, or redistribution.

Current Valuation Refresh accepts a valuation scope, trigger, and stable operation key. Reuse the same
stable key after a timeout or lost response; exact replay returns the committed receipt. Never invent a
new key merely because the caller did not receive the first response.

The factual stage may return `factual_refresh_complete` with `advanced` or `already_current`. It may
instead retain `unavailable` with `source_authority_missing`, `source_authority_stale`,
`source_authority_mismatched`, or `source_authority_unauthenticated`. Treat these as source-governance
failures: inspect and repair the admitted capture, finalized normalization, reconciliation review,
custody, or rights authority. Do not retry them as transient worker failures; retry and lease policy is
owned by the dispatch recovery boundary.

The coordinator durably retains `source_authenticated` and `candidate_composed` receipts before its
terminal compare-and-swap. Reusing the stable operation key after loss at either boundary resumes the
retained receipt. The composed candidate retains and binds a canonical normalized/reconciled custody
snapshot separately from the reviewed bundle identity. That snapshot includes one exact finalized
normalization run per admitted capture and the reviewed reconciliation sets. The composition receipt
also binds the predecessor private-factual head; if a later candidate advances first, the older
receipt fails its compare-and-swap instead of reactivating stale custody.

An advancement changes only `outcome_current_private_factual_authority`. Verify that
`outcome_active_release` and the publication registry are unchanged. The reviewed sources prohibit
public display and redistribution, so this operation is not authority to register, activate, export,
or serve a factual release. Prepared-v3 and private batch heads remain unchanged until their separate
coordinators complete.

After factual completion, the model-evidence stage captures the current model-pair revision, derives
the player observation and pick benchmark inputs from that exact factual candidate, and invokes the
existing governed execution and qualification boundaries. Reuse the same content-addressed operation
after acknowledged loss. `qualification_failed` is retained evidence, not a transient retry signal;
the previous model pair remains current and prepared-v3 must not run. `stale_authority` requires a new
outer refresh from current factual and model heads. A successful result records the exact two runs,
qualification, qualification work, and Gate 3 decisions and advances current model authority once.

For a claimed dispatch, the model-evidence composition first loads terminal orchestration evidence
through `load_outcome_current_valuation_evidence` using that exact request ID and requires its
downstream operation to be the factual operation supplied to Current Valuation Refresh. The runtime
role must not query the orchestration table directly. It rechecks the current private factual head and
invokes `load_outcome_private_valuation_dispatch_request_for_claim`; do not invoke the model pair from
a factual operation alone. Governed HPN preparation supplies the exact factual output and HPN
calculation. Before either component runs, verify that factual output's normalization run is a member
of the exact private candidate's retained normalized/reconciled custody. The existing pair coordinator
then owns player/pick component retention, pair acceptance,
qualification, restart replay, and failure classification. The dispatch attempt remains the only
retry count and is capped at three persisted transient attempts.

Only `qualified`, `already_qualified`, or `qualification_failed` may be projected into the current
model-evidence commit boundary. Projection repeats the factual-output ancestry and claim checks and
reads the exact pair-bound qualification plus both retained native validation records. A passing
projection must also be the current governed pair and must name its exact qualification work and both
Gate 3 decisions. A failed projection reads its failure codes from the retained qualification and
leaves the current pair and revision unchanged. The factual output and candidate custody are immutable;
the serializable compare-and-set transaction repeats their mutable orchestration,
current-factual-head, and live-claim fences before it may insert. A claim that expires after
preparation cannot commit, while an already-retained replay remains immutable and idempotent. Treat
missing or mismatched ancestry as unavailable authority; never rebuild terminal evidence from
caller-provided identifiers.

### Operating automatic local private valuation

The local full-stack launcher starts one backend valuation worker. It authenticates the exact loopback
`statly_outcomes_test` runtime nonce and private artifact root, performs startup catch-up, and then polls
durable dispatch work. The schedule is Monday 19:00 in `Australia/Melbourne`, calculated as a calendar
occurrence rather than a 604800-second interval, so daylight-saving changes do not move the local time.
Startup discovers only scopes with an exact current private factual head or current prepared-v3 head,
unions duplicate scopes, and coalesces missed weeks to the latest occurrence. It does not accept an
arbitrary scope. A newly committed qualified model pair also enqueues immediate work. Each claimed
dispatch first runs the seven-lane current-evidence coordinator and may advance only the private factual
head. An unavailable evidence result completes that dispatch as exhausted rather than retrying it as a
transient failure. After qualified current-model evidence
exists, the private prepared-v3 coordinator can authenticate that retained evidence and the exact
dispatch ancestry, construct the existing valuation-input bundle and trade manifests, register one
immutable prepared generation, and compare-and-swap the private prepared head. When that exact private
prepared head already exists, the deployed worker now carries the same live dispatch claim into the
exhaustive cohort and final atomic batch activation. The worker still does not compose factual-output,
HPN, model-evidence, and prepared-v3 construction in its production runtime. Do not describe the
repository as automatic raw-data-to-recalculation until those upstream adapters are composed and the
genuine clean-checkout rehearsal below passes.

Run private preparation only while holding the request's current live claim. The operation validates
the current private factual head, reviewed evidence decision and bundle, normalized/reconciled
custody, factual output, finalized HPN calculation, native player/pick validation evidence, governed
runs, qualification work, distinct Gate 3 decisions, current model revision, valuation bundle, and
expected prepared revision. Do not reconstruct that authority from caller-provided IDs, query raw
reviewed evidence from the runtime role, or substitute the public active release. Claim IDs and lease
tokens are transient fences and must not appear in the retained operation or prepared set.

The replay check must call the lightweight valuation-input-bundle selector and match its exact
content-addressed ID against retained operation custody. It must not load or reconstruct the bundle
artifact on an unchanged replay. A different selected ID is a changed input: construct a new
generation and require its full bundle evidence to match the selected ID before registration.

After an acknowledged loss, reclaim the same dispatch through the existing dispatch ledger and call
private preparation again. A valid replacement claim returns the exact retained `already_current`
generation without running HPN/model preparation or reconstructing trades. Inspect retained custody
with:

```sql
SELECT operation.operation_id,operation.dispatch_request_id,
       operation.current_model_evidence_operation_id,
       operation.valuation_input_bundle_id,
       operation.expected_prepared_input_revision,
       result.prepared_input_set_id,result.head_revision
  FROM outcome_current_valuation_cohort_operation operation
  LEFT JOIN outcome_current_valuation_cohort_operation_result result
    ON result.operation_id=operation.operation_id
 WHERE operation.preparation_authority='qualified_current_model_evidence'
   AND operation.dispatch_request_id='<private-valuation-dispatch:64-hex>';
```

One successful request and prepared revision must resolve to one operation and one result. A missing
row means capture did not commit; an operation without a result is resumable retained capture; an
authority mismatch or expired/reclaimed claim must fail closed and leave the prior prepared head
current. Do not manually insert a result or update append-only operation history. Private preparation
must leave `outcome_active_release` and all public model/valuation publication pointers unchanged.

The exhaustive cohort capture retains preparation, current-model-evidence, dispatch, factual-output,
HPN-calculation, model-operation, qualification-work, and model-pair ancestry, but never the claim ID
or lease token. A replacement live claim for the same request can therefore resume the same durable
cycle. Final activation calls only the dispatch-fenced database wrapper, which authenticates the
current claim both before and after compare-and-swap. The older public/release-backed activation path
rejects private prepared-v3 targets. An expired, reclaimed, mismatched, or superseded claim returns
stale authority and leaves the prior batch head readable; do not update the batch head directly.

### Clean-checkout genuine rehearsal blocker

For a populated disposable local database, run `npm run outcomes:valuation:inspect-local` with the
existing `AFL_OUTCOMES_DATABASE_URL` and `STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE` supplied through the
local launch environment. Do not print connection credentials or the nonce. The connection must name
the loopback `statly_outcomes_test` database and contain no query options or fragment. The command
authenticates runtime identity and reads inventory within one repeatable-read, read-only transaction;
it neither provisions another database nor dispatches valuation work. Its JSON has purpose
`existing_database_inventory`, `rehearsalExecuted: false`, and the existing inventory-only assessment.
A successful exit means the inventory read succeeded, even when its state is `blocked` or
`inconclusive`. Errors emit no inventory receipt and exit with code 1.

Retain these JSON receipts outside Git alongside the corresponding persistent database/artifact
checkpoint, for example under `~/Documents/Statly/2025-trade-grading-data/receipts/`. An inventory
receipt is not a database backup or restore proof. Its acquisition counter counts registered spells
starting in the selected season; it does not enumerate the authenticated cohort's required spells
over the evaluation horizon or establish historical 668/668 coverage. Authenticate the exact cohort
and compute that requirement separately. The `preflight-genuine-local` command remains an
empty-database bootstrap smoke check, not an inspection of this populated runtime.

The required `afl-men:2025-trades` clean-checkout rehearsal is not currently runnable from the local
command. Treat this as an authority/composition blocker, not as permission to use fixture data. The
current HPN preparation implementation admits both `afl-men:2025-trades` and
`afl-men:2026-trades` through an exact scope-to-season policy. The default local 2025 source resolver
still fails closed until a genuinely reviewed independent corroborating player-stat source, its
retained capture and rights authority, and its reviewed HPN projection are available. On a clean
database, weekly startup catch-up can discover a scope from its exact current private factual head
before a prepared-v3 head exists. The worker still cannot construct that missing first prepared-v3
head because the #571 player-match authority is not a draft-trade factual release: it contains no
genuinely admitted transaction, draft-selection, pick-custody, or pick-realization membership. The
request-bound factual handoff must authenticate that player-match authority together with an
independent genuinely admitted draft-trade release before the shipped HPN, genuine player, genuine
pick, qualification/model-evidence, valuation-bundle/trade-construction, and private prepared-v3
adapters can be composed by the worker.

The admitted-player factual output uses v2 with multiple admitted captures and a dataset/admission
parent. HPN preparation, model-pair input selection, and current-model-evidence ancestry accept that
output only with an explicit request-bound HPN factual binding. The binding retains the exact #571
operation, private factual candidate/revision, approved HPN reconciliation run, input digest and
finalization instant. Its loader reauthenticates the current reviewed authority, player parent, HPN
match/appearance ancestry, and player spell-metric source ancestry on replay. A run selected only by
season, a review-set identifier, or a v3 that merely adds a pick release to v1 is not a substitute.
Pick observations use their own admitted dormant draft-trade release; finalized player membership
cannot be extended with pick records. For v2, prepared-v3 now obtains its target release from an
immutable request-bound cohort selection, not the player release or an automatic substitution of the
pick training release. Historical pick training membership does not establish the complete 2025 trade
universe. `PostgresAflTradePrivateValuationCohortBinding.bind` takes an existing finalized
corpus-factual-lineage admission under the live claim. It authenticates its promotion-backed corpus,
approved dormant release/candidate, source and canonical member digests, exact cutoff, current Gate 2
and source rights, and every transaction's AFLM/2025 membership. Replay rechecks that authority;
foreign-season transactions and withdrawn authority fail closed. Private cohort preparation accepts
the explicit `cohortLineageAdmissionId` selection and retains this binding before construction.
Legacy v1 keeps its original single-release parent. The sequencing module is tested but is not yet
installed in the local worker.

`PostgresAflTradeAdmittedPlayerFactualPreparation.prepare` materializes the existing v2 output for an
already retained dispatch and exact finalized dataset/admission. It uses a claim-gated parent loader
and the existing output-retention validator; replay rechecks the parent and returns the original
content-addressed bytes. It does not enqueue a second request, import sources, admit a dataset, grant
model execution, or publish a release. This adapter is available for composition but is not wired
into the local worker.

`PostgresAflTradePrivateValuationHpnFactualPreparation` composes that adapter with the HPN binding.
Supply exact retained player dataset/admission, factual-operation and HPN reconciliation-run IDs;
its `prepare` method satisfies the existing HPN preparation dependency. HPN checks this authority
before source capture and again in the claim-fenced calculation transaction. It does not provision
those parents or grant missing source rights.

`createLocalAflTradePrivateValuationHpnCapture` supplies the existing HPN `captureSource` dependency
using authorized fitzRoy ingestion, source retention and normalization. Configure exact reviewed
source lanes with their policy-bound capture/staging dependencies; the adapter rejects substituted
authority, wrong scope and incompatible source roles before external execution. The HPN coordinator
still authenticates the live dispatch claim. This adapter neither selects a default 2025 source nor
grants source approval, and is not yet installed in the local worker's full preparation sequence.

`createLocalAflTradeHpnMethodAuthority` loads an already registered non-production method and verifies
its exact retained HTML source bytes. It neither fetches a substitute nor registers a new method.
`createLocalAflTradePrivateValuationQualificationRegistrar` takes one retained policy artifact,
checks it against the accepted operation, derives evidence from the exact native player and pick
validation reports, and uses the existing claim-fenced qualification registration and Gate 3 ledger.
Its automated validation records grant no new source rights, human approval, or model-spend authority.

Fresh prepared-v3 construction still needs evidence-derived per-trade assembly and worker
composition, not replacement bundle or packaging infrastructure. Use
`createPostgresAflTradeRetainedValuationInputBundleConstructor` with the exact retained construction
specification and compatible qualified component runs. Load the sealed target cohort through
`PostgresAflTradePrivateValuationTradeEvidence.load` under the live claim, and pass genuinely derived
inputs to `constructAflTradeAuthenticatedCurrentValuationTrade`. These owners retain/authenticate
their parents; they do not calculate missing forecasts, dependence or realized measurements.

`createPostgresAflTradeRetainedValuationInputBundleSelector` supplies the existing prepared-cohort
selection dependency. Configure the exact retained specification ID and artifact; selection reads
only the matching retained construction under the caller's transaction, including scope, model
evidence, revisions and component runs. It does not construct a bundle during prepared replay.
`createLocalAflTradePrivateValuationConstructionEvidence` supplies the evidence-loading dependency
for one explicitly configured 2025 dispatch and claim. It shares the supplied transaction across
the sealed trade reader, bundle constructor and staging owner; rejects mismatched factual ancestry;
and retains the full release manifest, canonical membership and selected bundle with artifact
custody before returning. Release/membership timestamps remain the release's original creation time,
and cohort trade IDs remain event-version IDs. These dependencies are implemented but not yet
installed in the complete local worker. They do not derive per-trade calculation inputs or grant
source, model or publication approval.

Native player contribution predictions are not the fixed-horizon receiving-spell player-PAV
observations consumed by the explanation materializer. Use
`PostgresAflTradePrivatePlayerPavPreparation.prepare` with the exact request, live claim, reviewed
policy and historical lineage admission. Its authority loader authenticates the independently
admitted historical corpus, spell membership and finalized HPN ancestry, and its private repository
path materializes observations without borrowing the active public release. This implementation
still needs genuine historical inputs and local worker composition. Retained fixture manifests and
relabeled native predictions cannot satisfy that requirement. Calculation packages also require
authenticated component draws and realized contribution ledgers; their constructors validate
supplied parents but do not provide a fresh source assembler.

For historical spell evidence recorded after its prediction year, retain actual recording dates and
use an exactly reviewed `afl-trade-player-pav-policy/v2` with knowledge policy
`retrospective_as_recorded_by_dataset_creation`. The existing preparation and repository path emits
observation-set v2; migration 0116 enforces matching policy, per-row cutoff bindings, full spell
custody and exact calculation dates. Recording and calculation custody must not exceed the admitted
historical corpus cutoff. V1 remains unchanged and cannot accept late-recorded spells. A v2 set is
restricted to fixture/non-production use and cannot be compared under `calculated_by_origin`; use
the explicitly retrospective comparison mode. This is not source admission or model qualification.

Historical HPN source captures require their own explicit input request: set `knowledgePolicy` to
`retrospective_as_recorded_by_input_creation` and supply `knowledgeCutoffAt` together. The existing
input repository produces input-set v3 and retains the actual capture and recording dates. Keep
`effectiveThrough` at the historical event cutoff; capture, normalization, factual finalization and
spell recording must fit within the declared knowledge cutoff, no later than input creation.
Migration 0118 enforces these rules in PostgreSQL. Do not change the cutoff on a replay or omit the
mode to reuse a retrospective input as an older version. V3 is restricted to private environments,
with projected mappings restricted to non-production. Use `loadCurrentFinalizedSeasonInputSet` when
admission needs current source/mapping/factual/identity/spell authority rather than only retained
historical input integrity. This read performs no persistence or PAV calculation and does not grant
training rights. Both v3 mapping paths have focused disposable-PostgreSQL coverage, including a
legacy mapping review successor that invalidates current reads without erasing historical reads.
Migration 0118 also corrects the legacy finalizer's player/club lock-key expression exposed by that
test. This fixture evidence is not a genuine historical admission or the full local rehearsal.

The existing player-PAV observation-set contract requires all four chronological, label-purged model
partitions. Its historical measurement windows cannot inherit authority from the dispatch's single
2025 HPN source set. Explicit historical calculation IDs establish identity, not current source/input
permission; a private multi-season measurement authority must be authenticated independently. Do not
relax the partition rules or borrow public active-release/HPN-head authority to fill that gap. Exact
reconstruction of an already governed retained calculation package is distinct from proving fresh
construction from newly admitted sources.

The #571 normalized/reconciled custody contains source captures, normalization runs, review sets, and
rights references. Its review sets are not approved factual reconciliation runs. HPN requires a
separately retained, approved, finalized, conflict-free run with exact competition/season and complete
match/appearance input membership. Bind that run and its input/calculation ancestry explicitly to the
reviewed authority; selecting a run only by season is insufficient. New v2 model-request bindings
check both the player dataset/admission and the authenticated HPN run. Previously retained standalone
player bindings are not rewritten or retrospectively re-admitted by this change.
Both player and pick dataset/admission IDs already bind their own immutable release, candidate, and
member digest. Preserve those separate parents and authenticate exact ancestry on replay, even when
substantively unchanged inputs permit reuse of a retained model operation.

### FootyWire 2025 missing-stat participation corroboration

Primary-source research checked on 2026-09-06 and rechecked on 2026-09-08 corroborates unused-substitute
status for all five retained 2025 FootyWire rows identified with all 33 statistic fields missing.
The dates below are the match dates confirmed by the dated AFL post-match reports, not research or
capture dates.
FootyWire match IDs identify the retained rows; the AFL reports do not authenticate those IDs.

| Retained FootyWire match ID | Match date | Retained player and club         | Opponent        | Official post-match evidence                                                                                                                                                                                             |
| --------------------------- | ---------- | -------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `11251`                     | 2025-05-02 | Tobie Travaglia, St Kilda        | Fremantle       | [AFL round-eight report](https://www.afl.com.au/news/1311568/st-kilda-saints-v-fremantle-dockers-match-report-afl-round-eight-2025/amp) lists Travaglia as an unused substitute.                                         |
| `11321`                     | 2025-06-29 | Nathan Fyfe, Fremantle           | St Kilda        | [AFL round-16 report](https://www.afl.com.au/news/1353300/match-report-fremantle-dockers-v-st-kilda-saints/amp) lists Nat Fyfe as not used and describes no game time after a calf concern during his half-time warm-up. |
| `11324`                     | 2025-07-03 | Lachlan McNeil, Western Bulldogs | North Melbourne | [AFL round-17 report](https://www.afl.com.au/news/1355675/western-bulldogs-hold-off-spirited-north-melbourne-kangaroos-to-mark-tom-liberatores-250th-in-style/amp) lists McNeil as an unused substitute.                 |
| `11322`                     | 2025-07-05 | Mitchell Duncan, Geelong         | Richmond        | [AFL round-17 report](https://www.afl.com.au/news/1357096/geelong-cats-v-richmond-tigers-match-report-afl-round-17-2025/amp) lists Mitch Duncan as an unused substitute.                                                 |
| `11370`                     | 2025-08-09 | Steely Green, Richmond           | St Kilda        | [AFL round-22 report](https://www.afl.com.au/news/1383852/st-kilda-saints-hold-off-richmond-tigers-in-saturday-scrap-at-the-mcg/amp) lists Green as an unused substitute.                                                |

This is documentation-only corroboration, not a retained machine-verifiable capture, canonical
identity reconciliation, approved participation classification, dataset admission or reviewer
attestation. In particular, the reports' Nat/Nathan and Mitch/Mitchell name variants require the
normal governed identity mapping; the table must not create that mapping implicitly. Retain exact
source custody and reviewed participation evidence through the owning workflow before any approved
projection treats these records as non-participating selections. Preserve the original rows and
their missing values: do not zero-fill statistics, silently drop rows, rewrite the capture or infer
the same status for any other missing-stat record. These findings narrow the five-record evidence
gap; they do not establish complete HPN input coverage or complete issue 579.

The initial bounded retained-evidence check on 2026-09-09 found no response-byte artifacts for these
five official reports in the inspected source/research repositories. The inspected statistical
returns did not provide explicit nonparticipation proof: FootyWire `Status` is home/away orientation, its
missing statistics are not zero, and zero AFL Tables playing time alone is not an unused-substitute
classification. A subsequent genuine Fryzigg 2025 capture also returned all 9,936 rows and the exact
81-field schema. All 9,936 `subbed` values were missing. Each of the five date/surname candidate
rows records `player_position = 'SUB'` and zero playing-time percentage, but that establishes neither
an explicit unused status nor canonical identity. This is an observed approved-source limitation,
not an unavailable fitzRoy package or an unattempted alternative. The capture is
`source-capture:7d77f3fbce4ba014242a19222015c3ab987bc80f266353d1c057b47e93dbe41a`;
its retained source digest is
`00a02251ed76d335f14f11c6f933201aac414075a6f0134e4560185994625189`.
A subsequent check of the five FootyWire match pages found explicit `Unused Substitute` cells beside
the corresponding player profile links. All five exact HTML responses returned HTTP 200 and were
retained with response headers, actual retrieval times, content hashes and read-back-verified
research receipts. This supersedes the earlier claim that Official AFL acquisition was required:
the approved FootyWire source contains the missing wording even though its fitzRoy statistical
return loses it. The research responses are not relabelled as governed fitzRoy captures. Exact
player/club/match reconciliation and an explicit semantic participation review are still required
before the ten source occurrences can be excluded through the existing reviewed-nonparticipant
owner. The original statistics remain untouched. Before preparing these decisions, verify migration 0141 is applied and
that the SQL scalar reader returns the actual observed identity fields from each retained `values`
envelope. Hash the complete original payload, and reject an all-null or fallback-derived inspection.
For staged captures, verify the exact source-first projected map and capture/normalization binding.
After recording decisions, require current-review checks and exact replay before treating any row
as excluded; this does not supply missing acquisition-spell or method provenance.

The owned non-production continuation completed these checks on 2026-09-10 after applying
migration 0141. All ten source occurrences received evidence-backed nonparticipant decisions;
current-review checks, exact replay, source-snapshot preservation and safe-role preservation
passed. The resulting backup passed checksum and archive table-of-contents verification, without
a full restore certification. The subsequent read-only prerequisite check still found no acquisition
spells, acquisition rules, event versions, event assets, or registered HPN methods. All 668 observed
player/club pairs lacked an approved acquisition spell, and no genuine HPN input set was created.
A later owned-target step registered the retained HPN method through its existing owner. Genuine
acquisition ancestry remains outstanding; the participation decisions supply neither entry dates nor
spell authority.

Acquisition registration now has a dedicated public repository and migration 0142. Before applying
that migration to an owned target, complete the scoped PostgreSQL regressions and independent review,
authenticate the exact target and backup, and preserve the resource reserve. Register the reviewed
rule with its actual retained bytes. For each proposed spell, retain both the dated event evidence
and the incoming player asset evidence, promote through the existing external reconciliation owner,
and obtain the exact generic `acquisition_spell_registration` review for the content-addressed
proposal. `registerReviewedSpell` checks current promotion, identity, reviewer authority and evidence;
`loadCurrentExact` repeats current authority and byte authentication. Replay verifies the existing
record. Corrections append versions; departures end the inclusive interval one day before the
reviewed outgoing event. Record an evidence-backed `observedThrough` that covers every included HPN
appearance. Never infer an entry or departure from first/last appearances or January 1.

For draft entries, deploy migration 0143 after the same owned-target checks. Use proposal v2 and
retain typed `draft_session` evidence for the actual event date, official name, session ordinal and
exact selection numbers. Each candidate selection must belong to exactly one session; the union
must cover the complete reviewed draft. Retain both the selection-page artifact and the session-date
artifact when those facts come from separate pages. Verify separate event roots and dates for
multi-day drafts, and exact replay of each promoted incoming asset before spell registration.
Corrections append versions of the existing session root. Legacy promotion receipts are preserved,
but cannot establish new draft spell registrations without reviewed session evidence. The current
official indicative-order parser is insufficient for these captures: prepare a bounded completed-
draft source access/field review before implementing or executing its parser. Synthetic session
tests establish the downstream contract only.

Source-first HPN construction and current reads require current registered spells, even if the
capture has since moved from staged to approved. Registration revocation invalidates current use;
historical input receipts remain readable. Implementation and synthetic tests do not authorize
source access or establish any of the 668 genuine spell histories. Keep missing or ambiguous source
claims unresolved and use the existing source-specific access/field review before new acquisition.

| FootyWire match page                                                       | Explicitly labelled player | Retained HTML SHA-256                                              |
| -------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------ |
| [11251](https://www.footywire.com/afl/footy/ft_match_statistics?mid=11251) | Tobie Travaglia            | `21a174fd3f9de2e9fddaf30f13b8de811c50991a2ebbf57a922809d626a1bfbd` |
| [11321](https://www.footywire.com/afl/footy/ft_match_statistics?mid=11321) | Nathan Fyfe                | `c31e2c86da1ffb61bd2afb16346bc1b8e9162d36702b7a829f835ad74b118953` |
| [11324](https://www.footywire.com/afl/footy/ft_match_statistics?mid=11324) | Lachlan McNeil             | `9d17a20632b068e25c94d25c2315bf0c5fef84ee7894ec2159fcc9dff6c273df` |
| [11322](https://www.footywire.com/afl/footy/ft_match_statistics?mid=11322) | Mitchell Duncan            | `53750afb3c166c284e7371dd20c404ba2831f65b2e9ee4b71debb7c0d5552201` |
| [11370](https://www.footywire.com/afl/footy/ft_match_statistics?mid=11370) | Steely Green               | `b72cc12a1e0e6df28029adad7d6c5c52055a1d7574630b6689bda928eb2f15d3` |

These five research artifacts do not themselves create identity authority or a finalized factual
run. The standing source policy remains unchanged; an unrelated Official AFL capture would still
need its own applicable source decision.

### AFL Tables 2025 missing-ID profile evidence

The initial retained 2025 return has 83 rows without a native player ID, covering five exact profile URLs.
Research on 2026-09-08 retrieved those pages successfully and retained new response bytes, headers
and actual retrieval times in private content-addressed storage. These are research artifacts, not
governed source-capture receipts or approved identity assignments.

| Exact retained profile                                                             | Rows | Profile birth date | Embedded page lookup key |
| ---------------------------------------------------------------------------------- | ---: | ------------------ | ------------------------ |
| [Charlie Cameron](https://afltables.com/afl/stats/players/C/Charlie_Cameron3.html) |   25 | 1994-07-05         | `12277`                  |
| [Jack Ross](https://afltables.com/afl/stats/players/J/Jack_Ross3.html)             |   23 | 2000-09-03         | `12712`                  |
| [Jack Graham](https://afltables.com/afl/stats/players/J/Jack_Graham2.html)         |   18 | 1998-02-25         | `12576`                  |
| [Jack Williams](https://afltables.com/afl/stats/players/J/Jack_Williams3.html)     |   13 | 2003-12-01         | `12962`                  |
| [Billy Wilson](https://afltables.com/afl/stats/players/B/Billy_Wilson2.html)       |    4 | 2005-06-16         | `13244`                  |

The first four embedded keys match historical native-ID groups in the retained 2021–2025 corpus;
Billy Wilson's profile birth date matches his retained missing-ID rows. None of these exact URLs
has an ID-bearing row elsewhere in that corpus. The inspected pinned fitzRoy helper obtains `ID`
and `DOB` by joining `player_mapping_afltables.csv` on the exact profile URL; it does not extract
the embedded key. The page's displayed player-appearance ordinal is a different value for Cameron
and Graham and must not be substituted for a native ID. Profile corroboration can support an exact
candidate-only identity review without rewriting the missing source ID. A new reusable namespace
or automatic suffix-normalization rule is not established by these findings.

### Construction compatibility preflight

Before using the new checked construction entry point, select the compatibility-policy artifact
through current policy authority and select both component runs through current run/Gate authority.
Use the existing private immutable artifact repository. The policy must name exactly every receiving
root asset and all four required views. Each input metadata artifact must bind the selected trade,
bundle, asset/view, run/method/unit, receiving club/spell, explicit annual window, knowledge/origin
and recording times, and applicable draft year/pathway/access. Retain original evidence through its
owning source/model workflow; a metadata assertion cannot establish historical knowledge or approval.

Call `constructAflTradeCompatibleCurrentValuationTrade` with those selections. Missing policy or
input evidence prevents packaging. An incompatible assessment reports each asset/view and reason;
corrupted bytes, foreign scope, incomplete membership or selected-authority mismatches fail closed.
A compatible result only permits the existing authenticated packager to run its normal checks.
No model/source/publication grant is issued, and no database or artifact write occurs in assessment.

This entry point is implemented but not wired into the local command/worker. Genuine policy and
input-metadata production, current authority selection, scientific alignment and end-to-end assembly
remain outstanding. Existing low-level packaging and fixture replay do not prove this preflight ran.

### Fresh governed execution prerequisites

For issue 579, use fresh governed execution with new retained identities. The completed recovery
inspection is not an execution input and need not be repeated without a new backup lead. Preserve
retained original/recovered evidence separately; no staging snapshot establishes the missing final
dataset admission or model run. The
[construction proposal](../architecture/afl-trade-intelligence.md#fresh-construction-method-proposal-and-required-evidence)
is unapproved research direction and identifies the reusable measurements and unresolved science.

Resolve each requirement through its owning workflow at the applicable stage below. Pre-execution
method review and post-run model-change review are different requirements:

| Required record or dataset                                                                        | Why existing records do not satisfy it                                                                                                                                                         | Next action                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Draftguru authority for the complete 2025 target cohort and selected historical acquisition years | The existing loader supports a separate issue-579 v2 evidence package; the retained issue-574 v1 records still cover only 2020–2024 and cannot be relabeled                                    | Supply four distinct retained authorization/capture/access/field-review documents with matching explicit seasons ending in 2025 and matching current decision timing; load and record through the existing authority owner before capture. Schema support is not admission. |
| Exact historical corroborating player-stat lane for HPN                                           | FootyWire candidate mapping and season-review selection are implemented, but do not approve a projection or identity reconciliation; the default 2025 capture resolver still rejects this lane | Supply exact reviewed source authority through the existing resolver; retain capture/schema, semantic field-map, identity and source-use reviews within the standing policy's applicable scope                                                                              |
| Finalized measurement authority for every policy-selected season                                  | A dispatch-bound 2025 calculation or an ID selected from a historical HPN head grants no private multi-season source/input permission                                                          | Bind exact inputs, calculations, method bytes, factual reconciliation and current source rights to the private measurement scope and claim                                                                                                                                  |
| Reviewed player-PAV policy, knowledge treatment and common-unit forecast protocol                 | Player protocol v2 fixes the scalar source outcome vector; neither it nor year-end PAV observations establish trade-date joint PAV forecasts                                                   | Retain the preregistered method package and its review, implement the explicit protocol/execution extension, then satisfy exact admission and run authorization; complete model-change review using the resulting genuine evidence                                          |
| Complete historical spell and draft datasets, plus a separate 2025 cohort admission               | Five player training rows or historical pick membership do not establish the complete target trade universe                                                                                    | Retain promoted source/canonical membership, acquisition entry/departure evidence, whole-draft access/rule/selection/realization evidence, and the distinct finalized 2025 corpus-lineage admission                                                                         |

Use this evidence order; do not fill a later-stage artifact with a placeholder to make an earlier
stage appear complete:

1. **Before candidate evaluation:** retain the change plan before proposal and evaluation. Prepare
   the common-unit definition and pick alignment, horizon and feature policy, forecast origins and
   knowledge-time treatment, replacement and comparison baselines, censoring/departure definitions,
   dependence construction, partition/group embargo, support minima and acceptance criteria. Obtain
   methodological review of these proposed choices. Retain the applicable preregistered
   data-sufficiency protocol before its coverage assessment. A draft package is not a registered protocol,
   completed model-change review or source authorization; capture still requires current scoped
   source/Gate authority.
2. **Before model execution:** authenticate source-rights proposals and current Gate 0A receipts for
   the exact uses, the applicable Gate 0B coverage and Gate 1 architecture decisions, reviewed corpus
   and factual lineage with current Gate 2 authority, finalized dataset admission, exact registered
   protocol and exact run authorization. The admitted player protocol binds the existing admission;
   its preparation cannot predate admission, and execution cannot predate protocol preparation.
   Retain the actual referenced value-unit, feature-availability, baseline, censoring, validation and
   acceptance-criteria artifacts. A PAV extension must preserve these authority boundaries rather
   than borrowing the scalar protocol's outcome vector or retrospective policy.
3. **After genuine candidate execution:** retain the distinct candidate bundle and both component
   protocols/runs. The [model-change procedure](#recalibration-and-model-change) requires baseline
   comparison, temporal validation, calibration/coverage, subgroup performance, sensitivity,
   leakage audit, lineage invariants, public-contract parity, shadow evaluation and rollback-rehearsal
   evidence, plus monitoring and rollback plans. Retain at least two unique reviewer attestations,
   independent of the proposer and with distinct responsibilities. Unanimous advancement permits
   only a recommendation for separate Gate 3 review; it does not authorize publication.

The current model-change schema also requires an authenticated current bundle and its two component
protocols/runs. If that release does not exist for the fresh candidate, obtain an explicit governance
decision on the initial-candidate review route and any needed contract support, as described in the
[construction proposal](../architecture/afl-trade-intelligence.md#fresh-construction-method-proposal-and-required-evidence).
Do not invent a predecessor, substitute an unrelated release or waive review. This is a conditional
review-route gap, not a requirement to recover the missing earlier execution before all fresh work.

The standing AFL Tables, Footywire and Fryzigg decision already permits bounded historical training
uses. Exact capability/year/field/operation records under that decision are mechanical scope and
custody requirements, not a request to renegotiate the blanket source policy. Footywire's approved
player-stat lane begins in 2010; the proposed 2008–2025 measurement example therefore needs another
supported and authorized corroborating lane for its earlier seasons. Supported schema, coverage and
independence must be demonstrated from source evidence. The AFLCA coaches-vote decision does not
cover HPN's other statistics, and a new capability or uncovered provider/scope needs its own decision.

For each HPN measurement season, retain complete match results (clubs, points and completion state)
and the required player statistics: total points or governed goals/behinds, hitouts, goal assists,
inside 50s, marks, marks inside 50, frees for/against, rebound 50s, one-percenters, clearances and
tackles, with exact player/club/match identities. Authenticate the independent corroborating lane,
reviewed projections, source-use decisions, full universe, finalized reconciliation and method
before calculation. Add age, role or availability evidence only if the selected forecast uses it;
an absent predictor cannot be manufactured from a display name or an unrelated source.

`createAflTradePlayerPavCalculationEvidence` is a shared pure conversion of authenticated HPN-shaped
measurements. Its scope, content-address, input-digest and player-row checks are useful to both
measurement paths, but it cannot authenticate a durable source ledger, grant a private release
selection, or approve a model. The PostgreSQL public path retains its current release/policy
selection and durable membership checks. The private preparation path supplies an independently
authenticated historical selection rather than borrowing the public active release.

Record a stop precisely as missing implementation, missing scientific review, missing scoped source
decision, or missing retained dataset/evidence. Cite the exact selection and failed requirement;
do not infer source withdrawal merely from an empty database. A future fresh run must retain its
own capture/admission/model identities and durable database/artifact export before disposable
runtime cleanup. Existing preflight and unit results are not the full PostgreSQL 16 rehearsal.

Run the non-mutating clean-checkout preflight with:

```sh
npm run outcomes:valuation:preflight-genuine-local
```

The command requires an exact clean Git checkout, creates a loopback-only disposable PostgreSQL 16
container and temporary working directory, applies the outcomes migrations, and performs a read-only
inventory for exactly `afl-men:2025-trades`. It never imports source data, dispatches work, or changes
public or private authority heads. This command is an empty-database bootstrap smoke check: it has no
source provisioning step. The expected result is exit status `2` with a JSON report identifying the
clean checkout commit and missing retained factual, qualified-model-evidence, prepared-v3, and
exhaustive-batch heads. Source authorities are reported as `not_inspected`; their absence is not
inferred from missing heads. The inventory alone cannot certify readiness even when heads exist.
Exit status `1` means the preflight itself failed. The report is not the genuine rehearsal proof and
must not be converted to success with fixtures, fabricated rows, or a public-release fallback.

Before closing the rehearsal issue, provide those two exact 2025 source authorities, retain the
private factual handoff without advancing a public release pointer, and wire the shipped factual,
HPN, genuine player, genuine pick, model-evidence, private prepared-v3, and claim-fenced batch
boundaries through the one existing dispatcher. Then run the command against a
fresh loopback PostgreSQL 16 database named `statly_outcomes_test`, an isolated artifact root, and
genuinely admitted local source authority. Prove restart/reclaim at every retained boundary, exact
no-change replay, stale/superseded authority rejection, one genuinely unavailable cohort member,
complete batch visibility only after commit, and byte-identical public heads. Any fixture, fabricated
qualification, public-release fallback, or missing/expired rights authority invalidates the proof.

The native run owner's candidate-checkpoint operation is currently an application seam, not a new
CLI rehearsal command. It requires an already consumed original private native run and explicitly
configured derived-private candidate storage. It derives fitting inputs from retained authority;
operators cannot supply replacement candidate values. A successful call retains `candidate_locked`,
not a completed or qualified model. Exact replay reads the saved candidate without fitting or
renewing authorization. Storage failure leaves the started run without a terminal failure record.
An expired operational receipt blocks a new checkpoint even if its dispatch lease was heartbeated.
Do not renew that immutable receipt, clear consumption, or use this operation to bypass the still
unfinished continuation and final-test execution paths.

The repository now also contains a backend-only HPN preparation seam for the next upstream cutover.
It accepts an exact retained dispatch plus its live claim, requires the exact immutable factual output
already retained for that request, and
accepts three separately authenticated source roles: AFL Tables completed results, AFL Tables primary
player statistics, and Official AFL corroborating player statistics. It then requires one current
reviewed HPN projection for each exact source. PostgreSQL must retain one immutable HPN source
admission for each role before the input repository runs. Each receipt binds the original dispatch
attempt that accepted its capture, plus the capture binding, staged capture, normalization run, and
projected field map. Only a caller holding the current live claim may run that transaction, which may
advance the bound capture to `approved`; never update capture status manually.

For a retained request, inspect the private ledger without reading raw source rows:

```sql
SELECT admission.source_role,admission.admission_id,admission.capture_binding_id,
       admission.normalization_run_id,admission.projected_field_map_id,
       capture.status
  FROM outcome_private_valuation_hpn_source_admission admission
  JOIN outcome_source_capture capture
    ON capture.capture_id=admission.source_capture_id
 WHERE admission.request_id='<private-valuation-dispatch:64-hex>'
 ORDER BY admission.source_role;
```

Success requires exactly the three named roles, three content-addressed admission IDs, and `approved`
for each exact capture. Concurrent or restarted preparation returns the same receipts and creates no
new capture, admission, input set, or calculation. A reclaimed worker cannot use its expired claim;
the new live claimant may admit the original accepted binding or replay its already-retained receipt
only after PostgreSQL revalidates the current decode map, projected map, reviewed source-use decision,
and rights under the owning authority locks. The receipt remains bound to the claim that accepted its
capture, while the caller must hold the request's current live claim.

If admission fails, leave the staged capture and prior prepared/current valuation state unchanged.
Correct or supersede the provider review, projected HPN review, source-use decision, rights evidence,
or capture through its owning workflow; do not mutate an admission or weaken HPN input validation.
The seam then uses the existing HPN input/calculation repositories inside one claim-fenced PostgreSQL
transaction. It heartbeats before input persistence and immediately before commit, so a lost claim or
calculation failure rolls back the input set, calculation, and current HPN head together. It is not yet invoked by the local
worker, and it must not be described as automatic weekly raw-data recalculation until the later model
and prepared-v3 stages are composed into the same runner. Do not bypass missing HPN map reviews or
identity resolutions; those states remain backend blockers.

The governed pick-PAV stage can now consume that exact handoff without a public factual-release
fallback. It requires the live dispatch claim and the retained request-to-model-operation binding.
The binding's factual output selects the retained draft release; its HPN calculation supplies the
exact method, factual ancestry, values digest and knowledge cutoff. The operation selects the existing
approved pick policy, protocol, finalized dataset and dataset admission. If any request, operation,
claim, attempt, lease, factual, HPN, policy, protocol, dataset or admission identifier disagrees, stop
the dispatch as stale or deterministic authority failure. Do not substitute the current public
release or a test fixture. Migration 0086 enforces the retained-release exception at observation-set
finalization and requires the same live binding, pick policy and bound HPN calculation.

Successful execution retains the native governed pick-PAV v4 execution and its governed component
manifest. On restart, inspect the model operation's retained `pick_run_id`; when present, the pair
coordinator reuses it without rematerializing or refitting. When `pick_run_id` is still absent after a
crash, a replacement claim for the same request may adopt the exact retained component: the retained
v4 execution must authenticate against its original dispatch attempt, and the replacement claim must
independently remain live through lookup and operation acceptance. Do not rewrite the execution's
historical claim envelope or accept it under an expired replacement claim. A deterministic
observation or validation failure is not a reason to claim another attempt. Allow the existing
dispatch attempt ledger to retry only transient PostgreSQL, artifact-custody or local runtime
failures. This boundary remains local, private, non-production and publication-prohibited and does
not by itself qualify a model pair, prepare a valuation cohort or activate a batch.

The admitted player-contribution component is available to the same local, private coordinator for
the later model-pair composition. Its fixed methodology is
`afl-trade-admitted-player-candidate/v1` under
`afl-trade-player-contribution-model-protocol/v2`. It fits a ridge candidate against the governed
role-and-era replacement baseline from the exact finalized dataset, admission, feature members joined
under its declared knowledge policy, and target spell metrics selected by the operation. The protocol
owns the scalar value unit,
feature definitions, partition windows and embargo. The candidate configuration owns the baseline,
ridge penalty, validation thresholds and interval coverage level. Neither the dispatch caller nor an
operator may override those values at execution time.

For candidate version 1, verify the retained configuration uses a games-played-weighted 25th
percentile replacement level per role and era, minimum one game, minimum one training observation per
group, ridge lambda `1`, 80% interval coverage, and minimum one comparable validation observation.
Both relative MAE and relative RMSE must improve by at least 1% over the games-only comparator, and
incomplete prediction coverage must fail closed.

Before a run, require one live current dispatch claim, the exact request-to-operation binding, the
bound private factual output, and identical factual release, candidate and source-member ancestry in
the dataset and admission. An admitted-player factual-output v2 must additionally bind that exact
dataset, admission, and canonical source-capture set. The HPN path's factual-output v1 has no direct
dataset fields, so it is accepted only when the exact operation-selected dataset and admission IDs
match the loaded candidate and its exact release, candidate, and source-member digest, and when the
v1 capture binding's exact capture and snapshot occur in the admission's content-addressed source
set. All other dataset, admission, source-rights,
protocol, and run-start checks remain mandatory. Each source-rights proposal gets one fresh run-start
evaluation. Multiple
captures may share that proposal only when their retained Gate 0-A request ancestry is identical apart
from evaluation time; disagreement is a deterministic failure. Never substitute a current dataset,
protocol, public factual release, fixture, fabricated evidence, caller principal or caller execution
mode. The existing human authorization workflow remains separate and unchanged.

A successful native run retains its fitted model, baseline comparison, validation, calibration,
interval, subgroup, sensitivity, leakage, model-card and diagnostics artifacts, then registers the
governed player component with full dataset, admission, protocol and Gate-ledger ancestry. On replay,
authenticate the component against the original immutable attempt and independently authenticate the
replacement claimant as current. An exact retained component returns without rematerializing the
observation set, issuing a second model-run authorization or retraining. The model-evidence composition
now pairs it with the genuine pick component through the existing model-pair coordinator, but the
local worker now invokes that composition when exact model-pair and cohort construction dependencies
are supplied. The command-line composition still lacks that genuine configuration; this wiring does
not establish native PAV execution or a successful genuine-data rehearsal. No new player
retry ledger or current pointer is part of this slice. Migration 0089 adds
only the coordinator's least-privilege reads, immutable inserts and narrowly scoped row-lock/update
permissions required by the existing append-only model-run and artifact-custody triggers.
Migration 0102 adds the admitted-player factual-output v2 parent, exact source-capture and
spell-batch authentication, and request-scoped replay semantics. It preserves legacy v1
candidate/release uniqueness with partial indexes, while allowing a later dispatch request to bind
the same sealed v2 candidate and release through its own immutable output. Its model-run guard counts
distinct run receipts and distinct proposal identities, not capture rows, after authenticating every
capture-level admission evaluation.

The genuine local player adapter measures execution ancestry at run start. It derives the Git root
from the executing module, resolves the exact commit, requires a clean checkout including untracked
files, hashes the actual dependency lock and Node executable, and retains the fixed candidate
configuration plus a generated digest manifest of every tracked application source file captured
when the candidate process loaded. Container identity is recorded as unverified unless a separately
authenticated boundary supplies it; the adapter does not infer non-containerization. It does not accept an
operator-authored checkout, commit, artifact set or clean-worktree claim. It rechecks the same commit,
clean status, lock hash and loaded source hashes after retention; a dirty checkout, changed lock,
stale loaded process or unstable file fails before model-run authorization.

The genuine player request adapter accepts only a request ID and its current claim. It loads the
already-bound model operation from PostgreSQL and derives the player dataset, admission, protocol,
factual output and HPN calculation from that immutable record. There is no CLI argument for selecting
or overriding those targets.

For the issue 574 genuine diagnostic, preserve the real 2026 capture/recording timestamps and select
`retrospective_as_captured_at_dataset_creation`; do not backdate evidence to make the historical rows
look point-in-time. The exact five rows are Adam Saad/Carlton 2021 and Jeremy Cameron/Geelong 2021
(`train`), Jordan Dawson/Adelaide 2022 (`calibration`), Josh Dunkley/Brisbane 2023 (`validation`), and
Brodie Grundy/Sydney 2024 (`final_test`). Use the first five home-and-away appearances after the
transfer as the feature window and the remaining home-and-away appearances that season as the target
window. Register the scalar exactly as `0.05 * games + 0.08 * goals + 0.01 * Brownlow votes + 0.01 *
coaches votes`; verify goals conserve to match rows, Brownlow votes sum to six per match and scoped
AFLCA votes sum to 30 per matched match. Every one of the four scalar feature metrics must be present
as authenticated measured or conservation-derived evidence; omission is not zero. Where unrelated
AFLCA recipients remain unresolved, preserve every positive source-native recipient row in the
content-addressed conservation input. Derive a selected player's zero only after those resolved and
unresolved positive rows exactly conserve both club goal totals, six Brownlow votes and 30 AFLCA
votes for the match; a caller-asserted completeness certificate is not evidence.
Treat the result only as a private execution/replay
diagnostic: five selected transfers and a single validation row do not support population, historical
backtest, Gate 3, production or publication claims.

Run the positive migrated tracer only against a disposable loopback `statly_outcomes_test` database
that already contains the genuine bound operation. Supply its active claim custody through the
`AFL_GENUINE_ADMITTED_PLAYER_DATABASE_URL`, `AFL_GENUINE_ADMITTED_PLAYER_REQUEST_ID`,
`AFL_GENUINE_ADMITTED_PLAYER_CLAIM_ID`, `AFL_GENUINE_ADMITTED_PLAYER_LEASE_TOKEN` and
`AFL_GENUINE_ADMITTED_PLAYER_ARTIFACT_ROOT` environment variables, then run:

```sh
npx vitest run --config vitest.config.outcomes-int.ts \
  tests/outcomes-integration/afl-genuine-admitted-player-provisioned-postgres.test.ts \
  --coverage.enabled=false
```

Obtain the claim values from the running local coordinator that owns a fresh request with no retained
player component; do not recover or copy lease tokens from database or log files. The tracer fails
closed unless migration `0090` is present, executes the component once, repeats the same request, and
proves the second result is the same retained run without a second native execution. With none of the
provisioned values it is skipped; a partial configuration fails, and neither case is replaced by
fixture data.

The retained issue 574 proof used request
`private-valuation-dispatch:90879942135e996b4e3f08ad1be825dd3f5dc633ccab88b03585a3cc6f8e3b7c`,
operation
`private-valuation-model-operation:c71662b13d1d2682d33b8d4c65877f1087f99078423fa9903138713e0b4b8144`,
dataset `dataset:01948eb2e5da047017f0d862c474a40eddefa5344568989a79b8748de02ad62a`,
admission
`dataset-admission:e2d4113118567e1f3f4674eef0a6909779368b61ff4ef691f43573d2a526ca90`
and protocol `model-protocol:25e1fb6fa2edd333000aa2461fa6153068d548bdf23473331059ab16601a693e`.
Clean commit `43bb49e57f9120d77b7b36a6df92fefbf195dd9e`, Node runtime attestation and seed 574 produced native
run `model-run:fafb4db94aa683924aa6f9ff3efc4bcbaee4d537861e3a7e925c0c0aedbdb2c5` and player component
`model-run:02c9bdd6b41a00028f41d0831adfe5606f97767a0bac3a7263fadcaeb1f56033`.
The tracer then observed exactly one native run and one component after replay. Validation improved
both MAE and RMSE by 77.3651% on its one comparable validation row; final test improved both by
90.9550% on its one row, which was inside the calibrated 80% interval. Record these values as a
bounded execution diagnostic, not as model-quality or population evidence. HPN and pick remained
`not_executed`; qualification, pair selection, Gate 3, activation and publication remained absent.

To request the same coordinator ad hoc, supply a stable operation key that can be reused after process
or response loss:

```sh
npm run outcomes:valuation:run-local -- \
  --scope 'afl-men:<year>-trades' \
  --operation '<stable-incident-or-recalculation-key>'
```

The command is backend-only and fails closed unless the database is loopback PostgreSQL named exactly
`statly_outcomes_test`. Reusing the operation key returns or completes the exact retained request; do
not substitute a random key merely because the first command lost its response.

Changed factual evidence now runs through the shared recalculation coordinator's model-evidence and
prepared-cohort stages before batch execution. If exact construction dependencies have not been
supplied, the runtime throws `MISSING_CONSTRUCTION_CONFIGURATION` and does not execute a new batch
for that changed evidence. This is a configuration blocker, not a completed valuation. The CLI does
not yet assemble those genuine dependencies. Do not replace them with fixture admissions or inferred
scientific approvals. Unavailable evidence fails closed; substantive no-change retains the existing
batch reuse path.

For each cohort, verify the retained capture names the expected factual-release revision, model-pair
revision, prepared-v3 revision, and prior batch revision. Expected unavailable members remain explicit
batch entries. Ready members use durable work cycles with at most eight concurrent executions, a
three-attempt budget, fenced leases and heartbeats. `retry_pending` and `stale_authority` dispatches are
rescheduled rather than marked complete. An unexpected construction, custody, or programming failure
retains diagnostics and leaves the previous current batch unchanged. No individual generation becomes
visible while the batch is being built.

After a cause has been corrected, open a fresh three-attempt repair cycle with a stable repair ID and
reason, then route it through a new ad-hoc request key. Reuse that new key only when recovering from a
lost response; the exhausted request's original key continues to replay its retained terminal result:

```sh
npm run outcomes:valuation:run-local -- \
  --scope 'afl-men:<year>-trades' \
  --operation '<new-stable-recalculation-key>' \
  --repair-reason '<bounded backend incident reason>' \
  --repair-operation 'cohort-execution-repair:<64-hex-digest>'
```

Repair does not weaken or refresh factual/model authority. The immutable prior terminal cycle remains
available, and replay of the repair operation returns the same retained cycle.

Emergency withdrawal and rollback are backend governance operations, not user controls. Individual
withdrawal appends exact batch, trade, generation, principal, and reason evidence; current reads for
that member become unavailable without falling back to another generation. Whole-batch rollback uses
the batch repository's fenced `rollback` transition and may target only a complete batch that was
previously active. It advances one batch pointer, retains the replaced transition, and never loops
through per-trade heads. Do not label activation of a never-current batch as rollback, edit a batch or
receipt, or use a factual/publication rollback as private calculation authority.

Verify an automatic run by checking:

1. one retained dispatch request and its terminal or rescheduled status;
2. one cohort capture and execution cycle for the exact authority revisions;
3. one work row per ready trade, contiguous attempts, and retained causes for unavailable or exhausted
   work;
4. exhaustive batch membership and counts equal to the prepared-v3 trade set;
5. one current-batch transition and revision, with unchanged replay creating no additional generation,
   batch, or lifecycle receipt;
6. archive summary, detail, internal reader API, and exact JSON artifacts authenticate under the same
   generation and projection manifest for each current ready member; and
7. unavailable grades render as `—` while detailed blocker, retry, and diagnostic causes remain in
   backend evidence.

The implemented operating path remains local, private, non-production, and publication-prohibited.
Pure tests prove deterministic two-, three-, and four-club construction and the eight-worker pool
bound. Migrated disposable PostgreSQL tests separately prove ready-generation staging/replay, atomic
visibility, pinned reads, withdrawal/rollback, unavailable isolation, and exhaustive registration plus
unchanged replay of a 783-member blocked cohort. The multi-club PostgreSQL fixture exercises persisted
batch/read behavior over retained projection bytes; it is not an end-to-end production construction
run. These fixtures are not real AFL calibration evidence. A real admitted source/model/prepared
cohort, a complete scheduled source-to-prepared pipeline, hosted operations, registered-reader access,
and publication Gates remain outside this proof.

### Rehearsing fixture-only valuation publication

Run this only as part of the same disposable outcomes command:

```sh
npm run test:outcomes:int
```

Docker must be available. For a strictly offline run, confirm `postgres:16-alpine` is already present;
the rehearsal itself makes no provider request. Do not set an outcomes URL manually, load a checkout
`.env`, run `test:outcomes:int:provisioned`, or substitute shared PostgreSQL. The harness creates one
loopback-only container, passes its exact immutable container ID and generated database URL through an
allowlisted test environment, creates a unique schema, and removes the container after success or
failure. The provisioned command is reserved for controlled CI that already owns its disposable
service.

The local seed generates 783 deterministic factual archive trades across 1988–2025. Exactly one is
the source-shaped `2025 Draft Pick Exchange: GWS and Western Bulldogs` rehearsal trade; the other 782
are explicitly named synthetic local trades and exist only to exercise realistic archive volume. The
workbook is not read, copied or authorized by this seed. Both captured batches, all reviewed
identities and the fixture rights record use provider `statly_local_fixture` and `fixture://statly/`
references. The live provider-ingestion command rejects this provider, so these rows cannot be
mistaken for captured Draftguru or official-AFL facts.

The valuation test must prove this sequence:

1. Seed the deterministic 783-trade `test_fixture` factual archive and authenticate its exact active
   factual release, candidate, projection, governed trade, identity, match, and acquisition-spell
   ancestry. Verify 38 years, 21 trades in 2025, 20 trades in 1988, and 783 trades in total.
2. Fabricate baseline and replacement value evidence for only the governed archive trade. Mark every
   artifact `productionEligible: false`, `liveSourceAccessed: false`, and
   `providerRightsExpanded: false`.
3. Persist the value inventories, custody receipts and indexes; register and validate the sealed
   publication/projection pairs; and record fixture-only Gate 4 and Gate 5 decisions that pin those
   exact identifiers in `test_fixture`.
4. Activate baseline, activate replacement, republish the still-eligible superseded baseline as the
   explicit rollback, withdraw baseline to the original empty value scope, and recover replacement.
   Never infer fallback selection. Never attempt to republish a withdrawn publication.
5. Confirm the factual registry state is unchanged at every valuation transition. Direct list/detail
   reads, `/api/draft-trades/valuations`, `/api/draft-trades/[tradeId]/valuation`, projection exports,
   and `/draft/trades/[tradeId]` must all identify the recovered replacement publication and
   projection under `public-afl-trades-current`. A mixed request containing the governed trade and an
   archive-only synthetic trade must preserve the governed value while returning `not_calculated`
   with `trade-not-in-active-projection` for the synthetic member. The synthetic detail API and page
   must render the same unavailable state rather than fail or borrow a value. An unknown trade ID
   must retain `TRADE_NOT_IN_PROJECTION`; the fallback is valid only for a member of the active
   governed factual archive.
6. Create a custom-format schema dump with the container's PostgreSQL tools, close the pool, destroy
   the generated schema, prove it is absent, and restore it with `pg_restore --single-transaction`.
   Fresh repositories must authenticate both registries and reproduce the complete archive detail,
   value-service responses, API data, archive-page inputs, and export rows observed before destruction.
   Ignore only the outer API wrapper's new wall-clock response timestamp.
7. Withdraw the restored replacement. The value selector must return `selection: none`, values must
   return the honest `not_calculated` state, and the factual release must remain exactly active and
   unchanged.

The checkpoint is valid only when the complete disposable PostgreSQL suite passes and Docker removes
the owned container. Retain the exact commit and final test summary; do not retain the temporary dump,
schema, database credentials, generated Prisma output, or artifact bytes as release evidence.

This procedure grants no Draftguru permission. Public factual-display authority is not
`model_training` or `derived_feature_creation` authority, and fixture Gate decisions cannot satisfy a
non-production or production gate. Do not add real Draftguru data, source credentials, live fitzRoy
capture, AWS, hosted storage, a shared database, billable infrastructure, a deployed runtime, or a
production pointer to make this test pass. If the sealed factual ancestry, fixture-only gate scope,
projection/publication identity, dump/restore equality, or no-fallback withdrawal check fails, stop
and repair that local boundary. Real capture, a rights-approved factual valuation dataset, model
validation, hosted deployment, and production activation remain separate later procedures.

For interactive inspection after the disposable proof passes, start the complete local stack:

```sh
npm run dev:full:all
```

The launcher owns loopback PostgreSQL on port `55432`, stores projection envelopes below ignored
`.statly-local/afl-trade-artifacts`, runs the factual seed and valuation lifecycle before Next.js, and
prints the active factual release, 783-trade count, governed trade, recovered valuation publication,
and replay status. The database process holds a mode-`0600`, ignored nonce handoff under
`.statly-local/` only while it is running; the seed authenticates that nonce and the fixed loopback
target before any write. It must not export AWS or source credentials. In another terminal:

```sh
curl -fsS 'http://localhost:3000/api/draft-trades?year=2025'
curl -fsS 'http://localhost:3000/api/draft-trades?year=1988'
curl -fsS 'http://localhost:3000/api/draft-trades/methodology'
```

From 2025, take the `tradeId` whose title is
`2025 Draft Pick Exchange: GWS and Western Bulldogs`, set `TRADE_ID` to that exact value, and inspect
the publication list:

```sh
TRADE_ID='<tradeId returned above>'
curl -fsS -G 'http://localhost:3000/api/draft-trades/valuations' \
  --data-urlencode "tradeId=$TRADE_ID" \
  --data-urlencode 'view=current' \
  --data-urlencode 'limit=1'
```

Then inspect `/draft/trades/<tradeId>`,
`/api/draft-trades/<tradeId>/valuation`, `/api/draft-trades/<tradeId>/export`, and
`/api/draft-trades/export?year=2025`. The value list, value detail, methodology, and page must resolve
the recovered publication/projection pair; factual detail and both CSV exports must resolve that same
trade and factual archive. Re-run `npm run dev:outcomes:seed` while PostgreSQL remains up. It must
report `783 archived trades` and `Verified` for both factual and valuation state and must not append a
new active identity. Also open a 1988 synthetic trade and verify its factual detail renders while its
valuation API and page report `not_calculated` under the same active publication.

The interactive state intentionally ends with replacement active so it can be inspected. Rollback and
withdrawal proof comes from the immediately preceding seed lifecycle and the disposable integration
test: replacement to baseline, baseline withdrawal to `selection: none`, and replacement recovery,
with the factual pointer unchanged at every transition. Do not manually rewrite registry tables to
demonstrate those states. Stop the launcher normally; local bytes are disposable and recoverable only
as local development state, not as release evidence.

### Reviewing provider identities and matches

This workflow is a governed database boundary, not a spreadsheet correction or rendering-layer alias.
It remains dormant in production until operational principals, retained evidence, namespace approvals,
and the protected review interface are provisioned and independently authorized.

1. Select the exact finalized candidate occurrence and verify its normalization run, approved field
   map, source-row digest, candidate digest, competition, season and current provider namespace. Never
   select a canonical target from display-name similarity alone.
2. Register the immutable review method, target snapshot, supporting evidence, reviewer-authority
   evidence, alias policy and normalization policy through the governed evidence registry. Confirm
   every reference has retained non-raw custody and a current approval in the execution environment.
   The registered digest must equal both the SHA-256 of the exact canonical JSON payload and the
   retained artifact digest; the payload must not embed its own digest or artifact identifier.
   Production registration must run as the isolated `afl_trade_governance_registry_writer` database
   role; non-production uses `afl_trade_nonproduction_governance_registry_writer`. Neither role is the
   identity-resolution application writer, and role membership is provisioned outside migrations.
3. Authenticate the operational principal outside the request body. Confirm its current role and
   competition/season/capability scope cover the proposal; a caller-supplied reviewer role is not
   authority.
4. Reconcile the complete blocking-issue set. Every blocking issue requires its own current approved
   closure decision. Unrelated approvals, omitted issues and superseded closures fail the decision.
   Namespace approvals are environment-bound and must be committed by the same isolated governance
   registry roles used above. Production issue decisions require the separately provisioned
   `afl_trade_identity_issue_reviewer` database role; non-production uses
   `afl_trade_nonproduction_identity_issue_reviewer`. These roles are not granted to the identity
   resolution application writer. Fixture-only decisions remain confined to disposable test custody.
5. For a player or club, approve only an already-reviewed canonical target or create the exact
   provider-native identity root authorized by the namespace. A name-only player may remain a
   candidate but cannot become a reusable provider identity.
6. For a match, verify competition, season, round, UTC date and both clubs against the staged fixture.
   Both club references must point to current approved resolution decisions and current active
   provider assignments. Home/away ordering is display context; the fixture identity is
   order-independent.
7. Commit the typed resolution, review decision, reusable assignment and occurrence in one
   transaction under the deterministic case, assignment, namespace, evidence and issue locks. Advance
   only gap-free compare-and-swap heads. An exact retry is idempotent; a conflicting retry is an
   incident. Keep the application and PostgreSQL clocks synchronized. The database admits at most
   five seconds of positive clock skew for an external-identity subject creation instant or review
   decision instant; this tolerance covers ordinary distributed-runtime drift only. A timestamp more
   than five seconds ahead of the relevant database clock fails the transaction, while completion
   chronology, supersession order, authority validity and every canonical evidence binding remain
   exact.
8. To correct or withdraw a result, append one decision that supersedes the sole current leaf. Never
   edit an identity root, occurrence, proposal, closure or historical decision. Confirm the reusable
   assignment head is inactive when a mapping is withdrawn. A remap is deliberately two-step: first
   append the old target's deactivation, then append the new target's activation. The database rejects
   a target switch while the predecessor assignment remains active.
9. Keep rejected, ambiguous, incomplete and stale cases quarantined. Resolution does not create
   player-match observations, calculate games/goals, publish a release or alter fantasy state.

### Promoting private facts and acquisition-spell outcomes

This workflow produces private, reviewed factual inputs. It does not activate a factual release and
must remain dormant for a real provider until its capture, custody, rights, identity-review, and
operational-role gates are satisfied.

1. Select exactly one finalized normalization run and its immutable field map, decoded-row set,
   candidate set, issue set, and finalization receipt. Lock the run scope before promotion. A parser or
   normalizer change requires a new run; never reinterpret a finalized run in place.
2. Create an open source-fact batch and account for every decoded row exactly once. Bind normalized
   rows to their exact facts and non-normalized rows to their explicit unresolved, conflicting,
   quarantined, not-applicable, or rejected disposition. Every edit-9 issue is blocking in version one
   and requires its exact current closure decision before the row can be accepted.
3. Promote match-universe, observed player-appearance, numeric metric, and achievement candidates into
   separate immutable fact tables. Verify the exact current player, match, represented-club and
   match-side resolution decisions plus active reusable assignments. Candidate-only identities and
   name-only matches remain quarantined. No fact may contain fantasy ownership.
4. Preserve source meaning. A measured zero is valid evidence; missing, quarantined and not-applicable
   states carry no value. Reject provider-supplied `games`: it is not a source metric. Do not infer a
   non-appearance, zero vote, nomination, award, or season achievement from an absent row.
5. Finalize the source-fact batch only after its row, fact, issue, closure and digest counts reconcile
   exactly and all children are immutable. An exact retry returns the same batch. Any later child,
   changed digest, incomplete row set or conflicting retry is an incident.
6. Select a current approved factual-reconciliation policy for the exact environment, competition,
   season, metric definitions, capability set and provider-priority tiers. Reconcile exact source
   inputs; never use provider order as an unstated tiebreak. Same-priority measured disagreements
   remain `conflicting`, and missing or quarantined evidence cannot improve coverage.
7. Derive one match-grain `games = 1` fact only when a reconciled completed match and the same resolved
   player’s observed appearance agree. Scheduled, abandoned, cancelled, unknown, missing or unresolved
   matches do not create a game. Persist every source membership and advance each factual subject head
   with the expected revision.
8. For each approved real-club acquisition spell, select one governed spell-metric policy and the exact
   current reconciled match facts for the same player, club, metric definition and half-open spell
   interval. Record numerator, denominator, observation count and effective-through date. Label partial
   coverage; withhold conflicting or quarantined values. Keep round-, event- and season-grain
   achievements separate rather than summing them into numeric spell metrics.
9. Finalize the reconciliation and spell-metric batches only when results, memberships, finalization
   evidence and current CAS heads reconcile. Confirm no release, projection, valuation, grade,
   Firestore, fantasy user, league, team or roster row changed. Publication starts only through the
   separate factual-release procedure below.

For complete-season reconciliation, measure receipt construction and persistence before execution.
Migration `0139_canonical_text_reconciliation_receipt` allows the exact complete canonical wrapper in
text with a separately authenticated wrapper checksum, preserving legacy JSONB receipts. Use the
existing reconciliation owner for persistence and exact replay; do not cast a large receipt back to
JSONB or split an authoritative season run merely to avoid the JSONB container limit. The HPN input
owner consumes one run's normalized match and appearance memberships. Validate heap, database, WAL,
backup and disk-reserve bounds independently; a successful source-batch run does not prove capacity
for its larger reconciliation receipt and game-to-match evidence membership set. The owner writes
bounded UTF-8 chunks into a newly allocated transaction-owned large object, converts its bytes to
uncompressed temporary text, and unlinks it before the permanent checksum-guarded insert or exact
replay comparison. Budget the overlapping large object and temporary text, large-object WAL/catalog
writes, and full-value conversion allocations for both persistence and replay. Rollback removes a
failed transfer's large-object creation; verify no transfer objects remain after successful calls.
A scalar receipt capacity probe must cover insertion, an update, exact comparison and checksum
readback; passing it does not certify the complete normalized membership transaction.

Migration `0140_reconciled_match_metric_appearance_scope` validates match-metric club membership through
the exact linked appearance, preserving the source's `appearance_fact` storage and the reconciled
result's resolved club. Before retrying a membership rejection, verify that linkage and its retained
player, match and represented-club evidence; do not populate empty direct source club columns or
rewrite accepted facts. Season-metric scope checks and derived-games participation rules remain
separate. After a failed transaction, authenticate rollback and a verified recovery backup before a
fresh reviewed attempt.

Local contract verification:

```sh
Rscript --vanilla etl/afl-trade-intelligence/test_decode_contract.R
npm run test:unit -- tests/unit/afl-trade-intelligence-fitzroy-observations.test.ts
npm run test:unit -- tests/unit/afl-trade-intelligence-factual-observation-contracts.test.ts
npm run test:unit -- tests/unit/afl-trade-intelligence-factual-reconciliation-contracts.test.ts
npm run test:unit -- tests/unit/afl-trade-intelligence-acquisition-spell-metrics.test.ts
npm run outcomes:prisma:validate
```

### Historical shadow reconciliation and source cutover

Run this procedure once for the supported history, then repeat it for material parser/source changes:

1. Capture and stage the complete bounded Draftguru, Footywire and official AFL history and the
   supported fitzRoy corroboration/outcome ranges. Freeze the parser, field-manifest and raw-object
   digests used by the run.
2. Reconstruct transactions, directed packages, entitlement custody, draft order, final selections and
   player acquisitions in PostgreSQL. Compare the sourced result with the frozen workbook baseline,
   but never copy a workbook value merely to make the comparison pass.
3. Reconcile by season, mechanism, event, party, directed asset, entitlement, selection and stable
   lineage. Record both aggregate counts and exact row-level deltas. Page disappearance in a later crawl
   does not delete a fact.
4. Exit shadow only with 100% source-row accounting, zero unexplained P0/P1 deltas, no name-only merge,
   no unbalanced transaction and no unresolved lineage on a release-eligible trade. Freeze the report
   and exception dispositions as release evidence.
5. Rehearse factual activation, withdrawal and recovery from the sourced candidate. Confirm the public
   site and APIs do not read a workbook or Firestore fallback. Then execute the workbook-retirement
   checklist above.

The normal recurring process after cutover is capture → immutable custody → provider staging →
field-level reconciliation → reviewed factual candidate → atomic release. It never regenerates sheets.

## Publishing a factual outcome release

A factual candidate is independent from a valuation candidate. It may publish governed descriptive
outcomes without approving a model, and its approval cannot activate valuation.

1. Capture the current factual pointer and registry revision. Build an
   `afl-trade-factual-release-candidate/v3` that embeds its exact
   `afl-draft-trade-outcome-release/v2` target manifest. Pin the archive dataset, immutable source
   objects, finalized factual and achievement reconciliation runs, current reconciled metric and
   achievement heads, acquisition-spell metric heads, identity and lineage decisions, metric registry,
   acquisition-spell rule, exception dispositions, effective-through time, and source-member root.
2. Verify source rights remain effective for public fact display and every public API/view field.
   Withdrawal, expiry, or a narrower current decision blocks the candidate.
3. Re-run structural, field, identity, lineage, acquisition-spell, null-versus-zero, aggregate, and
   release-completeness checks from the immutable inputs. Reviewers must see unresolved and quarantined
   evidence; do not calculate coverage only from accepted rows.
4. Under the `outcome-release-membership:<releaseId>` transaction lock, stage or verify the embedded
   release-v2 manifest, write all sorted typed members, and finalize the candidate. Finalization must
   reject a non-current head, post-cutoff fact, incomplete count, raw provider achievement, legacy
   stat/identity/reconciliation member, or concurrent late member. It does not register or activate the
   release.
5. Generate candidate list, trade-detail, club, player, year and dashboard views under the
   candidate release identifier. No active/public query may select them yet. Build a projection-v2 that
   names the candidate and its private `sourceMemberSetSha256`. Canonicalize and atomically stage every
   searchable list row, then finalize the complete ordered membership as
   `publicListItemSetSha256`; the database must recompute that root, exact count, per-row digest, and
   denormalized index parity and must reject later rows. Separately hash the complete public rows,
   views, and files as `logicalDatasetSha256`, and authenticate all three roots in the derivation
   binding.
6. Reconcile representative and total counts across normalized tables, release views and JSON APIs.
   Confirm each output identifies the same release and effective-through date. The retired workbook's
   `Expected`, `Actual` and grade cells are absent from public and model contracts.
   Recompute the private member root, searchable list-row root, and complete public dataset root from
   their respective persisted members or output bytes. Equal counts are not parity, and none of these
   roots is expected to equal another.
7. Exercise measured zero, missing, partial, unresolved identity, unresolved lineage, unsupported
   metric, stale, withdrawn, source-object failure, and release-mismatch cases. The public contract must
   distinguish each without fabricating a value or falling back to the workbook or Firestore default
   collections.
8. Register the release under the same membership lock. Registration must insert-or-verify the staged
   manifest, require one exact finalized candidate, and reject candidate-backed release v1 or mixed
   release/projection versions. Validate, approve, and activate must also require the exact factual
   projection item set to have been finalized before the event. An exact candidate retry after
   registration must return the stored receipt without adding members or events.
9. Obtain the exact Gate 4 factual/API review and Gate 5 comprehension/accessibility decisions, each
   pinning the candidate release and projection. Separately obtain the operational activation
   authorization. Record reviewers, authority evidence, target environment and scope, release and
   projection identifiers, parity-report identifier, expected registry revision, authorization expiry,
   rollback window, and engaged write barrier.
10. Engage the factual write barrier, repeat the declared parity checkpoint, and use expected-revision
    compare-and-swap to activate the candidate once. A concurrent winner requires fresh capture and
    review; never force the pointer.
11. Confirm representative public reads and generated downloads resolve the activated release. Public
    list reads must use signed, projection-and-query-bound keyset cursors, indexed PostgreSQL filters,
    and per-row canonical digest checks; they must not re-hash the full projection for every page.
    Record
    cache/projection invalidation and monitor errors, latency, release mismatches, and exception counts
    through the observation window.
12. Preserve the previous factual release and immutable evidence for the authorized rollback and
    retention periods. Confirm the public archive reader cannot select the legacy Firestore pointer;
    retain or delete legacy collections only through their separately reviewed retention plan.

The public site reads reviewed PostgreSQL release views, optionally through a release-bound cache. It
never reads staging, exceptions, raw object bytes, a candidate release, or a mutable spreadsheet.

Stop before the first provider-backed build if Gate 0A, field-use approval, durable object custody,
hosted PostgreSQL readiness, reviewer authority, or rollback evidence is absent. Stop before
registration if the candidate is not finalized or either root cannot be reproduced. Stop before
activation if the projection uses v1 for a candidate-backed release, the source root differs, the
public root or derivation digest differs, a right or review has expired, or the expected revision has
advanced. Fixture and disposable-database success supplies no production authority.

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
The public selector must load the current Gate 0A ledger and evaluate the bound rights at its serving
timestamp; activation is never a permanent rights cache. The PostgreSQL adapter preserves one
global expected-revision chain with an explicit row lock and compare-and-swap in a read-committed
transaction, retains multiple immutable projection
versions for fresh superseded-release validation, commits every affected record state, and changes the
active pointer with the same transaction. Its schema-only validation and generation scripts use an
inert URL; only the explicitly named migration command may target configured infrastructure. Running
the pure fixture state machine or synthetic adapter tests is not activation. Keep the runtime in
explicit `disabled` mode until the migration is rehearsed on a disposable target and real decisions,
target approval, restore evidence, and production verification are approved. Once configured,
PostgreSQL mode still serves nothing until an exact factual or valuation pointer is active.

## Admitting a factual valuation dataset

This procedure creates private model-input evidence only. It cannot publish a value or grade.

1. Select one finalized factual candidate and its exact release-v2 manifest, private member-set root,
   current content-addressed release record-state and approval event, archive dataset, source-snapshot
   set, metric registry and acquisition-spell rule. Reject legacy release/dataset records and any
   superseded, withdrawn or unfinalized candidate. The approval event must be the latest approval after
   the current validation event and must name the record head's current factual-review decision. Public
   activation is not required. Require the candidate's recorded creation time to equal its canonical
   finalization time; reject a claimed seal that predates or postdates the candidate bytes.
2. Resolve the governed corpus-to-factual-candidate lineage commitment, then require a current Gate 2
   decision that pins the exact corpus, lineage commitment, factual release and factual candidate. Gate
   2 must not name the future dataset. Do not infer ancestry from dates, counts, names or provider labels.
3. Pre-register the dataset-v4/player-row-v3 specification: stable player/acquisition-spell row
   grain, prediction cutoff, target horizon and maturity, value unit, role/era/censoring policies,
   chronological train/calibration/validation/final-test windows, embargo, exact
   player/event/acquisition-spell leakage groups, and one knowledge-join policy. Use
   `point_in_time_as_known_by_prediction_cutoff` for an original-vintage backtest. Use
   `retrospective_as_captured_at_dataset_creation` only for an explicitly labelled current
   retrospective diagnostic; retain the real late knowledge timestamps and never claim historical
   availability. Dataset v4/row v3 does not admit draft-pick rows.
4. Under the evidence authenticator's transactionally consistent read, load every exact typed factual
   member, current player/club identity assignment, event/acquisition-spell/lineage version, and retained
   dataset, exclusion, extractor, configuration, feature, target, value-unit, role, era, censoring and
   inclusion-policy artifact. Member IDs and record digests are independent and both must match the
   sealed factual candidate; do not reinterpret the v3 record digest as a newly invented JSON hash.
   Authenticate canonical provider-resolution decisions and exact current resolution/assignment heads;
   require their environment, scope, competition, season, native-ID namespace and temporal-alias range
   to cover the row. Then derive the complete event-to-spell-to-edge mapping from authenticated
   candidate member joins. One event may map to multiple spells, but every event/spell pair and every
   referenced edge must be represented exactly once.
   Verify every artifact's exact media type, length, digest and creation time; the dataset bytes must be
   the canonical ordered row set. Quarantine rather than coerce unresolved, conflicting, or missing
   evidence. Exclude round-grain achievements and reconciled metrics until their exact grain and
   match/valid time are represented.
5. Materialize rows in unique stable-row-key order with contiguous ordinals. Carry effective-from/
   through time separately from recorded-at knowledge time. Under the point-in-time policy, reject a
   feature known after its cutoff or prior-partition labels not known before the next prediction origin
   plus embargo. Under the retrospective policy, require all feature knowledge no later than the
   canonical dataset creation instant and retain the late timestamps unchanged. Under either policy,
   reject a feature reused as its own target, a target outside the future valid-time window, or a
   leakage group in multiple partitions. The three leakage values must equal the row's stable
   acquisition-spell subject, stable event subject, and player IDs; exact spell/event version IDs
   remain provenance and must not split revisions of one subject across partitions. Never accept
   producer-defined aliases.
6. For every source capture in the sealed factual candidate, authenticate its unique content-addressed
   consumed-field set and exact corpus source mapping. Recompute the field-set root and require the Gate
   0A requests to equal the complete field/use preimage. Load the exact retained source-snapshot manifest
   and require its captured-field set to equal the conservative v1 consumed-field set; never key this
   check only by source snapshot or trust the candidate's digest without its preimage.
   Require a Gate 0A evaluation for both `model_training` and `derived_feature_creation` before feature
   extraction and a second fresh evaluation at the exact admission instant. Terms expiry is exclusive;
   public factual-display approval is insufficient.
7. Require content-addressed analytical-authority and operational-authorization receipts for the exact
   `materialize_feature_dataset` command before dataset creation, and require both to remain current at
   admission. Emit the `afl-trade-dataset-admission/v3` receipt only after the
   authenticator, canonical Gate 2 resolver, Gate 0A evaluator, membership closure, byte verification,
   and authority checks all pass. The receipt binds the dataset to Gate 2; Gate 2 does not bind the dataset.
8. Before any model run, create one content-addressed executable intent for the exact registered
   protocol, admitted dataset and sealed observation set. Re-evaluate modelling rights at the intent's
   database start time; authenticate current Gate 2, both Gate 0A evaluation generations, analytical
   authority, every factual metric body and every retained dataset/protocol/runtime artifact byte.
   Admission does not survive expiry or withdrawal. Record a separate human operational receipt for
   `execute_model_run` that names this exact intent, dataset, admission, protocol and observation set;
   never reuse the dataset-materialization receipt or carry one receipt into another attempt. The
   receipt must reference an already retained, currently approved governed operator-authority evidence
   record covering the exact environment, scope, competition, seasons and principal. Provision and
   approve that authority through the isolated governance registry; the model-run writer must not mint
   or approve its own operator authority.
9. Issue the short-lived run authorization using database time. PostgreSQL must recheck the exact four
   Gate 2 lineage artifacts, the complete admitted source-rights proposal set, current Gate 0A receipts,
   exact run-start request and model-training field-use parity, exclusive rights/revalidation expiry,
   current analytical authority and the unexpired governed human operational receipt, then report exactly one
   new authorization for the intent. An exact retry may inspect the stored record but must not issue a
   second authorization. Consume it atomically immediately before starting the executor; a zero-row
   consumption means the job has lost authority and must stop without fitting.
10. Persist the completed run before reporting success. The run is immutable and must bind the exact
    intent and authorization. If fitting completes but run persistence fails, record an operational
    incident and reconcile the immutable failed run; never execute that intent again. Any retry uses a
    new job attempt, new content-addressed intent and new human operational receipt.

The PostgreSQL/object-storage model-run authority adapter and append-only persistence schema are
implemented, but the runtime is still private and unmounted. Stop if retained bytes, current
release/event evidence, Gate ledgers, source-rights artifacts, fresh Gate 0A receipts, current
analytical authority, or human operational authorization are missing. The authority path does not fit
a model or supply Gate 3 model-validity evidence. Do not claim a real model, numerical grade or
valuation publication until an executor has produced an immutable run and the later independent gates
have approved its exact artifacts.

## Building pick values and complete trade assessments

### Registering the HPN reference benchmark

HPN Draft Pick Value Chart v3 is an attributed external benchmark, not a recurring scrape and not the
Statly production model:

1. Create one immutable versioned artifact containing source URL, retrieval date, captured-source
   digest, attribution, cohort (`1993–2006`, father-son excluded), supported national-draft selection
   range `1..90`, value unit `career_pav`, reported fit metadata and the exact formula
   `careerPav(p) = -30.36 * ln(p) + 146.95`.
2. Verify fixed literals such as pick 12 `71.51`, pick 14 `66.83` and pick 37 `37.32` within the declared
   rounding tolerance. Do not interpret reported R² as row-level confidence or construct an invented
   residual distribution.
3. Reject rookie, pre-season, mid-season, mini-draft, future-position-unknown and out-of-range inputs.
   Do not extrapolate. Do not mix `career_pav` with Statly contribution units inside a package sum.
4. Compare the benchmark with the training-only Statly monotone baseline and the fitted pathway model.
   Record differences and sensitivity; HPN never supplies training labels, final grades or current
   realized outcomes.

### Fitting the Statly pick model

1. Build independent datasets for national, rookie, pre-season, mid-season and other supported
   pathways. Use actual selection identity and point-in-time facts; never pool pathways merely to meet
   sample size.
2. Fit a non-increasing training-only current-pick distribution at exact selection number, with
   governed minimum support and no unsupported extrapolation. Freeze train/calibration/validation/final
   test windows chronologically and keep the final test untouched by tuning.
3. Convert player and pick outcomes to one governed Statly value unit before addition. A display layer
   may show the HPN PAV benchmark beside Statly output, but it must label the units separately.
4. For a future pick, estimate the contemporaneous joint distribution of eventual selection position
   from information available at the trade cutoff, then integrate the position-conditioned pick-value
   distribution. Preserve uncertainty and cross-asset dependence; do not substitute a fixed nominal
   pick or use the realized ladder position retrospectively.
5. Publish no pick value when pathway, entitlement lineage, draft year, original club, position support
   or value-unit conversion is unresolved. Record coverage and reason codes rather than applying a
   cross-pathway fallback.

### Calculating a trade

For every party and every joint simulation draw, calculate the complete directed exchange:

- `packageReceived`: the common-unit value of all assets delivered to the party;
- `packageGivenUp`: the common-unit value of all assets delivered by the party to every other party;
- `estimatedAdvantage = packageReceived - packageGivenUp`; and
- `finishesAheadProbability`: the party's probability of having the highest advantage, with ties split
  across all tied leaders.

Require every asset in the transaction exactly once on a received side and once on a given-up side;
the sum of party advantages must be zero within numerical tolerance for every draw. Preserve joint
dependence for linked picks and multi-party pools. At-trade assessments use only information available
at the trade timestamp. Current assessments replace resolved components with observed contribution and
retain an explicitly modelled remaining distribution; they never rewrite the at-trade estimate.

The public summary must name the value unit, valuation date/knowledge cutoff, median and interval for
received, given up and advantage, coverage/confidence, the largest drivers, and unresolved components.
Use plain-language labels: “value received”, “value given up” and “estimated advantage”. A letter grade
is optional, secondary and unavailable when the numerical assessment is incomplete. The expanded view
must show each asset's at-trade value, realized contribution, remaining estimate, uncertainty and
lineage so a user can understand why the result moved.

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
5. Rehearse representative list, detail, methodology, and explicit valuation-API reads using one
   captured registry selection. Confirm publication, projection, scope, value unit, bundle, views,
   cohorts, exclusions, registry revision, document counts, item ordinals, and calculation/knowledge
   times match. Confirm no artifact or external source is read after mount.
6. Exercise current, stale, failed-candidate-retained, expired, source-error, malformed-release, and
   clock-regression cases. Expired or unavailable output must not serve, and moving a clock backward
   must not reactivate it. Restart or remount the serving process and confirm the PostgreSQL
   `outcome_projection_freshness_high_water` compare-and-set restores the durable monotonic minimum
   before freshness evaluation, so restart cannot reactivate an expired release.
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
coverage, factual pointer consistency, release-view/API parity, freshness, and cache release
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
2. Capture the exact source-object, import, exception, factual pointer, release-view, API projection,
   deployment, cache, health, and incident evidence before mutation.
3. Apply the factual registry's governed withdrawal command with the expected revision, authorized
   actor, evidence identifier, timestamp, affected scope, and reason.
4. Confirm affected factual API/UI responses are unavailable or explicitly partial and caches cannot
   serve the withdrawn release after the captured selection is invalidated.
5. Follow source-specific retention, deletion, or access-revocation duties without deleting the
   append-only decision and incident evidence that the rights decision permits Statly to retain.
6. Correct evidence through a new immutable source object, mapping/rule version, import run, exception
   review, and factual candidate. Never edit normalized facts or release projections in place.
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
- representative PostgreSQL release-view, JSON API, and responsive UI smoke
  evidence as applicable;
- operator, reviewer, and incident timestamps; and
- residual risks and follow-up owner.

Use disposable fixtures for rehearsal. Never point tests at `prisma/dev.db`, protected fantasy data, or
production public-outcomes data. A local build or fixture pass is not workbook provenance, upstream
permission, object-storage readiness, PostgreSQL readiness, factual release approval, deployment, Gate
approval, production health, or valuation publication evidence.

### Correcting admitted special-entitlement facts

Use the existing external canonical promotion repository for corrections. Retain the current full
revision through `loadSpecialEntitlementRevision`, prepare exact reviewed replacement evidence, and
obtain approvals for the proposed complete state through the existing scoped review boundary.
`previewSpecialEntitlementCustody` prepares canonical references only; it grants no write authority.

- For a correction under the same entitlement identity, call
  `promoteWithSpecialEntitlementRevisions` with the reviewed promotion and every affected complete
  revision. A standalone canonical correction must not strand an existing custody or exercise fact.
- When the issuing identity itself changes, use `replaceSpecialEntitlementIdentity` with the exact
  reviewed retirement/replacement relationship. A custody-bearing target requires the reviewed
  promotion and target revision approval. An unused award-only target uses its exact initial state
  and must not supply a promotion or fabricate a successor revision.
- On SQLSTATE `40001`, roll back the entire operation. After the competing transaction ends, reload
  current state and retry the operation if its reviewed inputs still apply. Do not retry individual
  statements inside a failed transaction or replace stale inputs without their required review.
- Rebuild factual corpus/release evidence through the existing owners. Check oldest-asset historical
  readback, replacement reservation ownership and selected-archive current-version behavior. Keep
  immutable source revisions and previously sealed archives; do not edit them to match current facts.
  Historical reads authenticate the actual live entitlement head, following current identity
  replacements even when they postdate the requested cutoff. Returned facts remain selected at the
  cutoff; later approval evidence must not be inserted into the historical snapshot. Baseline award
  approvals must also exist at or before that cutoff. Withdrawal of current authority still blocks
  reconstruction. Within a selected archive, a pick realization is hidden if either its trade event
  or its linked draft-selection event has a successor in that same archive.

Use a disposable `AFL_OUTCOMES_TEST_DATABASE_URL` for the canonical-promotion PostgreSQL test suite.
The day/year cases cover correction rollback/replay, reservation transfer, chained identities,
withdrawal, historical archive readback and identity/event lock contention. Fixture success does not
satisfy genuine source admission or scientific acceptance. Apply migrations and genuine writes only
under the existing reviewed target runbook and authorization, and record commit, push, PR/CI, merge,
main synchronization, deployment and admission outcomes separately.

### Preparing reviewed pick lineage

`reviewedPickLineage.ts` validates separately evidenced corrections against an exact retained
candidate. Preserve the scraped asset label alongside the accepted trade-time number and final
live number. Keep national and mini-draft selections distinct. A rookie elevation, passed pick,
unused pick or later package is a distinct endpoint; it must not manufacture a player acquisition.

Each onward movement carries connected holders, explicit predecessor order and the supported
instant, day or year. Supplementary movements outside the candidate require retained source bytes,
asset labels and row references. A year is an interval for consistency checking, never an invented
January 1 observation. Binding rejects contradictory dates, identities and source references.

Use `PostgresAflTradeExternalCanonicalPromotionRepository.previewReviewedPickLineage` to inspect
these records against a finalized candidate in the requested environment. The read-only preview
reports absent approved player identities and source artifacts without registered captures. Capture
presence is not current source authority. The preview always leaves admission and promotion
eligibility false and does not remove candidate issues. Complete scoped source registration,
identity review, partial-date persistence and authenticated promotion before claiming admission;
verify independent database restore and factual readback through the existing owners.

`createReviewedPickLineageRegistration` binds the candidate, environment, complete player endpoints,
ordered custody and evidence into an immutable approval subject. `reviewedPickLineageApprovalEvidence`
derives the exact payload for a future retained review; it does not issue or authenticate approval.
Migration0164 stores one immutable reviewed registration per retained candidate. The promotion owner's
`registerReviewedPickLineage` and `readReviewedPickLineage` authenticate the exact current review and
scoped promoter authority. Retries must match both content and decision; withdrawn reviews fail on
retry and readback. Changed facts require a new candidate rather than overwriting retained history.
Day/year precision and non-player endpoints remain in the approved JSON; candidate issues and
canonical custody are untouched. These methods explicitly report source authority and canonical
admission as false. Current source-permission checks, draft sessions, canonical promotion and archive
readback are still required before these reviewed records can support admitted facts.

`prepareReviewedPickLineagePromotion` loads the persisted registration through the promotion owner,
checks current review and candidate/capture source authority in the same transaction, and binds
ordered custody plus typed endpoints without replacing partial dates with timestamps. Its result
is preparation, not canonical admission or approval. Do not reuse a saved source check as authority;
canonical writes must repeat this binding inside their own transaction. Existing candidate issues,
special-right resolution and draft-session requirements remain until canonical integration completes.

Migration0165 extends canonical pick custody with `observed_date` (an exact day/year object) and
`predecessor_custody_id`. `observed_at` remains populated only for actual instants; exactly one date
representation is required. Deferred predecessor checks reject different picks, cycles and impossible
chronology while allowing explicitly ordered movements within the same year. Existing instant
uniqueness remains intact. Promotion writes and factual/archive readback preserve date precision and
predecessors; old records without predecessors retain their prior serialized shape. This storage
support does not resolve candidate issues, supply draft sessions or admit the genuine reviewed set.

Migration0166 adds typed non-player pick realizations: `passed`, `not_exercised`, and
`incorporated_into_later_package`. These require `terminal_outcome` and no draft-selection row;
`exercised_as` retains its selection reference. The candidate, canonical writer and archive preserve
this distinction. Database guards reject conflicting terminal/selected realizations for one transfer.
Draft-history reads exclude non-player outcomes from player selections and preserve partial-date
custody without inventing timestamps. Apply through the normal migration owner in an owned restored
checkpoint before genuine admission; fixture verification alone does not admit the reviewed73.

Reviewed admission scopes bind a retained expanded candidate to its original reviewed registration.
The scope keeps whole original trade transactions, exact selected endpoints, and all issues sharing
active evidence (including transitive links and issues with no evidence). Other evidence IDs are
explicitly deferred in the candidate JSON and still count toward source-row conservation. Existing
candidate persistence and promotion authenticate the scope against both stored candidates, the
current review and source authority; altered trade facts or removed relevant issues fail closed.
Scoping is a pre-correction operation: it does not resolve custody, special rights, rookie elevation
or session coverage and cannot turn a blocking reviewed issue into a promotion approval.

Migration0168 permits an unknown originating club on canonical custody observations. The observed
current holder remains mandatory and club foreign keys still validate supplied identities. Promotion,
archive and draft-history reads preserve null origins; the first known holder is not substituted for
an unknown origin. Reviewed records with null origins therefore do not require invented club facts.

`prepareReviewedLineageCorrectionGraph` rechecks the registered review and current source authority,
then consolidates custody histories by exact retained movement identity. It never merges histories
merely because they reach the same player. Exact registered transfer references cover movements
already represented by the original candidate; supplementary movements require retained source
references. Branches, cycles, incompatible dates, disconnected holders and conflicting endpoints or
known origins fail closed. Shared movements retain their source rows and explicit predecessors.
The returned correction graph is preparation; it does not alter candidates or admit canonical facts.

`prepareReviewedOrdinaryCorrection` materializes ordinary histories from a finalized reviewed scope
inside the existing promotion owner. Persistence and promotion independently rebuild the exact
candidate using current registered review, source authority and retained directed-transfer claims.
HTML row references remain provenance; they are not interchangeable with parsed claim ordinals.
Migration0169 validates the immutable scope first, then checks eligible histories, accepted endpoints,
complete custody paths, exact movement evidence and unchanged unrelated facts/issues. Source-evidence
conservation remains mandatory. Any connected history containing a special right stays with the
special-right owner, even when downstream transfers have ordinary pick labels. Rookie elevation and
draft-session coverage require their own handling. Persisting a correction candidate does not admit
it canonically or publish it; remaining blocking issues still prevent promotion.

`buildReviewedSpecialCustodyBindings` converts the registered shared graph into inputs for
`resolveSpecialEntitlementCustody`. It requires one distinct award component per history and maps
every movement to its exact existing transfer, preserving predecessor order and ordinary-labelled
downstream legs. Missing/ambiguous awards or extra inputs fail closed. This pure assembly helper
does not authenticate approvals: registration and promotion must use the governed database owners.

Migration0170 corrects receipt paths in award, lifecycle, revision-lifecycle and identity-replacement
source checks. Genuine execution receipts wrap their payload in `executionReceipt.content`.
The correction preserves exact rights/proposal matching and current approval, expiry and supersession
checks; it does not create source permission or broaden capture-year coverage.

### Reviewed session evidence successors

The 2015 partial-session adapter binds two exact AFL report URLs, contextual publication dates and
ordered normalized-paragraph digests. The completed wrap supplies one dated session and first/last
selection boundaries; the separate retrospective supplies the 70-player total. Changed, duplicated or
out-of-body evidence fails closed. Parser support does not authorize a capture: bind current source
rights and Gate scope to the exact 2015 URLs/fields before execution. Migration0181 admits only the
reviewed wrap article78408 and independent total39972 into the 2015 combined-proof relationship,
including retained-inventory validation; all existing source/currentness requirements still apply.

The 2013 adapter keeps the event-year request explicit: article452467 provides the completed
November21 session and first selection; retrospective117263 provides complete numbered membership
and terminal zone selection97, excluding only explicitly identified rookie upgrades. Article149290
provides the independent62-player total. Its existing2016 route remains separate and unchanged.
Publication years remain2013/2018/2019 respectively. Migration0183 binds the reviewed2013 source
relationship in candidate and retained-inventory validation. Technical parsing does not substitute for
governed capture, identity decisions, public persistence verification or genuine canonical admission.

Promotion proposal v6 binds coverage exactly to the saved selected-session projection, preserving
original ordinals even when earlier sessions have no selected members. Migration0178 extends the
review, write, session-finalization and acquisition-currentness gates. Every candidate selection must
be covered; partial coverage and unresolved factual records still prevent promotion. Validate public
promotion, readback/replay and source-revocation behavior before claiming a completed v6 delivery.
The reviewed subset fixture exercises pick71 alone from a71-selection inventory, original session2,
public custody/selection promotion, replay and acquisition invalidation/recovery for both session sources.
The same fixture also exercises enumerated pick97 from71 members with gaps, explicit boundary identity
reviews, an independent total and complete membership evidence through the retained/public owners.
These synthetic cases verify behavior; they do not establish genuine2013 admission.
Migration0179 preserves completion target order in its hash while comparing candidate batch membership
in sorted order; never rewrite an immutable completion just to match candidate ordering.
Migration0180 permits a further session successor only when it adds draft groups and preserves every
prior projection exactly. It recursively authenticates the current parent chain; each edge must extend
the source set. Existing evidence, corrected facts and ancestor identity approvals remain required.

`prepareReviewedSessionCorrection` reconstructs a private reviewed successor from its finalized
parent, current historical completion and approved identity records. It preserves accepted custody,
endpoints and partial trade dates while adding session evidence for the selected draft members.
Migration0177 validates exact corrected-fact conservation and reconstructs complete draft inventories
from retained selection claims. The existing direct and combined session validators check those
inventories, including boundary identities and independent documents, before accepting the subset.
Unrelated draft selections are never inserted into the reviewed candidate. Persist through
`PostgresAflTradeExternalReconciliationRepository.persistCandidate`; verify exact readback, replay,
current sources and independent restore. Session preparation or candidate persistence does not clear
readiness statuses, provide missing draft groups, or constitute canonical promotion or admission.

Migration0182 applies enumerated-membership validation to candidate and retained-inventory proofs.
Every supplied enumeration must exactly match the ordered original selection numbers. Independent
completed totals, completed-session dates, boundary identities and source currentness remain required;
each covered selection must retain the membership evidence ID. Missing, additional, duplicate or
renumbered members fail. Membership evidence alone does not establish a session date or authorize
an identity alias. Source parsers must attest only facts present in their own scoped documents;
source-specific support and genuine admission require separate verification.

The reviewed2014 parser route uses five exact Official AFL documents:149034 supplies the named
membership roster and terminal86/Josh Clayton/Brisbane;68212 supplies the November27 session and
first1/Patrick McCartin/St Kilda;162070 supplies total76;156041 and56745 separately supply
Steele24 and Finlayson85. Keep the two roster numbers null until the authenticated membership join.
Publication years remain2019/2014/2016/2016/2018, separately from anchor2014. Parser v12 checks
scoped paragraph hashes and article timestamps; it does not emit the conflicting adjacent2013 total.
Migration0185 recognizes those document IDs and the independent2014 total/terminal pair. Source scope,
boundary identity decisions and public retained promotion/revocation still require separate verification.

The retained subset fixture covers a multi-document roster with a null member number and a separate
source-bound number claim, in addition to consecutive and enumerated inventories. Both required
sources pass public capture, preparation, persistence, promotion/readback/replay and individual
revocation/recovery checks. Nested roster fields require explicit Gate field mappings; allowing only
`members` does not grant `members.recordedName` or `members.selectionNumber`. Fixtures do not
establish genuine2014 scope or canonical admission.

Official AFL evidence may retain an explicit `draft_selection` independently of session or custody
claims. When a retained provider inventory omits a selection, use a separately scoped source claim;
do not edit prior captures or reduce the completed total. The reviewed-session owner unions selection
claims across authenticated batches and rejects conflicting claims at the same original number.
Migration0186 and the TypeScript successor guard permit supplemental official selections only for
a relevant year/type and a number absent from all parent source selections. Existing claims, candidate
selections and prior session projections remain immutable; complete membership must still be proved.
The supplemental-selection fixture removes an interior member from Draftguru and supplies it through
an official batch; complete-inventory, subset-promotion and source-revocation checks still apply.
Provider claim support does not extend Gate permissions or authorize a new parser/source route.

Migration0187 permits a source-explicit `draft_completed_member_exclusion` only for a named
`rookie_elevation` in a national-draft roster. The classification must match the roster's exact
recorded name and year/type, come from a different document/capture/artifact, and refer to a numbered
member absent from the national inventory. One classification is required per excluded member.
The resulting membership must exactly equal the retained inventory, preserving original numbers;
classifications remain in the session's evidence set. Duplicate, unrelated, missing or conflicting
classifications fail in both preparation and SQL. A pre-draft classification is not a completed-session
date or count. Source routes and genuine execution remain separately scoped and verified.

Migration0184 supports a complete `draft_completed_membership_roster` with explicit null numbers
for named members, joined to separate `draft_completed_member_number` evidence by exact recorded
name and draft year/type. The join cannot infer numbers from the retained inventory. Every unnumbered
member requires exactly one binding from a different document, capture and artifact; duplicate names,
extra bindings, duplicate numbers and incomplete inventories fail. All joined evidence IDs must remain
in the proposal and selected records, and existing source-currentness gates apply. Existing complete
inventory claims must still match independently. This support does not authorize source parsers,
register player aliases, or establish genuine session coverage without the normal retained proof.

### Original issuing award references

`official-afl-issuing-award` captures the two exact reviewed Official AFL/GWS articles through the
existing source/Gate, field manifest and bounded-fetch owners. Scope uses the original grant year
(2009 for the four mini-draft rights;2010 for the Ablett compensation component), separately from
the actual retrospective observation timestamp. `officialAflIssuingAwardAdapter.ts` emits only an
`issuing_award_reference`; migration0171 permits this evidence kind without granting draft-session,
custody, activation, expiry or canonical-admission status. The capture fetch seam remains available
as `captureOfficialAflPage` from the runtime and from `source/officialAflPageCapture.ts`.
Migration0172 allows issuing references in retained completions only. Include their batches in the
exact candidate source set before canonical custody; source capture alone does not extend a prior
completion. Register current issuing-year capture/reviewer coverage before invoking the award owner.
Retained article bytes and parser verification alone are not registered capture or award evidence.

### Reviewed special-custody successors

`prepareReviewedSpecialCorrection` authenticates the finalized ordinary parent, registered lineage,
issuing awards and retained completion in one transaction. `reviewedSpecialCorrection.ts` builds a
versioned successor covering every connected special history, including ordinary-labelled downstream
legs. Its source set is exactly the parent batches plus registered award evidence; newly added batches
must contain issuing references with matching grant years. Added evidence remains explicitly accounted
for in the reviewed scope. Ordinary custody/lineage and unrelated facts are preserved.
Migration0173 validates special-successor persistence against the immutable ordinary parent, exact
registered histories/awards/predecessors and current completion. Only referenced issuing-year evidence
may extend source-year scope. Source custody accepts precisely that validated batch extension.
Preparation alone does not persist or admit facts; verify genuine persistence/readback, tamper rejection
and independent restore before proceeding to canonical promotion, lifecycle/exercise and session coverage.

Rookie elevation uses the player-bearing `pickTerminalOutcome.ts` contract. It requires a resolved
player, exercising club, draft coordinates and live slot; trade-time numbering remains in custody.
Migration0174 permits a `rookie_elevation` realization with a null draft-selection reference, verifies
approved player/club identities and matching terminal custody, and preserves prior realization checks.
Candidate and archive contracts retain this endpoint; promotion and factual release carry it without
creating a draft selection. These capabilities do not authenticate a reviewed correction successor:
`prepareReviewedRookieCorrection` rebuilds the versioned successor from the current finalized parent,
registered review and retained movement evidence in one transaction. Authentication compares the
entire rebuilt candidate, preserving special/ordinary records and source authority. Its preparation
result explicitly reports persistence/admission false. Migration0175 authenticates the existing parent
and exact rookie review, custody, terminal endpoint and content-addressed identifiers while preserving
prior records and source-evidence conservation. Persistence/replay must pass through that validator.
Verify readback, SQL tamper rejection and independent restore before recording a completed correction;
canonical admission, special lifecycle/exercise and draft-session coverage remain separate exits.

The reviewed 2012 national-session adapter (v13) preserves all 74 retrospective roster entries.
The independent list-lodgement report supplies four explicit rookie-elevation exclusions; the
completed-event release supplies 70 national selections (66 live, three father-son, one local
talent), separately from 24 rookie elevations. The retrospective also supplies Michael Osborne
at original selection 70 and the terminal selection 88. Migration 0188 recognizes these three
reviewed documents and requires the completed total (AFL453360) to be independent of the terminal
roster source (AFL87166). AFL38163 is classification evidence, not a completed-session date.
This capability does not establish genuine capture, identity approval or canonical admission.
