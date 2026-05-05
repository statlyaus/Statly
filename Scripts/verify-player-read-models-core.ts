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

type RawDriftLikelyCause =
  | 'merged_missing_raw_present'
  | 'raw_missing_merged_present'
  | 'raw_value_differs'
  | 'raw_provenance_differs'
  | 'raw_duplicate_selection'
  | 'projection_extra_without_merged'
  | 'unclassified';

export type RawDriftDiagnostic = {
  code: string;
  likelyCause: RawDriftLikelyCause;
  statKey: CanonicalStatKey;
  matchId: string;
  storageMatchId?: string | null;
  playerId: string | null;
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
    merged: 'not_requested' | 'live' | 'empty' | 'timeout' | 'unavailable';
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
  stageCoverage: Record<'merged' | 'raw' | 'projection', Record<CanonicalStatKey, number>>;
  matchLogIssues: {
    byCode: Record<string, number>;
    byStat: Record<CanonicalStatKey, number>;
  };
  rawDriftDiagnosticSummary: {
    byLikelyCause: Record<string, number>;
    byCode: Record<string, number>;
    byStat: Record<CanonicalStatKey, number>;
  };
  rawDriftDiagnostics: RawDriftDiagnostic[];
  aggregateCheck: {
    status: 'checked' | 'skipped';
    reason: string | null;
  };
  aggregateMismatchesByStat: Record<CanonicalStatKey, number>;
  aggregateMismatchPlayers: number;
  sampleMatchMismatches: MatchLogReconciliationRecord[];
  sampleAggregateMismatchPlayers: string[];
};

export function parseVerifyPlayerReadModelsArgs(argv: string[]): VerifyPlayerReadModelsArgs {
  const readArgValue = (name: string): string | undefined => {
    const equalsValue = argv.find((arg) => arg.startsWith(`${name}=`))?.split('=')[1];
    if (equalsValue != null) return equalsValue;
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };

  const seasonArg = readArgValue('--season');
  const roundsArg = readArgValue('--rounds');
  const playerArg = readArgValue('--player-id');
  const limitArg = readArgValue('--limit');
  const dataSourceArg = readArgValue('--data-source');
  const timeoutArg = readArgValue('--merged-timeout-ms');
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
  return Object.fromEntries(MATCH_LOG_RECONCILIATION_STAT_KEYS.map((key) => [key, 0])) as Record<
    CanonicalStatKey,
    number
  >;
}

function sumPresentStats(stage: MatchLogStageSnapshot) {
  const totals = createStatCounts();

  for (const key of MATCH_LOG_RECONCILIATION_STAT_KEYS) {
    const entry = stage[key];
    if (entry.present && typeof entry.value === 'number') {
      totals[key] += entry.value;
    }
  }

  return totals;
}

function addInto(
  destination: Record<CanonicalStatKey, number>,
  source: Record<CanonicalStatKey, number>
) {
  for (const key of MATCH_LOG_RECONCILIATION_STAT_KEYS) {
    destination[key] += source[key];
  }
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

function classifyRawDriftLikelyCause(params: {
  code: string;
  mergedPresent: boolean;
  rawPresent: boolean;
  projectionPresent: boolean;
  mergedProvenance: string | null;
  rawProvenance: string | null;
  matchId: string;
  storageMatchId?: string | null;
  playerId: string | null;
  storagePlayerId?: string | null;
}): RawDriftLikelyCause {
  if (params.code === 'dropped_before_raw' || (params.mergedPresent && !params.rawPresent)) {
    return 'raw_missing_merged_present';
  }

  if (
    params.code === 'downstream_without_merged' &&
    !params.mergedPresent &&
    params.projectionPresent
  ) {
    return 'projection_extra_without_merged';
  }

  if (!params.mergedPresent && params.rawPresent) {
    return 'merged_missing_raw_present';
  }

  if (params.code === 'raw_value_mismatch' && params.mergedPresent && params.rawPresent) {
    return 'raw_value_differs';
  }

  if (
    params.code === 'raw_provenance_mismatch' &&
    params.mergedPresent &&
    params.rawPresent &&
    params.mergedProvenance !== params.rawProvenance
  ) {
    return 'raw_provenance_differs';
  }

  const differentStorageMatch = Boolean(
    params.storageMatchId && params.storageMatchId !== params.matchId
  );
  const differentStoragePlayer = Boolean(
    params.storagePlayerId && params.playerId && params.storagePlayerId !== params.playerId
  );
  if (differentStorageMatch || differentStoragePlayer) {
    return 'raw_duplicate_selection';
  }

  return 'unclassified';
}

function buildRawDriftDiagnostics(params: {
  records: MatchLogReconciliationRecord[];
  rawByKey: Map<string, VerifyStageRow>;
  limit?: number;
}): RawDriftDiagnostic[] {
  const diagnostics: RawDriftDiagnostic[] = [];

  for (const record of params.records) {
    if (params.limit != null && diagnostics.length >= params.limit) break;
    if (record.issues.length === 0) continue;

    const rawRow = params.rawByKey.get(record.entityKey);

    for (const issue of record.issues) {
      if (params.limit != null && diagnostics.length >= params.limit) break;

      const merged = record.stages.merged[issue.statKey];
      const raw = record.stages.raw[issue.statKey];
      const projection = record.stages.projection[issue.statKey];
      diagnostics.push({
        code: issue.code,
        likelyCause: classifyRawDriftLikelyCause({
          code: issue.code,
          mergedPresent: merged.present,
          rawPresent: raw.present,
          projectionPresent: projection.present,
          mergedProvenance: merged.provenance,
          rawProvenance: raw.provenance,
          matchId: record.matchId,
          storageMatchId: rawRow?.storageMatchId,
          playerId: record.playerId,
          storagePlayerId: rawRow?.storagePlayerId,
        }),
        statKey: issue.statKey,
        matchId: record.matchId,
        storageMatchId: rawRow?.storageMatchId,
        playerId: record.playerId,
        storagePlayerId: rawRow?.storagePlayerId,
        playerName: record.playerName,
        mergedPresent: merged.present,
        rawPresent: raw.present,
        projectionPresent: projection.present,
        mergedValue: merged.value,
        rawValue: raw.value,
        projectionValue: projection.value,
        mergedProvenance: merged.provenance,
        rawProvenance: raw.provenance,
      });
    }
  }

  return diagnostics;
}

function summarizeRawDriftDiagnostics(diagnostics: RawDriftDiagnostic[]) {
  const byLikelyCause = new Map<RawDriftLikelyCause, number>();
  const byCode = new Map<string, number>();
  const byStat = createStatCounts();

  for (const diagnostic of diagnostics) {
    byLikelyCause.set(diagnostic.likelyCause, (byLikelyCause.get(diagnostic.likelyCause) ?? 0) + 1);
    byCode.set(diagnostic.code, (byCode.get(diagnostic.code) ?? 0) + 1);
    byStat[diagnostic.statKey] += 1;
  }

  return {
    byLikelyCause: Object.fromEntries(
      [...byLikelyCause.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    ),
    byCode: Object.fromEntries([...byCode.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    byStat,
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
    merged: args.mode === 'merged_live' && mergedError == null && mergedRows.length > 0,
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

  const stageCoverage = {
    merged: createStatCounts(),
    raw: createStatCounts(),
    projection: createStatCounts(),
  } as Record<'merged' | 'raw' | 'projection', Record<CanonicalStatKey, number>>;

  for (const record of records) {
    for (const stageName of ['merged', 'raw', 'projection'] as const) {
      for (const key of MATCH_LOG_RECONCILIATION_STAT_KEYS) {
        if (record.stages[stageName][key].present) {
          stageCoverage[stageName][key] += 1;
        }
      }
    }
  }

  const aggregateMismatchesByStat = createStatCounts();
  const aggregateMismatchPlayerIds: string[] = [];
  const aggregateCheck =
    args.rounds.length > 0
      ? {
          status: 'skipped' as const,
          reason:
            'round-scoped verification compares raw and match-log projections only; season summaries are full-season projections',
        }
      : { status: 'checked' as const, reason: null };

  if (aggregateCheck.status === 'checked') {
    const rawTotalsByPlayer = new Map<string, Record<CanonicalStatKey, number>>();
    for (const row of rawRows) {
      if (!row.playerId) continue;
      const existing = rawTotalsByPlayer.get(row.playerId) ?? createStatCounts();
      addInto(existing, sumPresentStats(row.stage));
      rawTotalsByPlayer.set(row.playerId, existing);
    }

    for (const summary of summaryRows) {
      const rawTotals = rawTotalsByPlayer.get(summary.playerId);
      if (!rawTotals) continue;

      let playerHasMismatch = false;
      for (const key of MATCH_LOG_RECONCILIATION_STAT_KEYS) {
        if (Math.abs((rawTotals[key] ?? 0) - (summary.totals[key] ?? 0)) > 0.0001) {
          aggregateMismatchesByStat[key] += 1;
          playerHasMismatch = true;
        }
      }

      if (playerHasMismatch) {
        aggregateMismatchPlayerIds.push(summary.playerId);
      }
    }
  }

  const aggregateMismatchPlayers = aggregateMismatchPlayerIds.sort();
  const mismatchedRecords = records.filter((record) => record.issues.length > 0);
  const issueSummary = summarizeIssues(records);
  const allRawDriftDiagnostics = buildRawDriftDiagnostics({
    records: mismatchedRecords,
    rawByKey,
  });
  const rawDriftDiagnostics = buildRawDriftDiagnostics({
    records: mismatchedRecords,
    rawByKey,
    limit: args.limit,
  });
  const status =
    mergedError != null
      ? 'warn'
      : mismatchedRecords.length === 0 && aggregateMismatchPlayers.length === 0
        ? 'pass'
        : mismatchedRecords.length < 25 && aggregateMismatchPlayers.length < 10
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
            ? mergedRows.length > 0
              ? 'live'
              : 'empty'
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
    stageCoverage,
    matchLogIssues: issueSummary,
    rawDriftDiagnosticSummary: summarizeRawDriftDiagnostics(allRawDriftDiagnostics),
    rawDriftDiagnostics,
    aggregateCheck,
    aggregateMismatchesByStat,
    aggregateMismatchPlayers: aggregateMismatchPlayers.length,
    sampleMatchMismatches: mismatchedRecords.slice(0, args.limit),
    sampleAggregateMismatchPlayers: aggregateMismatchPlayers.slice(0, args.limit),
  };
}
