import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { aflTradeModelRunManifestV3Schema } from '@/server/aflTradeIntelligence/artifacts/modelRunManifest';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  createGovernedValuationModelQualification,
  createGovernedValuationModelQualificationGateRecords,
  createGovernedValuationModelQualificationPolicy,
  deriveGovernedPickModelQualificationEvidence,
  deriveGovernedPlayerModelQualificationEvidence,
} from '@/server/aflTradeIntelligence/valuation/internal/governedValuationModelQualification';
import { aflTradePlayerValidationReportSchema } from '@/server/aflTradeIntelligence/modeling/playerContributionValidation';
import { createGovernedValuationComponentRunManifest } from '@/server/aflTradeIntelligence/valuation/internal/governedValuationComponentRunManifest';
import { loadGovernedNativeComponentValidationReport } from '@/server/aflTradeIntelligence/valuation/internal/governedNativeComponentExecution';
import { PostgresGovernedValuationComponentRunRepository } from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedValuationComponentRunRepository';
import {
  GovernedValuationModelQualificationRepositoryError,
  PostgresGovernedValuationModelQualificationRepository,
} from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedValuationModelQualificationRepository';

import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';
import { createGovernedPickPavModelExecutionFixture } from '../testUtils/governedPickPavModelExecutionFixture';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
  })();
const schemaName = `afl_governed_model_qualification_${process.pid}_${Date.now()}`;
const adminPool = new Pool({ connectionString: databaseUrl });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
});
const artifacts = createAflTradeFixtureArtifactRepository({ artifactClass: 'derived_private' });
const retainedAt = '2026-08-21T08:00:00.000Z';
const evaluatedAt = '2026-08-21T09:00:00.000Z';
const authorityAt = '2026-08-21T09:05:00.000Z';

function scopedDatabaseUrl(targetSchema: string) {
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', targetSchema);
  return scoped.toString();
}

async function retain(document: unknown, createdAt = retainedAt) {
  const reference = createAflTradeCanonicalJsonArtifactRef(document, createdAt);
  const bytes = new TextEncoder().encode(canonicalizeAflTradeJson(document));
  await artifacts.putIfAbsent(reference, bytes);
  await pool.query(
    `INSERT INTO outcome_artifact_custody
      (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
       environment,custody_profile_id,created_at,verified_at,custody_json)
     VALUES ($1,$2,$3,$4,$5,'derived_private','non_production',NULL,$6,$6,$7::jsonb)
     ON CONFLICT (artifact_id) DO NOTHING`,
    [
      reference.artifactId,
      reference.contentSha256,
      reference.storageUri,
      reference.mediaType,
      reference.byteLength,
      reference.createdAt,
      canonicalizeAflTradeJson({ assurance: 'disposable_model_qualification_test' }),
    ]
  );
  return reference;
}

async function retainWithMetadata(
  document: unknown,
  overrides: Partial<Pick<Awaited<ReturnType<typeof retain>>, 'mediaType' | 'createdAt'>>
) {
  const canonicalReference = createAflTradeCanonicalJsonArtifactRef(
    document,
    overrides.createdAt ?? retainedAt
  );
  const reference = { ...canonicalReference, ...overrides };
  await pool.query(
    `INSERT INTO outcome_artifact_custody
      (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
       environment,custody_profile_id,created_at,verified_at,custody_json)
     VALUES ($1,$2,$3,$4,$5,'derived_private','non_production',NULL,$6,$6,$7::jsonb)`,
    [
      reference.artifactId,
      reference.contentSha256,
      reference.storageUri,
      reference.mediaType,
      reference.byteLength,
      reference.createdAt,
      canonicalizeAflTradeJson({ assurance: 'disposable_metadata_mismatch_test' }),
    ]
  );
  return reference;
}

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], {
    databaseUrl: scopedDatabaseUrl(schemaName),
  });
});

afterAll(async () => {
  await pool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await adminPool.end();
});

async function componentRuns() {
  const repository = new PostgresGovernedValuationComponentRunRepository({
    client: createPgAflOutcomeSqlClient(pool),
    artifactRepository: artifacts,
    maximumArtifactBytes: 1024 * 1024,
  });
  const playerDatasetId = createAflTradeContentAddress('dataset', 'player-dataset');
  const playerDatasetAdmissionId = createAflTradeContentAddress(
    'dataset-admission',
    'player-dataset-admission'
  );
  const playerProtocolId = createAflTradeContentAddress('model-protocol', 'player-protocol');
  const playerValidationContent = {
    schemaVersion: 'afl-trade-player-validation-report/v1' as const,
    publicIdentityBoundary: 'source_native_no_fantasy_ownership' as const,
    observationSetId: createAflTradeContentAddress('player-observation-set', 'player-observations'),
    baselineFitId: createAflTradeContentAddress('player-baseline-fit', 'player-baseline'),
    predictionSetId: createAflTradeContentAddress('player-prediction-set', 'player-predictions'),
    valueUnitId: 'player-contribution-above-replacement',
    evaluatedPartition: 'final_test' as const,
    candidateModelId: 'player-contribution-v1',
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
    modelId: 'player-contribution-v1',
    modelVersion: '1.0.0',
    datasetId: playerDatasetId,
    datasetAdmissionId: playerDatasetAdmissionId,
    modelProtocolId: playerProtocolId,
    runIntentId: createAflTradeContentAddress('model-run-intent', 'player-intent'),
    runAuthorizationId: createAflTradeContentAddress(
      'model-run-authorization',
      'player-authorization'
    ),
    observationSetId: playerValidationContent.observationSetId,
    modelTrainingEvaluationReceiptIds: [
      createAflTradeContentAddress('gate0a-evaluation', 'player-evaluation'),
    ],
    codeCommitSha: 'a'.repeat(40),
    cleanWorktree: true as const,
    seed: 1,
    job: {
      jobId: 'player-model-job',
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
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)`,
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

async function qualificationFixture(
  runs: Awaited<ReturnType<typeof componentRuns>>,
  suffix: string,
  passing: boolean
) {
  const policy = createGovernedValuationModelQualificationPolicy({
    player: {
      schemaVersion: 'governed-player-model-qualification-criteria/v1' as const,
      minimumComparableObservations: suffix === 'premature' ? 99 : 100,
      minimumRelativeMaeImprovement: suffix === 'v2' ? 0.04 : passing ? 0.05 : 0.1,
      minimumRelativeRmseImprovement: 0.05,
      requiredAcceptanceOutcome: 'meets_declared_predictive_thresholds' as const,
    },
    pick: {
      schemaVersion: 'governed-pick-model-qualification-criteria/v1' as const,
      evaluatedScope: 'final_test' as const,
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
  const playerEvidence = deriveGovernedPlayerModelQualificationEvidence(
    runs.playerValidationReport
  );
  const pickEvidence = deriveGovernedPickModelQualificationEvidence(runs.pickValidationReport);
  const qualification = createGovernedValuationModelQualification({
    environment: 'non_production',
    scopeKey: 'afl-men:2026-trades',
    evaluatedAt,
    policy,
    policyArtifact: await retain(policy, evaluatedAt),
    components: {
      player: {
        role: runs.player.content.role,
        runId: runs.player.runId,
        runArtifact: runs.playerArtifact,
        protocolId: runs.player.content.protocolId,
        protocolArtifact: runs.player.content.protocolArtifact,
        criteriaArtifact: await retain(policy.player, evaluatedAt),
        validationEvidence: playerEvidence,
        validationEvidenceArtifact: await retain(playerEvidence, evaluatedAt),
      },
      pick: {
        role: runs.pick.content.role,
        runId: runs.pick.runId,
        runArtifact: runs.pickArtifact,
        protocolId: runs.pick.content.protocolId,
        protocolArtifact: runs.pick.content.protocolArtifact,
        criteriaArtifact: await retain(policy.pick, evaluatedAt),
        validationEvidence: pickEvidence,
        validationEvidenceArtifact: await retain(pickEvidence, evaluatedAt),
      },
    },
  });
  const qualificationArtifact = await retain(qualification, evaluatedAt);
  return { qualification, qualificationArtifact };
}

async function insertQualificationDirectly(
  qualification: Awaited<ReturnType<typeof qualificationFixture>>['qualification'],
  artifactId: string,
  client: Pool | PoolClient = pool
) {
  const content = qualification.content;
  return client.query(
    `INSERT INTO outcome_governed_valuation_model_qualification
      (qualification_id,scope_key,outcome,artifact_id,player_run_id,pick_run_id,
       policy_artifact_id,player_criteria_artifact_id,pick_criteria_artifact_id,
       player_evidence_artifact_id,pick_evidence_artifact_id,evaluated_at,content_sha256,
       content_canonical_json,qualification_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)`,
    [
      qualification.qualificationId,
      content.scopeKey,
      content.outcome,
      artifactId,
      content.player.runId,
      content.pick.runId,
      content.policyArtifact.artifactId,
      content.player.criteriaArtifact.artifactId,
      content.pick.criteriaArtifact.artifactId,
      content.player.validationEvidenceArtifact.artifactId,
      content.pick.validationEvidenceArtifact.artifactId,
      content.evaluatedAt,
      qualification.qualificationId.slice('model-qualification:'.length),
      canonicalizeAflTradeJson(content),
      canonicalizeAflTradeJson(qualification),
    ]
  );
}

async function insertComponentDirectly(
  manifest: ReturnType<typeof createGovernedValuationComponentRunManifest>,
  artifactId: string
) {
  const content = manifest.content;
  await pool.query(
    `INSERT INTO outcome_governed_valuation_component_run
      (run_id,role,native_execution_kind,native_execution_id,artifact_id,
       native_execution_artifact_id,protocol_id,protocol_artifact_id,dataset_id,
       dataset_artifact_id,dataset_admission_id,dataset_admission_artifact_id,
       dataset_admission_gate_ledger_revision,registered_at,content_sha256,
       content_canonical_json,manifest_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)`,
    [
      manifest.runId,
      content.role,
      content.nativeExecution.kind,
      content.nativeExecution.executionId,
      artifactId,
      content.nativeExecution.artifact.artifactId,
      content.protocolId,
      content.protocolArtifact.artifactId,
      content.datasetId,
      content.datasetArtifact.artifactId,
      content.datasetAdmissionId,
      content.datasetAdmissionArtifact.artifactId,
      content.datasetAdmissionGateLedgerRevision,
      content.registeredAt,
      manifest.runId.slice('model-run:'.length),
      canonicalizeAflTradeJson(content),
      canonicalizeAflTradeJson(manifest),
    ]
  );
}

async function insertPlayerNativeEvidenceDirectly(input: {
  runId: string;
  nativeExecutionArtifactId: string;
  execution: unknown;
  validationReport: Awaited<ReturnType<typeof componentRuns>>['playerValidationReport'];
  validationReportArtifactId: string;
}) {
  return pool.query(
    `INSERT INTO outcome_governed_component_validation_evidence
      (run_id,role,native_execution_artifact_id,validation_report_id,
       validation_report_artifact_id,native_execution_json,validation_report_json,recorded_at)
     VALUES ($1,'player_contribution_and_availability',$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
    [
      input.runId,
      input.nativeExecutionArtifactId,
      input.validationReport.validationReportId,
      input.validationReportArtifactId,
      canonicalizeAflTradeJson(input.execution),
      canonicalizeAflTradeJson(input.validationReport),
      evaluatedAt,
    ]
  );
}

async function insertPickNativeEvidenceDirectly(input: {
  runId: string;
  nativeExecutionArtifactId: string;
  execution: Awaited<ReturnType<typeof componentRuns>>['pickNativeExecution'];
}) {
  return pool.query(
    `INSERT INTO outcome_governed_component_validation_evidence
      (run_id,role,native_execution_artifact_id,validation_report_id,
       validation_report_artifact_id,native_execution_json,validation_report_json,recorded_at)
     VALUES ($1,'draft_pick_and_future_pick_distribution',$2,$3,NULL,$4::jsonb,$5::jsonb,$6)`,
    [
      input.runId,
      input.nativeExecutionArtifactId,
      input.execution.content.validationReport.validationReportId,
      canonicalizeAflTradeJson(input.execution),
      canonicalizeAflTradeJson(input.execution.content.validationReport),
      evaluatedAt,
    ]
  );
}

describe('governed model qualification PostgreSQL registry', () => {
  it('advances one passing pair atomically, replays it, and isolates failed or stale candidates', async () => {
    const runs = await componentRuns();
    const repository = new PostgresGovernedValuationModelQualificationRepository({
      client: createPgAflOutcomeSqlClient(pool),
      artifactRepository: artifacts,
      maximumArtifactBytes: 1024 * 1024,
    });
    const invalidPlayerComponent = async (input: {
      candidateModelId: string;
      reportCreatedAt: string;
    }) => {
      const validationContent = {
        ...runs.playerValidationReport.content,
        candidateModelId: input.candidateModelId,
        valueUnitId: `player-contribution-${input.reportCreatedAt}`,
      };
      const validationReport = aflTradePlayerValidationReportSchema.parse({
        validationReportId: createAflTradeContentAddress(
          'player-validation-report',
          validationContent
        ),
        content: validationContent,
      });
      const validationReportArtifact = await retain(validationReport, input.reportCreatedAt);
      const executionContent = {
        ...runs.playerNativeExecution.content,
        outcome: {
          ...runs.playerNativeExecution.content.outcome,
          validationReportArtifact,
        },
      };
      const execution = aflTradeModelRunManifestV3Schema.parse({
        runId: createAflTradeContentAddress('model-run', executionContent),
        content: executionContent,
      });
      const content = runs.player.content;
      return createGovernedValuationComponentRunManifest({
        environment: content.environment,
        role: content.role,
        nativeExecution: {
          kind: 'admitted_player_model_run',
          executionId: execution.runId,
          artifact: await retain(execution),
        },
        protocolId: content.protocolId,
        protocolArtifact: content.protocolArtifact,
        datasetId: content.datasetId,
        datasetArtifact: content.datasetArtifact,
        datasetAdmissionId: content.datasetAdmissionId,
        datasetAdmissionArtifact: content.datasetAdmissionArtifact,
        datasetAdmissionGateLedgerRevision: content.datasetAdmissionGateLedgerRevision,
        registeredAt: content.registeredAt,
      });
    };
    for (const component of [
      await invalidPlayerComponent({
        candidateModelId: 'another-player-model',
        reportCreatedAt: '2026-08-21T07:45:00.000Z',
      }),
      await invalidPlayerComponent({
        candidateModelId: runs.playerNativeExecution.content.modelId,
        reportCreatedAt: '2026-08-21T07:55:00.000Z',
      }),
    ]) {
      await expect(
        loadGovernedNativeComponentValidationReport({
          manifest: component,
          artifactRepository: artifacts,
          maximumArtifactBytes: 1024 * 1024,
        })
      ).rejects.toThrow(/ancestry|chronology/i);
    }
    const directPlayerEvidenceFixture = async (suffix: string) => {
      const content = {
        ...runs.playerNativeExecution.content,
        modelVersion: `1.0.${suffix}`,
        runIntentId: createAflTradeContentAddress('model-run-intent', `player-intent-${suffix}`),
        runAuthorizationId: createAflTradeContentAddress(
          'model-run-authorization',
          `player-authorization-${suffix}`
        ),
        job: {
          ...runs.playerNativeExecution.content.job,
          jobId: `player-model-job-${suffix}`,
        },
      };
      const execution = aflTradeModelRunManifestV3Schema.parse({
        runId: createAflTradeContentAddress('model-run', content),
        content,
      });
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
            execution.runId,
            content.runIntentId,
            content.runAuthorizationId,
            content.startedAt,
            content.finishedAt,
            canonicalizeAflTradeJson(content),
            canonicalizeAflTradeJson(execution),
          ]
        );
        await seed.query('COMMIT');
      } catch (error) {
        await seed.query('ROLLBACK');
        throw error;
      } finally {
        seed.release();
      }
      return execution;
    };
    const playerComponentAuthority = {
      environment: runs.player.content.environment,
      role: runs.player.content.role,
      protocolId: runs.player.content.protocolId,
      protocolArtifact: runs.player.content.protocolArtifact,
      datasetArtifact: runs.player.content.datasetArtifact,
      datasetAdmissionId: runs.player.content.datasetAdmissionId,
      datasetAdmissionArtifact: runs.player.content.datasetAdmissionArtifact,
      datasetAdmissionGateLedgerRevision: runs.player.content.datasetAdmissionGateLedgerRevision,
      registeredAt: runs.player.content.registeredAt,
    } as const;
    const sourceBoundExecution = await directPlayerEvidenceFixture('1');
    const forgedNativeExecution = {
      ...sourceBoundExecution,
      content: {
        ...sourceBoundExecution.content,
        datasetId: createAflTradeContentAddress('dataset', 'forged-native-player-dataset'),
      },
    };
    const forgedNativeArtifact = await retain(forgedNativeExecution);
    const forgedComponent = createGovernedValuationComponentRunManifest({
      ...playerComponentAuthority,
      nativeExecution: {
        kind: 'admitted_player_model_run',
        executionId: sourceBoundExecution.runId,
        artifact: forgedNativeArtifact,
      },
      datasetId: forgedNativeExecution.content.datasetId,
    });
    const forgedComponentArtifact = await retain(forgedComponent);
    await insertComponentDirectly(forgedComponent, forgedComponentArtifact.artifactId);
    await expect(
      insertPlayerNativeEvidenceDirectly({
        runId: forgedComponent.runId,
        nativeExecutionArtifactId: forgedNativeArtifact.artifactId,
        execution: forgedNativeExecution,
        validationReport: runs.playerValidationReport,
        validationReportArtifactId:
          runs.playerNativeExecution.content.outcome.validationReportArtifact.artifactId,
      })
    ).rejects.toThrow(/validation evidence/i);

    const custodyBoundExecution = await directPlayerEvidenceFixture('2');
    const custodyNativeArtifact = await retain(custodyBoundExecution);
    const custodyComponentBase = createGovernedValuationComponentRunManifest({
      ...playerComponentAuthority,
      nativeExecution: {
        kind: 'admitted_player_model_run',
        executionId: custodyBoundExecution.runId,
        artifact: custodyNativeArtifact,
      },
      datasetId: custodyBoundExecution.content.datasetId,
    });
    const custodyComponentContent = {
      ...custodyComponentBase.content,
      nativeExecution: {
        ...custodyComponentBase.content.nativeExecution,
        artifact: {
          ...custodyNativeArtifact,
          storageUri: `artifact://sha256/${'f'.repeat(64)}`,
        },
      },
    };
    const custodyComponent = {
      runId: createAflTradeContentAddress('model-run', custodyComponentContent),
      content: custodyComponentContent,
    } as typeof custodyComponentBase;
    const custodyComponentArtifact = await retain(custodyComponent);
    await expect(
      insertComponentDirectly(custodyComponent, custodyComponentArtifact.artifactId)
    ).rejects.toThrow(/component-run columns/i);

    const backdatedExecution = await directPlayerEvidenceFixture('4');
    const backdatedNativeArtifact = await retain(backdatedExecution);
    const backdatedComponentBase = createGovernedValuationComponentRunManifest({
      ...playerComponentAuthority,
      nativeExecution: {
        kind: 'admitted_player_model_run',
        executionId: backdatedExecution.runId,
        artifact: backdatedNativeArtifact,
      },
      datasetId: backdatedExecution.content.datasetId,
    });
    const backdatedComponentContent = {
      ...backdatedComponentBase.content,
      registeredAt: '2026-08-21T07:59:00.000Z',
    };
    const backdatedComponent = {
      runId: createAflTradeContentAddress('model-run', backdatedComponentContent),
      content: backdatedComponentContent,
    } as typeof backdatedComponentBase;
    const backdatedComponentArtifact = await retain(
      backdatedComponent,
      backdatedComponent.content.registeredAt
    );
    await expect(
      insertComponentDirectly(backdatedComponent, backdatedComponentArtifact.artifactId)
    ).rejects.toThrow(/component-run columns/i);

    const directPickEvidenceFixture = async (
      suffix: string,
      mutate: (
        content: typeof runs.pickValidationReport.content
      ) => typeof runs.pickValidationReport.content
    ) => {
      const reportContent = mutate(runs.pickValidationReport.content);
      const validationReport = {
        validationReportId: createAflTradeContentAddress(
          'pick-pav-validation-report',
          reportContent
        ),
        content: reportContent,
      } as typeof runs.pickValidationReport;
      const executionContent = {
        ...runs.pickNativeExecution.content,
        completedAt: `2026-08-21T08:0${suffix}:00.000Z`,
        validationConfig: reportContent.config,
        validationReport,
      };
      const execution = {
        executionId: createAflTradeContentAddress('pick-pav-model-execution', executionContent),
        content: executionContent,
      } as typeof runs.pickNativeExecution;
      const executionArtifact = await retain(execution, executionContent.completedAt);
      const seed = await pool.connect();
      await seed.query('BEGIN');
      try {
        await seed.query(`SET LOCAL session_replication_role='replica'`);
        await seed.query(
          `INSERT INTO outcome_governed_pick_pav_model_execution
            (execution_id,observation_set_id,dataset_id,dataset_artifact_id,
             dataset_admission_id,dataset_admission_artifact_id,
             dataset_admission_gate_ledger_revision,protocol_id,protocol_artifact_id,
             execution_artifact_id,final_test_evaluation_started_at,completed_at,
             content_sha256,content_canonical_json,execution_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)`,
          [
            execution.executionId,
            executionContent.observationSetId,
            executionContent.datasetId,
            executionContent.datasetArtifact.artifactId,
            executionContent.datasetAdmissionId,
            executionContent.datasetAdmissionArtifact.artifactId,
            executionContent.datasetAdmissionGateLedgerRevision,
            executionContent.protocolId,
            executionContent.protocolArtifact.artifactId,
            executionArtifact.artifactId,
            executionContent.finalTestEvaluationStartedAt,
            executionContent.completedAt,
            execution.executionId.slice('pick-pav-model-execution:'.length),
            canonicalizeAflTradeJson(executionContent),
            canonicalizeAflTradeJson(execution),
          ]
        );
        await seed.query('COMMIT');
      } catch (error) {
        await seed.query('ROLLBACK');
        throw error;
      } finally {
        seed.release();
      }
      const component = createGovernedValuationComponentRunManifest({
        environment: 'non_production',
        role: 'draft_pick_and_future_pick_distribution',
        nativeExecution: {
          kind: 'governed_pick_pav_model_execution',
          executionId: execution.executionId,
          artifact: executionArtifact,
        },
        protocolId: executionContent.protocolId,
        protocolArtifact: executionContent.protocolArtifact,
        datasetId: executionContent.datasetId,
        datasetArtifact: executionContent.datasetArtifact,
        datasetAdmissionId: executionContent.datasetAdmissionId,
        datasetAdmissionArtifact: executionContent.datasetAdmissionArtifact,
        datasetAdmissionGateLedgerRevision: executionContent.datasetAdmissionGateLedgerRevision,
        registeredAt: executionContent.completedAt,
      });
      const componentArtifact = await retain(component, component.content.registeredAt);
      await insertComponentDirectly(component, componentArtifact.artifactId);
      return { component, execution, executionArtifact };
    };
    const insufficientStatusPick = await directPickEvidenceFixture('1', (content) => ({
      ...content,
      config: {
        ...content.config,
        minimumEligibleObservations: content.inputObservationCount + 1,
      },
    }));
    await expect(
      insertPickNativeEvidenceDirectly({
        runId: insufficientStatusPick.component.runId,
        nativeExecutionArtifactId: insufficientStatusPick.executionArtifact.artifactId,
        execution: insufficientStatusPick.execution,
      })
    ).rejects.toThrow(/pick validation evidence/i);
    const mismatchedAncestryPick = await directPickEvidenceFixture('2', (content) => ({
      ...content,
      observationSetId: createAflTradeContentAddress(
        'pick-pav-observation-set',
        'mismatched-report-observation-set'
      ),
    }));
    await expect(
      insertPickNativeEvidenceDirectly({
        runId: mismatchedAncestryPick.component.runId,
        nativeExecutionArtifactId: mismatchedAncestryPick.executionArtifact.artifactId,
        execution: mismatchedAncestryPick.execution,
      })
    ).rejects.toThrow(/pick validation evidence/i);
    const publicationClaimPick = await directPickEvidenceFixture(
      '3',
      (content) =>
        ({
          ...content,
          publicationEligible: true,
        }) as unknown as typeof content
    );
    await expect(
      insertPickNativeEvidenceDirectly({
        runId: publicationClaimPick.component.runId,
        nativeExecutionArtifactId: publicationClaimPick.executionArtifact.artifactId,
        execution: publicationClaimPick.execution,
      })
    ).rejects.toThrow(/pick validation evidence/i);

    const passing = await qualificationFixture(runs, 'v1', true);
    const fabricatedPassingEvidence = {
      ...passing.qualification.content.player.validationEvidence,
      relativeMaeImprovement: 0.06,
    };
    const fabricatedPassingContent = {
      ...passing.qualification.content,
      player: {
        ...passing.qualification.content.player,
        validationEvidence: fabricatedPassingEvidence,
        validationEvidenceArtifact: await retain(fabricatedPassingEvidence, evaluatedAt),
      },
    };
    const fabricatedPassingQualification = {
      qualificationId: createAflTradeContentAddress(
        'model-qualification',
        fabricatedPassingContent
      ),
      content: fabricatedPassingContent,
    };
    const fabricatedPassingArtifact = await retain(fabricatedPassingQualification, evaluatedAt);
    const fabricatedPassingGates = createGovernedValuationModelQualificationGateRecords({
      qualification: fabricatedPassingQualification,
      qualificationArtifact: fabricatedPassingArtifact,
      decidedAt: authorityAt,
      automationPrincipal: 'statly-model-qualification-agent',
      accountableOwner: 'statly-model-owner',
      versions: { player: 1, pick: 1 },
      supersedes: { player: null, pick: null },
    });
    await expect(
      repository.register({
        qualification: fabricatedPassingQualification,
        qualificationArtifact: fabricatedPassingArtifact,
        expectedGateLedgerRevision: 0,
        expectedCurrentRevision: 0,
        gateRecords: fabricatedPassingGates,
      })
    ).rejects.toThrow(/native validation reports/i);
    const forgedEvidence = {
      ...passing.qualification.content.player.validationEvidence,
      relativeMaeImprovement: 0,
    };
    const forgedContent = {
      ...passing.qualification.content,
      player: {
        ...passing.qualification.content.player,
        validationEvidence: forgedEvidence,
        validationEvidenceArtifact: await retain(forgedEvidence, evaluatedAt),
      },
    };
    const forgedQualification = {
      qualificationId: createAflTradeContentAddress('model-qualification', forgedContent),
      content: forgedContent,
    };
    const forgedArtifact = await retain(forgedQualification, evaluatedAt);
    await expect(
      insertQualificationDirectly(forgedQualification, forgedArtifact.artifactId)
    ).rejects.toThrow(/ancestry|mismatch/i);
    const { multiclassBrierScore: _omittedBrierScore, ...incompletePickMetrics } =
      passing.qualification.content.pick.validationEvidence.metrics!;
    const incompletePickEvidence = {
      ...passing.qualification.content.pick.validationEvidence,
      metrics: incompletePickMetrics,
    };
    const incompletePickContent = {
      ...passing.qualification.content,
      pick: {
        ...passing.qualification.content.pick,
        validationEvidence: incompletePickEvidence,
        validationEvidenceArtifact: await retain(incompletePickEvidence, evaluatedAt),
      },
    };
    const incompletePickQualification = {
      qualificationId: createAflTradeContentAddress('model-qualification', incompletePickContent),
      content: incompletePickContent,
    } as unknown as typeof passing.qualification;
    const incompletePickArtifact = await retain(incompletePickQualification, evaluatedAt);
    await expect(
      insertQualificationDirectly(incompletePickQualification, incompletePickArtifact.artifactId)
    ).rejects.toThrow(/ancestry|mismatch/i);
    const wrongRoleContent = {
      ...passing.qualification.content,
      pick: {
        ...passing.qualification.content.pick,
        role: 'player_contribution_and_availability',
      },
    };
    const wrongRoleQualification = {
      qualificationId: createAflTradeContentAddress('model-qualification', wrongRoleContent),
      content: wrongRoleContent,
    } as unknown as typeof passing.qualification;
    const wrongRoleArtifact = await retain(wrongRoleQualification, evaluatedAt);
    await expect(
      insertQualificationDirectly(wrongRoleQualification, wrongRoleArtifact.artifactId)
    ).rejects.toThrow(/contract|mismatch/i);
    const stringBooleanContent = {
      ...passing.qualification.content,
      publicationEligible: 'false',
      player: { ...passing.qualification.content.player, passed: 'true' },
    };
    const stringBooleanQualification = {
      qualificationId: createAflTradeContentAddress('model-qualification', stringBooleanContent),
      content: stringBooleanContent,
    } as unknown as typeof passing.qualification;
    const stringBooleanArtifact = await retain(stringBooleanQualification, evaluatedAt);
    await expect(
      insertQualificationDirectly(stringBooleanQualification, stringBooleanArtifact.artifactId)
    ).rejects.toThrow(/contract|mismatch/i);
    const invalidScopeContent = {
      ...passing.qualification.content,
      scopeKey: 'invalid scope',
    };
    const invalidScopeQualification = {
      qualificationId: createAflTradeContentAddress('model-qualification', invalidScopeContent),
      content: invalidScopeContent,
    } as unknown as typeof passing.qualification;
    const invalidScopeArtifact = await retain(invalidScopeQualification, evaluatedAt);
    await expect(
      insertQualificationDirectly(invalidScopeQualification, invalidScopeArtifact.artifactId)
    ).rejects.toThrow(/contract|mismatch/i);
    const invalidReportEvidence = {
      ...passing.qualification.content.player.validationEvidence,
      validationReportId: 'not a report id',
    };
    const invalidReportContent = {
      ...passing.qualification.content,
      player: {
        ...passing.qualification.content.player,
        validationEvidence: invalidReportEvidence,
        validationEvidenceArtifact: await retain(invalidReportEvidence, evaluatedAt),
      },
    };
    const invalidReportQualification = {
      qualificationId: createAflTradeContentAddress('model-qualification', invalidReportContent),
      content: invalidReportContent,
    } as unknown as typeof passing.qualification;
    const invalidReportArtifact = await retain(invalidReportQualification, evaluatedAt);
    await expect(
      insertQualificationDirectly(invalidReportQualification, invalidReportArtifact.artifactId)
    ).rejects.toThrow(/contract|mismatch/i);
    const custodyMismatchContent = {
      ...passing.qualification.content,
      player: {
        ...passing.qualification.content.player,
        validationEvidenceArtifact: {
          ...passing.qualification.content.player.validationEvidenceArtifact,
          createdAt: '2026-08-20T00:00:00.000Z',
        },
      },
    };
    const custodyMismatchQualification = {
      qualificationId: createAflTradeContentAddress('model-qualification', custodyMismatchContent),
      content: custodyMismatchContent,
    } as unknown as typeof passing.qualification;
    const custodyMismatchArtifact = await retain(custodyMismatchQualification, evaluatedAt);
    await expect(
      insertQualificationDirectly(custodyMismatchQualification, custodyMismatchArtifact.artifactId)
    ).rejects.toThrow(/custody|mismatch/i);
    const wrongMediaEvidence = {
      ...passing.qualification.content.player.validationEvidence,
      comparableObservationCount: 121,
    };
    const wrongMediaContent = {
      ...passing.qualification.content,
      player: {
        ...passing.qualification.content.player,
        validationEvidence: wrongMediaEvidence,
        validationEvidenceArtifact: await retainWithMetadata(wrongMediaEvidence, {
          mediaType: 'text/plain',
          createdAt: evaluatedAt,
        }),
      },
    };
    const wrongMediaQualification = {
      qualificationId: createAflTradeContentAddress('model-qualification', wrongMediaContent),
      content: wrongMediaContent,
    } as unknown as typeof passing.qualification;
    const wrongMediaArtifact = await retain(wrongMediaQualification, evaluatedAt);
    await expect(
      insertQualificationDirectly(wrongMediaQualification, wrongMediaArtifact.artifactId)
    ).rejects.toThrow(/lineage|mismatch/i);
    const outerCustodyContent = {
      ...passing.qualification.content,
      scopeKey: 'afl-men:2026-outer-custody',
    };
    const outerCustodyQualification = {
      qualificationId: createAflTradeContentAddress('model-qualification', outerCustodyContent),
      content: outerCustodyContent,
    } as unknown as typeof passing.qualification;
    const outerCustodyArtifact = await retainWithMetadata(outerCustodyQualification, {
      mediaType: 'text/plain',
      createdAt: evaluatedAt,
    });
    await expect(
      insertQualificationDirectly(outerCustodyQualification, outerCustodyArtifact.artifactId)
    ).rejects.toThrow(/ancestry|mismatch/i);
    const conflictingPolicy = {
      ...passing.qualification.content.policy,
      player: {
        ...passing.qualification.content.policy.player,
        minimumComparableObservations: 101,
      },
    };
    const conflictingPolicyContent = {
      ...passing.qualification.content,
      policy: conflictingPolicy,
      policyArtifact: await retain(conflictingPolicy, evaluatedAt),
      player: {
        ...passing.qualification.content.player,
        criteriaArtifact: await retain(conflictingPolicy.player, evaluatedAt),
      },
    };
    const conflictingPolicyQualification = {
      qualificationId: createAflTradeContentAddress(
        'model-qualification',
        conflictingPolicyContent
      ),
      content: conflictingPolicyContent,
    };
    const conflictingPolicyArtifact = await retain(conflictingPolicyQualification, evaluatedAt);
    await expect(
      insertQualificationDirectly(
        conflictingPolicyQualification,
        conflictingPolicyArtifact.artifactId
      )
    ).rejects.toThrow(/ancestry|mismatch/i);
    const gates = createGovernedValuationModelQualificationGateRecords({
      ...passing,
      decidedAt: authorityAt,
      automationPrincipal: 'statly-model-qualification-agent',
      accountableOwner: 'statly-model-owner',
      versions: { player: 1, pick: 1 },
      supersedes: { player: null, pick: null },
    });
    const prematureProposalContent = {
      ...gates[0].proposal.content,
      proposedAt: '2026-08-21T08:59:00.000Z',
    };
    const prematureProposal = {
      proposalId: createAflTradeContentAddress('gate-proposal', prematureProposalContent),
      content: prematureProposalContent,
    };
    const prematureDecisionContent = {
      ...gates[0].decision.content,
      proposalId: prematureProposal.proposalId,
      decidedAt: '2026-08-21T08:59:00.000Z',
      effectiveAt: '2026-08-21T08:59:00.000Z',
    };
    const prematureGates = [
      {
        proposal: prematureProposal,
        decision: {
          decisionId: createAflTradeContentAddress('gate-decision', prematureDecisionContent),
          content: prematureDecisionContent,
        },
      },
      gates[1],
    ] as const;
    await expect(
      repository.register({
        ...passing,
        expectedGateLedgerRevision: 0,
        expectedCurrentRevision: 0,
        gateRecords: prematureGates,
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<GovernedValuationModelQualificationRepositoryError>>({
        code: 'INTEGRITY_MISMATCH',
      })
    );
    const bypassClient = await pool.connect();
    try {
      await bypassClient.query('BEGIN');
      await bypassClient.query(
        `INSERT INTO outcome_gate_proposal
          (proposal_id,gate,decision_key,version,environment,scope_key,proposed_at,proposal_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [
          gates[0].proposal.proposalId,
          gates[0].proposal.content.gate,
          gates[0].proposal.content.decisionKey,
          gates[0].proposal.content.version,
          gates[0].proposal.content.environment,
          gates[0].proposal.content.scope.scopeKey,
          gates[0].proposal.content.proposedAt,
          canonicalizeAflTradeJson(gates[0].proposal),
        ]
      );
      await expect(
        bypassClient.query(
          `INSERT INTO outcome_gate_decision
            (decision_id,proposal_id,gate,decision_key,version,environment,state,decided_at,
             effective_at,revalidate_at,supersedes_decision_id,decision_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
          [
            gates[0].decision.decisionId,
            gates[0].decision.content.proposalId,
            gates[0].decision.content.gate,
            gates[0].decision.content.decisionKey,
            gates[0].decision.content.version,
            gates[0].decision.content.environment,
            gates[0].decision.content.state,
            gates[0].decision.content.decidedAt,
            gates[0].decision.content.effectiveAt,
            gates[0].decision.content.revalidateAt,
            gates[0].decision.content.supersedesDecisionId,
            canonicalizeAflTradeJson(gates[0].decision),
          ]
        )
      ).rejects.toThrow(/qualification|no rows/i);
    } finally {
      await bypassClient.query('ROLLBACK');
      bypassClient.release();
    }

    const advanced = await repository.register({
      ...passing,
      expectedGateLedgerRevision: 0,
      expectedCurrentRevision: 0,
      gateRecords: gates,
    });
    expect(advanced).toMatchObject({
      status: 'advanced',
      idempotentReplay: false,
      current: { revision: 1, qualificationId: passing.qualification.qualificationId },
      work: {
        content: {
          status: 'pending',
          cause: 'current_qualified_model_pair_advanced',
          availableAt: authorityAt,
        },
      },
    });
    await expect(
      insertQualificationDirectly(
        fabricatedPassingQualification,
        fabricatedPassingArtifact.artifactId
      )
    ).rejects.toThrow(/native|validation|evidence/i);

    const prematureBase = await qualificationFixture(runs, 'premature', true);
    const directPrematureContent = {
      ...prematureBase.qualification.content,
      scopeKey: 'afl-men:2026-premature-trades',
    };
    const directPrematureQualification = {
      qualificationId: createAflTradeContentAddress('model-qualification', directPrematureContent),
      content: directPrematureContent,
    };
    const directPrematureArtifact = await retain(directPrematureQualification, evaluatedAt);
    const directGates = createGovernedValuationModelQualificationGateRecords({
      qualification: directPrematureQualification,
      qualificationArtifact: directPrematureArtifact,
      decidedAt: authorityAt,
      automationPrincipal: 'statly-model-qualification-agent',
      accountableOwner: 'statly-model-owner',
      versions: { player: 1, pick: 1 },
      supersedes: { player: null, pick: null },
    });
    const directPrematureProposalContent = {
      ...directGates[0].proposal.content,
      proposedAt: '2026-08-21T08:59:00.000Z',
    };
    const directPrematureProposal = {
      proposalId: createAflTradeContentAddress('gate-proposal', directPrematureProposalContent),
      content: directPrematureProposalContent,
    };
    const directPrematureDecisionContent = {
      ...directGates[0].decision.content,
      proposalId: directPrematureProposal.proposalId,
      decidedAt: '2026-08-21T08:59:00.000Z',
      effectiveAt: '2026-08-21T08:59:00.000Z',
    };
    const directPrematureClient = await pool.connect();
    try {
      await directPrematureClient.query('BEGIN');
      await insertQualificationDirectly(
        directPrematureQualification,
        directPrematureArtifact.artifactId,
        directPrematureClient
      );
      await directPrematureClient.query(
        `INSERT INTO outcome_gate_proposal
          (proposal_id,gate,decision_key,version,environment,scope_key,proposed_at,proposal_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [
          directPrematureProposal.proposalId,
          directPrematureProposal.content.gate,
          directPrematureProposal.content.decisionKey,
          directPrematureProposal.content.version,
          directPrematureProposal.content.environment,
          directPrematureProposal.content.scope.scopeKey,
          directPrematureProposal.content.proposedAt,
          canonicalizeAflTradeJson(directPrematureProposal),
        ]
      );
      await expect(
        directPrematureClient.query(
          `INSERT INTO outcome_gate_decision
            (decision_id,proposal_id,gate,decision_key,version,environment,state,decided_at,
             effective_at,revalidate_at,supersedes_decision_id,decision_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
          [
            createAflTradeContentAddress('gate-decision', directPrematureDecisionContent),
            directPrematureDecisionContent.proposalId,
            directPrematureDecisionContent.gate,
            directPrematureDecisionContent.decisionKey,
            directPrematureDecisionContent.version,
            directPrematureDecisionContent.environment,
            directPrematureDecisionContent.state,
            directPrematureDecisionContent.decidedAt,
            directPrematureDecisionContent.effectiveAt,
            directPrematureDecisionContent.revalidateAt,
            directPrematureDecisionContent.supersedesDecisionId,
            canonicalizeAflTradeJson({
              decisionId: createAflTradeContentAddress(
                'gate-decision',
                directPrematureDecisionContent
              ),
              content: directPrematureDecisionContent,
            }),
          ]
        )
      ).rejects.toThrow(/qualification|automated|chronolog/i);
    } finally {
      await directPrematureClient.query('ROLLBACK');
      directPrematureClient.release();
    }
    const unpairedGates = createGovernedValuationModelQualificationGateRecords({
      ...passing,
      decidedAt: '2026-08-21T09:06:00.000Z',
      automationPrincipal: 'statly-model-qualification-agent',
      accountableOwner: 'statly-model-owner',
      versions: { player: 2, pick: 2 },
      supersedes: {
        player: gates[0].decision.decisionId,
        pick: gates[1].decision.decisionId,
      },
    });
    const unpairedClient = await pool.connect();
    try {
      await unpairedClient.query('BEGIN');
      await unpairedClient.query(
        `INSERT INTO outcome_gate_proposal
          (proposal_id,gate,decision_key,version,environment,scope_key,proposed_at,proposal_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [
          unpairedGates[0].proposal.proposalId,
          unpairedGates[0].proposal.content.gate,
          unpairedGates[0].proposal.content.decisionKey,
          unpairedGates[0].proposal.content.version,
          unpairedGates[0].proposal.content.environment,
          unpairedGates[0].proposal.content.scope.scopeKey,
          unpairedGates[0].proposal.content.proposedAt,
          canonicalizeAflTradeJson(unpairedGates[0].proposal),
        ]
      );
      await expect(
        (async () => {
          await unpairedClient.query(
            `INSERT INTO outcome_gate_decision
              (decision_id,proposal_id,gate,decision_key,version,environment,state,decided_at,
               effective_at,revalidate_at,supersedes_decision_id,decision_json)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
            [
              unpairedGates[0].decision.decisionId,
              unpairedGates[0].decision.content.proposalId,
              unpairedGates[0].decision.content.gate,
              unpairedGates[0].decision.content.decisionKey,
              unpairedGates[0].decision.content.version,
              unpairedGates[0].decision.content.environment,
              unpairedGates[0].decision.content.state,
              unpairedGates[0].decision.content.decidedAt,
              unpairedGates[0].decision.content.effectiveAt,
              unpairedGates[0].decision.content.revalidateAt,
              unpairedGates[0].decision.content.supersedesDecisionId,
              canonicalizeAflTradeJson(unpairedGates[0].decision),
            ]
          );
          await unpairedClient.query('COMMIT');
        })()
      ).rejects.toThrow(/atomic|pair|unique|duplicate/i);
    } finally {
      await unpairedClient.query('ROLLBACK');
      unpairedClient.release();
    }
    await expect(
      repository.register({
        ...passing,
        expectedGateLedgerRevision: 0,
        expectedCurrentRevision: 0,
        gateRecords: gates,
      })
    ).resolves.toMatchObject({ status: 'advanced', idempotentReplay: true });
    await expect(
      pool.query(
        `UPDATE outcome_governed_model_qualification_work
            SET work_json=jsonb_set(work_json,'{content,cause}','"forged"'::jsonb)
          WHERE work_id=$1`,
        [advanced.work!.workId]
      )
    ).rejects.toThrow(/immutable/i);

    const failed = await qualificationFixture(runs, 'failed', false);
    await expect(
      repository.register({
        ...failed,
        expectedGateLedgerRevision: 2,
        expectedCurrentRevision: 1,
      })
    ).resolves.toMatchObject({
      status: 'failed_retained',
      current: { qualificationId: passing.qualification.qualificationId, revision: 1 },
    });

    const stale = await qualificationFixture(runs, 'v2', true);
    const staleGates = createGovernedValuationModelQualificationGateRecords({
      ...stale,
      decidedAt: '2026-08-21T09:10:00.000Z',
      automationPrincipal: 'statly-model-qualification-agent',
      accountableOwner: 'statly-model-owner',
      versions: { player: 2, pick: 2 },
      supersedes: {
        player: gates[0].decision.decisionId,
        pick: gates[1].decision.decisionId,
      },
    });
    const crossScopeProposalContent = {
      ...staleGates[0].proposal.content,
      scope: { ...staleGates[0].proposal.content.scope, scopeKey: 'afl-men:2025-trades' },
    };
    const crossScopeProposal = {
      proposalId: createAflTradeContentAddress('gate-proposal', crossScopeProposalContent),
      content: crossScopeProposalContent,
    };
    const crossScopeDecisionContent = {
      ...staleGates[0].decision.content,
      proposalId: crossScopeProposal.proposalId,
      scope: crossScopeProposalContent.scope,
    };
    const crossScopeGates = [
      {
        proposal: crossScopeProposal,
        decision: {
          decisionId: createAflTradeContentAddress('gate-decision', crossScopeDecisionContent),
          content: crossScopeDecisionContent,
        },
      },
      staleGates[1],
    ] as const;
    await expect(
      repository.register({
        ...stale,
        expectedGateLedgerRevision: 2,
        expectedCurrentRevision: 1,
        gateRecords: crossScopeGates,
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<GovernedValuationModelQualificationRepositoryError>>({
        code: 'INTEGRITY_MISMATCH',
      })
    );
    await expect(
      repository.register({
        ...stale,
        expectedGateLedgerRevision: 2,
        expectedCurrentRevision: 0,
        gateRecords: staleGates,
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<GovernedValuationModelQualificationRepositoryError>>({
        code: 'STALE_CURRENT_PAIR',
      })
    );
    expect(await repository.loadCurrent('afl-men:2026-trades')).toMatchObject({
      revision: 1,
      qualificationId: passing.qualification.qualificationId,
    });
    const rolledBack = await pool.query(
      `SELECT 1 FROM outcome_governed_valuation_model_qualification WHERE qualification_id=$1`,
      [stale.qualification.qualificationId]
    );
    expect(rolledBack.rowCount).toBe(0);
  }, 120_000);
});
