import { describe, expect, it } from 'vitest';

import { LOCAL_AFLCA_COACHES_VOTES_READINESS } from '@/server/aflTradeIntelligence/development/localAflcaCoachesVotesStaging';

describe('local AFLCA coaches-votes staging readiness', () => {
  it('retains evidence without admitting the ambiguous fitzRoy season result to evaluation', () => {
    expect(LOCAL_AFLCA_COACHES_VOTES_READINESS).toEqual({
      state: 'blocked',
      blockerCode: 'fitzroy_aflca_award_scope_ambiguous',
      retainedEvidenceEligible: true,
      playerContributionEvaluationEligible: false,
      reason:
        'Pinned fitzRoy 1.7.0 combines home-and-away and finals award requests from round 19, omits the award-scope discriminator, and excludes non-finals rounds above 23.',
      requiredRemedy:
        'Capture each AFLCA award scope with an authenticated discriminator and prove requested-round coverage against the reviewed AFL match universe before factual promotion.',
    });
  });
});
