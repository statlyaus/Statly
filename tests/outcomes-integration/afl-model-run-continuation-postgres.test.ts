import { Pool } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { admittedPavModelRunFixture } from '../testUtils/admittedPavModelRunFixture';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradePrivateValuationScheduleRepository } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationScheduling';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { PostgresAflTradeAdmittedModelRunAuthority } from '@/server/aflTradeIntelligence/modeling/postgresAdmittedModelRunAuthority';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import {
  aflTradeModelRunCheckpointSchema,
  aflTradeModelRunCheckpointV2Schema,
} from '@/server/aflTradeIntelligence/artifacts/modelRunCheckpoint';
import {
  createAflTradeNativeFinalTestCompletionEvidence,
  createAflTradeModelRunPersistenceRecoveryManifest,
  createAflTradeNativeFinalTestCompletionEvidenceV2,
  createAflTradeModelRunProgressPersistenceRecoveryManifest,
  createAflTradeModelRunContinuationIntent,
  aflTradeModelRunIntentSchema,
} from '@/server/aflTradeIntelligence/artifacts/modelRunManifest';
import { runContent } from '../testUtils/admittedPlayerModelRunFixture';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable test database is required.');
const schemaName = `run_continuation_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl });
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schemaName}` });
const sql = createPgAflOutcomeSqlClient(pool);
const recoveryArtifacts = createAflTradeFixtureArtifactRepository();
const recoveryReader = new PostgresAflTradeAdmittedModelRunAuthority({
  sql,
  artifactRepository: recoveryArtifacts,
  gateDecisionLedgerRepository: createPostgresAflTradeGateDecisionLedgerRepository(sql),
});
const schedule = new PostgresAflTradePrivateValuationScheduleRepository(
  createPgAflOutcomeSqlClient(pool)
);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const id = (prefix: string, value: string) => `${prefix}:${hash(value)}`;
let fixture: Awaited<ReturnType<typeof admittedPavModelRunFixture>>;
const operationId = id('private-valuation-model-operation', 'synthetic-continuation');
const syntheticTables = [
  'outcome_valuation_dataset_candidate',
  'outcome_valuation_dataset_admission',
  'outcome_valuation_model_protocol',
  'outcome_valuation_player_observation_set',
  'outcome_private_valuation_model_operation',
  'outcome_private_valuation_model_request_binding',
] as const;
async function syntheticParent(
  transaction: PoolClient,
  table: (typeof syntheticTables)[number],
  values: Record<string, unknown>
) {
  if (!syntheticTables.includes(table))
    throw new Error('Synthetic parent table is outside this fixture.');
  const columns = await transaction.query<{
    name: string;
    type: string;
    required: boolean;
    default: string | null;
  }>(
    `SELECT a.attname name,format_type(a.atttypid,a.atttypmod) type,a.attnotnull required,pg_get_expr(d.adbin,d.adrelid) AS default
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped`,
    [table]
  );
  const row = { ...values };
  for (const column of columns.rows) {
    if (column.name in row || !column.required || column.default !== null) continue;
    row[column.name] = column.type.includes('timestamp')
      ? '2026-09-02T00:00:00.000Z'
      : column.type === 'jsonb'
        ? {}
        : /integer|bigint/.test(column.type)
          ? 10
          : column.name.includes('sha256')
            ? hash('synthetic-parent')
            : 'synthetic-parent';
  }
  const names = Object.keys(row)
    .map((name) => `"${name}"`)
    .join(',');
  // Named upstream tables only; never intent, checkpoint, dispatch or consumption guards.
  await transaction.query(`ALTER TABLE ${table} DISABLE TRIGGER ALL`);
  await transaction.query(
    `INSERT INTO ${table} (${names}) SELECT ${names} FROM jsonb_populate_record(NULL::${table},$1::jsonb)`,
    [canonicalizeAflTradeJson(row)]
  );
  await transaction.query(`ALTER TABLE ${table} ENABLE TRIGGER ALL`);
}
async function insertIntent(transaction: PoolClient, content: Record<string, unknown>) {
  const intentId = createAflTradeContentAddress('model-run-intent', content);
  await transaction.query(
    `INSERT INTO outcome_valuation_model_run_intent
    (intent_id,environment,dataset_id,admission_id,protocol_id,observation_set_id,started_at,intent_canonical_json,intent_json)
    VALUES($1,'non_production',$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [
      intentId,
      content.datasetId,
      content.datasetAdmissionId,
      content.modelProtocolId,
      content.observationSetId,
      content.startedAt,
      canonicalizeAflTradeJson(content),
      canonicalizeAflTradeJson({ intentId, content }),
    ]
  );
  return intentId;
}
async function seedExecutionAuthority(
  transaction: PoolClient,
  intentId: string,
  requestId: string,
  claim: { claimId: string; leaseToken: string },
  attempt: number,
  operationalLifetimeMs = 29_000
) {
  const now = (
    await transaction.query<{ now: Date }>('SELECT clock_timestamp() now')
  ).rows[0]!.now.toISOString();
  const through = new Date(Date.parse(now) + 29_000).toISOString();
  const receiptId = id('architecture-operation-receipt', intentId);
  const retainedIntent = aflTradeModelRunIntentSchema.parse(
    (
      await transaction.query<{ intent_json: unknown }>(
        'SELECT intent_json FROM outcome_valuation_model_run_intent WHERE intent_id=$1',
        [intentId]
      )
    ).rows[0]!.intent_json
  );
  const authorizationContent = {
    schemaVersion: 'afl-trade-model-run-authorization/v1',
    authorityBoundary: 'model_run_start_authority_no_grade_publication_or_fantasy_ownership',
    publicationEligible: false,
    environment: 'non_production',
    runIntentId: intentId,
    datasetId: retainedIntent.content.datasetId,
    datasetAdmissionId: retainedIntent.content.datasetAdmissionId,
    datasetRowSetSha256: 'a'.repeat(64),
    modelProtocolId: retainedIntent.content.modelProtocolId,
    observationSetId: retainedIntent.content.observationSetId,
    operationalAuthorizationReceiptId: receiptId,
    gate2DecisionId: id('gate-decision', 'synthetic-recovery-authorization'),
    gateLedgerRevision: 0,
    authorizedAt: now,
    validThrough: through,
    modelTrainingEvaluationReceiptIds: retainedIntent.content.modelTrainingEvaluationReceiptIds,
  };
  const authorizationId = createAflTradeContentAddress(
    'model-run-authorization',
    authorizationContent
  );
  const authorization = { authorizationId, content: authorizationContent };
  const receipt = {
    content: {
      authorityBoundary: 'policy_owned_local_private_valuation_for_one_exact_model_run_intent',
      runIntentId: intentId,
      dispatchRequestId: requestId,
      substantiveOperationId: operationId,
      dispatchClaimId: claim.claimId,
      dispatchLeaseTokenSha256: hash(claim.leaseToken),
      dispatchAttemptNumber: attempt,
    },
  };
  // Synthetic pre-existing issuance only. The real consumption/deferred checkpoint
  // triggers remain enabled, as do all new continuation and live-claim functions.
  await transaction.query(
    'ALTER TABLE outcome_valuation_model_run_operational_authorization DISABLE TRIGGER outcome_valuation_model_run_operation_insert_guard'
  );
  await transaction.query(
    `INSERT INTO outcome_valuation_model_run_operational_authorization
    (receipt_id,intent_id,environment,dataset_id,admission_id,protocol_id,observation_set_id,authorized_at,valid_through,principal_ref,receipt_canonical_json,receipt_json)
    VALUES($1,$2,'non_production',$3,$4,$5,$6,$7,$8,'synthetic-issuer',$9,$10::jsonb)`,
    [
      receiptId,
      intentId,
      fixture.intent.content.datasetId,
      fixture.intent.content.datasetAdmissionId,
      fixture.protocol.protocolId,
      fixture.observationSet.observationSetId,
      now,
      new Date(Date.parse(now) + operationalLifetimeMs).toISOString(),
      canonicalizeAflTradeJson(receipt.content),
      canonicalizeAflTradeJson(receipt),
    ]
  );
  await transaction.query(
    'ALTER TABLE outcome_valuation_model_run_operational_authorization ENABLE TRIGGER outcome_valuation_model_run_operation_insert_guard'
  );
  await transaction.query(
    'ALTER TABLE outcome_valuation_model_run_authorization DISABLE TRIGGER outcome_valuation_model_authorization_insert_guard'
  );
  await transaction.query(
    `INSERT INTO outcome_valuation_model_run_authorization
    (authorization_id,intent_id,operational_authorization_receipt_id,gate_ledger_revision,authorized_at,valid_through,authorization_canonical_json,authorization_json)
    VALUES($1,$2,$3,0,$4,$5,$6,$7::jsonb)`,
    [
      authorizationId,
      intentId,
      receiptId,
      now,
      through,
      canonicalizeAflTradeJson(authorizationContent),
      canonicalizeAflTradeJson(authorization),
    ]
  );
  await transaction.query(
    'ALTER TABLE outcome_valuation_model_run_authorization ENABLE TRIGGER outcome_valuation_model_authorization_insert_guard'
  );
  return authorizationId;
}
async function checkpoint(
  transaction: PoolClient,
  input: {
    intentId: string;
    rootIntentId: string;
    authorizationId: string;
    requestId: string;
    claimId: string;
    attempt: number;
    stage: string;
    previousCheckpointId: string | null;
    candidateArtifact: unknown;
    evidenceArtifact: unknown;
    extraEnvelope?: boolean;
    schemaVersion?: 'afl-trade-model-run-checkpoint/v2';
  }
) {
  const recordedAt = (
    await transaction.query<{ now: Date }>('SELECT clock_timestamp() now')
  ).rows[0]!.now.toISOString();
  const content = {
    schemaVersion: input.schemaVersion ?? 'afl-trade-model-run-checkpoint/v1',
    authorityBoundary: 'durable_model_run_stage_no_execution_or_qualification_authority',
    publicationEligible: false,
    environment: 'non_production',
    intentId: input.intentId,
    rootIntentId: input.rootIntentId,
    authorizationId: input.authorizationId,
    dispatchRequestId: input.requestId,
    substantiveOperationId: operationId,
    dispatchClaimId: input.claimId,
    dispatchAttemptNumber: input.attempt,
    stage: input.stage,
    previousCheckpointId: input.previousCheckpointId,
    recordedAt,
    candidateArtifact: input.candidateArtifact,
    evidenceArtifact: input.evidenceArtifact,
  };
  const checkpointId = createAflTradeContentAddress('model-run-checkpoint', content);
  await transaction.query(
    `INSERT INTO outcome_valuation_model_run_checkpoint
    (checkpoint_id,intent_id,root_intent_id,authorization_id,request_id,operation_id,claim_id,attempt_number,stage,previous_checkpoint_id,
     recorded_at,candidate_artifact,evidence_artifact,checkpoint_canonical_json,checkpoint_json)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15::jsonb)`,
    [
      checkpointId,
      input.intentId,
      input.rootIntentId,
      input.authorizationId,
      input.requestId,
      operationId,
      input.claimId,
      input.attempt,
      input.stage,
      input.previousCheckpointId,
      recordedAt,
      input.candidateArtifact === null ? null : canonicalizeAflTradeJson(input.candidateArtifact),
      input.evidenceArtifact === null ? null : canonicalizeAflTradeJson(input.evidenceArtifact),
      canonicalizeAflTradeJson(content),
      canonicalizeAflTradeJson({
        checkpointId,
        content,
        ...(input.extraEnvelope ? { unbound: true } : {}),
      }),
    ]
  );
  return checkpointId;
}
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const url = new URL(databaseUrl);
  url.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: url.toString() });
  const predecessorConstraint = await pool.query<{ conname: string }>(
    `SELECT conname FROM pg_constraint
     WHERE conrelid='outcome_valuation_model_run_checkpoint'::regclass
       AND contype='f' AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (previous_checkpoint_id)%'`
  );
  expect(predecessorConstraint.rows.map((row) => row.conname)).toEqual([
    'outcome_valuation_model_run_checkpo_previous_checkpoint_id_fkey',
  ]);
  fixture = await admittedPavModelRunFixture();
  const transaction = await pool.connect();
  try {
    await transaction.query('BEGIN');
    await syntheticParent(transaction, 'outcome_valuation_dataset_candidate', {
      dataset_id: fixture.intent.content.datasetId,
      environment: 'non_production',
      competition: 'AFLM',
      scope_key: 'synthetic-continuation',
      status: 'finalized',
      finalized_at: '2026-09-02T00:00:00.000Z',
      dataset_json: fixture.base.dataset,
    });
    await syntheticParent(transaction, 'outcome_valuation_dataset_admission', {
      admission_id: fixture.admission.admissionId,
      dataset_id: fixture.base.dataset.datasetId,
      environment: 'non_production',
      status: 'finalized',
      finalized_at: '2026-09-02T00:00:00.000Z',
      admission_json: fixture.admission,
      analytical_authority_receipt_id: id('architecture-operation-receipt', 'analytical'),
      operational_authorization_receipt_id: id('architecture-operation-receipt', 'operational'),
    });
    await syntheticParent(transaction, 'outcome_valuation_model_protocol', {
      protocol_id: fixture.protocol.protocolId,
      environment: 'non_production',
      dataset_id: fixture.base.dataset.datasetId,
      admission_id: fixture.admission.admissionId,
      analytical_authority_receipt_id: id('architecture-operation-receipt', 'analytical'),
      protocol_json: fixture.protocol,
    });
    await syntheticParent(transaction, 'outcome_valuation_player_observation_set', {
      observation_set_id: fixture.observationSet.observationSetId,
      environment: 'non_production',
      dataset_id: fixture.base.dataset.datasetId,
      admission_id: fixture.admission.admissionId,
      protocol_id: fixture.protocol.protocolId,
      observation_json: fixture.observationSet,
    });
    await syntheticParent(transaction, 'outcome_private_valuation_model_operation', {
      operation_id: operationId,
    });
    await transaction.query('COMMIT');
  } catch (error) {
    await transaction.query('ROLLBACK');
    throw error;
  } finally {
    transaction.release();
  }
}, 120_000);
afterAll(async () => {
  await pool.end();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } finally {
    await admin.end();
  }
});
describe.sequential('Native continuation checkpoint guards with synthetic model parents', () => {
  it('rejects a checkpoint that has no consumed private execution authority', async () => {
    await expect(
      pool.query(
        `INSERT INTO outcome_valuation_model_run_checkpoint
      (checkpoint_id,intent_id,root_intent_id,authorization_id,request_id,operation_id,claim_id,attempt_number,
       stage,recorded_at,checkpoint_canonical_json,checkpoint_json)
      VALUES($1,$2,$2,$3,$4,$5,$6,1,'started',clock_timestamp(),'{}','{}')`,
        [
          'model-run-checkpoint:' + 'a'.repeat(64),
          'model-run-intent:' + 'b'.repeat(64),
          'model-run-authorization:' + 'c'.repeat(64),
          'private-valuation-dispatch:' + 'd'.repeat(64),
          'private-valuation-model-operation:' + 'e'.repeat(64),
          'private-valuation-dispatch-claim:' + 'f'.repeat(64),
        ]
      )
    ).rejects.toThrow('Checkpoint requires exact consumed private run authority');
  });
  it.each(['legacy', 'progress'] as const)(
    'atomically retains %s custody with real claim and checkpoint fences',
    async (mode) => {
      const requested = await pool.query<{ request_id: string }>(
        `SELECT enqueue_outcome_private_valuation_dispatch($1,'ad_hoc',date_trunc('milliseconds',clock_timestamp()),'checkpoint-test') request_id`,
        [`synthetic-continuation-${mode}`]
      );
      const requestId = requested.rows[0]!.request_id;
      const claim = await schedule.claim('checkpoint-worker-a', requestId);
      if (!claim) throw new Error('Expected actual first claim');
      const transaction = await pool.connect();
      let rootId = '';
      let authorizationId = '';
      let startedId = '';
      let rootContent: Record<string, unknown> = {};
      try {
        await transaction.query('BEGIN');
        await syntheticParent(transaction, 'outcome_private_valuation_model_request_binding', {
          request_id: requestId,
          operation_id: operationId,
          claim_id: claim.claimId,
          attempt_number: 1,
        });
        rootContent = {
          ...fixture.intent.content,
          environment: 'non_production',
          job: {
            jobId: operationId,
            attempt: 1,
            initiatedBy: 'system:weekly-valuation-coordinator',
            workerIdentity: 'system:weekly-valuation-coordinator',
          },
          startedAt: (
            await transaction.query<{ now: Date }>('SELECT clock_timestamp() now')
          ).rows[0]!.now.toISOString(),
        };
        rootId = await insertIntent(transaction, rootContent);
        authorizationId = await seedExecutionAuthority(
          transaction,
          rootId,
          requestId,
          claim,
          1,
          mode === 'progress' ? 60_000 : 2_000
        );
        await transaction.query('COMMIT');
        // The actual consume trigger must roll the update back if started custody is missing.
        await expect(
          transaction.query(
            'UPDATE outcome_valuation_model_run_authorization SET consumed_at=clock_timestamp() WHERE authorization_id=$1',
            [authorizationId]
          )
        ).rejects.toThrow('atomic started checkpoint');
        await transaction.query('BEGIN');
        await transaction.query(
          'UPDATE outcome_valuation_model_run_authorization SET consumed_at=clock_timestamp() WHERE authorization_id=$1',
          [authorizationId]
        );
        startedId = await checkpoint(transaction, {
          intentId: rootId,
          rootIntentId: rootId,
          authorizationId,
          requestId,
          claimId: claim.claimId,
          attempt: 1,
          stage: 'started',
          previousCheckpointId: null,
          candidateArtifact: null,
          evidenceArtifact: null,
        });
        if (mode === 'progress') {
          await transaction.query('COMMIT');
          const originalConsumed = (
            await transaction.query<{ consumed_at: Date }>(
              'SELECT consumed_at FROM outcome_valuation_model_run_authorization WHERE authorization_id=$1',
              [authorizationId]
            )
          ).rows[0]!.consumed_at;
          const artifact = createAflTradeCanonicalJsonArtifactRef(
            { synthetic: 'accepted numerical custody, SQL fencing only' },
            (
              await transaction.query<{ now: Date }>('SELECT clock_timestamp() now')
            ).rows[0]!.now.toISOString()
          );
          const base = {
            intentId: rootId,
            rootIntentId: rootId,
            authorizationId,
            requestId,
            claimId: claim.claimId,
            attempt: 1,
            candidateArtifact: artifact,
            evidenceArtifact: artifact,
            schemaVersion: 'afl-trade-model-run-checkpoint/v2' as const,
          };
          await expect(
            checkpoint(transaction, {
              ...base,
              stage: 'pre_final_retained',
              previousCheckpointId: startedId,
            })
          ).rejects.toThrow('cannot regress');
          const fittedId = await checkpoint(transaction, {
            ...base,
            stage: 'candidate_fitted',
            previousCheckpointId: startedId,
          });
          // Separate real connections share the authoritative root lock; accepted work commits once.
          const retainPreFinal = async () => {
            const connection = await pool.connect();
            try {
              await connection.query('BEGIN');
              await connection.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
                `valuation-model-root:${rootId}`,
              ]);
              const existing = await connection.query<{ checkpoint_id: string }>(
                "SELECT checkpoint_id FROM outcome_valuation_model_run_checkpoint WHERE root_intent_id=$1 AND stage='pre_final_retained'",
                [rootId]
              );
              const checkpointId =
                existing.rows[0]?.checkpoint_id ??
                (await checkpoint(connection, {
                  ...base,
                  stage: 'pre_final_retained',
                  previousCheckpointId: fittedId,
                }));
              await connection.query('COMMIT');
              return { checkpointId, accepted: existing.rows.length === 0 };
            } catch (error) {
              await connection.query('ROLLBACK');
              throw error;
            } finally {
              connection.release();
            }
          };
          const contenders = await Promise.all([retainPreFinal(), retainPreFinal()]);
          expect(contenders.filter((item) => item.accepted)).toHaveLength(1);
          expect(contenders[0]!.checkpointId).toBe(contenders[1]!.checkpointId);
          const preFinalId = contenders[0]!.checkpointId;
          await transaction.query('BEGIN');
          await checkpoint(transaction, {
            ...base,
            stage: 'validation_plan_retained',
            previousCheckpointId: preFinalId,
          });
          await transaction.query('ROLLBACK');
          const recovered = await recoveryReader.loadRetainedRecoveryState({ intentId: rootId });
          expect(recovered.checkpoints.map((item) => item.content.stage)).toEqual([
            'started',
            'candidate_fitted',
            'pre_final_retained',
          ]);
          expect(recovered.terminalRun).toBeNull();
          expect(await retainPreFinal()).toEqual({ checkpointId: preFinalId, accepted: false });
          const planId = await checkpoint(transaction, {
            ...base,
            stage: 'validation_plan_retained',
            previousCheckpointId: preFinalId,
          });
          const other = createAflTradeCanonicalJsonArtifactRef(
            { synthetic: 'substituted numerical state' },
            artifact.createdAt
          );
          await expect(
            checkpoint(transaction, {
              ...base,
              stage: 'candidate_locked',
              previousCheckpointId: planId,
              candidateArtifact: other,
            })
          ).rejects.toThrow('replace prior candidate custody');
          await expect(
            checkpoint(transaction, {
              ...base,
              stage: 'candidate_locked',
              previousCheckpointId: planId,
              evidenceArtifact: other,
            })
          ).rejects.toThrow('replace prior candidate custody');
          await expect(
            checkpoint(transaction, {
              ...base,
              schemaVersion: undefined,
              stage: 'candidate_locked',
              previousCheckpointId: planId,
            })
          ).rejects.toThrow('downgrade');
          const progressLockedId = await checkpoint(transaction, {
            ...base,
            stage: 'candidate_locked',
            previousCheckpointId: planId,
          });
          expect(
            (await recoveryReader.loadRetainedRecoveryState({ intentId: rootId })).checkpoints.map(
              (item) => item.content.stage
            )
          ).toEqual([
            'started',
            'candidate_fitted',
            'pre_final_retained',
            'validation_plan_retained',
            'candidate_locked',
          ]);
          expect(
            (
              await transaction.query<{ consumed_at: Date }>(
                'SELECT consumed_at FROM outcome_valuation_model_run_authorization WHERE authorization_id=$1',
                [authorizationId]
              )
            ).rows[0]!.consumed_at
          ).toEqual(originalConsumed);
          const progressStartId = await checkpoint(transaction, {
            ...base,
            stage: 'final_test_started',
            previousCheckpointId: progressLockedId,
          });
          const progressStart = aflTradeModelRunCheckpointV2Schema.parse(
            (
              await transaction.query<{ checkpoint_json: unknown }>(
                'SELECT checkpoint_json FROM outcome_valuation_model_run_checkpoint WHERE checkpoint_id=$1',
                [progressStartId]
              )
            ).rows[0]!.checkpoint_json
          );
          const evaluatedAt = (
            await transaction.query<{ now: Date }>('SELECT clock_timestamp() now')
          ).rows[0]!.now.toISOString();
          // Synthetic full outputs: real SQL custody and terminal fencing, not scientific execution.
          const progressCompletion = createAflTradeNativeFinalTestCompletionEvidenceV2({
            finalTestStartedCheckpoint: progressStart,
            evaluatedAt,
            recordedAt: evaluatedAt,
            outcome: { ...runContent().outcome, modelArtifact: artifact },
          });
          const completionReference = createAflTradeCanonicalJsonArtifactRef(
            progressCompletion,
            evaluatedAt
          );
          await recoveryArtifacts.putIfAbsent(
            completionReference,
            new TextEncoder().encode(canonicalizeAflTradeJson(progressCompletion))
          );
          await checkpoint(transaction, {
            ...base,
            stage: 'final_test_completed',
            previousCheckpointId: progressStartId,
            evidenceArtifact: completionReference,
          });
          const progressRecovery = await recoveryReader.loadRetainedRecoveryState({
            intentId: rootId,
          });
          const persistenceChild = createAflTradeModelRunContinuationIntent({
            previousIntent: progressRecovery.rootIntent,
            checkpoint: progressRecovery.checkpoints[6]!,
            startedAt: (
              await transaction.query<{ now: Date }>('SELECT clock_timestamp() now')
            ).rows[0]!.now.toISOString(),
            dispatchClaimId: claim.claimId,
            dispatchLeaseTokenSha256: hash(claim.leaseToken),
            dispatchAttemptNumber: 1,
            modelTrainingEvaluationReceiptIds:
              progressRecovery.rootIntent.content.modelTrainingEvaluationReceiptIds,
          });
          const persistenceChildId = await insertIntent(transaction, persistenceChild.content);
          await transaction.query('BEGIN');
          const persistenceAuthorization = await seedExecutionAuthority(
            transaction,
            persistenceChildId,
            requestId,
            claim,
            1
          );
          await transaction.query(
            'UPDATE outcome_valuation_model_run_authorization SET consumed_at=clock_timestamp() WHERE authorization_id=$1',
            [persistenceAuthorization]
          );
          await transaction.query('COMMIT');
          const progressRun = createAflTradeModelRunProgressPersistenceRecoveryManifest({
            intentChain: [progressRecovery.rootIntent, persistenceChild],
            checkpoints: progressRecovery.checkpoints,
            completionEvidence: progressCompletion,
            runAuthorizationId: persistenceAuthorization,
            finishedAt: (
              await transaction.query<{ now: Date }>('SELECT clock_timestamp() now')
            ).rows[0]!.now.toISOString(),
          });
          const insertProgressTerminal = () =>
            transaction.query(
              `INSERT INTO outcome_valuation_model_run
             (run_id,intent_id,authorization_id,status,started_at,finished_at,run_canonical_json,run_json)
             VALUES($1,$2,$3,'succeeded',$4,$5,$6,$7::jsonb) ON CONFLICT DO NOTHING`,
              [
                progressRun.runId,
                persistenceChildId,
                persistenceAuthorization,
                progressRun.content.startedAt,
                progressRun.content.finishedAt,
                canonicalizeAflTradeJson(progressRun.content),
                canonicalizeAflTradeJson(progressRun),
              ]
            );
          expect((await insertProgressTerminal()).rowCount).toBe(1);
          expect((await insertProgressTerminal()).rowCount).toBe(0);
          return;
        }
        // An exact retained terminal replay is harmless even after receipt expiry.
        // Roll this preview back so the same scenario can still exercise crash continuation.
        await transaction.query('SAVEPOINT terminal_preview');
        const previewFinishedAt = (
          await transaction.query<{ now: Date }>('SELECT clock_timestamp() AS now')
        ).rows[0]!.now.toISOString();
        expect((await insertRootTerminal(previewFinishedAt)).rowCount).toBe(1);
        await new Promise((resolve) => setTimeout(resolve, 2_100));
        expect((await insertRootTerminal(previewFinishedAt)).rowCount).toBe(0);
        await transaction.query('ROLLBACK TO SAVEPOINT terminal_preview');
        await transaction.query('COMMIT');
        const originalConsumption = (
          await transaction.query<{ consumed_at: Date }>(
            'SELECT consumed_at FROM outcome_valuation_model_run_authorization WHERE authorization_id=$1',
            [authorizationId]
          )
        ).rows[0]!.consumed_at;
        const startedRecovery = await recoveryReader.loadRetainedRecoveryState({
          intentId: rootId,
        });
        expect(startedRecovery.authorityBoundary).toBe(
          'retained_model_run_recovery_evidence_no_execution_authority'
        );
        expect(startedRecovery.rootIntent.intentId).toBe(rootId);
        expect(startedRecovery.activeIntent.intentId).toBe(rootId);
        expect(startedRecovery.checkpoints.map((entry) => entry.content.stage)).toEqual([
          'started',
        ]);
        expect(startedRecovery.terminalRun).toBeNull();
        expect(
          (
            await transaction.query<{ consumed_at: Date }>(
              'SELECT consumed_at FROM outcome_valuation_model_run_authorization WHERE authorization_id=$1',
              [authorizationId]
            )
          ).rows[0]!.consumed_at
        ).toEqual(originalConsumption);
        // The claim remains live, but waiting cannot renew its immutable operational receipt.
        await expect(
          checkpoint(transaction, {
            intentId: rootId,
            rootIntentId: rootId,
            authorizationId,
            requestId,
            claimId: claim.claimId,
            attempt: 1,
            stage: 'candidate_locked',
            previousCheckpointId: startedId,
            candidateArtifact: createAflTradeCanonicalJsonArtifactRef(
              { candidate: 'expired' },
              new Date().toISOString()
            ),
            evidenceArtifact: createAflTradeCanonicalJsonArtifactRef(
              { evidence: 'expired' },
              new Date().toISOString()
            ),
          })
        ).rejects.toThrow('Checkpoint requires current operational receipt');
        await expect(insertRootTerminal()).rejects.toThrow(
          'Native terminal run requires current operational receipt'
        );
        await schedule.reschedule({
          claimId: claim.claimId,
          leaseToken: claim.leaseToken,
          state: 'retry_pending',
        });
        // Respect the real five-second scheduler retry delay; do not rewrite leases or clocks.
        await new Promise((resolve) => setTimeout(resolve, 5_100));
        const next = await schedule.claim('checkpoint-worker-b', requestId);
        if (!next) throw new Error('Expected real replacement claim');
        async function insertRootTerminal(finishedAt = new Date().toISOString()) {
          const content = {
            ...rootContent,
            schemaVersion: 'afl-trade-model-run/v3',
            runIntentId: rootId,
            runAuthorizationId: authorizationId,
            finishedAt,
            outcome: { status: 'succeeded' },
          };
          const runId = createAflTradeContentAddress('model-run', content);
          return transaction.query(
            `INSERT INTO outcome_valuation_model_run
          (run_id,intent_id,authorization_id,status,started_at,finished_at,run_canonical_json,run_json)
          VALUES($1,$2,$3,'succeeded',$4,$5,$6,$7::jsonb) ON CONFLICT DO NOTHING`,
            [
              runId,
              rootId,
              authorizationId,
              rootContent.startedAt,
              finishedAt,
              canonicalizeAflTradeJson(content),
              canonicalizeAflTradeJson({ runId, content }),
            ]
          );
        }
        // No successor intent exists yet: loss of the old claim must itself fence terminal writes.
        await expect(insertRootTerminal()).rejects.toThrow('lost its live claim fence');
        const attempt = (
          await transaction.query<{ attempt_number: number }>(
            'SELECT attempt_number FROM outcome_private_valuation_dispatch_attempt WHERE claim_id=$1',
            [next.claimId]
          )
        ).rows[0]!.attempt_number;
        await transaction.query('BEGIN');
        const content = {
          ...rootContent,
          schemaVersion: 'afl-trade-model-run-intent/v2',
          job: { ...(rootContent.job as Record<string, unknown>), attempt },
          startedAt: (
            await transaction.query<{ now: Date }>('SELECT clock_timestamp() now')
          ).rows[0]!.now.toISOString(),
          continuation: {
            rootIntentId: rootId,
            previousIntentId: rootId,
            checkpointId: startedId,
            dispatchRequestId: requestId,
            substantiveOperationId: operationId,
            dispatchClaimId: next.claimId,
            dispatchLeaseTokenSha256: hash(next.leaseToken),
            dispatchAttemptNumber: attempt,
          },
        };
        const nextId = await insertIntent(transaction, content);
        const nextAuthorization = await seedExecutionAuthority(
          transaction,
          nextId,
          requestId,
          next,
          attempt
        );
        await transaction.query(
          'UPDATE outcome_valuation_model_run_authorization SET consumed_at=clock_timestamp() WHERE authorization_id=$1',
          [nextAuthorization]
        );
        const artifactClock = await transaction.query<{ now: Date }>(
          'SELECT clock_timestamp() AS now'
        );
        const artifact = createAflTradeCanonicalJsonArtifactRef(
          { synthetic: 'locked numerical state only' },
          artifactClock.rows[0]!.now.toISOString()
        );
        const reject = async (work: () => Promise<unknown>, message: string) => {
          await transaction.query('SAVEPOINT rejected_write');
          await expect(work()).rejects.toThrow(message);
          await transaction.query('ROLLBACK TO SAVEPOINT rejected_write');
        };
        const { storageUri: _uri, ...missingUri } = artifact;
        const lockedInput = {
          intentId: nextId,
          rootIntentId: rootId,
          authorizationId: nextAuthorization,
          requestId,
          claimId: next.claimId,
          attempt,
          stage: 'candidate_locked',
          previousCheckpointId: startedId,
          candidateArtifact: artifact,
          evidenceArtifact: artifact,
        };
        await reject(
          () => checkpoint(transaction, { ...lockedInput, candidateArtifact: missingUri }),
          'artifact references'
        );
        await reject(
          () => checkpoint(transaction, { ...lockedInput, extraEnvelope: true }),
          'canonical identity'
        );
        for (const field of ['candidateArtifact', 'evidenceArtifact'] as const) {
          await reject(
            () =>
              checkpoint(transaction, { ...lockedInput, [field]: { ...artifact, byteLength: 0 } }),
            'artifact references'
          );
        }
        const lockedId = await checkpoint(transaction, {
          intentId: nextId,
          rootIntentId: rootId,
          authorizationId: nextAuthorization,
          requestId,
          claimId: next.claimId,
          attempt,
          stage: 'candidate_locked',
          previousCheckpointId: startedId,
          candidateArtifact: artifact,
          evidenceArtifact: artifact,
        });
        await transaction.query('COMMIT');
        const consumedBefore = (
          await transaction.query<{ consumed_at: Date }>(
            'SELECT consumed_at FROM outcome_valuation_model_run_authorization WHERE authorization_id=$1',
            [authorizationId]
          )
        ).rows[0]!.consumed_at;
        const continuation = async (previousIntentId: string, checkpointId: string) => ({
          ...rootContent,
          schemaVersion: 'afl-trade-model-run-intent/v2',
          job: { ...(rootContent.job as Record<string, unknown>), attempt },
          startedAt: (
            await transaction.query<{ now: Date }>('SELECT clock_timestamp() now')
          ).rows[0]!.now.toISOString(),
          continuation: {
            rootIntentId: rootId,
            previousIntentId,
            checkpointId,
            dispatchRequestId: requestId,
            substantiveOperationId: operationId,
            dispatchClaimId: next.claimId,
            dispatchLeaseTokenSha256: hash(next.leaseToken),
            dispatchAttemptNumber: attempt,
          },
        });
        await transaction.query('BEGIN');
        await reject(
          insertRootTerminal,
          'Native terminal run has been handed off or already completed'
        );
        const valid = await continuation(nextId, lockedId);
        for (const invalidBinding of [
          { ...valid.continuation, unboundAuthority: true },
          {
            ...valid.continuation,
            dispatchAttemptNumber: String(valid.continuation.dispatchAttemptNumber),
          },
          { ...valid.continuation, dispatchAttemptNumber: 1.5 },
          { ...valid.continuation, dispatchLeaseTokenSha256: 'invalid-hash' },
        ]) {
          await reject(
            () => insertIntent(transaction, { ...valid, continuation: invalidBinding }),
            'Continuation requires exact binding shape'
          );
        }
        await reject(
          () => insertIntent(transaction, { ...valid, codeCommitSha: hash('changed-code') }),
          'exact unfinished native root'
        );
        await reject(
          () =>
            insertIntent(transaction, {
              ...valid,
              continuation: {
                ...valid.continuation,
                dispatchRequestId: id('private-valuation-dispatch', 'another-request'),
              },
            }),
          'exact unfinished native root'
        );
        await reject(
          () =>
            insertIntent(transaction, {
              ...valid,
              continuation: { ...valid.continuation, checkpointId: startedId },
            }),
          'latest unambiguous checkpoint'
        );
        await reject(
          () =>
            insertIntent(transaction, {
              ...valid,
              continuation: {
                ...valid.continuation,
                dispatchClaimId: claim.claimId,
                dispatchLeaseTokenSha256: hash(claim.leaseToken),
              },
            }),
          'live claim fence'
        );
        // Claim B can crash after inserting an intent but before consuming it. Its
        // successor reuses the ancestor's latest checkpoint instead of inventing a stage.
        const unconsumedId = await insertIntent(transaction, valid);
        await reject(
          () =>
            insertIntent(transaction, {
              ...valid,
              job: { ...fixture.intent.content.job, jobId: 'competing-successor' },
            }),
          'latest unambiguous checkpoint'
        );
        await transaction.query('COMMIT');
        const interruptedRecovery = await recoveryReader.loadRetainedRecoveryState({
          intentId: unconsumedId,
        });
        expect(interruptedRecovery.rootIntent.intentId).toBe(rootId);
        expect(interruptedRecovery.activeIntent.intentId).toBe(unconsumedId);
        expect(interruptedRecovery.checkpoints.map((entry) => entry.content.stage)).toEqual([
          'started',
          'candidate_locked',
        ]);
        expect(interruptedRecovery.checkpoints.at(-1)?.checkpointId).toBe(lockedId);
        expect(interruptedRecovery.terminalRun).toBeNull();
        expect(
          (
            await transaction.query<{ consumed_at: Date }>(
              'SELECT consumed_at FROM outcome_valuation_model_run_authorization WHERE authorization_id=$1',
              [authorizationId]
            )
          ).rows[0]!.consumed_at
        ).toEqual(consumedBefore);
        await transaction.query('BEGIN');
        const activeId = await insertIntent(
          transaction,
          await continuation(unconsumedId, lockedId)
        );
        const activeAuthorization = await seedExecutionAuthority(
          transaction,
          activeId,
          requestId,
          next,
          attempt
        );
        await transaction.query(
          'UPDATE outcome_valuation_model_run_authorization SET consumed_at=clock_timestamp() WHERE authorization_id=$1',
          [activeAuthorization]
        );
        const stageInput = {
          intentId: activeId,
          rootIntentId: rootId,
          authorizationId: activeAuthorization,
          requestId,
          claimId: next.claimId,
          attempt,
          stage: 'final_test_started',
          previousCheckpointId: lockedId,
          candidateArtifact: artifact,
          evidenceArtifact: artifact,
        };
        const changedArtifact = createAflTradeCanonicalJsonArtifactRef(
          { synthetic: 'changed locked candidate' },
          new Date().toISOString()
        );
        await reject(
          () => checkpoint(transaction, { ...stageInput, candidateArtifact: changedArtifact }),
          'locked candidate'
        );
        await transaction.query('COMMIT');
        // Real PostgreSQL fencing proof with synthetic upstream authority: two workers
        // contend for the same root, but only the committed winner opens the stage.
        // This is not a proof of the adapter's full current-source authentication graph.
        const beginOnce = async () => {
          const contender = await pool.connect();
          try {
            await contender.query('BEGIN');
            await contender.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
              `valuation-model-root:${rootId}`,
            ]);
            const existing = await contender.query<{ checkpoint_id: string }>(
              `SELECT checkpoint_id FROM outcome_valuation_model_run_checkpoint
             WHERE root_intent_id=$1 AND stage='final_test_started'`,
              [rootId]
            );
            const checkpointId =
              existing.rows[0]?.checkpoint_id ?? (await checkpoint(contender, stageInput));
            await contender.query('COMMIT');
            return { checkpointId, newlyStarted: existing.rows.length === 0 };
          } catch (error) {
            await contender.query('ROLLBACK');
            throw error;
          } finally {
            contender.release();
          }
        };
        const contenders = await Promise.all([beginOnce(), beginOnce()]);
        expect(contenders.filter((entry) => entry.newlyStarted)).toHaveLength(1);
        expect(contenders[0]!.checkpointId).toBe(contenders[1]!.checkpointId);
        const finalStartId = contenders[0]!.checkpointId;
        expect(await beginOnce()).toEqual({ checkpointId: finalStartId, newlyStarted: false });
        await transaction.query('BEGIN');
        await reject(() => checkpoint(transaction, stageInput), 'cannot regress, repeat');
        const ambiguous = await continuation(activeId, finalStartId);
        await reject(() => insertIntent(transaction, ambiguous), 'latest unambiguous checkpoint');
        const retainedStart = aflTradeModelRunCheckpointSchema.parse(
          (
            await transaction.query<{ checkpoint_json: unknown }>(
              'SELECT checkpoint_json FROM outcome_valuation_model_run_checkpoint WHERE checkpoint_id=$1',
              [finalStartId]
            )
          ).rows[0]!.checkpoint_json
        );
        const evidenceTime = (
          await transaction.query<{ now: Date }>('SELECT clock_timestamp() AS now')
        ).rows[0]!.now.toISOString();
        // Synthetic completion report: this proves durable recovery/readback, not native evaluation.
        const completionEvidence = createAflTradeNativeFinalTestCompletionEvidence({
          finalTestStartedCheckpoint: retainedStart,
          evaluatedAt: evidenceTime,
          recordedAt: evidenceTime,
          outcome: { ...runContent().outcome, modelArtifact: artifact },
        });
        const completionReference = createAflTradeCanonicalJsonArtifactRef(
          completionEvidence,
          evidenceTime
        );
        await recoveryArtifacts.putIfAbsent(
          completionReference,
          new TextEncoder().encode(canonicalizeAflTradeJson(completionEvidence))
        );
        // Readdress the entire malformed report and retain its matching checkpoint;
        // rejection must come from the terminal guard, not a digest mismatch.
        // Flush the already-valid started-custody constraint before synthetic issuer setup.
        await transaction.query('SET CONSTRAINTS ALL IMMEDIATE');
        for (const mode of [
          'local_evaluation_time',
          'local_artifact_time',
          'blank_media',
        ] as const) {
          const invalidReport =
            mode === 'local_evaluation_time'
              ? { ...completionEvidence, evaluatedAt: evidenceTime.slice(0, -1) }
              : {
                  ...completionEvidence,
                  outcome: {
                    ...completionEvidence.outcome,
                    diagnosticsArtifact: {
                      ...completionEvidence.outcome.diagnosticsArtifact,
                      ...(mode === 'blank_media'
                        ? { mediaType: '   ' }
                        : { createdAt: '2026-08-10T00:00:00.000' }),
                    },
                  },
                };
          await reject(
            async () => {
              const invalidReference = createAflTradeCanonicalJsonArtifactRef(
                invalidReport,
                evidenceTime
              );
              const invalidCompletedId = await checkpoint(transaction, {
                ...stageInput,
                stage: 'final_test_completed',
                previousCheckpointId: finalStartId,
                evidenceArtifact: invalidReference,
              });
              const childContent = await continuation(activeId, invalidCompletedId);
              const childId = await insertIntent(transaction, childContent);
              const childAuthorization = await seedExecutionAuthority(
                transaction,
                childId,
                requestId,
                next,
                attempt
              );
              await transaction.query(
                'UPDATE outcome_valuation_model_run_authorization SET consumed_at=clock_timestamp() WHERE authorization_id=$1',
                [childAuthorization]
              );
              const chainRows = await transaction.query<{ intent_json: unknown }>(
                `WITH RECURSIVE chain AS (
              SELECT intent_json,previous_intent_id,0 AS depth FROM outcome_valuation_model_run_intent WHERE intent_id=$1
              UNION ALL SELECT parent.intent_json,parent.previous_intent_id,child.depth+1
              FROM outcome_valuation_model_run_intent parent JOIN chain child ON parent.intent_id=child.previous_intent_id
            ) SELECT intent_json FROM chain ORDER BY depth DESC`,
                [childId]
              );
              const stages = await transaction.query<{ checkpoint_json: unknown }>(
                `SELECT checkpoint_json FROM outcome_valuation_model_run_checkpoint WHERE root_intent_id=$1
             ORDER BY CASE stage WHEN 'started' THEN 1 WHEN 'candidate_locked' THEN 2 WHEN 'final_test_started' THEN 3 ELSE 4 END`,
                [rootId]
              );
              const checkpoints = stages.rows.map((row) =>
                aflTradeModelRunCheckpointSchema.parse(row.checkpoint_json)
              );
              const { continuation: _continuation, ...childFields } = childContent;
              const invalidFinishedAt = (
                await transaction.query<{ now: Date }>('SELECT clock_timestamp() AS now')
              ).rows[0]!.now.toISOString();
              const invalidContent = {
                ...childFields,
                schemaVersion: 'afl-trade-model-run/v4',
                authorityBoundary:
                  'persistence_recovery_only_no_execution_or_qualification_authority',
                publicationEligible: false,
                runIntentId: childId,
                runAuthorizationId: childAuthorization,
                candidateLockedAt: checkpoints[1]!.content.recordedAt,
                finalTestEvaluatedAt: invalidReport.evaluatedAt,
                finishedAt: invalidFinishedAt,
                outcome: invalidReport.outcome,
                recovery: {
                  intentChain: chainRows.rows.map((row) => row.intent_json),
                  checkpoints,
                  completionEvidence: invalidReport,
                },
              };
              const invalidRun = {
                runId: createAflTradeContentAddress('model-run', invalidContent),
                content: invalidContent,
              };
              return transaction.query(
                `INSERT INTO outcome_valuation_model_run
            (run_id,intent_id,authorization_id,status,started_at,finished_at,run_canonical_json,run_json)
            VALUES ($1,$2,$3,'succeeded',$4,$5,$6,$7::jsonb)`,
                [
                  invalidRun.runId,
                  childId,
                  childAuthorization,
                  childContent.startedAt,
                  invalidFinishedAt,
                  canonicalizeAflTradeJson(invalidContent),
                  canonicalizeAflTradeJson(invalidRun),
                ]
              );
            },
            mode === 'local_evaluation_time'
              ? 'completed evaluation custody'
              : 'output reference is invalid'
          );
        }
        const completedId = await checkpoint(transaction, {
          ...stageInput,
          stage: 'final_test_completed',
          previousCheckpointId: finalStartId,
          evidenceArtifact: completionReference,
        });
        // Completed evaluation custody may be adopted for persistence only; it does
        // not create another root final-test-start slot or scientific approval.
        const persistenceIntentId = await insertIntent(
          transaction,
          await continuation(activeId, completedId)
        );
        await reject(
          () =>
            checkpoint(transaction, {
              ...stageInput,
              stage: 'final_test_completed',
              previousCheckpointId: finalStartId,
            }),
          'exact consumed private run authority'
        );
        await transaction.query('COMMIT');
        const restartedReader = new PostgresAflTradeAdmittedModelRunAuthority({
          sql,
          artifactRepository: recoveryArtifacts,
          gateDecisionLedgerRepository: createPostgresAflTradeGateDecisionLedgerRepository(sql),
        });
        const recovered = await restartedReader.loadRetainedRecoveryState({
          intentId: persistenceIntentId,
        });
        expect(recovered.activeIntent.intentId).toBe(persistenceIntentId);
        expect(recovered.finalTestCompletionEvidence).toEqual(completionEvidence);
        expect(recovered.terminalRun).toBeNull();
        expect(recovered.checkpoints.at(-1)?.checkpointId).toBe(completedId);
        await transaction.query('BEGIN');
        const persistenceAuthorizationId = await seedExecutionAuthority(
          transaction,
          persistenceIntentId,
          requestId,
          next,
          attempt,
          5_000
        );
        await transaction.query(
          'UPDATE outcome_valuation_model_run_authorization SET consumed_at=clock_timestamp() WHERE authorization_id=$1',
          [persistenceAuthorizationId]
        );
        const retainedIntents = await transaction.query<{ intent_json: unknown }>(
          `WITH RECURSIVE chain AS (
          SELECT intent_json,previous_intent_id,0 AS depth FROM outcome_valuation_model_run_intent WHERE intent_id=$1
          UNION ALL SELECT parent.intent_json,parent.previous_intent_id,child.depth+1
          FROM outcome_valuation_model_run_intent parent JOIN chain child ON parent.intent_id=child.previous_intent_id
        ) SELECT intent_json FROM chain ORDER BY depth DESC`,
          [persistenceIntentId]
        );
        const finishedAt = (
          await transaction.query<{ now: Date }>('SELECT clock_timestamp() AS now')
        ).rows[0]!.now.toISOString();
        const persistenceRun = createAflTradeModelRunPersistenceRecoveryManifest({
          intentChain: retainedIntents.rows.map((row) =>
            aflTradeModelRunIntentSchema.parse(row.intent_json)
          ),
          checkpoints: recovered.checkpoints.map((checkpoint) =>
            aflTradeModelRunCheckpointSchema.parse(checkpoint)
          ),
          completionEvidence,
          runAuthorizationId: persistenceAuthorizationId,
          finishedAt,
        });
        const insertPersistenceTerminal = (content: Record<string, unknown>) => {
          const run = { runId: createAflTradeContentAddress('model-run', content), content };
          return transaction.query(
            `INSERT INTO outcome_valuation_model_run
          (run_id,intent_id,authorization_id,status,started_at,finished_at,run_canonical_json,run_json)
          VALUES ($1,$2,$3,'succeeded',$4,$5,$6,$7::jsonb) ON CONFLICT DO NOTHING RETURNING run_id`,
            [
              run.runId,
              persistenceIntentId,
              persistenceAuthorizationId,
              persistenceRun.content.startedAt,
              finishedAt,
              canonicalizeAflTradeJson(content),
              canonicalizeAflTradeJson(run),
            ]
          );
        };
        await reject(
          () => insertPersistenceTerminal({ ...persistenceRun.content, finishedAt: null }),
          'Persistence recovery'
        );
        const { finishedAt: _finishedAt, ...missingFinish } = persistenceRun.content;
        await reject(() => insertPersistenceTerminal(missingFinish), 'Persistence recovery');
        await reject(
          () =>
            insertPersistenceTerminal({
              ...persistenceRun.content,
              recovery: {
                ...persistenceRun.content.recovery,
                checkpoints: recovered.checkpoints.slice(0, 3),
              },
            }),
          'exact retained complete ancestry'
        );
        await reject(
          () =>
            insertPersistenceTerminal({
              ...persistenceRun.content,
              recovery: {
                ...persistenceRun.content.recovery,
                completionEvidence: { ...completionEvidence, evaluatedAt: finishedAt },
              },
            }),
          'completed evaluation custody'
        );
        await reject(
          () =>
            insertPersistenceTerminal({
              ...persistenceRun.content,
              candidateLockedAt: persistenceRun.content.startedAt,
            }),
          'exact child and evidence'
        );
        await transaction.query('COMMIT');
        const missingCustodyOwner = new PostgresAflTradeAdmittedModelRunAuthority({
          sql,
          artifactRepository: createAflTradeFixtureArtifactRepository(),
          gateDecisionLedgerRepository: createPostgresAflTradeGateDecisionLedgerRepository(sql),
        });
        await expect(missingCustodyOwner.persistCompletedRun(persistenceRun)).rejects.toMatchObject(
          {
            code: 'MISSING_EVIDENCE',
          }
        );
        expect(
          (await restartedReader.loadRetainedRecoveryState({ intentId: persistenceIntentId }))
            .terminalRun
        ).toBeNull();
        expect(await restartedReader.persistCompletedRun(persistenceRun)).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 5_100));
        expect(await restartedReader.persistCompletedRun(persistenceRun)).toBe(true);
        const conflictingRun = createAflTradeModelRunPersistenceRecoveryManifest({
          ...persistenceRun.content.recovery,
          runAuthorizationId: persistenceAuthorizationId,
          finishedAt: new Date(Date.parse(finishedAt) + 1).toISOString(),
        });
        await expect(restartedReader.persistCompletedRun(conflictingRun)).rejects.toMatchObject({
          code: 'CONFLICTING_REPLAY',
        });
        const terminalReader = new PostgresAflTradeAdmittedModelRunAuthority({
          sql,
          artifactRepository: recoveryArtifacts,
          gateDecisionLedgerRepository: createPostgresAflTradeGateDecisionLedgerRepository(sql),
        });
        const completedRecovery = await terminalReader.loadRetainedRecoveryState({
          intentId: persistenceIntentId,
        });
        expect(completedRecovery.terminalRun).toEqual(persistenceRun);
        expect(completedRecovery.finalTestCompletionEvidence).toEqual(completionEvidence);
        expect(persistenceRun.content.finalTestEvaluatedAt).toBe(evidenceTime);
        expect(Date.parse(persistenceRun.content.startedAt)).toBeGreaterThanOrEqual(
          Date.parse(evidenceTime)
        );
        expect(
          (
            await transaction.query<{ consumed_at: Date }>(
              'SELECT consumed_at FROM outcome_valuation_model_run_authorization WHERE authorization_id=$1',
              [authorizationId]
            )
          ).rows[0]!.consumed_at
        ).toEqual(consumedBefore);
        expect(
          (
            await transaction.query<{ stage: string }>(
              'SELECT stage FROM outcome_valuation_model_run_checkpoint WHERE root_intent_id=$1 ORDER BY recorded_at',
              [rootId]
            )
          ).rows.map((row) => row.stage)
        ).toEqual(['started', 'candidate_locked', 'final_test_started', 'final_test_completed']);
      } catch (error) {
        await transaction.query('ROLLBACK');
        throw error;
      } finally {
        transaction.release();
      }
    }
  );
});
