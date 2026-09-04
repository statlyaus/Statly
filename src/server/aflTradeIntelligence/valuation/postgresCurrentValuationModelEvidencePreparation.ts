import { createHash } from 'node:crypto';

import { z } from 'zod';

import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  type AflTradeCurrentValuationPreparedModelEvidence,
} from './currentValuationModelEvidence';
import { aflTradeCurrentValuationEvidenceOrchestrationResultSchema } from './currentValuationEvidenceOrchestration';
import {
  createAflTradeCurrentValuationModelEvidencePreparation,
  type AflTradeCurrentValuationModelEvidenceDispatch,
  type AflTradeCurrentValuationModelEvidencePreparationInput,
} from './currentValuationModelEvidencePreparation';
import {
  createPostgresAflTradeCurrentValuationModelEvidenceCoordinator,
  hasExactAflTradeCurrentValuationFactualAuthority,
} from './postgresCurrentValuationModelEvidence';
import { createPostgresAflTradePrivateValuationModelPairCoordinator } from './postgresPrivateValuationModelPair';

const EXECUTION_DATABASE_ROLE = 'afl_trade_private_evaluation_coordinator';

type PairPreparation = Parameters<
  typeof createAflTradeCurrentValuationModelEvidencePreparation
>[0]['pair'];
type TerminalPair = Parameters<
  Parameters<
    typeof createAflTradeCurrentValuationModelEvidencePreparation
  >[0]['evidence']['load']
>[0]['pair'];

interface AuthorityRow {
  readonly result_json: unknown;
}

interface TerminalEvidenceRow {
  readonly scope_key: string;
  readonly factual_output_id: string;
  readonly player_run_id: string;
  readonly pick_run_id: string;
  readonly qualification_id: string;
  readonly qualification_outcome: 'qualified' | 'failed';
  readonly qualification_json: unknown;
  readonly player_role: string;
  readonly player_native_execution_json: unknown;
  readonly pick_role: string;
  readonly pick_native_execution_json: unknown;
  readonly current_qualification_id: string | null;
  readonly player_gate3_decision_id: string | null;
  readonly pick_gate3_decision_id: string | null;
  readonly work_id: string | null;
}

const nativeExecutionSchema = z
  .object({
    content: z.object({ observationSetId: z.string().trim().min(1) }).passthrough(),
  })
  .passthrough();
const qualificationSchema = z
  .object({
    content: z.object({ failureCodes: z.array(z.string().trim().min(1)) }).passthrough(),
  })
  .passthrough();

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function requestMatches(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

async function authenticateWithinTransaction(
  transaction: AflOutcomeSqlTransaction,
  input: {
    readonly current: AflTradeCurrentValuationModelEvidencePreparationInput;
    readonly dispatch: AflTradeCurrentValuationModelEvidenceDispatch;
  }
): Promise<void> {
  await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
  if (!(await hasExactAflTradeCurrentValuationFactualAuthority(transaction, input.current))) {
    throw new TypeError('Current private factual authority is stale or mismatched.');
  }
  const authority = await transaction.query<AuthorityRow>(
    `SELECT result_json FROM load_outcome_current_valuation_evidence($1,$2,$3)`,
    [
      input.current.scopeKey,
      input.dispatch.request.trigger,
      input.dispatch.request.requestId,
    ]
  );
  const row = authority.rows[0];
  const orchestration = aflTradeCurrentValuationEvidenceOrchestrationResultSchema.safeParse(
    row?.result_json
  );
  const factualRefresh =
    orchestration.success && orchestration.data.state === 'complete'
      ? orchestration.data.currentValuationRefresh
      : null;
  if (
    authority.rows.length !== 1 ||
    factualRefresh?.state !== 'factual_refresh_complete' ||
    factualRefresh.operationId !== input.current.factualOperationId ||
    !requestMatches(factualRefresh.privateFactualAuthority, input.current.privateFactualAuthority)
  ) {
    throw new TypeError('Dispatch does not authenticate the exact factual operation.');
  }
  const claim = await transaction.query<{ readonly request_json: unknown }>(
    `SELECT load_outcome_private_valuation_dispatch_request_for_claim($1,$2,$3) AS request_json`,
    [
      input.dispatch.request.requestId,
      input.dispatch.claim.claimId,
      sha256(input.dispatch.claim.leaseToken),
    ]
  );
  if (
    claim.rows.length !== 1 ||
    !requestMatches(claim.rows[0]?.request_json, input.dispatch.request)
  ) {
    throw new TypeError('Dispatch does not authenticate the exact retained request.');
  }
}

function projectTerminalEvidence(
  row: TerminalEvidenceRow,
  pair: TerminalPair,
  expectedScopeKey: string
): AflTradeCurrentValuationPreparedModelEvidence {
  if (
    row.scope_key !== expectedScopeKey ||
    row.qualification_id !== pair.qualificationId ||
    (pair.state === 'qualification_failed') !== (row.qualification_outcome === 'failed') ||
    row.player_role !== 'player_contribution_and_availability' ||
    row.pick_role !== 'draft_pick_and_future_pick_distribution'
  ) {
    throw new TypeError('Retained model evidence does not match the exact terminal pair.');
  }
  const playerObservationSetId = nativeExecutionSchema.parse(
    row.player_native_execution_json
  ).content.observationSetId;
  const pickBenchmarkEvidenceId = nativeExecutionSchema.parse(
    row.pick_native_execution_json
  ).content.observationSetId;
  const common = {
    playerObservationSetId,
    pickBenchmarkEvidenceId,
    playerRunId: row.player_run_id,
    pickRunId: row.pick_run_id,
    qualificationId: row.qualification_id,
  };
  if (row.qualification_outcome === 'failed') {
    return {
      state: 'qualification_failed',
      ...common,
      failureCodes: qualificationSchema.parse(row.qualification_json).content.failureCodes,
    };
  }
  if (
    row.current_qualification_id !== row.qualification_id ||
    row.player_gate3_decision_id === null ||
    row.pick_gate3_decision_id === null ||
    row.work_id === null
  ) {
    throw new TypeError('Qualified terminal pair is not the exact governed current authority.');
  }
  return {
    state: 'qualified',
    ...common,
    qualificationWorkId: row.work_id,
    playerGate3DecisionId: row.player_gate3_decision_id,
    pickGate3DecisionId: row.pick_gate3_decision_id,
  };
}

async function loadTerminalEvidence(
  transaction: AflOutcomeSqlTransaction,
  operationId: string,
  pair: TerminalPair,
  current: AflTradeCurrentValuationModelEvidencePreparationInput,
  dispatch: AflTradeCurrentValuationModelEvidenceDispatch
): Promise<AflTradeCurrentValuationPreparedModelEvidence> {
  const evidence = await transaction.query<TerminalEvidenceRow>(
    `SELECT operation.scope_key,binding.factual_output_id,
            operation.player_run_id,operation.pick_run_id,
            operation.qualification_id,operation.qualification_outcome,
            qualification.qualification_json,
            player.role AS player_role,
            player_evidence.native_execution_json AS player_native_execution_json,
            pick.role AS pick_role,
            pick_evidence.native_execution_json AS pick_native_execution_json,
            current.qualification_id AS current_qualification_id,
            current.player_gate3_decision_id,current.pick_gate3_decision_id,current.work_id
       FROM outcome_private_valuation_model_operation operation
       JOIN outcome_private_valuation_model_request_binding binding
         ON binding.operation_id=operation.operation_id
        AND binding.request_id=$2
       JOIN outcome_governed_valuation_model_qualification qualification
         ON qualification.qualification_id=operation.qualification_id
        AND qualification.scope_key=operation.scope_key
        AND qualification.player_run_id=operation.player_run_id
        AND qualification.pick_run_id=operation.pick_run_id
       JOIN outcome_governed_valuation_component_run player
         ON player.run_id=operation.player_run_id
       JOIN outcome_governed_component_validation_evidence player_evidence
         ON player_evidence.run_id=player.run_id
       JOIN outcome_governed_valuation_component_run pick
         ON pick.run_id=operation.pick_run_id
       JOIN outcome_governed_component_validation_evidence pick_evidence
         ON pick_evidence.run_id=pick.run_id
       LEFT JOIN outcome_current_governed_valuation_model_pair current
         ON current.scope_key=operation.scope_key
        AND current.qualification_id=operation.qualification_id
        AND current.player_run_id=operation.player_run_id
        AND current.pick_run_id=operation.pick_run_id
      WHERE operation.operation_id=$1
        AND operation.pair_accepted_at IS NOT NULL
        AND operation.qualification_bound_at IS NOT NULL`,
    [operationId, dispatch.request.requestId]
  );
  if (evidence.rows.length !== 1) {
    throw new TypeError('Exact retained terminal model evidence is unavailable.');
  }
  const row = evidence.rows[0]!;
  if (
    !(await hasPreparedFactualAncestry(transaction, {
      current,
      dispatch,
      factualOutputId: row.factual_output_id,
    }))
  ) {
    throw new TypeError('Terminal model evidence left the exact current factual custody.');
  }
  return projectTerminalEvidence(row, pair, current.scopeKey);
}

async function assertPreparedFactualAncestry(input: {
  readonly client: AflOutcomeSqlClient;
  readonly current: AflTradeCurrentValuationModelEvidencePreparationInput;
  readonly dispatch: AflTradeCurrentValuationModelEvidenceDispatch;
  readonly factualOutputId: string;
}): Promise<void> {
  await input.client.transaction(async (transaction) => {
    await authenticateWithinTransaction(transaction, input);
    if (!(await hasPreparedFactualAncestry(transaction, input))) {
      throw new TypeError('Prepared model factual input is outside the exact current custody.');
    }
  });
}

async function hasPreparedFactualAncestry(
  transaction: AflOutcomeSqlTransaction,
  input: {
    readonly current: AflTradeCurrentValuationModelEvidencePreparationInput;
    readonly dispatch: AflTradeCurrentValuationModelEvidenceDispatch;
    readonly factualOutputId: string;
  }
): Promise<boolean> {
  const ancestry = await transaction.query<{ readonly exact: boolean }>(
    `SELECT EXISTS (
         SELECT 1
           FROM outcome_private_valuation_factual_output factual
           JOIN outcome_private_factual_candidate candidate
             ON candidate.candidate_id=$3
          WHERE factual.request_id=$1 AND factual.output_id=$2
            AND factual.output_json->'content'->>'schemaVersion'=
              'afl-trade-private-valuation-factual-output/v1'
            AND candidate.candidate_json#>'{content,normalizedReconciledCustody,normalizationRuns}'
              @> jsonb_build_array(jsonb_build_object(
                'normalizationRunId',factual.normalization_run_id
              ))
       ) AS exact`,
    [input.dispatch.request.requestId, input.factualOutputId, input.current.privateFactualAuthority.candidateId]
  );
  return ancestry.rows.length === 1 && ancestry.rows[0]?.exact === true;
}

export function createPostgresAflTradeCurrentValuationModelEvidencePreparation(input: {
  readonly client: AflOutcomeSqlClient;
  readonly dispatch: AflTradeCurrentValuationModelEvidenceDispatch;
  readonly pair: PairPreparation;
}) {
  const authenticate = (value: {
    readonly current: AflTradeCurrentValuationModelEvidencePreparationInput;
    readonly dispatch: AflTradeCurrentValuationModelEvidenceDispatch;
  }) => input.client.transaction((transaction) => authenticateWithinTransaction(transaction, value));

  return createAflTradeCurrentValuationModelEvidencePreparation({
    dispatch: input.dispatch,
    authority: { authenticate },
    pair: input.pair,
    evidence: {
      load: (value) =>
        input.client.transaction(async (transaction) => {
          await authenticateWithinTransaction(transaction, value);
          return loadTerminalEvidence(
            transaction,
            value.pair.operationId,
            value.pair,
            value.current,
            value.dispatch
          );
        }),
    },
  });
}

type ModelPairComposition = Omit<
  Parameters<typeof createPostgresAflTradePrivateValuationModelPairCoordinator>[0],
  'client'
>;

export function composePostgresAflTradeCurrentValuationModelEvidenceDispatch(input: {
  readonly client: AflOutcomeSqlClient;
  readonly dispatch: AflTradeCurrentValuationModelEvidenceDispatch;
  readonly modelPair: ModelPairComposition;
  readonly clock?: { readonly now: () => string };
}) {
  return createPostgresAflTradeCurrentValuationModelEvidenceCoordinator({
    client: input.client,
    authorizeCommit: (transaction, current) =>
      authenticateWithinTransaction(transaction, { current, dispatch: input.dispatch }),
    prepareAndQualify: async (current) => {
      const pair = createPostgresAflTradePrivateValuationModelPairCoordinator({
        client: input.client,
        ...input.modelPair,
        hpnPreparation: {
          prepare: async (request) => {
            const prepared = await input.modelPair.hpnPreparation.prepare(request);
            await assertPreparedFactualAncestry({
              client: input.client,
              current,
              dispatch: input.dispatch,
              factualOutputId: prepared.factualOutputId,
            });
            return prepared;
          },
        },
      });
      return createPostgresAflTradeCurrentValuationModelEvidencePreparation({
        client: input.client,
        dispatch: input.dispatch,
        pair,
      }).prepareAndQualify(current);
    },
    ...(input.clock === undefined ? {} : { clock: input.clock }),
  });
}
