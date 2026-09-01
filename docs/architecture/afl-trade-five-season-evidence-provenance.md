# AFL Tables five-season evidence provenance

- Status: research finding for issue #574
- Investigated: 2026-09-01
- Scope: the pinned 2021–2025 local AFL Tables review set and the source lane required by a genuine admitted-player model run

## Decision summary

The pinned five-season evidence and the fresh capture have the same declared upstream lane: AFL
Tables, acquired through fitzRoy `1.7.0` by the direct function
`fetch_player_stats_afltables`. They are separate captures, not two independent data providers.

The pinned evidence digest is not a digest of football values alone. It includes capture,
normalization, decoded-row, identity-candidate and match-candidate identities as well as names, clubs,
match locators and the reviewed goals fact. A new authorized retrieval receives new capture-time
provenance identities, so a different evidence-set digest does not establish that a football value
changed.

The repository does not contain the pinned capture's RDS bytes or normalized database. The expected
private local artifact roots are not present in this worktree beyond an empty `.statly-local/`
directory, and the main checkout has no `.statly-local/` directory. Therefore this investigation
cannot perform a semantic old-versus-new row comparison. It must not infer the old values from the
digest or replace the pinned digest with the fresh one.

Issue #574 should not use the restricted five-season workbook-rehearsal authority for model training.
It should use the standing AFL Tables source policy, represented by exact current non-production Gate
0A machine records that permit `model_training`, followed by the normal reviewed canonical-promotion,
factual-lineage, dataset-admission and model-run boundaries. The restricted local review set may
remain evidence for private factual review and derived HPN calculation, but it is not a model-training
input.

## 1. Exact source of the pinned evidence

The acquisition chain is:

`AFL Tables -> fitzRoy 1.7.0 -> fetch_player_stats_afltables -> exact RDS -> Statly normalization -> local review set`

Primary repository evidence:

- The capture allowlist maps capability `afl-tables-player-stats` to
  `fetch_player_stats_afltables`, and the sealed process calls that function directly with one season,
  `round_number = NULL`, `rescrape = false`, and no rescrape start season
  (`etl/afl-trade-intelligence/capture_fitzroy.R:21-27,148-159`;
  `src/server/aflTradeIntelligence/development/localFiveSeasonFitzRoyOutcomeLoad.ts:71-84`).
- The sealed runtime pins R `4.5.1`, fitzRoy `1.7.0`, the dependency lock and an image digest. It writes
  the exact returned R object before normalization
  (`etl/afl-trade-intelligence/capture_fitzroy.R:3-10,42-61`;
  `etl/afl-trade-intelligence/README.md:7-21`;
  `src/server/aflTradeIntelligence/development/localFiveSeasonAflTablesStaging.ts:31-35`).
- The review query accepts only provider `afl_tables`, capability
  `afl-tables-player-stats`, environment `non_production`, staged captures, finalized normalization and
  seasons 2021–2025
  (`src/server/aflTradeIntelligence/development/localFiveSeasonAflTablesReview.ts:43-74`).
- The standing source decision names AFL Tables as the primary historical AFLM player-match lane and
  the same direct function as its acquisition mechanism
  (`docs/architecture/afl-trade-source-rights-assessment.md:9-32`).

The original pinned review was introduced by commit `43bb026b` with digest
`aef663452e66a433048605a71fb4178ed1a5e1d9610c6d3ed75bfb796308b5cb`. Commit `f4061c2b`
changed it to `7ef741add1ae94133c597581f8a2175118058bedd2ffe8a107213630e1b0fd10` after correcting
the authenticated capture lineage. Migration `0081_corrected_local_review_lineage` explicitly says
the reviewed rows and counts were unchanged while the lineage identity changed
(`prisma/afl-trade-outcomes/migrations/0081_corrected_local_review_lineage/migration.sql:1-9`).
That history is direct evidence that this digest can change without a football-row change.

## 2. What is and is not retained

Git retains:

- the pinned digest, expected 48,769 appearance count and fixed local review time
  (`src/server/aflTradeIntelligence/development/localFiveSeasonAflTablesReview.ts:38-41`);
- the code that reconstructs and validates the candidate set;
- content-addressed identifiers and migration constraints that recognize the digest; and
- operating instructions that require the old database and artifact roots to be preserved offline and
  read-only (`docs/runbooks/afl-trade-intelligence-operations.md:639-661`).

Git does not retain the five source RDS objects, the normalized 48,769-row database, or an artifact
custody directory. `git ls-files` contains no `.rds`, outcomes dump, or
`.statly-local/afl-trade-artifacts` member. The local storage convention is intentionally ignored and
disposable (`docs/development/testing.md:104-136`; `.gitignore:88`).

The runbook says the old database and private artifact roots should be kept offline, but it does not
record their physical location. It also forbids reconstructing corrected Gate lineage by relabelling
old bytes (`docs/runbooks/afl-trade-intelligence-operations.md:646-654`). A filesystem metadata check
limited to the issue worktree and main checkout found no retained artifact tree or PostgreSQL data
directory. No credentials, environment files, database contents or external private storage were
inspected.

Conclusion: the repository proves what was expected and approved, but the original payload needed for
a row comparison was not located. If a separately held offline database or artifact root exists, its
custodian must identify it; otherwise the old set is not reproducible from Git alone.

## 3. What the evidence digest measures

The review digest hashes the canonically encoded, ordered array of all 48,769 reviewed rows. For each
row it includes:

- capture ID, normalization-run ID and season;
- decoded-row ID;
- identity-candidate ID and digest, native player ID, recorded name and recorded club;
- match-candidate ID and digest, order-independent match locator and match date; and
- goals definition version, availability, numeric value or missing reason, and source field.

The exact construction is
`src/server/aflTradeIntelligence/development/localFiveSeasonAflTablesReview.ts:76-111`.

Several of those identifiers deliberately change across a new retrieval:

- A source snapshot hashes the authorization records, capture receipt, retrieval time and creation
  time (`src/server/aflTradeIntelligence/artifacts/sourceSnapshotManifest.ts:117-139,483-489`).
- A capture ID hashes that snapshot, a timestamped capture-attempt identity and the source artifact
  (`src/server/aflTradeIntelligence/source/postgresSourceCaptureRepository.ts:113-132`).
- A normalization-run ID includes the capture ID
  (`src/server/aflTradeIntelligence/source/postgresProviderObservationRepository.ts:520-535`).
- Decoded-row, identity-candidate and match-candidate IDs include capture-receipt or interpretation
  identities (`src/server/aflTradeIntelligence/source/fitzRoyObservationNormalizer.ts:283-303,348-370,585-604`).

Therefore a digest mismatch is compatible with either of these cases:

1. identical football values under a new authenticated capture lineage; or
2. a real change in source rows, identifiers, match interpretation or goals availability/value.

The digest alone cannot distinguish them. Counts matching also do not prove value equality. A valid
comparison requires both normalized datasets and a separate semantic projection that excludes
capture-specific IDs. A suitable comparison key is provider, competition, season, native player ID,
recorded club, order-independent match locator and match date; compare recorded name, appearance,
goals availability/value, missing reason and source field. Duplicate or ambiguous keys must remain
review cases rather than being silently collapsed.

## 4. Why the two rights records differ

There is no policy contradiction between the standing source lane and the local rehearsal artifact:
they authorize different purposes.

The standing policy is the product-owner decision for public AFL trade intelligence. Its
machine-policy factory permits internal evaluation, model training, derived features, public derived
output and reviewed factual display, while blocking raw-field redistribution
(`docs/architecture/afl-trade-source-rights-assessment.md:74-90`;
`src/server/aflTradeIntelligence/source/approvedFitzRoySourcePolicies.ts:169-216`). Every execution
still needs an exact content-addressed rights proposal, field set and current Gate decision
(`docs/architecture/afl-trade-source-rights-assessment.md:138-156`).

`createLocalAflTradeFiveSeasonAflTablesAuthority` starts from that factory and deliberately creates a
new, narrower content-addressed proposal for a disposable local workbook rehearsal. It changes the
purpose, blocks `model_training`, blocks public uses, and restricts the audience and commercial
context to internal evaluation
(`src/server/aflTradeIntelligence/development/localFiveSeasonAflTablesAuthority.ts:168-180,200-234,238-270`).
Its Gate request asks only for capture, retention and internal quality evaluation, not training
(`src/server/aflTradeIntelligence/development/localFiveSeasonAflTablesAuthority.ts:292-319`).

The local authority currently permits `derived_feature` and `derived_feature_creation`; two passages
that say it blocks derived features are stale documentation
(`docs/architecture/afl-trade-intelligence.md:304-306,448-450`). The same architecture document
correctly describes the retained-private-review lane as derived-calculation-only and not a
model-training input (`docs/architecture/afl-trade-intelligence.md:348-355`). This documentation drift
does not grant broader authority; the exact machine proposal remains controlling.

The admitted-player runner is itself local, private and non-production, but it requires an admitted
dataset whose exact source-rights evaluations cover `model_training`. “Local execution” does not mean
“use the local workbook-rehearsal rights artifact.” Its runbook explicitly prohibits substituting a
fixture or fabricated evidence and requires exact source-rights lineage
(`docs/runbooks/afl-trade-intelligence-operations.md:1065-1088`).

## 5. Safe decision tree and next action

1. **Can the custodian locate the old offline RDS objects and normalized database?**
   - **Yes:** mount them read-only, verify their recorded content identities, and produce a semantic
     old-versus-fresh comparison. Do not migrate, mutate, relabel or replay the old capture.
   - **No:** record the old digest as historical, non-reconstructable local review evidence. Do not
     rotate its constant to the fresh digest and do not claim whether football values changed.
2. **Is the goal only the private workbook/HPN rehearsal?**
   - **Yes:** the narrow local authority is appropriate. A fresh exact review set needs its own review
     decision and digest; it still cannot authorize model training.
   - **No, the goal is issue #574's genuine admitted-player model run:** do not use the local review-set
     authority. Before retrieval, materialize the already-approved standing AFL Tables policy as exact
     current non-production Gate 0A records for the required seasons, fields and `model_training` use.
3. Capture through the sealed fitzRoy runtime under that training-capable authority and retain the
   exact RDS and custody receipts. A capture made under the rehearsal proposal cannot be relabelled as
   training-authorized after retrieval.
4. Review identities, matches and facts, then finalize one current canonical promotion covering both
   the transaction/event and player asset ancestry. Only that promoted lineage may enter factual
   lineage, dataset admission and model-run authorization.
5. Execute and replay the native admitted-player component only after every source-rights evaluation
   is current and explicitly allows `model_training`.

The immediate safe next action is a recorded lane decision for #574: use the standing AFL Tables
model-training policy in `non_production`, not the restricted five-season rehearsal policy. Once that
decision is explicit, the implementation task is to create or resolve the exact machine Gate records
and run a fresh governed capture through canonical promotion. Searching for a digest match should not
block that path and is not a substitute for semantic comparison or review.
