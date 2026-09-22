import type { Pool } from 'pg';
import type { AflTradeArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import type { AflTradeImmutableArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { aflTradeModelRunManifestV3Schema } from '@/server/aflTradeIntelligence/artifacts/modelRunManifest';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { aflTradePlayerValidationReportSchema } from '@/server/aflTradeIntelligence/modeling/playerContributionValidation';
import { createGovernedValuationComponentRunManifest } from '@/server/aflTradeIntelligence/valuation/internal/governedValuationComponentRunManifest';
import { PostgresGovernedValuationComponentRunRepository } from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedValuationComponentRunRepository';
import { createGovernedPickPavModelExecutionFixture } from './governedPickPavModelExecutionFixture';

// Synthetic native custody for downstream qualification tests, not genuine admission/execution.
export async function seedGovernedQualificationComponentRuns(input: {
  pool: Pool;
  artifacts: AflTradeImmutableArtifactRepository;
  retain: (document: unknown, createdAt?: string) => Promise<AflTradeArtifactRef>;
  retainedAt: string;
  variant?: string;
}) {
  const { pool, artifacts, retain, retainedAt, variant = '' } = input;
  // An optional variant produces a second, distinct player run so a test can register a newer
  // qualified pair. The default keeps every seed byte-identical, so existing callers are unaffected.
  // Only the player side varies: a pair is new if either run is new, and the dispatch fence in 0079
  // keys on the run pair rather than on the model version.
  const variantSeed = (value: string) => (variant === '' ? value : `${value}-${variant}`);
  const repository = new PostgresGovernedValuationComponentRunRepository({
    client: createPgAflOutcomeSqlClient(pool),
    artifactRepository: artifacts,
    maximumArtifactBytes: 1024 * 1024,
  });
  const playerDatasetId = createAflTradeContentAddress('dataset', variantSeed('player-dataset'));
  const playerDatasetAdmissionId = createAflTradeContentAddress(
    'dataset-admission',
    variantSeed('player-dataset-admission')
  );
  const playerProtocolId = createAflTradeContentAddress(
    'model-protocol',
    variantSeed('player-protocol')
  );
  const playerValidationContent = {
    schemaVersion: 'afl-trade-player-validation-report/v1' as const,
    publicIdentityBoundary: 'source_native_no_fantasy_ownership' as const,
    observationSetId: createAflTradeContentAddress(
      'player-observation-set',
      variantSeed('player-observations')
    ),
    baselineFitId: createAflTradeContentAddress(
      'player-baseline-fit',
      variantSeed('player-baseline')
    ),
    predictionSetId: createAflTradeContentAddress(
      'player-prediction-set',
      variantSeed('player-predictions')
    ),
    valueUnitId: 'player-contribution-above-replacement',
    evaluatedPartition: 'final_test' as const,
    candidateModelId: variantSeed('player-contribution-v1'),
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
  const playerValidationReportArtifact = await retain(
    playerValidationReport,
    '2026-08-21T07:45:00.000Z'
  );
  const playerRunContent = {
    schemaVersion: 'afl-trade-model-run/v3' as const,
    environment: 'non_production' as const,
    modelId: variantSeed('player-contribution-v1'),
    modelVersion: '1.0.0',
    datasetId: playerDatasetId,
    datasetAdmissionId: playerDatasetAdmissionId,
    modelProtocolId: playerProtocolId,
    runIntentId: createAflTradeContentAddress('model-run-intent', variantSeed('player-intent')),
    runAuthorizationId: createAflTradeContentAddress(
      'model-run-authorization',
      variantSeed('player-authorization')
    ),
    observationSetId: playerValidationContent.observationSetId,
    modelTrainingEvaluationReceiptIds: [
      createAflTradeContentAddress('gate0a-evaluation', variantSeed('player-evaluation')),
    ],
    codeCommitSha: 'a'.repeat(40),
    cleanWorktree: true as const,
    seed: 1,
    job: {
      jobId: variantSeed('player-model-job'),
      attempt: 1,
      initiatedBy: 'statly-model-qualification-agent',
      workerIdentity: 'statly-model-worker',
    },
    startedAt: '2026-08-21T07:00:00.000Z',
    candidateLockedAt: '2026-08-21T07:30:00.000Z',
    finalTestEvaluatedAt: '2026-08-21T07:40:00.000Z',
    finishedAt: '2026-08-21T07:50:00.000Z',
    windows: {
      train: { from: '2010-01-01T00:00:00.000Z', to: '2014-01-01T00:00:00.000Z' },
      calibration: { from: '2014-01-01T00:00:00.000Z', to: '2018-01-01T00:00:00.000Z' },
      validation: { from: '2018-01-01T00:00:00.000Z', to: '2022-01-01T00:00:00.000Z' },
      finalTest: { from: '2022-01-01T00:00:00.000Z', to: '2026-01-01T00:00:00.000Z' },
      embargoDays: 0,
    },
    sourceCodeArtifact: await retain({ kind: 'player-source-code' }),
    dependencyLockArtifact: await retain({ kind: 'player-dependency-lock' }),
    runtimeArtifact: await retain({ kind: 'player-runtime' }),
    containerArtifact: await retain({ kind: 'player-container' }),
    configurationArtifact: await retain({ kind: 'player-configuration' }),
    environmentArtifact: await retain({ kind: 'player-environment' }),
    featureDefinitionArtifacts: [await retain({ kind: 'player-features' })],
    outcome: {
      status: 'succeeded' as const,
      modelArtifact: await retain({ kind: 'player-model' }),
      validationReportArtifact: playerValidationReportArtifact,
      baselineComparisonArtifact: await retain({ kind: 'player-baseline-comparison' }),
      calibrationReportArtifact: await retain({ kind: 'player-calibration-report' }),
      intervalCoverageArtifact: await retain({ kind: 'player-interval-coverage' }),
      subgroupReportArtifact: await retain({ kind: 'player-subgroup-report' }),
      sensitivityReportArtifact: await retain({ kind: 'player-sensitivity-report' }),
      leakageAuditArtifact: await retain({ kind: 'player-leakage-audit' }),
      modelCardArtifact: await retain({ kind: 'player-model-card' }),
      diagnosticsArtifact: await retain({ kind: 'player-diagnostics' }),
    },
  };
  const playerNativeExecution = aflTradeModelRunManifestV3Schema.parse({
    runId: createAflTradeContentAddress('model-run', playerRunContent),
    content: playerRunContent,
  });
  const playerNativeExecutionArtifact = await retain(playerNativeExecution);
  const pickFixture = createGovernedPickPavModelExecutionFixture();
  const pickExecution = pickFixture.execution;
  const pickNativeExecutionArtifact = await retain(pickExecution);
  const pickAuthorityArtifacts = [
    pickExecution.content.datasetArtifact,
    pickExecution.content.datasetAdmissionArtifact,
    pickExecution.content.protocolArtifact,
  ] as const;
  for (const [index, document] of pickFixture.authorityDocuments.entries()) {
    const reference = pickAuthorityArtifacts[index];
    if (reference === undefined) throw new Error('Pick fixture authority is incomplete.');
    await retain(document, reference.createdAt);
  }
  const seed = await pool.connect();
  await seed.query('BEGIN');
  try {
    await seed.query(`SET LOCAL session_replication_role='replica'`);
    await seed.query(
      `INSERT INTO outcome_valuation_model_run
        (run_id,intent_id,authorization_id,status,started_at,finished_at,
         run_canonical_json,run_json)
       VALUES ($1,$2,$3,'succeeded',$4,$5,$6,$7::jsonb)`,
      [
        playerNativeExecution.runId,
        playerRunContent.runIntentId,
        playerRunContent.runAuthorizationId,
        playerRunContent.startedAt,
        playerRunContent.finishedAt,
        canonicalizeAflTradeJson(playerRunContent),
        canonicalizeAflTradeJson(playerNativeExecution),
      ]
    );
    const pickContent = pickExecution.content;
    await seed.query(
      `INSERT INTO outcome_governed_pick_pav_model_execution
        (execution_id,observation_set_id,dataset_id,dataset_artifact_id,
         dataset_admission_id,dataset_admission_artifact_id,
         dataset_admission_gate_ledger_revision,protocol_id,protocol_artifact_id,
         execution_artifact_id,final_test_evaluation_started_at,completed_at,
         content_sha256,content_canonical_json,execution_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
       ON CONFLICT (execution_id) DO NOTHING`,
      [
        pickExecution.executionId,
        pickContent.observationSetId,
        pickContent.datasetId,
        pickContent.datasetArtifact.artifactId,
        pickContent.datasetAdmissionId,
        pickContent.datasetAdmissionArtifact.artifactId,
        pickContent.datasetAdmissionGateLedgerRevision,
        pickContent.protocolId,
        pickContent.protocolArtifact.artifactId,
        pickNativeExecutionArtifact.artifactId,
        pickContent.finalTestEvaluationStartedAt,
        pickContent.completedAt,
        pickExecution.executionId.slice('pick-pav-model-execution:'.length),
        canonicalizeAflTradeJson(pickContent),
        canonicalizeAflTradeJson(pickExecution),
      ]
    );
    await seed.query('COMMIT');
  } catch (error) {
    await seed.query('ROLLBACK');
    throw error;
  } finally {
    seed.release();
  }
  const player = createGovernedValuationComponentRunManifest({
    environment: 'non_production',
    role: 'player_contribution_and_availability',
    nativeExecution: {
      kind: 'admitted_player_model_run',
      executionId: playerNativeExecution.runId,
      artifact: playerNativeExecutionArtifact,
    },
    protocolId: playerProtocolId,
    protocolArtifact: await retain({ kind: 'player-protocol' }),
    datasetId: playerDatasetId,
    datasetArtifact: await retain({ kind: 'player-dataset' }),
    datasetAdmissionId: playerDatasetAdmissionId,
    datasetAdmissionArtifact: await retain({ kind: 'player-dataset-admission' }),
    datasetAdmissionGateLedgerRevision: 1,
    registeredAt: retainedAt,
  });
  const pick = createGovernedValuationComponentRunManifest({
    environment: 'non_production',
    role: 'draft_pick_and_future_pick_distribution',
    nativeExecution: {
      kind: 'governed_pick_pav_model_execution',
      executionId: pickExecution.executionId,
      artifact: pickNativeExecutionArtifact,
    },
    protocolId: pickExecution.content.protocolId,
    protocolArtifact: pickExecution.content.protocolArtifact,
    datasetId: pickExecution.content.datasetId,
    datasetArtifact: pickExecution.content.datasetArtifact,
    datasetAdmissionId: pickExecution.content.datasetAdmissionId,
    datasetAdmissionArtifact: pickExecution.content.datasetAdmissionArtifact,
    datasetAdmissionGateLedgerRevision: pickExecution.content.datasetAdmissionGateLedgerRevision,
    registeredAt: retainedAt,
  });
  const playerArtifact = await retain(player);
  const pickArtifact = await retain(pick);
  await repository.register({ manifest: player, artifact: playerArtifact });
  await repository.register({ manifest: pick, artifact: pickArtifact });
  return {
    player,
    playerArtifact,
    playerNativeExecution,
    playerValidationReport,
    pick,
    pickArtifact,
    pickNativeExecution: pickExecution,
    pickValidationReport: pickExecution.content.validationReport,
  };
}
