# Footywire Data Architecture Review

This document rewrites the current architecture review so it evaluates the system against the intended long-term goal, not just isolated code findings.

It focuses on the Footywire ingestion and projection pipeline centered on:

- `etl/processFootywireData.ts`
- `src/lib/footywireStatsIngestion.ts`
- `src/server/readModels/playerReadModels.ts`
- `src/app/api/etl/import-rounds/route.ts`

Related references:

- [DATA_RELIABILITY.md](./DATA_RELIABILITY.md)
- [PLAYER_IDENTITY_PIPELINE_PROTOCOL.md](./PLAYER_IDENTITY_PIPELINE_PROTOCOL.md)
- [runtime-contract.md](./runtime-contract.md)

## Goal

The intended architecture should treat the Firestore raw-match document as the single authoritative persisted contract for Footywire-derived player match data.

That contract should define, in one place:

- canonical match identity
- canonical player identity linkage
- canonical stat keys
- explicit presence semantics
- source provenance
- source priority
- canonical match metadata

Everything downstream should either:

- consume that contract directly, or
- consume read models derived exclusively from that contract

Downstream systems must not reconstruct business meaning from raw Firestore fields, legacy aliases, or source-shaped rows when that meaning can be expressed once at the persistence boundary.

## Assessment

The current architecture is moving in the right direction, but it is still transitional rather than fully converged.

What is already aligned:

- `etl/processFootywireData.ts` writes a meaningful canonical payload through `canonical_stats`.
- stat naming has started to centralize in `src/lib/stats/statColumns.ts`.
- provenance and presence semantics are treated as first-class concerns rather than hidden assumptions.
- successful imports trigger downstream publication work instead of leaving projections stale.

What is not yet aligned:

- semantic authority is still split across ETL, merge, and read-model layers
- the canonical vocabulary is only partially centralized
- repair scope and rebuild scope are broader than necessary
- import and rebuild operations do not yet reflect a fully explicit security model

## Core Architecture Gaps

### 1. Semantic authority is still distributed

`etl/processFootywireData.ts` is trying to establish the canonical persisted contract, but `src/server/readModels/playerReadModels.ts` still contains fallback logic that reads from:

- top-level Firestore fields
- `data.stats`
- `data.raw_row`

This means more than one layer still participates in deciding:

- what a stat means
- whether a stat is present
- where a stat came from

Why this is a problem:

- Firestore is not yet the sole semantic contract boundary
- projection behavior can drift from persisted contract behavior
- reconciliation logic is compensating for architectural split instead of validating a single authoritative flow

Required long-term change:

- downstream readers should consume the canonical contract directly
- any compatibility adapter should be isolated, temporary, and clearly marked for removal

### 2. The common vocabulary is not fully centralized

The repository already centralizes canonical stat keys in `src/lib/stats/statColumns.ts`, but the effective contract surface is still duplicated across multiple places, including:

- ETL contract construction
- merged ingest field selection
- read-model parsing and presence handling

Why this is a problem:

- a stat key change can drift across layers
- availability semantics can diverge across stages
- contract evolution is still multi-author instead of single-author

Required long-term change:

- define one shared contract module for canonical Footywire match rows
- move stat field definitions, availability semantics, provenance helpers, and validation helpers into that module
- make ETL, ingestion reconciliation, and read-model code all import from that shared contract

### 3. Repair scope and rebuild scope are too loosely coupled

`src/app/api/etl/import-rounds/route.ts` correctly triggers publication after import, but the current path refreshes the full season read models even when only a bounded round set changed.

Why this is a problem:

- unnecessary data movement and compute
- larger operational blast radius
- slower repair loops
- weaker reasoning about what was rebuilt and why

Required long-term change:

- add bounded rematerialization for affected rounds, matches, and players
- keep full-season rebuilds as explicit backfill or recovery operations, not the default repair path

### 4. Security posture is not yet explicit enough for a centralized data platform

The import route permits access in non-production when no import token is configured. That may be acceptable for purely local development, but it is not a durable security model for shared environments.

Why this is a problem:

- raw-data mutation is high impact
- environment-based permissiveness is not a complete policy
- import and rebuild operations should be explicitly authorized and operationally reviewable

Required long-term change:

- define import and rebuild authorization policy by environment
- require explicit credentials in every shared environment
- separate import authority from rebuild authority if operationally useful
- ensure these mutation paths are observable and auditable

## Architecture Position

The long-term target should be:

1. Firestore canonical raw-match docs are the only persisted semantic source for Footywire player-match data.
2. Prisma read models remain valid, but only as serving projections derived from that canonical Firestore contract.
3. No downstream projection code should reinterpret raw source-shaped data once the canonical contract exists for that scope.
4. Reconciliation should validate convergence between stages, not provide an alternate semantic reader indefinitely.

This means the current architecture should not be replaced wholesale. The right move is disciplined consolidation, not a broad rewrite.

## Recommended Changes

### Priority 1: Shared canonical contract module

Create a dedicated module that owns:

- canonical raw-match document shape
- stat key list and canonical aliases
- availability semantics
- provenance structure
- contract validators and readers
- canonical match metadata helpers

This module should be the only place allowed to define persisted Footywire stat semantics.

### Priority 2: Contract-only downstream readers

Refactor read-model builders to read only the canonical contract for repaired scopes.

Compatibility behavior, if still required during migration, should:

- live in one adapter
- be explicitly marked temporary
- be removable without rewriting downstream business logic

### Priority 3: Scoped rematerialization

Introduce rebuild APIs and jobs that can target:

- a round
- a set of matches
- a set of players
- a bounded season scope

Full-season rebuilds should remain available for recovery and backfills, but they should not be the default response to a small repair.

### Priority 4: Explicit import and rebuild security model

Define and document:

- who can import
- who can rebuild
- which environments allow local bypasses
- what auditing exists for raw-data mutation and publication

The policy should be explicit enough that staging and production-like environments do not rely on implicit defaults.

## What Should Not Change

The following architectural choices still make sense and should be preserved:

- Firestore as the canonical persistence boundary for resolved Footywire event data
- Prisma read models for app-serving performance and query ergonomics
- provenance tracking and stat-availability semantics
- reconciliation workflows used to prove convergence and detect drift

The problem is not that the architecture has too many layers. The problem is that semantic interpretation has not yet been fully collapsed into one authoritative contract boundary.

## Decision

Yes, changes are needed.

The optimal long-term solution is:

- one shared canonical contract module
- one persisted semantic source
- zero permanent parallel downstream stat readers
- scoped rematerialization by affected data slice
- explicit security for import and rebuild operations

This is the minimum coherent set of changes required to make the system actually match the stated guidance around centralized data management, common vocabulary, restricted data movement, curation, and security.

## MotherDuck Position

MotherDuck should be introduced as a governed analytical mirror, not as a second persisted semantic source. Firestore remains the canonical raw-match contract boundary. MotherDuck tables should be derived from `canonical_stats`, canonical identity, canonical match metadata, and load manifests only.

The long-term promotion path is:

1. mirror Firestore canonical rows into MotherDuck;
2. verify MotherDuck against Firestore for bounded scopes;
3. verify Prisma projections against Firestore and MotherDuck;
4. use MotherDuck for analytics;
5. only after full-season parity, consider warehouse-backed rebuilds or reporting APIs.

Any MotherDuck consumer that reconstructs stats from legacy Firestore fields, `data.stats`, or `raw_row` violates the convergence goal.

## Review Summary

The current system is not pointed in the wrong direction. It already has the core pieces of a centralized curated data hub. The main architectural misalignment is that the canonical Firestore contract is not yet fully enforced end to end, so downstream layers can still recover meaning from raw or legacy shapes.

That is the gap to close first.
