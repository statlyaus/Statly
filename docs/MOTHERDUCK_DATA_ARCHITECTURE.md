# MotherDuck Data Architecture

## Purpose

MotherDuck is Statly's analytical warehouse for canonical AFL data. It is not the operational source of truth for Footywire player-match semantics during the convergence program.

## Source-Of-Truth Boundary

- Firestore `player_match_stats` owns resolved canonical raw player-match documents.
- Prisma owns player identity, aliases, unresolved quarantine, transactional fantasy records, and app-serving read models.
- MotherDuck stores replayable analytical mirrors and verification outputs derived from Firestore and Prisma.

## Canonical Player-Match Flow

1. Footywire/FitzRoy/AFL Tables source rows are canonicalized by ETL.
2. Resolved rows are written to Firestore `player_match_stats` with `canonical_stats`.
3. Firestore rows are exported to NDJSON with a load manifest.
4. NDJSON is loaded into MotherDuck staging tables.
5. Staging rows merge into `statly_warehouse.canonical_player_match`.
6. Current verification proves Firestore canonical exportability, deterministic dry-run load SQL, and Prisma projection convergence for the same season/round scope.
7. After real MotherDuck loads are enabled, warehouse verification must compare MotherDuck rows against Firestore and Prisma projections for the same season/round scope.

## Promotion Rule

Before MotherDuck contains loaded data, the current gate proves export/load readiness only: Firestore canonical rows are exportable, load SQL can be rendered deterministically in dry-run mode, and the existing Prisma projection verifier can be run for the same scope.

Once MotherDuck contains data for a queried scope, analytics should require a warehouse parity verifier for that scope. The future verifier must prove identical row counts, canonical keys, stat values, stat presence, and provenance against Firestore, and must compare the same scope with Prisma projections.

MotherDuck must not serve app-critical read models until a full-season warehouse parity verifier proves identical canonical keys, stat values, stat presence, provenance, and row counts against Firestore and Prisma projections.

## Required Verification

Run:

```bash
npm run warehouse:export:player-matches -- --season=2026 --rounds=0,1
npm run warehouse:load:player-matches -- --manifest=<manifest-path> --dry-run
npm run warehouse:verify:player-matches -- --season=2026 --rounds=0,1 --json
npm run verify:player-read-models -- --season=2026 --rounds=0,1 --json
```

Passing means:

- Firestore rows contain canonical contracts.
- Export rejects zero canonical rows.
- MotherDuck load SQL is deterministic.
- Projection verifier has no `dropped_before_raw` or `dropped_in_projection` failures for the scoped repair.

This current gate does not prove MotherDuck row parity. After real MotherDuck loads are enabled, add a warehouse parity run that compares warehouse rows against Firestore and Prisma projections for counts, keys, values, presence, and provenance before using MotherDuck analytics for that scope.
