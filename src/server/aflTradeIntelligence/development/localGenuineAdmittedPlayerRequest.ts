import { createHash } from 'node:crypto';

import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import {
  aflTradePrivateValuationModelOperationSchema,
  aflTradePrivateValuationModelPairExactInputSchema,
} from '../valuation/privateValuationModelPair';
import type { AflTradeDispatchBoundPlayerExecutorInput } from '../valuation/postgresPrivateValuationModelPair';

const EXECUTION_DATABASE_ROLE = 'afl_trade_private_evaluation_coordinator';

interface RetainedPlayerOperationRow {
  readonly scope_key: string;
  readonly operation_json: unknown;
  readonly factual_output_id: string;
  readonly hpn_calculation_id: string;
  readonly attempt_number: number;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Execute the player component selected by one already-bound private factual request.
 * The caller supplies only live claim custody; PostgreSQL supplies every substantive model target.
 */
export async function runLocalAflTradeGenuineAdmittedPlayerRequest(input: {
  readonly sql: AflOutcomeSqlClient;
  readonly executor: Readonly<{
    execute(value: AflTradeDispatchBoundPlayerExecutorInput): Promise<
      | Readonly<{ state: 'completed'; runId: string }>
      | Readonly<{
          state: 'transient_failure' | 'deterministic_failure' | 'stale_authority';
          reason: string;
        }>
    >;
  }>;
  readonly requestId: string;
  readonly claim: { readonly claimId: string; readonly leaseToken: string };
}) {
  const retained = await input.sql.transaction(async (transaction) => {
    await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
    await transaction.query(
      `SELECT load_outcome_private_valuation_dispatch_request_for_claim($1,$2,$3)`,
      [input.requestId, input.claim.claimId, sha256(input.claim.leaseToken)]
    );
    return transaction.query<RetainedPlayerOperationRow>(
      `SELECT request.scope_key,operation.operation_json,binding.factual_output_id,
              binding.hpn_calculation_id,attempt.attempt_number
         FROM outcome_private_valuation_model_request_binding binding
         JOIN outcome_private_valuation_dispatch_request request
           ON request.request_id=binding.request_id
          AND request.claim_id=$2
         JOIN outcome_private_valuation_dispatch_attempt attempt
           ON attempt.request_id=request.request_id
          AND attempt.claim_id=request.claim_id
          AND attempt.finished_at IS NULL
         JOIN outcome_private_valuation_model_operation operation
           ON operation.operation_id=binding.operation_id
        WHERE binding.request_id=$1`,
      [input.requestId, input.claim.claimId]
    );
  });
  const row = retained.rows[0];
  if (retained.rows.length !== 1 || row === undefined) {
    throw new TypeError('The live request has no exact retained player operation.');
  }
  const operation = aflTradePrivateValuationModelOperationSchema.parse(row.operation_json);
  if (row.scope_key !== operation.content.scopeKey) {
    throw new TypeError('The live request does not match its exact retained player operation.');
  }
  const { schemaVersion: _schemaVersion, scopeKey: _scopeKey, ...substantive } = operation.content;
  const exactInput = aflTradePrivateValuationModelPairExactInputSchema.parse({
    requestId: input.requestId,
    scopeKey: row.scope_key,
    factualOutputId: row.factual_output_id,
    hpnCalculationId: row.hpn_calculation_id,
    substantive,
  });
  return input.executor.execute({
    exactInput,
    operation,
    attemptNumber: row.attempt_number,
    claim: input.claim,
  });
}
