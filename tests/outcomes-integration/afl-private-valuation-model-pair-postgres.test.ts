import { createHash } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_HPN_PAV_FINALIZED_CALCULATION_SCHEMA_VERSION,
  aflTradeFinalizedHpnPavCalculationSchema,
} from '@/server/aflTradeIntelligence/modeling/hpnPavCalculationService';
import { calculateAflTradeHpnPavCore } from '@/server/aflTradeIntelligence/modeling/hpnPavCore';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
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

const modelPairTargets = {
  player: {
    modelId: addressed('development-grade-model', 'player-model'),
    modelVersion: 'player-model-v1',
    protocolId: addressed('model-protocol', 'player-protocol'),
    datasetId: addressed('dataset', 'player-dataset'),
    datasetAdmissionId: addressed('dataset-admission', 'player-admission'),
  },
  pick: {
    protocolId: addressed('model-protocol', 'pick-protocol'),
    datasetId: addressed('dataset', 'pick-dataset'),
    datasetAdmissionId: addressed('dataset-admission', 'pick-admission'),
    policyId: addressed('pick-pav-policy', 'pick-policy'),
  },
  qualificationPolicyId: addressed('model-qualification-policy', 'qualification-policy'),
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
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Private model-pair PostgreSQL cleanup failed.');
  }
});

describe.sequential('dispatch-bound private model pair in PostgreSQL', () => {
  it('reconstructs after each retained component, pair acceptance, and qualification', async () => {
    const leaseToken = digest('restart-proof-lease-token');
    const requestId = addressed('private-valuation-dispatch', 'request');
    const claimId = addressed('private-valuation-dispatch-claim', 'claim');
    const playerRunId = addressed('model-run', 'player-component');
    const pickRunId = addressed('model-run', 'pick-component');
    const playerNativeRunId = addressed('model-run', 'player-native');
    const pickNativeExecutionId = addressed('pick-pav-model-execution', 'pick-native');
    const qualificationId = addressed('model-qualification', 'qualification');
    const factualOutputId = addressed('private-valuation-factual-output', 'factual-output');
    const factualRunId = addressed('factual-reconciliation-run', 'factual-run');
    const hpnCalculation = loaderCalculation(factualRunId, 'restart-proof');
    const hpnCalculationId = hpnCalculation.calculationId;
    const playerIntentId = addressed('model-run-intent', 'player-intent');
    const operationalReceiptId = addressed('architecture-operation-receipt', 'operation');
    const playerAuthorizationId = addressed('model-run-authorization', 'authorization');
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
      [claimId, digest(leaseToken), JSON.stringify({ state: 'activated' })]
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
