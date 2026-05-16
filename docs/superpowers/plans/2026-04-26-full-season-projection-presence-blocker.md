# Full-Season Projection Presence Blocker Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:systematic-debugging, then superpowers:executing-plans. This is a blocker plan created during Gate 7 of `2026-04-26-footywire-program-completion-plan.md`.

**Goal:** Repair the full-season verifier failure where projections contain rows/stats for rounds outside the canonical raw repaired scope.

**Architecture:** Treat this as one failure class: projection rebuild/publication scope drift. Do not mix identity curation, source import, or stat semantics changes into this blocker unless diagnostics prove they are the root cause.

**Tech Stack:** TypeScript, Prisma read models, Firestore `player_match_stats`, `Scripts/verify-player-read-models.ts`, `src/server/readModels/playerReadModels.ts`.

---

## Blocker Summary

The repaired slice passes:

```bash
npm run verify:player-read-models -- --season 2026 --rounds 0,1 --json
npm run verify:player-read-models -- --season 2026 --rounds 0,1 --include-merged-live --json --merged-timeout-ms 120000
```

The full 2026 persisted verifier fails:

```bash
npm run verify:player-read-models -- --season 2026 --json
```

Observed full-season summary:

- `status`: `fail`
- rounds resolved: `0,1,2,3,4,5`
- raw rows: `2049`
- projection rows: `2268`
- issue code: `projection_presence_mismatch`
- issue count: `19813`
- raw drift likely causes: `raw_duplicate_selection=2745`, `unclassified=17068`
- aggregate mismatch players: `77`

Round 2 alone also fails:

```bash
npm run verify:player-read-models -- --season 2026 --rounds 2 --json
```

Observed round 2 summary:

- raw rows: `321`
- projection rows: `337`
- raw stage coverage for all stats: `0`
- projection stage coverage has populated rows
- issue code: `projection_presence_mismatch`
- aggregate mismatch players: `321`

## Goal Assessment

The full program cannot be called complete while projections exist for a wider or different scope than canonical raw rows can verify. The long-term invariant is:

- A projection row may be published only when its source canonical raw row is present, resolvable, and covered by canonical stat presence semantics.
- If raw data for a season/round is not repaired, projections for that scope must either be rebuilt from valid raw data or marked dirty/unpublished.

## Shortcomings Against That Goal

- The repaired scope is rounds `0,1`, but the publication row still reports a season-level publication for 2026.
- `PlayerMatchLogProjection` includes rows for round 2+ that the raw-stage verifier cannot validate.
- Round 2 raw rows are present, but their stage coverage is zero, which indicates raw-stage selection or canonical document quality is not aligned with the projection rows.
- Full-season aggregate summaries include players whose projections are not backed by the current raw-stage verifier result.

## Rewritten Long-Term Solution

Repair this as projection publication/scope drift:

1. Diagnose whether round 2 raw rows lack canonical stats, fail canonical match resolution, fail player identity resolution, or are being filtered by the raw-stage selector.
2. If raw rows are valid but selector skips them, fix `listRawMatchLogStageRows` / `selectBestCanonicalRawRows`.
3. If raw rows are invalid/missing canonical stats, re-import and rematerialize only affected rounds.
4. If projections are stale from a prior wider rebuild, delete/rebuild affected projections from canonical raw rows and keep publication dirty until rankings/rosters are republished.
5. Re-run narrow verifier for round 2, then rounds `2,3,4,5`, then full season.

## PROPOSED EDIT PLAN
Working with: full-season projection presence blocker
Total planned edits: 5

### Edit sequence:
1. Diagnose round 2 raw-stage zero coverage - Purpose: identify whether raw rows are missing canonical stats or being filtered out.
2. Fix the root selector/import/rematerialization cause - Purpose: align raw and projection stage row sets.
3. Rebuild affected round projections only - Purpose: avoid full-season blast radius until round-level correctness is proven.
4. Verify round 2 and remaining failed rounds - Purpose: prove the failure class trends to zero by scope.
5. Re-run full 2026 verifier - Purpose: decide whether full-season completion is now claimable.

## Task 1: Diagnose Round 2 Raw Stage

**Files:**
- Read: `src/server/readModels/playerReadModels.ts`
- Read: `Scripts/verify-player-read-models.ts`
- Read: `Scripts/verify-player-read-models-core.ts`

- [ ] **Step 1: Inspect raw stage rows for round 2**

Run:

```bash
npx tsx -e "import { listRawMatchLogStageRows } from './src/server/readModels/playerReadModels'; const rows = await listRawMatchLogStageRows({ season: 2026, rounds: [2] }); console.log(JSON.stringify({ count: rows.length, sample: rows.slice(0, 5).map((r) => ({ playerId: r.playerId, matchId: r.matchId, roundNumber: r.roundNumber, presentStats: Object.entries(r.stage).filter(([, v]) => v.present).map(([k]) => k).slice(0, 10) })) }, null, 2));"
```

Expected:

- If rows have empty `presentStats`, inspect their Firestore `canonical_stats`.
- If rows are missing expected projection players, inspect player/match resolution.

- [ ] **Step 2: Inspect a known failing player-match**

Use `Aaron Naughton`, `2026-R2-ADE-BUL` from verifier output.

Run a targeted Firestore query or local script to inspect:

- `canonical_stats.version`
- `canonical_stats.availability`
- `canonical_stats.stats`
- `canonical_match_metadata`
- `player_uid`
- `canonical_player_id`
- `round_number`

Expected:

- Determine whether the raw doc is missing canonical stats or whether the raw selector chose a non-canonical/stale duplicate.

## Task 2: Fix The Root Cause

**Files depend on Task 1 result.**

If selector issue:

- Modify: `src/server/readModels/playerReadModels.ts`
- Test: `src/server/readModels/playerReadModels.test.ts`

Acceptance:

- Raw selector prefers canonical docs with populated availability over empty/stale docs.
- Duplicate player-match rows deterministically choose the canonical raw row.

If import/raw data issue:

- Modify: `src/lib/footywireStatsIngestion.ts`
- Modify: `etl/processFootywireData.ts`
- Test: `src/lib/footywireStatsIngestion.test.ts`
- Test: `src/server/processFootywireData.test.ts`

Acceptance:

- Round 2 canonical raw documents contain populated `canonical_stats.stats`, `availability`, and `provenance`.

If stale projection issue:

- Modify: `src/server/readModels/playerReadModels.ts`
- Test: `src/server/readModels/playerReadModels.test.ts`

Acceptance:

- Partial refresh deletes or replaces projection rows for affected players/rounds.
- Publication remains dirty until ranking and roster projections are republished.

## Task 3: Rematerialize Affected Scope

Run the narrow repair command after implementation:

```bash
npm run build:player-read-models -- --mode refresh --season 2026 --rounds 2
```

If the script name differs, use the actual package script that invokes `Scripts/build-player-read-models.ts`.

Expected:

- Output includes `refreshedRounds: [2]`.
- Output includes `rankingsDirty: true` and `rostersDirty: true`.
- Output includes a verifier command for round 2.

## Task 4: Verify Narrow Scopes

Run:

```bash
npm run verify:player-read-models -- --season 2026 --rounds 2 --json
npm run verify:player-read-models -- --season 2026 --rounds 2,3,4,5 --json
```

Expected:

- `projection_presence_mismatch` is zero for repaired rounds.
- Raw/projection row counts match for repaired rounds.
- `aggregateMismatchPlayers` is zero for repaired rounds.

## Task 5: Verify Full Season

Run:

```bash
npm run verify:player-read-models -- --season 2026 --json
```

Expected:

- If pass: return to Gate 8 of the completion plan.
- If fail with a different class: create a new blocker plan for the next single failure class.
- If fail with the same class: return to Task 1 and inspect the next sample mismatch.

## Stop Conditions

Stop if:

- Round 2 raw documents are genuinely unrepaired source imports, because the correct next action is bounded re-import before selector changes.
- The fix would require deleting broad season projections without a verified rebuild path.
- The verifier exposes unresolved player-directory gaps; create a separate identity-curation blocker rather than mixing concerns.
