import { describe, expect, it } from 'vitest';

import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  type AflTradeCurrentValuationRefreshResult,
  createAflTradeCurrentValuationRefresh,
} from '@/server/aflTradeIntelligence/valuation/currentValuationRefresh';

const operationId = `current-valuation-refresh-operation:${'a'.repeat(64)}`;
const triggers = ['weekly', 'model_qualified', 'ad_hoc'] as const;

function retainedResult(trigger: (typeof triggers)[number]): AflTradeCurrentValuationRefreshResult {
  return {
    schemaVersion: 'afl-current-valuation-refresh-result-v1',
    operationId,
    scopeKey: 'afl-men:2026-trades',
    trigger,
    stableOperationKey: `refresh-${trigger}`,
    state: 'no_change',
    capturedAuthority: {
      factualReleaseScopeKey: 'afl-men:2026',
      factualReleaseId: `outcome-release:${'b'.repeat(64)}`,
      factualReleaseRevision: 9,
      modelQualificationId: `model-qualification:${'c'.repeat(64)}`,
      modelQualificationWorkId: `model-qualification-work:${'d'.repeat(64)}`,
      modelPairRevision: 4,
      preparedInputSetId: `prepared-valuation-input-set:${'e'.repeat(64)}`,
      preparedInputSetRevision: 7,
      privateBatchId: `private-evaluation-batch:${'f'.repeat(64)}`,
      privateBatchRevision: 3,
      privateBatchTransitionId: `private-evaluation-batch-transition:${'1'.repeat(64)}`,
    },
    capturedAt: '2026-08-21T08:00:00.000Z',
    completedAt: '2026-08-21T08:00:00.000Z',
    executionLocation: 'local',
    visibility: 'private',
    environment: 'non_production',
    publicationEligible: false,
    publicationProhibited: true,
    limitation:
      'Private local non-production current-authority refresh trace only; no factual, model, prepared-input, private-evaluation, production, activation, or publication authority is granted.',
  };
}

function fakeClient(result: AflTradeCurrentValuationRefreshResult) {
  const statements: Array<{ readonly sql: string; readonly parameters: readonly unknown[] }> = [];
  const query = async (sql: string, parameters: readonly unknown[] = []) => {
    statements.push({ sql, parameters });
    if (sql.includes('SET LOCAL ROLE')) return { rows: [], rowCount: null };
    if (sql.includes('retain_outcome_current_valuation_refresh_no_change')) {
      return {
        rows: [{ operation_id: result.operationId, operation_json: {}, result_json: result }],
        rowCount: 1,
      };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const client = {
    query,
    transaction: async (work: Parameters<AflOutcomeSqlClient['transaction']>[0]) => work({ query }),
  } as AflOutcomeSqlClient;
  return { client, statements };
}

describe('current valuation refresh', () => {
  it.each(triggers)('owns durable %s no-change custody behind one operation', async (trigger) => {
    const expected = retainedResult(trigger);
    const database = fakeClient(expected);
    const refresh = createAflTradeCurrentValuationRefresh({ client: database.client });

    await expect(
      refresh.refreshCurrent({
        scopeKey: expected.scopeKey,
        trigger,
        stableOperationKey: expected.stableOperationKey,
      })
    ).resolves.toEqual(expected);
    expect(database.statements).toEqual([
      {
        sql: 'SET LOCAL ROLE afl_trade_private_evaluation_coordinator',
        parameters: [],
      },
      {
        sql: 'SELECT * FROM retain_outcome_current_valuation_refresh_no_change($1,$2,$3)',
        parameters: [expected.scopeKey, trigger, expected.stableOperationKey],
      },
    ]);
  });
});
