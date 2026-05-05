# Full Player Data Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repeatable, evidence-gated rollout path for converging the remaining player data slices after the 2026 round 0 proof slice, without inventing players from diagnostics or adding downstream fallback semantics.

**Architecture:** Keep Prisma as the canonical player identity directory and Firestore `player_match_stats` as the canonical resolved event store. Build a thin orchestration layer over the existing diagnostic, roster sync, rebuild, and verifier commands so every season/round slice follows the same dry-run, optional apply, bounded rebuild, and verification sequence. The runner writes local artifacts and refuses destructive shortcuts; reviewed roster evidence remains the only authority for creating or updating Prisma player identity data.

**Tech Stack:** TypeScript, Node.js child process orchestration, existing tsx scripts, Prisma-backed player directory sync, Firebase Admin Firestore diagnostics, Vitest, repo documentation.

---

## Scope Decision

The rest of the data is not included by the 2026 round 0 branch. That branch added the reusable player directory sync, roster evidence contract, bounded rebuild, and verifier path, then proved the path for `season=2026, rounds=0`.

The optimal long-term next step is not a direct all-season mutation. It is to add a standard convergence runner and runbook that makes every later slice follow the same safety gates:

1. Diagnose the requested season/round slice.
2. Check roster-evidence coverage before any Prisma directory apply.
3. Apply directory sync only when `coverageOk === true`.
4. Rebuild only the requested slice.
5. Verify that raw/projection/read-model convergence passes for the claimed slice.

This keeps the repair repeatable and prevents future work from reintroducing the original failure mode: Firestore has canonical `player_id` values but Prisma lacks matching players, causing read-model materialization to skip or fail.

## Best-Practice Basis

Repo-local guidance:

- `AGENTS.md`: Firestore raw-match documents are the single persisted semantic contract; repair operations must be bounded, repeatable, and operationally safe.
- `docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md`: Prisma owns canonical player identity; Firestore owns resolved event rows; repair should use identity updates plus rebuild, not direct Firestore patching.
- `docs/DATA_RELIABILITY.md`: Lane A read models require Firestore `player_match_stats`, canonical `player_id`, and matching Prisma `Player.id`.
- `docs/FOOTYWIRE_DATA_ARCHITECTURE_REVIEW.md`: downstream readers must not become permanent semantic fallbacks around canonical contract gaps.

External references used for the plan:

- [Prisma transactions](https://www.prisma.io/docs/orm/prisma-client/queries/transactions): related writes that must succeed or fail together should use transactions; bulk/nested writes are the ORM-supported mechanism for atomic write sets.
- [Prisma seeding](https://docs.prisma.io/docs/orm/prisma-migrate/workflows/seeding): reproducible required data belongs in explicit seed/sync workflows rather than hidden local database state.
- [Firestore best practices](https://firebase.google.com/docs/firestore/best-practices): backend workflows should page through large result sets and avoid unnecessary broad writes.
- [Google Cloud Dataplex data quality](https://cloud.google.com/dataplex/docs/auto-data-quality-overview): data quality should be represented as explicit row-level and aggregate expectations with analyzed results.

## File Structure

- Create `src/server/playerDataConvergenceRun.ts`
  - Pure planning helpers for convergence runs.
  - Builds artifact paths and command plans for diagnose, directory sync dry-run, optional directory sync apply, bounded rebuild, and verifier phases.
  - Does not import Prisma, Firebase, or mutate data.
- Create `src/server/playerDataConvergenceRun.test.ts`
  - Unit tests for command ordering, dry-run default, apply gating, artifact paths, and argument validation.
- Create `Scripts/run-player-data-convergence.ts`
  - CLI runner that executes the planned phases using existing npm scripts.
  - Defaults to dry-run directory sync and verification without applying Prisma mutations.
  - Requires `--apply-directory-sync` before applying directory sync.
- Modify `package.json`
  - Add `converge:player-data`.
- Modify `docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md`
  - Add a full data convergence rollout protocol.

## Non-Negotiable Invariants

1. The runner must not create players directly from Firestore diagnostics.
2. Directory apply must be explicit with `--apply-directory-sync`.
3. The runner must preserve the existing `sync:player-directory-season` coverage gate.
4. Rebuild must be bounded to the requested `--season` and `--rounds`.
5. Verification must run after rebuild unless `--skip-verify` is explicitly supplied for diagnostic-only local investigation.
6. Generated artifacts must live under `tmp/` and must not be committed.
7. The runbook must say that adding new reviewed roster evidence is required before applying slices whose sync dry-run reports missing evidence.

## Task 1: Add Pure Convergence Run Planner

**Files:**

- Create: `src/server/playerDataConvergenceRun.ts`
- Create: `src/server/playerDataConvergenceRun.test.ts`

- [ ] **Step 1: Write failing tests for command planning**

Create `src/server/playerDataConvergenceRun.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  buildPlayerDataConvergenceRun,
  parseConvergenceRounds,
} from './playerDataConvergenceRun';

describe('parseConvergenceRounds', () => {
  it('normalizes comma-separated round lists', () => {
    expect(parseConvergenceRounds('2,0,2,1')).toEqual([0, 1, 2]);
  });

  it('rejects empty or unsafe round values', () => {
    expect(() => parseConvergenceRounds('')).toThrow(
      'Expected --rounds with at least one non-negative integer round'
    );
    expect(() => parseConvergenceRounds('0,1.5')).toThrow(
      'Expected --rounds to contain only comma-separated non-negative integers'
    );
  });
});

describe('buildPlayerDataConvergenceRun', () => {
  it('plans a dry-run convergence sequence by default', () => {
    const run = buildPlayerDataConvergenceRun({
      season: 2026,
      rounds: [0],
      runId: '2026-05-05T00-00-00-000Z',
      applyDirectorySync: false,
      includeMergedLive: true,
      skipBuild: false,
      skipVerify: false,
      json: true,
    });

    expect(run.artifactDir).toBe('tmp/player-data-convergence/2026-r0-2026-05-05T00-00-00-000Z');
    expect(run.commands.map((command) => command.phase)).toEqual([
      'diagnose',
      'sync-dry-run',
      'build-read-models',
      'verify-read-models',
    ]);
    expect(run.commands[0].args).toContain('--output-jsonl');
    expect(run.commands[1].args).toContain('--diagnostic-jsonl');
    expect(run.commands[1].args).not.toContain('--apply');
    expect(run.commands[2].args).toContain('--mode=refresh');
    expect(run.commands[3].args).toContain('--include-merged-live');
  });

  it('adds an explicit apply phase only when requested', () => {
    const run = buildPlayerDataConvergenceRun({
      season: 2026,
      rounds: [0, 1],
      runId: '2026-05-05T00-00-00-000Z',
      applyDirectorySync: true,
      includeMergedLive: false,
      skipBuild: false,
      skipVerify: false,
      json: true,
    });

    expect(run.commands.map((command) => command.phase)).toEqual([
      'diagnose',
      'sync-dry-run',
      'sync-apply',
      'build-read-models',
      'verify-read-models',
    ]);
    expect(run.commands[2].args).toContain('--apply');
    expect(run.commands[3].args).toContain('--rounds=0,1');
  });

  it('supports diagnostic-only investigation without build or verify', () => {
    const run = buildPlayerDataConvergenceRun({
      season: 2026,
      rounds: [0],
      runId: '2026-05-05T00-00-00-000Z',
      applyDirectorySync: false,
      includeMergedLive: false,
      skipBuild: true,
      skipVerify: true,
      json: false,
    });

    expect(run.commands.map((command) => command.phase)).toEqual(['diagnose', 'sync-dry-run']);
    expect(run.commands[0].args).not.toContain('--json');
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npx vitest run src/server/playerDataConvergenceRun.test.ts
```

Expected: fail because `src/server/playerDataConvergenceRun.ts` does not exist.

- [ ] **Step 3: Implement the pure planner**

Create `src/server/playerDataConvergenceRun.ts`:

```ts
export type PlayerDataConvergencePhase =
  | 'diagnose'
  | 'sync-dry-run'
  | 'sync-apply'
  | 'build-read-models'
  | 'verify-read-models';

export type PlayerDataConvergenceCommand = {
  phase: PlayerDataConvergencePhase;
  command: string;
  args: string[];
};

export type PlayerDataConvergenceRun = {
  season: number;
  rounds: number[];
  roundLabel: string;
  artifactDir: string;
  diagnosticJsonlPath: string;
  diagnosticCsvPath: string;
  commands: PlayerDataConvergenceCommand[];
};

export type BuildPlayerDataConvergenceRunInput = {
  season: number;
  rounds: number[];
  runId: string;
  applyDirectorySync: boolean;
  includeMergedLive: boolean;
  skipBuild: boolean;
  skipVerify: boolean;
  json: boolean;
};

export function parseConvergenceRounds(value: string | undefined): number[] {
  if (value == null || !value.trim()) {
    throw new Error('Expected --rounds with at least one non-negative integer round');
  }

  const decimalRoundPattern = /^(0|[1-9]\d*)$/;
  const rounds = value.split(',').map((token) => {
    const trimmed = token.trim();
    if (!decimalRoundPattern.test(trimmed)) {
      throw new Error('Expected --rounds to contain only comma-separated non-negative integers');
    }
    const parsed = Number(trimmed);
    if (!Number.isSafeInteger(parsed)) {
      throw new Error('Expected --rounds to contain only safe non-negative integer rounds');
    }
    return parsed;
  });

  return [...new Set(rounds)].sort((left, right) => left - right);
}

export function buildRunId(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function buildPlayerDataConvergenceRun(
  input: BuildPlayerDataConvergenceRunInput
): PlayerDataConvergenceRun {
  if (!Number.isInteger(input.season) || input.season < 2020 || input.season > 2035) {
    throw new Error('Expected --season between 2020 and 2035');
  }
  if (input.rounds.length === 0) {
    throw new Error('Expected at least one round');
  }

  const rounds = [...new Set(input.rounds)].sort((left, right) => left - right);
  const roundCsv = rounds.join(',');
  const roundLabel = `r${roundCsv.replace(/,/g, '-')}`;
  const artifactDir = `tmp/player-data-convergence/${input.season}-${roundLabel}-${input.runId}`;
  const diagnosticJsonlPath = `${artifactDir}/identity-gap.jsonl`;
  const diagnosticCsvPath = `${artifactDir}/identity-gap.csv`;
  const jsonArgs = input.json ? ['--json'] : [];

  const commands: PlayerDataConvergenceCommand[] = [
    {
      phase: 'diagnose',
      command: 'npm',
      args: [
        '--silent',
        'run',
        'diagnose:player-identity-gaps',
        '--',
        `--season=${input.season}`,
        `--rounds=${roundCsv}`,
        '--output-jsonl',
        diagnosticJsonlPath,
        '--output-csv',
        diagnosticCsvPath,
        ...jsonArgs,
      ],
    },
    {
      phase: 'sync-dry-run',
      command: 'npm',
      args: [
        '--silent',
        'run',
        'sync:player-directory-season',
        '--',
        `--season=${input.season}`,
        '--diagnostic-jsonl',
        diagnosticJsonlPath,
        ...jsonArgs,
      ],
    },
  ];

  if (input.applyDirectorySync) {
    commands.push({
      phase: 'sync-apply',
      command: 'npm',
      args: [
        '--silent',
        'run',
        'sync:player-directory-season',
        '--',
        `--season=${input.season}`,
        '--diagnostic-jsonl',
        diagnosticJsonlPath,
        '--apply',
        ...jsonArgs,
      ],
    });
  }

  if (!input.skipBuild) {
    commands.push({
      phase: 'build-read-models',
      command: 'npm',
      args: [
        '--silent',
        'run',
        'build:player-read-models',
        '--',
        `--season=${input.season}`,
        `--rounds=${roundCsv}`,
        '--mode=refresh',
        ...jsonArgs,
      ],
    });
  }

  if (!input.skipVerify) {
    commands.push({
      phase: 'verify-read-models',
      command: 'npm',
      args: [
        '--silent',
        'run',
        'verify:player-read-models',
        '--',
        `--season=${input.season}`,
        `--rounds=${roundCsv}`,
        ...(input.includeMergedLive ? ['--include-merged-live'] : []),
        ...jsonArgs,
      ],
    });
  }

  return {
    season: input.season,
    rounds,
    roundLabel,
    artifactDir,
    diagnosticJsonlPath,
    diagnosticCsvPath,
    commands,
  };
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
npx vitest run src/server/playerDataConvergenceRun.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/server/playerDataConvergenceRun.ts src/server/playerDataConvergenceRun.test.ts
git commit -m "feat: plan player data convergence runs"
```

Expected: commit succeeds.

## Task 2: Add Convergence Runner CLI

**Files:**

- Create: `Scripts/run-player-data-convergence.ts`
- Modify: `package.json`

- [ ] **Step 1: Create the runner CLI**

Create `Scripts/run-player-data-convergence.ts`:

```ts
#!/usr/bin/env tsx

import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';

import {
  buildPlayerDataConvergenceRun,
  buildRunId,
  parseConvergenceRounds,
  type PlayerDataConvergenceCommand,
} from '../src/server/playerDataConvergenceRun';

type CliArgs = {
  season: number;
  rounds: number[];
  applyDirectorySync: boolean;
  includeMergedLive: boolean;
  skipBuild: boolean;
  skipVerify: boolean;
  json: boolean;
};

function readArgValue(argv: string[], name: string): string | undefined {
  const equalsValue = argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
  if (equalsValue != null) return equalsValue;

  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

function parseArgs(argv: string[]): CliArgs {
  const season = Number(readArgValue(argv, '--season'));
  if (!Number.isInteger(season) || season < 2020 || season > 2035) {
    throw new Error('Expected --season between 2020 and 2035');
  }

  return {
    season,
    rounds: parseConvergenceRounds(readArgValue(argv, '--rounds')),
    applyDirectorySync: argv.includes('--apply-directory-sync'),
    includeMergedLive: argv.includes('--include-merged-live'),
    skipBuild: argv.includes('--skip-build'),
    skipVerify: argv.includes('--skip-verify'),
    json: argv.includes('--json'),
  };
}

async function runCommand(command: PlayerDataConvergenceCommand): Promise<void> {
  console.error(`[player-data-convergence] starting ${command.phase}`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.command, command.args, {
      stdio: 'inherit',
      env: process.env,
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Phase ${command.phase} failed with exit code ${code ?? 'unknown'}`));
      }
    });
  });
  console.error(`[player-data-convergence] completed ${command.phase}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const run = buildPlayerDataConvergenceRun({
    season: args.season,
    rounds: args.rounds,
    runId: buildRunId(),
    applyDirectorySync: args.applyDirectorySync,
    includeMergedLive: args.includeMergedLive,
    skipBuild: args.skipBuild,
    skipVerify: args.skipVerify,
    json: args.json,
  });

  await mkdir(run.artifactDir, { recursive: true });

  console.error(
    `[player-data-convergence] season=${run.season} rounds=${run.rounds.join(',')} artifacts=${run.artifactDir}`
  );
  if (!args.applyDirectorySync) {
    console.error(
      '[player-data-convergence] directory sync is dry-run only; pass --apply-directory-sync to apply reviewed roster evidence'
    );
  }

  for (const command of run.commands) {
    await runCommand(command);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Add the npm script**

Modify `package.json` in the `scripts` object immediately after `sync:player-directory-season`:

```json
"converge:player-data": "tsx Scripts/run-player-data-convergence.ts",
```

- [ ] **Step 3: Run the dry-run CLI against the proven slice**

Run:

```bash
npm --silent run converge:player-data -- --season=2026 --rounds=0 --skip-build --skip-verify --json
```

Expected:

- Diagnostic phase writes `tmp/player-data-convergence/.../identity-gap.jsonl`.
- Sync dry-run phase completes.
- No `sync-apply`, rebuild, or verifier phase runs because the command passed `--skip-build --skip-verify`.

- [ ] **Step 4: Run unit tests**

Run:

```bash
npx vitest run src/server/playerDataConvergenceRun.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add Scripts/run-player-data-convergence.ts package.json src/server/playerDataConvergenceRun.ts src/server/playerDataConvergenceRun.test.ts
git commit -m "feat: add player data convergence runner"
```

Expected: commit succeeds.

## Task 3: Document Full Data Rollout Protocol

**Files:**

- Modify: `docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md`

- [ ] **Step 1: Add the rollout protocol**

In `docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md`, after the `Season Player Directory Convergence Protocol` section, add:

````md
## Full Player Data Convergence Rollout Protocol

The 2026 round 0 repair proves the player-directory convergence path for one bounded slice. Other rounds and seasons are not considered repaired until they have been run through the same evidence-gated sequence.

Use the convergence runner for each planned slice:

```bash
npm --silent run converge:player-data -- --season=YYYY --rounds=R --include-merged-live --json
```

This default run diagnoses identity gaps, writes local `tmp/player-data-convergence/` artifacts, and dry-runs the reviewed roster sync. It does not apply Prisma directory writes.

Apply only when the dry-run reports complete reviewed roster coverage:

```bash
npm --silent run converge:player-data -- --season=YYYY --rounds=R --apply-directory-sync --include-merged-live --json
```

If the dry-run reports missing stored player ids or evidence mismatches, stop and add reviewed roster evidence first. Do not create players directly from diagnostic rows and do not patch Firestore as the primary fix.

For broad rollout, prefer small slices:

1. remaining 2026 rounds, one round or short contiguous range at a time
2. 2025 season slices after 2026 is clean
3. older seasons only after product requirements confirm those seasons need app-facing projections

Each claimed slice must exit with:

- `coverageOk: true` from directory sync
- `missingStoredPlayerIds: 0`
- `evidenceMismatchErrors: 0`
- `skippedWithoutCanonicalId: 0` from read-model build
- verifier `status: "pass"`
- no `dropped_before_raw`
- no `dropped_in_projection`

Generated `tmp/player-data-convergence/` artifacts are local evidence. Commit only reviewed source fixtures or docs, never local database files or transient diagnostic exports.
````

- [ ] **Step 2: Run Prettier on the docs and changed files**

Run:

```bash
npx prettier --write docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md Scripts/run-player-data-convergence.ts src/server/playerDataConvergenceRun.ts src/server/playerDataConvergenceRun.test.ts package.json
```

Expected: files are formatted.

- [ ] **Step 3: Commit**

Run:

```bash
git add docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md Scripts/run-player-data-convergence.ts package.json src/server/playerDataConvergenceRun.ts src/server/playerDataConvergenceRun.test.ts
git commit -m "docs: document player data convergence rollout"
```

Expected: commit succeeds.

## Task 4: Verify The Runner And Plan Against The Proven Slice

**Files:**

- No code changes expected.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npx vitest run src/server/playerDataConvergenceRun.test.ts
```

Expected: pass.

- [ ] **Step 2: Run TypeScript app typecheck**

Run:

```bash
npm run typecheck:app
```

Expected: pass.

- [ ] **Step 3: Run the dry-run convergence command**

Run:

```bash
npm --silent run converge:player-data -- --season=2026 --rounds=0 --skip-build --skip-verify --json
```

Expected: command completes without applying Prisma writes. The output must include only `diagnose` and `sync-dry-run` phases.

- [ ] **Step 4: Run full proven-slice convergence only if local env has Firestore and Prisma configured**

Run:

```bash
npm --silent run converge:player-data -- --season=2026 --rounds=0 --apply-directory-sync --include-merged-live --json
```

Expected if local env is configured like the previous run:

- `sync-apply` completes with `coverageOk: true`.
- `build-read-models` completes with `skippedWithoutCanonicalId: 0`.
- `verify-read-models` completes with `status: "pass"`.

If local env is not configured, stop after Step 3 and report that the operational apply/rebuild/verify phase needs the same local Firestore/Prisma setup used during the round 0 proof run.

- [ ] **Step 5: Review diff for contract drift**

Run:

```bash
git diff --check
git status --short
```

Expected:

- no whitespace errors
- only planned files changed
- no `tmp/` artifacts staged

## Self-Review

Spec coverage:

- Rest-of-data question is addressed by making the rollout explicit: the existing branch includes round 0 only; other slices require evidence-gated runs.
- Long-term optimality is addressed by preserving the canonical Firestore/Prisma boundary and avoiding fallback readers.
- Safety is addressed by dry-run default, explicit apply flag, bounded rounds, and verifier gates.
- Documentation is addressed in the identity pipeline protocol.

Placeholder scan:

- No task uses deferred-work markers or vague broad-brush language.
- Every code step includes concrete code or exact insertion text.
- Every verification step includes exact commands and expected outcome.

Type consistency:

- `PlayerDataConvergenceCommand`, `PlayerDataConvergenceRun`, and CLI imports use the same exported names across tasks.
- `--apply-directory-sync`, `--include-merged-live`, `--skip-build`, and `--skip-verify` are consistently named in tests, CLI, and docs.
