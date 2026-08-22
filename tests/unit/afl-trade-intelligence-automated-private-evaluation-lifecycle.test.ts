import {
  createAutomatedGovernedPrivateEvaluationTransitionIntent,
  createAutomatedGovernedPrivateEvaluationTransitionReceipt,
} from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationLifecycle';

const addressed = (prefix: string, value: string) => `${prefix}:${value.repeat(64).slice(0, 64)}`;

describe('automated governed private evaluation lifecycle', () => {
  it('authorizes only non-production construct-and-activate under a narrow system principal', () => {
    const intent = createAutomatedGovernedPrivateEvaluationTransitionIntent({
      selector: {
        valuationScopeKey: 'afl.mens.trade-value:2026',
        tradeId: 'trade:2026-001',
      },
      inspectionId: addressed('private-evaluation-inspection', 'a'),
      authoritySnapshotId: addressed('private-evaluation-authority-snapshot', 'b'),
      operationId: addressed('private-evaluation-operation', 'c'),
      action: { kind: 'construct_and_activate' },
      expectedHead: { status: 'absent', revision: 0, generationId: null },
      constructionAuthority: {
        kind: 'automated_private_calculation_agent',
        principalId: 'system:weekly-valuation-coordinator',
      },
      requestedAt: '2026-08-21T09:00:00.000Z',
      expiresAt: '2026-08-21T09:10:00.000Z',
    });
    const receipt = createAutomatedGovernedPrivateEvaluationTransitionReceipt({
      intent,
      previousTransitionId: null,
      toGenerationId: addressed('local-private-trade-evaluation-generation', 'd'),
      transitionedAt: '2026-08-21T09:01:00.000Z',
    });

    expect(intent.content).toMatchObject({
      schemaVersion: 'private-evaluation-transition-intent/v2',
      environment: 'non_production',
      action: { kind: 'construct_and_activate' },
      publicationProhibited: true,
    });
    expect(intent.content).not.toHaveProperty('review');
    expect(receipt.content).toMatchObject({
      schemaVersion: 'private-evaluation-transition-receipt/v2',
      environment: 'non_production',
      toHead: {
        status: 'active',
        revision: 1,
        generationId: addressed('local-private-trade-evaluation-generation', 'd'),
      },
      publicationProhibited: true,
    });

    expect(() => createAutomatedGovernedPrivateEvaluationTransitionIntent({
      ...intent.content,
      action: { kind: 'withdraw', reason: 'not allowed' },
    } as never)).toThrow();
    expect(() =>
      createAutomatedGovernedPrivateEvaluationTransitionIntent({
        ...intent.content,
        constructionAuthority: {
          kind: 'automated_private_calculation_agent',
          principalId: 'system:unconfigured-agent',
        },
      })
    ).toThrow(/weekly-valuation-coordinator/i);
  });
});
