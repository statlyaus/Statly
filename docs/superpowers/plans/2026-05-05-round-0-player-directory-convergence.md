# Round 0 Player Directory Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the 2026 round 0 `player_id_not_in_prisma` failure class by converging Prisma player identity data with the canonical Firestore `player_match_stats` contract, then rebuild and verify the bounded projection slice.

**Architecture:** Keep Firestore `player_match_stats` as the canonical persisted event contract and Prisma `Player` / `PlayerSeasonRegistration` as the canonical player identity directory. Generate idempotent, reviewed Prisma directory repairs from the identity-gap diagnostic export plus reviewed roster evidence; do not patch Firestore directly and do not add read-model fallback behavior. After directory repair, rematerialize only the affected season/round/player slice and prove convergence with the diagnostic and read-model verifier.

**Tech Stack:** TypeScript, Prisma Client transactions, Firebase Admin Firestore reads, tsx scripts, Vitest, JSONL diagnostic artifacts, existing Statly repair helpers.

---

## Research And Best-Practice Notes

Repo-local sources:

- `docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md` says Prisma owns canonical player identity, Firestore owns resolved event rows, and repair should happen by identity updates plus replay/rebuild rather than direct Firestore patching.
- `docs/DATA_RELIABILITY.md` says Lane A read models require Firestore `player_match_stats`, canonical `player_id`, and matching Prisma `Player.id`.
- `docs/FOOTYWIRE_DATA_ARCHITECTURE_REVIEW.md` says the long-term target is one canonical Firestore raw-match contract and no permanent downstream fallback readers.
- `docs/superpowers/specs/2026-05-05-round-0-identity-gap-diagnosis-design.md` records the observed scoped failure: `236` Firestore rows for 2026 round 0, all classified as `player_id_not_in_prisma`.

External sources checked:

- [Prisma transactions](https://www.prisma.io/docs/orm/prisma-client/queries/transactions) provide ACID guarantees and `$transaction([])` rolls back if any operation fails, which fits atomic directory repair application.
- [Prisma seeding](https://www.prisma.io/docs/orm/prisma-migrate/workflows/seeding) recommends explicit seed commands for reproducible required data, which fits season player-directory bootstrap data.
- [Firestore best practices](https://firebase.google.com/docs/firestore/best-practices) recommend cursors rather than offsets and note that SDKs retry failed transactions; the existing diagnostic already pages with `startAfter`.
- [Google Cloud Dataplex data quality](https://cloud.google.com/dataplex/docs/auto-data-quality-overview) models quality checks as explicit rules, result analysis, monitoring, and alerting, which matches keeping the diagnostic as a repeatable quality gate.

## Invariant

For the repaired scope:

1. Every Firestore `player_match_stats` row included in `season=2026, round=0` must have a `player_id` that exists in Prisma `Player.id`.
2. Every created Prisma `Player` must be backed by reviewed roster evidence, not by a raw Footywire stat row alone.
3. Every created 2026 season registration must be backed by the same reviewed evidence.
4. Firestore raw rows must not be edited as the primary repair.
5. Read models must be rebuilt from the existing canonical Firestore rows after Prisma identity convergence.
6. `player_id_not_in_prisma` and `skippedWithoutCanonicalId` must trend to zero for the repaired round slice.

## File Structure

- Modify `src/server/playerDirectoryRepair.ts`
  - Broaden evidence source validation so repair plans can cite either unresolved rows or identity-gap diagnostic rows.
  - Keep current validation rules for reviewer, notes, duplicate ids, alias ambiguity, and season registrations.
- Create `src/server/playerDirectoryIdentityGapRepair.ts`
  - Convert `IdentityGapDiagnosticRow[]` plus `ReviewedPlayerRosterEvidence[]` into a `PlayerDirectoryRepairPlan`.
  - Return explicit unresolved diagnostic groups when roster evidence is missing or inconsistent.
  - No Prisma or Firestore imports; pure helper.
- Create `src/server/playerDirectoryIdentityGapRepair.test.ts`
  - Unit tests for exact successful plan generation, missing evidence, duplicate grouping, mismatched stored id, and position validation.
- Create `Scripts/build-player-directory-repair-from-identity-gap.ts`
  - Reads JSONL diagnostic export.
  - Loads `playerRosterEvidence2026`.
  - Prints JSON summary and optionally writes a generated repair plan JSON artifact under `tmp/`.
  - Does not write Prisma or Firestore.
- Modify `Scripts/repair-player-directory.ts`
  - Add `--from-identity-gap <path>` support.
  - Validate generated repair plan.
  - Apply through existing `applyPlayerDirectoryRepairPlan` only when `--apply` is present.
- Modify `src/data/playerRosterEvidence2026.ts`
  - Add or correct reviewed roster evidence entries until every `player_id_not_in_prisma` diagnostic row has matching reviewed evidence.
  - This is the only data-heavy step and must be reviewed as data curation, not as code inference.
- Modify `docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md`
  - Document the new directory-convergence workflow and commands.
- Modify `docs/superpowers/specs/2026-05-05-round-0-identity-gap-diagnosis-design.md`
  - Link the diagnostic result to the repair workflow.

## Task 1: Allow Identity-Gap Evidence In Directory Repairs

**Files:**
- Modify: `src/server/playerDirectoryRepair.ts`
- Test: `src/server/playerDirectoryRepair.test.ts`

- [ ] **Step 1: Write the failing evidence-source validation test**

Add this test case to `src/server/playerDirectoryRepair.test.ts` near the existing validation tests:

```ts
it('accepts reviewed identity-gap diagnostic row evidence for player repairs', async () => {
  const prisma = createMockPrisma({
    players: [],
    aliases: [],
    registrations: [],
    unresolvedRows: [],
  });

  const plan: PlayerDirectoryRepairPlan = {
    players: [
      {
        id: 'aaron_naughton',
        name: 'Aaron Naughton',
        club: 'Western Bulldogs',
        position: 'FWD',
        approvedBy: 'manual-review-2026-05-05',
        notes: 'Reviewed from 2026 round 0 identity-gap diagnostic and official roster evidence.',
        evidence: {
          source: 'identity-gap-diagnostic-row',
          sourceDocumentIds: ['2026-R0-BRI-BUL_ply_aaron_naughton'],
          sourcePlayerName: 'Aaron Naughton',
          sourceTeam: 'Western Bulldogs',
          reviewedAt: '2026-05-05',
        },
      },
    ],
    aliases: [],
    registrations: [
      {
        playerId: 'aaron_naughton',
        season: 2026,
        club: 'Western Bulldogs',
        position: 'FWD',
        approvedBy: 'manual-review-2026-05-05',
        notes: 'Reviewed from 2026 round 0 identity-gap diagnostic and official roster evidence.',
        evidence: {
          source: 'identity-gap-diagnostic-row',
          sourceDocumentIds: ['2026-R0-BRI-BUL_ply_aaron_naughton'],
          sourcePlayerName: 'Aaron Naughton',
          sourceTeam: 'Western Bulldogs',
          reviewedAt: '2026-05-05',
        },
      },
    ],
    unresolvedDecisions: [],
  };

  const validation = await validatePlayerDirectoryRepairPlan(prisma, plan);

  expect(validation.valid).toBe(true);
  expect(validation.errors).toEqual([]);
  expect(validation.diff.playersToCreate).toHaveLength(1);
  expect(validation.diff.registrationsToCreate).toHaveLength(1);
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npx vitest run src/server/playerDirectoryRepair.test.ts -t "identity-gap diagnostic row evidence"
```

Expected: fail with `has invalid evidence.source`.

- [ ] **Step 3: Update the evidence type and validator**

In `src/server/playerDirectoryRepair.ts`, replace the evidence source type and validation check with:

```ts
export type PlayerDirectoryRepairEvidenceSource =
  | 'footywire-unresolved-row'
  | 'identity-gap-diagnostic-row';

export type PlayerDirectoryRepairEvidence = {
  source: PlayerDirectoryRepairEvidenceSource;
  sourceDocumentIds: string[];
  sourcePlayerName: string;
  sourceTeam?: string | null;
  reviewedAt: string;
};

const VALID_REPAIR_EVIDENCE_SOURCES = new Set<PlayerDirectoryRepairEvidenceSource>([
  'footywire-unresolved-row',
  'identity-gap-diagnostic-row',
]);
```

Then change `requireEvidenceFields` to:

```ts
if (!VALID_REPAIR_EVIDENCE_SOURCES.has(evidence.source)) {
  errors.push(`${label} has invalid evidence.source`);
}
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
npx vitest run src/server/playerDirectoryRepair.test.ts -t "identity-gap diagnostic row evidence"
```

Expected: pass.

- [ ] **Step 5: Run the full repair test file**

Run:

```bash
npx vitest run src/server/playerDirectoryRepair.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/server/playerDirectoryRepair.ts src/server/playerDirectoryRepair.test.ts
git commit -m "Allow identity gap repair evidence"
```

## Task 2: Build Pure Identity-Gap Repair Plan Generator

**Files:**
- Create: `src/server/playerDirectoryIdentityGapRepair.ts`
- Create: `src/server/playerDirectoryIdentityGapRepair.test.ts`

- [ ] **Step 1: Write failing tests for the generator**

Create `src/server/playerDirectoryIdentityGapRepair.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { IdentityGapDiagnosticRow } from './diagnostics/playerIdentityGapDiagnosis';
import type { ReviewedPlayerRosterEvidence } from './playerDirectoryRosterEvidence';
import { buildPlayerDirectoryRepairPlanFromIdentityGaps } from './playerDirectoryIdentityGapRepair';

const diagnosticRow = (
  overrides: Partial<IdentityGapDiagnosticRow> = {}
): IdentityGapDiagnosticRow => ({
  doc_id: '2026-R0-BRI-BUL_ply_aaron_naughton',
  season: 2026,
  round: 0,
  match_id: '2026-R0-BRI-BUL',
  storage_match_id: '2026-R0-BRI-BUL',
  player_name: 'Aaron Naughton',
  team: 'Western Bulldogs',
  opponent: null,
  stored_player_id: 'aaron_naughton',
  classification: 'player_id_not_in_prisma',
  secondary_flags: ['has_canonical_stats', 'has_raw_row'],
  resolved_player_id: null,
  resolved_player_name: null,
  candidate_player_ids: [],
  unresolved_queue_statuses: [],
  source: 'footywire',
  has_canonical_stats: true,
  has_raw_row: true,
  updated_at: '2026-04-20T12:53:56.156Z',
  ...overrides,
});

const rosterEvidence = (
  overrides: Partial<ReviewedPlayerRosterEvidence> = {}
): ReviewedPlayerRosterEvidence => ({
  season: 2026,
  playerName: 'Aaron Naughton',
  club: 'Western Bulldogs',
  position: 'FWD',
  playerStatus: 'new_player',
  source: 'club-roster',
  sourceLabel: 'Western Bulldogs AFL player profile',
  sourceUrl: 'https://www.westernbulldogs.com.au/players/1605/aaron-naughton',
  reviewedBy: 'manual-review-2026-05-05',
  reviewedAt: '2026-05-05',
  notes: 'Official profile identifies Naughton as a Western Bulldogs forward.',
  unresolved: {
    sourceDocumentIds: ['2026-R0-BRI-BUL_ply_aaron_naughton'],
    sourcePlayerName: 'Aaron Naughton',
    sourceTeam: 'Western Bulldogs',
  },
  ...overrides,
});

describe('buildPlayerDirectoryRepairPlanFromIdentityGaps', () => {
  it('creates a reviewed player and season registration for matching identity-gap evidence', () => {
    const result = buildPlayerDirectoryRepairPlanFromIdentityGaps({
      season: 2026,
      rows: [diagnosticRow()],
      rosterEvidence: [rosterEvidence()],
      reviewedBy: 'manual-review-2026-05-05',
      reviewedAt: '2026-05-05',
    });

    expect(result.unresolved).toEqual([]);
    expect(result.plan.players).toEqual([
      expect.objectContaining({
        id: 'aaron_naughton',
        name: 'Aaron Naughton',
        club: 'Western Bulldogs',
        position: 'FWD',
        approvedBy: 'manual-review-2026-05-05',
        evidence: expect.objectContaining({
          source: 'identity-gap-diagnostic-row',
          sourceDocumentIds: ['2026-R0-BRI-BUL_ply_aaron_naughton'],
        }),
      }),
    ]);
    expect(result.plan.registrations).toEqual([
      expect.objectContaining({
        playerId: 'aaron_naughton',
        season: 2026,
        club: 'Western Bulldogs',
        position: 'FWD',
      }),
    ]);
  });

  it('groups duplicate diagnostic rows for the same stored player id into one repair', () => {
    const result = buildPlayerDirectoryRepairPlanFromIdentityGaps({
      season: 2026,
      rows: [
        diagnosticRow({ doc_id: '2026-R0-BRI-BUL_ply_aaron_naughton' }),
        diagnosticRow({ doc_id: '2026-R0-WBD-BRL_ply_aaron_naughton' }),
      ],
      rosterEvidence: [rosterEvidence()],
      reviewedBy: 'manual-review-2026-05-05',
      reviewedAt: '2026-05-05',
    });

    expect(result.plan.players).toHaveLength(1);
    expect(result.plan.registrations).toHaveLength(1);
    expect(result.plan.players[0].evidence.sourceDocumentIds).toEqual([
      '2026-R0-BRI-BUL_ply_aaron_naughton',
      '2026-R0-WBD-BRL_ply_aaron_naughton',
    ]);
  });

  it('does not create a repair when reviewed roster evidence is missing', () => {
    const result = buildPlayerDirectoryRepairPlanFromIdentityGaps({
      season: 2026,
      rows: [diagnosticRow()],
      rosterEvidence: [],
      reviewedBy: 'manual-review-2026-05-05',
      reviewedAt: '2026-05-05',
    });

    expect(result.plan.players).toEqual([]);
    expect(result.plan.registrations).toEqual([]);
    expect(result.unresolved).toEqual([
      expect.objectContaining({
        storedPlayerId: 'aaron_naughton',
        playerName: 'Aaron Naughton',
        reason: 'missing_roster_evidence',
      }),
    ]);
  });

  it('rejects evidence when the reviewed roster id does not match the stored Firestore player id', () => {
    const result = buildPlayerDirectoryRepairPlanFromIdentityGaps({
      season: 2026,
      rows: [diagnosticRow()],
      rosterEvidence: [rosterEvidence({ playerId: 'different_id' })],
      reviewedBy: 'manual-review-2026-05-05',
      reviewedAt: '2026-05-05',
    });

    expect(result.plan.players).toEqual([]);
    expect(result.unresolved).toEqual([
      expect.objectContaining({
        storedPlayerId: 'aaron_naughton',
        reason: 'stored_player_id_mismatch',
      }),
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run src/server/playerDirectoryIdentityGapRepair.test.ts
```

Expected: fail because `playerDirectoryIdentityGapRepair.ts` does not exist.

- [ ] **Step 3: Implement the pure generator**

Create `src/server/playerDirectoryIdentityGapRepair.ts`:

```ts
import type { IdentityGapDiagnosticRow } from './diagnostics/playerIdentityGapDiagnosis';
import type { ReviewedPlayerRosterEvidence } from './playerDirectoryRosterEvidence';
import type { PlayerDirectoryRepairPlan, VALID_PLAYER_POSITIONS } from './playerDirectoryRepair';
import { normalizeLookupPart, normalizeTeamLookup } from '../../shared/player-identity/playerMatchStats';

type ValidPlayerPosition = (typeof VALID_PLAYER_POSITIONS)[number];

export type IdentityGapRepairUnresolvedReason =
  | 'not_player_id_not_in_prisma'
  | 'missing_stored_player_id'
  | 'missing_player_name'
  | 'missing_team'
  | 'missing_roster_evidence'
  | 'stored_player_id_mismatch';

export type IdentityGapRepairUnresolved = {
  storedPlayerId: string | null;
  playerName: string | null;
  team: string | null;
  sourceDocumentIds: string[];
  reason: IdentityGapRepairUnresolvedReason;
};

export type BuildIdentityGapRepairPlanInput = {
  season: number;
  rows: IdentityGapDiagnosticRow[];
  rosterEvidence: ReviewedPlayerRosterEvidence[];
  reviewedBy: string;
  reviewedAt: string;
};

export type BuildIdentityGapRepairPlanResult = {
  plan: PlayerDirectoryRepairPlan;
  unresolved: IdentityGapRepairUnresolved[];
};

function deterministicPlayerId(playerName: string): string {
  return normalizeLookupPart(playerName)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function evidenceKey(input: { season: number; playerName: string; team: string }): string {
  return [
    input.season,
    normalizeTeamLookup(input.team),
    normalizeLookupPart(input.playerName),
  ].join('|');
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

export function buildPlayerDirectoryRepairPlanFromIdentityGaps(
  input: BuildIdentityGapRepairPlanInput
): BuildIdentityGapRepairPlanResult {
  const rosterByKey = new Map(
    input.rosterEvidence.map((evidence) => [
      evidenceKey({
        season: evidence.season,
        playerName: evidence.playerName,
        team: evidence.club,
      }),
      evidence,
    ])
  );

  const groupedRows = new Map<string, IdentityGapDiagnosticRow[]>();
  const unresolved: IdentityGapRepairUnresolved[] = [];

  for (const row of input.rows) {
    if (row.classification !== 'player_id_not_in_prisma') {
      unresolved.push({
        storedPlayerId: row.stored_player_id,
        playerName: row.player_name,
        team: row.team,
        sourceDocumentIds: [row.doc_id],
        reason: 'not_player_id_not_in_prisma',
      });
      continue;
    }
    if (!row.stored_player_id) {
      unresolved.push({
        storedPlayerId: null,
        playerName: row.player_name,
        team: row.team,
        sourceDocumentIds: [row.doc_id],
        reason: 'missing_stored_player_id',
      });
      continue;
    }
    if (!row.player_name) {
      unresolved.push({
        storedPlayerId: row.stored_player_id,
        playerName: null,
        team: row.team,
        sourceDocumentIds: [row.doc_id],
        reason: 'missing_player_name',
      });
      continue;
    }
    if (!row.team) {
      unresolved.push({
        storedPlayerId: row.stored_player_id,
        playerName: row.player_name,
        team: null,
        sourceDocumentIds: [row.doc_id],
        reason: 'missing_team',
      });
      continue;
    }

    const key = row.stored_player_id;
    groupedRows.set(key, [...(groupedRows.get(key) ?? []), row]);
  }

  const players: PlayerDirectoryRepairPlan['players'] = [];
  const registrations: PlayerDirectoryRepairPlan['registrations'] = [];

  for (const [storedPlayerId, rows] of groupedRows) {
    const first = rows[0];
    const playerName = first.player_name as string;
    const team = first.team as string;
    const evidence = rosterByKey.get(evidenceKey({ season: input.season, playerName, team }));

    if (!evidence) {
      unresolved.push({
        storedPlayerId,
        playerName,
        team,
        sourceDocumentIds: sortedUnique(rows.map((row) => row.doc_id)),
        reason: 'missing_roster_evidence',
      });
      continue;
    }

    const reviewedPlayerId = evidence.playerId ?? deterministicPlayerId(evidence.playerName);
    if (reviewedPlayerId !== storedPlayerId) {
      unresolved.push({
        storedPlayerId,
        playerName,
        team,
        sourceDocumentIds: sortedUnique(rows.map((row) => row.doc_id)),
        reason: 'stored_player_id_mismatch',
      });
      continue;
    }

    const sourceDocumentIds = sortedUnique(rows.map((row) => row.doc_id));
    const notes =
      `Reviewed from identity-gap diagnostic for ${input.season} round 0. ` +
      `Roster evidence: ${evidence.sourceLabel}${evidence.sourceUrl ? ` (${evidence.sourceUrl})` : ''}. ` +
      evidence.notes;

    players.push({
      id: storedPlayerId,
      name: evidence.playerName,
      club: evidence.club,
      position: evidence.position as ValidPlayerPosition,
      active: evidence.active ?? true,
      approvedBy: input.reviewedBy,
      notes,
      evidence: {
        source: 'identity-gap-diagnostic-row',
        sourceDocumentIds,
        sourcePlayerName: playerName,
        sourceTeam: team,
        reviewedAt: input.reviewedAt,
      },
    });

    registrations.push({
      playerId: storedPlayerId,
      season: input.season,
      club: evidence.club,
      position: evidence.position as ValidPlayerPosition,
      listStatus: evidence.listStatus ?? 'active',
      active: evidence.active ?? true,
      source: 'MANUAL',
      approvedBy: input.reviewedBy,
      notes,
      evidence: {
        source: 'identity-gap-diagnostic-row',
        sourceDocumentIds,
        sourcePlayerName: playerName,
        sourceTeam: team,
        reviewedAt: input.reviewedAt,
      },
    });
  }

  return {
    plan: {
      players,
      aliases: [],
      registrations,
      unresolvedDecisions: [],
    },
    unresolved,
  };
}
```

- [ ] **Step 4: Run generator tests**

Run:

```bash
npx vitest run src/server/playerDirectoryIdentityGapRepair.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/playerDirectoryIdentityGapRepair.ts src/server/playerDirectoryIdentityGapRepair.test.ts
git commit -m "Add identity gap repair plan generator"
```

## Task 3: Add Read-Only Repair Plan Builder Script

**Files:**
- Create: `Scripts/build-player-directory-repair-from-identity-gap.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the script with strict JSONL parsing and safe output**

Create `Scripts/build-player-directory-repair-from-identity-gap.ts`:

```ts
#!/usr/bin/env tsx

import '../src/lib/loadEnv';

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { playerRosterEvidence2026 } from '../src/data/playerRosterEvidence2026';
import type { IdentityGapDiagnosticRow } from '../src/server/diagnostics/playerIdentityGapDiagnosis';
import { buildPlayerDirectoryRepairPlanFromIdentityGaps } from '../src/server/playerDirectoryIdentityGapRepair';

type CliArgs = {
  input: string;
  output: string | null;
  season: number;
  reviewedBy: string;
  reviewedAt: string;
};

function readArgValue(argv: string[], name: string): string | undefined {
  const equalsValue = argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
  if (equalsValue != null) return equalsValue;
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

function parseArgs(argv: string[]): CliArgs {
  const input = readArgValue(argv, '--input');
  const output = readArgValue(argv, '--output') ?? null;
  const season = Number(readArgValue(argv, '--season'));
  const reviewedBy = readArgValue(argv, '--reviewed-by') ?? 'manual-review-2026-05-05';
  const reviewedAt = readArgValue(argv, '--reviewed-at') ?? '2026-05-05';

  if (!input || input.startsWith('--')) throw new Error('Expected --input <identity-gap.jsonl>');
  if (!Number.isInteger(season) || season < 2020 || season > 2035) {
    throw new Error('Expected --season between 2020 and 2035');
  }
  if (output != null && (!output.trim() || output.startsWith('--'))) {
    throw new Error('Expected --output to be followed by a non-empty path');
  }

  return { input, output, season, reviewedBy, reviewedAt };
}

function parseJsonl(contents: string): IdentityGapDiagnosticRow[] {
  return contents
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line) as IdentityGapDiagnosticRow;
      } catch (error) {
        throw new Error(`Invalid JSONL at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const rows = parseJsonl(await readFile(args.input, 'utf8'));
  const result = buildPlayerDirectoryRepairPlanFromIdentityGaps({
    season: args.season,
    rows,
    rosterEvidence: playerRosterEvidence2026,
    reviewedBy: args.reviewedBy,
    reviewedAt: args.reviewedAt,
  });

  const output = {
    ok: result.unresolved.length === 0,
    season: args.season,
    input: args.input,
    counts: {
      rows: rows.length,
      playersToCreate: result.plan.players.length,
      registrationsToCreate: result.plan.registrations.length,
      unresolved: result.unresolved.length,
    },
    unresolved: result.unresolved,
    plan: result.plan,
  };

  if (args.output) {
    await mkdir(dirname(args.output), { recursive: true });
    await writeFile(args.output, `${JSON.stringify(output.plan, null, 2)}\n`, 'utf8');
  }

  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
```

- [ ] **Step 2: Add package script**

Add this entry to `package.json` scripts:

```json
"build:player-directory-repair-from-identity-gap": "tsx Scripts/build-player-directory-repair-from-identity-gap.ts"
```

- [ ] **Step 3: Run script against the current diagnostic artifact**

Run:

```bash
npm --silent run build:player-directory-repair-from-identity-gap -- --season=2026 --input tmp/identity-gap-2026-r0.jsonl --output tmp/player-directory-repair-2026-r0.json
```

Expected before roster evidence expansion:

- command exits non-zero if any diagnostic row lacks reviewed roster evidence
- JSON output includes exact `unresolved` rows and reasons
- no Prisma rows are written
- no Firestore rows are written

- [ ] **Step 4: Commit**

```bash
git add Scripts/build-player-directory-repair-from-identity-gap.ts package.json
git commit -m "Add identity gap repair plan builder"
```

## Task 4: Complete Reviewed 2026 Roster Evidence For Round 0

**Files:**
- Modify: `src/data/playerRosterEvidence2026.ts`

- [ ] **Step 1: Generate the unresolved evidence list**

Run:

```bash
npm --silent run build:player-directory-repair-from-identity-gap -- --season=2026 --input tmp/identity-gap-2026-r0.jsonl --output tmp/player-directory-repair-2026-r0.json
```

Expected:

- The command reports `unresolved` entries for every `player_id_not_in_prisma` row not yet covered by `playerRosterEvidence2026`.
- Each unresolved entry has `storedPlayerId`, `playerName`, `team`, `sourceDocumentIds`, and `reason`.

- [ ] **Step 2: Add reviewed evidence entries**

For each unresolved real AFL player, add one `ReviewedPlayerRosterEvidence` object to `playerRosterEvidence2026`.

Use the generated unresolved JSON as the source for `playerId`, `unresolved.sourceDocumentIds`, `unresolved.sourcePlayerName`, and `unresolved.sourceTeam`. Use the official club roster or player profile as the source for display name, club, and position. This concrete entry shows the required final shape:

```ts
{
  season: 2026,
  playerName: 'Aaron Naughton',
  club: 'Western Bulldogs',
  position: 'FWD',
  playerStatus: 'new_player',
  playerId: 'aaron_naughton',
  source: 'club-roster',
  sourceLabel: 'Western Bulldogs AFL player profile',
  sourceUrl: 'https://www.westernbulldogs.com.au/players/1605/aaron-naughton',
  reviewedBy: 'manual-review-2026-05-05',
  reviewedAt: '2026-05-05',
  notes: 'Official player profile identifies Naughton as a Western Bulldogs forward.',
  unresolved: {
    sourceDocumentIds: ['2026-R0-BRI-BUL_ply_aaron_naughton'],
    sourcePlayerName: 'Aaron Naughton',
    sourceTeam: 'Western Bulldogs',
  },
}
```

Do not add evidence for a row unless the `playerId` exactly equals the diagnostic `stored_player_id`. If the official roster name differs from the diagnostic name, set `playerName` to the official display name and keep `unresolved.sourcePlayerName` as the diagnostic value.

- [ ] **Step 3: Regenerate the repair plan until no evidence gaps remain**

Run:

```bash
npm --silent run build:player-directory-repair-from-identity-gap -- --season=2026 --input tmp/identity-gap-2026-r0.jsonl --output tmp/player-directory-repair-2026-r0.json
```

Expected:

- exit code `0`
- `counts.rows` equals `236`
- `counts.unresolved` equals `0`
- `counts.playersToCreate` is greater than `0`
- `counts.registrationsToCreate` is greater than `0`

- [ ] **Step 4: Run roster evidence tests**

Run:

```bash
npx vitest run src/server/playerDirectoryRosterEvidence.test.ts src/server/playerDirectoryIdentityGapRepair.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/data/playerRosterEvidence2026.ts
git commit -m "Add reviewed round 0 roster evidence"
```

## Task 5: Apply Directory Repair Through Existing Prisma Path

**Files:**
- Modify: `Scripts/repair-player-directory.ts`

- [ ] **Step 1: Update repair script args**

Replace `parseArgs` in `Scripts/repair-player-directory.ts` with:

```ts
function readArgValue(argv: string[], name: string): string | undefined {
  const equalsValue = argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
  if (equalsValue != null) return equalsValue;
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

function parseArgs(argv: string[]) {
  const fromIdentityGap = readArgValue(argv, '--from-identity-gap');
  if (fromIdentityGap != null && (!fromIdentityGap.trim() || fromIdentityGap.startsWith('--'))) {
    throw new Error('Expected --from-identity-gap to be followed by a non-empty JSON repair plan path');
  }

  return {
    apply: argv.includes('--apply'),
    fromIdentityGap: fromIdentityGap ?? null,
  };
}
```

- [ ] **Step 2: Load optional generated repair plan JSON**

Add imports:

```ts
import { readFile } from 'node:fs/promises';
import type { PlayerDirectoryRepairPlan } from '../src/server/playerDirectoryRepair';
```

Add helper:

```ts
async function loadRepairPlan(path: string | null): Promise<PlayerDirectoryRepairPlan> {
  if (!path) return playerDirectoryRepairs2026;
  const parsed = JSON.parse(await readFile(path, 'utf8')) as PlayerDirectoryRepairPlan;
  return parsed;
}
```

Change `main` to:

```ts
const plan = await loadRepairPlan(options.fromIdentityGap);
const result = await applyPlayerDirectoryRepairPlan(prisma, plan, {
  dryRun: !options.apply,
});
```

Change output audit to use `plan`:

```ts
audit: {
  repairCount:
    plan.players.length +
    plan.aliases.length +
    plan.registrations.length +
    plan.unresolvedDecisions.length,
  source: options.fromIdentityGap ?? 'src/data/playerDirectoryRepairs2026.ts',
  verifierCommand:
    'npm run verify:player-read-models -- --season 2026 --rounds 0 --json',
},
```

- [ ] **Step 3: Dry-run the generated repair**

Run:

```bash
npm --silent run build:player-directory-repair-from-identity-gap -- --season=2026 --input tmp/identity-gap-2026-r0.jsonl --output tmp/player-directory-repair-2026-r0.json
npm --silent run repair-player-directory -- --from-identity-gap tmp/player-directory-repair-2026-r0.json
```

Expected:

- repair script exits `0`
- `dryRun` is `true`
- validation is `valid: true`
- `diff.playersToCreate.length` matches generated `players.length` minus already-existing players
- `diff.registrationsToCreate.length` matches generated `registrations.length` minus already-existing registrations

- [ ] **Step 4: Apply the generated repair**

Run:

```bash
npm --silent run repair-player-directory -- --from-identity-gap tmp/player-directory-repair-2026-r0.json --apply
```

Expected:

- repair script exits `0`
- `applied` is `true`
- no duplicate key errors
- no Firestore write logs

- [ ] **Step 5: Rerun the diagnostic**

Run:

```bash
npm --silent run diagnose:player-identity-gaps -- --season=2026 --rounds=0 --json --output-jsonl tmp/identity-gap-2026-r0-after-directory.jsonl --output-csv tmp/identity-gap-2026-r0-after-directory.csv
```

Expected:

- `firestoreRowCount` remains `236`
- `classificationCounts.player_id_not_in_prisma` equals `0`
- `classificationCounts.canonical_player_id_ok` equals `236`

- [ ] **Step 6: Commit**

```bash
git add Scripts/repair-player-directory.ts
git commit -m "Support identity gap directory repair application"
```

## Task 6: Rebuild And Verify The Bounded Projection Slice

**Files:**
- No source edits expected.

- [ ] **Step 1: Rebuild round 0 read models**

Run:

```bash
npm --silent run build:player-read-models -- --season=2026 --rounds=0 --mode=refresh
```

Expected:

- command exits `0`
- output JSON contains `skippedWithoutCanonicalId: 0`
- output JSON contains non-zero summary or match-log rows for the affected player ids

- [ ] **Step 2: Run read-model verifier**

Run:

```bash
npm --silent run verify:player-read-models -- --season=2026 --rounds=0 --include-merged-live --json
```

Expected:

- command exits `0`
- failure classes `dropped_before_raw` and `dropped_in_projection` are absent for the repaired scope
- verifier reports no remaining missing canonical player directory rows for round 0

- [ ] **Step 3: Run player API smoke check**

Run:

```bash
curl -sS 'http://localhost:3000/api/players?season=2026&limit=5' | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s); console.log(JSON.stringify({ok:Array.isArray(j.data?.players), count:j.data?.players?.length ?? 0, first:j.data?.players?.[0]?.name ?? null})); if (!Array.isArray(j.data?.players) || j.data.players.length === 0) process.exit(1);})"
```

Expected:

- command exits `0`
- output includes `ok: true`
- `count` is greater than `0`

- [ ] **Step 4: Commit verification notes**

No code commit is required for runtime-only verification. Record command outputs in the final response and do not commit `tmp/` artifacts.

## Task 7: Document The Long-Term Runbook

**Files:**
- Modify: `docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md`
- Modify: `docs/superpowers/specs/2026-05-05-round-0-identity-gap-diagnosis-design.md`

- [ ] **Step 1: Add identity-gap convergence workflow to protocol**

Add this section to `docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md` after `Read Model Rebuild Protocol`:

~~~md
## Identity Gap Directory Convergence Protocol

When the identity-gap diagnostic reports `player_id_not_in_prisma`, do not patch Firestore and do not add projection fallbacks.

Use the reviewed directory repair workflow:

~~~bash
npm --silent run diagnose:player-identity-gaps -- --season=YYYY --rounds=R --json --output-jsonl tmp/identity-gap-YYYY-rR.jsonl --output-csv tmp/identity-gap-YYYY-rR.csv
npm --silent run build:player-directory-repair-from-identity-gap -- --season=YYYY --input tmp/identity-gap-YYYY-rR.jsonl --output tmp/player-directory-repair-YYYY-rR.json
npm --silent run repair-player-directory -- --from-identity-gap tmp/player-directory-repair-YYYY-rR.json
npm --silent run repair-player-directory -- --from-identity-gap tmp/player-directory-repair-YYYY-rR.json --apply
npm --silent run build:player-read-models -- --season=YYYY --rounds=R --mode=refresh
npm --silent run verify:player-read-models -- --season=YYYY --rounds=R --include-merged-live --json
~~~

The repair plan must only create Prisma `Player` and `PlayerSeasonRegistration` rows backed by reviewed roster evidence. Generated `tmp/` artifacts are local evidence and must not be committed unless explicitly promoted to a reviewed fixture.
~~~

- [ ] **Step 2: Link diagnostic spec to repair runbook**

Append this sentence to the `Implemented Command` section in `docs/superpowers/specs/2026-05-05-round-0-identity-gap-diagnosis-design.md`:

```md
The long-term repair path for this result is the Identity Gap Directory Convergence Protocol in `docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md`.
```

- [ ] **Step 3: Commit docs**

```bash
git add docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md docs/superpowers/specs/2026-05-05-round-0-identity-gap-diagnosis-design.md
git commit -m "Document identity gap convergence protocol"
```

## Task 8: Final Verification

**Files:**
- No source edits expected unless verification fails.

- [ ] **Step 1: Run focused unit tests**

Run:

```bash
npx vitest run src/server/playerDirectoryRepair.test.ts src/server/playerDirectoryIdentityGapRepair.test.ts src/server/diagnostics/playerIdentityGapDiagnosis.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck:app
```

Expected: exit code `0`.

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected:

- exit code `0`, or
- only known unrelated flaky tests fail and each failing file passes when rerun in isolation.

If a failure touches files changed by this plan, stop and fix before final review.

- [ ] **Step 4: Run final diagnostic**

Run:

```bash
npm --silent run diagnose:player-identity-gaps -- --season=2026 --rounds=0 --json
```

Expected:

- `firestoreRowCount` equals `236`
- `classificationCounts.player_id_not_in_prisma` equals `0`
- `classificationCounts.canonical_player_id_ok` equals `236`

- [ ] **Step 5: Request final code review**

Use a review subagent with this prompt:

```text
Review the round 0 player directory convergence implementation. Prioritize bugs, accidental Firestore mutation, non-idempotent Prisma writes, evidence validation gaps, projection fallback drift, and insufficient verification. Return findings first with file/line references or APPROVED.
```

Expected: review returns `APPROVED` or actionable findings are fixed and re-reviewed.

## Operational Risk Notes

- Creating Prisma `Player` rows is high-impact because those ids become app-visible canonical identity. Every created row must have reviewed roster evidence.
- The diagnostic artifact is evidence, not authority. It proves which ids Firestore already contains; it does not prove the player exists or which position they play.
- Firestore should not be patched for this failure class. The rows already contain canonical ids; Prisma directory convergence is the missing step.
- Full-season rebuild remains available, but this plan starts with `--rounds=0` to keep repair blast radius bounded.

## Done Means

- The generated repair plan has `counts.unresolved: 0`.
- The dry-run repair is valid.
- The applied repair creates only reviewed Prisma players and season registrations.
- The post-repair diagnostic has `player_id_not_in_prisma: 0`.
- The bounded read-model rebuild reports `skippedWithoutCanonicalId: 0`.
- The verifier reports no `dropped_before_raw` or `dropped_in_projection` for 2026 round 0.
- No permanent projection fallback or Firestore-only patch was introduced.
