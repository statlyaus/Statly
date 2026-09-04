import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  aflTradeCurrentValuationModelEvidenceResultSchema,
  createAflTradeCurrentValuationModelEvidenceCoordinator,
  type AflTradeCurrentValuationModelEvidenceRepository,
  type AflTradeCurrentValuationModelEvidenceResult,
  type AflTradeCurrentValuationModelEvidenceRequest,
} from './currentValuationModelEvidence';

const EXECUTION_DATABASE_ROLE = 'afl_trade_private_evaluation_coordinator';

interface RetainedRow {
  readonly result_json: unknown;
}

type ModelEvidenceResult = AflTradeCurrentValuationModelEvidenceResult;
export type AflTradeCurrentValuationModelEvidenceCommitAuthorization = (
  transaction: AflOutcomeSqlTransaction,
  result: ModelEvidenceResult
) => Promise<void>;

function resultsMatch(left: ModelEvidenceResult, right: ModelEvidenceResult): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

function parseMatchingReplay(
  resultJson: unknown,
  result: ModelEvidenceResult
): ModelEvidenceResult {
  const replay = aflTradeCurrentValuationModelEvidenceResultSchema.parse(resultJson);
  if (!resultsMatch(replay, result)) {
    throw new TypeError('Current model evidence replay conflicts with retained custody.');
  }
  return replay;
}

async function loadRetainedResult(
  transaction: AflOutcomeSqlTransaction,
  operationId: string
): Promise<unknown | undefined> {
  const retained = await transaction.query<RetainedRow>(
    `SELECT result_json
       FROM outcome_current_valuation_model_evidence_operation
      WHERE operation_id=$1`,
    [operationId]
  );
  return retained.rows[0]?.result_json;
}

async function hasExactFactualAuthority(
  transaction: AflOutcomeSqlTransaction,
  result: AflTradeCurrentValuationModelEvidenceRequest
): Promise<boolean> {
  const factual = await transaction.query<{
    readonly candidate_id: string;
    readonly revision: number;
    readonly valuation_scope_key: string;
    readonly evidence_scope_key: string;
    readonly evidence_bundle_id: string;
    readonly review_decision_id: string;
    readonly normalized_reconciled_custody_sha256: string;
  }>(
    `SELECT head.candidate_id,head.revision,candidate.valuation_scope_key,
            candidate.evidence_scope_key,candidate.evidence_bundle_id,
            candidate.review_decision_id,candidate.normalized_reconciled_custody_sha256
       FROM outcome_current_private_factual_authority head
       JOIN outcome_private_factual_candidate candidate
         ON candidate.candidate_id=head.candidate_id
      WHERE head.valuation_scope_key=$1`,
    [result.scopeKey]
  );
  const head = factual.rows[0];
  return (
    head?.candidate_id === result.privateFactualAuthority.candidateId &&
    head.revision === result.privateFactualAuthority.revision &&
    head.valuation_scope_key === result.privateFactualAuthority.valuationScopeKey &&
    head.evidence_scope_key === result.privateFactualAuthority.evidenceScopeKey &&
    head.evidence_bundle_id === result.privateFactualAuthority.evidenceBundleId &&
    head.review_decision_id === result.privateFactualAuthority.reviewDecisionId &&
    head.normalized_reconciled_custody_sha256 ===
      result.privateFactualAuthority.normalizedReconciledCustodySha256
  );
}

async function hasExactFactualOperation(
  transaction: AflOutcomeSqlTransaction,
  result: AflTradeCurrentValuationModelEvidenceRequest
): Promise<boolean> {
  const operation = await transaction.query<{
    readonly scope_key: string;
    readonly candidate_id: string;
    readonly private_factual_revision: number;
  }>(
    `SELECT scope_key,candidate_id,private_factual_revision
       FROM outcome_current_valuation_factual_refresh_operation
      WHERE operation_id=$1 AND state='factual_refresh_complete'`,
    [result.factualOperationId]
  );
  const exact = operation.rows[0];
  return (
    operation.rows.length === 1 &&
    exact?.scope_key === result.scopeKey &&
    exact.candidate_id === result.privateFactualAuthority.candidateId &&
    exact.private_factual_revision === result.privateFactualAuthority.revision
  );
}

export async function hasExactAflTradeCurrentValuationFactualAuthority(
  transaction: AflOutcomeSqlTransaction,
  request: AflTradeCurrentValuationModelEvidenceRequest
): Promise<boolean> {
  return (
    (await hasExactFactualAuthority(transaction, request)) &&
    (await hasExactFactualOperation(transaction, request))
  );
}

async function reconcileModelAuthority(
  transaction: AflOutcomeSqlTransaction,
  result: ModelEvidenceResult
): Promise<ModelEvidenceResult | null> {
  const model = await transaction.query<{
    readonly revision: number;
    readonly qualification_id: string;
    readonly player_run_id: string;
    readonly pick_run_id: string;
    readonly player_gate3_decision_id: string;
    readonly pick_gate3_decision_id: string;
    readonly work_id: string;
  }>(
    `SELECT revision,qualification_id,player_run_id,pick_run_id,
            player_gate3_decision_id,pick_gate3_decision_id,work_id
       FROM outcome_current_governed_valuation_model_pair
      WHERE scope_key=$1`,
    [result.scopeKey]
  );
  const head = model.rows[0];
  const currentRevision = head?.revision ?? 0;
  if (result.state === 'qualification_failed') {
    return currentRevision === result.expectedModelRevision ? result : null;
  }
  const identifiersMatch =
    head?.qualification_id === result.qualificationId &&
    head.player_run_id === result.playerRunId &&
    head.pick_run_id === result.pickRunId &&
    head.player_gate3_decision_id === result.playerGate3DecisionId &&
    head.pick_gate3_decision_id === result.pickGate3DecisionId &&
    head.work_id === result.qualificationWorkId;
  if (!identifiersMatch) return null;
  if (currentRevision === result.expectedModelRevision + 1) return result;
  if (currentRevision !== result.expectedModelRevision) return null;
  return aflTradeCurrentValuationModelEvidenceResultSchema.parse({
    ...result,
    expectedModelRevision: result.expectedModelRevision - 1,
    modelRevision: result.modelRevision - 1,
  });
}

async function hasExactQualifiedComponents(
  transaction: AflOutcomeSqlTransaction,
  result: Extract<ModelEvidenceResult, { readonly state: 'qualified' }>
): Promise<boolean> {
  const componentEvidence = await transaction.query<{
    readonly run_id: string;
    readonly role: string;
    readonly observation_set_id: string;
  }>(
    `SELECT run.run_id,run.role,
            evidence.native_execution_json->'content'->>'observationSetId' AS observation_set_id
       FROM outcome_governed_valuation_component_run run
       JOIN outcome_governed_component_validation_evidence evidence ON evidence.run_id=run.run_id
      WHERE run.run_id IN ($1,$2)`,
    [result.playerRunId, result.pickRunId]
  );
  const player = componentEvidence.rows.find(
    ({ role }) => role === 'player_contribution_and_availability'
  );
  const pick = componentEvidence.rows.find(
    ({ role }) => role === 'draft_pick_and_future_pick_distribution'
  );
  return (
    componentEvidence.rows.length === 2 &&
    player?.run_id === result.playerRunId &&
    player.observation_set_id === result.playerObservationSetId &&
    pick?.run_id === result.pickRunId &&
    pick.observation_set_id === result.pickBenchmarkEvidenceId
  );
}

async function assertExactFailedQualification(
  transaction: AflOutcomeSqlTransaction,
  result: Extract<ModelEvidenceResult, { readonly state: 'qualification_failed' }>
): Promise<void> {
  const failed = await transaction.query<{
    readonly qualification_id: string;
    readonly failure_codes: unknown;
  }>(
    `SELECT qualification_id,qualification_json->'content'->'failureCodes' AS failure_codes
       FROM outcome_governed_valuation_model_qualification
      WHERE qualification_id=$1 AND scope_key=$2 AND outcome='failed'
        AND player_run_id=$3 AND pick_run_id=$4`,
    [result.qualificationId, result.scopeKey, result.playerRunId, result.pickRunId]
  );
  if (
    failed.rows.length !== 1 ||
    canonicalizeAflTradeJson(failed.rows[0]!.failure_codes) !==
      canonicalizeAflTradeJson(result.failureCodes)
  ) {
    throw new TypeError('Failed current model qualification lacks exact retained evidence.');
  }
}

async function insertResult(
  transaction: AflOutcomeSqlTransaction,
  result: ModelEvidenceResult
): Promise<ModelEvidenceResult> {
  const inserted = await transaction.query<{ readonly operation_id: string }>(
    `INSERT INTO outcome_current_valuation_model_evidence_operation
      (operation_id,scope_key,factual_operation_id,factual_candidate_id,
       factual_revision,expected_model_revision,result_state,result_json,
       captured_at,completed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
     ON CONFLICT (operation_id) DO NOTHING
     RETURNING operation_id`,
    [
      result.operationId,
      result.scopeKey,
      result.factualOperationId,
      result.privateFactualAuthority.candidateId,
      result.privateFactualAuthority.revision,
      result.expectedModelRevision,
      result.state,
      canonicalizeAflTradeJson(result),
      result.capturedAt,
      result.completedAt,
    ]
  );
  if (inserted.rows.length > 0) return result;
  return parseMatchingReplay(await loadRetainedResult(transaction, result.operationId), result);
}

async function commitResult(
  transaction: AflOutcomeSqlTransaction,
  unparsedResult: ModelEvidenceResult,
  authorizeCommit?: AflTradeCurrentValuationModelEvidenceCommitAuthorization
) {
  await transaction.query(`SET LOCAL TRANSACTION ISOLATION LEVEL SERIALIZABLE`);
  await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
  const parsedResult = aflTradeCurrentValuationModelEvidenceResultSchema.parse(unparsedResult);
  await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
    parsedResult.operationId,
  ]);
  await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
    `current-governed-valuation-model-pair:${parsedResult.scopeKey}`,
  ]);
  const retained = await loadRetainedResult(transaction, parsedResult.operationId);
  if (retained !== undefined) {
    return { state: 'committed' as const, result: parseMatchingReplay(retained, parsedResult) };
  }
  await authorizeCommit?.(transaction, parsedResult);
  if (!(await hasExactAflTradeCurrentValuationFactualAuthority(transaction, parsedResult))) {
    return { state: 'stale_authority' as const };
  }
  const result = await reconcileModelAuthority(transaction, parsedResult);
  if (result === null) return { state: 'stale_authority' as const };
  if (result.state === 'qualified' && !(await hasExactQualifiedComponents(transaction, result))) {
    return { state: 'stale_authority' as const };
  }
  if (result.state === 'qualification_failed') {
    await assertExactFailedQualification(transaction, result);
  }
  return { state: 'committed' as const, result: await insertResult(transaction, result) };
}

export class PostgresAflTradeCurrentValuationModelEvidenceRepository implements AflTradeCurrentValuationModelEvidenceRepository {
  constructor(
    private readonly client: AflOutcomeSqlClient,
    private readonly authorizeCommit?: AflTradeCurrentValuationModelEvidenceCommitAuthorization
  ) {}

  async load(operationId: string): Promise<AflTradeCurrentValuationModelEvidenceResult | null> {
    const retained = await this.client.query<RetainedRow>(
      `SELECT result_json
         FROM outcome_current_valuation_model_evidence_operation
        WHERE operation_id=$1`,
      [operationId]
    );
    if (retained.rows.length > 1) {
      throw new TypeError('Current model evidence operation was retained more than once.');
    }
    const row = retained.rows[0];
    if (row === undefined) return null;
    const result = aflTradeCurrentValuationModelEvidenceResultSchema.parse(row.result_json);
    if (result.operationId !== operationId) {
      throw new TypeError('Current model evidence lookup returned another operation.');
    }
    return result;
  }

  async commit(input: {
    readonly expectedModelRevision: number;
    readonly result: AflTradeCurrentValuationModelEvidenceResult;
  }) {
    try {
      return await this.client.transaction((transaction) =>
        commitResult(transaction, input.result, this.authorizeCommit)
      );
    } catch (error) {
      if (
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        error.code !== '40001'
      ) {
        throw error;
      }
      const retained = await this.load(input.result.operationId);
      if (retained === null) return { state: 'stale_authority' as const };
      parseMatchingReplay(retained, input.result);
      return { state: 'committed' as const, result: retained };
    }
  }
}

export function createPostgresAflTradeCurrentValuationModelEvidenceCoordinator(input: {
  readonly client: AflOutcomeSqlClient;
  readonly prepareAndQualify: Parameters<
    typeof createAflTradeCurrentValuationModelEvidenceCoordinator
  >[0]['prepareAndQualify'];
  readonly authorizeCommit?: AflTradeCurrentValuationModelEvidenceCommitAuthorization;
  readonly clock?: { readonly now: () => string };
}) {
  return createAflTradeCurrentValuationModelEvidenceCoordinator({
    repository: new PostgresAflTradeCurrentValuationModelEvidenceRepository(
      input.client,
      input.authorizeCommit
    ),
    captureCurrentModelRevision: async (scopeKey) => {
      const current = await input.client.query<{ readonly revision: number }>(
        `SELECT revision FROM outcome_current_governed_valuation_model_pair WHERE scope_key=$1`,
        [scopeKey]
      );
      return current.rows[0]?.revision ?? 0;
    },
    prepareAndQualify: input.prepareAndQualify,
    clock: input.clock ?? { now: () => new Date().toISOString() },
  });
}

export type AflTradePostgresCurrentValuationModelEvidenceRequest =
  AflTradeCurrentValuationModelEvidenceRequest;
