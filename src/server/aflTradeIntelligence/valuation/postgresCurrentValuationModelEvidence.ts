import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
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

export class PostgresAflTradeCurrentValuationModelEvidenceRepository implements AflTradeCurrentValuationModelEvidenceRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

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
    return this.client.transaction(async (transaction) => {
      await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
      const result = aflTradeCurrentValuationModelEvidenceResultSchema.parse(input.result);
      const retained = await transaction.query<RetainedRow>(
        `SELECT result_json
           FROM outcome_current_valuation_model_evidence_operation
          WHERE operation_id=$1 FOR SHARE`,
        [result.operationId]
      );
      const replay = retained.rows[0];
      if (replay !== undefined) {
        const parsed = aflTradeCurrentValuationModelEvidenceResultSchema.parse(replay.result_json);
        if (canonicalizeAflTradeJson(parsed) !== canonicalizeAflTradeJson(result)) {
          throw new TypeError('Current model evidence replay conflicts with retained custody.');
        }
        return { state: 'committed' as const, result: parsed };
      }
      const factual = await transaction.query<{
        readonly candidate_id: string;
        readonly revision: number;
      }>(
        `SELECT candidate_id,revision
           FROM outcome_current_private_factual_authority
          WHERE valuation_scope_key=$1 FOR SHARE`,
        [result.scopeKey]
      );
      const factualHead = factual.rows[0];
      if (
        factualHead?.candidate_id !== result.privateFactualAuthority.candidateId ||
        factualHead.revision !== result.privateFactualAuthority.revision
      ) {
        return { state: 'stale_authority' as const };
      }
      const model = await transaction.query<{
        readonly revision: number;
        readonly qualification_id: string;
        readonly player_run_id: string;
        readonly pick_run_id: string;
        readonly work_id: string;
      }>(
        `SELECT revision,qualification_id,player_run_id,pick_run_id,work_id
           FROM outcome_current_governed_valuation_model_pair
          WHERE scope_key=$1 FOR SHARE`,
        [result.scopeKey]
      );
      const modelHead = model.rows[0];
      const currentRevision = modelHead?.revision ?? 0;
      const exactQualifiedHead =
        result.state === 'qualified' &&
        currentRevision === result.expectedModelRevision + 1 &&
        modelHead?.qualification_id === result.qualificationId &&
        modelHead.player_run_id === result.playerRunId &&
        modelHead.pick_run_id === result.pickRunId &&
        modelHead.work_id === result.qualificationWorkId;
      const exactFailedHead =
        result.state === 'qualification_failed' && currentRevision === result.expectedModelRevision;
      if (!exactQualifiedHead && !exactFailedHead) {
        return { state: 'stale_authority' as const };
      }
      if (result.state === 'qualification_failed') {
        const failed = await transaction.query<{
          readonly qualification_id: string;
        }>(
          `SELECT qualification_id
             FROM outcome_governed_valuation_model_qualification
            WHERE qualification_id=$1 AND scope_key=$2 AND outcome='failed'
              AND player_run_id=$3 AND pick_run_id=$4
            FOR SHARE`,
          [result.qualificationId, result.scopeKey, result.playerRunId, result.pickRunId]
        );
        if (failed.rows.length !== 1) {
          throw new TypeError('Failed current model qualification lacks exact retained evidence.');
        }
      }
      await transaction.query(
        `INSERT INTO outcome_current_valuation_model_evidence_operation
          (operation_id,scope_key,factual_operation_id,factual_candidate_id,
           factual_revision,expected_model_revision,result_state,result_json,
           captured_at,completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
        [
          result.operationId,
          result.scopeKey,
          result.factualOperationId,
          result.privateFactualAuthority.candidateId,
          result.privateFactualAuthority.revision,
          input.expectedModelRevision,
          result.state,
          canonicalizeAflTradeJson(result),
          result.capturedAt,
          result.completedAt,
        ]
      );
      return { state: 'committed' as const, result };
    });
  }
}

export function createPostgresAflTradeCurrentValuationModelEvidenceCoordinator(input: {
  readonly client: AflOutcomeSqlClient;
  readonly prepareAndQualify: Parameters<
    typeof createAflTradeCurrentValuationModelEvidenceCoordinator
  >[0]['prepareAndQualify'];
  readonly clock?: { readonly now: () => string };
}) {
  return createAflTradeCurrentValuationModelEvidenceCoordinator({
    repository: new PostgresAflTradeCurrentValuationModelEvidenceRepository(input.client),
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
