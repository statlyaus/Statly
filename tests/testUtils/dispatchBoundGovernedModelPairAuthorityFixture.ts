import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { aflTradeModelRunManifestV3Schema } from '@/server/aflTradeIntelligence/artifacts/modelRunManifest';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createDispatchBoundGovernedAflTradePickPavModelExecution } from '@/server/aflTradeIntelligence/modeling/governedPickPavModelExecution';
import { aflTradePlayerValidationReportSchema } from '@/server/aflTradeIntelligence/modeling/playerContributionValidation';
import {
  createGovernedValuationModelQualification,
  createGovernedValuationModelQualificationGateRecords,
  createGovernedValuationModelQualificationPolicy,
  deriveGovernedPickModelQualificationEvidence,
  deriveGovernedPlayerModelQualificationEvidence,
} from '@/server/aflTradeIntelligence/valuation/internal/governedValuationModelQualification';
import { createGovernedValuationComponentRunManifest } from '@/server/aflTradeIntelligence/valuation/internal/governedValuationComponentRunManifest';
import type {
  AflTradePrivateValuationModelOperation,
  AflTradePrivateValuationModelPairExactInput,
} from '@/server/aflTradeIntelligence/valuation/privateValuationModelPair';

import { createGovernedPickPavModelExecutionFixture } from './governedPickPavModelExecutionFixture';

type ArtifactReference = ReturnType<typeof createAflTradeCanonicalJsonArtifactRef>;

const playerCriteria = {
  schemaVersion: 'governed-player-model-qualification-criteria/v1' as const,
  minimumComparableObservations: 100,
  minimumRelativeMaeImprovement: 0.05,
  minimumRelativeRmseImprovement: 0.05,
  requiredAcceptanceOutcome: 'meets_declared_predictive_thresholds' as const,
};

const pickCriteria = {
  schemaVersion: 'governed-pick-model-qualification-criteria/v1' as const,
  evaluatedScope: 'final_test' as const,
  minimumObservations: 1,
  maximumMulticlassBrierScore: 1,
  maximumMulticlassLogLoss: 10,
  maximumRankedProbabilityScore: 1,
  maximumContributionCrps: 100,
  maximumMeanAbsoluteContributionError: 100,
  maximumRootMeanSquaredContributionError: 100,
  maximumMeanAbsoluteGamesError: 100,
  maximumRootMeanSquaredGamesError: 100,
  minimumEmpiricalP10P90Coverage: 0,
  maximumEmpiricalP10P90Coverage: 1,
  maximumMeanEmpiricalIntervalWidth: 200,
  maximumZeroProbabilityObservationCount: 100,
};

export function createDispatchBoundGovernedModelPairTargetsFixture() {
  const pickFixture = createGovernedPickPavModelExecutionFixture();
  const qualificationPolicy = createGovernedValuationModelQualificationPolicy({
    player: playerCriteria,
    pick: pickCriteria,
  });
  return {
    targets: {
      player: {
        modelId: createAflTradeContentAddress('development-grade-model', 'composed-player'),
        modelVersion: 'composed-player-v1',
        protocolId: createAflTradeContentAddress('model-protocol', 'composed-player'),
        datasetId: createAflTradeContentAddress('dataset', 'composed-player'),
        datasetAdmissionId: createAflTradeContentAddress('dataset-admission', 'composed-player'),
      },
      pick: {
        protocolId: pickFixture.execution.content.protocolId,
        datasetId: pickFixture.execution.content.datasetId,
        datasetAdmissionId: pickFixture.execution.content.datasetAdmissionId,
        policyId: pickFixture.execution.content.policyId,
      },
      qualificationPolicyId: qualificationPolicy.policyVersion,
    },
    qualificationPolicy,
    pickFixture,
  } as const;
}

export function createDispatchBoundGovernedModelPairAuthorityFixture(input: {
  readonly operation: AflTradePrivateValuationModelOperation;
  readonly exactInput: AflTradePrivateValuationModelPairExactInput;
  readonly claim: Readonly<{ claimId: string; leaseToken: string }>;
  readonly attemptNumber: number;
  readonly registeredAt: string;
  readonly targetsFixture: ReturnType<typeof createDispatchBoundGovernedModelPairTargetsFixture>;
}) {
  const operationSubstantive = {
    factualValuesSha256: input.operation.content.factualValuesSha256,
    hpnValuesSha256: input.operation.content.hpnValuesSha256,
    hpnMethodId: input.operation.content.hpnMethodId,
    player: input.operation.content.player,
    pick: input.operation.content.pick,
    qualificationPolicyId: input.operation.content.qualificationPolicyId,
  };
  if (
    input.operation.content.scopeKey !== input.exactInput.scopeKey ||
    JSON.stringify(operationSubstantive) !== JSON.stringify(input.exactInput.substantive) ||
    JSON.stringify({
      player: input.operation.content.player,
      pick: input.operation.content.pick,
      qualificationPolicyId: input.operation.content.qualificationPolicyId,
    }) !== JSON.stringify(input.targetsFixture.targets)
  ) {
    throw new TypeError('Dispatch-bound authority fixture requires one exact operation input.');
  }
  const documents = new Map<
    string,
    { readonly reference: ArtifactReference; readonly document: unknown }
  >();
  const retain = (document: unknown, createdAt = input.registeredAt) => {
    const reference = createAflTradeCanonicalJsonArtifactRef(document, createdAt);
    documents.set(reference.artifactId, { reference, document });
    return reference;
  };
  const retainExact = (reference: ArtifactReference, document: unknown) => {
    documents.set(reference.artifactId, { reference, document });
    return reference;
  };
  const targets = input.targetsFixture.targets;
  const registeredAt = new Date(input.registeredAt);
  const instantBefore = (milliseconds: number) =>
    new Date(registeredAt.getTime() - milliseconds).toISOString();

  const playerValidationContent = {
    schemaVersion: 'afl-trade-player-validation-report/v1' as const,
    publicIdentityBoundary: 'source_native_no_fantasy_ownership' as const,
    observationSetId: createAflTradeContentAddress('player-observation-set', 'composed-player'),
    baselineFitId: createAflTradeContentAddress('player-baseline-fit', 'composed-player'),
    predictionSetId: createAflTradeContentAddress('player-prediction-set', 'composed-player'),
    valueUnitId: 'player-contribution-above-replacement',
    evaluatedPartition: 'final_test' as const,
    candidateModelId: targets.player.modelId,
    config: {
      schemaVersion: 'afl-trade-player-validation-config/v1' as const,
      minimumComparableObservations: 100,
      acceptanceRule: 'candidate_improves_both_mae_and_rmse' as const,
      minimumRelativeMaeImprovement: 0.05,
      minimumRelativeRmseImprovement: 0.05,
      incompletePredictionCoverage: 'fail_closed' as const,
      governanceEffect: 'evidence_only_no_gate_or_source_approval' as const,
    },
    comparableObservationIds: Array.from(
      { length: 120 },
      (_, index) => `player-observation-${index + 1}`
    ),
    excludedObservations: [],
    metrics: {
      candidate: { meanAbsoluteError: 9.2, rootMeanSquaredError: 9.3, meanError: 0 },
      gamesOnly: { meanAbsoluteError: 10, rootMeanSquaredError: 10, meanError: 0 },
      candidateMinusGamesOnly: { meanAbsoluteError: -0.8, rootMeanSquaredError: -0.7 },
      relativeImprovement: { meanAbsoluteError: 0.08, rootMeanSquaredError: 0.07 },
    },
    acceptanceOutcome: 'meets_declared_predictive_thresholds' as const,
    evidenceLimitation:
      'report_is_reproducible_evidence_not_source_approval_gate_approval_or_production_readiness' as const,
  };
  const playerValidationReport = aflTradePlayerValidationReportSchema.parse({
    validationReportId: createAflTradeContentAddress(
      'player-validation-report',
      playerValidationContent
    ),
    content: playerValidationContent,
  });
  const playerValidationReportArtifact = retain(playerValidationReport, instantBefore(2_000));
  const playerRunContent = {
    schemaVersion: 'afl-trade-model-run/v3' as const,
    environment: 'non_production' as const,
    modelId: targets.player.modelId,
    modelVersion: targets.player.modelVersion,
    datasetId: targets.player.datasetId,
    datasetAdmissionId: targets.player.datasetAdmissionId,
    modelProtocolId: targets.player.protocolId,
    runIntentId: createAflTradeContentAddress('model-run-intent', 'composed-player'),
    runAuthorizationId: createAflTradeContentAddress('model-run-authorization', 'composed-player'),
    observationSetId: playerValidationContent.observationSetId,
    modelTrainingEvaluationReceiptIds: [
      createAflTradeContentAddress('gate0a-evaluation', 'composed-player'),
    ],
    codeCommitSha: 'a'.repeat(40),
    cleanWorktree: true as const,
    seed: 1,
    job: {
      jobId: 'composed-player-model-job',
      attempt: 1,
      initiatedBy: 'statly-model-qualification-agent',
      workerIdentity: 'statly-model-worker',
    },
    startedAt: instantBefore(10_000),
    candidateLockedAt: instantBefore(5_000),
    finalTestEvaluatedAt: instantBefore(3_000),
    finishedAt: instantBefore(1_000),
    windows: {
      train: { from: '2010-01-01T00:00:00.000Z', to: '2014-01-01T00:00:00.000Z' },
      calibration: { from: '2014-01-01T00:00:00.000Z', to: '2018-01-01T00:00:00.000Z' },
      validation: { from: '2018-01-01T00:00:00.000Z', to: '2022-01-01T00:00:00.000Z' },
      finalTest: { from: '2022-01-01T00:00:00.000Z', to: '2026-01-01T00:00:00.000Z' },
      embargoDays: 0,
    },
    sourceCodeArtifact: retain({ kind: 'player-source-code' }),
    dependencyLockArtifact: retain({ kind: 'player-dependency-lock' }),
    runtimeArtifact: retain({ kind: 'player-runtime' }),
    containerArtifact: retain({ kind: 'player-container' }),
    configurationArtifact: retain({ kind: 'player-configuration' }),
    environmentArtifact: retain({ kind: 'player-environment' }),
    featureDefinitionArtifacts: [retain({ kind: 'player-features' })],
    outcome: {
      status: 'succeeded' as const,
      modelArtifact: retain({ kind: 'player-model' }),
      validationReportArtifact: playerValidationReportArtifact,
      baselineComparisonArtifact: retain({ kind: 'player-baseline-comparison' }),
      calibrationReportArtifact: retain({ kind: 'player-calibration-report' }),
      intervalCoverageArtifact: retain({ kind: 'player-interval-coverage' }),
      subgroupReportArtifact: retain({ kind: 'player-subgroup-report' }),
      sensitivityReportArtifact: retain({ kind: 'player-sensitivity-report' }),
      leakageAuditArtifact: retain({ kind: 'player-leakage-audit' }),
      modelCardArtifact: retain({ kind: 'player-model-card' }),
      diagnosticsArtifact: retain({ kind: 'player-diagnostics' }),
    },
  };
  const playerNativeExecution = aflTradeModelRunManifestV3Schema.parse({
    runId: createAflTradeContentAddress('model-run', playerRunContent),
    content: playerRunContent,
  });
  const playerNativeExecutionArtifact = retain(playerNativeExecution, playerRunContent.finishedAt);

  const pickBase = input.targetsFixture.pickFixture;
  const baseContent = pickBase.execution.content;
  const pickNativeExecution = createDispatchBoundGovernedAflTradePickPavModelExecution({
    outputs: {
      observationSet: baseContent.observationSet,
      benchmarkConfig: baseContent.benchmarkConfig,
      validationConfig: baseContent.validationConfig,
      benchmark: baseContent.benchmark,
      validationReport: baseContent.validationReport,
    },
    completedAt: baseContent.completedAt,
    authority: {
      datasetId: baseContent.datasetId,
      datasetArtifact: baseContent.datasetArtifact,
      datasetAdmissionId: baseContent.datasetAdmissionId,
      datasetAdmissionArtifact: baseContent.datasetAdmissionArtifact,
      datasetAdmissionGateLedgerRevision: 1,
      protocolId: baseContent.protocolId,
      protocolArtifact: baseContent.protocolArtifact,
    },
    privateInput: {
      requestId: input.exactInput.requestId,
      operationId: input.operation.operationId,
      claimId: input.claim.claimId,
      attemptNumber: input.attemptNumber,
      leaseTokenSha256: createHash('sha256').update(input.claim.leaseToken).digest('hex'),
      factualOutputId: input.exactInput.factualOutputId,
      hpnCalculationId: input.exactInput.hpnCalculationId,
      factualValuesSha256: input.exactInput.substantive.factualValuesSha256,
      hpnValuesSha256: input.exactInput.substantive.hpnValuesSha256,
    },
  });
  const pickNativeExecutionArtifact = retain(
    pickNativeExecution,
    pickNativeExecution.content.completedAt
  );
  const pickAuthorityArtifacts = [
    pickNativeExecution.content.datasetArtifact,
    pickNativeExecution.content.datasetAdmissionArtifact,
    pickNativeExecution.content.protocolArtifact,
  ] as const;
  for (const [index, document] of pickBase.authorityDocuments.entries()) {
    retainExact(pickAuthorityArtifacts[index]!, document);
  }

  const playerComponent = createGovernedValuationComponentRunManifest({
    environment: 'non_production',
    role: 'player_contribution_and_availability',
    nativeExecution: {
      kind: 'admitted_player_model_run',
      executionId: playerNativeExecution.runId,
      artifact: playerNativeExecutionArtifact,
    },
    protocolId: targets.player.protocolId,
    protocolArtifact: retain({ kind: 'player-protocol' }),
    datasetId: targets.player.datasetId,
    datasetArtifact: retain({ kind: 'player-dataset' }),
    datasetAdmissionId: targets.player.datasetAdmissionId,
    datasetAdmissionArtifact: retain({ kind: 'player-dataset-admission' }),
    datasetAdmissionGateLedgerRevision: 1,
    registeredAt: input.registeredAt,
  });
  const pickComponent = createGovernedValuationComponentRunManifest({
    environment: 'non_production',
    role: 'draft_pick_and_future_pick_distribution',
    nativeExecution: {
      kind: 'governed_pick_pav_model_execution',
      executionId: pickNativeExecution.executionId,
      artifact: pickNativeExecutionArtifact,
    },
    protocolId: pickNativeExecution.content.protocolId,
    protocolArtifact: pickNativeExecution.content.protocolArtifact,
    datasetId: pickNativeExecution.content.datasetId,
    datasetArtifact: pickNativeExecution.content.datasetArtifact,
    datasetAdmissionId: pickNativeExecution.content.datasetAdmissionId,
    datasetAdmissionArtifact: pickNativeExecution.content.datasetAdmissionArtifact,
    datasetAdmissionGateLedgerRevision:
      pickNativeExecution.content.datasetAdmissionGateLedgerRevision,
    registeredAt: input.registeredAt,
  });
  const playerComponentArtifact = retain(playerComponent);
  const pickComponentArtifact = retain(pickComponent);
  const qualificationPolicy = input.targetsFixture.qualificationPolicy;
  const playerEvidence = deriveGovernedPlayerModelQualificationEvidence(playerValidationReport);
  const pickEvidence = deriveGovernedPickModelQualificationEvidence(
    pickNativeExecution.content.validationReport
  );
  const qualification = createGovernedValuationModelQualification({
    environment: 'non_production',
    scopeKey: input.operation.content.scopeKey,
    evaluatedAt: input.registeredAt,
    policy: qualificationPolicy,
    policyArtifact: retain(qualificationPolicy),
    components: {
      player: {
        role: playerComponent.content.role,
        runId: playerComponent.runId,
        runArtifact: playerComponentArtifact,
        protocolId: playerComponent.content.protocolId,
        protocolArtifact: playerComponent.content.protocolArtifact,
        criteriaArtifact: retain(qualificationPolicy.player),
        validationEvidence: playerEvidence,
        validationEvidenceArtifact: retain(playerEvidence),
      },
      pick: {
        role: pickComponent.content.role,
        runId: pickComponent.runId,
        runArtifact: pickComponentArtifact,
        protocolId: pickComponent.content.protocolId,
        protocolArtifact: pickComponent.content.protocolArtifact,
        criteriaArtifact: retain(qualificationPolicy.pick),
        validationEvidence: pickEvidence,
        validationEvidenceArtifact: retain(pickEvidence),
      },
    },
  });
  const qualificationArtifact = retain(qualification);
  const gateRecords = createGovernedValuationModelQualificationGateRecords({
    qualification,
    qualificationArtifact,
    decidedAt: input.registeredAt,
    automationPrincipal: 'statly-model-qualification-agent',
    accountableOwner: 'statly-model-owner',
    versions: { player: 1, pick: 1 },
    supersedes: { player: null, pick: null },
  });
  for (const record of gateRecords) {
    retain(record.proposal, record.proposal.content.proposedAt);
    retain(record.decision, record.decision.content.decidedAt!);
  }

  return {
    playerNativeExecution,
    pickNativeExecution,
    playerComponent,
    playerComponentArtifact,
    pickComponent,
    pickComponentArtifact,
    qualification,
    qualificationArtifact,
    gateRecords,
    artifactDocuments: Array.from(documents.values()),
  };
}
import { createHash } from 'node:crypto';
