import { canonicalizeAflTradeJson } from '../../artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '../../outcomes/postgresOutcomeReleaseRepository';
import { AflTradePrivateEvaluationCohortStaleAuthorityError } from '../currentValuationCohortRunner';
import {
  AFL_TRADE_PREPARED_VALUATION_INPUT_SET_V3_SCHEMA_VERSION,
  aflTradePreparedValuationInputEntrySchema,
  aflTradePreparedValuationInputSetSchema,
} from '../preparedValuationInputSet';

interface PrivateRepairCaptureRow {
  readonly input_set_json: unknown;
  readonly prepared_revision: number;
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

export async function capturePostgresAflTradePrivateEvaluationCohortRepairAuthority(
  client: AflOutcomeSqlClient,
  scopeKey: string
) {
  return client.transaction(async (transaction) => {
    await transaction.query(`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
    await transaction.query(`SET LOCAL ROLE afl_trade_private_evaluation_coordinator`);
    const result = await transaction.query<PrivateRepairCaptureRow>(
      `SELECT prepared.prepared_set_json AS input_set_json,
              prepared_head.revision AS prepared_revision
         FROM outcome_current_prepared_valuation_input_set prepared_head
         JOIN outcome_prepared_valuation_input_set prepared
           ON prepared.prepared_input_set_id=prepared_head.prepared_input_set_id
          AND prepared.prepared_set_json->'content'->>'preparationAuthority'=
              'qualified_current_model_evidence'
        WHERE prepared_head.scope_key=$1`,
      [scopeKey]
    );
    const row = result.rows[0];
    if (result.rows.length !== 1 || row === undefined) {
      throw new AflTradePrivateEvaluationCohortStaleAuthorityError(
        'Current private prepared-v3 authority is incomplete for repair.'
      );
    }
    const prepared = aflTradePreparedValuationInputSetSchema.parse(row.input_set_json);
    const content = prepared.content;
    if (
      content.schemaVersion !== AFL_TRADE_PREPARED_VALUATION_INPUT_SET_V3_SCHEMA_VERSION ||
      content.preparationAuthority !== 'qualified_current_model_evidence' ||
      content.scopeKey !== scopeKey
    ) {
      throw new AflTradePrivateEvaluationCohortStaleAuthorityError(
        'Current private prepared-v3 content is not repair authority.'
      );
    }
    const authorityResult = await transaction.query<PrivateAuthorityRow>(
      `SELECT * FROM load_outcome_private_prepared_v3_authority($1)`,
      [content.dispatchAuthority.requestId]
    );
    const authority = authorityResult.rows[0];
    if (
      authorityResult.rows.length !== 1 ||
      authority === undefined ||
      authority.scope_key !== content.scopeKey ||
      authority.factual_release_scope_key !== content.factualReleaseScopeKey ||
      authority.factual_release_id !== content.factualReleaseId ||
      authority.factual_output_id !== content.dispatchAuthority.factualOutputId ||
      authority.hpn_calculation_id !== content.dispatchAuthority.hpnCalculationId ||
      authority.model_operation_id !== content.dispatchAuthority.modelOperationId ||
      canonicalizeAflTradeJson(authority.model_evidence_json) !==
        canonicalizeAflTradeJson(content.modelEvidence)
    ) {
      throw new AflTradePrivateEvaluationCohortStaleAuthorityError(
        'Current private prepared-v3 repair authority is no longer exact.'
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
      throw new TypeError('Private cohort repair requires exhaustive prepared membership.');
    }
    const readyTradeIds = entryRows.rows.flatMap((entryRow) => {
      const entry = aflTradePreparedValuationInputEntrySchema.parse(entryRow.entry_json);
      if (entry.tradeId !== entryRow.trade_id || entry.state !== entryRow.state) {
        throw new TypeError('Prepared cohort repair entry custody disagrees with its identity.');
      }
      return entry.state === 'ready' ? [entry.tradeId] : [];
    });
    return {
      authority: {
        scopeKey: content.scopeKey,
        preparedInputSetId: prepared.preparedInputSetId,
        preparedInputSetRevision: row.prepared_revision,
        preparationOperationId: content.preparationOperationId,
        currentModelEvidenceOperationId: content.modelEvidence.operationId,
        dispatchAuthority: content.dispatchAuthority,
        modelQualificationWorkId: content.modelEvidence.qualificationWorkId,
        modelPairRevision: content.modelEvidence.modelRevision,
      },
      readyTradeIds,
    };
  });
}
