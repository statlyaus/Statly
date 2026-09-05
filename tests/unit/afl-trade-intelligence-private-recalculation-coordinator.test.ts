import { describe, expect, it, vi } from 'vitest';

import { createAflTradePrivateRecalculationCoordinator } from '@/server/aflTradeIntelligence/valuation/privateRecalculationCoordinator';

const dispatch = {
  request: {
    requestId: `private-valuation-dispatch:${'1'.repeat(64)}`,
    scopeKey: 'afl-men:2025-trades',
    trigger: 'ad_hoc' as const,
    scheduledFor: '2026-09-05T00:00:00.000Z',
    authorityKey: 'issue-579-genuine-loop',
  },
  claim: {
    claimId: `private-valuation-dispatch-claim:${'2'.repeat(64)}`,
    leaseToken: '3'.repeat(64),
  },
};

const privateFactualAuthority = {
  valuationScopeKey: dispatch.request.scopeKey,
  candidateId: `private-factual-candidate:${'4'.repeat(64)}`,
  evidenceScopeKey: 'reviewed-five-season-evidence',
  evidenceBundleId: `private-reviewed-evidence-bundle:${'5'.repeat(64)}`,
  reviewDecisionId: `private-reviewed-evidence-evaluation-decision:${'6'.repeat(64)}`,
  normalizedReconciledCustodySha256: '7'.repeat(64),
  revision: 1,
};

function factualResult() {
  return {
    state: 'complete' as const,
    currentValuationRefresh: {
      state: 'factual_refresh_complete' as const,
      operationId: `current-valuation-factual-refresh-operation:${'8'.repeat(64)}`,
      scopeKey: dispatch.request.scopeKey,
      privateFactualAuthority,
    },
  };
}

describe('private recalculation coordinator', () => {
  it('sequences existing authority owners under one exact dispatch claim', async () => {
    const calls: string[] = [];
    const coordinator = createAflTradePrivateRecalculationCoordinator({
      evidence: {
        refreshCurrent: vi.fn(async () => {
          calls.push('factual');
          return factualResult();
        }),
      },
      modelEvidence: {
        refresh: vi.fn(async ({ dispatch: received, factual }) => {
          calls.push('model');
          expect(received).toEqual(dispatch);
          expect(factual).toEqual(factualResult().currentValuationRefresh);
          return { state: 'qualified' as const };
        }),
      },
      prepared: {
        prepare: vi.fn(async (received) => {
          calls.push('prepared');
          expect(received).toEqual(dispatch);
          return { state: 'advanced' as const };
        }),
      },
      batch: {
        runPrivate: vi.fn(async (received) => {
          calls.push('batch');
          expect(received).toEqual(dispatch);
          return { state: 'activated' as const };
        }),
      },
    });

    await expect(coordinator.run(dispatch)).resolves.toEqual({ state: 'activated' });
    expect(calls).toEqual(['factual', 'model', 'prepared', 'batch']);
  });

  it('reuses the retained downstream authority when factual refresh reports no change', async () => {
    const model = vi.fn();
    const prepared = vi.fn();
    const batch = vi.fn(async () => ({ state: 'already_current' as const }));
    const coordinator = createAflTradePrivateRecalculationCoordinator({
      evidence: {
        refreshCurrent: vi.fn(async () => ({
          state: 'complete' as const,
          currentValuationRefresh: { state: 'no_change' as const },
        })),
      },
      modelEvidence: { refresh: model },
      prepared: { prepare: prepared },
      batch: { runPrivate: batch },
    });

    await expect(coordinator.run(dispatch)).resolves.toEqual({ state: 'already_current' });
    expect(model).not.toHaveBeenCalled();
    expect(prepared).not.toHaveBeenCalled();
    expect(batch).toHaveBeenCalledWith(dispatch);
  });

  it.each([
    ['factual unavailable', { state: 'unavailable' as const }, 'exhausted'],
    ['qualification failure', factualResult(), 'unexpected_failure'],
  ])('fails closed for %s', async (_label, evidenceResult, expectedState) => {
    const coordinator = createAflTradePrivateRecalculationCoordinator({
      evidence: { refreshCurrent: vi.fn(async () => evidenceResult) },
      modelEvidence: {
        refresh: vi.fn(async () => ({ state: 'qualification_failed' as const })),
      },
      prepared: { prepare: vi.fn() },
      batch: { runPrivate: vi.fn() },
    });

    await expect(coordinator.run(dispatch)).resolves.toEqual({ state: expectedState });
  });

  it('propagates stale model or prepared authority for the existing retry ledger', async () => {
    const modelStale = createAflTradePrivateRecalculationCoordinator({
      evidence: { refreshCurrent: vi.fn(async () => factualResult()) },
      modelEvidence: { refresh: vi.fn(async () => ({ state: 'stale_authority' as const })) },
      prepared: { prepare: vi.fn() },
      batch: { runPrivate: vi.fn() },
    });
    await expect(modelStale.run(dispatch)).resolves.toEqual({ state: 'stale_authority' });

    const preparedStale = createAflTradePrivateRecalculationCoordinator({
      evidence: { refreshCurrent: vi.fn(async () => factualResult()) },
      modelEvidence: { refresh: vi.fn(async () => ({ state: 'qualified' as const })) },
      prepared: { prepare: vi.fn(async () => ({ state: 'stale_authority' as const })) },
      batch: { runPrivate: vi.fn() },
    });
    await expect(preparedStale.run(dispatch)).resolves.toEqual({ state: 'stale_authority' });
  });
});
