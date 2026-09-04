import { createHash } from 'node:crypto';

import type { GovernedPrivateEvaluationWorkspace } from './governedPrivateEvaluationWorkspace';
import { parseGovernedPrivateEvaluationGeneration } from './governedPrivateEvaluationGeneration';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import {
  AFL_TRADE_PREPARED_VALUATION_INPUT_SET_V3_SCHEMA_VERSION,
  aflTradePreparedValuationInputEntrySchema,
  aflTradePreparedValuationInputSetSchema,
} from './preparedValuationInputSet';
import {
  AflTradePrivateEvaluationCohortStaleAuthorityError,
  aflTradePrivateEvaluationCohortUnexpectedDiagnosticsSchema,
  createAflTradePrivateEvaluationCohortRunner,
  createAflTradePrivateEvaluationCohortRunOperationId,
} from './currentValuationCohortRunner';
import { governedPrivateEvaluationBatchSchema } from './internal/governedPrivateEvaluationBatch';
import {
  GovernedPrivateEvaluationBatchConflictError,
  type PostgresGovernedPrivateEvaluationBatchRepository,
} from './internal/postgresGovernedPrivateEvaluationBatchRepository';
import {
  AFL_TRADE_PRIVATE_EVALUATION_COHORT_EXECUTION_POLICY,
  classifyAflTradePrivateEvaluationExecutionError,
} from './privateEvaluationCohortExecution';
import {
  PostgresAflTradePrivateEvaluationCohortExecutionRepository,
  createAflTradePrivateEvaluationExecutionOperationId,
} from './postgresPrivateEvaluationCohortExecutionRepository';
import { capturePostgresAflTradePrivateEvaluationCohortRepairAuthority } from './internal/postgresPrivateEvaluationCohortRepairAuthority';

interface CaptureRow {
  readonly prepared_input_set_id: string;
  readonly schema_version: string;
  readonly environment: string;
  readonly prepared_revision: number;
  readonly factual_release_id: string;
  readonly factual_release_revision: number;
  readonly qualification_id: string;
  readonly work_id: string;
  readonly model_pair_revision: number;
  readonly batch_json: unknown | null;
  readonly batch_id: string | null;
  readonly batch_revision: number | null;
  readonly transition_id: string | null;
  readonly batch_activated_at: Date | string | null;
  readonly batch_factual_release_revision: number | null;
  readonly batch_model_pair_revision: number | null;
  readonly captured_at: Date | string;
}

interface CaptureCustodyRow {
  readonly scope_key: string;
  readonly prepared_input_set_id: string;
  readonly prepared_input_set_revision: number;
  readonly model_qualification_work_id: string;
  readonly factual_release_revision: number;
  readonly model_pair_revision: number;
  readonly expected_batch_revision: number;
  readonly captured_at: Date | string;
}

interface PrivateAuthorityRow {
  readonly scope_key: string;
  readonly factual_release_scope_key: string;
  readonly factual_release_id: string;
  readonly factual_output_id: string;
  readonly hpn_calculation_id: string;
  readonly model_operation_id: string;
  readonly model_evidence_json: unknown;
}

interface PrivateCaptureRow {
  readonly input_set_json: unknown;
  readonly prepared_revision: number;
  readonly model_pair_revision: number;
  readonly batch_json: unknown | null;
  readonly batch_id: string | null;
  readonly batch_revision: number | null;
  readonly transition_id: string | null;
  readonly batch_activated_at: Date | string | null;
  readonly batch_preparation_operation_id: string | null;
  readonly batch_current_model_evidence_operation_id: string | null;
  readonly batch_dispatch_request_id: string | null;
  readonly batch_factual_output_id: string | null;
  readonly batch_hpn_calculation_id: string | null;
  readonly batch_model_operation_id: string | null;
  readonly batch_model_pair_revision: number | null;
  readonly captured_at: Date | string;
}

interface PrivateCaptureCustodyRow {
  readonly scope_key: string;
  readonly prepared_input_set_id: string;
  readonly prepared_input_set_revision: number;
  readonly preparation_operation_id: string;
  readonly current_model_evidence_operation_id: string;
  readonly dispatch_request_id: string;
  readonly factual_output_id: string;
  readonly hpn_calculation_id: string;
  readonly model_operation_id: string;
  readonly model_qualification_work_id: string;
  readonly model_pair_revision: number;
  readonly expected_batch_revision: number;
  readonly captured_at: Date | string;
}

function instant(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime()))
    throw new TypeError('Cohort runner received invalid PostgreSQL time.');
  return parsed.toISOString();
}

function boundedExecutionMessage(value: unknown): string {
  const normalized = String(value).trim() || 'Unknown thrown value.';
  return Array.from(normalized).slice(0, 4_000).join('');
}

function isLostDispatchClaimFence(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes('Private valuation dispatch request lookup lost its live claim fence')
  );
}

export function createPostgresAflTradePrivateEvaluationCohortRunner(dependencies: {
  readonly client: AflOutcomeSqlClient;
  readonly workspace: GovernedPrivateEvaluationWorkspace;
  readonly batchRepository: PostgresGovernedPrivateEvaluationBatchRepository;
  readonly executionRepository?: PostgresAflTradePrivateEvaluationCohortExecutionRepository;
  readonly workerId?: string;
  readonly heartbeatMilliseconds?: number;
}) {
  const executionRepository =
    dependencies.executionRepository ??
    new PostgresAflTradePrivateEvaluationCohortExecutionRepository(dependencies.client);
  const workerId = dependencies.workerId ?? 'system:weekly-valuation-coordinator';
  const heartbeatMilliseconds =
    dependencies.heartbeatMilliseconds ??
    AFL_TRADE_PRIVATE_EVALUATION_COHORT_EXECUTION_POLICY.heartbeatSeconds * 1_000;
  if (!Number.isSafeInteger(heartbeatMilliseconds) || heartbeatMilliseconds < 1) {
    throw new TypeError('Private evaluation execution heartbeat must be a positive integer.');
  }
  const captureCurrent = async (scopeKey: string) =>
    dependencies.client.transaction(async (transaction) => {
      await transaction.query(`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
      const result = await transaction.query<CaptureRow>(
        `SELECT prepared.prepared_input_set_id,prepared.schema_version,prepared.environment,
              prepared_head.revision AS prepared_revision,
              prepared.factual_release_id,active_release.revision AS factual_release_revision,
              model_head.qualification_id,model_head.work_id,
              model_head.revision AS model_pair_revision,
              batch.batch_json,batch_head.batch_id,batch_head.revision AS batch_revision,
              batch_head.last_transition_id AS transition_id,
              batch_head.activated_at AS batch_activated_at,
              batch_capture.factual_release_revision AS batch_factual_release_revision,
              batch_capture.model_pair_revision AS batch_model_pair_revision,
              date_trunc('milliseconds',transaction_timestamp()) AS captured_at
         FROM outcome_current_prepared_valuation_input_set prepared_head
         JOIN outcome_prepared_valuation_input_set prepared
           ON prepared.prepared_input_set_id=prepared_head.prepared_input_set_id
         JOIN outcome_current_governed_valuation_model_pair model_head
           ON model_head.scope_key=prepared_head.scope_key
         JOIN outcome_active_release active_release
           ON active_release.scope_key=prepared.factual_release_scope_key
          AND active_release.release_id=prepared.factual_release_id
         LEFT JOIN outcome_current_private_evaluation_batch batch_head
           ON batch_head.scope_key=prepared_head.scope_key
         LEFT JOIN outcome_private_evaluation_batch batch ON batch.batch_id=batch_head.batch_id
         LEFT JOIN outcome_private_evaluation_cohort_batch batch_binding
           ON batch_binding.batch_id=batch_head.batch_id
         LEFT JOIN outcome_private_evaluation_cohort_capture batch_capture
           ON batch_capture.operation_id=batch_binding.operation_id
        WHERE prepared_head.scope_key=$1`,
        [scopeKey]
      );
      if (result.rows.length !== 1) {
        throw new AflTradePrivateEvaluationCohortStaleAuthorityError(
          'Current prepared, model, and factual authority is incomplete.'
        );
      }
      const row = result.rows[0]!;
      if (
        row.schema_version !== AFL_TRADE_PREPARED_VALUATION_INPUT_SET_V3_SCHEMA_VERSION ||
        row.environment !== 'non_production'
      ) {
        throw new TypeError(
          'Automatic cohort execution requires authenticated prepared-v3 inputs.'
        );
      }
      const entryRows = await transaction.query<{
        readonly trade_id: string;
        readonly state: 'ready' | 'blocked';
        readonly entry_json: unknown;
      }>(
        `SELECT trade_id,state,entry_json FROM outcome_prepared_valuation_input_entry
        WHERE prepared_input_set_id=$1 ORDER BY ordinal`,
        [row.prepared_input_set_id]
      );
      if (entryRows.rows.length < 1) {
        throw new TypeError('Automatic cohort execution requires exhaustive prepared membership.');
      }
      const expectedBatchRevision = row.batch_revision ?? 0;
      const capture = {
        scopeKey,
        preparedInputSetId: row.prepared_input_set_id,
        preparedInputSetRevision: row.prepared_revision,
        factualReleaseId: row.factual_release_id,
        factualReleaseRevision: row.factual_release_revision,
        modelQualificationId: row.qualification_id,
        modelQualificationWorkId: row.work_id,
        modelPairRevision: row.model_pair_revision,
        expectedBatchRevision,
        entries: entryRows.rows.map((row) => {
          const entry = aflTradePreparedValuationInputEntrySchema.parse(row.entry_json);
          if (entry.tradeId !== row.trade_id || entry.state !== row.state) {
            throw new TypeError(
              'Prepared cohort entry custody disagrees with its relational identity.'
            );
          }
          return entry.state === 'ready'
            ? { tradeId: entry.tradeId, state: 'ready' as const }
            : {
                tradeId: entry.tradeId,
                state: 'unavailable' as const,
                blockers: entry.blockers.map(({ code, subject }) => ({
                  code,
                  message: `${code}: prepared ${subject.kind} ${subject.id} is unavailable.`,
                })),
              };
        }),
        capturedAt: instant(row.captured_at),
      };
      const operationId = createAflTradePrivateEvaluationCohortRunOperationId({
        scopeKey,
        preparedInputSetId: capture.preparedInputSetId,
        preparedInputSetRevision: capture.preparedInputSetRevision,
        modelQualificationWorkId: capture.modelQualificationWorkId,
        factualReleaseRevision: capture.factualReleaseRevision,
        modelPairRevision: capture.modelPairRevision,
        expectedBatchRevision,
      });
      await transaction.query(
        `INSERT INTO outcome_private_evaluation_cohort_capture
          (operation_id,scope_key,prepared_input_set_id,prepared_input_set_revision,
           model_qualification_work_id,factual_release_revision,model_pair_revision,
           expected_batch_revision,captured_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (operation_id) DO NOTHING`,
        [
          operationId,
          scopeKey,
          capture.preparedInputSetId,
          capture.preparedInputSetRevision,
          capture.modelQualificationWorkId,
          capture.factualReleaseRevision,
          capture.modelPairRevision,
          expectedBatchRevision,
          capture.capturedAt,
        ]
      );
      const retainedCapture = await transaction.query<CaptureCustodyRow>(
        `SELECT scope_key,prepared_input_set_id,prepared_input_set_revision,
                model_qualification_work_id,factual_release_revision,model_pair_revision,
                expected_batch_revision,captured_at
           FROM outcome_private_evaluation_cohort_capture WHERE operation_id=$1 FOR KEY SHARE`,
        [operationId]
      );
      const retained = retainedCapture.rows[0];
      if (
        retained === undefined ||
        retainedCapture.rows.length !== 1 ||
        retained.scope_key !== scopeKey ||
        retained.prepared_input_set_id !== capture.preparedInputSetId ||
        retained.prepared_input_set_revision !== capture.preparedInputSetRevision ||
        retained.model_qualification_work_id !== capture.modelQualificationWorkId ||
        retained.factual_release_revision !== capture.factualReleaseRevision ||
        retained.model_pair_revision !== capture.modelPairRevision ||
        retained.expected_batch_revision !== expectedBatchRevision
      ) {
        throw new TypeError(
          'Private evaluation cohort capture replay conflicts with retained custody.'
        );
      }
      const currentBatch =
        row.batch_json === null
          ? null
          : {
              batch: governedPrivateEvaluationBatchSchema.parse(row.batch_json),
              head: {
                scopeKey,
                batchId: row.batch_id!,
                revision: row.batch_revision!,
                transitionId: row.transition_id!,
                activatedAt: instant(row.batch_activated_at!),
              },
              authority:
                row.batch_factual_release_revision === null ||
                row.batch_model_pair_revision === null
                  ? null
                  : {
                      factualReleaseRevision: row.batch_factual_release_revision,
                      modelPairRevision: row.batch_model_pair_revision,
                    },
            };
      return {
        capture: { ...capture, capturedAt: instant(retained.captured_at) },
        currentBatch,
      };
    });

  const capturePrivate = async (input: {
    readonly requestId: string;
    readonly claim: { readonly claimId: string; readonly leaseToken: string };
  }) =>
    dependencies.client.transaction(async (transaction) => {
      await transaction.query(`SET TRANSACTION ISOLATION LEVEL READ COMMITTED`);
      await transaction.query(`SET LOCAL ROLE afl_trade_private_evaluation_coordinator`);
      const leaseTokenSha256 = createHash('sha256')
        .update(input.claim.leaseToken, 'utf8')
        .digest('hex');
      const authenticateClaim = () =>
        transaction.query(
          `SELECT load_outcome_private_valuation_dispatch_request_for_claim($1,$2,$3)`,
          [input.requestId, input.claim.claimId, leaseTokenSha256]
        );
      await authenticateClaim();
      const authorityResult = await transaction.query<PrivateAuthorityRow>(
        `SELECT * FROM load_outcome_private_prepared_v3_authority($1)`,
        [input.requestId]
      );
      const authority = authorityResult.rows[0];
      if (authorityResult.rows.length !== 1 || authority === undefined) {
        throw new AflTradePrivateEvaluationCohortStaleAuthorityError(
          'Dispatch-bound prepared authority is not exact current authority.'
        );
      }
      const result = await transaction.query<PrivateCaptureRow>(
        `SELECT prepared.prepared_set_json AS input_set_json,
                prepared_head.revision AS prepared_revision,
                model.revision AS model_pair_revision,
                batch.batch_json,batch_head.batch_id,batch_head.revision AS batch_revision,
                batch_head.last_transition_id AS transition_id,
                batch_head.activated_at AS batch_activated_at,
                batch_capture.preparation_operation_id AS batch_preparation_operation_id,
                batch_capture.current_model_evidence_operation_id AS batch_current_model_evidence_operation_id,
                batch_capture.dispatch_request_id AS batch_dispatch_request_id,
                batch_capture.factual_output_id AS batch_factual_output_id,
                batch_capture.hpn_calculation_id AS batch_hpn_calculation_id,
                batch_capture.model_operation_id AS batch_model_operation_id,
                batch_capture.model_pair_revision AS batch_model_pair_revision,
                date_trunc('milliseconds',transaction_timestamp()) AS captured_at
           FROM outcome_private_valuation_dispatch_request request
           JOIN outcome_current_prepared_valuation_input_set prepared_head
             ON prepared_head.scope_key=request.scope_key
           JOIN outcome_prepared_valuation_input_set prepared
             ON prepared.prepared_input_set_id=prepared_head.prepared_input_set_id
            AND prepared.prepared_set_json->'content'->>'preparationAuthority'=
                'qualified_current_model_evidence'
           JOIN outcome_current_governed_valuation_model_pair model
             ON model.scope_key=request.scope_key
            AND model.revision=(prepared.prepared_set_json->'content'->'modelEvidence'->>'modelRevision')::integer
            AND model.qualification_id=prepared.prepared_set_json->'content'->'modelEvidence'->>'qualificationId'
            AND model.work_id=prepared.prepared_set_json->'content'->'modelEvidence'->>'qualificationWorkId'
           LEFT JOIN outcome_current_private_evaluation_batch batch_head
             ON batch_head.scope_key=request.scope_key
           LEFT JOIN outcome_private_evaluation_batch batch ON batch.batch_id=batch_head.batch_id
           LEFT JOIN outcome_private_evaluation_cohort_batch batch_binding
             ON batch_binding.batch_id=batch_head.batch_id
           LEFT JOIN outcome_private_evaluation_cohort_capture batch_capture
             ON batch_capture.operation_id=batch_binding.operation_id
          WHERE request.request_id=$1`,
        [input.requestId]
      );
      const row = result.rows[0];
      if (result.rows.length !== 1 || row === undefined) {
        throw new AflTradePrivateEvaluationCohortStaleAuthorityError(
          'Private prepared and model authority is incomplete.'
        );
      }
      const prepared = aflTradePreparedValuationInputSetSchema.parse(row.input_set_json);
      const content = prepared.content;
      if (
        content.schemaVersion !== AFL_TRADE_PREPARED_VALUATION_INPUT_SET_V3_SCHEMA_VERSION ||
        content.preparationAuthority !== 'qualified_current_model_evidence' ||
        content.scopeKey !== authority.scope_key ||
        content.factualReleaseScopeKey !== authority.factual_release_scope_key ||
        content.factualReleaseId !== authority.factual_release_id ||
        content.dispatchAuthority.requestId !== input.requestId ||
        content.dispatchAuthority.factualOutputId !== authority.factual_output_id ||
        content.dispatchAuthority.hpnCalculationId !== authority.hpn_calculation_id ||
        content.dispatchAuthority.modelOperationId !== authority.model_operation_id ||
        canonicalizeAflTradeJson(content.modelEvidence) !==
          canonicalizeAflTradeJson(authority.model_evidence_json) ||
        content.modelEvidence.modelRevision !== row.model_pair_revision
      ) {
        throw new AflTradePrivateEvaluationCohortStaleAuthorityError(
          'Private prepared-v3 content disagrees with exact current dispatch authority.'
        );
      }
      const entryRows = await transaction.query<{
        readonly trade_id: string;
        readonly state: 'ready' | 'blocked';
        readonly entry_json: unknown;
      }>(
        `SELECT trade_id,state,entry_json FROM outcome_prepared_valuation_input_entry
          WHERE prepared_input_set_id=$1 ORDER BY ordinal`,
        [prepared.preparedInputSetId]
      );
      if (entryRows.rows.length !== content.tradeCount) {
        throw new TypeError('Private cohort execution requires exhaustive prepared membership.');
      }
      const expectedBatchRevision = row.batch_revision ?? 0;
      const capture = {
        scopeKey: content.scopeKey,
        preparedInputSetId: prepared.preparedInputSetId,
        preparedInputSetRevision: row.prepared_revision,
        factualReleaseId: content.factualReleaseId,
        modelQualificationId: content.modelEvidence.qualificationId,
        modelQualificationWorkId: content.modelEvidence.qualificationWorkId,
        modelPairRevision: row.model_pair_revision,
        preparationOperationId: content.preparationOperationId,
        currentModelEvidenceOperationId: content.modelEvidence.operationId,
        dispatchAuthority: content.dispatchAuthority,
        expectedBatchRevision,
        entries: entryRows.rows.map((entryRow) => {
          const entry = aflTradePreparedValuationInputEntrySchema.parse(entryRow.entry_json);
          if (entry.tradeId !== entryRow.trade_id || entry.state !== entryRow.state) {
            throw new TypeError('Prepared cohort entry custody disagrees with its identity.');
          }
          return entry.state === 'ready'
            ? { tradeId: entry.tradeId, state: 'ready' as const }
            : {
                tradeId: entry.tradeId,
                state: 'unavailable' as const,
                blockers: entry.blockers.map(({ code, subject }) => ({
                  code,
                  message: `${code}: prepared ${subject.kind} ${subject.id} is unavailable.`,
                })),
              };
        }),
        capturedAt: instant(row.captured_at),
      };
      const operationId = createAflTradePrivateEvaluationCohortRunOperationId({
        scopeKey: capture.scopeKey,
        preparedInputSetId: capture.preparedInputSetId,
        preparedInputSetRevision: capture.preparedInputSetRevision,
        preparationOperationId: capture.preparationOperationId,
        currentModelEvidenceOperationId: capture.currentModelEvidenceOperationId,
        dispatchAuthority: capture.dispatchAuthority,
        modelQualificationWorkId: capture.modelQualificationWorkId,
        modelPairRevision: capture.modelPairRevision,
        expectedBatchRevision,
      });
      await transaction.query(
        `INSERT INTO outcome_private_evaluation_cohort_capture
          (operation_id,scope_key,prepared_input_set_id,prepared_input_set_revision,
           preparation_authority,preparation_operation_id,current_model_evidence_operation_id,
           dispatch_request_id,factual_output_id,hpn_calculation_id,model_operation_id,
           model_qualification_work_id,factual_release_revision,model_pair_revision,
           expected_batch_revision,captured_at)
         VALUES ($1,$2,$3,$4,'qualified_current_model_evidence',$5,$6,$7,$8,$9,$10,$11,NULL,$12,$13,$14)
         ON CONFLICT (operation_id) DO NOTHING`,
        [
          operationId,
          capture.scopeKey,
          capture.preparedInputSetId,
          capture.preparedInputSetRevision,
          capture.preparationOperationId,
          capture.currentModelEvidenceOperationId,
          capture.dispatchAuthority.requestId,
          capture.dispatchAuthority.factualOutputId,
          capture.dispatchAuthority.hpnCalculationId,
          capture.dispatchAuthority.modelOperationId,
          capture.modelQualificationWorkId,
          capture.modelPairRevision,
          expectedBatchRevision,
          capture.capturedAt,
        ]
      );
      const retainedResult = await transaction.query<PrivateCaptureCustodyRow>(
        `SELECT scope_key,prepared_input_set_id,prepared_input_set_revision,
                preparation_operation_id,current_model_evidence_operation_id,
                dispatch_request_id,factual_output_id,hpn_calculation_id,model_operation_id,
                model_qualification_work_id,model_pair_revision,expected_batch_revision,captured_at
           FROM load_outcome_private_evaluation_cohort_capture($1)`,
        [operationId]
      );
      const retained = retainedResult.rows[0];
      if (
        retainedResult.rows.length !== 1 ||
        retained === undefined ||
        retained.scope_key !== capture.scopeKey ||
        retained.prepared_input_set_id !== capture.preparedInputSetId ||
        retained.prepared_input_set_revision !== capture.preparedInputSetRevision ||
        retained.preparation_operation_id !== capture.preparationOperationId ||
        retained.current_model_evidence_operation_id !== capture.currentModelEvidenceOperationId ||
        retained.dispatch_request_id !== capture.dispatchAuthority.requestId ||
        retained.factual_output_id !== capture.dispatchAuthority.factualOutputId ||
        retained.hpn_calculation_id !== capture.dispatchAuthority.hpnCalculationId ||
        retained.model_operation_id !== capture.dispatchAuthority.modelOperationId ||
        retained.model_qualification_work_id !== capture.modelQualificationWorkId ||
        retained.model_pair_revision !== capture.modelPairRevision ||
        retained.expected_batch_revision !== expectedBatchRevision
      ) {
        throw new TypeError('Private cohort capture replay conflicts with retained authority.');
      }
      await authenticateClaim();
      const currentBatch =
        row.batch_json === null
          ? null
          : {
              batch: governedPrivateEvaluationBatchSchema.parse(row.batch_json),
              head: {
                scopeKey: capture.scopeKey,
                batchId: row.batch_id!,
                revision: row.batch_revision!,
                transitionId: row.transition_id!,
                activatedAt: instant(row.batch_activated_at!),
              },
              authority:
                row.batch_preparation_operation_id === null ||
                row.batch_current_model_evidence_operation_id === null ||
                row.batch_dispatch_request_id === null ||
                row.batch_factual_output_id === null ||
                row.batch_hpn_calculation_id === null ||
                row.batch_model_operation_id === null ||
                row.batch_model_pair_revision === null
                  ? null
                  : {
                      preparationOperationId: row.batch_preparation_operation_id,
                      currentModelEvidenceOperationId:
                        row.batch_current_model_evidence_operation_id,
                      dispatchAuthority: {
                        requestId: row.batch_dispatch_request_id,
                        factualOutputId: row.batch_factual_output_id,
                        hpnCalculationId: row.batch_hpn_calculation_id,
                        modelOperationId: row.batch_model_operation_id,
                      },
                      modelPairRevision: row.batch_model_pair_revision,
                    },
            };
      return {
        capture: { ...capture, capturedAt: instant(retained.captured_at) },
        currentBatch,
      };
    });

  const runCaptured = async (
    scopeKey: string,
    captured:
      Awaited<ReturnType<typeof captureCurrent>> | Awaited<ReturnType<typeof capturePrivate>>,
    dispatchClaim?: {
      readonly requestId: string;
      readonly claimId: string;
      readonly leaseToken: string;
    }
  ) => {
    const operationId = createAflTradePrivateEvaluationCohortRunOperationId(
      'dispatchAuthority' in captured.capture
        ? {
            scopeKey,
            preparedInputSetId: captured.capture.preparedInputSetId,
            preparedInputSetRevision: captured.capture.preparedInputSetRevision,
            preparationOperationId: captured.capture.preparationOperationId,
            currentModelEvidenceOperationId: captured.capture.currentModelEvidenceOperationId,
            dispatchAuthority: captured.capture.dispatchAuthority,
            modelQualificationWorkId: captured.capture.modelQualificationWorkId,
            modelPairRevision: captured.capture.modelPairRevision,
            expectedBatchRevision: captured.capture.expectedBatchRevision,
          }
        : {
            scopeKey,
            preparedInputSetId: captured.capture.preparedInputSetId,
            preparedInputSetRevision: captured.capture.preparedInputSetRevision,
            modelQualificationWorkId: captured.capture.modelQualificationWorkId,
            factualReleaseRevision: captured.capture.factualReleaseRevision,
            modelPairRevision: captured.capture.modelPairRevision,
            expectedBatchRevision: captured.capture.expectedBatchRevision,
          }
    );
    let executionCyclePromise: ReturnType<
      PostgresAflTradePrivateEvaluationCohortExecutionRepository['openAutomatic']
    > | null = null;
    const loadExecutionCycle = () => {
      executionCyclePromise ??= executionRepository.openAutomatic({
        authority:
          'dispatchAuthority' in captured.capture
            ? {
                scopeKey,
                preparedInputSetId: captured.capture.preparedInputSetId,
                preparedInputSetRevision: captured.capture.preparedInputSetRevision,
                preparationOperationId: captured.capture.preparationOperationId,
                currentModelEvidenceOperationId: captured.capture.currentModelEvidenceOperationId,
                dispatchAuthority: captured.capture.dispatchAuthority,
                modelQualificationWorkId: captured.capture.modelQualificationWorkId,
                modelPairRevision: captured.capture.modelPairRevision,
              }
            : {
                scopeKey,
                preparedInputSetId: captured.capture.preparedInputSetId,
                preparedInputSetRevision: captured.capture.preparedInputSetRevision,
                factualReleaseRevision: captured.capture.factualReleaseRevision,
                modelQualificationWorkId: captured.capture.modelQualificationWorkId,
                modelPairRevision: captured.capture.modelPairRevision,
              },
        readyTradeIds: captured.capture.entries
          .filter((entry) => entry.state === 'ready')
          .map(({ tradeId }) => tradeId),
        openedAt: captured.capture.capturedAt,
      });
      return executionCyclePromise;
    };
    const runner = createAflTradePrivateEvaluationCohortRunner({
      captureCurrent: async () => captured,
      stageTrade: async (input) => {
        const executionCycle = await loadExecutionCycle();
        const existing = await executionRepository.loadWork(
          executionCycle.cycleId,
          input.selector.tradeId
        );
        if (existing.result !== null) return existing.result;
        if (existing.status === 'exhausted') {
          return {
            state: 'exhausted' as const,
            stage: existing.terminalStage ?? 'stage_automated',
            cause: existing.terminalCause ?? {
              code: 'execution_exhausted',
              message: 'Durable execution exhausted without retained cause.',
              retryable: false,
            },
          };
        }
        const claim = await executionRepository.claim({
          cycleId: executionCycle.cycleId,
          tradeId: input.selector.tradeId,
          workerId,
        });
        if (claim === null) {
          const work = await executionRepository.loadWork(
            executionCycle.cycleId,
            input.selector.tradeId
          );
          if (work.result !== null) return work.result;
          if (work.status === 'exhausted') {
            return {
              state: 'exhausted' as const,
              stage: work.terminalStage ?? 'stage_automated',
              cause: work.terminalCause ?? {
                code: 'execution_exhausted',
                message: 'Durable execution exhausted without retained cause.',
                retryable: false,
              },
            };
          }
          return { state: 'retry_pending' as const, availableAt: work.availableAt };
        }
        let heartbeatFailure: unknown = null;
        let heartbeatInFlight: Promise<void> = Promise.resolve();
        const heartbeatTimer = setInterval(() => {
          heartbeatInFlight = heartbeatInFlight
            .then(async () => {
              if (heartbeatFailure === null) await executionRepository.heartbeat(claim);
            })
            .catch((error: unknown) => {
              heartbeatFailure = error;
            });
        }, heartbeatMilliseconds);
        heartbeatTimer.unref?.();
        const drainHeartbeat = async () => {
          clearInterval(heartbeatTimer);
          await heartbeatInFlight;
        };
        const stopHeartbeat = async () => {
          await drainHeartbeat();
          if (heartbeatFailure !== null) throw heartbeatFailure;
        };
        let completing = false;
        try {
          const staged = await dependencies.workspace.stageAutomated({
            ...input,
            operationId: createAflTradePrivateEvaluationExecutionOperationId({
              cycleId: executionCycle.cycleId,
              tradeId: input.selector.tradeId,
            }),
          });
          if (heartbeatFailure !== null) throw heartbeatFailure;
          if (staged.state === 'stale_authority') {
            await stopHeartbeat();
            completing = true;
            await executionRepository.complete({
              claim,
              outcome: 'permanent_failure',
              stage: 'stage_automated',
              cause: {
                code: 'stale_authority',
                message: 'Governed authority changed while the trade was staged.',
                retryable: false,
              },
              result: null,
            });
            return staged;
          }
          if (staged.state === 'unavailable') {
            const result = { state: 'unavailable' as const, blockers: staged.blockers };
            await stopHeartbeat();
            completing = true;
            await executionRepository.complete({
              claim,
              outcome: 'unavailable',
              stage: null,
              cause: null,
              result,
            });
            return result;
          }
          if (staged.state !== 'activated') return staged;
          const retained = await dependencies.client.query<{
            readonly generation_json: unknown;
          }>(
            `SELECT generation_json
                 FROM outcome_local_private_trade_evaluation_generation
                WHERE valuation_scope_key=$1 AND trade_id=$2 AND generation_id=$3`,
            [input.selector.valuationScopeKey, input.selector.tradeId, staged.generationId]
          );
          if (retained.rows.length !== 1) {
            throw new TypeError(
              'Activated private evaluation generation is missing exact retained custody.'
            );
          }
          const generation = parseGovernedPrivateEvaluationGeneration(
            retained.rows[0]!.generation_json
          );
          if (
            generation.generationId !== staged.generationId ||
            generation.content.selector.valuationScopeKey !== input.selector.valuationScopeKey ||
            generation.content.selector.tradeId !== input.selector.tradeId
          ) {
            throw new TypeError(
              'Activated private evaluation generation escaped its retained selector custody.'
            );
          }
          const result = {
            state: 'activated' as const,
            generationId: staged.generationId,
            generatedAt: generation.content.generatedAt,
          };
          await stopHeartbeat();
          completing = true;
          await executionRepository.complete({
            claim,
            outcome: 'succeeded',
            stage: null,
            cause: null,
            result,
          });
          return result;
        } catch (error) {
          if (completing) throw error;
          await drainHeartbeat();
          const transientCause = classifyAflTradePrivateEvaluationExecutionError(error);
          const cause =
            transientCause ??
            ({
              code: 'unexpected_execution_failure',
              message: boundedExecutionMessage(error instanceof Error ? error.message : error),
              retryable: false,
            } as const);
          const status = await executionRepository.complete({
            claim,
            outcome: cause.retryable ? 'transient_failure' : 'permanent_failure',
            stage: 'stage_automated',
            cause,
            result: null,
          });
          if (cause.retryable) {
            const work = await executionRepository.loadWork(
              executionCycle.cycleId,
              input.selector.tradeId
            );
            return status === 'exhausted'
              ? { state: 'exhausted' as const, stage: 'stage_automated', cause }
              : { state: 'retry_pending' as const, availableAt: work.availableAt };
          }
          throw error;
        } finally {
          clearInterval(heartbeatTimer);
          await heartbeatInFlight;
        }
      },
      retainUnexpectedDiagnostics: async ({ request, capture, diagnostics }) => {
        const existing = await dependencies.client.query<{
          readonly diagnostic_json: {
            readonly content?: { readonly diagnostics?: unknown };
          };
        }>(
          `SELECT diagnostic_json FROM outcome_private_evaluation_cohort_failure WHERE operation_id=$1`,
          [request.operationId]
        );
        if (existing.rows[0]?.diagnostic_json.content?.diagnostics !== undefined) {
          return aflTradePrivateEvaluationCohortUnexpectedDiagnosticsSchema.parse(
            existing.rows[0].diagnostic_json.content.diagnostics
          );
        }
        const recordedAt = instant(
          (
            await dependencies.client.query<{ readonly trusted_at: Date | string }>(
              `SELECT date_trunc('milliseconds',transaction_timestamp()) AS trusted_at`
            )
          ).rows[0]!.trusted_at
        );
        const content = {
          schemaVersion: 'private-evaluation-cohort-failure/v1',
          environment: 'non_production',
          operationId: request.operationId,
          scopeKey: request.scopeKey,
          preparedInputSetId: capture.preparedInputSetId,
          preparedInputSetRevision: capture.preparedInputSetRevision,
          modelQualificationWorkId: capture.modelQualificationWorkId,
          expectedBatchRevision: capture.expectedBatchRevision,
          diagnostics,
          recordedAt,
          publicationEligible: false,
          limitation:
            'Private engineering diagnostics only; no factual, model, production, or publication authority.',
        } as const;
        const diagnosticId = createAflTradeContentAddress(
          'private-evaluation-cohort-failure',
          content
        );
        const document = { diagnosticId, content };
        await dependencies.client.query(
          `INSERT INTO outcome_private_evaluation_cohort_failure
              (diagnostic_id,operation_id,scope_key,prepared_input_set_id,
               prepared_input_set_revision,model_qualification_work_id,
               expected_batch_revision,diagnostic_json,recorded_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
             ON CONFLICT (operation_id) DO NOTHING`,
          [
            diagnosticId,
            request.operationId,
            request.scopeKey,
            capture.preparedInputSetId,
            capture.preparedInputSetRevision,
            capture.modelQualificationWorkId,
            capture.expectedBatchRevision,
            canonicalizeAflTradeJson(document),
            recordedAt,
          ]
        );
        const retained = await dependencies.client.query<{
          readonly diagnostic_json: {
            readonly content?: { readonly diagnostics?: unknown };
          };
        }>(
          `SELECT diagnostic_json FROM outcome_private_evaluation_cohort_failure WHERE operation_id=$1`,
          [request.operationId]
        );
        const retainedDiagnostics = retained.rows[0]?.diagnostic_json.content?.diagnostics;
        return aflTradePrivateEvaluationCohortUnexpectedDiagnosticsSchema.parse(
          retainedDiagnostics
        );
      },
      registerBatch: async (batch) => {
        try {
          const retained = await dependencies.batchRepository.register(batch);
          await dependencies.client.query(
            `INSERT INTO outcome_private_evaluation_cohort_batch(batch_id,operation_id)
               VALUES ($1,$2) ON CONFLICT (batch_id) DO NOTHING`,
            [retained.batchId, operationId]
          );
          const binding = await dependencies.client.query<{ readonly operation_id: string }>(
            `SELECT operation_id FROM outcome_private_evaluation_cohort_batch WHERE batch_id=$1`,
            [retained.batchId]
          );
          if (binding.rows.length !== 1 || binding.rows[0]?.operation_id !== operationId) {
            throw new TypeError(
              'Private evaluation cohort batch replay conflicts with captured authority.'
            );
          }
          return retained;
        } catch (error) {
          if (error instanceof GovernedPrivateEvaluationBatchConflictError) {
            throw new AflTradePrivateEvaluationCohortStaleAuthorityError(error.message);
          }
          throw error;
        }
      },
      advanceBatch: async (input) => {
        try {
          return dispatchClaim === undefined
            ? await dependencies.batchRepository.advance(input)
            : await dependencies.batchRepository.advanceFromDispatchClaim({
                ...input,
                dispatchClaim,
              });
        } catch (error) {
          if (error instanceof GovernedPrivateEvaluationBatchConflictError) {
            throw new AflTradePrivateEvaluationCohortStaleAuthorityError(error.message);
          }
          throw error;
        }
      },
    });
    return runner.run({ scopeKey, operationId });
  };

  async function captureOrStale<T>(capture: () => Promise<T>): Promise<T | null> {
    try {
      return await capture();
    } catch (error) {
      if (
        error instanceof AflTradePrivateEvaluationCohortStaleAuthorityError ||
        isLostDispatchClaimFence(error)
      ) {
        return null;
      }
      throw error;
    }
  }

  async function loadRepairReplay(scopeKey: string, reason: string, repairOperationId: string) {
    const replay = await executionRepository.loadRepair(repairOperationId);
    if (
      replay !== null &&
      (replay.content.authority.scopeKey !== scopeKey || replay.content.repairReason !== reason)
    ) {
      throw new TypeError('Explicit repair replay conflicts with retained custody.');
    }
    return replay;
  }

  return {
    async runCurrent(scopeKey: string) {
      const captured = await captureOrStale(() => captureCurrent(scopeKey));
      return captured === null
        ? { state: 'stale_authority' as const }
        : runCaptured(scopeKey, captured);
    },
    async runPrivate(input: {
      readonly request: { readonly requestId: string; readonly scopeKey: string };
      readonly claim: { readonly claimId: string; readonly leaseToken: string };
    }) {
      const captured = await captureOrStale(() =>
        capturePrivate({ requestId: input.request.requestId, claim: input.claim })
      );
      if (captured === null) return { state: 'stale_authority' as const };
      if (captured.capture.scopeKey !== input.request.scopeKey) {
        throw new TypeError('Claimed private cohort request escaped its retained scope.');
      }
      return runCaptured(input.request.scopeKey, captured, {
        requestId: input.request.requestId,
        ...input.claim,
      });
    },
    async repairCurrent(scopeKey: string, reason: string, repairOperationId: string) {
      const replay = await loadRepairReplay(scopeKey, reason, repairOperationId);
      if (replay !== null) return replay;
      const captured = await captureCurrent(scopeKey);
      return executionRepository.openRepair({
        authority: {
          scopeKey,
          preparedInputSetId: captured.capture.preparedInputSetId,
          preparedInputSetRevision: captured.capture.preparedInputSetRevision,
          factualReleaseRevision: captured.capture.factualReleaseRevision,
          modelQualificationWorkId: captured.capture.modelQualificationWorkId,
          modelPairRevision: captured.capture.modelPairRevision,
        },
        readyTradeIds: captured.capture.entries
          .filter((entry) => entry.state === 'ready')
          .map(({ tradeId }) => tradeId),
        repairOperationId,
        reason,
      });
    },
    async repairPrivateCurrent(scopeKey: string, reason: string, repairOperationId: string) {
      const replay = await loadRepairReplay(scopeKey, reason, repairOperationId);
      if (replay !== null) return replay;
      const captured = await capturePostgresAflTradePrivateEvaluationCohortRepairAuthority(
        dependencies.client,
        scopeKey
      );
      return executionRepository.openRepair({
        authority: captured.authority,
        readyTradeIds: captured.readyTradeIds,
        repairOperationId,
        reason,
      });
    },
  };
}
