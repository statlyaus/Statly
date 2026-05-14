---
title: 'Statly Wiki Questions'
type: 'question'
status: 'current'
last_updated: '2026-05-14'
sources:
  - 'AGENTS.md'
  - 'docs/FOOTYWIRE_DATA_ARCHITECTURE_REVIEW.md'
  - 'docs/DATA_RELIABILITY.md'
  - 'STATLY_DESIGN_SYSTEM.md'
tags:
  - 'wiki'
  - 'questions'
  - 'architecture'
---

# Statly Wiki Questions

This page tracks unresolved questions, contradictions, and investigations that should not be smoothed over in synthesis pages.

## Data Architecture

### Is the Footywire projection path fully contract-only for repaired scopes?

`AGENTS.md` states that Firestore canonical raw-match documents are the only persisted semantic source for Footywire-derived player-match data. `docs/FOOTYWIRE_DATA_ARCHITECTURE_REVIEW.md` says the architecture is still transitional and identifies fallback interpretation in downstream read-model code as a gap.

Status: unresolved. Requires code-level verification before any wiki page claims full convergence.

### What is the smallest safe scoped rematerialization unit?

The desired direction is bounded repair by round, match, player, or season slice. Existing docs still emphasize broader player read-model refresh behavior in places.

Status: unresolved. Needs implementation and operational review before the wiki can describe a stable runbook.

### What authorization policy should govern shared non-production import and rebuild paths?

Existing guidance requires explicit authorization and observability for high-impact mutation paths. The durable policy for shared non-production environments should be documented when finalized.

Status: unresolved. Needs security and operations decision.

## Product And UI

### Which legacy UI surfaces remain highest priority for design-system migration?

`STATLY_DESIGN_SYSTEM.md` defines the target product standard. `AGENTS.md` notes that hard-coded palette classes and older component patterns still exist in legacy surfaces.

Status: unresolved. Needs a current design-system drift ingest or audit refresh.

### Which mobile workflows require purpose-built layouts instead of table shrinkage?

The design standard calls out roster, live scoring, draft, and core management workflows as mobile-critical.

Status: unresolved. Needs surface-by-surface product review.
