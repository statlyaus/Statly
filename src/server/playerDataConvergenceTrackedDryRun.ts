import type { Player } from '@/types/players';
import { REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';
import { diagnosePlayerDataConvergence } from '@/server/playerDataConvergenceDiagnostic';
import { planPlayerDataConvergenceTempDbDryRun } from '@/server/playerDataConvergenceDryRunPlan';
import { planPlayerDataConvergenceActions } from '@/server/playerDataConvergencePlanner';
import { planPlayerDataConvergenceTempDbSimulation } from '@/server/playerDataConvergenceTempDbSimulation';

export type RawPlayerStatRow = Record<string, unknown>;

export type PlayerDataConvergenceTrackedDryRunInput = {
  players: readonly Player[];
  rawStatRows: readonly RawPlayerStatRow[];
  statlyVerifyDb?: string | null;
  databaseUrl?: string | null;
  repositoryRoot?: string | null;
  tempDatabaseFileExists?: boolean;
};

export type PlayerDataConvergenceTrackedDryRunReport = ReturnType<
  typeof buildPlayerDataConvergenceTrackedDryRunReport
>;

const rawStatCategoryKeys: Record<(typeof REAL_DATA_NINE_CATEGORY_PRESET)[number], string> = {
  goals: 'G',
  tackles: 'T',
  inside50s: 'I50',
  intercepts: 'ITC',
  contestedMarks: 'CM',
  rebound50s: 'R50',
  contestedPossessions: 'CP',
  effectiveDisposals: 'ED',
  scoreInvolvements: 'SI',
};

function sourceRecordFromRawRow(row: RawPlayerStatRow) {
  return {
    player_name: typeof row.Player === 'string' ? row.Player : undefined,
    team: typeof row.Team === 'string' ? row.Team : undefined,
    stats: Object.fromEntries(
      REAL_DATA_NINE_CATEGORY_PRESET.map((category) => [
        category,
        row[rawStatCategoryKeys[category]],
      ])
    ),
  };
}

export function buildPlayerDataConvergenceTrackedDryRunReport({
  players,
  rawStatRows,
  statlyVerifyDb,
  databaseUrl,
  repositoryRoot,
  tempDatabaseFileExists = false,
}: PlayerDataConvergenceTrackedDryRunInput) {
  const diagnostic = diagnosePlayerDataConvergence({
    canonicalPlayers: players.map((player) => ({
      id: player.id,
      name: player.name,
      team: player.team,
      position: player.position,
    })),
    sourceRecords: rawStatRows.map(sourceRecordFromRawRow),
    expectedCategoryKeys: [...REAL_DATA_NINE_CATEGORY_PRESET],
  });
  const convergencePlan = planPlayerDataConvergenceActions({
    diagnostic,
    expectedCategoryKeys: [...REAL_DATA_NINE_CATEGORY_PRESET],
  });
  const dryRunPlan = planPlayerDataConvergenceTempDbDryRun({
    diagnostic,
    convergencePlan,
    statlyVerifyDb,
    databaseUrl,
    repositoryRoot,
  });
  const simulation = planPlayerDataConvergenceTempDbSimulation(dryRunPlan);
  const runtimeBlockers = tempDatabaseFileExists
    ? []
    : [
        {
          kind: 'tempDatabaseFileMissing' as const,
          message:
            'Pre-create STATLY_VERIFY_DB before running UAT, for example with : > "$STATLY_VERIFY_DB".',
        },
      ];
  const status =
    dryRunPlan.status === 'readyForTempDbDryRun' && runtimeBlockers.length === 0
      ? 'readyForUat'
      : 'blocked';
  const skippedSourceEvidence =
    convergencePlan.actions.find((action) => action.kind === 'skippedNullStatSourceEvidence') ??
    null;

  return {
    mode: 'player-data-convergence-temp-db-dry-run-uat',
    status,
    diagnostic: diagnostic.summary,
    planner: {
      status: convergencePlan.status,
      safeForNextReadOnlyDryRun: convergencePlan.safeForNextReadOnlyDryRun,
      safeForWritePlanning: convergencePlan.safeForWritePlanning,
      requiresProductDecision: convergencePlan.requiresProductDecision,
    },
    dryRunSummary: {
      status: dryRunPlan.status,
      safeForTempDbDryRun: dryRunPlan.safeForTempDbDryRun,
      safeForWritePlanning: dryRunPlan.safeForWritePlanning,
      safeForWriteApply: dryRunPlan.safeForWriteApply,
      proposedRepairCount: dryRunPlan.evidence.proposedRepairCount,
      skippedNullStatSourceEvidence: dryRunPlan.evidence.skippedNullStatSourceEvidence,
      skippedRepairCount: dryRunPlan.evidence.skippedRepairCount,
    },
    skippedSourceEvidence,
    dryRunPlan,
    simulation: {
      status: simulation.status,
      safeForTempDbSimulation: simulation.safeForTempDbSimulation,
      safeForWritePlanning: simulation.safeForWritePlanning,
      safeForWriteApply: simulation.safeForWriteApply,
      proposedWriteCount: simulation.proposedWriteCount,
      skippedRepairCount: simulation.skippedRepairCount,
      steps: simulation.steps,
      approvalGates: simulation.approvalGates,
      stopConditions: simulation.stopConditions,
      recommendedNextAction: simulation.recommendedNextAction,
    },
    runtimeChecks: {
      tempDatabaseFileExists,
      blockers: runtimeBlockers,
    },
    trackedDataWarnings: {
      allNullStatRowsAreSkippedSourceEvidence: dryRunPlan.evidence.skippedNullStatSourceEvidence,
      proposedRepairCount: dryRunPlan.evidence.proposedRepairCount,
      safeForWritePlanning: dryRunPlan.safeForWritePlanning,
      safeForWriteApply: dryRunPlan.safeForWriteApply,
    },
  };
}
