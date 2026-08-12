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
   must be repeated exactly; an undated Draftguru transaction requires an independently reviewed date
   here. The content-addressed proposal and approval bind those dates before canonical promotion.
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

The successful Stage 2A rehearsal boundary is 8 integration files and 40 tests, including the full
migration/drift/reapply suite and four fitzRoy factual-rehearsal checks. Record the exact commit and
command output in the delivery checkpoint. A later code-only change requires a fresh exact-commit
run. This evidence does not satisfy real-source, hosted durability, backup/restore, alerting, schedule,
or activation requirements.

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
3. Pre-register the dataset-v4/player-row-v3 point-in-time specification: stable
   player/acquisition-spell row grain, prediction cutoff, target horizon and maturity, value unit,
   role/era/censoring policies, chronological train/calibration/validation/final-test windows, embargo,
   and exact player/event/acquisition-spell leakage groups. Dataset v4/row v3 does not admit
   draft-pick rows.
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
   through time separately from recorded-at knowledge time. Reject a feature known after its cutoff, a
   feature reused as its own target, a target outside the future valid-time window, a leakage group in
   multiple partitions, or prior-partition labels not known before the next prediction origin plus
   embargo. The three leakage values must equal the row's stable acquisition-spell subject, stable
   event subject, and player IDs; exact spell/event version IDs remain provenance and must not split
   revisions of one subject across partitions. Never accept producer-defined aliases.
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
