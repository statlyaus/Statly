# AFL trade intelligence source policy

- Status: approved for implementation and production use
- Decision date: 2026-08-08
- Scope: public, non-fantasy AFL trade intelligence
- Decision owner: Statly product owner
- Revalidation: at least annually, and earlier for a material schema/terms change or provider withdrawal

## Decision

For this project, Statly assumes that the AFL Tables, Footywire, and Fryzigg data exposed through the
pinned fitzRoy integration may be used for bounded capture, retained source evidence, internal quality
evaluation, identity and match reconciliation, derived-feature creation, model training, public
derived numerical output, and public display of the factual fields consumed by the AFL Draft & Trade
Archive.

This decision removes the former blanket `source_blocked` disposition. Gate 0A must be represented by
source-specific, content-addressed approval records for the exact capability, competition, season
range, returned fields, and operations. Those records are governance and provenance controls; they
must not be used to re-litigate this approved source decision at every pipeline stage.

The fitzRoy package remains an acquisition client rather than the data authority. Every retained
snapshot identifies its upstream provider and direct function. Public copy must describe the product
as independent Statly research and must not imply AFL, provider, or fitzRoy endorsement.

## Approved source lanes

| Provider   | Pinned fitzRoy function        | Approved role                                                                                                 | Required handling                                                                                                                                 |
| ---------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| AFL Tables | `fetch_player_stats_afltables` | Primary historical AFLM player-match statistics, appearances, goals, Brownlow votes, and match reconciliation | Capture the full returned season, preserve the exact R object, retain source-local identifiers, and distinguish missing values from measured zero |
| Footywire  | `fetch_player_stats_footywire` | Secondary player-match statistics and coverage checks from 2010 onward                                        | Capture the full returned season, rate limit requests, preserve the exact R object, and quarantine upstream layout or schema drift                |
| Fryzigg    | `fetch_player_stats_fryzigg`   | Independent reconciliation and gap analysis for AFLM/AFLW seasons supported by the returned dataset           | Preserve the complete returned RDS evidence, fingerprint every schema, and do not promote unmatched rows automatically                            |

Other direct functions already enumerated by `AFL_TRADE_FITZROY_CAPABILITIES` inherit this standing
policy only when their upstream provider is AFL Tables, Footywire, or Fryzigg and their capability-
specific field map, grain, scope, and reconciliation tests pass. Official AFL, AFL Coaches
Association, and every other upstream require their own source decision. Approval never changes a
function's observed technical limitations: a season-returning function remains season-grained,
absent data remains unknown, and suppressed upstream errors remain incomplete evidence.

### Verified technical smoke baseline

On 2026-08-08, an isolated fitzRoy `1.7.0` smoke run requested the complete 2024 AFLM season from all
three approved player-stat functions. No returned rows were retained or published. Footywire returned
9,936 rows across 42 fields; Fryzigg returned 9,936 rows across 81 fields; and AFL Tables returned
9,936 rows across 81 fields after the sealed runtime applied its pinned compatibility guard.

The guard is required because released fitzRoy exports `dictionary_afltables` and
`mapping_afltables`, but `fetch_player_stats_afltables()` refers to them as bare variables absent from
the locked package namespace. Statly verifies the exact exported objects by serialization digest and
structure, gives an unchanged copy of the direct function body only those two parent bindings for the
isolated capture process, and restores the namespace on exit. Object drift fails closed. This is a
technical acquisition compatibility measure, not source normalization, completeness evidence,
identity resolution, reconciliation approval, or release authority.

## Source precedence and reconciliation

No provider silently overwrites another provider's observation.

1. Exact provider rows are retained as immutable source facts with their capture, schema, field map,
   effective time, and knowledge time.
2. Canonical player, club, and match identities are assigned only through the governed resolution
   workflow; display-name equality is never sufficient.
3. A completed match plus a resolved player appearance is the games denominator. The presence of a
   normalized row alone is not a game.
4. AFL Tables is the initial primary historical player-stat lane. Footywire is a secondary comparison
   and coverage lane. Fryzigg is a reconciliation lane. A versioned policy may promote a different
   source for a specific metric, competition, or era only after measured coverage tests.
5. Conflicting measured values remain explicit reconciliation cases. They do not become averages,
   zeros, or public facts merely because more than one source exists.
6. Workbook grades, `Expected`, and `Actual` values are retained only as historical evidence. They
   are never authoritative Statly model outputs.

## Approved operations

The following operations are approved for the three named source lanes and their exact retained
fields:

- bounded evaluation and production capture;
- immutable raw evidence and capture-metadata retention;
- internal quality evaluation and provider reconciliation;
- canonical identity and match resolution;
- derived-feature creation;
- model training, validation, calibration, and backtesting;
- public derived numerical output, including uncertainty and methodology information;
- public display of reviewed source facts, including games, goals, votes, and achievements; and
- generated CSV, JSON, and workbook exports of an approved public release.

Raw upstream payload redistribution is not required by the product and remains disabled. The public
site reads only an approved immutable release, not transient capture or staging records.

## Operational controls

Approval is implemented with the following mandatory controls:

- execute only direct functions in the pinned fitzRoy capability registry; never accept a caller-
  supplied function name, wrapper, source string, or arbitrary R expression;
- bind each request to one environment, provider, capability, competition, and bounded season scope;
- enforce provider-keyed concurrency and request-rate limits before external access;
- retain the exact returned R object before filtering, coercion, selection, or normalization;
- retain canonical invocation, runtime identity, warnings, schema diagnostics, content digest, and
  source snapshot receipt;
- fail closed on runtime mismatch, unknown fields, incomplete row custody, timeout, oversized output,
  or storage read-back mismatch;
- preserve `NA`, `NaN`, infinity, measured zero, unavailable, not-applicable, quarantined, and
  unresolved states distinctly;
- keep raw evidence private in durable object storage and canonical facts/releases in the isolated
  AFL outcomes PostgreSQL database;
- publish through versioned immutable releases and an atomic active pointer so a prior release can
  be restored without rebuilding it; and
- record attribution and effective-through dates on public methodology and export surfaces.

## Retention, correction, and withdrawal

Raw source artifacts use the approved raw-source custody profile; capture diagnostics, normalized
facts, model inputs, and public projections use their separate retention profiles. Content identity
does not inherit a different profile merely because identical bytes already exist elsewhere.

A provider correction creates a new source snapshot, reconciliation result, model vintage, and
release. It never mutates an earlier released fact in place. If a source becomes technically
unavailable or its use is withdrawn, Statly stops new captures for that capability, marks the latest
effective date, evaluates affected releases, and atomically rolls the public pointer back or removes
the affected surface. Existing evidence is deleted or retained according to its recorded custody
profile and withdrawal rule.

## Product boundary

The AFL Draft & Trade Archive is separate from protected fantasy leagues.

- Players, clubs, picks, transactions, and source observations are public AFL research records; no
  Statly user owns them.
- The authoritative outcome and valuation schemas have no `User`, `League`, membership, roster, or
  fantasy-trade ownership relationship.
- Firebase/Firestore fantasy ingestion is not a fallback authority for this product.
- The provided workbook is a development import, reconciliation aid, and generated export format; it
  is not the live source of truth.

## Gate 0A implementation rule

For the approved sources, Gate 0A is satisfied when the exact machine-readable proposal and decision
match this policy and pass the repository's mechanical checks. Required bindings are:

- upstream provider and direct fitzRoy capability;
- pinned fitzRoy/runtime version;
- competition and bounded season scope;
- exact returned field set and normalized uses;
- the approved operations above;
- automation, rate-limit, retention, attribution, and withdrawal conditions;
- immutable evidence and reviewer authority references; and
- a current decision that has not been superseded or withdrawn.

Every capability approval has a finite `termsExpireAt` and `revalidateAt` no more than one year after
its effective date. Schema drift, a new provider capability, changed terms, or withdrawal requires a
new scoped decision. Withdrawal appends an immediate successor decision and invokes the stop,
deletion, reassessment, and atomic-pointer rollback duties above. It does not revoke the standing
approval for unchanged AFL Tables, Footywire, or Fryzigg capabilities.

## Execution sequence

1. Generate one Gate 0A proposal and approval per capability, dataset version, and exact field set,
   initially for the AFL Tables, Footywire, and Fryzigg player-stat capabilities.
2. Run bounded season captures and retain exact source snapshots in durable object storage.
3. Decode every returned row into immutable staging and reconcile identities, matches, metrics, and
   achievements in PostgreSQL.
4. Import the supplied workbook as development evidence for trades, drafts, rookie drafts, pre-season
   drafts, and mid-season drafts; normalize the same domain model used by production.
5. Build acquisition spells and checked games, goals, votes, and achievement outcomes.
6. Materialize a point-in-time valuation dataset, train and backtest the player-contribution and
   pick-outcome models, and calibrate uncertainty from historical cohorts only.
7. Value transaction assets at the transaction date, compute realized and remaining value, and
   publish immutable factual and valuation releases.
8. Activate the approved PostgreSQL releases for the public pages, APIs, methodology, and generated
   exports; monitor freshness and preserve one-step rollback.

The source policy is approved. Remaining blockers are now technical or data-quality failures that
must be reported precisely; they are not a default presumption that all three named sources are
forbidden.
