import type {
  PlayerDataConvergenceDryRunBlocker,
  PlayerDataConvergenceDryRunPlan,
} from '@/server/playerDataConvergenceDryRunPlan';

export type PlayerDataConvergenceTempDbSimulationStatus = 'readyForTempDbSimulation' | 'blocked';

export type PlayerDataConvergenceTempDbSimulationStepKind =
  | 'validateTempDatabaseContract'
  | 'validateDiagnosticEvidence'
  | 'classifySkippedSourceEvidence'
  | 'confirmNoRepairCandidates'
  | 'holdBeforeWriteApply';

export type PlayerDataConvergenceTempDbSimulationStepStatus = 'ready' | 'blocked' | 'notApplicable';

export type PlayerDataConvergenceTempDbSimulationStep = {
  kind: PlayerDataConvergenceTempDbSimulationStepKind;
  status: PlayerDataConvergenceTempDbSimulationStepStatus;
  message: string;
  evidence?: Record<string, unknown>;
};

export type PlayerDataConvergenceTempDbSimulation = {
  status: PlayerDataConvergenceTempDbSimulationStatus;
  safeForTempDbSimulation: boolean;
  safeForWritePlanning: false;
  safeForWriteApply: false;
  proposedWriteCount: 0;
  skippedRepairCount: number;
  blockers: PlayerDataConvergenceDryRunBlocker[];
  steps: PlayerDataConvergenceTempDbSimulationStep[];
  approvalGates: string[];
  stopConditions: string[];
  recommendedNextAction: string;
};

function step(
  kind: PlayerDataConvergenceTempDbSimulationStepKind,
  status: PlayerDataConvergenceTempDbSimulationStepStatus,
  message: string,
  evidence?: Record<string, unknown>
): PlayerDataConvergenceTempDbSimulationStep {
  return evidence ? { kind, status, message, evidence } : { kind, status, message };
}

function tempDatabaseStep(
  dryRunPlan: PlayerDataConvergenceDryRunPlan
): PlayerDataConvergenceTempDbSimulationStep {
  return step(
    'validateTempDatabaseContract',
    dryRunPlan.blockers.length === 0 ? 'ready' : 'blocked',
    dryRunPlan.blockers.length === 0
      ? 'The temp database contract is ready for a non-writing simulation.'
      : 'The temp database contract has blockers that must be resolved before simulation.',
    {
      statlyVerifyDb: dryRunPlan.tempDatabase.statlyVerifyDb,
      databaseUrl: dryRunPlan.tempDatabase.databaseUrl,
      safeForTempDbDryRun: dryRunPlan.safeForTempDbDryRun,
    }
  );
}

function diagnosticStep(
  dryRunPlan: PlayerDataConvergenceDryRunPlan
): PlayerDataConvergenceTempDbSimulationStep {
  const evidence = dryRunPlan.evidence;
  const hasBlockingIdentityEvidence =
    evidence.ambiguousNameMatches > 0 || evidence.unmatchedSourceRecords > 0;

  return step(
    'validateDiagnosticEvidence',
    hasBlockingIdentityEvidence ? 'blocked' : 'ready',
    hasBlockingIdentityEvidence
      ? 'Blocking identity evidence must be resolved before temp DB simulation.'
      : 'Diagnostic evidence is safe for a non-writing temp DB simulation.',
    {
      ambiguousNameMatches: evidence.ambiguousNameMatches,
      unmatchedSourceRecords: evidence.unmatchedSourceRecords,
      matchedRecordsByNormalizedNameTeam: evidence.matchedRecordsByNormalizedNameTeam,
    }
  );
}

function skippedSourceEvidenceStep(
  dryRunPlan: PlayerDataConvergenceDryRunPlan
): PlayerDataConvergenceTempDbSimulationStep {
  return step(
    'classifySkippedSourceEvidence',
    dryRunPlan.evidence.skippedNullStatSourceEvidence > 0 ? 'ready' : 'notApplicable',
    dryRunPlan.evidence.skippedNullStatSourceEvidence > 0
      ? 'All-null stat rows are classified as skipped source evidence, not repair candidates.'
      : 'No all-null stat source rows require skipped-evidence classification.',
    {
      skippedNullStatSourceEvidence: dryRunPlan.evidence.skippedNullStatSourceEvidence,
      missingExpectedCategoryValues: dryRunPlan.evidence.missingExpectedCategoryValues,
    }
  );
}

function repairCandidateStep(
  dryRunPlan: PlayerDataConvergenceDryRunPlan
): PlayerDataConvergenceTempDbSimulationStep {
  return step(
    'confirmNoRepairCandidates',
    dryRunPlan.evidence.proposedRepairCount === 0 ? 'ready' : 'blocked',
    dryRunPlan.evidence.proposedRepairCount === 0
      ? 'The simulation has no repair candidates and will not plan writes.'
      : 'Repair candidates require a separate approved write-planning task.',
    {
      proposedRepairCount: dryRunPlan.evidence.proposedRepairCount,
      skippedRepairCount: dryRunPlan.evidence.skippedRepairCount,
    }
  );
}

function holdBeforeApplyStep(
  dryRunPlan: PlayerDataConvergenceDryRunPlan
): PlayerDataConvergenceTempDbSimulationStep {
  return step(
    'holdBeforeWriteApply',
    'blocked',
    'Write apply remains blocked even when temp DB simulation evidence is ready.',
    {
      safeForWritePlanning: dryRunPlan.safeForWritePlanning,
      safeForWriteApply: dryRunPlan.safeForWriteApply,
    }
  );
}

export function planPlayerDataConvergenceTempDbSimulation(
  dryRunPlan: PlayerDataConvergenceDryRunPlan
): PlayerDataConvergenceTempDbSimulation {
  const steps = [
    tempDatabaseStep(dryRunPlan),
    diagnosticStep(dryRunPlan),
    skippedSourceEvidenceStep(dryRunPlan),
    repairCandidateStep(dryRunPlan),
    holdBeforeApplyStep(dryRunPlan),
  ];
  const hasSimulationBlocker = steps
    .filter((item) => item.kind !== 'holdBeforeWriteApply')
    .some((item) => item.status === 'blocked');
  const safeForTempDbSimulation =
    dryRunPlan.safeForTempDbDryRun &&
    dryRunPlan.evidence.proposedRepairCount === 0 &&
    !hasSimulationBlocker;

  return {
    status: safeForTempDbSimulation ? 'readyForTempDbSimulation' : 'blocked',
    safeForTempDbSimulation,
    safeForWritePlanning: false,
    safeForWriteApply: false,
    proposedWriteCount: 0,
    skippedRepairCount: dryRunPlan.evidence.skippedRepairCount,
    blockers: dryRunPlan.blockers,
    steps,
    approvalGates: [
      ...dryRunPlan.approvalGates,
      'Convert simulation steps into executable database writes.',
      'Persist player identity, stats, rankings, or category mappings.',
    ],
    stopConditions: [
      ...dryRunPlan.stopConditions,
      'Any simulation step proposes a nonzero write count.',
      'Any future implementation tries to make holdBeforeWriteApply ready automatically.',
    ],
    recommendedNextAction: safeForTempDbSimulation
      ? 'Use this simulation evidence for UAT only; request a separate approved task before any write-capable dry-run.'
      : 'Resolve simulation blockers before attempting any temp DB simulation or write-capable work.',
  };
}
