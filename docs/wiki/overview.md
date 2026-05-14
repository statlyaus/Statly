---
title: 'Statly Overview'
type: 'overview'
status: 'current'
last_updated: '2026-05-14'
sources:
  - 'AGENTS.md'
  - 'docs/FOOTYWIRE_DATA_ARCHITECTURE_REVIEW.md'
  - 'docs/DATA_RELIABILITY.md'
  - 'STATLY_DESIGN_SYSTEM.md'
tags:
  - 'statly'
  - 'architecture'
  - 'overview'
---

# Statly Overview

Statly is an AFL fantasy product with data ingestion, canonical event persistence, serving projections, product UI, and operational workflows.

This wiki is a generated synthesis layer for that system. It should help future agents understand the repo quickly, but it must not replace the authoritative sources it cites.

## Current Architectural Center

The active data architecture priority is Footywire convergence around a single canonical Firestore raw-match contract.

The intended shape is:

1. Footywire source data is processed into canonical raw-match documents.
2. Firestore raw-match documents define persisted semantics for Footywire-derived player-match data.
3. Downstream ingestion, rebuild, reconciliation, and read models consume that canonical contract.
4. Repair operations are bounded, repeatable, observable, and safe.

`AGENTS.md` states this as the repository north star. `docs/FOOTYWIRE_DATA_ARCHITECTURE_REVIEW.md` says the implementation is moving in that direction but remains transitional.

## Current Product Design Center

The UI goal is not a generic SaaS dashboard. `STATLY_DESIGN_SYSTEM.md` defines the target as a modern AFL fantasy operations product: dense, credible, fast to scan, and mobile-ready.

The current design-system direction favors:

- shadcn-style open components
- semantic theme tokens
- accessible primitives
- scanable fantasy workflows
- mobile-specific task layouts where needed

## Data Reliability Model

`docs/DATA_RELIABILITY.md` frames data reliability around three lanes:

- Lane A: player read models for season-long research and rankings.
- Lane B: live data for matchups and AFL score context.
- Lane C: trades for proposals, review, execution, and audit.

The wiki should preserve this lane distinction. It should not collapse batch summaries, live data, and transactional writes into one generic reliability model.

## Wiki Role

Use this wiki to answer questions faster, preserve durable context, and expose unresolved issues.

Do not use this wiki to assert that architecture has converged unless the cited source files, tests, and verification commands prove it.

Important related pages:

- [[schema]]
- [[footywire-canonical-contract]]
- [[design-system]]
- [[questions]]
