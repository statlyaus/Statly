import { describe, expect, it } from 'vitest';

import { createAflTradeCompleteAssessmentVerificationFixture } from '@/server/aflTradeIntelligence/development/aflTradeCompleteAssessmentFixture';
import { createAflTradeValuationOutputInventoryVerificationFixture } from '@/server/aflTradeIntelligence/development/localAflTradeProjectionFixture';
import { createLocalAflTradeSyntheticValuationFixture } from '@/server/aflTradeIntelligence/development/localAflTradeSyntheticValuationFixture';
import { assertLocalAflTradeValuationPublicationFixtureAuthority } from '@/server/aflTradeIntelligence/development/localAflTradeValuationPublicationCandidate';
import { validateAflTradeValuationArtifactChain } from '@/server/aflTradeIntelligence/valuation/tradeValuationValidation';

describe('local archive-backed synthetic valuation fixture', () => {
  it('preserves authenticated archive ancestry under disposable fixture publication authority', () => {
    const inventory = createAflTradeValuationOutputInventoryVerificationFixture();
    const complete = createAflTradeCompleteAssessmentVerificationFixture(inventory);
    const { archive, assessedAt } = complete.assessmentInput;
    const tradeId = complete.assessmentInput.valuationCase.content.tradeId;

    const fixture = createLocalAflTradeSyntheticValuationFixture({
      environment: 'test_fixture',
      archive,
      tradeId,
      valuationBundleId: inventory.valuationBundle.valuationBundleManifest.valuationBundleId,
      scenario: 'baseline',
      assessedAt,
    });

    expect(fixture.factualParent).toEqual({
      archiveId: archive.archiveId,
      releaseId: archive.content.releaseId,
      factualCandidateId: archive.content.factualCandidateId,
      tradeId,
    });
    expect(fixture.productionEligible).toBe(false);
    expect(fixture.fixtureAuthority).toEqual({
      kind: 'disposable_fixture_publication_rehearsal',
      environment: 'test_fixture',
      productionEligible: false,
    });
    expect(fixture).not.toHaveProperty('authority');
    expect(() => assertLocalAflTradeValuationPublicationFixtureAuthority(fixture)).not.toThrow();
    expect(fixture.assessmentVerification.output.content.tradeId).toBe(tradeId);
    expect(
      validateAflTradeValuationArtifactChain({
        valuationCase: fixture.valuationCase,
        lineageGraph: fixture.lineageGraph,
        componentDrawSet: fixture.componentDrawSet,
        realizedContributionLedger: fixture.realizedContributionLedger,
        packagePolicy: fixture.packagePolicy,
        calculation: fixture.calculation,
        snapshotSet: fixture.snapshotSet,
        explanation: fixture.explanation,
      }).structurallyValid
    ).toBe(true);
  });

  it('rejects private scenario authority at publication ingress', () => {
    expect(() =>
      assertLocalAflTradeValuationPublicationFixtureAuthority({
        authority: {
          kind: 'private_scenario',
          publicationEligible: false,
          publicationProhibited: true,
        },
      })
    ).toThrow('Valuation publication rehearsal requires disposable fixture authority.');
  });
});
