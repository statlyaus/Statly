---
title: 'Footywire Canonical Contract'
type: 'topic'
status: 'current'
last_updated: '2026-05-14'
sources:
  - 'AGENTS.md'
  - 'docs/FOOTYWIRE_DATA_ARCHITECTURE_REVIEW.md'
  - 'docs/DATA_RELIABILITY.md'
tags:
  - 'footywire'
  - 'canonical-contract'
  - 'read-models'
  - 'data-reliability'
---

# Footywire Canonical Contract

The long-term Footywire architecture centers on one persisted semantic contract at the Firestore raw-match boundary.

## Intended Contract

The canonical raw-match contract should define:

- match identity
- player identity linkage
- canonical stat keys
- missing, zero, and absent value semantics
- source provenance
- source priority
- downstream match metadata

Downstream code should consume this contract directly or consume projections derived exclusively from it.

## Why This Matters

If downstream readers reconstruct meaning from legacy top-level fields, source-shaped rows, or independent presence rules, Statly can drift between ingestion, raw persistence, rebuild, reconciliation, and read models.

The desired direction is not just cleaner code. It is operational convergence:

- imports write the canonical contract
- rebuilds publish projections from that contract
- reconciliation validates the same semantics
- repaired scopes no longer depend on fallback interpretation

## Current Known Gap

`docs/FOOTYWIRE_DATA_ARCHITECTURE_REVIEW.md` describes the architecture as transitional. It identifies fallback logic in downstream read-model behavior as a core gap where semantic authority may still be distributed.

This page should not claim full convergence until code and tests prove that repaired scopes consume the canonical contract without legacy semantic fallback.

Track unresolved items in [[questions]].

## Verification Expectations

For changes in this area, verification should prove:

- raw Firestore documents contain intended canonical data
- downstream projections consume canonical data correctly
- provenance and presence semantics survive rebuild
- repair scope is bounded to the affected slice
- `dropped_before_raw` and `dropped_in_projection` are absent for the claimed repaired scope

Relevant source areas from `AGENTS.md` include:

- `etl/processFootywireData.ts`
- `src/lib/stats/footywireCanonicalContract.ts`
- `src/lib/footywireStatsIngestion.ts`
- `src/server/readModels/playerReadModels.ts`
- `src/app/api/etl/import-rounds/route.ts`

## Related Pages

- [[overview]]
- [[questions]]
