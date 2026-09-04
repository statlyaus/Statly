// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { createGovernedPrivateEvaluationInputTrace } from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationInputTrace';
import {
  materializeGovernedPrivateEvaluation,
  replayGovernedPrivateEvaluationMaterialization,
} from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationMaterializer';
import {
  AFL_TRADE_VALUATION_CALCULATION_INPUT_PACKAGE_V2_SCHEMA_VERSION,
  createAflTradeValuationCalculationInputPackage,
} from '@/server/aflTradeIntelligence/valuation/valuationCalculationInputPackage';
import { createGovernedPrivateEvaluationAuthenticatedCalculationFixture } from '../testUtils/governedPrivateEvaluationAuthenticatedCalculationFixture';

describe('governed private-evaluation materializer', () => {
  it('derives exact calculation stories and club package arithmetic from authenticated evidence', () => {
    const fixture = createGovernedPrivateEvaluationAuthenticatedCalculationFixture();

    const result = replayGovernedPrivateEvaluationMaterialization({
      ...fixture,
      playerObservations: [],
    });

    expect(result.state).toBe('ready');
    if (result.state !== 'ready') throw new Error('Expected ready materialization.');

    expect(result.explanation.authority).toMatchObject({
      kind: 'authenticated_non_production',
      inputTraceId: fixture.trace.inputTraceId,
      publicationProhibited: true,
    });
    expect(result.narrative.content.assets).toHaveLength(4);
    expect(result.narrative.content.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetId: 'asset:01',
          label: 'Pick 25',
          story: expect.stringContaining(
            'estimated from 1 observations across 1 draft classes (picks 25-25)'
          ),
          modelEvidence: expect.objectContaining({
            kind: 'pick',
            selectionNumber: 25,
            expected: expect.objectContaining({ contribution: 5.2 }),
          }),
          lineage: expect.objectContaining({
            rootAssetId: 'asset:01',
            frontierAssetIds: [expect.stringMatching(/^artifact:[a-f0-9]{64}$/)],
            nodes: expect.arrayContaining([
              expect.objectContaining({ assetId: 'asset:01', label: 'Pick 25', depth: 0 }),
              expect.objectContaining({
                label: 'Player selected with Pick 25',
                depth: 2,
              }),
            ]),
          }),
        }),
      ])
    );

    const current = result.narrative.content.views.find(({ view }) => view === 'current')!;
    const alpha = current.clubs.find(({ aflClubId }) => aflClubId === 'club:alpha')!;
    expect(alpha).toMatchObject({
      receivedAssetIds: ['asset:03', 'asset:04'],
      givenUpAssetIds: ['asset:01', 'asset:02'],
      arithmetic: {
        receivedMean: 21.3,
        givenUpMean: 10.8,
        estimatedAdvantageMean: 10.5,
      },
      grade: {
        grade: null,
        state: 'unavailable',
        reasonCode: 'grade_confidence_authority_unavailable',
      },
      summary: expect.stringContaining('21.3 - 10.8 = +10.5'),
    });
    expect(
      result.narrative.content.assets.find(({ assetId }) => assetId === 'asset:01')!.contributions
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          view: 'at_trade',
          story: expect.stringContaining('5.2 fixed_horizon_pav expected from 1 observations'),
        }),
        expect.objectContaining({
          view: 'current',
          story: expect.stringContaining('realized +'),
        }),
      ])
    );
  });

  it('rejects a valid-looking parent substituted after the retained manifest', () => {
    const fixture = createGovernedPrivateEvaluationAuthenticatedCalculationFixture();
    const materializationManifest = {
      ...fixture.materializationManifest,
      content: {
        ...fixture.materializationManifest.content,
        lineageGraphArtifact: fixture.materializationManifest.content.explanationPolicyArtifact,
      },
    };

    expect(() =>
      replayGovernedPrivateEvaluationMaterialization({
        ...fixture,
        materializationManifest,
        playerObservations: [],
      })
    ).toThrow();
  });

  it('returns explicit unavailability rather than calculating through an unresolved pick', () => {
    const fixture = createGovernedPrivateEvaluationAuthenticatedCalculationFixture();
    const trace = createGovernedPrivateEvaluationInputTrace({
      ...fixture.trace.content,
      pickLineages: fixture.trace.content.pickLineages.map((lineage, index) =>
        index === 0 ? { ...lineage, resolvedSelectionNumber: null } : lineage
      ),
    });
    const calculationInputContent = fixture.calculationInputPackage.content;
    if (
      calculationInputContent.schemaVersion !==
      AFL_TRADE_VALUATION_CALCULATION_INPUT_PACKAGE_V2_SCHEMA_VERSION
    ) {
      throw new Error('Expected an authenticated calculation-input fixture.');
    }
    const calculationInputPackage = createAflTradeValuationCalculationInputPackage({
      ...calculationInputContent,
      authority: {
        kind: 'authenticated_non_production',
        inputTraceId: trace.inputTraceId,
        publicationProhibited: true,
      },
    });

    const result = materializeGovernedPrivateEvaluation({
      ...fixture,
      trace,
      calculationInputPackage,
      playerObservations: [],
    });

    expect(result).toEqual({
      state: 'unavailable',
      tradeId: fixture.trace.content.selector.tradeId,
      blockers: [
        {
          code: 'pick_selection_unresolved',
          assetId: 'asset:01',
          message: 'Pick 25 has no authenticated resolved selection number.',
        },
      ],
    });
  });
});
