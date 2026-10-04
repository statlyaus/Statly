import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import type { AflTradeAssetLineageNarrativeEvidence } from '@/server/aflTradeIntelligence/valuation/assetLineageNarrativeEvidence';
import type { AflTradePickCalculationEvidence } from '@/server/aflTradeIntelligence/valuation/calculationNarrativeEvidence';
import { createAflTradeCalculationNarrative } from '@/server/aflTradeIntelligence/valuation/tradeCalculationNarrative';
import type {
  AflTradeValuationAssetContribution,
  AflTradeValuationExplanationDocument,
} from '@/server/aflTradeIntelligence/valuation/tradeValuationExplanation';

const views = ['at_trade', 'realized', 'remaining', 'current'] as const;

function addressed(kind: string, index: number): string {
  return `${kind}:${(index % 15).toString(16).repeat(64)}`;
}

function distribution(mean: number) {
  return { mean, median: mean, p10: mean - 1, p90: mean + 1 };
}

export function createGovernedPrivateEvaluationMultiClubNarrativeFixture(
  clubCount: 3 | 4
) {
  const clubs = Array.from({ length: clubCount }, (_, index) => ({
    aflClubId: `afl-club:fixture-${index + 1}`,
    clubName: `Fixture Club ${index + 1}`,
  }));
  const assetIdentities = clubs.map((fromClub, index) => ({
    assetId: `asset:fixture-pick-${index + 1}`,
    assetKind: 'current_pick' as const,
    label: `Pick ${10 + index}`,
    fromClubId: fromClub.aflClubId,
    toClubId: clubs[(index + 1) % clubCount]!.aflClubId,
    value: 50 + index * 10,
  }));
  const contribution = (
    identity: (typeof assetIdentities)[number],
    view: (typeof views)[number]
  ): AflTradeValuationAssetContribution => {
    const value = view === 'realized' ? 0 : identity.value;
    return {
      ...identity,
      additiveMean: value,
      distribution: distribution(value),
      currentComponents: view === 'current' ? { realizedMean: 0, remainingMean: value } : null,
      layers: {
        grossMean: value,
        listSpotAdjustedMean: value,
        scarcityAdjustedMean: value,
        listSpotDelta: 0,
        scarcityDelta: 0,
      },
      evidenceState: 'complete',
    };
  };
  const explanationContent = {
    schemaVersion: 'afl-trade-valuation-explanation/v1' as const,
    tradeId: `trade:fixture-${clubCount}-club`,
    defaultView: 'current' as const,
    authority: {
      kind: 'private_synthetic' as const,
      assumptionSetId: addressed('artifact', 1),
      publicationProhibited: true as const,
      warning: 'Fabricated rank-based test values — not real AFL data.' as const,
    },
    valueUnitId: 'fixed_horizon_pav',
    valuationBundleId: addressed('valuation-bundle', 2),
    valuationCaseId: addressed('valuation-case', 3),
    valuationCalculationId: addressed('valuation-calculation', 4),
    effectiveAt: '2026-08-19T00:00:00.000Z',
    effectiveThrough: '2026-08-19T23:59:59.999Z',
    coverage: { status: 'complete' as const, ratio: 1 as const },
    confidenceLevel: 'high' as const,
    selectedLayer: 'scarcityAdjusted' as const,
    views: views.map((view) => {
      const contributions = new Map(
        assetIdentities.map((identity) => [identity.assetId, contribution(identity, view)])
      );
      return {
        view,
        practicalEquivalenceProbability: 0.1,
        verdict: { kind: 'favours_club' as const, aflClubIds: [clubs[0]!.aflClubId] },
        clubs: clubs.map((club, clubIndex) => {
          const received = contributions.get(
            assetIdentities[(clubIndex - 1 + clubCount) % clubCount]!.assetId
          )!;
          const givenUp = contributions.get(assetIdentities[clubIndex]!.assetId)!;
          const net = received.additiveMean - givenUp.additiveMean;
          return {
            ...club,
            received: {
              assets: [received],
              additiveMean: received.additiveMean,
              distribution: distribution(received.additiveMean),
            },
            givenUp: {
              assets: [givenUp],
              additiveMean: givenUp.additiveMean,
              distribution: distribution(givenUp.additiveMean),
            },
            net: { additiveMean: net, distribution: distribution(net) },
            finishAheadProbability: 0.9 / clubCount,
            grade: {
              grade: 'B' as const,
              state: 'provisional' as const,
              reasonCode: 'complete_high_confidence_development_preview',
            },
          };
        }),
      };
    }),
    methodology: {
      additiveStatistic: 'probability_weighted_mean' as const,
      uncertaintyStatistic: 'joint_draw_weighted_quantiles' as const,
      packageMedianIsAdditive: false as const,
      assetGradeTreatment: 'prohibited' as const,
      currentIdentity: 'realized_plus_remaining' as const,
      practicalEquivalenceBasis: 'Fixture threshold.',
      practicalEquivalencePolicy: {
        assumptionSetId: addressed('artifact', 1),
        valueUnitId: 'fixed_horizon_pav',
        bandByView: { at_trade: 1, realized: 1, remaining: 1, current: 1 },
      },
    },
  };
  const explanation: AflTradeValuationExplanationDocument = {
    explanationId: createAflTradeContentAddress('valuation-explanation', explanationContent),
    ...explanationContent,
  };
  return createAflTradeCalculationNarrative({
    explanation,
    assets: assetIdentities.map((identity, index) => {
      const modelEvidence: AflTradePickCalculationEvidence = {
        kind: 'pick',
        benchmarkId: addressed('pick-pav-benchmark', 5 + index),
        observationSetId: addressed('pick-pav-observation-set', 6 + index),
        policyId: addressed('pick-pav-policy', 7 + index),
        methodId: addressed('hpn-pav-method', 8 + index),
        valueUnit: 'fixed_horizon_pav',
        selectionNumber: 10 + index,
        cohort: {
          minimumSelectionNumber: 8 + index,
          maximumSelectionNumber: 12 + index,
          observationCount: 48,
          draftClassCount: 12,
          sourceSelectionNumbers: [8 + index, 9 + index, 10 + index, 11 + index, 12 + index],
        },
        expected: { contribution: identity.value, games: 80 + index },
        centralRange: {
          contribution: { p10: 20, p50: identity.value, p90: 130 },
          games: { p10: 12, p50: 76, p90: 180 },
        },
        outcomeProbabilities: [],
        empiricalSupportObservationIds: [addressed('pick-pav-observation', 9 + index)],
        fixedHorizonSeasons: 5,
        limitation: 'Training-only multi-club fixture cohort.',
      };
      const lineage: AflTradeAssetLineageNarrativeEvidence = {
        lineageGraphId: addressed('lineage-graph', 10 + index),
        rootAssetId: identity.assetId,
        cutoff: {
          effectiveAsOf: '2026-08-19T00:00:00.000Z',
          knowledgeCutoffAt: '2026-08-19T00:00:00.000Z',
        },
        nodes: [
          {
            assetId: identity.assetId,
            assetType: 'current_pick_entitlement',
            label: identity.label,
            depth: 0,
            effectiveFrom: '2025-10-10T00:00:00.000Z',
            evidenceId: `evidence:${identity.assetId}`,
          },
        ],
        transformations: [],
        custodyHistory: [],
        dispositions: [],
        frontierAssetIds: [identity.assetId],
      };
      return { assetId: identity.assetId, modelEvidence, lineage };
    }),
  });
}
