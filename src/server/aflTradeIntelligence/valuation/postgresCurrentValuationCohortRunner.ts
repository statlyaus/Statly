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

export function createPostgresAflTradePrivateEvaluationCohortRunner(dependencies: {
  readonly client: AflOutcomeSqlClient;
  readonly workspace: GovernedPrivateEvaluationWorkspace;
  readonly batchRepository: PostgresGovernedPrivateEvaluationBatchRepository;
  readonly executionRepository?: PostgresAflTradePrivateEvaluationCohortExecutionRepository;
  readonly workerId?: string;
}) {
  const executionRepository =
    dependencies.executionRepository ??
    new PostgresAflTradePrivateEvaluationCohortExecutionRepository(dependencies.client);
  const workerId = dependencies.workerId ?? 'system:weekly-valuation-coordinator';
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

  return {
    async runCurrent(scopeKey: string) {
      let captured: Awaited<ReturnType<typeof captureCurrent>>;
      try {
        captured = await captureCurrent(scopeKey);
      } catch (error) {
        if (error instanceof AflTradePrivateEvaluationCohortStaleAuthorityError) {
          return { state: 'stale_authority' as const };
        }
        throw error;
      }
      const operationId = createAflTradePrivateEvaluationCohortRunOperationId({
        scopeKey,
        preparedInputSetId: captured.capture.preparedInputSetId,
        preparedInputSetRevision: captured.capture.preparedInputSetRevision,
        modelQualificationWorkId: captured.capture.modelQualificationWorkId,
        factualReleaseRevision: captured.capture.factualReleaseRevision,
        modelPairRevision: captured.capture.modelPairRevision,
        expectedBatchRevision: captured.capture.expectedBatchRevision,
      });
      let executionCyclePromise: ReturnType<
        PostgresAflTradePrivateEvaluationCohortExecutionRepository['openAutomatic']
      > | null = null;
      const loadExecutionCycle = () => {
        executionCyclePromise ??= executionRepository.openAutomatic({
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
          }, AFL_TRADE_PRIVATE_EVALUATION_COHORT_EXECUTION_POLICY.heartbeatSeconds * 1_000);
          heartbeatTimer.unref?.();
          const stopHeartbeat = async () => {
            clearInterval(heartbeatTimer);
            await heartbeatInFlight;
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
              completing = true;
              await stopHeartbeat();
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
              completing = true;
              await stopHeartbeat();
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
            completing = true;
            await stopHeartbeat();
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
            const transientCause = classifyAflTradePrivateEvaluationExecutionError(error);
            const cause =
              transientCause ??
              ({
                code: 'unexpected_execution_failure',
                message: boundedExecutionMessage(error instanceof Error ? error.message : error),
                retryable: false,
              } as const);
            await stopHeartbeat();
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
            return await dependencies.batchRepository.advance(input);
          } catch (error) {
            if (error instanceof GovernedPrivateEvaluationBatchConflictError) {
              throw new AflTradePrivateEvaluationCohortStaleAuthorityError(error.message);
            }
            throw error;
          }
        },
      });
      return runner.run({ scopeKey, operationId });
    },
    async repairCurrent(scopeKey: string, reason: string, repairOperationId: string) {
      const replay = await executionRepository.loadRepair(repairOperationId);
      if (replay !== null) {
        if (
          replay.content.authority.scopeKey !== scopeKey ||
          replay.content.repairReason !== reason
        ) {
          throw new TypeError('Explicit repair replay conflicts with retained custody.');
        }
        return replay;
      }
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
  };
}
