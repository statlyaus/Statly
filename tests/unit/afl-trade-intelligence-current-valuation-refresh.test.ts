import { describe, expect, it } from 'vitest';

import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  type AflTradeCurrentValuationRefreshResult,
  createAflTradeCurrentValuationRefresh,
} from '@/server/aflTradeIntelligence/valuation/currentValuationRefresh';

const operationId = `current-valuation-refresh-operation:${'a'.repeat(64)}`;
const factualOperationId = `current-valuation-factual-refresh-operation:${'2'.repeat(64)}`;
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

function factualResult(): AflTradeCurrentValuationRefreshResult {
  return {
    schemaVersion: 'afl-current-valuation-refresh-result-v2',
    operationId: factualOperationId,
    scopeKey: 'afl-men:2026-trades',
    trigger: 'weekly',
    stableOperationKey: 'refresh-new-facts',
    state: 'factual_refresh_complete',
    factualStage: 'advanced',
    privateFactualAuthority: {
      valuationScopeKey: 'afl-men:2026-trades',
      candidateId: `private-factual-candidate:${'5'.repeat(64)}`,
      evidenceScopeKey: 'afl-player-match-reviewed-2021-2026',
      evidenceBundleId: `private-reviewed-evidence-bundle:${'3'.repeat(64)}`,
      reviewDecisionId: `private-reviewed-evidence-evaluation-decision:${'4'.repeat(64)}`,
      normalizedReconciledCustodySha256: '6'.repeat(64),
      revision: 1,
    },
    capturedAt: '2026-08-28T08:00:00.000Z',
    completedAt: '2026-08-28T08:00:00.000Z',
    executionLocation: 'local',
    visibility: 'private',
    environment: 'non_production',
    publicationEligible: false,
    publicationProhibited: true,
    limitation:
      'Private local non-production factual refresh authority only; no public release, registry, production, activation, or publication authority is granted.',
  };
}

function fakeClient(result: AflTradeCurrentValuationRefreshResult) {
  const statements: Array<{ readonly sql: string; readonly parameters: readonly unknown[] }> = [];
  const query = async (sql: string, parameters: readonly unknown[] = []) => {
    statements.push({ sql, parameters });
    if (sql.includes('SET LOCAL ROLE')) return { rows: [], rowCount: null };
    if (sql.includes('retain_outcome_current_valuation_factual_source')) return { rows: [], rowCount: 1 };
    if (sql.includes('compose_outcome_current_valuation_factual_candidate')) return { rows: [], rowCount: 1 };
    if (sql.includes('refresh_outcome_current_valuation_factual')) {
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
    expect(database.statements.filter(({ sql }) => sql.startsWith('SELECT'))).toEqual([
      { sql: 'SELECT retain_outcome_current_valuation_factual_source($1,$2,$3)', parameters: [expected.scopeKey, trigger, expected.stableOperationKey] },
      { sql: 'SELECT compose_outcome_current_valuation_factual_candidate($1,$2,$3)', parameters: [expected.scopeKey, trigger, expected.stableOperationKey] },
      { sql: 'SELECT * FROM refresh_outcome_current_valuation_factual($1,$2,$3)', parameters: [expected.scopeKey, trigger, expected.stableOperationKey] },
    ]);
  });

  it('returns the retained private factual CAS advancement without publication authority', async () => {
    const expected = factualResult();
    const database = fakeClient(expected);
    const refresh = createAflTradeCurrentValuationRefresh({ client: database.client });

    await expect(
      refresh.refreshCurrent({
        scopeKey: expected.scopeKey,
        trigger: expected.trigger,
        stableOperationKey: expected.stableOperationKey,
      })
    ).resolves.toEqual(expected);
    expect(database.statements.filter(({ sql }) => sql.startsWith('SELECT')).at(-1)).toEqual({
      sql: 'SELECT * FROM refresh_outcome_current_valuation_factual($1,$2,$3)',
      parameters: [expected.scopeKey, expected.trigger, expected.stableOperationKey],
    });
  });
});
