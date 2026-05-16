# Raw Merged Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the remaining 2026 rounds 0-1 raw-stage verifier drift by making the Firestore canonical raw document contract faithfully represent the authoritative merged Footywire ingest contract.

**Architecture:** Diagnose the exact stage where semantics diverge, then fix that stage only. The long-term solution is not another reader or projection fallback; it is one canonical raw persistence boundary with shared stat keys, explicit presence semantics, durable provenance, deterministic source priority, and bounded rematerialization for the affected slice.

**Tech Stack:** TypeScript, Next.js server code, Prisma, Firebase Admin Firestore, Vitest, existing Footywire canonical contract helpers.

---

## Goal Assessment

The current goal is sound: remove the remaining `dropped_before_raw` and related raw drift classes for a bounded 2026 rounds 0-1 repair slice while preserving the projection convergence already achieved.

The key invariant is:

```ts
// For every authoritative merged Footywire player-match stat:
// if merged.present === true, then canonical Firestore raw must preserve:
// - the same canonical stat key
// - availability true
// - the canonical value
// - provenance
// - source priority
```

The system is not done when projections look correct. It is done when Firestore raw docs are the reliable semantic contract and downstream projections merely consume that contract.

## Shortcomings In The Previous Plan

- It assumed the raw writer was likely the fault before proving whether drift came from merged construction, Firestore write payloads, stale duplicate raw selection, or verifier comparison semantics.
- It used “materially decreases” as an acceptable verifier target. That is too weak for the repaired slice; the target for player-directory-caused `dropped_before_raw` is zero, and any residual raw drift must be explicitly classified.
- It suggested replaying unresolved rows, but replay only repairs rows gated by player identity. It may not rewrite stale canonical raw documents whose identity is already resolved.
- It did not define a source-of-truth decision table for `footywire_match`, `fitzroy_merged`, `afltables`, and legacy top-level fields.
- It allowed conditional edits to read models without a hard prohibition on changing projection semantics to mask raw drift.
- Some test instructions were intent-only. The rewritten plan makes each test prove a named invariant.

## Rewritten Long-Term Solution

Fix convergence in this order:

1. Classify every remaining verifier failure by stage and cause.
2. Define one source-priority contract at the canonical raw boundary.
3. Add failing tests for the specific breached invariant.
4. Fix the earliest stage that breaches the invariant.
5. Rematerialize the affected raw and projection slice.
6. Re-run verifier and accept only zero unclassified failures.

Projection code should only change if diagnostics prove it is selecting the wrong canonical raw document among duplicate raw rows. It must not reinterpret raw semantics.

---

## File Structure

- Modify: `Scripts/verify-player-read-models.ts`
  - Add compact raw-drift diagnostics that classify each failure by entity, stat, merged state, raw state, projection state, source name, and likely cause.
- Modify: `src/lib/stats/footywireCanonicalContract.ts`
  - Own canonical stat vocabulary, availability semantics, provenance semantics, and source-priority ranking.
- Modify: `src/lib/footywireStatsIngestion.ts`
  - Use the canonical contract helper when writing Firestore raw documents.
- Modify: `etl/processFootywireData.ts`
  - Only if diagnostics prove merged row construction loses canonical stats before ingestion.
- Modify: `src/server/readModels/playerReadModels.ts`
  - Only if diagnostics prove duplicate raw docs exist and the selector chooses a lower-priority raw document.
- Modify or create: a bounded raw rematerialization script if no existing command rewrites canonical raw docs for already-resolved rows.
  - Prefer extending an existing repair/replay script over creating a new broad backfill path.
- Test: `src/lib/footywireStatsIngestion.test.ts`
  - Prove Firestore raw writes preserve advanced stat value, availability, provenance, and source priority.
- Test: `src/server/processFootywireData.test.ts`
  - Only if ETL merged construction is implicated.
- Test: `src/server/readModels/playerReadModels.test.ts`
  - Only if duplicate raw selection is implicated.

---

## PROPOSED EDIT PLAN
Working with: `Scripts/verify-player-read-models.ts`, `src/lib/stats/footywireCanonicalContract.ts`, `src/lib/footywireStatsIngestion.ts`, `etl/processFootywireData.ts`, `src/server/readModels/playerReadModels.ts`
Total planned edits: 6

### Edit sequence:
1. Add raw-drift classification diagnostics - Purpose: identify the breached invariant before changing write/read behavior.
2. Define canonical source-priority and presence contract - Purpose: ensure every stage uses the same rules for `footywire_match`, `fitzroy_merged`, `afltables`, and legacy fields.
3. Add failing invariant tests at the breached stage - Purpose: prevent speculative implementation and prove the current gap.
4. Repair the earliest breached stage - Purpose: centralize semantics at the canonical persistence boundary, not downstream.
5. Add or extend bounded raw rematerialization - Purpose: rewrite affected canonical raw docs even when player identity is already resolved.
6. Rematerialize projections and verify convergence - Purpose: prove the repaired slice no longer depends on legacy semantic readers.

Dependencies:
- Edit 1 must complete before edits 2-5.
- Edit 2 must complete before writer or selector changes.
- Edit 3 must fail before edit 4 and pass after edit 4.
- Edit 5 is required if existing replay scripts do not rewrite already-resolved stale raw docs.
- Edit 6 is the acceptance gate.

---

### Task 1: Add Raw-Drift Classification Diagnostics

**Files:**
- Modify: `Scripts/verify-player-read-models.ts`

- [ ] **Step 1: Locate reconciliation issue construction**

Run:

```bash
rg -n "dropped_before_raw|raw_presence_mismatch|raw_provenance_mismatch|raw_value_mismatch|downstream_without_merged|sampleMatchMismatches|matchLogIssues" Scripts/verify-player-read-models.ts
```

Expected:
- Find where merged, raw, and projection stage snapshots are compared.
- Find where issue codes are attached.
- Find where JSON output is assembled.

- [ ] **Step 2: Add compact diagnostics**

Add an output field named `rawDriftDiagnostics` with entries shaped like:

```ts
type RawDriftDiagnostic = {
  code: string;
  likelyCause:
    | 'merged_missing_raw_present'
    | 'raw_missing_merged_present'
    | 'raw_value_differs'
    | 'raw_provenance_differs'
    | 'raw_duplicate_selection'
    | 'projection_extra_without_merged'
    | 'unclassified';
  statKey: string;
  matchId: string;
  storageMatchId?: string | null;
  playerId: string;
  storagePlayerId?: string | null;
  playerName: string;
  mergedPresent: boolean;
  rawPresent: boolean;
  projectionPresent: boolean;
  mergedValue: number | null;
  rawValue: number | null;
  projectionValue: number | null;
  mergedProvenance: string | null;
  rawProvenance: string | null;
};
```

Classification rules:
- `raw_missing_merged_present`: merged present, raw absent.
- `merged_missing_raw_present`: merged absent, raw present.
- `raw_value_differs`: merged present, raw present, values differ.
- `raw_provenance_differs`: merged present, raw present, provenance differs.
- `projection_extra_without_merged`: projection present while merged absent.
- `raw_duplicate_selection`: only if existing stage data already exposes different storage IDs for the same canonical player-match.
- `unclassified`: any issue not covered above.

Do not add new database or Firestore queries in the verifier for this task.

- [ ] **Step 3: Run diagnostics**

Run:

```bash
npm run verify:player-read-models -- --season=2026 --rounds=0,1 --limit=25 --json
```

Expected:
- The command may exit `1`.
- JSON includes `rawDriftDiagnostics`.
- At least the first 25 issue samples have non-`unclassified` likely causes unless the current stage data lacks the required fields.

---

### Task 2: Define Canonical Source-Priority And Presence Contract

**Files:**
- Modify: `src/lib/stats/footywireCanonicalContract.ts`

- [ ] **Step 1: Add or reuse a source-priority helper**

Define one shared ranking helper if it does not already exist:

```ts
export const FOOTYWIRE_CANONICAL_SOURCE_PRIORITY = [
  'fitzroy_merged',
  'footywire_match',
  'afltables',
  'legacy_top_level',
] as const;

export type FootywireCanonicalSource = (typeof FOOTYWIRE_CANONICAL_SOURCE_PRIORITY)[number];

export function rankFootywireCanonicalSource(source: string | null | undefined): number {
  const index = FOOTYWIRE_CANONICAL_SOURCE_PRIORITY.indexOf(source as FootywireCanonicalSource);
  return index === -1 ? FOOTYWIRE_CANONICAL_SOURCE_PRIORITY.length : index;
}
```

If equivalent constants already exist, consolidate references to the existing names instead of duplicating them.

- [ ] **Step 2: Add a presence helper**

Define a helper that makes missing, absent, and zero explicit:

```ts
export function isCanonicalStatPresent(params: {
  availabilityValue: boolean | null | undefined;
  rawValue: number | null | undefined;
}): boolean {
  if (params.availabilityValue != null) return params.availabilityValue;
  return params.rawValue != null;
}
```

Zero is present when availability is true or when the raw value is numeric zero and no explicit availability says false.

- [ ] **Step 3: Add tests for helper behavior**

Run after tests are added:

```bash
npm test -- --run src/lib/footywireStatsIngestion.test.ts src/lib/__tests__/playerMatchStats.test.ts
```

Expected:
- Source ranking and zero-presence tests pass.

---

### Task 3: Add Failing Invariant Tests At The Breached Stage

**Files:**
- Modify: `src/lib/footywireStatsIngestion.test.ts`
- Modify: `src/server/processFootywireData.test.ts` only if diagnostics identify ETL loss.
- Modify: `src/server/readModels/playerReadModels.test.ts` only if diagnostics identify duplicate raw selection.

- [ ] **Step 1: Test raw writer preservation when diagnostics show raw missing merged-present stats**

Add a test named:

```ts
it('preserves merged Footywire advanced stat presence and provenance in canonical raw documents', async () => {
  const saved = await writeSingleCanonicalRawDocForTest({
    playerName: 'Example Player',
    team: 'Western Bulldogs',
    matchId: '2026-R1-BUL-GWS',
    canonical_stats: {
      version: 1,
      source_name: 'fitzroy_merged',
      stats: {
        score_involvements: 4,
        effective_disposals: 7,
        disposal_efficiency: 100,
        intercepts: 3,
        metres_gained: 192,
        turnovers: 1,
      },
      availability: {
        score_involvements: true,
        effective_disposals: true,
        disposal_efficiency: true,
        intercepts: true,
        metres_gained: true,
        turnovers: true,
      },
      provenance: {
        score_involvements: 'footywire_match',
        effective_disposals: 'footywire_match',
        disposal_efficiency: 'footywire_match',
        intercepts: 'footywire_match',
        metres_gained: 'footywire_match',
        turnovers: 'footywire_match',
      },
      source_priority: ['fitzroy_merged', 'footywire_match', 'afltables'],
      raw_source_rows: null,
    },
  });

  expect(saved.canonical_stats.stats.score_involvements).toBe(4);
  expect(saved.canonical_stats.availability.score_involvements).toBe(true);
  expect(saved.canonical_stats.provenance.score_involvements).toBe('footywire_match');
  expect(saved.canonical_stats.source_priority[0]).toBe('fitzroy_merged');
});
```

Adapt helper names to existing test utilities. Do not introduce a production-only helper just for the test.

- [ ] **Step 2: Test duplicate raw selection only when diagnostics prove duplicate selection**

If needed, add:

```ts
it('selects the highest-priority canonical raw document for a canonical player-match', async () => {
  const selected = await selectBestCanonicalRawRowsForTest([
    {
      player_id: 'james_odonnell',
      player_name: "James O'Donnell",
      match_id: '2026-R1-BUL-GWS',
      canonical_stats: {
        source_name: 'afltables',
        source_priority: ['afltables'],
        stats: { kicks: 5 },
        availability: { kicks: true },
        provenance: { kicks: 'afltables' },
      },
    },
    {
      player_id: 'james_odonnell',
      player_name: "James O'Donnell",
      match_id: '2026-R1-BUL-GWS',
      canonical_stats: {
        source_name: 'fitzroy_merged',
        source_priority: ['fitzroy_merged', 'footywire_match', 'afltables'],
        stats: { kicks: 4 },
        availability: { kicks: true },
        provenance: { kicks: 'footywire_match' },
      },
    },
  ]);

  expect(selected[0]?.data.canonical_stats.source_name).toBe('fitzroy_merged');
  expect(selected[0]?.data.canonical_stats.stats.kicks).toBe(4);
});
```

- [ ] **Step 3: Run failing test**

Run the smallest implicated test command:

```bash
npm test -- --run src/lib/footywireStatsIngestion.test.ts
```

Expected:
- At least one new invariant test fails before implementation.

---

### Task 4: Repair The Earliest Breached Stage

**Files:**
- Modify: `src/lib/footywireStatsIngestion.ts`
- Modify: `etl/processFootywireData.ts` only if Task 1/3 proves ETL loss.
- Modify: `src/server/readModels/playerReadModels.ts` only if Task 1/3 proves duplicate selection.

- [ ] **Step 1: Repair raw writer if writer loses canonical stats**

Implementation invariant:

```ts
// Writer input canonical_stats must be persisted without recomputing semantic meaning.
// The writer may normalize field names to the persisted contract.
// The writer must not infer absence from zero.
// The writer must not replace footywire_match provenance with afltables.
```

The writer should use a single canonical payload builder. It must not maintain a second independent stat mapping table.

- [ ] **Step 2: Repair ETL only if merged output already loses data**

Implementation invariant:

```ts
// ETL merged output must emit canonical stats with:
// - canonical stat keys
// - explicit availability
// - provenance per stat
// - source priority
// - raw source row references when available
```

Do not push ETL-only semantics downstream into ingestion.

- [ ] **Step 3: Repair duplicate raw selection only if selector chooses stale docs**

Selection invariant:

```ts
// For the same canonical player-match, select the row with the best canonical source.
// Prefer fitzroy_merged, then footywire_match, then afltables, then legacy top-level data.
// Use updated_at only as a tiebreaker inside the same source rank.
```

Do not select by newest timestamp alone if that can prefer lower-priority legacy data.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- --run src/lib/footywireStatsIngestion.test.ts src/server/processFootywireData.test.ts src/server/readModels/playerReadModels.test.ts
```

Expected:
- New failing invariant tests now pass.
- Existing projection convergence tests still pass.

---

### Task 5: Add Or Extend Bounded Raw Rematerialization

**Files:**
- Modify: existing replay/repair script if suitable.
- Create: `Scripts/rematerialize-canonical-raw-match-stats.ts` only if no existing script can safely rewrite already-resolved stale raw docs.

- [ ] **Step 1: Check whether existing scripts rewrite resolved stale raw docs**

Run:

```bash
rg -n "replayUnresolvedPlayerStatRows|canonical_stats|player_match_stats|dryRun|rounds" Scripts src/server src/lib
```

Expected:
- Determine whether existing replay only handles unresolved identity rows or can also rewrite canonical raw documents by season/round.

- [ ] **Step 2: Add bounded rematerialization if required**

Required CLI behavior:

```bash
npx tsx Scripts/rematerialize-canonical-raw-match-stats.ts --season=2026 --rounds=0,1 --dry-run
npx tsx Scripts/rematerialize-canonical-raw-match-stats.ts --season=2026 --rounds=0,1
```

Required safety behavior:
- Requires `--season`.
- Requires `--rounds` unless `--all-rounds` is explicitly passed.
- Supports `--dry-run`.
- Reports scanned, rewritten, skipped, and failed counts.
- Does not delete raw docs.
- Does not write projection tables.

- [ ] **Step 3: Add script tests if script logic is non-trivial**

Test the pure planner function:

```ts
it('plans rewrites only for bounded season-round raw docs with stale canonical stats', () => {
  const plan = planCanonicalRawRematerialization({
    season: 2026,
    rounds: [0, 1],
    rawDocs: [
      { id: 'stale', season: 2026, round_number: 1, canonical_stats: null },
      { id: 'other-round', season: 2026, round_number: 2, canonical_stats: null },
    ],
  });

  expect(plan.toRewrite.map((row) => row.id)).toEqual(['stale']);
});
```

---

### Task 6: Operational Verification Gate

**Files:**
- No source edits unless verification exposes a new breached invariant.

- [ ] **Step 1: Run focused test suite**

Run:

```bash
npm test -- --run src/lib/footywireStatsIngestion.test.ts src/server/processFootywireData.test.ts src/server/readModels/playerReadModels.test.ts
```

Expected:
- All focused tests pass.

- [ ] **Step 2: Run unresolved identity audit**

Run:

```bash
npx tsx Scripts/audit-unresolved-player-directory.ts --season=2026 --rounds=0,1 --limit=1000 --json
```

Expected:
- `groups: []`

- [ ] **Step 3: Run bounded raw rematerialization or confirmed equivalent**

Run one of:

```bash
npx tsx Scripts/rematerialize-canonical-raw-match-stats.ts --season=2026 --rounds=0,1 --dry-run
npx tsx Scripts/rematerialize-canonical-raw-match-stats.ts --season=2026 --rounds=0,1
```

or, if existing replay is confirmed sufficient:

```bash
npx tsx Scripts/replay-unresolved-player-stat-rows.ts --season=2026 --limit=500 --dry-run
npx tsx Scripts/replay-unresolved-player-stat-rows.ts --season=2026 --limit=500
```

Expected:
- `stillAmbiguous: 0` when using replay.
- Bounded raw rewrite reports no out-of-scope season/round writes.

- [ ] **Step 4: Refresh bounded read models**

Run:

```bash
npx tsx -e "import './src/lib/loadEnv'; import { refreshPlayerReadModels } from './src/server/readModels/playerReadModels'; (async () => { const result = await refreshPlayerReadModels({ season: 2026, rounds: [0, 1] }); console.log(JSON.stringify(result, null, 2)); })().catch((error) => { console.error(error); process.exit(1); });"
```

Expected:
- `skippedWithoutCanonicalId: 0`
- `skippedWithoutResolvedPlayerProfile: 0`
- `degradedAdvancedStats: []`

- [ ] **Step 5: Run final verifier**

Run:

```bash
npm run verify:player-read-models -- --season=2026 --rounds=0,1 --limit=25 --json
```

Acceptance criteria:
- `dropped_in_projection` absent.
- `aggregateMismatchPlayers: 0`.
- `dropped_before_raw: 0` for identity/normalization-caused failures.
- Any remaining `raw_presence_mismatch`, `raw_provenance_mismatch`, `raw_value_mismatch`, or `downstream_without_merged` is classified by `rawDriftDiagnostics` with concrete samples and a follow-up plan.

Do not claim completion if a failure class remains unclassified.

---

## Review Checklist

- [ ] Firestore raw canonical docs remain the single persisted semantic contract.
- [ ] No projection-only fallback reader is added.
- [ ] No permanent parallel raw semantic reader is added.
- [ ] Missing, zero, and absent semantics are explicit through `availability`.
- [ ] Provenance survives ETL, ingestion, Firestore persistence, raw selection, and projection.
- [ ] Source priority is shared from the canonical contract helper.
- [ ] Rematerialization is bounded to 2026 rounds 0-1 unless a broader command is explicitly approved.
- [ ] `dropped_in_projection` remains gone.
- [ ] Aggregate mismatches remain zero.
- [ ] Remaining verifier failures, if any, are classified with concrete samples and not hidden downstream.
