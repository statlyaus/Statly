import { describe, expect, it, vi } from 'vitest';

import type { PlayerDataConvergenceApplyPlan } from '@/server/playerDataConvergenceApplyPlan';
import {
  runPlayerDataConvergenceTempDbApplySimulation,
  validatePlayerDataConvergenceTempDbApplySimulation,
} from '@/server/playerDataConvergenceTempDbApplySimulation';
import type { PlayerDataConvergenceTrackedDryRunReport } from '@/server/playerDataConvergenceTrackedDryRun';
import type { PlayerDataConvergenceTempDbExecutor } from '@/server/playerDataConvergenceTempDbRunner';

const tempDb = '/tmp/statly-verify-20260621060606.db';

function applyPlan(
  overrides: Partial<PlayerDataConvergenceApplyPlan> = {}
): PlayerDataConvergenceApplyPlan {
  return {
    status: 'noProductRepairs',
    safeForTempDbApplySimulation: true,
    safeForProductApply: false,
    requiresProductDecision: false,
    productMutationCount: 0,
    skippedEvidenceCount: 0,
    productMutations: [],
    skippedEvidence: [],
    blockers: [],
    approvalGates: [],
    stopConditions: [],
    recommendedNextAction: 'simulate only',
    ...overrides,
  };
}

function readyReport(
  overrides: Partial<PlayerDataConvergenceTrackedDryRunReport> = {}
): PlayerDataConvergenceTrackedDryRunReport {
  const baseApplyPlan = applyPlan();

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
    applyPlan: baseApplyPlan,
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

  return {
    executedSql,
    queries,
    execute: vi.fn(async (sql: string) => {
      executedSql.push(sql);
      return 1;
    }),
    query: async <T,>(sql: string): Promise<T[]> => {
      queries.push(sql);
      return [{ count: 0 }] as T[];
    },
  };
}

describe('player data convergence temp DB apply simulation', () => {
  it('applies a zero-mutation plan to temp-only product-shaped tables', async () => {
    const fakeExecutor = executor();
    const result = await runPlayerDataConvergenceTempDbApplySimulation({
      report: readyReport(),
      applyPlan: applyPlan(),
      executor: fakeExecutor,
      now: new Date('2026-06-21T03:00:00.000Z'),
    });
    const combinedSql = [...fakeExecutor.executedSql, ...fakeExecutor.queries].join('\n');

    expect(result).toMatchObject({
      status: 'simulationApplied',
      tempDatabase: tempDb,
      safeForProductApply: false,
      productShapeTable: 'player_data_convergence_apply_simulated_players',
      simulationRunId: 'player-data-apply-simulation-2026-06-21T03:00:00.000Z',
      plannedMutationCount: 0,
      appliedMutationCount: 0,
      beforeProductRows: 0,
      afterProductRows: 0,
      blockers: [],
      acceptance: {
        statusReadyForUat: true,
        applyPlanReady: true,
        zeroProductMutations: true,
        productApplyBlocked: true,
        tempDatabasePresent: true,
      },
    });
    expect(result.simulationTables).toEqual([
      'player_data_convergence_apply_simulation_runs',
      'player_data_convergence_apply_simulation_mutations',
      'player_data_convergence_apply_simulated_players',
    ]);
    expect(combinedSql).toContain('player_data_convergence_apply_simulation_runs');
    expect(combinedSql).toContain('player_data_convergence_apply_simulation_mutations');
    expect(combinedSql).toContain('player_data_convergence_apply_simulated_players');
    expect(combinedSql).not.toMatch(/\b(Player|Pick|LeagueRosterPlayer|LeagueRoster)\b/);
  });

  it('blocks if the apply plan is blocked or not simulation-safe', () => {
    const result = validatePlayerDataConvergenceTempDbApplySimulation({
      report: readyReport(),
      applyPlan: applyPlan({
        status: 'blocked',
        safeForTempDbApplySimulation: false,
        blockers: [{ kind: 'plannerBlocked', message: 'blocked' }],
      }),
    });

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'applyPlanNotReady' }),
        expect.objectContaining({ kind: 'tempDbApplySimulationDisabled' }),
      ])
    );
  });

  it('blocks if product apply or product mutations appear', () => {
    const result = validatePlayerDataConvergenceTempDbApplySimulation({
      report: readyReport(),
      applyPlan: applyPlan({
        safeForProductApply: true as false,
        productMutationCount: 1,
        productMutations: [{ kind: 'createPlayer', reason: 'not allowed' }],
      }),
    });

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'productApplyEnabled' }),
        expect.objectContaining({ kind: 'productMutationsPresent' }),
      ])
    );
  });

  it('does not execute SQL when blocked', async () => {
    const fakeExecutor = executor();
    const result = await runPlayerDataConvergenceTempDbApplySimulation({
      report: readyReport({
        runtimeChecks: {
          tempDatabaseFileExists: false,
          blockers: [],
        },
      }),
      applyPlan: applyPlan(),
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
