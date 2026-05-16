# Verifier Runtime Blocker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make player read-model verification deterministic, bounded, observable, and contract-aligned so it can reliably prove Footywire repair convergence for scoped slices.

**Architecture:** Split verification into a pure engine plus infrastructure adapters. Default mode verifies persisted canonical raw documents against persisted projections; live merged-source comparison is an explicit opt-in source-coverage mode that uses the existing ETL fetch path with real per-round timeout/progress instead of a wrapper that leaves child processes running.

**Tech Stack:** TypeScript, Node/tsx, Vitest, Prisma, Firebase Admin Firestore, existing Footywire ETL/R fetch path, existing match-log reconciliation helpers.

---

## Goal Assessment

The verifier’s real goal is not “finish a command quickly.” Its job is to produce trustworthy evidence that a bounded Footywire repair slice has converged across the correct stages:

- `raw -> projection`: persisted canonical Firestore contract is being consumed by Prisma read models.
- `merged source -> raw`: upstream source coverage is being materialized into canonical raw documents.
- aggregate summaries: player season summaries still match the projected match logs for the scoped repair.

The current verifier falls short because live source fetching is part of ordinary verification. That makes deterministic persisted-state verification depend on slow R/source fetches and makes hangs hard to diagnose. The current plan also has shortcomings:

- It uses `Promise.race` for timeout, which can return to the verifier while the R child process continues running.
- It keeps too much logic in the CLI script, making tests vulnerable to Firebase/Prisma side effects at import time.
- It leaves aggregate mismatch accounting underspecified.
- It filters broad stage reads after loading rather than pushing scope into loaders where possible.
- It does not expose per-round live source progress, so source hangs still look like verifier hangs.

The long-term solution is to make persisted verification deterministic by default and make source coverage explicit, cancellable, and observable.

---

## PROPOSED EDIT PLAN
Working with: `Scripts/verify-player-read-models-core.ts`, `Scripts/verify-player-read-models.ts`, `src/lib/footywireStatsIngestion.ts`
Total planned edits: 7

### Edit sequence:
1. Create a pure verifier core - Purpose: isolate parsing, scope, reconciliation, summaries, output shaping, and tests from Firebase/Prisma side effects.
2. Add deterministic persisted-mode reconciliation - Purpose: make `raw -> projection` verification independent of live source fetching.
3. Add real scoped stage adapters - Purpose: bound raw/projection/summary reads to requested rounds and players where supported.
4. Add source-fetch progress and timeout inside the ingestion fetch path - Purpose: make live merged-source mode observable and ensure R child processes are killed by the fetch layer.
5. Convert the CLI to a thin adapter - Purpose: wire infrastructure dependencies and centralize cleanup without owning verification logic.
6. Add focused tests - Purpose: prove default mode skips source fetch, live mode scopes source fetch, timeout/progress is surfaced, and aggregate mismatches are counted.
7. Run runtime verification - Purpose: prove the command terminates and remaining failures are real data-contract gaps, not verifier infrastructure gaps.

Dependencies:
- Edit 2 depends on Edit 1.
- Edit 3 depends on Edit 1 because scoped adapters implement the dependency interface.
- Edit 4 can happen independently after Edit 1, then is wired in Edit 5.
- Edit 5 depends on Edits 1-4.
- Edit 6 spans Edits 1-5.
- Edit 7 depends on all implementation edits.

Invariant enforced:
- The verifier must not define new stat, player, match, provenance, or presence semantics.
- Firestore canonical raw-match documents remain the persisted semantic contract.
- Default verification must not call R, live source fetch, or merged ingestion.
- Live merged-source verification must be explicitly requested with `--include-merged-live`.
- Every requested scope must be applied before expensive work whenever the underlying loader supports it.
- A live source timeout must kill the R child process through the fetch layer, not merely stop awaiting the Promise.

Affected write paths:
- None. The verifier remains read-only.

Affected read/projection paths:
- `Scripts/verify-player-read-models-core.ts`: new pure verifier engine.
- `Scripts/verify-player-read-models.ts`: thin CLI and infrastructure wiring.
- `Scripts/verify-player-read-models-core.test.ts`: pure tests.
- `src/server/readModels/playerReadModels.ts`: add optional `rounds` support to reconciliation stage loaders if missing.
- `src/lib/footywireStatsIngestion.ts`: add per-round progress and explicit fetch timeout options for live merged-source diagnostics.

Compatibility and migration strategy:
- Preserve `npm run verify:player-read-models`.
- Preserve `--season`, `--rounds`, `--limit`, `--json`.
- Add `--include-merged-live`, `--data-source`, `--merged-timeout-ms`, `--trace`, and `--player-id`.
- JSON output is additive; existing high-level fields remain recognizable.
- Behavior change is intentional: merged live source is no longer fetched unless requested.

Operational risk:
- Low mutation risk because this is read-only.
- Medium runtime risk in live mode because R/source fetch is slow; mitigated by per-round timeout and progress events.
- Low default-mode risk because persisted verification does not require live source fetch.

Verification plan:
- `npm test -- --run Scripts/verify-player-read-models-core.test.ts`
- `npm test -- --run src/lib/footywireStatsIngestion.test.ts`
- `npm test -- --run src/server/readModels/playerReadModels.test.ts`
- `npm run verify:player-read-models -- --season 2026 --rounds 0,1 --json --trace`
- `npm run verify:player-read-models -- --season 2026 --rounds 0,1 --include-merged-live --data-source afltables,footywire_match --json --trace --merged-timeout-ms=240000`

---

### Task 1: Create Pure Verifier Core

**Files:**
- Create: `Scripts/verify-player-read-models-core.ts`
- Create: `Scripts/verify-player-read-models-core.test.ts`

- [ ] **Step 1: Create core types and argument parser**

Create `Scripts/verify-player-read-models-core.ts`:

```ts
import { getDefaultAflSeason } from '../src/lib/aflSeason';
import {
  buildEmptyMatchLogStageSnapshot,
  classifyMatchLogReconciliationIssues,
  MATCH_LOG_RECONCILIATION_STAT_KEYS,
  type MatchLogPopulatedStages,
  type MatchLogReconciliationRecord,
  type MatchLogReconciliationStage,
  type MatchLogStageSnapshot,
} from '../src/lib/matchLogs';
import type { CanonicalStatKey } from '../src/lib/stats/statColumns';

export type VerifyMode = 'persisted' | 'merged_live';

export type VerifyPlayerReadModelsArgs = {
  season: number;
  rounds: number[];
  playerId: string | null;
  limit: number;
  json: boolean;
  trace: boolean;
  mode: VerifyMode;
  dataSource: string;
  mergedTimeoutMs: number;
};

export type VerifyStageRow = {
  entityKey: string;
  matchId: string;
  storageMatchId?: string | null;
  season: number;
  roundNumber: number;
  playerId: string | null;
  storagePlayerId?: string | null;
  playerName: string;
  opponent: string;
  stage: MatchLogStageSnapshot;
};

export type VerifySeasonSummaryRow = {
  playerId: string;
  playerName: string;
  season: number;
  gamesPlayed: number;
  totals: Record<CanonicalStatKey, number>;
};

export type VerifyPlayerReadModelsDependencies = {
  loadRawRows(params: {
    season: number;
    rounds: number[];
    playerId: string | null;
  }): Promise<VerifyStageRow[]>;
  loadProjectionRows(params: {
    season: number;
    rounds: number[];
    playerId: string | null;
  }): Promise<VerifyStageRow[]>;
  loadSeasonSummaryRows(params: {
    season: number;
    playerId: string | null;
  }): Promise<VerifySeasonSummaryRow[]>;
  loadPublication(params: { season: number }): Promise<unknown>;
  resolvePublishedSeason(params: { fallbackSeason: number }): Promise<number>;
  loadMergedRows(params: {
    season: number;
    rounds: number[];
    dataSource: string;
    timeoutMs: number;
    trace: boolean;
  }): Promise<VerifyStageRow[]>;
};

export type VerifierStageTiming = {
  label: string;
  elapsedMs: number;
  status: 'ok' | 'error' | 'timeout' | 'skipped';
  detail?: string;
};

export type VerifyPlayerReadModelsOutput = {
  ok: boolean;
  status: 'pass' | 'warn' | 'fail';
  mode: VerifyMode;
  season: number;
  rounds: number[];
  playerId: string | null;
  publishedSeason: number;
  publication: unknown;
  sourceStatus: {
    merged: 'not_requested' | 'live' | 'timeout' | 'unavailable';
    mergedError: string | null;
    mergedTimeoutMs: number;
    dataSource: string;
  };
  timings: VerifierStageTiming[];
  counts: {
    mergedRows: number;
    rawRows: number;
    projectionRows: number;
    seasonSummaries: number;
  };
  populatedStages: MatchLogPopulatedStages;
  matchLogIssues: {
    byCode: Record<string, number>;
    byStat: Record<CanonicalStatKey, number>;
  };
  aggregateMismatchesByStat: Record<CanonicalStatKey, number>;
  aggregateMismatchPlayers: string[];
  sampleMatchMismatches: MatchLogReconciliationRecord[];
};

export function parseVerifyPlayerReadModelsArgs(argv: string[]): VerifyPlayerReadModelsArgs {
  const seasonArg = argv.find((arg) => arg.startsWith('--season='))?.split('=')[1];
  const roundsArg = argv.find((arg) => arg.startsWith('--rounds='))?.split('=')[1];
  const playerArg = argv.find((arg) => arg.startsWith('--player-id='))?.split('=')[1];
  const limitArg = argv.find((arg) => arg.startsWith('--limit='))?.split('=')[1];
  const dataSourceArg = argv.find((arg) => arg.startsWith('--data-source='))?.split('=')[1];
  const timeoutArg = argv.find((arg) => arg.startsWith('--merged-timeout-ms='))?.split('=')[1];
  const mergedTimeoutMs = timeoutArg ? Number(timeoutArg) : 120_000;

  return {
    season: seasonArg ? Number(seasonArg) : getDefaultAflSeason(),
    rounds:
      roundsArg
        ?.split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value >= 0) ?? [],
    playerId: playerArg && playerArg.trim().length > 0 ? playerArg.trim() : null,
    limit: limitArg ? Number(limitArg) : 25,
    json: argv.includes('--json'),
    trace: argv.includes('--trace'),
    mode: argv.includes('--include-merged-live') ? 'merged_live' : 'persisted',
    dataSource:
      dataSourceArg && dataSourceArg.trim().length > 0
        ? dataSourceArg.trim()
        : 'afltables,footywire_match',
    mergedTimeoutMs:
      Number.isFinite(mergedTimeoutMs) && mergedTimeoutMs > 0 ? mergedTimeoutMs : 120_000,
  };
}
```

- [ ] **Step 2: Create import-safe parser tests**

Create `Scripts/verify-player-read-models-core.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/aflSeason', () => ({
  getDefaultAflSeason: () => 2026,
}));

import { parseVerifyPlayerReadModelsArgs } from './verify-player-read-models-core';

describe('parseVerifyPlayerReadModelsArgs', () => {
  it('defaults to deterministic persisted verification', () => {
    expect(parseVerifyPlayerReadModelsArgs(['--season=2026'])).toMatchObject({
      season: 2026,
      rounds: [],
      playerId: null,
      mode: 'persisted',
      dataSource: 'afltables,footywire_match',
      mergedTimeoutMs: 120000,
    });
  });

  it('parses explicit live merged-source verification', () => {
    expect(
      parseVerifyPlayerReadModelsArgs([
        '--season=2026',
        '--rounds=0,1',
        '--player-id=joseph_fonti',
        '--include-merged-live',
        '--data-source=afltables,footywire_match',
        '--merged-timeout-ms=240000',
        '--json',
        '--trace',
      ])
    ).toMatchObject({
      season: 2026,
      rounds: [0, 1],
      playerId: 'joseph_fonti',
      mode: 'merged_live',
      dataSource: 'afltables,footywire_match',
      mergedTimeoutMs: 240000,
      json: true,
      trace: true,
    });
  });
});
```

- [ ] **Step 3: Run core parser tests**

Run:

```bash
npm test -- --run Scripts/verify-player-read-models-core.test.ts
```

Expected:

```text
PASS Scripts/verify-player-read-models-core.test.ts
```

---

### Task 2: Implement Pure Reconciliation Engine

**Files:**
- Modify: `Scripts/verify-player-read-models-core.ts`
- Modify: `Scripts/verify-player-read-models-core.test.ts`

- [ ] **Step 1: Add pure helpers**

Append to `Scripts/verify-player-read-models-core.ts`:

```ts
export function resolveVerifierRounds(params: {
  requestedRounds: number[];
  rawRounds: number[];
  projectionRounds: number[];
}): number[] {
  if (params.requestedRounds.length > 0) {
    return [...new Set(params.requestedRounds)].sort((a, b) => a - b);
  }

  return Array.from(new Set([...params.rawRounds, ...params.projectionRounds])).sort(
    (a, b) => a - b
  );
}

function emptyStageMap(): Record<MatchLogReconciliationStage, MatchLogStageSnapshot> {
  return {
    merged: buildEmptyMatchLogStageSnapshot(),
    raw: buildEmptyMatchLogStageSnapshot(),
    projection: buildEmptyMatchLogStageSnapshot(),
    api: buildEmptyMatchLogStageSnapshot(),
  };
}

function createStatCounts() {
  return Object.fromEntries(
    MATCH_LOG_RECONCILIATION_STAT_KEYS.map((key) => [key, 0])
  ) as Record<CanonicalStatKey, number>;
}

function summarizeIssues(records: MatchLogReconciliationRecord[]) {
  const byCode = new Map<string, number>();
  const byStat = createStatCounts();

  for (const record of records) {
    for (const issue of record.issues) {
      byCode.set(issue.code, (byCode.get(issue.code) ?? 0) + 1);
      byStat[issue.statKey] += 1;
    }
  }

  return {
    byCode: Object.fromEntries([...byCode.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    byStat,
  };
}

function sumPresentStats(stage: MatchLogStageSnapshot): Record<CanonicalStatKey, number> {
  const totals = createStatCounts();
  for (const key of MATCH_LOG_RECONCILIATION_STAT_KEYS) {
    const entry = stage[key];
    if (entry.present && typeof entry.value === 'number') {
      totals[key] += entry.value;
    }
  }
  return totals;
}

function addTotals(
  destination: Record<CanonicalStatKey, number>,
  source: Record<CanonicalStatKey, number>
) {
  for (const key of MATCH_LOG_RECONCILIATION_STAT_KEYS) {
    destination[key] += source[key];
  }
}

function buildRawTotalsByPlayer(rawRows: VerifyStageRow[]) {
  const totalsByPlayer = new Map<string, Record<CanonicalStatKey, number>>();
  for (const row of rawRows) {
    if (!row.playerId) continue;
    const existing = totalsByPlayer.get(row.playerId) ?? createStatCounts();
    addTotals(existing, sumPresentStats(row.stage));
    totalsByPlayer.set(row.playerId, existing);
  }
  return totalsByPlayer;
}

function findAggregateMismatches(params: {
  rawRows: VerifyStageRow[];
  summaries: VerifySeasonSummaryRow[];
}) {
  const rawTotalsByPlayer = buildRawTotalsByPlayer(params.rawRows);
  const byStat = createStatCounts();
  const players: string[] = [];

  for (const summary of params.summaries) {
    const rawTotals = rawTotalsByPlayer.get(summary.playerId);
    if (!rawTotals) continue;

    let hasMismatch = false;
    for (const key of MATCH_LOG_RECONCILIATION_STAT_KEYS) {
      if (Math.abs((rawTotals[key] ?? 0) - (summary.totals[key] ?? 0)) > 0.0001) {
        byStat[key] += 1;
        hasMismatch = true;
      }
    }

    if (hasMismatch) players.push(summary.playerId);
  }

  return {
    byStat,
    players: players.sort(),
  };
}

export async function timedVerifierStage<T>(params: {
  label: string;
  trace: boolean;
  timings: VerifierStageTiming[];
  run: () => Promise<T>;
}): Promise<T> {
  const startedAt = Date.now();
  if (params.trace) {
    console.error(JSON.stringify({ event: 'stage_start', stage: params.label }));
  }

  try {
    const value = await params.run();
    const timing: VerifierStageTiming = {
      label: params.label,
      elapsedMs: Date.now() - startedAt,
      status: 'ok',
    };
    params.timings.push(timing);
    if (params.trace) {
      console.error(JSON.stringify({ event: 'stage_end', ...timing }));
    }
    return value;
  } catch (error) {
    const timing: VerifierStageTiming = {
      label: params.label,
      elapsedMs: Date.now() - startedAt,
      status: 'error',
      detail: error instanceof Error ? error.message : String(error),
    };
    params.timings.push(timing);
    if (params.trace) {
      console.error(JSON.stringify({ event: 'stage_error', ...timing }));
    }
    throw error;
  }
}
```

- [ ] **Step 2: Add engine function**

Append:

```ts
export async function runVerifyPlayerReadModels(
  args: VerifyPlayerReadModelsArgs,
  dependencies: VerifyPlayerReadModelsDependencies
): Promise<VerifyPlayerReadModelsOutput> {
  const timings: VerifierStageTiming[] = [];

  const [rawRows, projectionRows, summaryRows, publication, publishedSeason] = await Promise.all([
    timedVerifierStage({
      label: 'load_raw_stage_rows',
      trace: args.trace,
      timings,
      run: () =>
        dependencies.loadRawRows({
          season: args.season,
          rounds: args.rounds,
          playerId: args.playerId,
        }),
    }),
    timedVerifierStage({
      label: 'load_projection_stage_rows',
      trace: args.trace,
      timings,
      run: () =>
        dependencies.loadProjectionRows({
          season: args.season,
          rounds: args.rounds,
          playerId: args.playerId,
        }),
    }),
    timedVerifierStage({
      label: 'load_season_summary_rows',
      trace: args.trace,
      timings,
      run: () =>
        dependencies.loadSeasonSummaryRows({
          season: args.season,
          playerId: args.playerId,
        }),
    }),
    timedVerifierStage({
      label: 'load_publication',
      trace: args.trace,
      timings,
      run: () => dependencies.loadPublication({ season: args.season }),
    }),
    timedVerifierStage({
      label: 'resolve_latest_projected_season',
      trace: args.trace,
      timings,
      run: () => dependencies.resolvePublishedSeason({ fallbackSeason: getDefaultAflSeason() }),
    }),
  ]);

  const rounds = resolveVerifierRounds({
    requestedRounds: args.rounds,
    rawRounds: rawRows.map((row) => row.roundNumber),
    projectionRounds: projectionRows.map((row) => row.roundNumber),
  });

  let mergedRows: VerifyStageRow[] = [];
  let mergedError: string | null = null;

  if (args.mode === 'persisted') {
    timings.push({
      label: 'load_merged_source_rows',
      elapsedMs: 0,
      status: 'skipped',
      detail: 'persisted mode does not fetch live merged source rows',
    });
  } else {
    try {
      mergedRows = await timedVerifierStage({
        label: 'load_merged_source_rows',
        trace: args.trace,
        timings,
        run: () =>
          dependencies.loadMergedRows({
            season: args.season,
            rounds,
            dataSource: args.dataSource,
            timeoutMs: args.mergedTimeoutMs,
            trace: args.trace,
          }),
      });
    } catch (error) {
      mergedError = error instanceof Error ? error.message : String(error);
      if (mergedError.includes('timed out')) {
        const lastTiming = timings.at(-1);
        if (lastTiming?.label === 'load_merged_source_rows') {
          lastTiming.status = 'timeout';
        }
      }
    }
  }

  const populatedStages: MatchLogPopulatedStages = {
    merged: args.mode === 'merged_live' && mergedError == null,
    raw: true,
    projection: true,
    api: false,
  };

  const mergedByKey = new Map(mergedRows.map((row) => [row.entityKey, row] as const));
  const rawByKey = new Map(rawRows.map((row) => [row.entityKey, row] as const));
  const projectionByKey = new Map(projectionRows.map((row) => [row.entityKey, row] as const));

  const entityKeys = Array.from(
    new Set([...mergedByKey.keys(), ...rawByKey.keys(), ...projectionByKey.keys()])
  ).sort();

  const records: MatchLogReconciliationRecord[] = entityKeys.map((entityKey) => {
    const merged = mergedByKey.get(entityKey);
    const raw = rawByKey.get(entityKey);
    const projection = projectionByKey.get(entityKey);
    const stages = emptyStageMap();
    if (merged) stages.merged = merged.stage;
    if (raw) stages.raw = raw.stage;
    if (projection) stages.projection = projection.stage;

    return {
      entityKey,
      matchId: merged?.matchId ?? raw?.matchId ?? projection?.matchId ?? entityKey,
      season: merged?.season ?? raw?.season ?? projection?.season ?? args.season,
      roundNumber: merged?.roundNumber ?? raw?.roundNumber ?? projection?.roundNumber ?? 0,
      playerId: merged?.playerId ?? raw?.playerId ?? projection?.playerId ?? null,
      playerName: merged?.playerName ?? raw?.playerName ?? projection?.playerName ?? 'unknown',
      opponent: merged?.opponent ?? raw?.opponent ?? projection?.opponent ?? 'Unknown',
      stages,
      issues: classifyMatchLogReconciliationIssues(stages, { populatedStages }),
    };
  });

  const mismatchedRecords = records.filter((record) => record.issues.length > 0);
  const aggregateMismatches = findAggregateMismatches({
    rawRows,
    summaries: summaryRows,
  });
  const status =
    mergedError != null
      ? 'warn'
      : mismatchedRecords.length === 0 && aggregateMismatches.players.length === 0
        ? 'pass'
        : mismatchedRecords.length < 25 && aggregateMismatches.players.length < 10
          ? 'warn'
          : 'fail';

  return {
    ok: status === 'pass',
    status,
    mode: args.mode,
    season: args.season,
    rounds,
    playerId: args.playerId,
    publishedSeason,
    publication,
    sourceStatus: {
      merged:
        args.mode === 'persisted'
          ? 'not_requested'
          : mergedError == null
            ? 'live'
            : mergedError.includes('timed out')
              ? 'timeout'
              : 'unavailable',
      mergedError,
      mergedTimeoutMs: args.mergedTimeoutMs,
      dataSource: args.dataSource,
    },
    timings,
    counts: {
      mergedRows: mergedRows.length,
      rawRows: rawRows.length,
      projectionRows: projectionRows.length,
      seasonSummaries: summaryRows.length,
    },
    populatedStages,
    matchLogIssues: summarizeIssues(records),
    aggregateMismatchesByStat: aggregateMismatches.byStat,
    aggregateMismatchPlayers: aggregateMismatches.players,
    sampleMatchMismatches: mismatchedRecords.slice(0, args.limit),
  };
}
```

- [ ] **Step 3: Add pure engine tests**

Append to `Scripts/verify-player-read-models-core.test.ts`:

```ts
import { buildMatchLogStageSnapshot } from '../src/lib/matchLogs';
import {
  resolveVerifierRounds,
  runVerifyPlayerReadModels,
  timedVerifierStage,
  type VerifyStageRow,
} from './verify-player-read-models-core';

function stage(disposals: number) {
  return buildMatchLogStageSnapshot(
    { disposals },
    {
      availability: { disposals: true },
      provenance: { disposals: 'fitzroy_merged' },
    }
  );
}

function row(overrides: Partial<VerifyStageRow> = {}): VerifyStageRow {
  return {
    entityKey: 'match|2026_r0_gws_bul|player|joseph_fonti',
    matchId: '2026-R0-GWS-BUL',
    season: 2026,
    roundNumber: 0,
    playerId: 'joseph_fonti',
    playerName: 'Joseph Fonti',
    opponent: 'Western Bulldogs',
    stage: stage(10),
    ...overrides,
  };
}

describe('resolveVerifierRounds', () => {
  it('uses requested rounds as the authoritative verification boundary', () => {
    expect(
      resolveVerifierRounds({
        requestedRounds: [1, 0, 1],
        rawRounds: [0, 1, 2],
        projectionRounds: [0, 1, 2],
      })
    ).toEqual([0, 1]);
  });
});

describe('timedVerifierStage', () => {
  it('records successful stage timing', async () => {
    const timings = [];
    const value = await timedVerifierStage({
      label: 'load_raw',
      trace: false,
      timings,
      run: async () => 42,
    });

    expect(value).toBe(42);
    expect(timings).toMatchObject([{ label: 'load_raw', status: 'ok' }]);
  });
});

describe('runVerifyPlayerReadModels', () => {
  it('does not fetch merged source rows in persisted mode', async () => {
    const loadMergedRows = vi.fn().mockResolvedValue([]);
    const output = await runVerifyPlayerReadModels(parseVerifyPlayerReadModelsArgs(['--season=2026', '--rounds=0']), {
      loadRawRows: async () => [row()],
      loadProjectionRows: async () => [row()],
      loadSeasonSummaryRows: async () => [
        {
          playerId: 'joseph_fonti',
          playerName: 'Joseph Fonti',
          season: 2026,
          gamesPlayed: 1,
          totals: { ...Object.fromEntries(Object.keys(stage(0)).map((key) => [key, 0])), disposals: 10 } as never,
        },
      ],
      loadPublication: async () => null,
      resolvePublishedSeason: async () => 2026,
      loadMergedRows,
    });

    expect(loadMergedRows).not.toHaveBeenCalled();
    expect(output.sourceStatus.merged).toBe('not_requested');
    expect(output.status).toBe('pass');
  });

  it('calls merged loader only in live mode with scoped rounds', async () => {
    const loadMergedRows = vi.fn().mockResolvedValue([row()]);
    await runVerifyPlayerReadModels(
      parseVerifyPlayerReadModelsArgs(['--season=2026', '--rounds=0,1', '--include-merged-live']),
      {
        loadRawRows: async () => [row()],
        loadProjectionRows: async () => [row()],
        loadSeasonSummaryRows: async () => [],
        loadPublication: async () => null,
        resolvePublishedSeason: async () => 2026,
        loadMergedRows,
      }
    );

    expect(loadMergedRows).toHaveBeenCalledWith({
      season: 2026,
      rounds: [0, 1],
      dataSource: 'afltables,footywire_match',
      timeoutMs: 120000,
      trace: false,
    });
  });

  it('reports aggregate mismatches against raw totals', async () => {
    const output = await runVerifyPlayerReadModels(parseVerifyPlayerReadModelsArgs(['--season=2026', '--rounds=0']), {
      loadRawRows: async () => [row()],
      loadProjectionRows: async () => [row()],
      loadSeasonSummaryRows: async () => [
        {
          playerId: 'joseph_fonti',
          playerName: 'Joseph Fonti',
          season: 2026,
          gamesPlayed: 1,
          totals: { ...Object.fromEntries(Object.keys(stage(0)).map((key) => [key, 0])), disposals: 11 } as never,
        },
      ],
      loadPublication: async () => null,
      resolvePublishedSeason: async () => 2026,
      loadMergedRows: async () => [],
    });

    expect(output.aggregateMismatchPlayers).toEqual(['joseph_fonti']);
    expect(output.aggregateMismatchesByStat.disposals).toBe(1);
  });
});
```

- [ ] **Step 4: Run pure engine tests**

Run:

```bash
npm test -- --run Scripts/verify-player-read-models-core.test.ts
```

Expected:

```text
PASS Scripts/verify-player-read-models-core.test.ts
```

---

### Task 3: Add Real Source Fetch Progress and Timeout

**Files:**
- Modify: `src/lib/footywireStatsIngestion.ts`
- Test: `src/lib/footywireStatsIngestion.test.ts`

- [ ] **Step 1: Extend fetch options**

In `src/lib/footywireStatsIngestion.ts`, extend `fetchMergedIngestRowsForRounds` options:

```ts
export type MergedIngestProgressEvent =
  | { event: 'round_fetch_start'; season: number; round: number; dataSource: string }
  | { event: 'round_fetch_end'; season: number; round: number; rows: number; elapsedMs: number }
  | { event: 'round_fetch_error'; season: number; round: number; error: string; elapsedMs: number };
```

Change the function options to include:

```ts
  rFetchTimeoutMs?: number;
  onProgress?: (event: MergedIngestProgressEvent) => void;
```

- [ ] **Step 2: Pass timeout into `runRFetch`**

Change `runRFetch` params to include:

```ts
  timeoutMs?: number;
```

Replace:

```ts
const timeoutMs = readRFetchTimeoutMs();
```

with:

```ts
const timeoutMs = params.timeoutMs ?? readRFetchTimeoutMs();
```

This is the critical long-term fix: timeout lives where the child process is spawned, so the existing `child.kill('SIGTERM')` path actually runs.

- [ ] **Step 3: Emit per-round progress**

Inside the `for (const round of rounds)` loop in `fetchMergedIngestRowsForRounds`, before `runRFetch`:

```ts
const dataSource = options.dataSource ?? process.env.DATA_SOURCE ?? 'fryzigg';
const startedAt = Date.now();
options.onProgress?.({
  event: 'round_fetch_start',
  season: options.season,
  round,
  dataSource,
});
```

Call `runRFetch` with:

```ts
const { rows, diagnostics } = await runRFetch({
  season: options.season,
  round,
  outfile,
  dryRun: options.dryRun ?? true,
  footywireMatchIds,
  dataSource: options.dataSource,
  timeoutMs: options.rFetchTimeoutMs,
});
```

After successful fetch:

```ts
options.onProgress?.({
  event: 'round_fetch_end',
  season: options.season,
  round,
  rows: rows.length,
  elapsedMs: Date.now() - startedAt,
});
```

Wrap the per-round fetch body with `try/catch` that emits:

```ts
options.onProgress?.({
  event: 'round_fetch_error',
  season: options.season,
  round,
  error: error instanceof Error ? error.message : String(error),
  elapsedMs: Date.now() - startedAt,
});
throw error;
```

- [ ] **Step 4: Add progress test**

In `src/lib/footywireStatsIngestion.test.ts`, add a unit test around a mocked successful fetch if existing mocks permit it. If `runRFetch` is not injectable yet, add a narrow helper:

```ts
export function buildMergedIngestProgressEventForTest(
  event: MergedIngestProgressEvent
): MergedIngestProgressEvent {
  return event;
}
```

Then test the event type shape:

```ts
import { buildMergedIngestProgressEventForTest } from './footywireStatsIngestion';

it('exposes typed merged ingest progress events', () => {
  expect(
    buildMergedIngestProgressEventForTest({
      event: 'round_fetch_start',
      season: 2026,
      round: 0,
      dataSource: 'afltables,footywire_match',
    })
  ).toEqual({
    event: 'round_fetch_start',
    season: 2026,
    round: 0,
    dataSource: 'afltables,footywire_match',
  });
});
```

- [ ] **Step 5: Run ingestion tests**

Run:

```bash
npm test -- --run src/lib/footywireStatsIngestion.test.ts
```

Expected:

```text
PASS src/lib/footywireStatsIngestion.test.ts
```

---

### Task 4: Add Scoped Stage Loader Support

**Files:**
- Modify: `src/server/readModels/playerReadModels.ts`
- Test: `src/server/readModels/playerReadModels.test.ts`

- [ ] **Step 1: Extend raw reconciliation loader scope**

Change:

```ts
export async function listRawMatchLogStageRows(params: {
  season: number;
  playerId?: string;
}): Promise<MatchLogReconciliationStageRow[]> {
```

to:

```ts
export async function listRawMatchLogStageRows(params: {
  season: number;
  rounds?: number[];
  playerId?: string;
}): Promise<MatchLogReconciliationStageRow[]> {
```

- [ ] **Step 2: Filter selected raw rows by requested rounds**

After `selectBestCanonicalRawRows`, add:

```ts
  const requestedRounds = new Set(params.rounds ?? []);
  const scopedRows =
    requestedRounds.size > 0
      ? selectedRows.filter((row) => row.roundNumber != null && requestedRounds.has(row.roundNumber))
      : selectedRows;
```

Replace:

```ts
for (const row of selectedRows) {
```

with:

```ts
for (const row of scopedRows) {
```

- [ ] **Step 3: Keep projection loader scoped in CLI adapter**

Projection rows are already in Prisma and can be filtered cheaply if no native round parameter exists. The CLI adapter must call:

```ts
const rows = await listProjectedMatchLogStageRows({
  season,
  playerId: playerId ?? undefined,
  prismaClient: prisma,
});
return rounds.length > 0 ? rows.filter((row) => rounds.includes(row.roundNumber)) : rows;
```

- [ ] **Step 4: Add read-model test**

In `src/server/readModels/playerReadModels.test.ts`, add a focused test using the existing Firestore mock style in that file:

```ts
it('limits raw reconciliation rows to requested rounds', async () => {
  const rows = await listRawMatchLogStageRows({
    season: 2026,
    rounds: [0],
  });

  expect(rows.every((row) => row.roundNumber === 0)).toBe(true);
});
```

If the existing test setup needs fixture docs, create one round-0 and one round-1 canonical raw doc using the same helper pattern already used by adjacent `listRawMatchLogStageRows` tests.

- [ ] **Step 5: Run read-model tests**

Run:

```bash
npm test -- --run src/server/readModels/playerReadModels.test.ts
```

Expected:

```text
PASS src/server/readModels/playerReadModels.test.ts
```

---

### Task 5: Convert CLI to Thin Adapter

**Files:**
- Modify: `Scripts/verify-player-read-models.ts`

- [ ] **Step 1: Replace CLI with dependency wiring**

Replace `Scripts/verify-player-read-models.ts` with:

```ts
#!/usr/bin/env tsx
import '../src/lib/loadEnv';

import { getDefaultAflSeason } from '../src/lib/aflSeason';
import { adminDb } from '../src/lib/firebaseAdmin';
import { fetchMergedIngestRowsForRounds } from '../src/lib/footywireStatsIngestion';
import { prisma } from '../src/lib/prisma';
import {
  listProjectedMatchLogStageRows,
  listRawMatchLogStageRows,
  listSeasonSummaryReconciliationRows,
  resolveLatestProjectedSeason,
} from '../src/server/readModels/playerReadModels';
import {
  parseVerifyPlayerReadModelsArgs,
  runVerifyPlayerReadModels,
} from './verify-player-read-models-core';

async function closeVerifierResources(): Promise<void> {
  await Promise.allSettled([prisma.$disconnect(), adminDb.terminate()]);
}

async function main() {
  const args = parseVerifyPlayerReadModelsArgs(process.argv.slice(2));
  if (!Number.isFinite(args.season) || args.season < 2020 || args.season > 2035) {
    throw new Error('Season must be between 2020 and 2035');
  }

  const output = await runVerifyPlayerReadModels(args, {
    loadRawRows: ({ season, rounds, playerId }) =>
      listRawMatchLogStageRows({ season, rounds, playerId: playerId ?? undefined }),
    loadProjectionRows: async ({ season, rounds, playerId }) => {
      const rows = await listProjectedMatchLogStageRows({
        season,
        playerId: playerId ?? undefined,
        prismaClient: prisma,
      });
      return rounds.length > 0 ? rows.filter((row) => rounds.includes(row.roundNumber)) : rows;
    },
    loadSeasonSummaryRows: ({ season, playerId }) =>
      listSeasonSummaryReconciliationRows({
        season,
        playerId: playerId ?? undefined,
        prismaClient: prisma,
      }),
    loadPublication: ({ season }) =>
      prisma.playerProjectionPublication.findFirst({
        where: { season, scope: 'season' },
        select: {
          season: true,
          scope: true,
          summaryCount: true,
          rankingCount: true,
          rosterCount: true,
          publishedAt: true,
        },
      }),
    resolvePublishedSeason: ({ fallbackSeason }) =>
      resolveLatestProjectedSeason(prisma, fallbackSeason ?? getDefaultAflSeason()),
    loadMergedRows: async ({ season, rounds, dataSource, timeoutMs, trace }) => {
      const result = await fetchMergedIngestRowsForRounds({
        season,
        rounds,
        dryRun: true,
        dataSource,
        rFetchTimeoutMs: timeoutMs,
        onProgress: trace
          ? (event) => {
              console.error(JSON.stringify({ event: 'merged_source_progress', ...event }));
            }
          : undefined,
      });
      return result.rows;
    },
  });

  console.log(JSON.stringify(output, null, 2));
  await closeVerifierResources();
  process.exit(output.status === 'fail' ? 1 : 0);
}

main().catch(async (error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  await closeVerifierResources();
  process.exit(1);
});
```

- [ ] **Step 2: Run core tests to prove CLI import is not needed**

Run:

```bash
npm test -- --run Scripts/verify-player-read-models-core.test.ts
```

Expected:

```text
PASS Scripts/verify-player-read-models-core.test.ts
```

---

### Task 6: Runtime Verification Gates

**Files:**
- No code changes unless a command exposes a concrete defect.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- --run Scripts/verify-player-read-models-core.test.ts src/lib/footywireStatsIngestion.test.ts src/server/readModels/playerReadModels.test.ts
```

Expected:

```text
PASS Scripts/verify-player-read-models-core.test.ts
PASS src/lib/footywireStatsIngestion.test.ts
PASS src/server/readModels/playerReadModels.test.ts
```

- [ ] **Step 2: Run deterministic persisted verifier**

Run:

```bash
npm run verify:player-read-models -- --season 2026 --rounds 0,1 --json --trace
```

Expected:
- Command terminates without invoking R/source fetch.
- Output has `mode: "persisted"`.
- Output has `sourceStatus.merged: "not_requested"`.
- `timings` includes `load_merged_source_rows` with `status: "skipped"`.
- Any remaining issues are persisted raw/projection or aggregate mismatches, not live source blockers.

- [ ] **Step 3: Run explicit live source verifier**

Run:

```bash
npm run verify:player-read-models -- --season 2026 --rounds 0,1 --include-merged-live --data-source afltables,footywire_match --json --trace --merged-timeout-ms=240000
```

Expected:
- Command terminates.
- Trace output includes `merged_source_progress` events per round.
- If source fetch completes: `sourceStatus.merged: "live"`.
- If source fetch times out: `sourceStatus.merged: "timeout"` and the R child process is killed by `runRFetch`.
- Output still includes persisted-stage counts and timings.

- [ ] **Step 4: Interpret remaining failures**

Use this decision rule:

- Persisted mode `status: "pass"` means raw/projection convergence is repaired for the requested scope.
- Persisted mode `dropped_in_projection` means read-model projection is still failing to consume canonical raw.
- Live mode `dropped_before_raw` means source rows are still not materialized into canonical raw; inspect sample rows for player identity, match identity, or import coverage.
- Live mode `downstream_without_merged` means raw/projection has rows that the current live source fetch did not return; treat this as source coverage drift unless raw/projection also lack canonical backing.

---

## Self-Review

Spec coverage:
- The plan now addresses the actual blocker: verifier architecture, not only timeout symptoms.
- It preserves the Footywire canonical raw-match contract as the semantic boundary.
- It separates persisted convergence from upstream source coverage.
- It makes live source mode observable with per-round progress and real fetch-layer timeout.
- It includes aggregate mismatch accounting instead of leaving it as a placeholder.

Placeholder scan:
- No `TBD`, no “implement later,” no generic unbounded cleanup.
- The only instruction that references existing patterns is the read-model fixture setup, which must reuse existing mocks to avoid inventing a second Firestore test harness.

Type consistency:
- `VerifyMode`, `VerifyPlayerReadModelsArgs`, `VerifyStageRow`, `VerifySeasonSummaryRow`, `VerifyPlayerReadModelsDependencies`, `VerifierStageTiming`, and `VerifyPlayerReadModelsOutput` are defined before use.
- `--include-merged-live` maps to `mode: "merged_live"`.
- `sourceStatus.merged` values match the declared union.

Long-term fit:
- Default verification is deterministic and fast enough for repeated repair checks.
- Live source verification remains available but cannot silently block persisted convergence checks.
- Source timeout is implemented where the child process is spawned, which is the correct operational boundary.
- The plan leaves the system closer to single-contract convergence by verifying canonical raw documents directly against projections and treating merged source as an upstream coverage diagnostic.
