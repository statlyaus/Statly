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
docker run --rm --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  statly-afl-trade-capture:review --verify-runtime
```

After publishing, resolve the immutable image digest. All real captures must start the image by that
digest and inject the same value as `STATLY_CAPTURE_IMAGE_DIGEST`. The Node coordinator also checks the
expected R version, lock digest, and image digest before storing any returned bytes.

Ordinary repository tests only parse the R script, compare its allowlist with the TypeScript registry,
and use a dependency-injected fake process. They make no network calls.

## Authorization and failure policy

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
