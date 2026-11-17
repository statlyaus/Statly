import { AFL_TRADE_VALUATION_VIEWS } from '@/types/aflTradeIntelligence';

import {
  governedPrivateEvaluationExplanationPolicySchema,
  type GovernedPrivateEvaluationExplanationPolicy,
} from './governedPrivateEvaluationExplanationPolicy';
import {
  governedPrivateEvaluationInputTraceSchema,
  type GovernedPrivateEvaluationInputTrace,
} from './governedPrivateEvaluationInputTrace';
import { deriveGovernedPrivateEvaluationTransaction } from './governedPrivateEvaluationTransaction';

export interface GovernedPrivateEvaluationExplanationSource {
  readonly authority: {
    readonly kind: 'authenticated_non_production';
    readonly inputTraceId: string;
    readonly explanationPolicyId: string;
    readonly publicationProhibited: true;
  };
  readonly selector: GovernedPrivateEvaluationInputTrace['content']['selector'];
  readonly effectiveAt: string;
  readonly valueUnitId: string;
  readonly selectedLayer: GovernedPrivateEvaluationExplanationPolicy['content']['selectedLayer'];
  readonly practicalEquivalence: {
    readonly basis: string;
    readonly bandByView: Record<(typeof AFL_TRADE_VALUATION_VIEWS)[number], number>;
  };
  readonly clubs: ReturnType<typeof deriveGovernedPrivateEvaluationTransaction>['clubs'];
  readonly transfers: ReturnType<typeof deriveGovernedPrivateEvaluationTransaction>['transfers'];
}

export function authenticateGovernedPrivateEvaluationExplanationSource(input: {
  trace: unknown;
  policy: unknown;
}): GovernedPrivateEvaluationExplanationSource {
  const trace = governedPrivateEvaluationInputTraceSchema.parse(input.trace);
  const policy = governedPrivateEvaluationExplanationPolicySchema.parse(input.policy);
  if (trace.content.environment !== 'non_production') {
    throw new TypeError('A private non-production explanation policy requires a non-production input trace.');
  }
  if (Date.parse(policy.content.createdAt) > Date.parse(trace.content.derivedAt)) {
    throw new TypeError('The explanation policy must exist before the authenticated input trace derivation.');
  }
  const transaction = deriveGovernedPrivateEvaluationTransaction(trace);
  return {
    authority: {
      kind: 'authenticated_non_production',
      inputTraceId: trace.inputTraceId,
      explanationPolicyId: policy.policyId,
      publicationProhibited: true,
    },
    selector: trace.content.selector,
    effectiveAt: transaction.effectiveAt,
    valueUnitId: policy.content.valueUnitId,
    selectedLayer: policy.content.selectedLayer,
    practicalEquivalence: {
      basis: policy.content.practicalEquivalence.basis,
      bandByView: Object.fromEntries(
        policy.content.practicalEquivalence.bandByView.map(({ view, maximumDifference }) => [
          view,
          maximumDifference,
        ])
      ) as Record<(typeof AFL_TRADE_VALUATION_VIEWS)[number], number>,
    },
    clubs: transaction.clubs,
    transfers: transaction.transfers,
  };
}
