# AFL trade-intelligence fitzRoy capture runtime

This directory is the sealed R acquisition boundary for the public, non-fantasy AFL Draft & Trade
Outcomes capability. It is deliberately separate from `etl/fetch_fw_round.R` and the fantasy
Firestore pipeline.

The runtime pins:

- R `4.5.1` through the immutable multi-architecture Rocker image digest;
- fitzRoy `1.7.0` and every R dependency version through `renv.lock`;
- the lockfile SHA-256 in the image metadata and runtime environment; and
- direct provider functions through the TypeScript capability registry and the duplicated closed R
  allowlist.

For an authorized invocation, `capture_fitzroy.R` calls one direct function and immediately writes the
exact returned R object with uncompressed RDS version 3 serialization. It does not rename, select,
filter, zero-fill, derive minutes or disposals, merge identities, write Firestore/PostgreSQL, or publish
data. Diagnostics preserve field order, R class/storage semantics, missing/non-finite counts, factor
levels, timezone metadata, warnings, row counts, exact duplicates, and observable season/round/date
values. fitzRoy does not expose cache-versus-live provenance reliably, so the runtime records
`not_exposed_by_fitzroy`; it never fabricates per-row origin.

fitzRoy `1.7.0` has one upstream AFL Tables namespace defect: its exported
`fetch_player_stats_afltables()` function refers to the separately exported `dictionary_afltables`
and `mapping_afltables` data as bare namespace variables, but R does not install those lazy-data
objects into the locked package namespace. The capture process therefore validates both exported
objects against pinned serialization SHA-256 digests and expected structures, installs an
isolated-process closure with the unchanged direct-function body and only those two parent bindings,
calls the explicit direct function, and restores the namespace on every exit. Any object drift fails
before provider output is accepted. This compatibility guard is used only for AFL Tables player stats;
it does not filter, rename, normalize, or otherwise transform the returned object. A 2024 smoke capture
against the released package produced 9,936 rows and 81 fields through this guarded path.

## Build and verification

The build context is this directory:

```sh
docker build --tag statly-afl-trade-capture:review -f Dockerfile .
docker run --rm --network=none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --env STATLY_CAPTURE_RENV_PROJECT= \
  statly-afl-trade-capture:review --verify-runtime
```

This local smoke command matches the existing local executor's bootstrap override and uses the
image-installed packages; it does not run a writable `renv::load()` against the read-only filesystem.

After publishing, resolve the immutable image digest. All real captures must start the image by that
digest and inject the same value as `STATLY_CAPTURE_IMAGE_DIGEST`. The Node coordinator also checks the
expected R version, lock digest, and image digest before storing any returned bytes.

Ordinary repository tests only parse the R script, compare its allowlist with the TypeScript registry,
and use a dependency-injected fake process. They make no network calls.

## Authorization and failure policy

### Local FootyWire request pacing

The image also applies the hash-pinned `patches/fitzRoy-1.7.0-footywire-pacing.patch` to the
existing fitzRoy source. Within one R process, the FootyWire player-stat season function routes its
match-list, basic-stat and advanced-stat HTML requests through one shared pacer. Each next request
waits at least three seconds after the preceding request completes, including transport failures.
Requests use the exact reviewed HTTPS endpoints; automatic redirects are disabled and every non-200
response fails closed. Even same-origin redirects require review rather than being followed.

This transport-only patch leaves the statistical parser and GitHub cache branch unchanged. The
separate identity patch below replaces the positional basic/advanced merge. Pacing does not establish
correct player-row alignment or
complete season coverage. GitHub cache downloads retain their existing behavior and are not covered
by the FootyWire HTML pacer. A fully uncached season can exceed the existing three-minute capture
timeout; no timeout or retry bound is increased by this patch.

`test_footywire_pacing_contract.R` exercises the public season function using synthetic HTTP responses
and the real monotonic elapsed clock. It verifies consecutive matches, rejected redirects, HTTP and
transport failures, subsequent-call spacing, unchanged parsed statistics and cached returns. Run it
in the built image with `--network=none --entrypoint=Rscript` and arguments
`--vanilla /opt/statly/capture/test_footywire_pacing_contract.R`.

The patch is a **single-process local acquisition control**, not a provider-wide distributed limiter
or a network-egress sandbox. Concurrent capture processes are outside its assurance. Existing local
receipts must still report `capture_admission_only`; the patch does not upgrade them to deployed
egress attestations. Review must bind the exact new image and patch identities, retain the control
evidence, and ensure a single bounded capture before this control can support a local source decision.
Existing runtime image references are not automatically advanced by a build. Source/Gate approval,
normalization review and data admission remain separate requirements.

### FootyWire profile-link join

The additional hash-pinned `patches/fitzRoy-1.7.0-footywire-identity.patch` preserves a `PlayerLink`
column on freshly parsed match rows. It retains the `pp-…` path segment, following the existing
FootyWire draft adapter convention. The parser accepts relative profile paths, `/afl/footy/` paths,
and exact HTTPS FootyWire profile URLs; missing/multiple links, other origins, query strings,
fragments and unsupported path formats fail closed. This is a source-link identifier, not proof of
a permanent provider namespace or a canonical Statly player assignment.

Basic and advanced rows must have a unique, identical set of `(Match_id, Team, PlayerLink)` keys.
The join uses those keys and preserves basic-table names and ordering, so abbreviated names and
reordered advanced rows cannot swap player statistics. Missing cells remain missing; no calculation
exclusion policy or zero-fill is introduced. `test_footywire_identity_contract.R` exercises the public
season-fetch interface with offline HTTP fixtures, including reordered Chad/Corey Warner rows,
invalid/ambiguous links and missing observations. Both identity and pacing contracts run at build.

The GitHub cache branch is unchanged. Cache-only returns can still lack `PlayerLink`; mixed returns
have missing links for older cached rows. Neither is retroactively link-verified, and the retained
2025 capture remains unchanged. Fresh output adds a field and changes the schema fingerprint: an
exact field-map and image review is required before capture/admission. Existing canonical identity
resolution remains the downstream boundary; this patch does not create or approve assignments.

### Local capture deadlines and cleanup

The existing local Docker capture executor starts each attempt with `--init` and a unique container
name. Its execution deadline kills the attached Docker client with `SIGKILL`; an elapsed-deadline
check also rejects late successful exits. Killing the client is not treated as proof that the
daemon-owned container stopped: the executor force-removes only that attempt's exact container name
before accepting output or propagating failure. Cleanup has a separate ten-second bound and cannot
turn a failed capture into success. A cleanup failure identifies the container and reports termination
as unconfirmed; investigate that exact container before another attempt. No broad prune is used.

The configured capture timeout and retry policy are unchanged. Cleanup time is separate from the
capture deadline, not additional authorized acquisition time. The regression tests exercise the real
Node process boundary with a fake external Docker CLI that ignores `SIGTERM`, and verify rejection,
exact cleanup targeting, successful output handling, and fail-closed cleanup errors. These lifecycle
controls do not grant source approval, distributed concurrency, or a deployed egress attestation.

### Governed capture requirements

The AFL Tables, Footywire, and Fryzigg player-stat capabilities are approved for their exact reviewed
fields and governed uses. Do not execute an external capture until the corresponding current
source-rights artifact and finite Gate 0A decision are loaded and resolve successfully. A technical
build or successful `--verify-runtime` result does not replace those machine records.

Production execution fails closed unless the deployed container runs behind the provider-keyed
distributed admission coordinator and an attested egress boundary. The executor must return a signed,
content-addressed execution receipt binding the exact provider, capability, invocation, output bytes,
runtime image and lock, reviewed rate, cache interval, and egress-policy evidence. That receipt is
verified and retained in metadata custody with the source capture. Several fitzRoy calls fan out into
multiple upstream requests, so the attested egress boundary—not merely the outer Redis lease—must pace
their internal requests. Historical or season-unbounded player-detail modes remain disabled until
Gate 0A represents their complete retrieval scope. Fixture authority accepts only a branded
no-network executor; the local Rscript adapter is network-capable and cannot be supplied to that path.

The coordinator fails before provider execution when Gate 0A is blocked. After execution it rejects
zero rows, exact duplicates, warnings, unknown/changed fields, runtime drift, argument-digest drift,
missing or out-of-scope season/round evidence, oversized output, timeouts, and malformed diagnostics.
Production callers use `ingestAuthorizedAflTradeFitzRoyProviderSeason`, which resolves the durable
authorization again, builds the exact source snapshot from verified custody, and passes it to the
capture-to-staging boundary. Staging independently verifies the signed egress receipt before its first
PostgreSQL write; possession of a self-consistent snapshot is not sufficient authority.
Rejected ephemeral RDS bytes are deleted and
cannot form a source snapshot. Only exact invocation metadata may remain when its approved retention
permits it.

The RDS object is exact fitzRoy output, not the raw upstream HTTP response or the contents of a
fitzRoy-data cache. Mixed cache/live provenance and provider-side suppressed failures remain explicit
Gate 0B limitations.
