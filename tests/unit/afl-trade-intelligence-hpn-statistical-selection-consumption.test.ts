import { describe, expect, it, vi } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { loadAflTradeHpnStatisticalSelectionSet } from '@/server/aflTradeIntelligence/modeling/postgresHpnStatisticalSelectionConsumption';
import type { AflOutcomeSqlTransaction } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { fixture } from '../testUtils/hpnStatisticalAdjudicationFixture';

const sourceAuthentication = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock(
  '@/server/aflTradeIntelligence/modeling/postgresHpnStatisticalSourceAuthentication',
  () => ({ authenticateAflTradeHpnStatisticalSources: sourceAuthentication.authenticate })
);

function setup(overrides: Record<string, unknown> = {}) {
  const f = fixture();
  const scopeKey = createAflTradeContentAddress('hpn-statistical-scope', f.candidate.scope);
  const identities = [{ entityKind: 'player', canonicalId: f.candidate.scope.playerId }];
  const row = {
    scope_key: scopeKey,
    decision_id: f.result.decisionId,
    support_review_id: `hpn-statistical-support:${'c'.repeat(64)}`,
    revision: 1,
    identity_json: identities,
    applied_at: '2026-09-16T03:00:00.000Z',
    decision_json: f.result,
    decision_registered_at: '2026-09-16T02:30:00.000Z',
    support_registered_at: '2026-09-16T02:40:00.000Z',
    approval_decided_at: '2026-09-16T02:35:00.000Z',
    current: true,
    ...overrides,
  };
  const query = vi.fn(async (sql: string) => ({
    rows: sql.includes('SELECT head.scope_key') ? [row] : [],
    rowCount: sql.includes('SELECT head.scope_key') ? 1 : 0,
  }));
  sourceAuthentication.authenticate.mockResolvedValue({ identities });
  return {
    f,
    query,
    transaction: { query } as unknown as AflOutcomeSqlTransaction,
    request: {
      environment: 'non_production' as const,
      competition: 'AFLM' as const,
      seasonYear: 2018,
      methodId: `hpn-pav-method:${'d'.repeat(64)}`,
      factualRunId: `factual-reconciliation-run:${'e'.repeat(64)}`,
      effectiveThrough: '2018-09-29T00:00:00.000Z',
      knowledgePolicy: 'retrospective_as_recorded_by_input_creation' as const,
      knowledgeCutoffAt: '2026-09-16T04:00:00.000Z',
      reviewedStatisticalDecisions: [f.result.decisionId],
      sources: [],
    },
    inputSet: {
      inputSetId: `hpn-pav-input-set:${'f'.repeat(64)}`,
      content: {
        environment: 'non_production',
        competition: 'afl',
        seasonYear: 2018,
      },
    },
  };
}

describe('HPN statistical selection consumption', () => {
  it('locks and binds one exact current selection with immutable membership', async () => {
    const value = setup();
    const selectionSet = await loadAflTradeHpnStatisticalSelectionSet(
      value.transaction,
      value.request,
      value.inputSet as never,
      value.request.knowledgeCutoffAt
    );

    expect(selectionSet.status).toBe('coverage_complete');
    expect(selectionSet.decisions).toEqual([value.f.result]);
    expect(selectionSet.membership).toEqual([
      expect.objectContaining({
        decisionId: value.f.result.decisionId,
        revision: 1,
        appliedAt: '2026-09-16T03:00:00.000Z',
      }),
    ]);
    expect(value.query.mock.calls[0]?.[0]).toContain('LOCK TABLE outcome_review_decision');
    expect(value.query.mock.calls[1]?.[0]).toContain(
      'LOCK TABLE outcome_hpn_statistical_current_selection'
    );
    expect(sourceAuthentication.authenticate).toHaveBeenCalledOnce();
  });

  it('rejects a stale head or authority created after the retained cutoff', async () => {
    const stale = setup({ current: false });
    await expect(
      loadAflTradeHpnStatisticalSelectionSet(
        stale.transaction,
        stale.request,
        stale.inputSet as never,
        stale.request.knowledgeCutoffAt
      )
    ).rejects.toThrow(/current input authority/i);

    const late = setup({ applied_at: '2026-09-16T05:00:00.000Z' });
    await expect(
      loadAflTradeHpnStatisticalSelectionSet(
        late.transaction,
        late.request,
        late.inputSet as never,
        late.request.knowledgeCutoffAt
      )
    ).rejects.toThrow(/knowledge cutoff/i);
  });
});
