import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
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
import { createLocalAflTradePrivateDerivedArtifactRepository } from '@/server/aflTradeIntelligence/development/localFileConditionalObjectStore';
import {
  AFL_TRADE_HPN_PAV_FINALIZED_CALCULATION_SCHEMA_VERSION,
  aflTradeFinalizedHpnPavCalculationSchema,
} from '@/server/aflTradeIntelligence/modeling/hpnPavCalculationService';
import { calculateAflTradeHpnPavCore } from '@/server/aflTradeIntelligence/modeling/hpnPavCore';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { createLocalAflTradePrivateValuationRuntime } from '@/server/aflTradeIntelligence/development/localPrivateValuationRuntime';
import { PostgresAflTradePrivateValuationScheduleRepository } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationScheduling';
import { PostgresGovernedPrivateEvaluationBatchRepository } from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedPrivateEvaluationBatchRepository';
import { PostgresGovernedValuationModelQualificationRepository } from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedValuationModelQualificationRepository';
import {
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
import type { AflTradeConstructedCurrentValuationTrade } from '@/server/aflTradeIntelligence/valuation/currentValuationTradePreparation';
import { createAflTradeCurrentValuationBundleFixture } from '../testUtils/currentValuationCohortFixture';
import { createGovernedPrivateEvaluationAuthenticatedCalculationFixture } from '../testUtils/governedPrivateEvaluationAuthenticatedCalculationFixture';
import {
  createDispatchBoundGovernedModelPairAuthorityFixture,
  createDispatchBoundGovernedModelPairTargetsFixture,
} from '../testUtils/dispatchBoundGovernedModelPairAuthorityFixture';

import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

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
let privateArtifactRoot = '';

function scopedDatabaseUrl(): string {
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  return scoped.toString();
}

const digest = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const addressed = (prefix: string, value: string): string => `${prefix}:${digest(value)}`;

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

const modelPairTargetsFixture = createDispatchBoundGovernedModelPairTargetsFixture();
const modelPairTargets = modelPairTargetsFixture.targets;

function loaderFactualOutput(
  requestId: string,
  custodyKey: string,
  factualRunId: string,
  factualReleaseId = addressed('outcome-release', `${custodyKey}-release`)
) {
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
      releaseId: factualReleaseId,
      releaseSha256: factualReleaseId.slice('outcome-release:'.length),
    },
    preparedAt: '2026-08-24T00:00:01.000Z',
  });
}

beforeAll(async () => {
  privateArtifactRoot = await mkdtemp(join(tmpdir(), 'statly-private-model-pair-'));
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scopedDatabaseUrl() });
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
  if (privateArtifactRoot !== '') {
    try {
      await rm(privateArtifactRoot, { recursive: true, force: true });
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Private model-pair PostgreSQL cleanup failed.');
  }
});

describe.sequential('dispatch-bound private model pair in PostgreSQL', () => {
  it('resumes retained model-pair work and composes qualified dispatch through atomic activation', async () => {
    const leaseToken = digest('restart-proof-lease-token');
    const requestId = addressed('private-valuation-dispatch', 'request');
    const claimId = addressed('private-valuation-dispatch-claim', 'claim');
    const factualOutputId = addressed('private-valuation-factual-output', 'factual-output');
    const factualRunId = addressed('factual-reconciliation-run', 'factual-run');
    const hpnCalculation = loaderCalculation(factualRunId, 'restart-proof');
    const hpnCalculationId = hpnCalculation.calculationId;
    const operationalReceiptId = addressed('architecture-operation-receipt', 'operation');
    const now = new Date();
    const operation = createAflTradePrivateValuationModelOperation({
      scopeKey: 'afl-men:2026-trades',
      factualValuesSha256: digest('exact-loader-members'),
      hpnValuesSha256: '7346d98d175cac145dd32bf9a6040ad0c952191219760793bb6d1db36e09de5a',
      hpnMethodId: hpnCalculation.content.methodId,
      ...modelPairTargets,
    });
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
    const modelAuthority = createDispatchBoundGovernedModelPairAuthorityFixture({
      operation,
      exactInput,
      claim: { claimId, leaseToken },
      attemptNumber: 1,
      registeredAt: '2026-08-19T08:00:00.000Z',
      targetsFixture: modelPairTargetsFixture,
    });
    const playerRunId = modelAuthority.playerComponent.runId;
    const pickRunId = modelAuthority.pickComponent.runId;
    const playerNativeRunId = modelAuthority.playerNativeExecution.runId;
    const pickNativeExecutionId = modelAuthority.pickNativeExecution.executionId;
    const qualificationId = modelAuthority.qualification.qualificationId;
    const playerIntentId = modelAuthority.playerNativeExecution.content.runIntentId;
    const playerAuthorizationId = modelAuthority.playerNativeExecution.content.runAuthorizationId;

    const seed = await adminPool.connect();
    try {
      await seed.query('BEGIN');
      await seed.query(`SET LOCAL search_path TO "${schemaName}"`);
      await seed.query('SET LOCAL session_replication_role = replica');
      await seed.query(
        `INSERT INTO outcome_private_valuation_dispatch_request
          (request_id,scope_key,trigger_kind,scheduled_for,authority_key,status,available_at,
           claim_id,lease_token_sha256,lease_expires_at,claimed_at,request_json,claim_sequence)
         VALUES ($1,$2,'ad_hoc',$3,'restart-proof','claimed',$3,$4,$5,$6,$3,'{}'::jsonb,1)`,
        [
          requestId,
          operation.content.scopeKey,
          now,
          claimId,
          digest(leaseToken),
          new Date(now.getTime() + 300_000),
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
          addressed('private-valuation-capture-binding', 'capture-binding'),
          addressed('private-valuation-source-admission', 'source-admission'),
          addressed('provider-normalization-run', 'normalization'),
          addressed('source-fact-batch', 'fact-batch'),
          factualRunId,
          addressed('factual-release-candidate', 'candidate'),
          addressed('outcome-release', 'release'),
          now,
          JSON.stringify({
            content: {
              candidate: { memberSetSha256: operation.content.factualValuesSha256 },
            },
          }),
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
          modelAuthority.playerNativeExecution.content.observationSetId,
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
          modelAuthority.playerNativeExecution.content.observationSetId,
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
         VALUES ($1,$2,$3,'succeeded',$4,$5,$6,$7::jsonb)`,
        [
          playerNativeRunId,
          playerIntentId,
          playerAuthorizationId,
          modelAuthority.playerNativeExecution.content.startedAt,
          modelAuthority.playerNativeExecution.content.finishedAt,
          canonicalizeAflTradeJson(modelAuthority.playerNativeExecution.content),
          canonicalizeAflTradeJson(modelAuthority.playerNativeExecution),
        ]
      );
      const pickExecutionContent = modelAuthority.pickNativeExecution.content;
      await seed.query(
        `INSERT INTO outcome_governed_pick_pav_model_execution
          (execution_id,observation_set_id,dataset_id,dataset_artifact_id,
           dataset_admission_id,dataset_admission_artifact_id,
           dataset_admission_gate_ledger_revision,protocol_id,protocol_artifact_id,
           execution_artifact_id,final_test_evaluation_started_at,completed_at,
           content_sha256,content_canonical_json,execution_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)`,
        [
          pickNativeExecutionId,
          pickExecutionContent.observationSetId,
          pickExecutionContent.datasetId,
          pickExecutionContent.datasetArtifact.artifactId,
          pickExecutionContent.datasetAdmissionId,
          pickExecutionContent.datasetAdmissionArtifact.artifactId,
          pickExecutionContent.datasetAdmissionGateLedgerRevision,
          pickExecutionContent.protocolId,
          pickExecutionContent.protocolArtifact.artifactId,
          modelAuthority.pickComponent.content.nativeExecution.artifact.artifactId,
          pickExecutionContent.finalTestEvaluationStartedAt,
          pickExecutionContent.completedAt,
          pickNativeExecutionId.slice('pick-pav-model-execution:'.length),
          canonicalizeAflTradeJson(pickExecutionContent),
          canonicalizeAflTradeJson(modelAuthority.pickNativeExecution),
        ]
      );
      for (const component of [
        {
          manifest: modelAuthority.playerComponent,
          artifact: modelAuthority.playerComponentArtifact,
        },
        {
          manifest: modelAuthority.pickComponent,
          artifact: modelAuthority.pickComponentArtifact,
        },
      ] as const) {
        const content = component.manifest.content;
        await seed.query(
          `INSERT INTO outcome_governed_valuation_component_run
            (run_id,role,native_execution_kind,native_execution_id,artifact_id,
             native_execution_artifact_id,protocol_id,protocol_artifact_id,dataset_id,
             dataset_artifact_id,dataset_admission_id,dataset_admission_artifact_id,
             dataset_admission_gate_ledger_revision,registered_at,content_sha256,
             content_canonical_json,manifest_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)`,
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
      await seed.query('COMMIT');
    } catch (error) {
      await seed.query('ROLLBACK');
      throw error;
    } finally {
      seed.release();
    }

    const client = createPgAflOutcomeSqlClient(outcomesPool);
    const claim = { claimId, leaseToken };
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
        executePlayer: async () => ({ state: 'completed', runId: playerRunId }),
        executePick: async () => ({ state: 'completed', runId: pickRunId }),
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
    const governedArtifacts = createLocalAflTradePrivateDerivedArtifactRepository({
      rootDirectory: privateArtifactRoot,
      repositoryId: 'governed-private-evaluation',
      maximumObjectBytes: 4 * 1024 * 1024,
    });
    await Promise.all(
      modelAuthority.artifactDocuments.map(({ reference, document }) =>
        governedArtifacts.putIfAbsent(
          reference,
          new TextEncoder().encode(canonicalizeAflTradeJson(document))
        )
      )
    );
    for (const { reference } of modelAuthority.artifactDocuments) {
      await mutateFixture(
        `INSERT INTO outcome_artifact_custody
          (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
           environment,created_at,verified_at,custody_json)
         VALUES ($1,$2,$3,$4,$5,'derived_private','non_production',$6,$7,'{}'::jsonb)
         ON CONFLICT (artifact_id) DO NOTHING`,
        [
          reference.artifactId,
          reference.contentSha256,
          reference.storageUri,
          reference.mediaType,
          reference.byteLength,
          reference.createdAt,
          now,
        ]
      );
    }
    const registeredAuthority = await new PostgresGovernedValuationModelQualificationRepository({
      client,
      artifactRepository: governedArtifacts,
      maximumArtifactBytes: 4 * 1024 * 1024,
    }).register({
      qualification: modelAuthority.qualification,
      qualificationArtifact: modelAuthority.qualificationArtifact,
      expectedGateLedgerRevision: 0,
      expectedCurrentRevision: 0,
      gateRecords: modelAuthority.gateRecords,
    });
    if (registeredAuthority.status !== 'advanced') {
      throw new Error('Governed model-pair authority did not advance.');
    }
    const modelQualificationWorkId = registeredAuthority.work.workId;

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

    const [playerGate, pickGate] = modelAuthority.gateRecords;
    const playerValidityDecisionId = playerGate.decision.decisionId;
    const pickValidityDecisionId = pickGate.decision.decisionId;
    const cohortBundle = createAflTradeCurrentValuationBundleFixture({
      scopeKey: operation.content.scopeKey,
      playerRunId,
      pickRunId,
      componentAuthority: {
        player: {
          protocolId: modelAuthority.playerComponent.content.protocolId,
          datasetId: modelAuthority.playerComponent.content.datasetId,
          gate3DecisionId: playerValidityDecisionId,
        },
        pick: {
          protocolId: modelAuthority.pickComponent.content.protocolId,
          datasetId: modelAuthority.pickComponent.content.datasetId,
          gate3DecisionId: pickValidityDecisionId,
        },
      },
    });
    const readyTradeId = 'trade:private-cohort-acceptance-ready';
    const unavailableTradeId = 'trade:private-cohort-acceptance-unavailable';
    const governedComponentMetadata = [
      {
        ...cohortBundle.valuationInputBundle.content.components[0]!,
        datasetAdmissionId: modelAuthority.playerComponent.content.datasetAdmissionId,
        evidence: {
          runManifest: modelAuthority.playerComponentArtifact,
          protocol: modelAuthority.playerComponent.content.protocolArtifact,
          datasetAdmission: modelAuthority.playerComponent.content.datasetAdmissionArtifact,
          gate3Decision: createAflTradeCanonicalJsonArtifactRef(
            playerGate.decision,
            playerGate.decision.content.decidedAt!
          ),
        },
      },
      {
        ...cohortBundle.valuationInputBundle.content.components[1]!,
        datasetAdmissionId: modelAuthority.pickComponent.content.datasetAdmissionId,
        evidence: {
          runManifest: modelAuthority.pickComponentArtifact,
          protocol: modelAuthority.pickComponent.content.protocolArtifact,
          datasetAdmission: modelAuthority.pickComponent.content.datasetAdmissionArtifact,
          gate3Decision: createAflTradeCanonicalJsonArtifactRef(
            pickGate.decision,
            pickGate.decision.content.decidedAt!
          ),
        },
      },
    ] as const;
    const canonicalMembers = [readyTradeId, unavailableTradeId].map((canonicalRecordId) => ({
      recordKind: 'transaction',
      canonicalRecordId,
    }));
    await mutateFixture(
      `INSERT INTO outcome_artifact_custody
        (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
         environment,created_at,verified_at,custody_json)
       VALUES ($1,$2,$3,$4,$5,'derived_private','non_production',$6,$7,'{}'::jsonb)`,
      [
        cohortBundle.valuationInputBundleArtifact.artifactId,
        cohortBundle.valuationInputBundleArtifact.contentSha256,
        cohortBundle.valuationInputBundleArtifact.storageUri,
        cohortBundle.valuationInputBundleArtifact.mediaType,
        cohortBundle.valuationInputBundleArtifact.byteLength,
        cohortBundle.valuationInputBundleArtifact.createdAt,
        now,
      ]
    );
    await outcomesPool.query(
      `SELECT complete_outcome_private_valuation_dispatch($1,$2,$3::jsonb)`,
      [claimId, digest(leaseToken), JSON.stringify({ state: 'already_current' })]
    );

    const composedPreparedInputs = new Map<
      string,
      Readonly<{ factualOutputId: string; inputSetId: string; calculationId: string }>
    >();
    const composedRuntime = createLocalAflTradePrivateValuationRuntime({
      pool: outcomesPool,
      artifactRoot: privateArtifactRoot,
      upstream: {
        maximumConcurrency: 1,
        hpnPreparation: {
          prepare: async ({ requestId: preparedRequestId }) => {
            const prepared = composedPreparedInputs.get(preparedRequestId);
            if (prepared === undefined) {
              throw new Error('The composed acceptance request has no prepared upstream input.');
            }
            return {
              state: 'already_prepared' as const,
              requestId: preparedRequestId,
              ...prepared,
              captureBindingIds: [],
              sourceAdmissionIds: [],
              publicationEligible: false as const,
            };
          },
        },
        targets: modelPairTargets,
        playerExecutor: {
          execute: async () => {
            throw new Error(
              'The composed acceptance path unexpectedly executed the player adapter.'
            );
          },
        },
        pickExecutor: {
          execute: async () => {
            throw new Error('The composed acceptance path unexpectedly executed the pick adapter.');
          },
        },
        qualificationRegistrar: {
          register: async () => {
            throw new Error(
              'The composed acceptance path unexpectedly executed the qualification adapter.'
            );
          },
        },
        loadPrivateConstructionEvidence: async () => ({
          factualReleaseArtifact: composedFactualReleaseArtifact,
          releaseMembershipArtifact: composedReleaseMembershipArtifact,
          releaseTradeIds: [readyTradeId, unavailableTradeId],
          valuationInputBundleId: cohortBundle.valuationInputBundleId,
          valuationInputBundleArtifact: cohortBundle.valuationInputBundleArtifact,
          valuationInputBundle: cohortBundle.valuationInputBundle,
        }),
        constructTrade: async ({
          tradeId: constructedTradeId,
        }): Promise<AflTradeConstructedCurrentValuationTrade> => {
          if (constructedTradeId !== readyTradeId) {
            return {
              state: 'blocked' as const,
              blockers: [
                {
                  code: 'component_output_unavailable',
                  subject: { kind: 'trade', id: constructedTradeId },
                  evidenceRefs: [cohortBundle.valuationInputBundleArtifact],
                },
              ] as const,
            };
          }
          const manifest = composedCalculationFixture.materializationManifest;
          const parentDocuments: ReadonlyArray<readonly [AflTradeArtifactRef, unknown]> = [
            [
              manifest.content.calculationInputArtifact,
              composedCalculationFixture.calculationInputPackage,
            ],
            [manifest.content.inputTraceArtifact, composedCalculationFixture.trace],
            [
              manifest.content.explanationPolicyArtifact,
              composedCalculationFixture.explanationPolicy,
            ],
            [manifest.content.lineageGraphArtifact, composedCalculationFixture.lineageGraph],
            ...manifest.content.pickBenchmarks.map(
              ({ artifact }, index) =>
                [artifact, composedCalculationFixture.pickBenchmarks[index]!] as const
            ),
          ];
          return {
            state: 'ready' as const,
            manifest,
            manifestArtifact: createAflTradeCanonicalJsonArtifactRef(
              manifest,
              manifest.content.createdAt
            ),
            retainedParents: parentDocuments.map(([reference, document]) => ({
              reference,
              bytes: new TextEncoder().encode(canonicalizeAflTradeJson(document)),
            })),
          };
        },
      },
    });
    const schedule = new PostgresAflTradePrivateValuationScheduleRepository(client);
    const modelDispatch = await outcomesPool.query<{ readonly request_id: string }>(
      `SELECT request_id FROM outcome_private_valuation_dispatch_request
        WHERE scope_key=$1 AND trigger_kind='model_qualified' AND authority_key=$2`,
      [operation.content.scopeKey, modelQualificationWorkId]
    );
    const composedRequestId = modelDispatch.rows[0]?.request_id;
    if (modelDispatch.rows.length !== 1 || composedRequestId === undefined) {
      throw new Error('Governed model-pair advancement did not schedule exactly one dispatch.');
    }
    await expect(schedule.load(composedRequestId)).resolves.toEqual({
      status: 'pending',
      result: null,
    });
    const composedFactualReleaseId = addressed('outcome-release', 'composed-runtime-release');
    const composedFactual = loaderFactualOutput(
      composedRequestId,
      'composed-factual',
      factualRunId,
      composedFactualReleaseId
    );
    composedPreparedInputs.set(composedRequestId, {
      factualOutputId: composedFactual.outputId,
      inputSetId: hpnCalculation.content.inputSetId,
      calculationId: hpnCalculationId,
    });
    const composedReleaseManifest = { content: { canonicalMembers } };
    const composedCalculationFixture =
      createGovernedPrivateEvaluationAuthenticatedCalculationFixture({
        scopeKey: operation.content.scopeKey,
        tradeId: readyTradeId,
        factualReleaseId: composedFactualReleaseId,
        valuationInputBundleId: cohortBundle.valuationInputBundleId,
        playerRunId,
        pickRunId,
        componentMetadata: governedComponentMetadata,
      });
    const composedFactualReleaseArtifact = createAflTradeCanonicalJsonArtifactRef(
      composedReleaseManifest,
      now.toISOString()
    );
    const composedReleaseMembershipArtifact = createAflTradeCanonicalJsonArtifactRef(
      canonicalMembers,
      now.toISOString()
    );
    const composedArtifacts = governedArtifacts;
    const retainComposedArtifact = async (reference: AflTradeArtifactRef, document: unknown) =>
      composedArtifacts.putIfAbsent(
        reference,
        new TextEncoder().encode(canonicalizeAflTradeJson(document))
      );
    await retainComposedArtifact(
      cohortBundle.valuationInputBundleArtifact,
      cohortBundle.valuationInputBundle
    );
    await Promise.all(
      cohortBundle.artifactDocuments.map(({ reference, document }) =>
        retainComposedArtifact(reference, document)
      )
    );
    await retainComposedArtifact(composedFactualReleaseArtifact, composedReleaseManifest);
    await retainComposedArtifact(composedReleaseMembershipArtifact, canonicalMembers);
    await retainComposedArtifact(
      createAflTradeCanonicalJsonArtifactRef(
        composedCalculationFixture.materializationManifest,
        composedCalculationFixture.materializationManifest.content.createdAt
      ),
      composedCalculationFixture.materializationManifest
    );
    await retainComposedArtifact(
      composedCalculationFixture.materializationManifest.content.calculationInputArtifact,
      composedCalculationFixture.calculationInputPackage
    );
    await retainComposedArtifact(
      composedCalculationFixture.materializationManifest.content.inputTraceArtifact,
      composedCalculationFixture.trace
    );
    await retainComposedArtifact(
      composedCalculationFixture.materializationManifest.content.explanationPolicyArtifact,
      composedCalculationFixture.explanationPolicy
    );
    await retainComposedArtifact(
      composedCalculationFixture.materializationManifest.content.lineageGraphArtifact,
      composedCalculationFixture.lineageGraph
    );
    await Promise.all(
      composedCalculationFixture.artifactDocuments.map(({ reference, document }) =>
        retainComposedArtifact(reference, document)
      )
    );
    await Promise.all(
      composedCalculationFixture.materializationManifest.content.pickBenchmarks.map(
        ({ artifact }, index) =>
          retainComposedArtifact(artifact, composedCalculationFixture.pickBenchmarks[index]!)
      )
    );
    await mutateFixture(
      `INSERT INTO outcome_release_manifest
        (release_id,scope_key,environment,created_at,effective_through,manifest_json)
       VALUES ($1,'private-afl-draft-trade-outcomes','non_production',$2,$2,$3::jsonb)`,
      [composedFactualReleaseId, now, canonicalizeAflTradeJson(composedReleaseManifest)]
    );
    await mutateFixture(
      `INSERT INTO outcome_active_release
        (scope_key,release_id,activated_at,revision)
       VALUES ('private-afl-draft-trade-outcomes',$1,$2,1)
       ON CONFLICT (scope_key) DO UPDATE
         SET release_id=EXCLUDED.release_id,activated_at=EXCLUDED.activated_at,revision=EXCLUDED.revision`,
      [composedFactualReleaseId, now]
    );
    await mutateFixture(
      `INSERT INTO outcome_private_valuation_factual_output
        (output_id,request_id,capture_binding_id,source_admission_id,normalization_run_id,fact_batch_id,
         factual_run_id,candidate_id,factual_release_id,prepared_at,output_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
      [
        composedFactual.outputId,
        composedRequestId,
        composedFactual.content.captureBindingId,
        composedFactual.content.sourceAdmissionId,
        composedFactual.content.normalizationRunId,
        composedFactual.content.factBatch.batchId,
        composedFactual.content.reconciliation.factualRunId,
        composedFactual.content.candidate.candidateId,
        composedFactual.content.factualRelease.releaseId,
        composedFactual.content.preparedAt,
        canonicalizeAflTradeJson(composedFactual),
      ]
    );
    const composedDispatchResult = await composedRuntime.dispatchRequest(composedRequestId);
    expect(composedDispatchResult).toMatchObject({
      state: 'completed',
      requestId: composedRequestId,
      result: {
        state: 'activated',
        batch: {
          content: {
            tradeCount: 2,
            readyCount: 1,
            unavailableCount: 1,
            entries: expect.arrayContaining([
              expect.objectContaining({ tradeId: readyTradeId, state: 'ready' }),
              expect.objectContaining({ tradeId: unavailableTradeId, state: 'unavailable' }),
            ]),
          },
        },
      },
    });
    await expect(
      new PostgresGovernedPrivateEvaluationBatchRepository(client, async () => false).loadCurrent(
        operation.content.scopeKey
      )
    ).resolves.toMatchObject({
      head: { revision: 1 },
      batch: { content: { tradeCount: 2, readyCount: 1, unavailableCount: 1 } },
    });

    const replayRequestId = await composedRuntime.enqueueAdHoc({
      scopeKey: operation.content.scopeKey,
      operationKey: 'composed-no-change-replay',
    });
    const replayFactualReleaseId = addressed('outcome-release', 'composed-runtime-replay-release');
    const replayFactual = loaderFactualOutput(
      replayRequestId,
      'composed-replay-factual',
      factualRunId,
      replayFactualReleaseId
    );
    composedPreparedInputs.set(replayRequestId, {
      factualOutputId: replayFactual.outputId,
      inputSetId: hpnCalculation.content.inputSetId,
      calculationId: hpnCalculationId,
    });
    await mutateFixture(
      `INSERT INTO outcome_release_manifest
        (release_id,scope_key,environment,created_at,effective_through,manifest_json)
       VALUES ($1,'private-afl-draft-trade-outcomes','non_production',$2,$2,$3::jsonb)`,
      [
        replayFactualReleaseId,
        new Date(now.getTime() + 1_000),
        canonicalizeAflTradeJson(composedReleaseManifest),
      ]
    );
    await mutateFixture(
      `INSERT INTO outcome_private_valuation_factual_output
        (output_id,request_id,capture_binding_id,source_admission_id,normalization_run_id,fact_batch_id,
         factual_run_id,candidate_id,factual_release_id,prepared_at,output_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
      [
        replayFactual.outputId,
        replayRequestId,
        replayFactual.content.captureBindingId,
        replayFactual.content.sourceAdmissionId,
        replayFactual.content.normalizationRunId,
        replayFactual.content.factBatch.batchId,
        replayFactual.content.reconciliation.factualRunId,
        replayFactual.content.candidate.candidateId,
        replayFactual.content.factualRelease.releaseId,
        replayFactual.content.preparedAt,
        canonicalizeAflTradeJson(replayFactual),
      ]
    );
    await expect(composedRuntime.dispatchRequest(replayRequestId)).resolves.toMatchObject({
      state: 'completed',
      requestId: replayRequestId,
      result: {
        state: 'already_current',
        head: { revision: 1 },
      },
    });
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
