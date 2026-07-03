import { describe, expect, it, vi } from 'vitest';

import type { PlayerDataConvergenceTrackedDryRunReport } from '@/server/playerDataConvergenceTrackedDryRun';
import {
  runPlayerDataConvergenceTempDbPreview,
  validatePlayerDataConvergenceTempDbRunner,
  type PlayerDataConvergenceTempDbExecutor,
} from '@/server/playerDataConvergenceTempDbRunner';

const tempDb = '/tmp/statly-verify-20260621040404.db';

function readyReport(
  overrides: Partial<PlayerDataConvergenceTrackedDryRunReport> = {}
): PlayerDataConvergenceTrackedDryRunReport {
  return {
    mode: 'player-data-convergence-temp-db-dry-run-uat',
    status: 'readyForUat',
    diagnostic: {
      totalCanonicalPlayers: 1,
      totalSourceStatRecords: 1,
      totalRankingRecords: 0,
      matchedRecordsByDirectId: 0,
      matchedRecordsByCanonicalId: 0,
      matchedRecordsByNormalizedNameTeam: 1,
      unmatchedCanonicalPlayers: 0,
      unmatchedSourceRecords: 0,
      ambiguousNameMatches: 0,
      duplicateSourceIdentities: 0,
      missingExpectedCategoryValues: 0,
      deprecatedCategoryKeys: 0,
      severity: 'ok',
    },
    planner: {
      status: 'allClear',
      safeForNextReadOnlyDryRun: true,
      safeForWritePlanning: false,
      requiresProductDecision: false,
    },
    dryRunSummary: {
      status: 'readyForTempDbDryRun',
      safeForTempDbDryRun: true,
      safeForWritePlanning: false,
      safeForWriteApply: false,
      proposedRepairCount: 0,
      skippedNullStatSourceEvidence: 0,
      skippedRepairCount: 0,
    },
    skippedSourceEvidence: null,
    dryRunPlan: {
      status: 'readyForTempDbDryRun',
      safeForTempDbDryRun: true,
      safeForWritePlanning: false,
      safeForWriteApply: false,
      requiresProductDecision: false,
      tempDatabase: {
        statlyVerifyDb: tempDb,
        databaseUrl: `file://${tempDb}`,
        precreateRequired: true,
        cleanupCommand: 'rm -f "$STATLY_VERIFY_DB"',
      },
      evidence: {
        totalCanonicalPlayers: 1,
        totalSourceStatRecords: 1,
        totalRankingRecords: 0,
        matchedRecordsByDirectId: 0,
        matchedRecordsByCanonicalId: 0,
        matchedRecordsByNormalizedNameTeam: 1,
        ambiguousNameMatches: 0,
        unmatchedCanonicalPlayers: 0,
        unmatchedSourceRecords: 0,
        duplicateSourceIdentities: 0,
        missingExpectedCategoryValues: 0,
        deprecatedCategoryKeys: 0,
        skippedNullStatSourceEvidence: 0,
        proposedRepairCount: 0,
        skippedRepairCount: 0,
      },
      blockers: [],
      approvalGates: [],
      stopConditions: [],
      recommendedNextAction: 'preview only',
    },
    simulation: {
      status: 'readyForTempDbSimulation',
      safeForTempDbSimulation: true,
      safeForWritePlanning: false,
      safeForWriteApply: false,
      proposedWriteCount: 0,
      skippedRepairCount: 0,
      steps: [],
      approvalGates: [],
      stopConditions: [],
      recommendedNextAction: 'preview only',
    },
    runtimeChecks: {
      tempDatabaseFileExists: true,
      blockers: [],
    },
    trackedDataWarnings: {
      allNullStatRowsAreSkippedSourceEvidence: 0,
      proposedRepairCount: 0,
      safeForWritePlanning: false,
      safeForWriteApply: false,
    },
    ...overrides,
  } as PlayerDataConvergenceTrackedDryRunReport;
}

function executor(): PlayerDataConvergenceTempDbExecutor & {
  executedSql: string[];
  queries: string[];
} {
  const executedSql: string[] = [];
  const queries: string[] = [];
  const query = vi.fn(async (sql: string, _params?: readonly unknown[]): Promise<unknown[]> => {
    queries.push(sql);
    return [{ count: 4 }];
  });

  return {
    executedSql,
    queries,
    execute: vi.fn(async (sql: string) => {
      executedSql.push(sql);
      return 1;
    }),
    query: query as unknown as PlayerDataConvergenceTempDbExecutor['query'],
  };
}

describe('player data convergence temp DB runner', () => {
  it('writes only preview evidence tables for a ready report', async () => {
    const fakeExecutor = executor();
    const result = await runPlayerDataConvergenceTempDbPreview({
      report: readyReport(),
      executor: fakeExecutor,
      now: new Date('2026-06-21T01:00:00.000Z'),
    });
    const combinedSql = [...fakeExecutor.executedSql, ...fakeExecutor.queries].join('\n');

    expect(result).toMatchObject({
      status: 'previewWritten',
      tempDatabase: tempDb,
      safeForProductWrites: false,
      previewRunId: 'player-data-preview-2026-06-21T01:00:00.000Z',
      previewEvidenceRows: 4,
      blockers: [],
      acceptance: {
        statusReadyForUat: true,
        simulationReady: true,
        proposedWriteCountZero: true,
        writeApplyBlocked: true,
        tempDatabasePresent: true,
      },
    });
    expect(result.previewTables).toEqual([
      'player_data_convergence_preview_runs',
      'player_data_convergence_preview_evidence',
    ]);
    expect(combinedSql).toContain('player_data_convergence_preview_runs');
    expect(combinedSql).toContain('player_data_convergence_preview_evidence');
    expect(combinedSql).not.toMatch(/\b(Player|Pick|LeagueRosterPlayer|LeagueRoster)\b/);
  });

  it('blocks when the dry-run report is not UAT-ready', () => {
    const result = validatePlayerDataConvergenceTempDbRunner(readyReport({ status: 'blocked' }));

    expect(result).toContainEqual(expect.objectContaining({ kind: 'dryRunNotReady' }));
  });

  it('blocks when write planning or apply becomes enabled', () => {
    const result = validatePlayerDataConvergenceTempDbRunner(
      readyReport({
        simulation: {
          ...readyReport().simulation,
          safeForWritePlanning: true as false,
          safeForWriteApply: true as false,
        },
      })
    );

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'writePlanningEnabled' }),
        expect.objectContaining({ kind: 'writeApplyEnabled' }),
      ])
    );
  });

  it('blocks when proposed writes or repairs are nonzero', () => {
    const result = validatePlayerDataConvergenceTempDbRunner(
      readyReport({
        dryRunSummary: {
          ...readyReport().dryRunSummary,
          proposedRepairCount: 1,
        },
        simulation: {
          ...readyReport().simulation,
          proposedWriteCount: 1 as 0,
        },
      })
    );

    expect(result).toContainEqual(expect.objectContaining({ kind: 'proposedWriteCountNonZero' }));
  });

  it('does not execute SQL when blocked', async () => {
    const fakeExecutor = executor();
    const result = await runPlayerDataConvergenceTempDbPreview({
      report: readyReport({
        runtimeChecks: {
          tempDatabaseFileExists: false,
          blockers: [],
        },
      }),
      executor: fakeExecutor,
    });

    expect(result.status).toBe('blocked');
    expect(result.blockers).toContainEqual(
      expect.objectContaining({ kind: 'tempDatabaseMissing' })
    );
    expect(fakeExecutor.execute).not.toHaveBeenCalled();
    expect(fakeExecutor.query).not.toHaveBeenCalled();
  });
});
