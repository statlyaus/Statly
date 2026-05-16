# Player Directory Curation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the next bounded set of true Footywire player-directory gaps by converting unresolved source rows into evidence-backed canonical identity facts, then replaying those rows through the canonical raw-match contract into refreshed read models.

**Architecture:** The resolver now supports season-aware registrations and scoped aliases, so the next work should be evidence-backed curation plus stronger audit output, not another semantic reader. `Player`, `PlayerSeasonRegistration`, and `PlayerAlias` remain the identity contract; unresolved rows are only inputs for reviewed repair decisions and evidence capture. Rebuilds stay bounded to affected season/round slices to avoid full-season transaction risk.

**Tech Stack:** Prisma, TypeScript, tsx scripts, Firestore Admin SDK, Vitest, Next.js app data model.

---

## Goal Assessment

The product goal is app-facing AFL player stats that converge from Footywire source rows into canonical raw Firestore documents and Prisma read models without dropping player rows because the directory cannot identify a player.

The engineering goal for this phase is narrower:

- Convert the remaining high-value unresolved rows from "unknown player identity" into reviewed, evidence-backed directory facts.
- Preserve canonical contract ownership at the identity directory boundary.
- Re-run replay and bounded read-model refresh so projections consume the same canonical facts.
- Prove the repaired scope no longer depends on punctuation, short-name drift, mutable current-club inference, or undocumented manual judgment.

## Current Shortcomings Against That Goal

- `src/data/playerDirectoryRepairs2026.ts` is empty, so the repair engine has no reviewed data to apply for the remaining unresolved rows.
- `Scripts/audit-unresolved-player-directory.ts` surfaces groups and near matches, but it does not classify whether a row likely needs a new player, a season registration, an alias, or dismissal.
- The repair-plan shape validates `approvedBy` and `notes`, but it does not preserve structured evidence such as source document IDs, source player/team strings, or review confidence.
- The first plan version allowed curation directly in `src/data/playerDirectoryRepairs2026.ts`; that is too easy to turn into untraceable manual data entry.
- The first plan version treated audit recommendations as if they could drive repairs. They should only prioritize review; identity facts still require evidence.
- Current verification shows `rawRows` and `projectionRows` align for the bounded slice, but `dropped_before_raw` remains because source rows still cannot be resolved into canonical player IDs.
- Full-season read-model refresh can exceed Prisma transaction duration, so verification must use bounded season/round repair slices until refresh batching is improved.
- Adding player facts without evidence would create a worse long-term design than leaving rows unresolved, because it would pollute the canonical identity contract.

## Rewritten Target State

After this plan, the repaired slice should have reviewed identity data encoded in `PlayerDirectoryRepairPlan`:

- True new players are added as canonical `Player` records.
- Existing players at source-row clubs are represented with `PlayerSeasonRegistration`, not by overwriting current `Player.club`.
- Source spelling or display-name drift is represented with scoped `PlayerAlias`.
- Non-player or invalid source rows are explicitly marked through `unresolvedDecisions`.
- Every player, registration, alias, and unresolved decision records structured evidence in addition to human notes.
- Audit recommendations are treated as triage hints, not authority.
- Replay writes canonical raw data for newly resolvable rows, bounded read-model refresh republishes affected projections, and verifier output shows improvement for the targeted slice.

## File Map

- Modify: `src/server/playerDirectoryRepair.ts`
  - Responsibility: audit unresolved groups, validate evidence-backed repair plans, apply players, aliases, registrations, and unresolved decisions.
- Modify: `src/server/playerDirectoryRepair.test.ts`
  - Responsibility: protect repair validation and audit classification behavior.
- Modify: `Scripts/audit-unresolved-player-directory.ts`
  - Responsibility: expose the improved audit output to curation workflows.
- Modify: `src/data/playerDirectoryRepairs2026.ts`
  - Responsibility: reviewed 2026 repair plan data only; no executable logic and no unsupported identity inference.
- Read/use: `Scripts/repair-player-directory.ts`
  - Responsibility: dry-run and apply the reviewed plan.
- Read/use: `Scripts/replay-unresolved-player-stat-rows.ts`
  - Responsibility: replay newly resolvable unresolved rows into canonical raw documents.
- Read/use: `Scripts/build-player-read-models.ts`
  - Responsibility: bounded read-model refresh for repaired season/round scope.
- Read/use: `Scripts/verify-player-read-models.ts`
  - Responsibility: convergence verification for the repaired slice.

## PROPOSED EDIT PLAN
Working with: `src/server/playerDirectoryRepair.ts`, `src/server/playerDirectoryRepair.test.ts`, `Scripts/audit-unresolved-player-directory.ts`, `src/data/playerDirectoryRepairs2026.ts`
Total planned edits: 6

### Edit sequence:
1. Add structured evidence fields to repair-plan entries - Purpose: make identity curation auditable and repeatable.
2. Add audit classification metadata - Purpose: prioritize unresolved groups without adding a new semantic reader.
3. Add tests for evidence validation, classification, and repair-plan guardrails - Purpose: prevent ambiguous or unsupported identity data entering the canonical directory.
4. Populate the first reviewed 2026 repair batch - Purpose: repair true directory gaps through evidence-backed players, registrations, aliases, and decisions.
5. Dry-run and apply the repair batch - Purpose: update the identity directory only after validation proves the plan is safe.
6. Replay, refresh, and reconcile the affected slice - Purpose: prove canonical raw data and projections consume the repaired identity facts.

Dependencies:

- Edit 1 must precede curation because every repair entry needs structured evidence before data is added.
- Edit 2 must precede curation because recommendations help prioritize review but must not authorize repairs.
- Edit 3 must pass before Edit 4 to protect curation mistakes.
- Edit 4 depends on reviewed evidence from audit output and source records.
- Edit 5 depends on a valid repair plan.
- Edit 6 depends on successful repair application.

## Task 1: Add Structured Evidence to Repair Entries

**Files:**
- Modify: `src/server/playerDirectoryRepair.ts`
- Modify: `src/server/playerDirectoryRepair.test.ts`
- Modify: `src/data/playerDirectoryRepairs2026.ts`

- [ ] **Step 1: Write the failing evidence validation test**

Add a test that rejects a player repair without source evidence:

```ts
const validation = await validatePlayerDirectoryRepairPlan(prisma, {
  players: [
    {
      id: 'western-bulldogs-jordan-croft',
      name: 'Jordan Croft',
      club: 'Western Bulldogs',
      position: 'FWD',
      approvedBy: 'manual-review-2026-04-26',
      notes: 'Reviewed from unresolved Footywire 2026 rounds 0-1 audit.',
    },
  ],
  aliases: [],
  registrations: [],
  unresolvedDecisions: [],
});

expect(validation.errors).toContain(
  'Player western-bulldogs-jordan-croft is missing evidence.sourceDocumentIds'
);
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm test -- --run /Users/robert/Developer/Statly/src/server/playerDirectoryRepair.test.ts
```

Expected: fail because repair entries do not yet require structured evidence.

- [ ] **Step 3: Add evidence types**

Add this type and attach it to every repair entry type:

```ts
export type PlayerDirectoryRepairEvidence = {
  source: 'footywire-unresolved-row';
  sourceDocumentIds: string[];
  sourcePlayerName: string;
  sourceTeam?: string | null;
  reviewedAt: string;
};
```

Update:

```ts
PlayerDirectoryPlayerRepair
PlayerDirectoryAliasRepair
PlayerDirectoryRegistrationRepair
PlayerDirectoryUnresolvedDecision
```

Each should include:

```ts
evidence: PlayerDirectoryRepairEvidence;
```

- [ ] **Step 4: Validate evidence fields**

Add `requireEvidenceFields(item, label, errors)` that enforces:

- `evidence.source === 'footywire-unresolved-row'`
- `evidence.sourceDocumentIds` is a non-empty array of non-empty strings
- `evidence.sourcePlayerName` is non-empty
- `evidence.reviewedAt` is a valid ISO date string

- [ ] **Step 5: Preserve backward-safe application behavior**

Do not add new database columns in this task. Store evidence in existing `notes` by appending a compact suffix:

```ts
` Evidence: ${JSON.stringify(item.evidence)}`
```

This is intentionally transitional. It improves auditability now without creating a schema migration before we know the evidence model is stable.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- --run /Users/robert/Developer/Statly/src/server/playerDirectoryRepair.test.ts
```

Expected: pass.

## Task 2: Add Audit Classification Metadata

**Files:**
- Modify: `src/server/playerDirectoryRepair.ts`
- Modify: `Scripts/audit-unresolved-player-directory.ts`
- Test: `src/server/playerDirectoryRepair.test.ts`

- [ ] **Step 1: Write the failing audit classification test**

Add a test that expects unresolved groups to include a recommendation derived from near matches:

```ts
expect(groups[0]).toMatchObject({
  playerName: 'Jordan Croft',
  team: 'Western Bulldogs',
  recommendedRepair: {
    action: 'candidate_player_or_registration',
    reason: 'no_directory_match',
  },
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm test -- --run /Users/robert/Developer/Statly/src/server/playerDirectoryRepair.test.ts
```

Expected: fail because `recommendedRepair` does not exist.

- [ ] **Step 3: Implement minimal classification**

Extend `UnresolvedPlayerDirectoryAuditGroup` with:

```ts
recommendedRepair: {
  action:
    | 'candidate_alias'
    | 'candidate_registration'
    | 'candidate_player_or_registration'
    | 'manual_review';
  reason: 'name_variant' | 'same_surname' | 'same_team_and_surname' | 'no_directory_match';
};
```

Classification rules:

- `name_variant` near match with same normalized club: `candidate_alias`.
- `name_variant` near match on a different current club: `candidate_registration`.
- `same_team_and_surname` near match: `manual_review`.
- `same_surname` only: `manual_review`.
- no near matches: `candidate_player_or_registration`.

Use these action names:

```ts
recommendedRepair: {
  action:
    | 'candidate_alias'
    | 'candidate_registration'
    | 'candidate_player_or_registration'
    | 'manual_review';
  reason: 'name_variant' | 'same_surname' | 'same_team_and_surname' | 'no_directory_match';
};
```

The `candidate_` prefix is deliberate: the audit output ranks likely repair types but does not authorize identity mutation.

- [ ] **Step 4: Surface classification in the audit CLI**

Update each printed group in `Scripts/audit-unresolved-player-directory.ts` to include:

```ts
`recommendation=${group.recommendedRepair.action}:${group.recommendedRepair.reason}`
```

JSON output should automatically include the field.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- --run /Users/robert/Developer/Statly/src/server/playerDirectoryRepair.test.ts
```

Expected: pass.

## Task 3: Strengthen Repair Plan Guardrails

**Files:**
- Modify: `src/server/playerDirectoryRepair.ts`
- Modify: `src/server/playerDirectoryRepair.test.ts`

- [ ] **Step 1: Write failing validation tests**

Add tests for:

```ts
expect(validation.errors).toContain(
  'Registration test-player 2026 Western Bulldogs duplicates a player-club-season identity'
);
```

And:

```ts
expect(validation.errors).toContain(
  'Alias J Croft -> player-a would create an ambiguous alias scope'
);
```

- [ ] **Step 2: Run tests and verify failures**

Run:

```bash
npm test -- --run /Users/robert/Developer/Statly/src/server/playerDirectoryRepair.test.ts
```

Expected: fail until duplicate player-season-club and ambiguous alias cases are enforced exactly.

- [ ] **Step 3: Implement guardrails**

Keep the current database unique key of `playerId|season|normalizedClub`, and add an additional validation map for:

```ts
`${season}|${normalizedClub}|${normalizeLookupPart(player.name)}`
```

This prevents duplicate canonical entries for the same person/club/season when a plan accidentally creates a new player instead of registering an existing player.

Also reject plans where:

- a newly created player has no same-player registration for the repaired season and source club
- an alias omits `seasonFrom` or `seasonTo` for a season-specific source-row repair
- an unresolved decision uses `DISMISSED` without a note beginning with `Dismissed:`

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- --run /Users/robert/Developer/Statly/src/server/playerDirectoryRepair.test.ts
```

Expected: pass.

## Task 4: Populate Reviewed 2026 Repair Batch

**Files:**
- Modify: `src/data/playerDirectoryRepairs2026.ts`

- [ ] **Step 1: Generate the audit input**

Run:

```bash
npx tsx Scripts/audit-unresolved-player-directory.ts --season=2026 --rounds=0,1 --limit=100 --json
```

Expected: JSON groups ordered by club and normalized player name, including recommendations and near matches.

- [ ] **Step 2: Curate only evidence-backed entries**

Use the audit output and source records to fill `playerDirectoryRepairs2026` with reviewed entries. Each entry must include:

```ts
approvedBy: 'manual-review-2026-04-26',
notes: 'Reviewed from unresolved Footywire 2026 rounds 0-1 audit; source row uses <name/team>.',
evidence: {
  source: 'footywire-unresolved-row',
  sourceDocumentIds: ['<sourceDocumentId>'],
  sourcePlayerName: '<playerName from unresolved row>',
  sourceTeam: '<team from unresolved row>',
  reviewedAt: '2026-04-26',
},
```

Required classification handling:

- If the player exists but current `Player.club` differs from the source-row club, add `registrations` only after confirming it is the same person.
- If the player exists and source-row name differs only by spelling/display form, add `aliases` scoped to `seasonFrom: 2026` and `seasonTo: 2026`.
- If the player is absent from `Player`, add `players` and a matching `registrations` entry in the same batch.
- If the source row is not a valid AFL player stat row, add `unresolvedDecisions` with `status: 'DISMISSED'` and a note beginning with `Dismissed:`.

- [ ] **Step 3: Keep the batch bounded**

Limit the first batch to rounds `0,1` and the first 100 unresolved rows. Do not mix in broader season repairs until this batch verifies cleanly.

## Task 5: Dry-Run and Apply Repair Batch

**Files:**
- Read/use: `Scripts/repair-player-directory.ts`
- Read/use: `src/data/playerDirectoryRepairs2026.ts`

- [ ] **Step 1: Dry-run the repair plan**

Run:

```bash
npx tsx Scripts/repair-player-directory.ts
```

Expected:

- `valid: true`
- non-zero `playersToCreate`, `aliasesToCreate`, `registrationsToCreate`, or `unresolvedDecisionsToApply`
- no ambiguity errors

- [ ] **Step 2: Fix validation errors if present**

If validation fails, edit only `src/data/playerDirectoryRepairs2026.ts` unless the failure proves a missing guardrail in `src/server/playerDirectoryRepair.ts`.

- [ ] **Step 3: Apply the repair plan**

Run:

```bash
npx tsx Scripts/repair-player-directory.ts --apply
```

Expected:

- `applied: true`
- validation remains `valid: true`

## Task 6: Replay, Refresh, and Reconcile

**Files:**
- Read/use: `Scripts/replay-unresolved-player-stat-rows.ts`
- Read/use: `Scripts/build-player-read-models.ts`
- Read/use: `Scripts/verify-player-read-models.ts`

- [ ] **Step 1: Replay unresolved rows as a dry run**

Run:

```bash
npx tsx Scripts/replay-unresolved-player-stat-rows.ts --season=2026 --limit=100 --dry-run
```

Expected: `replayed` is greater than the previous baseline for the same limit.

- [ ] **Step 2: Apply replay**

Run:

```bash
npx tsx Scripts/replay-unresolved-player-stat-rows.ts --season=2026 --limit=100
```

Expected: newly resolvable rows are written to canonical raw Firestore documents.

- [ ] **Step 3: Refresh bounded read models**

Run:

```bash
npx tsx -e "import './src/lib/loadEnv'; import { refreshPlayerReadModels } from './src/server/readModels/playerReadModels'; (async () => { const result = await refreshPlayerReadModels({ season: 2026, rounds: [0, 1] }); console.log(JSON.stringify(result, null, 2)); })().catch((error) => { console.error(error); process.exit(1); });"
```

Expected:

- refresh completes without transaction expiry
- `refreshedRounds` includes `0` and `1`

- [ ] **Step 4: Verify convergence**

Run:

```bash
npm run verify:player-read-models -- --season=2026 --rounds=0,1 --limit=10 --json
```

Expected:

- `projectionRows` remains equal to `rawRows`
- targeted unresolved groups from this batch no longer appear as `dropped_before_raw`
- `aggregateMismatchPlayers` remains `0`

## Operational Risks

- Reviewed curation is the risk center. Incorrect player identity data is worse than unresolved rows because it pollutes the canonical contract.
- Audit recommendations are non-authoritative. They should reduce review time, not replace review.
- Evidence is initially stored in `notes` to avoid premature schema expansion. If evidence proves stable across more repair batches, promote it into first-class columns or a repair-audit table.
- Full-season refresh remains risky because of Prisma transaction expiry; use bounded rounds until refresh batching is redesigned.
- Any new player ID should be deterministic and reviewed. Do not create temporary IDs that will later need merging.
- If a row cannot be verified against source data, leave it unresolved or explicitly dismiss it with notes; do not infer identity from surname alone.

## Database Design Review Checklist

- One fact per place: current player profile stays in `Player`; season club membership goes in `PlayerSeasonRegistration`; spelling/source variation goes in `PlayerAlias`.
- Stable keys: aliases use deterministic `scopeKey`; registrations use unique `playerId, season, normalizedClub`.
- No duplicated semantics: replay and read models must use the resolver and canonical raw contract, not parallel lookup logic.
- Referential integrity: every alias and registration must target an existing or planned player.
- Auditability: every repair entry must carry `approvedBy`, `notes`, and structured `evidence`.
- Bounded mutation: apply only the reviewed batch, then replay and refresh only the affected season/round scope.

## Self-Review

- Spec coverage: the plan addresses goal assessment, shortcomings, rewritten target state, implementation steps, verification, and long-term database-design concerns.
- Placeholder scan: no implementation step depends on `TBD` behavior; each step has a command or explicit rule.
- Type consistency: planned fields align with existing `PlayerDirectoryRepairPlan`, `PlayerDirectoryAliasRepair`, `PlayerDirectoryRegistrationRepair`, and `PlayerDirectoryUnresolvedDecision` shapes.
