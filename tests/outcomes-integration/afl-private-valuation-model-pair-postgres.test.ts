import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createAflTradeCanonicalJsonArtifactRef,
  type AflTradeArtifactRef,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { aflTradeModelRunManifestV3Schema } from '@/server/aflTradeIntelligence/artifacts/modelRunManifest';
import { createLocalAflTradePrivateDerivedArtifactRepository } from '@/server/aflTradeIntelligence/development/localFileConditionalObjectStore';
import {
  AFL_TRADE_HPN_PAV_FINALIZED_CALCULATION_SCHEMA_VERSION,
  aflTradeFinalizedHpnPavCalculationSchema,
} from '@/server/aflTradeIntelligence/modeling/hpnPavCalculationService';
import { calculateAflTradeHpnPavCore } from '@/server/aflTradeIntelligence/modeling/hpnPavCore';
import { createAflTradeAdmittedPlayerContributionExecutor } from '@/server/aflTradeIntelligence/modeling/admittedPlayerContributionCandidate';
import { aflTradeModelRunAuthorizationSchema } from '@/server/aflTradeIntelligence/modeling/admittedModelRunAuthority';
import { createGovernedAflTradePickPavModelExecution } from '@/server/aflTradeIntelligence/modeling/governedPickPavModelExecution';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  createAflTradeDispatchBoundAdmittedPlayerExecutor,
  createAflTradeGenuineDispatchBoundGovernedPickExecutor,
  loadAflTradePrivateValuationModelPairExactInput,
  PostgresAflTradePrivateValuationModelPairRepository,
} from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationModelPair';
import {
  createAflTradePrivateValuationModelOperation,
  createAflTradePrivateValuationModelPairCoordinator,
  type AflTradePrivateValuationModelPairExactInput,
  type AflTradePrivateValuationModelPairRepository,
} from '@/server/aflTradeIntelligence/valuation/privateValuationModelPair';
import { createAflTradePrivateValuationFactualOutput } from '@/server/aflTradeIntelligence/valuation/privateValuationFactualOutput';
import { composePostgresAflTradeCurrentValuationModelEvidenceDispatch } from '@/server/aflTradeIntelligence/valuation/postgresCurrentValuationModelEvidencePreparation';
import { AFL_TRADE_CURRENT_VALUATION_EVIDENCE_ORCHESTRATION_LIMITATION } from '@/server/aflTradeIntelligence/valuation/currentValuationEvidenceOrchestration';
import { AFL_TRADE_CURRENT_VALUATION_FACTUAL_REFRESH_LIMITATION } from '@/server/aflTradeIntelligence/valuation/currentValuationRefresh';
import { createAflTradePrivateCurrentValuationCohortPreparationOperationId } from '@/server/aflTradeIntelligence/valuation/currentValuationCohortPreparation';
import {
  createPostgresAflTradePrivateCurrentValuationCohortAuthorityCapture,
  createPostgresAflTradePrivateCurrentValuationCohortCoordinator,
} from '@/server/aflTradeIntelligence/valuation/postgresCurrentValuationCohortPreparation';
import { createPostgresGovernedPrivateEvaluationStagingRepository } from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedPrivateEvaluationStagingRepository';
import { createPostgresGovernedPrivateEvaluationWorkspace } from '@/server/aflTradeIntelligence/valuation/internal/createPostgresGovernedPrivateEvaluationWorkspace';
import { PostgresGovernedPrivateEvaluationBatchRepository } from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedPrivateEvaluationBatchRepository';
import { createPostgresAflTradePrivateEvaluationCohortRunner } from '@/server/aflTradeIntelligence/valuation/postgresCurrentValuationCohortRunner';
import { createGovernedValuationComponentRunManifest } from '@/server/aflTradeIntelligence/valuation/internal/governedValuationComponentRunManifest';
import { createGovernedPrivateEvaluationInputTrace } from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationInputTrace';
import { createGovernedPrivateEvaluationMaterializationManifest } from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationMaterializationManifest';
import { createAflTradeValuationCalculationInputPackage } from '@/server/aflTradeIntelligence/valuation/valuationCalculationInputPackage';
import {
  createGovernedValuationModelQualification,
  createGovernedValuationModelQualificationGateRecords,
  createGovernedValuationModelQualificationPolicy,
  deriveGovernedPickModelQualificationEvidence,
  deriveGovernedPlayerModelQualificationEvidence,
} from '@/server/aflTradeIntelligence/valuation/internal/governedValuationModelQualification';
import { appendNewAflTradeGateDecisionsWithinTransaction } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import { aflTradePlayerValidationReportSchema } from '@/server/aflTradeIntelligence/modeling/playerContributionValidation';

import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';
import {
  admittedRunFixture,
  runContent as admittedPlayerRunContent,
} from '../testUtils/admittedPlayerModelRunFixture';
import { createGovernedPrivateEvaluationAuthenticatedCalculationFixture } from '../testUtils/governedPrivateEvaluationAuthenticatedCalculationFixture';
import { createGovernedPickPavModelExecutionFixture } from '../testUtils/governedPickPavModelExecutionFixture';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
  })();
const schemaName = `afl_private_model_pair_${process.pid}_${Date.now()}`;
const adminPool = new Pool({ connectionString: databaseUrl });
const outcomesPool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 4,
});
const artifactRootDirectory = mkdtempSync(join(tmpdir(), 'statly-private-prepared-v3-'));

function scopedDatabaseUrl(): string {
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  return scoped.toString();
}

const digest = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const addressed = (prefix: string, value: string): string => `${prefix}:${digest(value)}`;

function canonicalArtifact(value: unknown, createdAt: string) {
  const reference = createAflTradeCanonicalJsonArtifactRef(value, createdAt);
  return {
    reference,
    bytes: new TextEncoder().encode(canonicalizeAflTradeJson(value)),
  };
}

function bundleParent(label: string): {
  readonly value: Readonly<{ fixture: string }>;
  readonly reference: AflTradeArtifactRef;
  readonly bytes: Uint8Array;
} {
  const value = { fixture: label } as const;
  return { value, ...canonicalArtifact(value, '2026-08-20T08:00:00.000Z') };
}

const loaderPlayerStats = {
  totalPoints: 10,
  hitOuts: 1,
  goalAssists: 1,
  inside50s: 2,
  marks: 3,
  marksInside50: 1,
  freeKicksFor: 2,
  freeKicksAgainst: 1,
  rebound50s: 1,
  onePercenters: 1,
  clearances: 2,
  tackles: 3,
};

function loaderCalculation(factualRunId: string, custodyKey: string) {
  const core = calculateAflTradeHpnPavCore([
    {
      teamId: 'club:loader-home',
      pointsFor: 100,
      pointsAgainst: 80,
      inside50sFor: 50,
      inside50sAgainst: 40,
      players: [
        {
          spellVersionId: addressed('acquisition-spell-version', `${custodyKey}-home`),
          playerId: 'player:loader-home',
          sourceRowIds: [`row:${custodyKey}-home`],
          ...loaderPlayerStats,
        },
      ],
    },
    {
      teamId: 'club:loader-away',
      pointsFor: 80,
      pointsAgainst: 100,
      inside50sFor: 40,
      inside50sAgainst: 50,
      players: [
        {
          spellVersionId: addressed('acquisition-spell-version', `${custodyKey}-away`),
          playerId: 'player:loader-away',
          sourceRowIds: [`row:${custodyKey}-away`],
          ...loaderPlayerStats,
        },
      ],
    },
  ]);
  const content = {
    schemaVersion: AFL_TRADE_HPN_PAV_FINALIZED_CALCULATION_SCHEMA_VERSION,
    authorityBoundary:
      'private_finalized_hpn_input_exact_method_bytes_no_publication_or_fantasy_ownership' as const,
    publicationEligible: false as const,
    environment: 'non_production' as const,
    competition: 'AFLM' as const,
    seasonYear: 2026,
    effectiveThrough: '2026-08-23T00:00:00.000Z',
    calculatedAt: '2026-08-24T00:00:01.000Z',
    methodId: addressed('hpn-pav-method', 'loader-method'),
    inputSetId: addressed('hpn-pav-input-set', `${custodyKey}-input`),
    inputSetSha256: digest(`${custodyKey}-input`),
    factualRunId,
    factualInputSetSha256: digest(`${custodyKey}-factual-input`),
    primaryProviders: ['afl_tables'],
    corroboratingProviders: ['footywire'],
    resultSourceRowIds: [`row:${custodyKey}-result`],
    valueUnit: 'season_pav' as const,
    ...core,
    players: core.players.map((player) => ({
      ...player,
      source: { ...player.source, gamesPlayed: 1 },
    })),
  };
  return aflTradeFinalizedHpnPavCalculationSchema.parse({
    calculationId: createAflTradeContentAddress('hpn-pav-season', content),
    content,
  });
}

const admittedPlayer = admittedRunFixture('non_production', undefined, {
  predictiveFeatures: true,
});
const governedPickFixture = createGovernedPickPavModelExecutionFixture();
const governedPick = {
  ...governedPickFixture,
  execution: createGovernedAflTradePickPavModelExecution({
    outputs: {
      observationSet: governedPickFixture.execution.content.observationSet,
      benchmarkConfig: governedPickFixture.execution.content.benchmarkConfig,
      validationConfig: governedPickFixture.execution.content.validationConfig,
      benchmark: governedPickFixture.execution.content.benchmark,
      validationReport: governedPickFixture.execution.content.validationReport,
    },
    completedAt: governedPickFixture.execution.content.completedAt,
    authority: {
      datasetId: governedPickFixture.execution.content.datasetId,
      datasetArtifact: governedPickFixture.execution.content.datasetArtifact,
      datasetAdmissionId: governedPickFixture.execution.content.datasetAdmissionId,
      datasetAdmissionArtifact: governedPickFixture.execution.content.datasetAdmissionArtifact,
      datasetAdmissionGateLedgerRevision: 1,
      protocolId: governedPickFixture.execution.content.protocolId,
      protocolArtifact: governedPickFixture.execution.content.protocolArtifact,
    },
  }),
};
const qualificationPolicy = createGovernedValuationModelQualificationPolicy({
  player: {
    schemaVersion: 'governed-player-model-qualification-criteria/v1',
    minimumComparableObservations: 100,
    minimumRelativeMaeImprovement: 0.05,
    minimumRelativeRmseImprovement: 0.05,
    requiredAcceptanceOutcome: 'meets_declared_predictive_thresholds',
  },
  pick: {
    schemaVersion: 'governed-pick-model-qualification-criteria/v1',
    evaluatedScope: 'final_test',
    minimumObservations: 1,
    maximumMulticlassBrierScore: 0.7,
    maximumMulticlassLogLoss: 2,
    maximumRankedProbabilityScore: 0.35,
    maximumContributionCrps: 25,
    maximumMeanAbsoluteContributionError: 30,
    maximumRootMeanSquaredContributionError: 40,
    maximumMeanAbsoluteGamesError: 35,
    maximumRootMeanSquaredGamesError: 45,
    minimumEmpiricalP10P90Coverage: 0.7,
    maximumEmpiricalP10P90Coverage: 1,
    maximumMeanEmpiricalIntervalWidth: 80,
    maximumZeroProbabilityObservationCount: 0,
  },
});
const modelPairTargets = {
  player: {
    modelId: admittedPlayer.intent.content.modelId,
    modelVersion: admittedPlayer.intent.content.modelVersion,
    protocolId: admittedPlayer.protocol.protocolId,
    datasetId: admittedPlayer.datasetCandidate.datasetId,
    datasetAdmissionId: admittedPlayer.admission.admissionId,
  },
  pick: {
    protocolId: governedPick.execution.content.protocolId,
    datasetId: governedPick.execution.content.datasetId,
    datasetAdmissionId: governedPick.execution.content.datasetAdmissionId,
    policyId: governedPick.execution.content.policyId,
  },
  qualificationPolicyId: qualificationPolicy.policyVersion,
} as const;

function loaderFactualOutput(requestId: string, custodyKey: string, factualRunId: string) {
  return createAflTradePrivateValuationFactualOutput({
    requestId,
    valuationScopeKey: 'afl-men:2026-trades',
    captureBindingId: addressed('private-valuation-capture-binding', `${custodyKey}-capture`),
    sourceAdmissionId: addressed('private-valuation-source-admission', `${custodyKey}-admission`),
    normalizationRunId: addressed('provider-normalization-run', `${custodyKey}-normalization`),
    factBatch: {
      batchId: addressed('source-fact-batch', `${custodyKey}-batch`),
      batchSha256: digest(`${custodyKey}-batch`),
    },
    reconciliation: {
      factualRunId,
      runSha256: factualRunId.slice('factual-reconciliation-run:'.length),
      outputSetSha256: digest('exact-loader-output-set'),
      finalizedAt: '2026-08-24T00:00:00.000Z',
    },
    spellMetricBatches: [
      {
        batchId: addressed('acquisition-spell-metric-batch', `${custodyKey}-metrics`),
        batchSha256: digest(`${custodyKey}-metrics`),
      },
    ],
    candidate: {
      candidateId: addressed('factual-release-candidate', `${custodyKey}-candidate`),
      candidateSha256: digest(`${custodyKey}-candidate`),
      memberSetSha256: digest('exact-loader-members'),
    },
    factualRelease: {
      releaseId: addressed('outcome-release', `${custodyKey}-release`),
      releaseSha256: digest(`${custodyKey}-release`),
    },
    preparedAt: '2026-08-24T00:00:01.000Z',
  });
}

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scopedDatabaseUrl() });
  await outcomesPool.query(`
    ALTER FUNCTION outcome_private_reviewed_evidence_bundle_is_current(text)
      RENAME TO outcome_private_reviewed_evidence_bundle_is_current_base;
    CREATE FUNCTION outcome_private_prepared_v3_fixture_bundle_is_current(target_id text)
    RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT coalesce((SELECT
        bundle.evidence_scope_key='reviewed-five-season-and-current-evidence'
        AND bundle.bundle_json#>>'{content,fixtureCurrent}'='true'
        FROM outcome_private_reviewed_evidence_bundle bundle
        WHERE bundle.evidence_bundle_id=target_id),false)
    $$;
    CREATE FUNCTION outcome_private_reviewed_evidence_bundle_is_current(
      target_evidence_bundle_id text
    ) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT outcome_private_reviewed_evidence_bundle_is_current_base(
               target_evidence_bundle_id)
          OR outcome_private_prepared_v3_fixture_bundle_is_current(
               target_evidence_bundle_id)
    $$;
  `);
});

afterAll(async () => {
  const failures: unknown[] = [];
  try {
    await outcomesPool.end();
  } catch (error) {
    failures.push(error);
  }
  try {
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } catch (error) {
    failures.push(error);
  }
  try {
    await adminPool.end();
  } catch (error) {
    failures.push(error);
  }
  try {
    rmSync(artifactRootDirectory, { recursive: true, force: true });
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Private model-pair PostgreSQL cleanup failed.');
  }
});

describe.sequential('dispatch-bound private model pair in PostgreSQL', () => {
  it('reconstructs after each retained component, pair acceptance, and qualification', async () => {
    const leaseToken = digest('restart-proof-lease-token');
    const requestId = addressed('private-valuation-dispatch', 'request');
    const claimId = addressed('private-valuation-dispatch-claim', 'claim');
    const factualRunId = addressed('factual-reconciliation-run', 'factual-run');
    const factualOutput = loaderFactualOutput(requestId, 'restart-proof', factualRunId);
    const factualOutputId = factualOutput.outputId;
    const hpnCalculation = loaderCalculation(factualRunId, 'restart-proof');
    const hpnCalculationId = hpnCalculation.calculationId;
    const playerIntentId = addressed('model-run-intent', 'player-intent');
    const operationalReceiptId = addressed('architecture-operation-receipt', 'operation');
    const playerAuthorizationId = addressed('model-run-authorization', 'authorization');
    const now = new Date();
    const retainedDispatchRequest = {
      requestId,
      scopeKey: 'afl-men:2026-trades',
      trigger: 'ad_hoc' as const,
      scheduledFor: now.toISOString(),
      authorityKey: 'restart-proof',
    };
    const operation = createAflTradePrivateValuationModelOperation({
      scopeKey: 'afl-men:2026-trades',
      factualValuesSha256: digest('exact-loader-members'),
      hpnValuesSha256: '7346d98d175cac145dd32bf9a6040ad0c952191219760793bb6d1db36e09de5a',
      hpnMethodId: hpnCalculation.content.methodId,
      ...modelPairTargets,
    });
    const artifactRepository = createLocalAflTradePrivateDerivedArtifactRepository({
      rootDirectory: artifactRootDirectory,
      repositoryId: 'issue-577-private-prepared-v3-integration',
      maximumObjectBytes: 16 * 1024 * 1024,
    });
    const retainPhysical = async (document: unknown, createdAt: string) => {
      const retained = canonicalArtifact(document, createdAt);
      await artifactRepository.putIfAbsent(retained.reference, retained.bytes);
      return retained.reference;
    };
    const playerExecutionTimes = [
      '2026-08-10T00:03:01.000Z',
      '2026-08-10T00:03:02.000Z',
      '2026-08-10T00:03:03.000Z',
    ];
    const playerRunAuthorizationContent = {
      schemaVersion: 'afl-trade-model-run-authorization/v1' as const,
      authorityBoundary:
        'model_run_start_authority_no_grade_publication_or_fantasy_ownership' as const,
      publicationEligible: false as const,
      environment: 'non_production' as const,
      runIntentId: admittedPlayer.intent.intentId,
      datasetId: admittedPlayer.datasetCandidate.datasetId,
      datasetAdmissionId: admittedPlayer.admission.admissionId,
      datasetRowSetSha256: admittedPlayer.datasetCandidate.content.rowSetSha256,
      modelProtocolId: admittedPlayer.protocol.protocolId,
      observationSetId: admittedPlayer.observationSet.observationSetId,
      operationalAuthorizationReceiptId: admittedPlayer.operationalAuthorization.receiptId,
      gate2DecisionId: addressed('gate-decision', 'genuine-player-gate-2'),
      gateLedgerRevision: admittedPlayer.evidence.gateLedgerRevision,
      authorizedAt: '2026-08-10T00:03:00.000Z',
      validThrough: '2026-08-10T00:03:30.000Z',
      modelTrainingEvaluationReceiptIds:
        admittedPlayer.intent.content.modelTrainingEvaluationReceiptIds,
    };
    const playerRunAuthorization = aflTradeModelRunAuthorizationSchema.parse({
      authorizationId: createAflTradeContentAddress(
        'model-run-authorization',
        playerRunAuthorizationContent
      ),
      content: playerRunAuthorizationContent,
    });
    const playerExecution = await createAflTradeAdmittedPlayerContributionExecutor({
      artifactRepository,
      maximumArtifactBytes: 16 * 1024 * 1024,
      now: () => playerExecutionTimes.shift()!,
    }).execute({
      intent: admittedPlayer.intent,
      authorization: playerRunAuthorization,
      protocol: admittedPlayer.protocol,
      observationSet: admittedPlayer.observationSet,
      spellMetrics: admittedPlayer.evidence.spellMetrics,
      executableArtifacts: admittedPlayer.evidence.executableArtifacts,
    });
    if (playerExecution.outcome.status !== 'succeeded') {
      throw new Error('Genuine player fixture did not produce an admitted execution.');
    }
    const playerValidationContent = {
      schemaVersion: 'afl-trade-player-validation-report/v1' as const,
      publicIdentityBoundary: 'source_native_no_fantasy_ownership' as const,
      observationSetId: admittedPlayer.observationSet.observationSetId,
      baselineFitId: addressed('player-baseline-fit', 'accepted-player-baseline'),
      predictionSetId: addressed('player-prediction-set', 'accepted-player-predictions'),
      valueUnitId: 'player-contribution-above-replacement',
      evaluatedPartition: 'final_test' as const,
      candidateModelId: admittedPlayer.intent.content.modelId,
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
    const playerValidation = aflTradePlayerValidationReportSchema.parse({
      validationReportId: createAflTradeContentAddress(
        'player-validation-report',
        playerValidationContent
      ),
      content: playerValidationContent,
    });
    const playerValidationArtifact = await retainPhysical(
      playerValidation,
      '2026-08-10T00:03:02.000Z'
    );
    const playerExecutionOutcome = {
      ...playerExecution.outcome,
      validationReportArtifact: playerValidationArtifact,
    };
    const playerNativeContent = {
      ...admittedPlayerRunContent(admittedPlayer.protocol),
      environment: 'non_production' as const,
      modelId: admittedPlayer.intent.content.modelId,
      modelVersion: admittedPlayer.intent.content.modelVersion,
      datasetId: admittedPlayer.datasetCandidate.datasetId,
      datasetAdmissionId: admittedPlayer.admission.admissionId,
      modelProtocolId: admittedPlayer.protocol.protocolId,
      runIntentId: admittedPlayer.intent.intentId,
      runAuthorizationId: addressed('model-run-authorization', 'authorization'),
      observationSetId: admittedPlayer.observationSet.observationSetId,
      candidateLockedAt: playerExecution.candidateLockedAt,
      finalTestEvaluatedAt: playerExecution.finalTestEvaluatedAt,
      finishedAt: playerExecution.finishedAt,
      outcome: playerExecutionOutcome,
    };
    const playerNativeRun = aflTradeModelRunManifestV3Schema.parse({
      runId: createAflTradeContentAddress('model-run', playerNativeContent),
      content: playerNativeContent,
    });
    const playerNativeArtifact = await retainPhysical(
      playerNativeRun,
      playerNativeRun.content.finishedAt
    );
    const playerProtocolArtifact = await retainPhysical(
      admittedPlayer.protocol,
      admittedPlayer.protocol.content.preparedAt
    );
    const playerDatasetArtifact = await retainPhysical(
      admittedPlayer.datasetCandidate,
      admittedPlayer.datasetCandidate.content.createdAt
    );
    const playerAdmissionArtifact = await retainPhysical(
      admittedPlayer.admission,
      admittedPlayer.admission.content.admittedAt
    );
    const playerComponent = createGovernedValuationComponentRunManifest({
      environment: 'non_production',
      role: 'player_contribution_and_availability',
      nativeExecution: {
        kind: 'admitted_player_model_run',
        executionId: playerNativeRun.runId,
        artifact: playerNativeArtifact,
      },
      protocolId: admittedPlayer.protocol.protocolId,
      protocolArtifact: playerProtocolArtifact,
      datasetId: admittedPlayer.datasetCandidate.datasetId,
      datasetArtifact: playerDatasetArtifact,
      datasetAdmissionId: admittedPlayer.admission.admissionId,
      datasetAdmissionArtifact: playerAdmissionArtifact,
      datasetAdmissionGateLedgerRevision: admittedPlayer.evidence.gateLedgerRevision,
      registeredAt: playerNativeRun.content.finishedAt,
    });
    const pickNativeRun = governedPick.execution;
    const pickNativeArtifact = await retainPhysical(
      pickNativeRun,
      pickNativeRun.content.completedAt
    );
    for (const [document, reference] of [
      [governedPick.authorityDocuments[0], pickNativeRun.content.datasetArtifact],
      [governedPick.authorityDocuments[1], pickNativeRun.content.datasetAdmissionArtifact],
      [governedPick.authorityDocuments[2], pickNativeRun.content.protocolArtifact],
    ] as const) {
      await artifactRepository.putIfAbsent(
        reference,
        new TextEncoder().encode(canonicalizeAflTradeJson(document))
      );
    }
    const pickComponent = createGovernedValuationComponentRunManifest({
      environment: 'non_production',
      role: 'draft_pick_and_future_pick_distribution',
      nativeExecution: {
        kind: 'governed_pick_pav_model_execution',
        executionId: pickNativeRun.executionId,
        artifact: pickNativeArtifact,
      },
      protocolId: pickNativeRun.content.protocolId,
      protocolArtifact: pickNativeRun.content.protocolArtifact,
      datasetId: pickNativeRun.content.datasetId,
      datasetArtifact: pickNativeRun.content.datasetArtifact,
      datasetAdmissionId: pickNativeRun.content.datasetAdmissionId,
      datasetAdmissionArtifact: pickNativeRun.content.datasetAdmissionArtifact,
      datasetAdmissionGateLedgerRevision: pickNativeRun.content.datasetAdmissionGateLedgerRevision,
      registeredAt: pickNativeRun.content.completedAt,
    });
    const playerRunId = playerComponent.runId;
    const pickRunId = pickComponent.runId;
    const playerNativeRunId = playerNativeRun.runId;
    const pickNativeExecutionId = pickNativeRun.executionId;
    const pickValidation = pickNativeRun.content.validationReport;
    const qualificationEvaluatedAt = '2026-08-24T00:00:01.000Z';
    const qualificationPolicyArtifact = await retainPhysical(
      qualificationPolicy,
      qualificationEvaluatedAt
    );
    const playerCriteriaArtifact = await retainPhysical(
      qualificationPolicy.player,
      qualificationEvaluatedAt
    );
    const pickCriteriaArtifact = await retainPhysical(
      qualificationPolicy.pick,
      qualificationEvaluatedAt
    );
    const playerValidationEvidence =
      deriveGovernedPlayerModelQualificationEvidence(playerValidation);
    const pickValidationEvidence = deriveGovernedPickModelQualificationEvidence(pickValidation);
    const playerValidationEvidenceArtifact = await retainPhysical(
      playerValidationEvidence,
      qualificationEvaluatedAt
    );
    const pickValidationEvidenceArtifact = await retainPhysical(
      pickValidationEvidence,
      qualificationEvaluatedAt
    );
    const playerComponentArtifact = await retainPhysical(
      playerComponent,
      playerComponent.content.registeredAt
    );
    const pickComponentArtifact = await retainPhysical(
      pickComponent,
      pickComponent.content.registeredAt
    );
    const qualification = createGovernedValuationModelQualification({
      environment: 'non_production',
      scopeKey: operation.content.scopeKey,
      evaluatedAt: qualificationEvaluatedAt,
      policy: qualificationPolicy,
      policyArtifact: qualificationPolicyArtifact,
      components: {
        player: {
          role: 'player_contribution_and_availability',
          runId: playerRunId,
          runArtifact: playerComponentArtifact,
          protocolId: playerComponent.content.protocolId,
          protocolArtifact: playerComponent.content.protocolArtifact,
          criteriaArtifact: playerCriteriaArtifact,
          validationEvidence: playerValidationEvidence,
          validationEvidenceArtifact: playerValidationEvidenceArtifact,
        },
        pick: {
          role: 'draft_pick_and_future_pick_distribution',
          runId: pickRunId,
          runArtifact: pickComponentArtifact,
          protocolId: pickComponent.content.protocolId,
          protocolArtifact: pickComponent.content.protocolArtifact,
          criteriaArtifact: pickCriteriaArtifact,
          validationEvidence: pickValidationEvidence,
          validationEvidenceArtifact: pickValidationEvidenceArtifact,
        },
      },
    });
    if (qualification.content.outcome !== 'qualified') {
      throw new Error(
        `Genuine component evidence did not qualify the model pair: ${qualification.content.failureCodes.join(', ')}.`
      );
    }
    const qualificationArtifact = await retainPhysical(qualification, qualificationEvaluatedAt);
    const gateRecords = createGovernedValuationModelQualificationGateRecords({
      qualification,
      qualificationArtifact,
      decidedAt: qualificationEvaluatedAt,
      automationPrincipal: 'statly-model-qualification-agent',
      accountableOwner: 'statly-model-owner',
      versions: { player: 1, pick: 1 },
      supersedes: { player: null, pick: null },
    });
    for (const { decision } of gateRecords) {
      await retainPhysical(decision, decision.content.decidedAt!);
    }
    const qualificationId = qualification.qualificationId;
    const exactInput: AflTradePrivateValuationModelPairExactInput = {
      requestId,
      scopeKey: operation.content.scopeKey,
      factualOutputId,
      hpnCalculationId,
      substantive: {
        factualValuesSha256: operation.content.factualValuesSha256,
        hpnValuesSha256: operation.content.hpnValuesSha256,
        hpnMethodId: operation.content.hpnMethodId,
        player: operation.content.player,
        pick: operation.content.pick,
        qualificationPolicyId: operation.content.qualificationPolicyId,
      },
    };

    const seed = await adminPool.connect();
    try {
      await seed.query('BEGIN');
      await seed.query(`SET LOCAL search_path TO "${schemaName}"`);
      await seed.query('SET LOCAL session_replication_role = replica');
      await seed.query(
        `INSERT INTO outcome_private_valuation_dispatch_request
         (request_id,scope_key,trigger_kind,scheduled_for,authority_key,status,available_at,
           claim_id,lease_token_sha256,lease_expires_at,claimed_at,request_json,claim_sequence)
         VALUES ($1,$2,'ad_hoc',$3,'restart-proof','claimed',$3,$4,$5,$6,$3,$7::jsonb,1)`,
        [
          requestId,
          operation.content.scopeKey,
          now,
          claimId,
          digest(leaseToken),
          new Date(now.getTime() + 300_000),
          JSON.stringify(retainedDispatchRequest),
        ]
      );
      await seed.query(
        `INSERT INTO outcome_private_valuation_dispatch_attempt
          (claim_id,request_id,attempt_sequence,attempt_number,worker_id,lease_token_sha256,
           claimed_at,lease_expires_at,heartbeat_at)
         VALUES ($1,$2,1,1,'system:weekly-valuation-coordinator',$3,$4,$5,$4)`,
        [claimId, requestId, digest(leaseToken), now, new Date(now.getTime() + 300_000)]
      );
      await seed.query(
        `INSERT INTO outcome_hpn_pav_method
          (method_id,method_sha256,environment,source_artifact_id,captured_at,registered_at,
           method_canonical_json,method_json)
         VALUES ($1,$2,'non_production',$3,$4,$4,'{}','{}'::jsonb)
         ON CONFLICT (method_id) DO NOTHING`,
        [
          operation.content.hpnMethodId,
          operation.content.hpnMethodId.split(':')[1],
          addressed('artifact', 'hpn-method'),
          now,
        ]
      );
      await seed.query(
        `INSERT INTO outcome_private_valuation_factual_output
          (output_id,request_id,capture_binding_id,source_admission_id,normalization_run_id,fact_batch_id,
           factual_run_id,candidate_id,factual_release_id,prepared_at,output_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
        [
          factualOutputId,
          requestId,
          factualOutput.content.captureBindingId,
          factualOutput.content.sourceAdmissionId,
          factualOutput.content.normalizationRunId,
          factualOutput.content.factBatch.batchId,
          factualRunId,
          factualOutput.content.candidate.candidateId,
          factualOutput.content.factualRelease.releaseId,
          now,
          canonicalizeAflTradeJson(factualOutput),
        ]
      );
      await seed.query(
        `INSERT INTO outcome_hpn_pav_calculation
          (calculation_id,calculation_sha256,schema_version,input_set_id,method_id,
           environment,competition,season_year,effective_through,calculated_at,value_unit,
           status,team_count,player_count,calculation_canonical_json,calculation_json,finalized_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'finalized',$12,$13,$14,$15::jsonb,$10)`,
        [
          hpnCalculationId,
          hpnCalculationId.slice('hpn-pav-season:'.length),
          hpnCalculation.content.schemaVersion,
          hpnCalculation.content.inputSetId,
          hpnCalculation.content.methodId,
          hpnCalculation.content.environment,
          hpnCalculation.content.competition,
          hpnCalculation.content.seasonYear,
          hpnCalculation.content.effectiveThrough,
          hpnCalculation.content.calculatedAt,
          hpnCalculation.content.valueUnit,
          hpnCalculation.content.teams.length,
          hpnCalculation.content.players.length,
          canonicalizeAflTradeJson(hpnCalculation.content),
          canonicalizeAflTradeJson(hpnCalculation),
        ]
      );
      await seed.query(
        `INSERT INTO outcome_valuation_model_run_intent
          (intent_id,environment,dataset_id,admission_id,protocol_id,observation_set_id,
           started_at,intent_canonical_json,intent_json)
         VALUES ($1,'non_production',$2,$3,$4,$5,$6,'{}',$7::jsonb)`,
        [
          playerIntentId,
          operation.content.player.datasetId,
          operation.content.player.datasetAdmissionId,
          operation.content.player.protocolId,
          addressed('player-observation-set', 'observation'),
          now,
          JSON.stringify({
            content: {
              modelId: operation.content.player.modelId,
              modelVersion: operation.content.player.modelVersion,
            },
          }),
        ]
      );
      const policyContent = {
        authorityBoundary: 'policy_owned_local_private_valuation_for_one_exact_model_run_intent',
        dispatchRequestId: requestId,
        substantiveOperationId: operation.operationId,
        dispatchClaimId: claimId,
        dispatchAttemptNumber: 1,
        dispatchLeaseTokenSha256: digest(leaseToken),
        factualOutputId,
        hpnCalculationId,
        factualValuesSha256: operation.content.factualValuesSha256,
        hpnValuesSha256: operation.content.hpnValuesSha256,
      };
      await seed.query(
        `INSERT INTO outcome_valuation_model_run_operational_authorization
          (receipt_id,intent_id,environment,dataset_id,admission_id,protocol_id,
           observation_set_id,authorized_at,valid_through,principal_ref,authority_evidence_id,
           receipt_canonical_json,receipt_json)
         VALUES ($1,$2,'non_production',$3,$4,$5,$6,$7,$8,
           'system:weekly-valuation-coordinator',NULL,'{}',$9::jsonb)`,
        [
          operationalReceiptId,
          playerIntentId,
          operation.content.player.datasetId,
          operation.content.player.datasetAdmissionId,
          operation.content.player.protocolId,
          addressed('player-observation-set', 'observation'),
          now,
          new Date(now.getTime() + 20_000),
          JSON.stringify({ content: policyContent }),
        ]
      );
      await seed.query(
        `INSERT INTO outcome_valuation_model_run_authorization
          (authorization_id,intent_id,operational_authorization_receipt_id,
           gate_ledger_revision,authorized_at,valid_through,consumed_at,
           authorization_canonical_json,authorization_json)
         VALUES ($1,$2,$3,0,$4,$5,$4,'{}','{}'::jsonb)`,
        [
          playerAuthorizationId,
          playerIntentId,
          operationalReceiptId,
          now,
          new Date(now.getTime() + 20_000),
        ]
      );
      await seed.query(
        `INSERT INTO outcome_valuation_model_run
          (run_id,intent_id,authorization_id,status,started_at,finished_at,run_canonical_json,run_json)
         VALUES ($1,$2,$3,'succeeded',$4,$4,'{}','{}'::jsonb)`,
        [playerNativeRunId, playerIntentId, playerAuthorizationId, now]
      );
      await seed.query(
        `INSERT INTO outcome_governed_pick_pav_model_execution
          (execution_id,observation_set_id,dataset_id,dataset_artifact_id,
           dataset_admission_id,dataset_admission_artifact_id,
           dataset_admission_gate_ledger_revision,protocol_id,protocol_artifact_id,
           execution_artifact_id,final_test_evaluation_started_at,completed_at,
           content_sha256,content_canonical_json,execution_json)
         VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8,$9,$10,$10,$11,'{}',$12::jsonb)`,
        [
          pickNativeExecutionId,
          addressed('pick-pav-observation-set', 'pick-observation'),
          operation.content.pick.datasetId,
          addressed('artifact', 'pick-dataset-artifact'),
          operation.content.pick.datasetAdmissionId,
          addressed('artifact', 'pick-admission-artifact'),
          operation.content.pick.protocolId,
          addressed('artifact', 'pick-protocol-artifact'),
          addressed('artifact', 'pick-execution-artifact'),
          now,
          digest('pick-execution'),
          JSON.stringify({
            content: {
              schemaVersion: 'afl-trade-pick-pav-model-execution/v4',
              policyId: operation.content.pick.policyId,
              privateInput: {
                requestId,
                operationId: operation.operationId,
                claimId,
                attemptNumber: 1,
                leaseTokenSha256: digest(leaseToken),
                factualOutputId,
                hpnCalculationId,
                factualValuesSha256: operation.content.factualValuesSha256,
                hpnValuesSha256: operation.content.hpnValuesSha256,
              },
            },
          }),
        ]
      );
      for (const component of [
        {
          runId: playerRunId,
          role: 'player_contribution_and_availability',
          kind: 'admitted_player_model_run',
          nativeId: playerNativeRunId,
          target: operation.content.player,
        },
        {
          runId: pickRunId,
          role: 'draft_pick_and_future_pick_distribution',
          kind: 'governed_pick_pav_model_execution',
          nativeId: pickNativeExecutionId,
          target: operation.content.pick,
        },
      ] as const) {
        await seed.query(
          `INSERT INTO outcome_governed_valuation_component_run
            (run_id,role,native_execution_kind,native_execution_id,artifact_id,
             native_execution_artifact_id,protocol_id,protocol_artifact_id,dataset_id,
             dataset_artifact_id,dataset_admission_id,dataset_admission_artifact_id,
             dataset_admission_gate_ledger_revision,registered_at,content_sha256,
             content_canonical_json,manifest_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,$13,$14,'{}','{}'::jsonb)`,
          [
            component.runId,
            component.role,
            component.kind,
            component.nativeId,
            addressed('artifact', `${component.role}-manifest`),
            addressed('artifact', `${component.role}-native`),
            component.target.protocolId,
            addressed('artifact', `${component.role}-protocol`),
            component.target.datasetId,
            addressed('artifact', `${component.role}-dataset`),
            component.target.datasetAdmissionId,
            addressed('artifact', `${component.role}-admission`),
            now,
            digest(`${component.role}-content`),
          ]
        );
      }
      await seed.query(
        `INSERT INTO outcome_governed_valuation_model_qualification
          (qualification_id,scope_key,outcome,artifact_id,player_run_id,pick_run_id,
           policy_artifact_id,player_criteria_artifact_id,pick_criteria_artifact_id,
           player_evidence_artifact_id,pick_evidence_artifact_id,evaluated_at,
           content_sha256,content_canonical_json,qualification_json)
         VALUES ($1,$2,'qualified',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'{}',$13::jsonb)`,
        [
          qualificationId,
          operation.content.scopeKey,
          addressed('artifact', 'qualification'),
          playerRunId,
          pickRunId,
          addressed('artifact', 'policy'),
          addressed('artifact', 'player-criteria'),
          addressed('artifact', 'pick-criteria'),
          addressed('artifact', 'player-evidence'),
          addressed('artifact', 'pick-evidence'),
          now,
          digest('qualification-content'),
          JSON.stringify({
            content: { policy: { policyVersion: operation.content.qualificationPolicyId } },
          }),
        ]
      );
      await seed.query('COMMIT');
    } catch (error) {
      await seed.query('ROLLBACK');
      throw error;
    } finally {
      seed.release();
    }

    const client = createPgAflOutcomeSqlClient(outcomesPool);
    const claim = { claimId, leaseToken };
    let genuinePlayerAdapterCalls = 0;
    let genuinePickAdapterCalls = 0;
    const genuinePlayerExecutor = createAflTradeDispatchBoundAdmittedPlayerExecutor({
      loadRetainedComponent: async (execution) => {
        genuinePlayerAdapterCalls += 1;
        expect(execution.exactInput).toEqual(exactInput);
        expect(execution.operation.operationId).toBe(operation.operationId);
        return { runId: playerRunId };
      },
      admittedRunner: { run: async () => Promise.reject(new Error('must replay player')) },
      authorityPreparation: {
        prepare: async () => Promise.reject(new Error('must replay player')),
      },
      prepareRun: async () => Promise.reject(new Error('must replay player')),
      registerComponent: async () => Promise.reject(new Error('must replay player')),
    });
    const genuinePickExecutor = createAflTradeGenuineDispatchBoundGovernedPickExecutor({
      loadRetainedComponent: async (execution) => {
        genuinePickAdapterCalls += 1;
        expect(execution.exactInput).toEqual(exactInput);
        expect(execution.operation.operationId).toBe(operation.operationId);
        return { runId: pickRunId };
      },
      loadExactAuthority: async () => Promise.reject(new Error('must replay pick')),
      assertClaim: async () => Promise.reject(new Error('must replay pick')),
      retainArtifact: async () => Promise.reject(new Error('must replay pick')),
      executionRepository: {
        register: async () => Promise.reject(new Error('must replay pick')),
      },
      componentRepository: {
        register: async () => Promise.reject(new Error('must replay pick')),
      },
    });
    const coordinator = (crashAfter: 'player' | 'pick' | 'pair' | 'qualification' | null) => {
      const retained = new PostgresAflTradePrivateValuationModelPairRepository(client);
      const repository: AflTradePrivateValuationModelPairRepository = {
        bindInput: (input) => retained.bindInput(input),
        async acceptComponent(input) {
          const state = await retained.acceptComponent(input);
          if (crashAfter === input.role) throw new Error(`simulated restart after ${input.role}`);
          return state;
        },
        async acceptPair(input) {
          const state = await retained.acceptPair(input);
          if (crashAfter === 'pair') throw new Error('simulated restart after pair');
          return state;
        },
        async bindQualification(input) {
          const state = await retained.bindQualification(input);
          if (crashAfter === 'qualification') {
            throw new Error('simulated restart after qualification');
          }
          return state;
        },
      };
      return createAflTradePrivateValuationModelPairCoordinator({
        prepareExactInput: async () => exactInput,
        repository,
        executePlayer: (execution) => genuinePlayerExecutor.execute(execution),
        executePick: (execution) => genuinePickExecutor.execute(execution),
        qualify: async () => ({ qualificationId, outcome: 'qualified' }),
      });
    };

    const mutateFixture = async (sql: string, parameters: readonly unknown[]) => {
      const connection = await adminPool.connect();
      try {
        await connection.query('BEGIN');
        await connection.query(`SET LOCAL search_path TO "${schemaName}"`);
        await connection.query('SET LOCAL session_replication_role = replica');
        await connection.query(sql, parameters);
        await connection.query('COMMIT');
      } catch (error) {
        await connection.query('ROLLBACK');
        throw error;
      } finally {
        connection.release();
      }
    };

    const concurrentRepositories = [
      new PostgresAflTradePrivateValuationModelPairRepository(
        createPgAflOutcomeSqlClient(outcomesPool)
      ),
      new PostgresAflTradePrivateValuationModelPairRepository(
        createPgAflOutcomeSqlClient(outcomesPool)
      ),
    ] as const;
    const concurrentBindings = await Promise.all(
      concurrentRepositories.map((repository) => repository.bindInput({ exactInput, claim }))
    );
    expect(concurrentBindings).toMatchObject([
      { operation: { operationId: operation.operationId }, attemptNumber: 1 },
      { operation: { operationId: operation.operationId }, attemptNumber: 1 },
    ]);
    await expect(
      outcomesPool.query(
        `SELECT
           (SELECT count(*)::int FROM outcome_private_valuation_model_operation
             WHERE operation_id=$1) AS operation_count,
           (SELECT count(*)::int FROM outcome_private_valuation_model_request_binding
             WHERE request_id=$2 AND operation_id=$1 AND attempt_number=1) AS binding_count`,
        [operation.operationId, requestId]
      )
    ).resolves.toMatchObject({
      rows: [{ operation_count: 1, binding_count: 1 }],
    });

    await mutateFixture(
      `UPDATE outcome_private_valuation_dispatch_attempt
          SET claimed_at=$2,heartbeat_at=$2,lease_expires_at=$3
        WHERE claim_id=$1`,
      [claimId, new Date(now.getTime() - 10_000), new Date(now.getTime() - 1_000)]
    );
    await expect(
      client.query(`SELECT load_outcome_private_valuation_dispatch_request_for_claim($1,$2,$3)`, [
        requestId,
        claimId,
        digest(leaseToken),
      ])
    ).rejects.toThrow('lost its live claim fence');
    await expect(
      client.query(
        `INSERT INTO outcome_governed_pick_pav_model_execution
          SELECT $2,observation_set_id,dataset_id,dataset_artifact_id,
                 dataset_admission_id,dataset_admission_artifact_id,
                 dataset_admission_gate_ledger_revision,protocol_id,protocol_artifact_id,
                 execution_artifact_id,final_test_evaluation_started_at,completed_at,
                 content_sha256,content_canonical_json,execution_json
            FROM outcome_governed_pick_pav_model_execution WHERE execution_id=$1`,
        [pickNativeExecutionId, addressed('pick-pav-model-execution', 'stale-native')]
      )
    ).rejects.toThrow('lost its live claim fence');
    await expect(
      client.query(
        `INSERT INTO outcome_governed_valuation_component_run
          SELECT $2,role,native_execution_kind,native_execution_id,artifact_id,
                 native_execution_artifact_id,protocol_id,protocol_artifact_id,dataset_id,
                 dataset_artifact_id,dataset_admission_id,dataset_admission_artifact_id,
                 dataset_admission_gate_ledger_revision,registered_at,content_sha256,
                 content_canonical_json,manifest_json
            FROM outcome_governed_valuation_component_run WHERE run_id=$1`,
        [pickRunId, addressed('model-run', 'stale-pick-component')]
      )
    ).rejects.toThrow('lost its live claim fence');
    await expect(
      client.query(
        `INSERT INTO outcome_governed_valuation_component_run
          SELECT $2,role,native_execution_kind,native_execution_id,artifact_id,
                 native_execution_artifact_id,protocol_id,protocol_artifact_id,dataset_id,
                 dataset_artifact_id,dataset_admission_id,dataset_admission_artifact_id,
                 dataset_admission_gate_ledger_revision,registered_at,content_sha256,
                 content_canonical_json,manifest_json
            FROM outcome_governed_valuation_component_run WHERE run_id=$1`,
        [playerRunId, addressed('model-run', 'stale-player-component')]
      )
    ).rejects.toThrow('lost its live claim fence');
    await mutateFixture(
      `UPDATE outcome_private_valuation_dispatch_attempt
          SET claimed_at=$2,heartbeat_at=$2,lease_expires_at=$3
        WHERE claim_id=$1`,
      [claimId, now, new Date(now.getTime() + 300_000)]
    );

    await mutateFixture(
      `UPDATE outcome_valuation_model_run_operational_authorization
          SET receipt_json=jsonb_set(receipt_json,'{content,factualOutputId}',to_jsonb($2::text))
        WHERE receipt_id=$1`,
      [operationalReceiptId, addressed('private-valuation-factual-output', 'wrong-factual')]
    );
    await expect(coordinator(null).prepare({ requestId, claim })).rejects.toThrow('wrong ancestry');
    await mutateFixture(
      `UPDATE outcome_valuation_model_run_operational_authorization
          SET receipt_json=jsonb_set(receipt_json,'{content,factualOutputId}',to_jsonb($2::text))
        WHERE receipt_id=$1`,
      [operationalReceiptId, factualOutputId]
    );

    await expect(coordinator('player').prepare({ requestId, claim })).rejects.toThrow(
      'simulated restart after player'
    );
    await mutateFixture(
      `UPDATE outcome_governed_pick_pav_model_execution
          SET execution_json=jsonb_set(
            execution_json,'{content,privateInput,hpnCalculationId}',to_jsonb($2::text))
        WHERE execution_id=$1`,
      [pickNativeExecutionId, addressed('hpn-pav-season', 'wrong-calculation')]
    );
    await expect(coordinator(null).prepare({ requestId, claim })).rejects.toThrow('wrong ancestry');
    await mutateFixture(
      `UPDATE outcome_governed_pick_pav_model_execution
          SET execution_json=jsonb_set(
            execution_json,'{content,privateInput,hpnCalculationId}',to_jsonb($2::text))
        WHERE execution_id=$1`,
      [pickNativeExecutionId, hpnCalculationId]
    );
    await expect(coordinator('pick').prepare({ requestId, claim })).rejects.toThrow(
      'simulated restart after pick'
    );
    await expect(coordinator('pair').prepare({ requestId, claim })).rejects.toThrow(
      'simulated restart after pair'
    );
    await mutateFixture(
      `UPDATE outcome_governed_valuation_model_qualification
          SET qualification_json=jsonb_set(
            qualification_json,'{content,policy,policyVersion}',to_jsonb($2::text))
        WHERE qualification_id=$1`,
      [qualificationId, addressed('model-qualification-policy', 'wrong-policy')]
    );
    await expect(coordinator(null).prepare({ requestId, claim })).rejects.toThrow(
      'wrong accepted pair'
    );
    await mutateFixture(
      `UPDATE outcome_governed_valuation_model_qualification
          SET qualification_json=jsonb_set(
            qualification_json,'{content,policy,policyVersion}',to_jsonb($2::text))
        WHERE qualification_id=$1`,
      [qualificationId, operation.content.qualificationPolicyId]
    );
    await expect(coordinator('qualification').prepare({ requestId, claim })).rejects.toThrow(
      'simulated restart after qualification'
    );

    const replay = await coordinator(null).prepare({ requestId, claim });
    expect(replay).toMatchObject({
      state: 'already_qualified',
      operationId: operation.operationId,
      qualificationId,
    });
    expect(genuinePlayerAdapterCalls).toBe(2);
    expect(genuinePickAdapterCalls).toBe(2);

    const capturedAt = '2026-08-24T00:00:02.000Z';
    const privateCaptureId = addressed('source-capture', 'composed-current-capture');
    const privateNormalizationRunId = factualOutput.content.normalizationRunId;
    const privateFieldMapId = addressed('provider-field-map', 'composed-current-field-map');
    const privateFactualCustody = {
      schemaVersion: 'afl-private-factual-normalized-reconciled-custody/v1',
      sourceCaptures: [{ captureId: privateCaptureId }],
      normalizationRuns: [
        {
          normalizationRunId: privateNormalizationRunId,
          captureId: privateCaptureId,
          fieldMapId: privateFieldMapId,
          decoderVersion: 'decoder-v1',
          normalizerVersion: 'normalizer-v1',
          sourceRdsSha256: digest('composed-current-source-rds'),
          decodedSha256: digest('composed-current-decoded'),
          receiptSha256: digest('composed-current-receipt'),
          stagingSha256: digest('composed-current-staging'),
          status: 'staged',
          sourceRowCount: 1,
          acceptedRowCount: 1,
          quarantinedRowCount: 0,
          issueCount: 0,
          identityCandidateCount: 1,
          matchCandidateCount: 1,
          metricCandidateCount: 1,
          achievementCandidateCount: 0,
          completedAt: capturedAt,
          finalizedAt: capturedAt,
        },
      ],
      reviewSets: [{ reviewSetId: digest('composed-current-review-set') }],
      sourceRightsEvidenceRefs: [{ artifactId: addressed('artifact', 'composed-current-rights') }],
    } as const;
    const privateAuthority = {
      valuationScopeKey: operation.content.scopeKey,
      candidateId: addressed('private-factual-candidate', 'composed-current-candidate'),
      evidenceScopeKey: 'reviewed-five-season-and-current-evidence',
      evidenceBundleId: addressed('private-reviewed-evidence-bundle', 'composed-current-bundle'),
      reviewDecisionId: addressed(
        'private-reviewed-evidence-evaluation-decision',
        'composed-current-review'
      ),
      normalizedReconciledCustodySha256: digest(canonicalizeAflTradeJson(privateFactualCustody)),
      revision: 1,
    } as const;
    const factualRefreshOperationId = addressed(
      'current-valuation-factual-refresh-operation',
      'composed-current-factual-refresh'
    );
    const factualStableOperationKey = 'composed-current-factual-stable-key';
    const dispatchRequest = retainedDispatchRequest;
    const factualRefresh = {
      schemaVersion: 'afl-current-valuation-refresh-result-v2',
      operationId: factualRefreshOperationId,
      scopeKey: operation.content.scopeKey,
      trigger: dispatchRequest.trigger,
      stableOperationKey: factualStableOperationKey,
      state: 'factual_refresh_complete',
      factualStage: 'advanced',
      privateFactualAuthority: privateAuthority,
      capturedAt,
      completedAt: capturedAt,
      executionLocation: 'local',
      visibility: 'private',
      environment: 'non_production',
      publicationEligible: false,
      publicationProhibited: true,
      limitation: AFL_TRADE_CURRENT_VALUATION_FACTUAL_REFRESH_LIMITATION,
    } as const;
    const orchestrationOperationId = addressed(
      'current-valuation-evidence-orchestration-operation',
      'composed-current-orchestration'
    );
    const orchestrationResult = {
      schemaVersion: 'afl-current-valuation-evidence-orchestration-result-v1',
      operationId: orchestrationOperationId,
      scopeKey: operation.content.scopeKey,
      trigger: dispatchRequest.trigger,
      stableOperationKey: requestId,
      state: 'complete',
      stage: 'private_factual_authority',
      currentValuationRefresh: factualRefresh,
      capturedAt,
      completedAt: capturedAt,
      executionLocation: 'local',
      visibility: 'private',
      environment: 'non_production',
      publicationEligible: false,
      publicationProhibited: true,
      limitation: AFL_TRADE_CURRENT_VALUATION_EVIDENCE_ORCHESTRATION_LIMITATION,
    } as const;
    await mutateFixture(
      `INSERT INTO outcome_provider_normalization_run
        (normalization_run_id,capture_id,field_map_id,decoder_version,normalizer_version,
         source_rds_sha256,decoded_sha256,receipt_sha256,staging_sha256,status,
         source_row_count,accepted_row_count,quarantined_row_count,issue_count,
         identity_candidate_count,match_candidate_count,metric_candidate_count,
         achievement_candidate_count,started_at,completed_at,finalized_at,receipt_json)
       VALUES ($1,$2,$3,'decoder-v1','normalizer-v1',$4,$5,$6,$7,'staged',
         1,1,0,0,1,1,1,0,$8,$8,$8,'{}'::jsonb)`,
      [
        privateNormalizationRunId,
        privateCaptureId,
        privateFieldMapId,
        digest('composed-current-source-rds'),
        digest('composed-current-decoded'),
        digest('composed-current-receipt'),
        digest('composed-current-staging'),
        capturedAt,
      ]
    );
    await mutateFixture(
      `INSERT INTO outcome_private_factual_candidate
        (candidate_id,valuation_scope_key,evidence_scope_key,evidence_bundle_id,
         review_decision_id,normalized_reconciled_custody_sha256,candidate_json,composed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
      [
        privateAuthority.candidateId,
        privateAuthority.valuationScopeKey,
        privateAuthority.evidenceScopeKey,
        privateAuthority.evidenceBundleId,
        privateAuthority.reviewDecisionId,
        privateAuthority.normalizedReconciledCustodySha256,
        JSON.stringify({
          content: {
            reviewedEvidenceContentSha256: privateAuthority.evidenceBundleId.slice(
              'private-reviewed-evidence-bundle:'.length
            ),
            normalizedReconciledCustody: privateFactualCustody,
          },
        }),
        capturedAt,
      ]
    );
    await mutateFixture(
      `INSERT INTO outcome_private_reviewed_evidence_bundle
        (evidence_bundle_id,evidence_scope_key,candidate_count,decision_count,
         source_capture_count,source_rights_count,created_at,bundle_sha256,
         bundle_content_canonical_json,bundle_json)
       VALUES ($1,$2,1,1,1,1,$3,$4,'{}',$5::jsonb)`,
      [
        privateAuthority.evidenceBundleId,
        privateAuthority.evidenceScopeKey,
        capturedAt,
        privateAuthority.evidenceBundleId.slice('private-reviewed-evidence-bundle:'.length),
        JSON.stringify({
          content: {
            fixtureCurrent: true,
            sourceCaptures: privateFactualCustody.sourceCaptures,
            reviewSets: privateFactualCustody.reviewSets,
            sourceRightsEvidenceRefs: privateFactualCustody.sourceRightsEvidenceRefs,
          },
        }),
      ]
    );
    await mutateFixture(
      `INSERT INTO outcome_private_reviewed_evaluation_decision
        (decision_id,valuation_scope_key,evidence_bundle_id,status,revision,
         reviewer_id,decided_at,decision_sha256,decision_content_canonical_json,
         decision_json)
       VALUES ($1,$2,$3,'authorized',1,'fixture-reviewer',$4,$5,'{}','{}'::jsonb)`,
      [
        privateAuthority.reviewDecisionId,
        privateAuthority.valuationScopeKey,
        privateAuthority.evidenceBundleId,
        capturedAt,
        privateAuthority.reviewDecisionId.slice(
          'private-reviewed-evidence-evaluation-decision:'.length
        ),
      ]
    );
    await mutateFixture(
      `INSERT INTO outcome_private_reviewed_evaluation_head
        (valuation_scope_key,evidence_scope_key,revision,decision_id,
         evidence_bundle_id,status,updated_at)
       VALUES ($1,$2,1,$3,$4,'authorized',$5)`,
      [
        privateAuthority.valuationScopeKey,
        privateAuthority.evidenceScopeKey,
        privateAuthority.reviewDecisionId,
        privateAuthority.evidenceBundleId,
        capturedAt,
      ]
    );
    await mutateFixture(
      `INSERT INTO outcome_current_private_factual_authority
        (valuation_scope_key,candidate_id,revision,advanced_at)
       VALUES ($1,$2,$3,$4)`,
      [
        operation.content.scopeKey,
        privateAuthority.candidateId,
        privateAuthority.revision,
        capturedAt,
      ]
    );
    await mutateFixture(
      `INSERT INTO outcome_current_valuation_factual_refresh_operation
        (operation_id,scope_key,trigger_kind,stable_operation_key,state,factual_stage,
         candidate_id,private_factual_revision,captured_at,completed_at,operation_json,result_json)
       VALUES ($1,$2,$3,$4,'factual_refresh_complete','advanced',$5,$6,$7,$7,'{}'::jsonb,$8::jsonb)`,
      [
        factualRefreshOperationId,
        operation.content.scopeKey,
        dispatchRequest.trigger,
        factualStableOperationKey,
        privateAuthority.candidateId,
        privateAuthority.revision,
        capturedAt,
        JSON.stringify(factualRefresh),
      ]
    );
    await mutateFixture(
      `INSERT INTO outcome_current_valuation_evidence_orchestration_operation
        (operation_id,scope_key,trigger_kind,stable_operation_key,state,stage,
         downstream_operation_id,captured_at,completed_at,operation_json,result_json)
       VALUES ($1,$2,$3,$4,'complete','private_factual_authority',$5,$6,$6,'{}'::jsonb,$7::jsonb)`,
      [
        orchestrationOperationId,
        operation.content.scopeKey,
        dispatchRequest.trigger,
        requestId,
        factualRefreshOperationId,
        capturedAt,
        JSON.stringify(orchestrationResult),
      ]
    );
    for (const component of [
      {
        runId: playerRunId,
        role: 'player_contribution_and_availability',
        observationSetId: addressed('player-observation-set', 'composed-current-player'),
      },
      {
        runId: pickRunId,
        role: 'draft_pick_and_future_pick_distribution',
        observationSetId: addressed('pick-pav-observation-set', 'composed-current-pick'),
      },
    ] as const) {
      await mutateFixture(
        `INSERT INTO outcome_governed_component_validation_evidence
          (run_id,role,native_execution_artifact_id,validation_report_id,
           validation_report_artifact_id,native_execution_json,validation_report_json,recorded_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,'{}'::jsonb,$7)`,
        [
          component.runId,
          component.role,
          addressed('artifact', `${component.role}-current-native`),
          addressed('model-validation-report', `${component.role}-current-report`),
          addressed('artifact', `${component.role}-current-report-artifact`),
          JSON.stringify({ content: { observationSetId: component.observationSetId } }),
          capturedAt,
        ]
      );
    }
    const staging = createPostgresGovernedPrivateEvaluationStagingRepository({
      client,
      artifactRepository,
      maximumArtifactBytes: 16 * 1024 * 1024,
    });
    for (const retained of [
      canonicalArtifact(playerComponent, playerComponent.content.registeredAt),
      canonicalArtifact(pickComponent, pickComponent.content.registeredAt),
      canonicalArtifact(qualificationPolicy, qualificationEvaluatedAt),
      canonicalArtifact(qualificationPolicy.player, qualificationEvaluatedAt),
      canonicalArtifact(qualificationPolicy.pick, qualificationEvaluatedAt),
      canonicalArtifact(playerValidationEvidence, qualificationEvaluatedAt),
      canonicalArtifact(pickValidationEvidence, qualificationEvaluatedAt),
      canonicalArtifact(qualification, qualificationEvaluatedAt),
    ]) {
      await staging.retainArtifact(retained);
    }
    for (const component of [
      { manifest: playerComponent, artifact: playerComponentArtifact },
      { manifest: pickComponent, artifact: pickComponentArtifact },
    ]) {
      const content = component.manifest.content;
      await mutateFixture(
        `UPDATE outcome_governed_valuation_component_run SET
           role=$2,native_execution_kind=$3,native_execution_id=$4,artifact_id=$5,
           native_execution_artifact_id=$6,protocol_id=$7,protocol_artifact_id=$8,
           dataset_id=$9,dataset_artifact_id=$10,dataset_admission_id=$11,
           dataset_admission_artifact_id=$12,dataset_admission_gate_ledger_revision=$13,
           registered_at=$14,content_sha256=$15,content_canonical_json=$16,
           manifest_json=$17::jsonb
         WHERE run_id=$1`,
        [
          component.manifest.runId,
          content.role,
          content.nativeExecution.kind,
          content.nativeExecution.executionId,
          component.artifact.artifactId,
          content.nativeExecution.artifact.artifactId,
          content.protocolId,
          content.protocolArtifact.artifactId,
          content.datasetId,
          content.datasetArtifact.artifactId,
          content.datasetAdmissionId,
          content.datasetAdmissionArtifact.artifactId,
          content.datasetAdmissionGateLedgerRevision,
          content.registeredAt,
          component.manifest.runId.slice('model-run:'.length),
          canonicalizeAflTradeJson(content),
          canonicalizeAflTradeJson(component.manifest),
        ]
      );
    }
    await mutateFixture(
      `UPDATE outcome_governed_valuation_model_qualification SET
         scope_key=$2,outcome=$3,artifact_id=$4,player_run_id=$5,pick_run_id=$6,
         policy_artifact_id=$7,player_criteria_artifact_id=$8,pick_criteria_artifact_id=$9,
         player_evidence_artifact_id=$10,pick_evidence_artifact_id=$11,evaluated_at=$12,
         content_sha256=$13,content_canonical_json=$14,qualification_json=$15::jsonb
       WHERE qualification_id=$1`,
      [
        qualificationId,
        qualification.content.scopeKey,
        qualification.content.outcome,
        qualificationArtifact.artifactId,
        playerRunId,
        pickRunId,
        qualificationPolicyArtifact.artifactId,
        playerCriteriaArtifact.artifactId,
        pickCriteriaArtifact.artifactId,
        playerValidationEvidenceArtifact.artifactId,
        pickValidationEvidenceArtifact.artifactId,
        qualificationEvaluatedAt,
        qualificationId.slice('model-qualification:'.length),
        canonicalizeAflTradeJson(qualification.content),
        canonicalizeAflTradeJson(qualification),
      ]
    );
    await client.transaction((transaction) =>
      appendNewAflTradeGateDecisionsWithinTransaction(transaction, {
        expectedRevision: 0,
        scopeKey: operation.content.scopeKey,
        qualificationId,
        qualificationArtifactId: qualificationArtifact.artifactId,
        playerRunId,
        pickRunId,
        records: gateRecords,
        updatedAt: qualificationEvaluatedAt,
      })
    );
    const playerGate3DecisionId = gateRecords[0].decision.decisionId;
    const pickGate3DecisionId = gateRecords[1].decision.decisionId;
    const playerGate3LockKey = `afl-trade-gate:gate_3_model_validity:non_production:${gateRecords[0].decision.content.decisionKey}`;
    const pickGate3LockKey = `afl-trade-gate:gate_3_model_validity:non_production:${gateRecords[1].decision.content.decisionKey}`;
    const qualificationWorkId = addressed(
      'model-qualification-work',
      'composed-current-qualification'
    );
    await mutateFixture(
      `INSERT INTO outcome_current_governed_valuation_model_pair
        (scope_key,revision,qualification_id,player_run_id,pick_run_id,
         player_gate3_decision_id,pick_gate3_decision_id,work_id,advanced_at)
       VALUES ($1,1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        operation.content.scopeKey,
        qualificationId,
        playerRunId,
        pickRunId,
        playerGate3DecisionId,
        pickGate3DecisionId,
        qualificationWorkId,
        capturedAt,
      ]
    );
    await mutateFixture(
      `INSERT INTO outcome_governed_model_qualification_work
        (work_id,scope_key,qualification_id,player_gate3_decision_id,
         pick_gate3_decision_id,available_at,status,work_json)
       VALUES ($1,$2,$3,$4,$5,$6,'completed','{}'::jsonb)`,
      [
        qualificationWorkId,
        operation.content.scopeKey,
        qualificationId,
        playerGate3DecisionId,
        pickGate3DecisionId,
        capturedAt,
      ]
    );
    const prepared = {
      state: 'prepared' as const,
      requestId,
      factualOutputId,
      inputSetId: hpnCalculation.content.inputSetId,
      calculationId: hpnCalculationId,
      captureBindingIds: [factualOutput.content.captureBindingId],
      sourceAdmissionIds: [factualOutput.content.sourceAdmissionId],
      publicationEligible: false as const,
    };
    const adapterCallsBeforeCurrentReplay = {
      player: genuinePlayerAdapterCalls,
      pick: genuinePickAdapterCalls,
    };
    const currentCoordinator = composePostgresAflTradeCurrentValuationModelEvidenceDispatch({
      client,
      dispatch: { request: dispatchRequest, claim },
      modelPair: {
        hpnPreparation: { prepare: async () => prepared },
        targets: modelPairTargets,
        playerExecutor: genuinePlayerExecutor,
        pickExecutor: genuinePickExecutor,
        qualificationRegistrar: {
          register: async () => Promise.reject(new Error('must replay qualification')),
        },
      },
      clock: { now: () => capturedAt },
    });
    const currentRequest = {
      scopeKey: operation.content.scopeKey,
      factualOperationId: factualRefreshOperationId,
      privateFactualAuthority: privateAuthority,
    };
    const retainedCurrent = await currentCoordinator.refresh(currentRequest);
    await expect(currentCoordinator.refresh(currentRequest)).resolves.toEqual(retainedCurrent);
    expect(retainedCurrent).toMatchObject({
      state: 'qualified',
      qualificationId,
      playerRunId,
      pickRunId,
      qualificationWorkId,
      playerGate3DecisionId,
      pickGate3DecisionId,
    });
    expect(genuinePlayerAdapterCalls).toBe(adapterCallsBeforeCurrentReplay.player);
    expect(genuinePickAdapterCalls).toBe(adapterCallsBeforeCurrentReplay.pick);
    const ignoredFailedEvidenceOperationId = addressed(
      'current-valuation-model-evidence-operation',
      'ignored-failed-evidence-for-private-prepared'
    );
    await mutateFixture(
      `INSERT INTO outcome_current_valuation_model_evidence_operation
        (operation_id,scope_key,factual_operation_id,factual_candidate_id,factual_revision,
         expected_model_revision,result_state,result_json,captured_at,completed_at,recorded_at)
       SELECT $2,scope_key,factual_operation_id,factual_candidate_id,factual_revision,
              expected_model_revision,'qualification_failed',
              jsonb_set(jsonb_set(result_json,'{operationId}',to_jsonb($2::text)),
                '{state}','"qualification_failed"'::jsonb),
              captured_at,completed_at,recorded_at
         FROM outcome_current_valuation_model_evidence_operation WHERE operation_id=$1`,
      [retainedCurrent.operationId, ignoredFailedEvidenceOperationId]
    );

    const releaseTradeId = 'trade:authenticated-three-club';
    const unavailableTradeId = 'trade:unavailable-private-member';
    const canonicalMembers = [
      { recordKind: 'transaction', canonicalRecordId: releaseTradeId },
      { recordKind: 'transaction', canonicalRecordId: unavailableTradeId },
    ];
    const releaseManifest = {
      releaseId: factualOutput.content.factualRelease.releaseId,
      content: { canonicalMembers },
    };
    const releaseCreatedAt = '2026-08-20T07:00:00.000Z';
    await mutateFixture(
      `INSERT INTO outcome_release_manifest
        (release_id,scope_key,environment,created_at,effective_through,
         manifest_json,manifest_canonical_json)
       VALUES ($1,'public-afl-draft-trade-outcomes','non_production',$2,$3,$4::jsonb,$5)`,
      [
        releaseManifest.releaseId,
        releaseCreatedAt,
        '2026-08-20T06:59:59.000Z',
        canonicalizeAflTradeJson(releaseManifest),
        canonicalizeAflTradeJson(releaseManifest),
      ]
    );

    const bundleParents = [
      bundleParent('list-spot-policy'),
      bundleParent('scarcity-policy'),
      bundleParent('role-congestion-policy'),
      bundleParent('low-return-definition'),
      bundleParent('elite-outcome-definition'),
      bundleParent('practical-equivalence-definition'),
      bundleParent('explanation-policy'),
    ] as const;
    const valuationInputBundleContent = {
      schemaVersion: 'afl-trade-valuation-input-bundle/v1' as const,
      publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership' as const,
      environment: 'non_production' as const,
      scopeKey: operation.content.scopeKey,
      valueUnitId: 'contribution-above-replacement-v1',
      createdAt: '2026-08-20T08:30:00.000Z',
      components: [
        {
          role: 'player_contribution_and_availability' as const,
          modelKind: 'player_contribution_and_availability' as const,
          protocolId: operation.content.player.protocolId,
          runId: playerRunId,
          datasetId: operation.content.player.datasetId,
          gate3DecisionId: playerGate3DecisionId,
        },
        {
          role: 'draft_pick_and_future_pick_distribution' as const,
          modelKind: 'draft_pick_and_future_pick_distribution' as const,
          protocolId: operation.content.pick.protocolId,
          runId: pickRunId,
          datasetId: operation.content.pick.datasetId,
          gate3DecisionId: pickGate3DecisionId,
        },
      ],
      viewPolicy: {
        atTrade: {
          modelVintage: 'historical_restatement' as const,
          knowledgeCutoff: 'transaction_effective_at_exclusive' as const,
        },
        current: {
          modelVintage: 'current' as const,
          effectiveAt: '2026-08-21T07:00:00.000Z',
          knowledgeCutoffAt: '2026-08-21T07:00:00.000Z',
          valuationAsOf: '2026-08-21T08:00:00.000Z',
        },
        currentViewsShareOneTemporalContext: true as const,
      },
      packagePolicy: {
        calculationUnit: 'complete_multi_party_trade' as const,
        attribution: 'lineage_frontier_exactly_once' as const,
        aggregation: 'joint_simulation_not_independent_point_sum' as const,
        currentOutcomeIdentity: 'realized_club_value_plus_remaining_asset_value' as const,
        unresolvedAssetTreatment: 'exclude_with_explicit_reason_no_fallback_value' as const,
        listSpotPolicyArtifact: bundleParents[0].reference,
        scarcityPolicyArtifact: bundleParents[1].reference,
        roleCongestionPolicyArtifact: bundleParents[2].reference,
      },
      simulation: {
        mode: 'deterministic_counter_sample' as const,
        draws: 10_000,
        seed: 'private-prepared-v3-integration',
        samplingAlgorithmVersion: 'counter_sha256_rejection_v1' as const,
        centralIntervalLevel: 0.8 as const,
        downsideQuantile: 0.1 as const,
        upsideQuantile: 0.9 as const,
        lowReturnDefinitionArtifact: bundleParents[3].reference,
        eliteOutcomeDefinitionArtifact: bundleParents[4].reference,
        practicalEquivalenceDefinitionArtifact: bundleParents[5].reference,
      },
      explanationPolicyArtifact: bundleParents[6].reference,
      publicationEligible: false as const,
      limitation:
        'Approved calculation inputs only; not execution evidence, numerical validity, publication approval, or activation authority.' as const,
    };
    const valuationInputBundle = {
      valuationInputBundleId: createAflTradeContentAddress(
        'valuation-input-bundle',
        valuationInputBundleContent
      ),
      content: valuationInputBundleContent,
    };
    const valuationInputBundleArtifact = canonicalArtifact(
      valuationInputBundle,
      valuationInputBundleContent.createdAt
    );
    const releaseArtifact = canonicalArtifact(releaseManifest, releaseCreatedAt);
    const releaseMembershipArtifact = canonicalArtifact(canonicalMembers, releaseCreatedAt);
    for (const retained of [
      ...bundleParents,
      valuationInputBundleArtifact,
      releaseArtifact,
      releaseMembershipArtifact,
    ]) {
      await staging.retainArtifact(retained);
    }

    const publicAuthorityBefore = await outcomesPool.query<{ snapshot: unknown }>(
      `SELECT jsonb_build_object(
        'activeReleases',coalesce((SELECT jsonb_agg(to_jsonb(active_release)
          ORDER BY active_release.scope_key) FROM outcome_active_release active_release),'[]'::jsonb),
        'currentModelPairs',coalesce((SELECT jsonb_agg(to_jsonb(model_pair)
          ORDER BY model_pair.scope_key) FROM outcome_current_governed_valuation_model_pair model_pair),'[]'::jsonb),
        'publicationRegistry',coalesce((SELECT jsonb_agg(to_jsonb(registry)
          ORDER BY registry.singleton_id) FROM outcome_valuation_publication_registry_head registry),'[]'::jsonb),
        'activePublications',coalesce((SELECT jsonb_agg(to_jsonb(publication)
          ORDER BY publication.scope_key) FROM outcome_valuation_active_publication publication),'[]'::jsonb)
      ) AS snapshot`
    );

    let selectedValuationInputBundleId = valuationInputBundle.valuationInputBundleId;
    const selectValuationInputBundleId = async () => selectedValuationInputBundleId;
    let constructionEvidenceCalls = 0;
    const loadConstructionEvidence = async () => {
      constructionEvidenceCalls += 1;
      return {
        factualReleaseArtifact: releaseArtifact.reference,
        releaseMembershipArtifact: releaseMembershipArtifact.reference,
        releaseTradeIds: [releaseTradeId, unavailableTradeId],
        valuationInputBundleId: valuationInputBundle.valuationInputBundleId,
        valuationInputBundleArtifact: valuationInputBundleArtifact.reference,
        valuationInputBundle,
      };
    };
    const capturePrivate = createPostgresAflTradePrivateCurrentValuationCohortAuthorityCapture({
      client,
      selectValuationInputBundleId,
      loadConstructionEvidence,
    });
    const capturedContexts = await Promise.all([
      capturePrivate({ requestId, claim }),
      capturePrivate({ requestId, claim }),
    ]);
    expect(capturedContexts[1]).toEqual(capturedContexts[0]);
    expect(constructionEvidenceCalls).toBe(1);

    const crossScopeKey = 'afl-men:2025-trades';
    const crossScopeBundleContent = {
      ...valuationInputBundleContent,
      scopeKey: crossScopeKey,
    };
    const crossScopeBundle = {
      valuationInputBundleId: createAflTradeContentAddress(
        'valuation-input-bundle',
        crossScopeBundleContent
      ),
      content: crossScopeBundleContent,
    };
    const crossScopeBundleArtifact = canonicalArtifact(
      crossScopeBundle,
      crossScopeBundleContent.createdAt
    );
    const captured = capturedContexts[0]!;
    const crossScopeOperationId = createAflTradePrivateCurrentValuationCohortPreparationOperationId(
      {
        scopeKey: crossScopeKey,
        factualReleaseId: captured.factualReleaseId,
        modelEvidence: captured.modelEvidence,
        dispatchAuthority: captured.dispatchAuthority,
        valuationInputBundleId: crossScopeBundle.valuationInputBundleId,
        expectedPreparedInputRevision: captured.expectedPreparedInputRevision,
      }
    );
    const crossScopeContext = {
      ...captured,
      // Keep the authenticated JSON scope while attempting to write the row and bundle elsewhere.
      operationId: crossScopeOperationId,
      valuationInputBundleId: crossScopeBundle.valuationInputBundleId,
      valuationInputBundleArtifact: crossScopeBundleArtifact.reference,
      valuationInputBundle: crossScopeBundle,
    };
    const crossScopeCanonicalContext = canonicalizeAflTradeJson(crossScopeContext);
    const crossScopeClient = await outcomesPool.connect();
    let crossScopeRejected = false;
    try {
      await crossScopeClient.query('BEGIN');
      await crossScopeClient.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
      try {
        await crossScopeClient.query(
          `INSERT INTO outcome_current_valuation_cohort_operation
            (operation_id,scope_key,factual_release_id,factual_release_revision,
             model_qualification_id,model_qualification_work_id,
             model_qualification_revision,expected_prepared_input_revision,
             captured_at,context_sha256,context_canonical_json,context_json,
             preparation_authority,current_model_evidence_operation_id,
             dispatch_request_id,factual_output_id,hpn_calculation_id,
             model_operation_id,valuation_input_bundle_id)
           VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,
                   $12,$13,$14,$15,$16,$17,$18)`,
          [
            crossScopeOperationId,
            crossScopeKey,
            captured.factualReleaseId,
            captured.modelEvidence.qualificationId,
            captured.modelEvidence.qualificationWorkId,
            captured.modelEvidence.modelRevision,
            captured.expectedPreparedInputRevision,
            captured.capturedAt,
            digest(crossScopeCanonicalContext),
            crossScopeCanonicalContext,
            crossScopeCanonicalContext,
            captured.preparationAuthority,
            captured.modelEvidence.operationId,
            captured.dispatchAuthority.requestId,
            captured.dispatchAuthority.factualOutputId,
            captured.dispatchAuthority.hpnCalculationId,
            captured.dispatchAuthority.modelOperationId,
            crossScopeBundle.valuationInputBundleId,
          ]
        );
      } catch (error) {
        crossScopeRejected = true;
        expect(error).toMatchObject({
          message: expect.stringContaining(
            'Private cohort operation identity or current authority mismatch'
          ),
        });
      }
    } finally {
      await crossScopeClient.query('ROLLBACK');
      crossScopeClient.release();
    }
    expect(crossScopeRejected).toBe(true);

    const materialization = createGovernedPrivateEvaluationAuthenticatedCalculationFixture({
      scopeKey: operation.content.scopeKey,
      factualReleaseId: releaseManifest.releaseId,
      valuationInputBundleId: valuationInputBundle.valuationInputBundleId,
      components: [
        {
          role: 'player_contribution_and_availability',
          runId: playerRunId,
          protocolId: operation.content.player.protocolId,
          datasetId: operation.content.player.datasetId,
          datasetAdmissionId: operation.content.player.datasetAdmissionId,
          gate3DecisionId: playerGate3DecisionId,
        },
        {
          role: 'draft_pick_and_future_pick_distribution',
          runId: pickRunId,
          protocolId: operation.content.pick.protocolId,
          datasetId: operation.content.pick.datasetId,
          datasetAdmissionId: operation.content.pick.datasetAdmissionId,
          gate3DecisionId: pickGate3DecisionId,
        },
      ],
    });
    const governedTrace = createGovernedPrivateEvaluationInputTrace({
      ...materialization.trace.content,
      derivedAt: capturedAt,
      components: materialization.trace.content.components.map((component) => {
        const authority =
          component.role === 'player_contribution_and_availability'
            ? {
                manifest: playerComponent,
                artifact: playerComponentArtifact,
                gate: gateRecords[0].decision,
              }
            : {
                manifest: pickComponent,
                artifact: pickComponentArtifact,
                gate: gateRecords[1].decision,
              };
        return {
          ...component,
          evidence: {
            ...component.evidence,
            runManifest: authority.artifact,
            protocol: authority.manifest.content.protocolArtifact,
            datasetAdmission: authority.manifest.content.datasetAdmissionArtifact,
            gate3Decision: createAflTradeCanonicalJsonArtifactRef(
              authority.gate,
              authority.gate.content.decidedAt!
            ),
          },
        };
      }),
    });
    const baseCalculationInput = materialization.calculationInputPackage.content;
    if (baseCalculationInput.schemaVersion !== 'afl-trade-valuation-calculation-input-package/v2') {
      throw new Error('Authenticated calculation fixture did not produce v2 inputs.');
    }
    const governedCalculationInput = createAflTradeValuationCalculationInputPackage({
      ...baseCalculationInput,
      createdAt: capturedAt,
      authority: {
        kind: 'authenticated_non_production',
        inputTraceId: governedTrace.inputTraceId,
        publicationProhibited: true,
      },
    });
    const governedMaterializationManifest = createGovernedPrivateEvaluationMaterializationManifest({
      ...materialization.materializationManifest.content,
      createdAt: capturedAt,
      calculationInputPackageId: governedCalculationInput.calculationInputPackageId,
      calculationInputArtifact: createAflTradeCanonicalJsonArtifactRef(
        governedCalculationInput,
        governedCalculationInput.content.createdAt
      ),
      inputTraceId: governedTrace.inputTraceId,
      inputTraceArtifact: createAflTradeCanonicalJsonArtifactRef(
        governedTrace,
        governedCalculationInput.content.createdAt
      ),
    });
    let tradeConstructionCalls = 0;
    const constructTrade = async ({ tradeId }: { readonly tradeId: string }) => {
      tradeConstructionCalls += 1;
      if (tradeId === unavailableTradeId) {
        return {
          state: 'blocked' as const,
          blockers: [
            {
              code: 'insufficient_data' as const,
              subject: { kind: 'trade' as const, id: unavailableTradeId },
              evidenceRefs: [valuationInputBundleArtifact.reference],
            },
          ],
        };
      }
      if (tradeId !== releaseTradeId) {
        throw new TypeError('Fixture received an unknown private cohort member.');
      }
      const manifest = governedMaterializationManifest;
      return {
        state: 'ready' as const,
        manifest,
        manifestArtifact: createAflTradeCanonicalJsonArtifactRef(
          manifest,
          manifest.content.createdAt
        ),
        retainedParents: [
          {
            reference: manifest.content.calculationInputArtifact,
            bytes: new TextEncoder().encode(canonicalizeAflTradeJson(governedCalculationInput)),
          },
          {
            reference: manifest.content.inputTraceArtifact,
            bytes: new TextEncoder().encode(canonicalizeAflTradeJson(governedTrace)),
          },
          {
            reference: manifest.content.explanationPolicyArtifact,
            bytes: new TextEncoder().encode(
              canonicalizeAflTradeJson(materialization.explanationPolicy)
            ),
          },
          {
            reference: manifest.content.lineageGraphArtifact,
            bytes: new TextEncoder().encode(canonicalizeAflTradeJson(materialization.lineageGraph)),
          },
          {
            reference: manifest.content.pickBenchmarks[0]!.artifact,
            bytes: new TextEncoder().encode(
              canonicalizeAflTradeJson(materialization.pickBenchmarks[0])
            ),
          },
        ],
      };
    };
    const privateCoordinator = createPostgresAflTradePrivateCurrentValuationCohortCoordinator({
      client,
      artifactRepository,
      maximumArtifactBytes: 16 * 1024 * 1024,
      selectValuationInputBundleId,
      loadConstructionEvidence,
      constructTrade,
    });
    await expect(
      outcomesPool.query(
        `SELECT
           has_table_privilege(
             'afl_trade_private_evaluation_coordinator',
             'outcome_current_prepared_valuation_input_set','SELECT'
           ) AS coordinator_can_select,
           has_table_privilege(
             'afl_trade_private_evaluation_coordinator',
             'outcome_current_prepared_valuation_input_set','INSERT'
           ) AS coordinator_can_insert,
           has_table_privilege(
             'afl_trade_private_evaluation_coordinator',
             'outcome_current_prepared_valuation_input_set','UPDATE'
           ) AS coordinator_can_update,
           has_table_privilege(
             'afl_trade_private_evaluation_coordinator',
             'outcome_current_prepared_valuation_input_set','DELETE'
           ) AS coordinator_can_delete,
           has_table_privilege(
             'afl_trade_private_prepared_input_head_owner',
             'outcome_current_prepared_valuation_input_set','INSERT'
           ) AS owner_can_insert,
           has_table_privilege(
             'afl_trade_private_prepared_input_head_owner',
             'outcome_current_prepared_valuation_input_set','UPDATE'
           ) AS owner_can_update`
      )
    ).resolves.toMatchObject({
      rows: [
        {
          coordinator_can_select: true,
          coordinator_can_insert: false,
          coordinator_can_update: false,
          coordinator_can_delete: false,
          owner_can_insert: true,
          owner_can_update: true,
        },
      ],
    });
    const directHeadWriter = await outcomesPool.connect();
    try {
      await directHeadWriter.query('BEGIN');
      await directHeadWriter.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
      await expect(
        directHeadWriter.query(
          `UPDATE outcome_current_prepared_valuation_input_set
              SET revision=revision+1
            WHERE FALSE`
        )
      ).rejects.toThrow('permission denied');
    } finally {
      await directHeadWriter.query('ROLLBACK').catch(() => undefined);
      directHeadWriter.release();
    }
    const directHeadInserter = await outcomesPool.connect();
    try {
      await directHeadInserter.query('BEGIN');
      await directHeadInserter.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
      await expect(
        directHeadInserter.query(
          `INSERT INTO outcome_current_prepared_valuation_input_set
             (scope_key,prepared_input_set_id,revision)
           VALUES ('unauthorized-scope','unauthorized-prepared-set',1)`
        )
      ).rejects.toThrow('permission denied');
    } finally {
      await directHeadInserter.query('ROLLBACK').catch(() => undefined);
      directHeadInserter.release();
    }
    await expect(
      outcomesPool.query(
        `SELECT procedure.proname,owner.rolname AS owner_name,owner.rolsuper,owner.rolcanlogin,
                procedure.prosecdef,
                has_function_privilege(
                  owner.rolname,procedure.oid,'EXECUTE'
                ) AS owner_can_execute,
                has_function_privilege(
                  'afl_trade_private_evaluation_coordinator',procedure.oid,'EXECUTE'
                ) AS coordinator_can_execute,
                has_function_privilege('public',procedure.oid,'EXECUTE') AS public_can_execute
           FROM pg_proc procedure
           JOIN pg_roles owner ON owner.oid=procedure.proowner
          WHERE procedure.oid IN (
            to_regprocedure('activate_outcome_current_prepared_valuation_input_set(text,text,integer)'),
            to_regprocedure('load_outcome_private_current_prepared_valuation_input_head(text)'),
            to_regprocedure('load_outcome_private_prepared_v3_authority(text)'),
            to_regprocedure(
              'outcome_private_prepared_v3_factual_authority_is_current(text,text,text,text,text,integer)'
            ),
            to_regprocedure(
              'activate_outcome_private_current_prepared_valuation_input_set(text,text,integer)'
            )
          )
          ORDER BY procedure.proname`
      )
    ).resolves.toMatchObject({
      rows: [
        {
          proname: 'activate_outcome_current_prepared_valuation_input_set',
          prosecdef: false,
          public_can_execute: true,
        },
        {
          proname: 'activate_outcome_private_current_prepared_valuation_input_set',
          owner_name: 'afl_trade_private_prepared_input_head_owner',
          rolsuper: false,
          rolcanlogin: false,
          prosecdef: true,
          owner_can_execute: true,
          coordinator_can_execute: true,
          public_can_execute: false,
        },
        {
          proname: 'load_outcome_private_current_prepared_valuation_input_head',
          owner_name: 'afl_trade_private_prepared_input_head_owner',
          rolsuper: false,
          rolcanlogin: false,
          prosecdef: true,
          owner_can_execute: true,
          coordinator_can_execute: true,
          public_can_execute: false,
        },
        {
          proname: 'load_outcome_private_prepared_v3_authority',
          owner_name: 'afl_trade_private_prepared_v3_owner',
          rolsuper: false,
          rolcanlogin: false,
          prosecdef: true,
          owner_can_execute: true,
          coordinator_can_execute: true,
          public_can_execute: false,
        },
        {
          proname: 'outcome_private_prepared_v3_factual_authority_is_current',
          owner_name: 'afl_trade_current_valuation_refresh_owner',
          rolsuper: false,
          rolcanlogin: false,
          prosecdef: true,
          owner_can_execute: true,
          public_can_execute: false,
        },
      ],
    });
    const ambiguousQualifiedEvidenceOperationId = addressed(
      'current-valuation-model-evidence-operation',
      'ambiguous-qualified-evidence-for-private-prepared'
    );
    await mutateFixture(
      `INSERT INTO outcome_current_valuation_model_evidence_operation
        (operation_id,scope_key,factual_operation_id,factual_candidate_id,factual_revision,
         expected_model_revision,result_state,result_json,captured_at,completed_at,recorded_at)
       SELECT $2,scope_key,factual_operation_id,factual_candidate_id,factual_revision,
              expected_model_revision,result_state,
              jsonb_set(result_json,'{operationId}',to_jsonb($2::text)),
              captured_at,completed_at,recorded_at
         FROM outcome_current_valuation_model_evidence_operation WHERE operation_id=$1`,
      [retainedCurrent.operationId, ambiguousQualifiedEvidenceOperationId]
    );
    const ambiguousAuthority = await outcomesPool.connect();
    try {
      await ambiguousAuthority.query('BEGIN');
      await ambiguousAuthority.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
      await expect(
        ambiguousAuthority.query(
          `SELECT scope_key FROM load_outcome_private_prepared_v3_authority($1)`,
          [requestId]
        )
      ).rejects.toThrow('Private prepared-v3 authority lookup is ambiguous');
      await ambiguousAuthority.query('ROLLBACK');
    } finally {
      await ambiguousAuthority.query('ROLLBACK').catch(() => undefined);
      ambiguousAuthority.release();
    }
    await mutateFixture(
      `DELETE FROM outcome_current_valuation_model_evidence_operation WHERE operation_id=$1`,
      [ambiguousQualifiedEvidenceOperationId]
    );
    const authorityFence = await client.transaction(async (transaction) => {
      await transaction.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
      const authority = await transaction.query(
        `SELECT scope_key,model_evidence_json->>'operationId' AS evidence_operation_id
           FROM load_outcome_private_prepared_v3_authority($1)`,
        [requestId]
      );
      expect(authority.rows).toEqual([
        {
          scope_key: operation.content.scopeKey,
          evidence_operation_id: retainedCurrent.operationId,
        },
      ]);
      return outcomesPool.query<{
        model_lock_available: boolean;
        player_gate_lock_available: boolean;
        pick_gate_lock_available: boolean;
        capture_lock_available: boolean;
      }>(
        `SELECT
          pg_try_advisory_xact_lock(hashtextextended($1,0)) AS model_lock_available,
          pg_try_advisory_xact_lock(hashtextextended($2,0)) AS player_gate_lock_available,
          pg_try_advisory_xact_lock(hashtextextended($3,0)) AS pick_gate_lock_available,
          pg_try_advisory_xact_lock(hashtextextended($4,0)) AS capture_lock_available`,
        [
          `governed-model-pair:${operation.content.scopeKey}`,
          playerGate3LockKey,
          pickGate3LockKey,
          `outcome-capture-scope:${privateCaptureId}`,
        ]
      );
    });
    expect(authorityFence.rows).toEqual([
      {
        model_lock_available: false,
        player_gate_lock_available: false,
        pick_gate_lock_available: false,
        capture_lock_available: false,
      },
    ]);
    const waitUntilAdvisoryBlocked = async (backendPid: number) => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const activity = await adminPool.query<{ blocked: boolean }>(
          `SELECT coalesce((SELECT wait_event_type='Lock' AND wait_event='advisory'
             FROM pg_stat_activity WHERE pid=$1),false) AS blocked`,
          [backendPid]
        );
        if (activity.rows[0]?.blocked === true) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('Private prepared authority loader did not reach its advisory fence.');
    };
    const qualificationWriter = await outcomesPool.connect();
    const qualificationLoader = await outcomesPool.connect();
    let qualificationLoad: ReturnType<typeof qualificationLoader.query> | undefined;
    try {
      await qualificationWriter.query('BEGIN');
      await qualificationWriter.query(`SET LOCAL statement_timeout='2s'`);
      await qualificationWriter.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        playerGate3LockKey,
      ]);
      await qualificationLoader.query('BEGIN');
      await qualificationLoader.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
      const qualificationLoaderPid = await qualificationLoader.query<{ pid: number }>(
        `SELECT pg_backend_pid() AS pid`
      );
      qualificationLoad = qualificationLoader.query(
        `SELECT scope_key FROM load_outcome_private_prepared_v3_authority($1)`,
        [requestId]
      );
      await waitUntilAdvisoryBlocked(qualificationLoaderPid.rows[0]!.pid);
      await qualificationWriter.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        pickGate3LockKey,
      ]);
      await qualificationWriter.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `governed-model-pair:${operation.content.scopeKey}`,
      ]);
      await qualificationWriter.query('SET LOCAL session_replication_role = replica');
      await qualificationWriter.query(
        `UPDATE outcome_gate_decision
            SET state='withdrawn',
                decision_json=jsonb_set(decision_json,'{content,state}','"withdrawn"')
          WHERE decision_id=$1`,
        [playerGate3DecisionId]
      );
      await qualificationWriter.query('COMMIT');
      await expect(qualificationLoad).resolves.toMatchObject({
        rows: [],
      });
      await qualificationLoader.query('COMMIT');
    } finally {
      await qualificationWriter.query('ROLLBACK').catch(() => undefined);
      await qualificationLoader.query('ROLLBACK').catch(() => undefined);
      await qualificationLoad?.catch(() => undefined);
      qualificationWriter.release();
      qualificationLoader.release();
    }
    await mutateFixture(
      `UPDATE outcome_gate_decision
          SET state='approved',
              decision_json=jsonb_set(decision_json,'{content,state}','"approved"')
        WHERE decision_id=$1`,
      [playerGate3DecisionId]
    );
    const factualWriter = await outcomesPool.connect();
    const factualLoader = await outcomesPool.connect();
    let factualLoad: ReturnType<typeof factualLoader.query> | undefined;
    try {
      await factualWriter.query('BEGIN');
      await factualWriter.query(`SET LOCAL statement_timeout='2s'`);
      await factualWriter.query(
        `SELECT 1 FROM outcome_private_reviewed_evaluation_head
          WHERE valuation_scope_key=$1 AND evidence_scope_key=$2 FOR SHARE`,
        [privateAuthority.valuationScopeKey, privateAuthority.evidenceScopeKey]
      );
      await factualWriter.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `outcome-capture-scope:${privateCaptureId}`,
      ]);
      await factualLoader.query('BEGIN');
      await factualLoader.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
      const factualLoaderPid = await factualLoader.query<{ pid: number }>(
        `SELECT pg_backend_pid() AS pid`
      );
      factualLoad = factualLoader.query(
        `SELECT scope_key FROM load_outcome_private_prepared_v3_authority($1)`,
        [requestId]
      );
      await waitUntilAdvisoryBlocked(factualLoaderPid.rows[0]!.pid);
      await factualWriter.query(
        `UPDATE outcome_current_private_factual_authority
            SET revision=revision+1
          WHERE valuation_scope_key=$1`,
        [privateAuthority.valuationScopeKey]
      );
      await factualWriter.query('COMMIT');
      await expect(factualLoad).resolves.toMatchObject({
        rows: [],
      });
      await factualLoader.query('COMMIT');
    } finally {
      await factualWriter.query('ROLLBACK').catch(() => undefined);
      await factualLoader.query('ROLLBACK').catch(() => undefined);
      await factualLoad?.catch(() => undefined);
      factualWriter.release();
      factualLoader.release();
    }
    await mutateFixture(
      `UPDATE outcome_current_private_factual_authority SET revision=$2
        WHERE valuation_scope_key=$1`,
      [privateAuthority.valuationScopeKey, privateAuthority.revision]
    );
    const concurrentPrepared = await Promise.all([
      privateCoordinator.prepare({ requestId, claim }),
      privateCoordinator.prepare({ requestId, claim }),
    ]);
    expect(concurrentPrepared.map(({ state }) => state).sort()).toEqual([
      'advanced',
      'already_current',
    ]);
    expect(concurrentPrepared[0]).toMatchObject({
      preparedInputSet: {
        content: {
          preparationAuthority: 'qualified_current_model_evidence',
          modelEvidence: retainedCurrent,
          dispatchAuthority: {
            requestId,
            factualOutputId,
            hpnCalculationId,
            modelOperationId: operation.operationId,
          },
          entries: [
            { tradeId: releaseTradeId, state: 'ready' },
            { tradeId: unavailableTradeId, state: 'blocked' },
          ],
        },
      },
      head: { revision: 1 },
    });
    expect(tradeConstructionCalls).toBeGreaterThanOrEqual(2);
    expect(tradeConstructionCalls).toBeLessThanOrEqual(4);

    const noChange = createPostgresAflTradePrivateCurrentValuationCohortCoordinator({
      client,
      artifactRepository,
      maximumArtifactBytes: 16 * 1024 * 1024,
      selectValuationInputBundleId,
      loadConstructionEvidence: async () => {
        throw new Error('current replay must suppress evidence reconstruction');
      },
      constructTrade: async () => {
        throw new Error('current replay must suppress trade reconstruction');
      },
    });
    await expect(noChange.prepare({ requestId, claim })).resolves.toMatchObject({
      state: 'already_current',
      head: { revision: 1 },
    });
    selectedValuationInputBundleId = `valuation-input-bundle:${'f'.repeat(64)}`;
    await expect(privateCoordinator.prepare({ requestId, claim })).rejects.toThrow(
      'Private cohort construction evidence does not match the selected valuation input bundle.'
    );
    expect(constructionEvidenceCalls).toBe(2);
    selectedValuationInputBundleId = valuationInputBundle.valuationInputBundleId;
    await expect(noChange.prepare({ requestId, claim })).resolves.toMatchObject({
      state: 'already_current',
      head: { revision: 1 },
    });
    const expectStalePreparedAuthority = async () => {
      await expect(noChange.prepare({ requestId, claim })).resolves.toMatchObject({
        state: 'stale_authority',
      });
    };
    await mutateFixture(
      `UPDATE outcome_current_valuation_model_evidence_operation
          SET result_state='qualification_failed' WHERE operation_id=$1`,
      [retainedCurrent.operationId]
    );
    await expectStalePreparedAuthority();
    await mutateFixture(
      `UPDATE outcome_current_valuation_model_evidence_operation
          SET result_state='qualified' WHERE operation_id=$1`,
      [retainedCurrent.operationId]
    );
    await mutateFixture(
      `UPDATE outcome_hpn_pav_calculation
          SET status='building',finalized_at=NULL WHERE calculation_id=$1`,
      [hpnCalculationId]
    );
    await expectStalePreparedAuthority();
    await mutateFixture(
      `UPDATE outcome_hpn_pav_calculation
          SET status='finalized',finalized_at=$2 WHERE calculation_id=$1`,
      [hpnCalculationId, hpnCalculation.content.calculatedAt]
    );
    await mutateFixture(
      `UPDATE outcome_governed_model_qualification_work
          SET status='superseded' WHERE work_id=$1`,
      [qualificationWorkId]
    );
    await expectStalePreparedAuthority();
    await mutateFixture(
      `UPDATE outcome_governed_model_qualification_work
          SET status='completed' WHERE work_id=$1`,
      [qualificationWorkId]
    );
    await mutateFixture(
      `UPDATE outcome_gate_decision
          SET state='withdrawn',
              decision_json=jsonb_set(decision_json,'{content,state}','"withdrawn"')
        WHERE decision_id=$1`,
      [playerGate3DecisionId]
    );
    await expectStalePreparedAuthority();
    await mutateFixture(
      `UPDATE outcome_gate_decision
          SET state='approved',
              decision_json=jsonb_set(decision_json,'{content,state}','"approved"')
        WHERE decision_id=$1`,
      [playerGate3DecisionId]
    );
    await mutateFixture(
      `UPDATE outcome_current_private_factual_authority
          SET revision=revision+1 WHERE valuation_scope_key=$1`,
      [privateAuthority.valuationScopeKey]
    );
    await expectStalePreparedAuthority();
    await mutateFixture(
      `UPDATE outcome_current_private_factual_authority
          SET revision=revision-1 WHERE valuation_scope_key=$1`,
      [privateAuthority.valuationScopeKey]
    );
    await mutateFixture(
      `UPDATE outcome_private_reviewed_evidence_bundle
          SET bundle_json=jsonb_set(bundle_json,'{content,fixtureCurrent}','false'::jsonb)
        WHERE evidence_bundle_id=$1`,
      [privateAuthority.evidenceBundleId]
    );
    await expectStalePreparedAuthority();
    await mutateFixture(
      `UPDATE outcome_private_reviewed_evidence_bundle
          SET bundle_json=jsonb_set(bundle_json,'{content,fixtureCurrent}','true'::jsonb)
        WHERE evidence_bundle_id=$1`,
      [privateAuthority.evidenceBundleId]
    );
    await mutateFixture(
      `UPDATE outcome_provider_normalization_run
          SET decoder_version='decoder-v2' WHERE normalization_run_id=$1`,
      [privateNormalizationRunId]
    );
    await expectStalePreparedAuthority();
    await mutateFixture(
      `UPDATE outcome_provider_normalization_run
          SET decoder_version='decoder-v1' WHERE normalization_run_id=$1`,
      [privateNormalizationRunId]
    );
    await expect(
      outcomesPool.query<{ snapshot: unknown }>(
        `SELECT jsonb_build_object(
          'activeReleases',coalesce((SELECT jsonb_agg(to_jsonb(active_release)
            ORDER BY active_release.scope_key) FROM outcome_active_release active_release),'[]'::jsonb),
          'currentModelPairs',coalesce((SELECT jsonb_agg(to_jsonb(model_pair)
            ORDER BY model_pair.scope_key) FROM outcome_current_governed_valuation_model_pair model_pair),'[]'::jsonb),
          'publicationRegistry',coalesce((SELECT jsonb_agg(to_jsonb(registry)
            ORDER BY registry.singleton_id) FROM outcome_valuation_publication_registry_head registry),'[]'::jsonb),
          'activePublications',coalesce((SELECT jsonb_agg(to_jsonb(publication)
            ORDER BY publication.scope_key) FROM outcome_valuation_active_publication publication),'[]'::jsonb)
        ) AS snapshot`
      )
    ).resolves.toEqual(publicAuthorityBefore);
    await expect(
      outcomesPool.query(
        `SELECT
          (SELECT count(*)::int FROM outcome_current_valuation_cohort_operation
            WHERE preparation_authority='qualified_current_model_evidence') AS operation_count,
          (SELECT count(*)::int FROM outcome_current_valuation_cohort_operation_result) AS result_count,
          (SELECT count(*)::int FROM outcome_prepared_valuation_input_set
            WHERE prepared_set_json->'content'->>'preparationAuthority'=
              'qualified_current_model_evidence') AS prepared_count,
          (SELECT revision FROM outcome_current_prepared_valuation_input_set
            WHERE scope_key=$1) AS head_revision`,
        [operation.content.scopeKey]
      )
    ).resolves.toMatchObject({
      rows: [
        {
          operation_count: 1,
          result_count: 1,
          prepared_count: 1,
          head_revision: 1,
        },
      ],
    });

    await mutateFixture(
      `UPDATE outcome_private_reviewed_evaluation_head
          SET status='withdrawn' WHERE valuation_scope_key=$1 AND evidence_scope_key=$2`,
      [privateAuthority.valuationScopeKey, privateAuthority.evidenceScopeKey]
    );
    await expect(noChange.prepare({ requestId, claim })).resolves.toMatchObject({
      state: 'stale_authority',
      reason: expect.stringContaining('exact qualified current model evidence'),
    });
    await mutateFixture(
      `UPDATE outcome_private_reviewed_evaluation_head
          SET status='authorized' WHERE valuation_scope_key=$1 AND evidence_scope_key=$2`,
      [privateAuthority.valuationScopeKey, privateAuthority.evidenceScopeKey]
    );

    await mutateFixture(
      `UPDATE outcome_private_valuation_dispatch_request
          SET lease_expires_at=clock_timestamp()-interval '1 millisecond'
        WHERE request_id=$1`,
      [requestId]
    );
    await mutateFixture(
      `UPDATE outcome_private_valuation_dispatch_attempt
          SET lease_expires_at=clock_timestamp()-interval '1 millisecond'
        WHERE claim_id=$1`,
      [claimId]
    );
    const replacementLeaseToken = digest('private-prepared-replacement-lease');
    const replacementClaim = await outcomesPool.query<{ claim_id: string }>(
      `SELECT claim_id FROM claim_outcome_private_valuation_dispatch($1,$2,300,$3)`,
      ['system:private-prepared-restart-tracer', digest(replacementLeaseToken), requestId]
    );
    expect(replacementClaim.rows).toHaveLength(1);
    const replacementClaimId = replacementClaim.rows[0]!.claim_id;
    await expect(
      noChange.prepare({
        requestId,
        claim: {
          claimId: replacementClaimId,
          leaseToken: replacementLeaseToken,
        },
      })
    ).resolves.toMatchObject({ state: 'already_current', head: { revision: 1 } });
    await expect(noChange.prepare({ requestId, claim })).rejects.toThrow(
      'lost its live claim fence'
    );
    const privatePreparedCustody = await outcomesPool.query<{
      context_json: unknown;
      prepared_set_json: unknown;
    }>(
      `SELECT operation.context_json,prepared.prepared_set_json
         FROM outcome_current_valuation_cohort_operation operation
         JOIN outcome_current_valuation_cohort_operation_result result
           ON result.operation_id=operation.operation_id
         JOIN outcome_prepared_valuation_input_set prepared
           ON prepared.prepared_input_set_id=result.prepared_input_set_id
        WHERE operation.dispatch_request_id=$1`,
      [requestId]
    );
    expect(privatePreparedCustody.rows).toHaveLength(1);
    expect(JSON.stringify(privatePreparedCustody.rows[0])).not.toContain(claimId);
    expect(JSON.stringify(privatePreparedCustody.rows[0])).not.toContain(replacementClaimId);

    const privateBatchWorkspace = createPostgresGovernedPrivateEvaluationWorkspace({
      client,
      artifactRepository,
      maximumArtifactBytes: 16 * 1024 * 1024,
      principalId: 'system:weekly-valuation-coordinator',
      enableAutomatedPrivateCalculation: true,
      authorizeReader: async () => false,
    });
    let releaseReadyStage: () => void = () => undefined;
    const readyStageRelease = new Promise<void>((resolve) => {
      releaseReadyStage = resolve;
    });
    let reportReadyStageEntered: () => void = () => undefined;
    const readyStageEntered = new Promise<void>((resolve) => {
      reportReadyStageEntered = resolve;
    });
    const privateBatchRunner = createPostgresAflTradePrivateEvaluationCohortRunner({
      client,
      workspace: {
        ...privateBatchWorkspace,
        stageAutomated: async (input) => {
          reportReadyStageEntered();
          await readyStageRelease;
          return privateBatchWorkspace.stageAutomated(input);
        },
      },
      batchRepository: new PostgresGovernedPrivateEvaluationBatchRepository(
        client,
        async () => false
      ),
      workerId: 'system:private-batch-tracer',
    });
    const replacementDispatchClaim = {
      claimId: replacementClaimId,
      leaseToken: replacementLeaseToken,
    };
    const activation = privateBatchRunner.runPrivate({
      request: { requestId, scopeKey: operation.content.scopeKey },
      claim: replacementDispatchClaim,
    });
    await readyStageEntered;
    try {
      await expect(
        outcomesPool.query(
          `SELECT
             (SELECT count(*)::int FROM outcome_private_evaluation_batch
               WHERE scope_key=$1) AS retained_batch_count,
             (SELECT count(*)::int FROM outcome_current_private_evaluation_batch
               WHERE scope_key=$1) AS visible_head_count`,
          [operation.content.scopeKey]
        )
      ).resolves.toMatchObject({
        rows: [{ retained_batch_count: 0, visible_head_count: 0 }],
      });
    } finally {
      releaseReadyStage();
    }
    const activatedBatch = await activation;
    if (activatedBatch.state === 'unexpected_failure') {
      throw new Error(JSON.stringify(activatedBatch.diagnostics));
    }
    if (activatedBatch.state === 'activated' && activatedBatch.batch.content.readyCount !== 1) {
      throw new Error(JSON.stringify(activatedBatch.batch.content.entries));
    }
    expect(activatedBatch).toMatchObject({
      state: 'activated',
      batch: {
        content: {
          scopeKey: operation.content.scopeKey,
          tradeCount: 2,
          readyCount: 1,
          unavailableCount: 1,
          entries: [
            {
              tradeId: releaseTradeId,
              state: 'ready',
              generationId: expect.stringMatching(
                /^local-private-trade-evaluation-generation:[a-f0-9]{64}$/u
              ),
            },
            { tradeId: unavailableTradeId, state: 'unavailable' },
          ],
        },
      },
      transition: { revision: 1 },
    });
    const loadPrivateBatchRowCounts = () =>
      outcomesPool.query<{
        capture_count: number;
        cycle_count: number;
        work_count: number;
        attempt_count: number;
        generation_count: number;
        batch_count: number;
        entry_count: number;
        binding_count: number;
        transition_count: number;
        head_count: number;
      }>(
        `SELECT
           (SELECT count(*)::int FROM outcome_private_evaluation_cohort_capture
             WHERE scope_key=$1) AS capture_count,
           (SELECT count(*)::int FROM outcome_private_evaluation_execution_cycle
             WHERE scope_key=$1) AS cycle_count,
           (SELECT count(*)::int FROM outcome_private_evaluation_execution_work work
             JOIN outcome_private_evaluation_execution_cycle cycle USING (cycle_id)
            WHERE cycle.scope_key=$1) AS work_count,
           (SELECT count(*)::int FROM outcome_private_evaluation_execution_attempt attempt
             JOIN outcome_private_evaluation_execution_cycle cycle USING (cycle_id)
            WHERE cycle.scope_key=$1) AS attempt_count,
           (SELECT count(*)::int FROM outcome_local_private_trade_evaluation_generation
             WHERE valuation_scope_key=$1) AS generation_count,
           (SELECT count(*)::int FROM outcome_private_evaluation_batch
             WHERE scope_key=$1) AS batch_count,
           (SELECT count(*)::int FROM outcome_private_evaluation_batch_entry entry
             JOIN outcome_private_evaluation_batch batch USING (batch_id)
            WHERE batch.scope_key=$1) AS entry_count,
           (SELECT count(*)::int FROM outcome_private_evaluation_cohort_batch binding
             JOIN outcome_private_evaluation_cohort_capture capture USING (operation_id)
            WHERE capture.scope_key=$1) AS binding_count,
           (SELECT count(*)::int FROM outcome_private_evaluation_batch_transition
             WHERE scope_key=$1) AS transition_count,
           (SELECT count(*)::int FROM outcome_current_private_evaluation_batch
             WHERE scope_key=$1) AS head_count`,
        [operation.content.scopeKey]
      );
    const rowCountsAfterActivation = await loadPrivateBatchRowCounts();
    expect(rowCountsAfterActivation.rows).toEqual([
      {
        capture_count: 1,
        cycle_count: 1,
        work_count: 1,
        attempt_count: 1,
        generation_count: 1,
        batch_count: 1,
        entry_count: 2,
        binding_count: 1,
        transition_count: 1,
        head_count: 1,
      },
    ]);
    await expect(
      privateBatchRunner.runPrivate({
        request: { requestId, scopeKey: operation.content.scopeKey },
        claim: replacementDispatchClaim,
      })
    ).resolves.toMatchObject({ state: 'already_current', head: { revision: 1 } });

    await mutateFixture(
      `UPDATE outcome_private_valuation_dispatch_request
          SET lease_expires_at=clock_timestamp()-interval '1 millisecond'
        WHERE request_id=$1`,
      [requestId]
    );
    await mutateFixture(
      `UPDATE outcome_private_valuation_dispatch_attempt
          SET lease_expires_at=clock_timestamp()-interval '1 millisecond'
        WHERE claim_id=$1`,
      [replacementClaimId]
    );
    const finalLeaseToken = digest('private-batch-final-replacement-lease');
    const finalClaim = await outcomesPool.query<{ claim_id: string }>(
      `SELECT claim_id FROM claim_outcome_private_valuation_dispatch($1,$2,300,$3)`,
      ['system:private-batch-final-restart-tracer', digest(finalLeaseToken), requestId]
    );
    expect(finalClaim.rows).toHaveLength(1);
    const finalClaimId = finalClaim.rows[0]!.claim_id;
    await expect(
      privateBatchRunner.runPrivate({
        request: { requestId, scopeKey: operation.content.scopeKey },
        claim: replacementDispatchClaim,
      })
    ).resolves.toEqual({ state: 'stale_authority' });
    await expect(
      privateBatchRunner.runPrivate({
        request: { requestId, scopeKey: operation.content.scopeKey },
        claim: { claimId: finalClaimId, leaseToken: finalLeaseToken },
      })
    ).resolves.toMatchObject({ state: 'already_current', head: { revision: 1 } });
    const rowCountsAfterReplays = await loadPrivateBatchRowCounts();
    expect(rowCountsAfterReplays.rows).toEqual([
      {
        capture_count: 2,
        cycle_count: 1,
        work_count: 1,
        attempt_count: 1,
        generation_count: 1,
        batch_count: 1,
        entry_count: 2,
        binding_count: 1,
        transition_count: 1,
        head_count: 1,
      },
    ]);
    const privateBatchCustody = await outcomesPool.query<{
      capture_json: unknown;
      cycle_json: unknown;
      batch_json: unknown;
    }>(
      `SELECT to_jsonb(capture) AS capture_json,cycle.cycle_json,batch.batch_json
         FROM outcome_current_private_evaluation_batch head
         JOIN outcome_private_evaluation_batch batch ON batch.batch_id=head.batch_id
         JOIN outcome_private_evaluation_cohort_batch binding ON binding.batch_id=batch.batch_id
         JOIN outcome_private_evaluation_cohort_capture capture
           ON capture.operation_id=binding.operation_id
         JOIN outcome_private_evaluation_execution_cycle cycle
           ON cycle.prepared_input_set_id=capture.prepared_input_set_id
          AND cycle.prepared_input_set_revision=capture.prepared_input_set_revision
        WHERE head.scope_key=$1`,
      [operation.content.scopeKey]
    );
    expect(privateBatchCustody.rows).toHaveLength(1);
    expect(JSON.stringify(privateBatchCustody.rows[0])).not.toContain(replacementClaimId);
    expect(JSON.stringify(privateBatchCustody.rows[0])).not.toContain(replacementLeaseToken);
    expect(JSON.stringify(privateBatchCustody.rows[0])).not.toContain(finalClaimId);
    expect(JSON.stringify(privateBatchCustody.rows[0])).not.toContain(finalLeaseToken);

    const repairOperationId = addressed(
      'cohort-execution-repair',
      'dispatch-bound-private-batch-repair'
    );
    const repairReason = 'Corrected retained private calculation outage.';
    const retainedPrepared = concurrentPrepared[0];
    if (
      retainedPrepared.state === 'stale_authority' ||
      retainedPrepared.preparedInputSet.content.preparationAuthority !==
        'qualified_current_model_evidence' ||
      retainedCurrent.state !== 'qualified'
    ) {
      throw new Error('The private repair tracer requires retained qualified prepared authority.');
    }
    const repaired = await privateBatchRunner.repairPrivateCurrent(
      operation.content.scopeKey,
      repairReason,
      repairOperationId
    );
    expect(repaired).toMatchObject({
      content: {
        repairSequence: 1,
        repairOperationId,
        repairReason,
        authority: {
          scopeKey: operation.content.scopeKey,
          preparedInputSetId: retainedPrepared.preparedInputSet.preparedInputSetId,
          preparedInputSetRevision: 1,
          preparationOperationId: retainedPrepared.preparedInputSet.content.preparationOperationId,
          currentModelEvidenceOperationId: retainedCurrent.operationId,
          dispatchAuthority: {
            requestId,
            factualOutputId,
            hpnCalculationId,
            modelOperationId: operation.operationId,
          },
          modelQualificationWorkId: qualificationWorkId,
          modelPairRevision: retainedCurrent.modelRevision,
        },
      },
    });
    expect(repaired.content.authority).not.toHaveProperty('factualReleaseRevision');
    await expect(
      outcomesPool.query(
        `SELECT trade_id FROM outcome_private_evaluation_execution_work
          WHERE cycle_id=$1 ORDER BY trade_id`,
        [repaired.cycleId]
      )
    ).resolves.toMatchObject({ rows: [{ trade_id: releaseTradeId }] });
    await mutateFixture(
      `UPDATE outcome_private_reviewed_evaluation_head
          SET status='withdrawn' WHERE valuation_scope_key=$1 AND evidence_scope_key=$2`,
      [privateAuthority.valuationScopeKey, privateAuthority.evidenceScopeKey]
    );
    await expect(
      privateBatchRunner.repairPrivateCurrent(
        operation.content.scopeKey,
        repairReason,
        repairOperationId
      )
    ).resolves.toEqual(repaired);
    await mutateFixture(
      `UPDATE outcome_private_reviewed_evaluation_head
          SET status='authorized' WHERE valuation_scope_key=$1 AND evidence_scope_key=$2`,
      [privateAuthority.valuationScopeKey, privateAuthority.evidenceScopeKey]
    );

    await expect(
      client.transaction(async (transaction) => {
        await transaction.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
        await transaction.query(
          `UPDATE outcome_private_valuation_model_operation SET
             player_attempt_number=2,
             qualification_outcome='failed'
           WHERE operation_id=$1`,
          [operation.operationId]
        );
      })
    ).rejects.toThrow('immutable after acceptance');
    await outcomesPool.query(
      `SELECT complete_outcome_private_valuation_dispatch($1,$2,$3::jsonb)`,
      [finalClaimId, digest(finalLeaseToken), JSON.stringify({ state: 'activated' })]
    );
  });

  it('loads only the exact retained private factual and finalized HPN input', async () => {
    const requestId = addressed('private-valuation-dispatch', 'exact-loader-request');
    const requests = [
      { requestId, trigger: 'ad_hoc', custodyKey: 'exact-loader' },
      {
        requestId: addressed('private-valuation-dispatch', 'exact-loader-weekly-request'),
        trigger: 'weekly',
        custodyKey: 'exact-loader-weekly',
      },
      {
        requestId: addressed('private-valuation-dispatch', 'exact-loader-qualified-request'),
        trigger: 'model_qualified',
        custodyKey: 'exact-loader-qualified',
      },
    ] as const;
    const factualInputs = requests.map((request) => {
      const factualRunId = addressed('factual-reconciliation-run', `${request.custodyKey}-run`);
      return {
        ...request,
        factual: loaderFactualOutput(request.requestId, request.custodyKey, factualRunId),
        calculation: loaderCalculation(factualRunId, request.custodyKey),
      };
    });
    const factual = factualInputs[0]!.factual;
    const calculation = factualInputs[0]!.calculation;
    const seed = await adminPool.connect();
    try {
      await seed.query('BEGIN');
      await seed.query(`SET LOCAL search_path TO "${schemaName}"`);
      await seed.query('SET LOCAL session_replication_role = replica');
      for (const [index, input] of factualInputs.entries()) {
        await seed.query(
          `INSERT INTO outcome_private_valuation_dispatch_request
            (request_id,scope_key,trigger_kind,scheduled_for,authority_key,status,available_at,
             request_json,claim_sequence)
           VALUES ($1,'afl-men:2026-trades',$2,$3,$4,'pending',$3,
             '{}'::jsonb,0)`,
          [
            input.requestId,
            input.trigger,
            `2026-08-24T00:00:0${index}.000Z`,
            `${input.trigger}-exact-loader`,
          ]
        );
        await seed.query(
          `INSERT INTO outcome_private_valuation_factual_output
            (output_id,request_id,capture_binding_id,source_admission_id,normalization_run_id,
             fact_batch_id,factual_run_id,candidate_id,factual_release_id,prepared_at,output_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
          [
            input.factual.outputId,
            input.requestId,
            input.factual.content.captureBindingId,
            input.factual.content.sourceAdmissionId,
            input.factual.content.normalizationRunId,
            input.factual.content.factBatch.batchId,
            input.factual.content.reconciliation.factualRunId,
            input.factual.content.candidate.candidateId,
            input.factual.content.factualRelease.releaseId,
            input.factual.content.preparedAt,
            canonicalizeAflTradeJson(input.factual),
          ]
        );
      }
      await seed.query(
        `INSERT INTO outcome_hpn_pav_method
          (method_id,method_sha256,environment,source_artifact_id,captured_at,registered_at,
           method_canonical_json,method_json)
         VALUES ($1,$2,'non_production',$3,$4,$4,'{}','{}'::jsonb)
         ON CONFLICT (method_id) DO NOTHING`,
        [
          calculation.content.methodId,
          calculation.content.methodId.slice('hpn-pav-method:'.length),
          addressed('artifact', 'exact-loader-method'),
          '2026-08-24T00:00:00.000Z',
        ]
      );
      await seed.query(
        `INSERT INTO outcome_hpn_pav_method
          (method_id,method_sha256,environment,source_artifact_id,captured_at,registered_at,
           method_canonical_json,method_json)
         VALUES ($1,$2,'non_production',$3,$4,$4,'{}','{}'::jsonb)
         ON CONFLICT (method_id) DO NOTHING`,
        [
          addressed('hpn-pav-method', 'method'),
          digest('method'),
          addressed('artifact', 'forged-exact-loader-method'),
          '2026-08-24T00:00:00.000Z',
        ]
      );
      for (const input of factualInputs) {
        await seed.query(
          `INSERT INTO outcome_hpn_pav_calculation
            (calculation_id,calculation_sha256,schema_version,input_set_id,method_id,
             environment,competition,season_year,effective_through,calculated_at,value_unit,
             status,team_count,player_count,calculation_canonical_json,calculation_json,finalized_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'finalized',$12,$13,$14,$15::jsonb,$10)`,
          [
            input.calculation.calculationId,
            input.calculation.calculationId.slice('hpn-pav-season:'.length),
            input.calculation.content.schemaVersion,
            input.calculation.content.inputSetId,
            input.calculation.content.methodId,
            input.calculation.content.environment,
            input.calculation.content.competition,
            input.calculation.content.seasonYear,
            input.calculation.content.effectiveThrough,
            input.calculation.content.calculatedAt,
            input.calculation.content.valueUnit,
            input.calculation.content.teams.length,
            input.calculation.content.players.length,
            canonicalizeAflTradeJson(input.calculation.content),
            canonicalizeAflTradeJson(input.calculation),
          ]
        );
      }
      await seed.query('COMMIT');
    } catch (error) {
      await seed.query('ROLLBACK');
      throw error;
    } finally {
      seed.release();
    }

    const client = createPgAflOutcomeSqlClient(outcomesPool);
    const prepared = {
      state: 'prepared' as const,
      requestId,
      factualOutputId: factual.outputId,
      inputSetId: calculation.content.inputSetId,
      calculationId: calculation.calculationId,
      captureBindingIds: [factual.content.captureBindingId],
      sourceAdmissionIds: [factual.content.sourceAdmissionId],
      publicationEligible: false as const,
    };
    const targets = modelPairTargets;
    const exact = await loadAflTradePrivateValuationModelPairExactInput({
      client,
      prepared,
      targets,
    });
    expect(exact).toMatchObject({
      requestId,
      scopeKey: 'afl-men:2026-trades',
      factualOutputId: factual.outputId,
      hpnCalculationId: calculation.calculationId,
      substantive: {
        factualValuesSha256: factual.content.candidate.memberSetSha256,
        hpnMethodId: calculation.content.methodId,
        player: targets.player,
        pick: targets.pick,
        qualificationPolicyId: targets.qualificationPolicyId,
      },
    });
    expect(exact.substantive.hpnValuesSha256).toBe(
      '7346d98d175cac145dd32bf9a6040ad0c952191219760793bb6d1db36e09de5a'
    );
    const leaseToken = digest('exact-loader-lease-token');
    const claimed = await outcomesPool.query<{ claim_id: string }>(
      `SELECT claim_id FROM claim_outcome_private_valuation_dispatch($1,$2,120,$3)`,
      ['exact-loader-worker', digest(leaseToken), requestId]
    );
    const claimId = claimed.rows[0]?.claim_id;
    if (claimId === undefined) throw new Error('Exact-loader dispatch was not claimed.');
    const pairRepository = new PostgresAflTradePrivateValuationModelPairRepository(client);
    await expect(
      pairRepository.bindInput({
        exactInput: { ...exact, scopeKey: 'afl-men:2025-trades' },
        claim: { claimId, leaseToken },
      })
    ).rejects.toThrow('exact live dispatch custody');
    await expect(
      pairRepository.bindInput({
        exactInput: {
          ...exact,
          substantive: {
            ...exact.substantive,
            factualValuesSha256: digest('forged-factual-values'),
          },
        },
        claim: { claimId, leaseToken },
      })
    ).rejects.toThrow('exact live dispatch custody');
    await expect(
      pairRepository.bindInput({
        exactInput: {
          ...exact,
          substantive: {
            ...exact.substantive,
            hpnValuesSha256: digest('forged-hpn-values'),
          },
        },
        claim: { claimId, leaseToken },
      })
    ).rejects.toThrow('exact live dispatch custody');
    await expect(
      pairRepository.bindInput({
        exactInput: {
          ...exact,
          substantive: {
            ...exact.substantive,
            hpnMethodId: addressed('hpn-pav-method', 'method'),
          },
        },
        claim: { claimId, leaseToken },
      })
    ).rejects.toThrow('exact live dispatch custody');
    await expect(
      loadAflTradePrivateValuationModelPairExactInput({
        client,
        prepared: {
          ...prepared,
          factualOutputId: addressed(
            'private-valuation-factual-output',
            'missing-exact-loader-output'
          ),
        },
        targets,
      })
    ).rejects.toThrow('Exact private factual and HPN model input is unavailable.');

    const firstBinding = await pairRepository.bindInput({
      exactInput: exact,
      claim: { claimId, leaseToken },
    });
    await outcomesPool.query(
      `SELECT reschedule_outcome_private_valuation_dispatch($1,$2,'retry_pending')`,
      [claimId, digest(leaseToken)]
    );
    const operationIds = [firstBinding.operation.operationId];
    for (const input of factualInputs.slice(1)) {
      const nextLeaseToken = digest(`${input.custodyKey}-lease-token`);
      const nextClaim = await outcomesPool.query<{ claim_id: string }>(
        `SELECT claim_id FROM claim_outcome_private_valuation_dispatch($1,$2,120,$3)`,
        [`${input.custodyKey}-worker`, digest(nextLeaseToken), input.requestId]
      );
      const nextClaimId = nextClaim.rows[0]?.claim_id;
      if (nextClaimId === undefined) throw new Error(`${input.trigger} dispatch was not claimed.`);
      const nextPrepared = {
        ...prepared,
        requestId: input.requestId,
        factualOutputId: input.factual.outputId,
        inputSetId: input.calculation.content.inputSetId,
        calculationId: input.calculation.calculationId,
        captureBindingIds: [input.factual.content.captureBindingId],
        sourceAdmissionIds: [input.factual.content.sourceAdmissionId],
      };
      const nextExact = await loadAflTradePrivateValuationModelPairExactInput({
        client,
        prepared: nextPrepared,
        targets,
      });
      const nextBinding = await pairRepository.bindInput({
        exactInput: nextExact,
        claim: { claimId: nextClaimId, leaseToken: nextLeaseToken },
      });
      operationIds.push(nextBinding.operation.operationId);
      await outcomesPool.query(
        `SELECT reschedule_outcome_private_valuation_dispatch($1,$2,'retry_pending')`,
        [nextClaimId, digest(nextLeaseToken)]
      );
    }
    expect(new Set(operationIds)).toEqual(new Set([firstBinding.operation.operationId]));
    expect(new Set(factualInputs.map((input) => input.calculation.calculationId)).size).toBe(3);
    await expect(
      outcomesPool.query(
        `SELECT
           (SELECT count(*)::int FROM outcome_private_valuation_model_operation
             WHERE operation_id=$1) AS operation_count,
           (SELECT count(*)::int FROM outcome_private_valuation_model_request_binding
             WHERE operation_id=$1 AND request_id=ANY($2::text[])) AS binding_count,
           (SELECT array_agg(request.trigger_kind ORDER BY request.trigger_kind)
              FROM outcome_private_valuation_model_request_binding binding
              JOIN outcome_private_valuation_dispatch_request request
                ON request.request_id=binding.request_id
             WHERE binding.operation_id=$1 AND binding.request_id=ANY($2::text[])) AS trigger_kinds,
           (SELECT pair_accepted_at IS NOT NULL
              FROM outcome_private_valuation_model_operation
             WHERE operation_id=$1) AS pair_accepted,
           (SELECT qualification_outcome
              FROM outcome_private_valuation_model_operation
             WHERE operation_id=$1) AS qualification_outcome`,
        [firstBinding.operation.operationId, factualInputs.map((input) => input.requestId)]
      )
    ).resolves.toMatchObject({
      rows: [
        {
          operation_count: 1,
          binding_count: 3,
          trigger_kinds: ['ad_hoc', 'model_qualified', 'weekly'],
          pair_accepted: true,
          qualification_outcome: 'qualified',
        },
      ],
    });
  });
});
