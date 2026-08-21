import {
  createAutomatedGovernedPrivateEvaluationGeneration,
  parseGovernedPrivateEvaluationGeneration,
  parseGovernedPrivateEvaluationProjectionManifest,
  verifyGovernedPrivateEvaluationGeneration,
} from '@/server/aflTradeIntelligence/valuation/governedPrivateEvaluationGeneration';
import { createGovernedPrivateEvaluationNarrativeFixture } from '../testUtils/governedPrivateEvaluationFixture';

describe('automated governed private evaluation generation', () => {
  it('retains a publication-prohibited non-production generation under narrow agent authority', () => {
    const narrative = createGovernedPrivateEvaluationNarrativeFixture();
    const materialization = createAutomatedGovernedPrivateEvaluationGeneration({
      selector: {
        valuationScopeKey: 'afl.mens.trade-value:2026',
        tradeId: narrative.content.tradeId,
      },
      transitionIntentId: `private-evaluation-transition-intent:${'a'.repeat(64)}`,
      generatedAt: '2026-08-21T09:00:00.000Z',
      constructionAuthority: {
        kind: 'automated_private_calculation_agent',
        principalId: 'system:weekly-valuation-coordinator',
      },
      narrative,
    });

    expect(parseGovernedPrivateEvaluationGeneration(materialization.generation)).toMatchObject({
      content: {
        schemaVersion: 'local-private-trade-evaluation-generation/v2',
        environment: 'non_production',
        constructionAuthority: {
          kind: 'automated_private_calculation_agent',
          principalId: 'system:weekly-valuation-coordinator',
        },
        publicationProhibited: true,
      },
    });
    expect(
      parseGovernedPrivateEvaluationProjectionManifest(materialization.projectionManifest)
    ).toMatchObject({
      content: {
        schemaVersion: 'governed-private-evaluation-projection-manifest/v2',
        environment: 'non_production',
        publicationProhibited: true,
      },
    });
    expect(verifyGovernedPrivateEvaluationGeneration(materialization)).toBe(true);
  });
});
