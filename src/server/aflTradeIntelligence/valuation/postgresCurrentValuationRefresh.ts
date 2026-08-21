import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import {
  aflTradeCurrentValuationRefreshResultSchema,
  createAflTradeCurrentValuationRefresh,
} from './currentValuationRefresh';

const EXECUTION_DATABASE_ROLE = 'afl_trade_private_evaluation_coordinator';

interface RetainedRefreshRow {
  readonly operation_id: string;
  readonly operation_json: unknown;
  readonly result_json: unknown;
}

export function createPostgresAflTradeCurrentValuationRefresh(dependencies: {
  readonly client: AflOutcomeSqlClient;
}) {
  return createAflTradeCurrentValuationRefresh({
    retainNoChange: async (request) => {
      const retained = await dependencies.client.transaction(async (transaction) => {
        await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
        return transaction.query<RetainedRefreshRow>(
          `SELECT * FROM retain_outcome_current_valuation_refresh_no_change($1,$2,$3)`,
          [request.scopeKey, request.trigger, request.stableOperationKey]
        );
      });
      const row = retained.rows[0];
      if (row === undefined || retained.rows.length !== 1) {
        throw new TypeError('Current valuation refresh did not retain exactly one result.');
      }
      const result = aflTradeCurrentValuationRefreshResultSchema.parse(row.result_json);
      if (result.operationId !== row.operation_id) {
        throw new TypeError(
          'Current valuation refresh result disagrees with retained operation custody.'
        );
      }
      return result;
    },
  });
}
