import { describe, expect, it } from 'vitest';

import type { PlayerDataConvergenceApplyPlan } from '@/server/playerDataConvergenceApplyPlan';
import { summarizePlayerDataConvergenceRunner } from '@/server/playerDataConvergenceRunner';
import type { PlayerDataConvergenceTempDbApplySimulationResult } from '@/server/playerDataConvergenceTempDbApplySimulation';
import type { PlayerDataConvergenceTrackedDryRunReport } from '@/server/playerDataConvergenceTrackedDryRun';
import type { PlayerDataConvergenceTempDbPreviewResult } from '@/server/playerDataConvergenceTempDbRunner';

const tempDb = '/tmp/statly-verify-20260622010101.db';

function applyPlan(
  overrides: Partial<PlayerDataConvergenceApplyPlan> = {}
): PlayerDataConvergenceApplyPlan {
  return {
    status: 'requiresReview',
    safeForTempDbApplySimulation: true,
    safeForProductApply: false,
    requiresProductDecision: false,
    productMutationCount: 0,
    skippedEvidenceCount: 618,
    productMutations: [],
    skippedEvidence: [
      {
        kind: 'multiRowSourceEvidence',
        message: 'multi-row evidence',
        count: 614,
      },
      {
        kind: 'nullStatSourceEvidence',
        message: 'null stat evidence',
        count: 4,
      },
    ],
    blockers: [],
    approvalGates: [],
    stopConditions: [],
    recommendedNextAction: 'simulate only',
    ...overrides,
  };
}

function report(
  overrides: Partial<PlayerDataConvergenceTrackedDryRunReport> = {}
): PlayerDataConvergenceTrackedDryRunReport {
  return {
    mode: 'player-data-convergence-temp-db-dry-run-uat',
    status: 'readyForUat',
    diagnostic: {
      totalCanonicalPlayers: 642,
      totalSourceStatRecords: 7544,
      totalRankingRecords: 0,
      matchedRecordsByDirectId: 0,
      matchedRecordsByCanonicalId: 0,
      matchedRecordsByNormalizedNameTeam: 7544,
      unmatchedCanonicalPlayers: 0,
      unmatchedSourceRecords: 0,
      ambiguousNameMatches: 0,
      duplicateSourceIdentities: 614,
      missingExpectedCategoryValues: 36,
      deprecatedCategoryKeys: 0,
      severity: 'warning',
    },
    planner: {
      status: 'readOnlyFollowUpSafe',
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
      skippedNullStatSourceEvidence: 4,
      skippedRepairCount: 618,
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
        totalCanonicalPlayers: 642,
        totalSourceStatRecords: 7544,
        totalRankingRecords: 0,
        matchedRecordsByDirectId: 0,
        matchedRecordsByCanonicalId: 0,
        matchedRecordsByNormalizedNameTeam: 7544,
        ambiguousNameMatches: 0,
        unmatchedCanonicalPlayers: 0,
        unmatchedSourceRecords: 0,
        duplicateSourceIdentities: 614,
        missingExpectedCategoryValues: 36,
        deprecatedCategoryKeys: 0,
        skippedNullStatSourceEvidence: 4,
        proposedRepairCount: 0,
        skippedRepairCount: 618,
      },
      blockers: [],
      approvalGates: [],
      stopConditions: [],
      recommendedNextAction: 'runner only',
    },
    applyPlan: applyPlan(),
    simulation: {
      status: 'readyForTempDbSimulation',
      safeForTempDbSimulation: true,
      safeForWritePlanning: false,
      safeForWriteApply: false,
      proposedWriteCount: 0,
      skippedRepairCount: 618,
      steps: [],
      approvalGates: [],
      stopConditions: [],
      recommendedNextAction: 'runner only',
    },
    runtimeChecks: {
      tempDatabaseFileExists: true,
      blockers: [],
    },
    trackedDataWarnings: {
      allNullStatRowsAreSkippedSourceEvidence: 4,
      proposedRepairCount: 0,
      safeForWritePlanning: false,
      safeForWriteApply: false,
    },
    ...overrides,
  } as PlayerDataConvergenceTrackedDryRunReport;
}

function preview(
  overrides: Partial<PlayerDataConvergenceTempDbPreviewResult> = {}
): PlayerDataConvergenceTempDbPreviewResult {
  return {
    status: 'previewWritten',
    tempDatabase: tempDb,
    safeForProductWrites: false,
    previewTables: [
      'player_data_convergence_preview_runs',
      'player_data_convergence_preview_evidence',
    ],
    previewRunId: 'preview-run',
    previewEvidenceRows: 4,
    blockers: [],
    acceptance: {
      statusReadyForUat: true,
      simulationReady: true,
      proposedWriteCountZero: true,
      writeApplyBlocked: true,
      tempDatabasePresent: true,
    },
    ...overrides,
  };
}

function applySimulation(
  overrides: Partial<PlayerDataConvergenceTempDbApplySimulationResult> = {}
): PlayerDataConvergenceTempDbApplySimulationResult {
  return {
    status: 'simulationApplied',
    tempDatabase: tempDb,
    safeForProductApply: false,
    simulationTables: [
      'player_data_convergence_apply_simulation_runs',
      'player_data_convergence_apply_simulation_mutations',
      'player_data_convergence_apply_simulated_players',
    ],
    productShapeTable: 'player_data_convergence_apply_simulated_players',
    simulationRunId: 'apply-simulation-run',
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
    ...overrides,
  };
}

describe('player data convergence runner summary', () => {
  it('summarizes the current non-durable runner path as ready for UAT', () => {
    const result = summarizePlayerDataConvergenceRunner({
      report: report(),
      preview: preview(),
      applySimulation: applySimulation(),
    });

    expect(result).toMatchObject({
      mode: 'player-data-convergence-runner',
      status: 'readyForUat',
      safeForProductWrites: false,
      safeForProductApply: false,
      tempDatabase: tempDb,
      summary: {
        matchedRecordsByNormalizedNameTeam: 7544,
        multiRowSourceEvidence: 614,
        skippedNullStatSourceEvidence: 4,
        proposedRepairCount: 0,
        productMutationCount: 0,
        appliedMutationCount: 0,
        previewEvidenceRows: 4,
        beforeProductRows: 0,
        afterProductRows: 0,
      },
      acceptance: {
        dryRunReady: true,
        previewWritten: true,
        applySimulationApplied: true,
        noProductRepairs: true,
        noProductMutations: true,
        productApplyBlocked: true,
        tempDatabasePresent: true,
      },
      blockers: [],
    });
  });

  it('blocks when preview or apply simulation stages do not run', () => {
    const result = summarizePlayerDataConvergenceRunner({
      report: report(),
      preview: null,
      applySimulation: null,
    });

    expect(result.status).toBe('blocked');
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'preview', kind: 'previewNotRun' }),
        expect.objectContaining({
          stage: 'applySimulation',
          kind: 'applySimulationNotRun',
        }),
      ])
    );
  });
});
