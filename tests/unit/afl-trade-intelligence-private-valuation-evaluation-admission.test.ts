import { describe, expect, it } from 'vitest';

import { createAflTradePrivateValuationEvaluationAdmission } from '@/server/aflTradeIntelligence/valuation/privateValuationEvaluationAdmission';
import { createAflTradePrivateValuationEvaluationDecision } from '@/server/aflTradeIntelligence/valuation/privateValuationEvaluationDecision';

const digest = (character: string) => character.repeat(64);

function artifact(character: string) {
  const contentSha256 = digest(character);
  return {
    artifactId: `artifact:${contentSha256}`,
    contentSha256,
    storageUri: `artifact://sha256/${contentSha256}`,
    mediaType: 'application/json',
    byteLength: 128,
    createdAt: '2026-08-16T01:00:00.000Z',
  };
}

function decision(status: 'authorized' | 'withdrawn') {
  return createAflTradePrivateValuationEvaluationDecision({
    status,
    valuationScopeKey: 'afl-men:2025-trades',
    factualReleaseScopeKey: 'public-afl-draft-trade-outcomes',
    factualReleaseId: `outcome-release:${digest('1')}`,
    factualReleaseArtifact: artifact('2'),
    releaseMembershipArtifact: artifact('3'),
    sourceRightsEvidenceRefs: [artifact('4'), artifact('5')],
    revision: status === 'authorized' ? 1 : 2,
    supersedesDecisionId:
      status === 'authorized' ? null : `private-valuation-evaluation-decision:${digest('6')}`,
    reviewerId: 'local-factual-release-owner',
    rationale: status === 'authorized' ? 'Authorize private evaluation.' : 'Withdraw authority.',
    decidedAt: status === 'authorized' ? '2026-08-16T02:00:00.000Z' : '2026-08-16T03:00:00.000Z',
  });
}

describe('private valuation evaluation admission', () => {
  it('returns a calculation-only authority from the exact current authorized decision', () => {
    const current = decision('authorized');
    const admission = createAflTradePrivateValuationEvaluationAdmission(current);

    expect(admission).toEqual({
      state: 'authorized',
      authority: {
        kind: 'private_nonproduction_derived_calculation',
        decisionId: current.decisionId,
        valuationScopeKey: current.content.valuationScopeKey,
        factualReleaseId: current.content.factualReleaseId,
        factualReleaseArtifact: current.content.factualReleaseArtifact,
        releaseMembershipArtifact: current.content.releaseMembershipArtifact,
        sourceRightsEvidenceRefs: current.content.sourceRightsEvidenceRefs,
        publicationEligible: false,
        publicationProhibited: true,
      },
    });
  });

  it('fails closed after withdrawal and when no current decision exists', () => {
    const withdrawn = decision('withdrawn');

    expect(createAflTradePrivateValuationEvaluationAdmission(withdrawn)).toEqual({
      state: 'blocked',
      reason: 'withdrawn',
      decisionId: withdrawn.decisionId,
    });
    expect(createAflTradePrivateValuationEvaluationAdmission(null)).toEqual({
      state: 'blocked',
      reason: 'not_authorized',
      decisionId: null,
    });
  });
});
