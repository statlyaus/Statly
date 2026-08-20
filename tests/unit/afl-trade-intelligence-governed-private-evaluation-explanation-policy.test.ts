import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createGovernedPrivateEvaluationExplanationPolicy,
  governedPrivateEvaluationExplanationPolicySchema,
} from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationExplanationPolicy';

function content() {
  return {
    schemaVersion: 'private-evaluation-explanation-policy/v1' as const,
    environment: 'non_production' as const,
    valueUnitId: 'fixed_horizon_pav',
    selectedLayer: 'scarcityAdjusted' as const,
    practicalEquivalence: {
      basis: 'absolute club package net difference in fixed_horizon_pav',
      bandByView: [
        { view: 'at_trade' as const, maximumDifference: 2 },
        { view: 'realized' as const, maximumDifference: 1 },
        { view: 'remaining' as const, maximumDifference: 2 },
        { view: 'current' as const, maximumDifference: 2 },
      ],
    },
    createdAt: '2026-08-19T09:00:00.000Z',
    publicationEligible: false as const,
    limitation:
      'Private calculation explanation policy only; not model, grade, publication, or activation authority.' as const,
  };
}

describe('governed private evaluation explanation policy', () => {
  it('content-addresses the exact four-view comparison policy', () => {
    const policy = createGovernedPrivateEvaluationExplanationPolicy(content());

    expect(policy.policyId).toBe(
      createAflTradeContentAddress('private-evaluation-explanation-policy', policy.content)
    );
    expect(policy.content.practicalEquivalence.bandByView.map(({ view }) => view)).toEqual([
      'at_trade',
      'realized',
      'remaining',
      'current',
    ]);
  });

  it('rejects reordered or negative policy bands and changed retained content', () => {
    const reordered = content();
    reordered.practicalEquivalence.bandByView.reverse();
    expect(() => createGovernedPrivateEvaluationExplanationPolicy(reordered)).toThrow(
      /canonical|view/i
    );

    const policy = createGovernedPrivateEvaluationExplanationPolicy(content());
    const tampered = structuredClone(policy);
    tampered.content.practicalEquivalence.bandByView[0]!.maximumDifference = -1;
    expect(() => governedPrivateEvaluationExplanationPolicySchema.parse(tampered)).toThrow();
  });
});
