import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { AflTradeArtifactRef } from '../artifacts/artifactReference';
import {
  aflTradeContentAddressedIdSchema,
  canonicalizeAflTradeJson,
} from '../artifacts/contentAddress';
import type { AflTradeModelRunManifestV3 } from '../artifacts/modelRunManifest';
import {
  AflTradeAdmittedModelRunner,
  createAflTradePrivateValuationModelRunOperationalAuthorization,
} from '../modeling/admittedModelRunAuthority';
import type { AflTradeModelRunPreparation } from '../modeling/postgresAdmittedModelRunAuthority';
import {
  createDispatchBoundGovernedAflTradePickPavModelExecution,
  type GovernedAflTradePickPavModelExecution,
} from '../modeling/governedPickPavModelExecution';
import type { PostgresGovernedPickPavModelExecutionRepository } from '../modeling/postgresGovernedPickPavModelExecutionRepository';
import { aflTradeFinalizedHpnPavCalculationSchema } from '../modeling/hpnPavCalculationService';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  createAflTradePrivateValuationModelOperation,
  createAflTradePrivateValuationModelPairCoordinator,
  type AflTradePrivateValuationModelOperation,
  type AflTradePrivateValuationModelOperationState,
  type AflTradePrivateValuationModelPairExactInput,
  type AflTradePrivateValuationModelPairRepository,
} from './privateValuationModelPair';
import {
  parseAflTradePrivateValuationFactualOutput,
  type AflTradePrivateValuationFactualOutput,
} from './privateValuationFactualOutput';
import type { AflTradePrivateValuationHpnPreparationResult } from './postgresPrivateValuationHpnPreparation';
import {
  createGenuineDispatchBoundPickPavRunner,
  parseGenuineDispatchBoundPickPavExecutionInput,
  type GenuineDispatchBoundPickPavAuthority,
  type GenuineDispatchBoundPickPavExecutionInput,
} from './genuineDispatchBoundPickPav';
import {
  createGovernedValuationComponentRunManifest,
  type GovernedValuationComponentRunManifest,
} from './internal/governedValuationComponentRunManifest';
import {
  createGovernedValuationModelQualification,
  type GovernedValuationModelQualification,
} from './internal/governedValuationModelQualification';
import type { PostgresGovernedValuationComponentRunRepository } from './internal/postgresGovernedValuationComponentRunRepository';
import type { PostgresGovernedValuationModelQualificationRepository } from './internal/postgresGovernedValuationModelQualificationRepository';

const EXECUTION_DATABASE_ROLE = 'afl_trade_private_evaluation_coordinator';
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

interface OperationRow {
  readonly operation_json: unknown;
  readonly player_run_id: string | null;
  readonly pick_run_id: string | null;
  readonly pair_accepted_at: Date | string | null;
  readonly qualification_id: string | null;
  readonly qualification_outcome: 'qualified' | 'failed' | null;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function operationForExactInput(
  exactInput: AflTradePrivateValuationModelPairExactInput
): AflTradePrivateValuationModelOperation {
  return createAflTradePrivateValuationModelOperation({
    scopeKey: exactInput.scopeKey,
    ...exactInput.substantive,
  });
}

async function loadState(
  client: Pick<AflOutcomeSqlClient, 'query'>,
  operationId: string,
  attemptNumber: number
): Promise<AflTradePrivateValuationModelOperationState> {
  const result = await client.query<OperationRow>(
    `SELECT operation_json,player_run_id,pick_run_id,pair_accepted_at,
            qualification_id,qualification_outcome
       FROM outcome_private_valuation_model_operation WHERE operation_id=$1`,
    [operationId]
  );
  if (result.rows.length !== 1) {
    throw new TypeError('Private valuation model operation was not retained exactly once.');
  }
  const row = result.rows[0]!;
  return {
    operation: row.operation_json as AflTradePrivateValuationModelOperation,
    attemptNumber: z.number().int().min(1).max(3).parse(attemptNumber),
    playerRunId: row.player_run_id,
    pickRunId: row.pick_run_id,
    pairAccepted: row.pair_accepted_at !== null,
    qualificationId: row.qualification_id,
    qualificationOutcome: row.qualification_outcome,
  };
}

async function requireLiveOperationClaim(
  transaction: AflOutcomeSqlTransaction,
  input: { readonly operationId: string; readonly claimId: string; readonly leaseToken: string }
): Promise<number> {
  const result = await transaction.query<{
    readonly request_id: string;
    readonly attempt_number: number;
  }>(
    `SELECT binding.request_id,attempt.attempt_number
       FROM outcome_private_valuation_model_request_binding binding
       JOIN outcome_private_valuation_dispatch_request request
         ON request.request_id=binding.request_id AND request.claim_id=$2
       JOIN outcome_private_valuation_dispatch_attempt attempt
         ON attempt.claim_id=request.claim_id AND attempt.finished_at IS NULL
      WHERE binding.operation_id=$1
      ORDER BY binding.request_id LIMIT 1`,
    [input.operationId, input.claimId]
  );
  const row = result.rows[0];
  if (row === undefined) throw new TypeError('Private valuation model operation lost its claim.');
  await transaction.query(
    `SELECT load_outcome_private_valuation_dispatch_request_for_claim($1,$2,$3)`,
    [row.request_id, input.claimId, sha256(input.leaseToken)]
  );
  await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
    `private-valuation-model-operation:${input.operationId}`,
  ]);
  return row.attempt_number;
}

export class PostgresAflTradePrivateValuationModelPairRepository implements AflTradePrivateValuationModelPairRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async bindInput(input: {
    readonly exactInput: AflTradePrivateValuationModelPairExactInput;
    readonly claim: { readonly claimId: string; readonly leaseToken: string };
  }): Promise<AflTradePrivateValuationModelOperationState> {
    const operation = operationForExactInput(input.exactInput);
    return this.client.transaction(async (transaction) => {
      await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
      await transaction.query(
        `SELECT load_outcome_private_valuation_dispatch_request_for_claim($1,$2,$3)`,
        [input.exactInput.requestId, input.claim.claimId, sha256(input.claim.leaseToken)]
      );
      const attempt = await transaction.query<{ readonly attempt_number: number }>(
        `SELECT attempt_number FROM outcome_private_valuation_dispatch_attempt
          WHERE claim_id=$1 AND request_id=$2 AND finished_at IS NULL`,
        [input.claim.claimId, input.exactInput.requestId]
      );
      const attemptNumber = attempt.rows[0]?.attempt_number;
      if (attemptNumber === undefined) throw new TypeError('Dispatch attempt custody is missing.');
      const content = operation.content;
      await transaction.query(
        `INSERT INTO outcome_private_valuation_model_operation
          (operation_id,scope_key,factual_values_sha256,hpn_values_sha256,hpn_method_id,
           player_model_id,player_model_version,player_protocol_id,player_dataset_id,
           player_dataset_admission_id,pick_protocol_id,pick_dataset_id,
           pick_dataset_admission_id,pick_policy_id,qualification_policy_id,
           operation_canonical_json,operation_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)
         ON CONFLICT (operation_id) DO NOTHING`,
        [
          operation.operationId,
          content.scopeKey,
          content.factualValuesSha256,
          content.hpnValuesSha256,
          content.hpnMethodId,
          content.player.modelId,
          content.player.modelVersion,
          content.player.protocolId,
          content.player.datasetId,
          content.player.datasetAdmissionId,
          content.pick.protocolId,
          content.pick.datasetId,
          content.pick.datasetAdmissionId,
          content.pick.policyId,
          content.qualificationPolicyId,
          canonicalizeAflTradeJson(content),
          canonicalizeAflTradeJson(operation),
        ]
      );
      const retained = await transaction.query<{ readonly operation_json: unknown }>(
        `SELECT operation_json FROM outcome_private_valuation_model_operation
          WHERE operation_id=$1 FOR SHARE`,
        [operation.operationId]
      );
      if (
        canonicalizeAflTradeJson(retained.rows[0]?.operation_json) !==
        canonicalizeAflTradeJson(operation)
      ) {
        throw new TypeError('Substantive model operation conflicts with retained custody.');
      }
      await transaction.query(
        `INSERT INTO outcome_private_valuation_model_request_binding
          (request_id,operation_id,factual_output_id,hpn_calculation_id,claim_id,attempt_number)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (request_id) DO NOTHING`,
        [
          input.exactInput.requestId,
          operation.operationId,
          input.exactInput.factualOutputId,
          input.exactInput.hpnCalculationId,
          input.claim.claimId,
          attemptNumber,
        ]
      );
      const binding = await transaction.query<{
        readonly operation_id: string;
        readonly factual_output_id: string;
        readonly hpn_calculation_id: string;
      }>(
        `SELECT operation_id,factual_output_id,hpn_calculation_id
           FROM outcome_private_valuation_model_request_binding WHERE request_id=$1`,
        [input.exactInput.requestId]
      );
      const row = binding.rows[0];
      if (
        row?.operation_id !== operation.operationId ||
        row.factual_output_id !== input.exactInput.factualOutputId ||
        row.hpn_calculation_id !== input.exactInput.hpnCalculationId
      ) {
        throw new TypeError('Dispatch model input conflicts with retained exact lineage.');
      }
      return loadState(transaction, operation.operationId, attemptNumber);
    });
  }

  async acceptComponent(input: {
    readonly operationId: string;
    readonly role: 'player' | 'pick';
    readonly runId: string;
    readonly claim: { readonly claimId: string; readonly leaseToken: string };
  }): Promise<AflTradePrivateValuationModelOperationState> {
    return this.client.transaction(async (transaction) => {
      await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
      const attemptNumber = await requireLiveOperationClaim(transaction, {
        operationId: input.operationId,
        claimId: input.claim.claimId,
        leaseToken: input.claim.leaseToken,
      });
      const prefix = input.role === 'player' ? 'player' : 'pick';
      await transaction.query(
        `UPDATE outcome_private_valuation_model_operation SET
           ${prefix}_run_id=coalesce(${prefix}_run_id,$2),
           ${prefix}_claim_id=coalesce(${prefix}_claim_id,$3),
           ${prefix}_attempt_number=coalesce(${prefix}_attempt_number,$4),
           ${prefix}_accepted_at=coalesce(${prefix}_accepted_at,date_trunc('milliseconds',clock_timestamp()))
         WHERE operation_id=$1`,
        [input.operationId, input.runId, input.claim.claimId, attemptNumber]
      );
      return loadState(transaction, input.operationId, attemptNumber);
    });
  }

  async acceptPair(input: {
    readonly operationId: string;
    readonly playerRunId: string;
    readonly pickRunId: string;
    readonly claim: { readonly claimId: string; readonly leaseToken: string };
  }): Promise<AflTradePrivateValuationModelOperationState> {
    return this.client.transaction(async (transaction) => {
      await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
      const attemptNumber = await requireLiveOperationClaim(transaction, {
        operationId: input.operationId,
        claimId: input.claim.claimId,
        leaseToken: input.claim.leaseToken,
      });
      await transaction.query(
        `UPDATE outcome_private_valuation_model_operation SET
           pair_accepted_at=coalesce(pair_accepted_at,date_trunc('milliseconds',clock_timestamp()))
         WHERE operation_id=$1 AND player_run_id=$2 AND pick_run_id=$3`,
        [input.operationId, input.playerRunId, input.pickRunId]
      );
      return loadState(transaction, input.operationId, attemptNumber);
    });
  }

  async bindQualification(input: {
    readonly operationId: string;
    readonly qualificationId: string;
    readonly outcome: 'qualified' | 'failed';
    readonly claim: { readonly claimId: string; readonly leaseToken: string };
  }): Promise<AflTradePrivateValuationModelOperationState> {
    return this.client.transaction(async (transaction) => {
      await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
      const attemptNumber = await requireLiveOperationClaim(transaction, {
        operationId: input.operationId,
        claimId: input.claim.claimId,
        leaseToken: input.claim.leaseToken,
      });
      await transaction.query(
        `UPDATE outcome_private_valuation_model_operation SET
           qualification_id=coalesce(qualification_id,$2),
           qualification_outcome=coalesce(qualification_outcome,$3),
           qualification_claim_id=coalesce(qualification_claim_id,$4),
           qualification_bound_at=coalesce(qualification_bound_at,date_trunc('milliseconds',clock_timestamp()))
         WHERE operation_id=$1 AND pair_accepted_at IS NOT NULL`,
        [input.operationId, input.qualificationId, input.outcome, input.claim.claimId]
      );
      return loadState(transaction, input.operationId, attemptNumber);
    });
  }
}

export async function loadAflTradePrivateValuationModelPairExactInput(input: {
  readonly client: AflOutcomeSqlClient;
  readonly prepared: AflTradePrivateValuationHpnPreparationResult;
  readonly targets: {
    readonly player: {
      readonly modelId: string;
      readonly modelVersion: string;
      readonly protocolId: string;
      readonly datasetId: string;
      readonly datasetAdmissionId: string;
    };
    readonly pick: {
      readonly protocolId: string;
      readonly datasetId: string;
      readonly datasetAdmissionId: string;
      readonly policyId: string;
    };
    readonly qualificationPolicyId: string;
  };
}): Promise<AflTradePrivateValuationModelPairExactInput> {
  const result = await input.client.query<{
    readonly scope_key: string;
    readonly output_json: unknown;
    readonly calculation_json: unknown;
    readonly hpn_values_sha256: string;
  }>(
    `SELECT request.scope_key,factual.output_json,calculation.calculation_json,
            outcome_private_valuation_hpn_substantive_sha256(
              calculation.calculation_json
            ) AS hpn_values_sha256
       FROM outcome_private_valuation_factual_output factual
       JOIN outcome_private_valuation_dispatch_request request
         ON request.request_id=factual.request_id
       JOIN outcome_hpn_pav_calculation calculation
         ON calculation.calculation_id=$3 AND calculation.status='finalized'
      WHERE factual.request_id=$1 AND factual.output_id=$2
        AND calculation.calculation_json->'content'->>'factualRunId'=factual.factual_run_id`,
    [input.prepared.requestId, input.prepared.factualOutputId, input.prepared.calculationId]
  );
  if (result.rows.length !== 1) {
    throw new TypeError('Exact private factual and HPN model input is unavailable.');
  }
  const row = result.rows[0]!;
  const factual: AflTradePrivateValuationFactualOutput = parseAflTradePrivateValuationFactualOutput(
    row.output_json
  );
  const calculation = aflTradeFinalizedHpnPavCalculationSchema.parse(row.calculation_json);
  const hpnValuesSha256 = sha256Schema.parse(row.hpn_values_sha256);
  return {
    requestId: input.prepared.requestId,
    scopeKey: row.scope_key,
    factualOutputId: factual.outputId,
    hpnCalculationId: calculation.calculationId,
    substantive: {
      factualValuesSha256: factual.content.candidate.memberSetSha256,
      hpnValuesSha256,
      hpnMethodId: calculation.content.methodId,
      player: input.targets.player,
      pick: input.targets.pick,
      qualificationPolicyId: input.targets.qualificationPolicyId,
    },
  };
}

export function createPostgresAflTradePrivateValuationModelPairCoordinator(input: {
  readonly client: AflOutcomeSqlClient;
  readonly hpnPreparation: {
    prepare(value: {
      readonly requestId: string;
      readonly claim: { readonly claimId: string; readonly leaseToken: string };
    }): Promise<AflTradePrivateValuationHpnPreparationResult>;
  };
  readonly targets: Parameters<
    typeof loadAflTradePrivateValuationModelPairExactInput
  >[0]['targets'];
  readonly playerExecutor: Readonly<{
    execute: Parameters<
      typeof createAflTradePrivateValuationModelPairCoordinator
    >[0]['executePlayer'];
  }>;
  readonly pickExecutor: Readonly<{
    execute: Parameters<
      typeof createAflTradePrivateValuationModelPairCoordinator
    >[0]['executePick'];
  }>;
  readonly qualificationRegistrar: Readonly<{
    register: Parameters<typeof createAflTradePrivateValuationModelPairCoordinator>[0]['qualify'];
  }>;
}) {
  return createAflTradePrivateValuationModelPairCoordinator({
    repository: new PostgresAflTradePrivateValuationModelPairRepository(input.client),
    prepareExactInput: async (request) =>
      loadAflTradePrivateValuationModelPairExactInput({
        client: input.client,
        prepared: await input.hpnPreparation.prepare(request),
        targets: input.targets,
      }),
    executePlayer: (request) => input.playerExecutor.execute(request),
    executePick: (request) => input.pickExecutor.execute(request),
    qualify: (request) => input.qualificationRegistrar.register(request),
  });
}

export function createPostgresAflTradePrivateValuationModelPairDispatchRunner(
  input: Parameters<typeof createPostgresAflTradePrivateValuationModelPairCoordinator>[0] & {
    readonly repairCurrent: (
      scopeKey: string,
      reason: string,
      repairOperationId: string
    ) => Promise<unknown>;
  }
) {
  const coordinator = createPostgresAflTradePrivateValuationModelPairCoordinator(input);
  return {
    async run(value: {
      readonly request: { readonly requestId: string };
      readonly claim: { readonly claimId: string; readonly leaseToken: string };
    }) {
      const result = await coordinator.prepare({
        requestId: value.request.requestId,
        claim: value.claim,
      });
      switch (result.state) {
        case 'qualified':
          return { ...result, state: 'activated' as const };
        case 'already_qualified':
          return { state: 'already_current' as const };
        case 'qualification_failed':
        case 'deterministic_failure':
          return { ...result, state: 'unexpected_failure' as const };
        default:
          return result;
      }
    },
    repairCurrent: input.repairCurrent,
  };
}

export type AflTradeDispatchBoundPlayerExecutorInput = Parameters<
  typeof createAflTradePrivateValuationModelPairCoordinator
>[0]['executePlayer'] extends (input: infer Input) => unknown
  ? Input
  : never;

export type AflTradeDispatchBoundPlayerPreparation = Omit<
  AflTradeModelRunPreparation,
  'operationalAuthorization'
> &
  Readonly<{ validThrough: string }>;

const STALE_PLAYER_AUTHORITY_CODES = new Set([
  'ancestry_mismatch',
  'observation_set_mismatch',
  'gate2_not_current',
  'rights_not_current',
  'operational_authorization_invalid',
]);
const TRANSIENT_PLAYER_AUTHORITY_CODES = new Set([
  'evidence_unavailable',
  'authorization_unavailable',
  'authorization_not_consumable',
  'execution_failure_unrecorded',
  'run_persistence_failed',
]);
const STALE_DISPATCH_ADAPTER_ERROR_CODES = new Set(['STALE_GATE_LEDGER', 'STALE_CURRENT_PAIR']);
const STALE_DISPATCH_ADAPTER_ERROR_MESSAGES = new Set([
  'Private valuation dispatch request lookup lost its live claim fence',
  'Private valuation model operation lost its claim.',
  'Dispatch-bound model qualification lost its live claim fence',
]);
const TRANSIENT_DISPATCH_ADAPTER_ERROR_CODES = new Set([
  'STORAGE_UNAVAILABLE',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  '40001',
  '40P01',
  '57P01',
]);

function classifiedDispatchAdapterFailure(error: unknown) {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : null;
  const reason = error instanceof Error ? error.message : 'Private model adapter failed.';
  if (
    (code !== null && STALE_DISPATCH_ADAPTER_ERROR_CODES.has(code)) ||
    STALE_DISPATCH_ADAPTER_ERROR_MESSAGES.has(reason)
  ) {
    return { state: 'stale_authority' as const, reason };
  }
  if (
    code !== null &&
    (TRANSIENT_DISPATCH_ADAPTER_ERROR_CODES.has(code) || code.startsWith('08'))
  ) {
    return { state: 'transient_failure' as const, reason };
  }
  return { state: 'deterministic_failure' as const, reason };
}

export function createAflTradeDispatchBoundAdmittedPlayerExecutor(input: {
  readonly loadRetainedComponent?: (
    value: AflTradeDispatchBoundPlayerExecutorInput
  ) => Promise<{ readonly runId: string } | null>;
  readonly admittedRunner: Pick<AflTradeAdmittedModelRunner, 'run'>;
  readonly authorityPreparation: Readonly<{
    prepare(value: AflTradeModelRunPreparation): Promise<void>;
  }>;
  readonly prepareRun: (
    value: AflTradeDispatchBoundPlayerExecutorInput
  ) => Promise<AflTradeDispatchBoundPlayerPreparation>;
  readonly registerComponent: (value: {
    readonly run: AflTradeModelRunManifestV3;
    readonly execution: AflTradeDispatchBoundPlayerExecutorInput;
  }) => Promise<{ readonly runId: string }>;
}) {
  return {
    async execute(execution: AflTradeDispatchBoundPlayerExecutorInput) {
      try {
        const retained = await input.loadRetainedComponent?.(execution);
        if (retained !== undefined && retained !== null) {
          return { state: 'completed' as const, runId: retained.runId };
        }
        const prepared = await input.prepareRun(execution);
        const intent = prepared.intent;
        const operationalAuthorization =
          createAflTradePrivateValuationModelRunOperationalAuthorization({
            runIntentId: intent.intentId,
            datasetId: intent.content.datasetId,
            datasetAdmissionId: intent.content.datasetAdmissionId,
            modelProtocolId: intent.content.modelProtocolId,
            observationSetId: intent.content.observationSetId,
            dispatchRequestId: execution.exactInput.requestId,
            substantiveOperationId: execution.operation.operationId,
            dispatchClaimId: execution.claim.claimId,
            dispatchAttemptNumber: execution.attemptNumber,
            dispatchLeaseTokenSha256: sha256(execution.claim.leaseToken),
            factualOutputId: execution.exactInput.factualOutputId,
            hpnCalculationId: execution.exactInput.hpnCalculationId,
            factualValuesSha256: execution.exactInput.substantive.factualValuesSha256,
            hpnValuesSha256: execution.exactInput.substantive.hpnValuesSha256,
            authorizedAt: intent.content.startedAt,
            validThrough: prepared.validThrough,
          });
        await input.authorityPreparation.prepare({
          protocol: prepared.protocol,
          observationSet: prepared.observationSet,
          intent,
          operationalAuthorization,
          runStartEvaluationReceipts: prepared.runStartEvaluationReceipts,
        });
        const result = await input.admittedRunner.run({ intent, protocol: prepared.protocol });
        if (result.status === 'completed') {
          const retained = await input.registerComponent({ run: result.run, execution });
          return { state: 'completed' as const, runId: retained.runId };
        }
        if (result.status === 'persistence_failed') {
          return {
            state: 'transient_failure' as const,
            reason: result.blockers[0].message,
          };
        }
        const blocker = result.blockers[0];
        if (blocker === undefined) {
          return { state: 'deterministic_failure' as const, reason: 'Player run was blocked.' };
        }
        if (STALE_PLAYER_AUTHORITY_CODES.has(blocker.code)) {
          return { state: 'stale_authority' as const, reason: blocker.message };
        }
        if (TRANSIENT_PLAYER_AUTHORITY_CODES.has(blocker.code)) {
          return { state: 'transient_failure' as const, reason: blocker.message };
        }
        return { state: 'deterministic_failure' as const, reason: blocker.message };
      } catch (error) {
        return classifiedDispatchAdapterFailure(error);
      }
    },
  };
}

type PickExecutorInput = Parameters<
  typeof createAflTradePrivateValuationModelPairCoordinator
>[0]['executePick'] extends (input: infer Input) => unknown
  ? Input
  : never;

type DispatchBoundPickPreparation = Omit<
  Parameters<typeof createDispatchBoundGovernedAflTradePickPavModelExecution>[0],
  'privateInput'
> &
  Readonly<{ registeredAt: string }>;

type RetainCanonicalArtifact = (input: {
  readonly document:
    | GovernedAflTradePickPavModelExecution
    | GovernedValuationComponentRunManifest
    | GovernedValuationModelQualification;
  readonly createdAt: string;
}) => Promise<AflTradeArtifactRef>;

export function createAflTradeDispatchBoundGovernedPickExecutor(input: {
  readonly runModel: (execution: PickExecutorInput) => Promise<DispatchBoundPickPreparation>;
  readonly loadRetainedComponent?: (
    execution: PickExecutorInput
  ) => Promise<{ readonly runId: string } | null>;
  readonly assertClaim?: (execution: PickExecutorInput) => Promise<void>;
  readonly retainArtifact: RetainCanonicalArtifact;
  readonly executionRepository: Pick<PostgresGovernedPickPavModelExecutionRepository, 'register'>;
  readonly componentRepository: Pick<PostgresGovernedValuationComponentRunRepository, 'register'>;
}) {
  return {
    async execute(execution: PickExecutorInput) {
      try {
        const retained = await input.loadRetainedComponent?.(execution);
        if (retained !== undefined && retained !== null) {
          return {
            state: 'completed' as const,
            runId: aflTradeContentAddressedIdSchema('model-run').parse(retained.runId),
          };
        }
        const prepared = await input.runModel(execution);
        await input.assertClaim?.(execution);
        const governedExecution = createDispatchBoundGovernedAflTradePickPavModelExecution({
          outputs: prepared.outputs,
          completedAt: prepared.completedAt,
          authority: prepared.authority,
          privateInput: {
            requestId: execution.exactInput.requestId,
            operationId: execution.operation.operationId,
            claimId: execution.claim.claimId,
            attemptNumber: execution.attemptNumber,
            leaseTokenSha256: sha256(execution.claim.leaseToken),
            factualOutputId: execution.exactInput.factualOutputId,
            hpnCalculationId: execution.exactInput.hpnCalculationId,
            factualValuesSha256: execution.exactInput.substantive.factualValuesSha256,
            hpnValuesSha256: execution.exactInput.substantive.hpnValuesSha256,
          },
        });
        if (
          governedExecution.content.policyId !== execution.operation.content.pick.policyId ||
          governedExecution.content.protocolId !== execution.operation.content.pick.protocolId ||
          governedExecution.content.datasetId !== execution.operation.content.pick.datasetId ||
          governedExecution.content.datasetAdmissionId !==
            execution.operation.content.pick.datasetAdmissionId
        ) {
          return {
            state: 'deterministic_failure' as const,
            reason: 'Pick execution does not match the substantive operation target.',
          };
        }
        const executionArtifact = await input.retainArtifact({
          document: governedExecution,
          createdAt: prepared.completedAt,
        });
        await input.assertClaim?.(execution);
        const retainedExecution = await input.executionRepository.register({
          execution: governedExecution,
          artifact: executionArtifact,
        });
        await input.assertClaim?.(execution);
        const content = retainedExecution.execution.content;
        const manifest = createGovernedValuationComponentRunManifest({
          environment: 'non_production',
          role: 'draft_pick_and_future_pick_distribution',
          nativeExecution: {
            kind: 'governed_pick_pav_model_execution',
            executionId: retainedExecution.execution.executionId,
            artifact: retainedExecution.artifact,
          },
          protocolId: content.protocolId,
          protocolArtifact: content.protocolArtifact,
          datasetId: content.datasetId,
          datasetArtifact: content.datasetArtifact,
          datasetAdmissionId: content.datasetAdmissionId,
          datasetAdmissionArtifact: content.datasetAdmissionArtifact,
          datasetAdmissionGateLedgerRevision: content.datasetAdmissionGateLedgerRevision,
          registeredAt: prepared.registeredAt,
        });
        const manifestArtifact = await input.retainArtifact({
          document: manifest,
          createdAt: prepared.registeredAt,
        });
        await input.assertClaim?.(execution);
        const retainedComponent = await input.componentRepository.register({
          manifest,
          artifact: manifestArtifact,
        });
        await input.assertClaim?.(execution);
        return { state: 'completed' as const, runId: retainedComponent.manifest.runId };
      } catch (error) {
        return classifiedDispatchAdapterFailure(error);
      }
    },
  };
}

export function createAflTradeGenuineDispatchBoundGovernedPickExecutor(input: {
  readonly loadRetainedComponent?: (
    execution: GenuineDispatchBoundPickPavExecutionInput
  ) => Promise<{ readonly runId: string } | null>;
  readonly loadExactAuthority: (
    execution: GenuineDispatchBoundPickPavExecutionInput
  ) => Promise<GenuineDispatchBoundPickPavAuthority>;
  readonly assertClaim: (execution: GenuineDispatchBoundPickPavExecutionInput) => Promise<void>;
  readonly retainArtifact: RetainCanonicalArtifact;
  readonly executionRepository: Pick<PostgresGovernedPickPavModelExecutionRepository, 'register'>;
  readonly componentRepository: Pick<PostgresGovernedValuationComponentRunRepository, 'register'>;
}) {
  return createAflTradeDispatchBoundGovernedPickExecutor({
    ...(input.loadRetainedComponent === undefined
      ? {}
      : {
          loadRetainedComponent: (execution: GenuineDispatchBoundPickPavExecutionInput) =>
            input.loadRetainedComponent!(parseGenuineDispatchBoundPickPavExecutionInput(execution)),
        }),
    runModel: createGenuineDispatchBoundPickPavRunner({
      loadExactAuthority: input.loadExactAuthority,
    }),
    assertClaim: input.assertClaim,
    retainArtifact: input.retainArtifact,
    executionRepository: input.executionRepository,
    componentRepository: input.componentRepository,
  });
}

type QualificationExecutorInput = Parameters<
  typeof createAflTradePrivateValuationModelPairCoordinator
>[0]['qualify'] extends (input: infer Input) => unknown
  ? Input
  : never;
type QualificationInput = Parameters<typeof createGovernedValuationModelQualification>[0];
type QualificationRegistration = Parameters<
  PostgresGovernedValuationModelQualificationRepository['register']
>[0];

export function createAflTradeDispatchBoundQualificationRegistrar(input: {
  readonly prepareQualification: (
    execution: QualificationExecutorInput
  ) => Promise<QualificationInput>;
  readonly retainArtifact: RetainCanonicalArtifact;
  readonly prepareRegistration: (input: {
    readonly execution: QualificationExecutorInput;
    readonly qualification: GovernedValuationModelQualification;
    readonly qualificationArtifact: AflTradeArtifactRef;
  }) => Promise<Omit<QualificationRegistration, 'qualification' | 'qualificationArtifact'>>;
  readonly repository: Pick<PostgresGovernedValuationModelQualificationRepository, 'register'>;
}) {
  return {
    async register(execution: QualificationExecutorInput) {
      try {
        const prepared = await input.prepareQualification(execution);
        if (
          prepared.scopeKey !== execution.operation.content.scopeKey ||
          prepared.policy.policyVersion !== execution.operation.content.qualificationPolicyId ||
          prepared.components.player.runId !== execution.playerRunId ||
          prepared.components.pick.runId !== execution.pickRunId
        ) {
          throw new TypeError(
            'Qualification input does not match the accepted dispatch-bound pair and policy.'
          );
        }
        const qualification = createGovernedValuationModelQualification(prepared);
        const qualificationArtifact = await input.retainArtifact({
          document: qualification,
          createdAt: qualification.content.evaluatedAt,
        });
        const registration = await input.prepareRegistration({
          execution,
          qualification,
          qualificationArtifact,
        });
        await input.repository.register(
          {
            qualification,
            qualificationArtifact,
            ...registration,
          },
          {
            dispatchClaimFence: {
              requestId: execution.exactInput.requestId,
              claimId: execution.claim.claimId,
              leaseTokenSha256: sha256(execution.claim.leaseToken),
            },
          }
        );
        return {
          qualificationId: qualification.qualificationId,
          outcome: qualification.content.outcome,
        };
      } catch (error) {
        return classifiedDispatchAdapterFailure(error);
      }
    },
  };
}
