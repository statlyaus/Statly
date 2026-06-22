import type {
  PlayerDataConvergenceTempDbApplySimulationBlocker,
  PlayerDataConvergenceTempDbApplySimulationResult,
} from '@/server/playerDataConvergenceTempDbApplySimulation';
import type { PlayerDataConvergenceTrackedDryRunReport } from '@/server/playerDataConvergenceTrackedDryRun';
import type {
  PlayerDataConvergenceTempDbPreviewResult,
  PlayerDataConvergenceTempDbRunnerBlocker,
} from '@/server/playerDataConvergenceTempDbRunner';

export type PlayerDataConvergenceRunnerStatus = 'readyForUat' | 'blocked';

export type PlayerDataConvergenceRunnerStage = 'dryRun' | 'preview' | 'applySimulation';

export type PlayerDataConvergenceRunnerBlocker = {
  stage: PlayerDataConvergenceRunnerStage;
  kind: string;
  message: string;
};

export type PlayerDataConvergenceRunnerInput = {
  report: PlayerDataConvergenceTrackedDryRunReport;
  preview: PlayerDataConvergenceTempDbPreviewResult | null;
  applySimulation: PlayerDataConvergenceTempDbApplySimulationResult | null;
};

export type PlayerDataConvergenceRunnerResult = {
  mode: 'player-data-convergence-runner';
  status: PlayerDataConvergenceRunnerStatus;
  safeForProductWrites: false;
  safeForProductApply: false;
  tempDatabase: string;
  summary: {
    totalCanonicalPlayers: number;
    totalSourceStatRecords: number;
    matchedRecordsByNormalizedNameTeam: number;
    ambiguousNameMatches: number;
    unmatchedSourceRecords: number;
    multiRowSourceEvidence: number;
    skippedNullStatSourceEvidence: number;
    proposedRepairCount: number;
    productMutationCount: number;
    appliedMutationCount: number;
    previewEvidenceRows: number;
    beforeProductRows: number;
    afterProductRows: number;
  };
  acceptance: {
    dryRunReady: boolean;
    previewWritten: boolean;
    applySimulationApplied: boolean;
    noProductRepairs: boolean;
    noProductMutations: boolean;
    productApplyBlocked: boolean;
    tempDatabasePresent: boolean;
  };
  blockers: PlayerDataConvergenceRunnerBlocker[];
  recommendedNextAction: string;
};

function runnerBlocker(
  stage: PlayerDataConvergenceRunnerStage,
  kind: string,
  message: string
): PlayerDataConvergenceRunnerBlocker {
  return { stage, kind, message };
}

function previewBlockers(
  preview: PlayerDataConvergenceTempDbPreviewResult | null
): PlayerDataConvergenceRunnerBlocker[] {
  if (!preview) {
    return [
      runnerBlocker(
        'preview',
        'previewNotRun',
        'The temp DB preview stage did not run because an earlier stage was blocked.'
      ),
    ];
  }

  return preview.blockers.map((blocker: PlayerDataConvergenceTempDbRunnerBlocker) =>
    runnerBlocker('preview', blocker.kind, blocker.message)
  );
}

function applySimulationBlockers(
  applySimulation: PlayerDataConvergenceTempDbApplySimulationResult | null
): PlayerDataConvergenceRunnerBlocker[] {
  if (!applySimulation) {
    return [
      runnerBlocker(
        'applySimulation',
        'applySimulationNotRun',
        'The temp DB apply simulation stage did not run because an earlier stage was blocked.'
      ),
    ];
  }

  return applySimulation.blockers.map(
    (blocker: PlayerDataConvergenceTempDbApplySimulationBlocker) =>
      runnerBlocker('applySimulation', blocker.kind, blocker.message)
  );
}

function dryRunBlockers(
  report: PlayerDataConvergenceTrackedDryRunReport
): PlayerDataConvergenceRunnerBlocker[] {
  const blockers: PlayerDataConvergenceRunnerBlocker[] = [];

  if (report.status !== 'readyForUat') {
    blockers.push(
      runnerBlocker('dryRun', 'dryRunNotReady', 'The tracked dry-run report is not ready for UAT.')
    );
  }

  for (const blocker of report.dryRunPlan.blockers) {
    blockers.push(runnerBlocker('dryRun', blocker.kind, blocker.message));
  }

  for (const blocker of report.runtimeChecks.blockers) {
    blockers.push(runnerBlocker('dryRun', blocker.kind, blocker.message));
  }

  return blockers;
}

function multiRowSourceEvidenceCount(report: PlayerDataConvergenceTrackedDryRunReport): number {
  return (
    report.applyPlan.skippedEvidence.find((item) => item.kind === 'multiRowSourceEvidence')
      ?.count ?? 0
  );
}

export function summarizePlayerDataConvergenceRunner({
  report,
  preview,
  applySimulation,
}: PlayerDataConvergenceRunnerInput): PlayerDataConvergenceRunnerResult {
  const blockers = [
    ...dryRunBlockers(report),
    ...previewBlockers(preview),
    ...applySimulationBlockers(applySimulation),
  ];
  const acceptance = {
    dryRunReady: report.status === 'readyForUat',
    previewWritten: preview?.status === 'previewWritten',
    applySimulationApplied: applySimulation?.status === 'simulationApplied',
    noProductRepairs: report.dryRunSummary.proposedRepairCount === 0,
    noProductMutations:
      report.applyPlan.productMutationCount === 0 &&
      (applySimulation?.appliedMutationCount ?? 0) === 0,
    productApplyBlocked:
      !report.applyPlan.safeForProductApply && !(applySimulation?.safeForProductApply ?? false),
    tempDatabasePresent: report.runtimeChecks.tempDatabaseFileExists,
  };
  const status =
    blockers.length === 0 &&
    acceptance.dryRunReady &&
    acceptance.previewWritten &&
    acceptance.applySimulationApplied
      ? 'readyForUat'
      : 'blocked';

  return {
    mode: 'player-data-convergence-runner',
    status,
    safeForProductWrites: false,
    safeForProductApply: false,
    tempDatabase: report.dryRunPlan.tempDatabase.statlyVerifyDb,
    summary: {
      totalCanonicalPlayers: report.diagnostic.totalCanonicalPlayers,
      totalSourceStatRecords: report.diagnostic.totalSourceStatRecords,
      matchedRecordsByNormalizedNameTeam: report.diagnostic.matchedRecordsByNormalizedNameTeam,
      ambiguousNameMatches: report.diagnostic.ambiguousNameMatches,
      unmatchedSourceRecords: report.diagnostic.unmatchedSourceRecords,
      multiRowSourceEvidence: multiRowSourceEvidenceCount(report),
      skippedNullStatSourceEvidence: report.dryRunSummary.skippedNullStatSourceEvidence,
      proposedRepairCount: report.dryRunSummary.proposedRepairCount,
      productMutationCount: report.applyPlan.productMutationCount,
      appliedMutationCount: applySimulation?.appliedMutationCount ?? 0,
      previewEvidenceRows: preview?.previewEvidenceRows ?? 0,
      beforeProductRows: applySimulation?.beforeProductRows ?? 0,
      afterProductRows: applySimulation?.afterProductRows ?? 0,
    },
    acceptance,
    blockers,
    recommendedNextAction:
      status === 'readyForUat'
        ? 'Runner UAT is complete for the current non-durable path; request a separate approved task before any durable apply mode.'
        : 'Resolve runner blockers before attempting any durable player-data convergence work.',
  };
}
