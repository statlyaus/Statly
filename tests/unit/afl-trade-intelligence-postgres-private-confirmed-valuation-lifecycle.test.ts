import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { PostgresAflTradePrivateConfirmedValuationLifecycleV2 } from '@/server/aflTradeIntelligence/valuation/postgresPrivateConfirmedTradeValuationLifecycle';
import {
  createAflTradePrivateConfirmedValuationPlanV2,
  createAflTradePrivateConfirmedValuationResultV2,
} from '@/server/aflTradeIntelligence/valuation/privateConfirmedTradeValuationContracts';

const at = '2026-08-17T00:00:00.000Z';
const workbookSha256 = 'd'.repeat(64);
const evidence = (name: string) => createAflTradeCanonicalJsonArtifactRef({ name }, at);

function fixtures() {
  const authority = {
    kind: 'private_confirmed_nonproduction_calculation' as const,
    evidenceKind: 'retained_private_review' as const,
    decisionId: `private-reviewed-evidence-evaluation-decision:${'a'.repeat(64)}`,
    evidenceBundleId: `private-reviewed-evidence-bundle:${'b'.repeat(64)}`,
    evidenceBundleArtifact: evidence('bundle'),
    publicationEligible: false as const,
    publicationProhibited: true as const,
  };
  const unavailable = {
    state: 'unavailable' as const,
    reasons: ['selection_lineage_unresolved' as const],
    evidenceRefs: [evidence('pick')],
  };
  const plan = createAflTradePrivateConfirmedValuationPlanV2({
    authority,
    valuationScopeKey: 'afl-men:2021-trades',
    tradeId: 'workbook-2021-e7f7d1484744f855',
    transactionPromotionId: `private-workbook-transaction-promotion:${'c'.repeat(64)}`,
    transactionOccurredOn: '2021-10-12',
    transactionOccurrencePrecision: 'date',
    knowledgeCutoffAt: at,
    transactionArtifact: evidence('transaction'),
    expectedAssetIds: ['asset:future-pick'],
    assets: [
      {
        assetId: 'asset:future-pick',
        assetKind: 'future_pick',
        sendingClubId: 'local-afl-club:adelaide',
        receivingClubId: 'local-afl-club:sydney',
        canonicalPlayerId: null,
        acquisitionSpell: null,
        appearances: unavailable,
        realizedPav: unavailable,
      },
    ],
    plannedAt: at,
  });
  const planArtifact = createAflTradeCanonicalJsonArtifactRef(plan, at);
  const result = createAflTradePrivateConfirmedValuationResultV2({
    plan,
    planArtifact,
    valueUnitId: 'hpn-season-pav/v1',
    assets: [
      {
        assetId: 'asset:future-pick',
        assetKind: 'future_pick',
        sendingClubId: 'local-afl-club:adelaide',
        receivingClubId: 'local-afl-club:sydney',
        canonicalPlayerId: null,
        acquisitionSpell: null,
        appearances: unavailable,
        realizedPav: unavailable,
      },
    ],
    assembledAt: at,
  });
  return { plan, planArtifact, result, resultArtifact: createAflTradeCanonicalJsonArtifactRef(result, at) };
}

describe('PostgresAflTradePrivateConfirmedValuationLifecycleV2', () => {
  it('selects the newest current governed plan for repeat construction', async () => {
    let selectedSql = '';
    const client = {
      query: async (sql: string) => {
        selectedSql = sql;
        return { rows: [], rowCount: 0 };
      },
      transaction: async () => {
        throw new Error('Transaction was not expected.');
      },
    } as unknown as AflOutcomeSqlClient;
    const lifecycle = new PostgresAflTradePrivateConfirmedValuationLifecycleV2(client);

    await expect(
      lifecycle.loadCurrentPlanForTrade({
        valuationScopeKey: 'afl-men:2021-trades',
        tradeId: 'workbook-2021-e7f7d1484744f855',
      })
    ).resolves.toBeNull();
    expect(selectedSql).toContain('ORDER BY plan.planned_at DESC,plan.plan_id DESC');
  });

  it('makes an exact staged plan and assembled result retrievable through the lifecycle interface', async () => {
    const fixture = fixtures();
    const plans = new Map<string, { plan_json: unknown; artifact_json: unknown }>();
    const results = new Map<string, { result_json: unknown; artifact_json: unknown }>();
    const query = async (sql: string, parameters: readonly unknown[] = []) => {
      if (sql.includes('INSERT INTO outcome_private_confirmed_valuation_plan_v2')) {
        plans.set(String(parameters[0]), { plan_json: parameters[9], artifact_json: parameters[10] });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('FROM outcome_private_confirmed_valuation_plan_v2')) {
        const row = plans.get(String(parameters[0]));
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (sql.includes('INSERT INTO outcome_private_confirmed_valuation_result_v2')) {
        results.set(String(parameters[0]), { result_json: parameters[5], artifact_json: parameters[6] });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('FROM outcome_private_confirmed_valuation_result_v2')) {
        const row = sql.includes('valuation_scope_key')
          ? { ...[...results.values()][0]!, workbook_sha256: workbookSha256 }
          : results.get(String(parameters[0]));
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      return { rows: [], rowCount: 1 };
    };
    const client = {
      query,
      transaction: async <T>(work: (transaction: { query: typeof query }) => Promise<T>) =>
        work({ query }),
    } as AflOutcomeSqlClient;
    const lifecycle = new PostgresAflTradePrivateConfirmedValuationLifecycleV2(client);

    await lifecycle.savePlan({ plan: fixture.plan, artifact: fixture.planArtifact });
    await expect(lifecycle.loadPlan(fixture.plan.planId)).resolves.toEqual({
      plan: fixture.plan,
      artifact: fixture.planArtifact,
    });
    await lifecycle.saveResult({ result: fixture.result, artifact: fixture.resultArtifact });
    await expect(lifecycle.loadResult(fixture.result.resultId)).resolves.toEqual({
      result: fixture.result,
      artifact: fixture.resultArtifact,
    });
    await expect(
      lifecycle.loadLatestResultForTrade({
        valuationScopeKey: fixture.result.content.valuationScopeKey,
        tradeId: fixture.result.content.tradeId,
        workbookSha256,
      })
    ).resolves.toEqual({
      result: fixture.result,
      artifact: fixture.resultArtifact,
      workbookSha256,
    });
  });
});
