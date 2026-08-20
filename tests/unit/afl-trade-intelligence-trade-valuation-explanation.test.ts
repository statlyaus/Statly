// @vitest-environment node

import { describe, expect, it } from 'vitest';

import type { DraftTradeDetail } from '@/lib/draftTrades/firestore';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { prepareLocalWorkbookSyntheticValuation } from '@/server/aflTradeIntelligence/development/localWorkbookSyntheticValuation';
import {
  createAflTradeValuationExplanation,
  createGovernedAflTradeValuationExplanation,
} from '@/server/aflTradeIntelligence/valuation/tradeValuationExplanation';
import { createGovernedPrivateEvaluationAuthenticatedCalculationFixture } from '../testUtils/governedPrivateEvaluationAuthenticatedCalculationFixture';

const TRADE_ID = 'workbook-2025-explanation-test';
const VALUATION_BUNDLE_ID = `valuation-bundle:${'c'.repeat(64)}`;

function tradeDetail(): DraftTradeDetail {
  return {
    trade: {
      tradeId: TRADE_ID,
      year: 2025,
      seqInYear: 1,
      title: 'Private workbook explanation test',
      clubSlugs: ['adelaide', 'st-kilda'],
      clubNames: ['Adelaide', 'St Kilda'],
      partyCount: 2,
      assetCount: 2,
      hasPlayers: true,
      hasPicks: true,
      hasFuturePicks: false,
      receivesByClub: [],
    },
    parties: [
      {
        id: 'party:adelaide',
        tradeId: TRADE_ID,
        year: 2025,
        seqInYear: 1,
        tradeTitle: 'Private workbook explanation test',
        clubSlug: 'adelaide',
        clubName: 'Adelaide',
        rowOrder: 1,
        assetsRaw: 'Player A',
        expected: null,
        actual: null,
      },
      {
        id: 'party:st-kilda',
        tradeId: TRADE_ID,
        year: 2025,
        seqInYear: 1,
        tradeTitle: 'Private workbook explanation test',
        clubSlug: 'st-kilda',
        clubName: 'St Kilda',
        rowOrder: 2,
        assetsRaw: 'Pick 10',
        expected: null,
        actual: null,
      },
    ],
    assets: [
      {
        id: 'asset:player-a',
        tradeId: TRADE_ID,
        year: 2025,
        clubSlug: 'adelaide',
        clubName: 'Adelaide',
        assetIndex: 1,
        assetType: 'player',
        assetText: 'Player A',
        playerName: 'Player A',
        pick: {
          code: null,
          numberGiven: null,
          year: null,
          round: null,
          originalClub: null,
          numberActual: null,
        },
        draftedPlayer: null,
        games: null,
        note: null,
      },
      {
        id: 'asset:pick-10',
        tradeId: TRADE_ID,
        year: 2025,
        clubSlug: 'st-kilda',
        clubName: 'St Kilda',
        assetIndex: 2,
        assetType: 'pick',
        assetText: 'Pick 10',
        playerName: null,
        pick: {
          code: '10',
          numberGiven: 10,
          year: null,
          round: null,
          originalClub: null,
          numberActual: null,
        },
        draftedPlayer: null,
        games: null,
        note: null,
      },
    ],
  };
}

function threePartyTradeDetail(): DraftTradeDetail {
  const base = tradeDetail();
  return {
    trade: {
      ...base.trade,
      clubSlugs: ['adelaide', 'brisbane', 'st-kilda'],
      clubNames: ['Adelaide', 'Brisbane', 'St Kilda'],
      partyCount: 3,
      assetCount: 3,
    },
    parties: [
      base.parties[0]!,
      {
        ...base.parties[0]!,
        id: 'party:brisbane',
        clubSlug: 'brisbane',
        clubName: 'Brisbane',
        rowOrder: 2,
        assetsRaw: 'Pick 20',
      },
      { ...base.parties[1]!, rowOrder: 3 },
    ],
    assets: [
      base.assets[0]!,
      {
        ...base.assets[1]!,
        id: 'asset:pick-20',
        clubSlug: 'brisbane',
        clubName: 'Brisbane',
        assetIndex: 2,
        assetText: 'Pick 20',
        pick: { ...base.assets[1]!.pick, code: '20', numberGiven: 20 },
      },
      { ...base.assets[1]!, assetIndex: 3 },
    ],
  };
}

function preparedScenario(trade = tradeDetail()) {
  const prepared = prepareLocalWorkbookSyntheticValuation({
    environment: 'test_fixture',
    trade,
    workbookSha256: 'd'.repeat(64),
    valuationBundleId: VALUATION_BUNDLE_ID,
    scenario: 'baseline',
    assessedAt: '2026-08-05T04:30:00.000Z',
  });
  if (prepared.state !== 'ready') throw new Error('Expected a ready synthetic scenario.');
  return prepared.scenario;
}

function explanationInput(scenario: ReturnType<typeof preparedScenario>) {
  return {
    admittedAssumptionSetId: scenario.assumptionSet.assumptionSetId,
    directionEvidence: scenario.assumptionSet,
    valuationCase: scenario.valuationCase,
    valuationCalculation: scenario.calculation,
    selectedLayer: 'scarcityAdjusted' as const,
    gradeContext: {
      confidenceLevel: 'high' as const,
      developmentPreview: true,
    },
  };
}

describe('AFL trade valuation explanation document', () => {
  it('automatically calculates exact asymmetric multi-club package banks from authenticated inputs', () => {
    const fixture = createGovernedPrivateEvaluationAuthenticatedCalculationFixture();
    const result = createGovernedAflTradeValuationExplanation(fixture);

    expect(result.state).toBe('available');
    if (result.state !== 'available') throw new Error('Expected an available explanation.');
    expect(result.document).toMatchObject({
      tradeId: 'trade:authenticated-three-club',
      authority: {
        kind: 'authenticated_non_production',
        inputTraceId: fixture.trace.inputTraceId,
        explanationPolicyId: fixture.explanationPolicy.policyId,
        publicationProhibited: true,
      },
      confidenceLevel: 'unavailable',
    });
    expect(result.document.valuationCalculationId).toMatch(
      /^valuation-calculation:[a-f0-9]{64}$/
    );
    const current = result.document.views.find(({ view }) => view === 'current')!;
    expect(current.clubs.map(({ aflClubId }) => aflClubId)).toEqual([
      'club:alpha',
      'club:bravo',
      'club:charlie',
    ]);
    expect(current.clubs.find(({ aflClubId }) => aflClubId === 'club:alpha')).toMatchObject({
      received: { assets: [{ assetId: 'asset:03' }, { assetId: 'asset:04' }] },
      givenUp: { assets: [{ assetId: 'asset:01' }, { assetId: 'asset:02' }] },
      grade: {
        grade: null,
        state: 'unavailable',
        reasonCode: 'grade_confidence_authority_unavailable',
      },
    });
    expect(
      current.clubs.every(
        ({ received, givenUp, grade }) =>
          received.assets.length > 0 && givenUp.assets.length > 0 && grade.grade === null
      )
    ).toBe(true);
  });

  it('reconciles additive asset contributions while retaining package uncertainty separately', () => {
    const result = createAflTradeValuationExplanation(explanationInput(preparedScenario()));

    expect(result.state).toBe('available');
    if (result.state !== 'available') throw new Error('Expected an available explanation.');
    expect(result.document).toMatchObject({
      schemaVersion: 'afl-trade-valuation-explanation/v1',
      tradeId: TRADE_ID,
      defaultView: 'current',
      authority: {
        kind: 'private_synthetic',
        publicationProhibited: true,
      },
      valueUnitId: 'fabricated-football-contribution-above-replacement-v1',
      coverage: { status: 'complete', ratio: 1 },
      confidenceLevel: 'high',
    });

    const atTrade = result.document.views.find(({ view }) => view === 'at_trade')!;
    const adelaide = atTrade.clubs.find(({ aflClubId }) => aflClubId === 'afl-club:adelaide')!;
    expect(adelaide.received.assets).toEqual([
      expect.objectContaining({
        assetId: 'asset:player-a',
        label: 'Player A',
        additiveMean: 10.4,
      }),
    ]);
    expect(adelaide.received.additiveMean).toBe(10.4);
    expect(adelaide.givenUp.additiveMean).toBe(5.2);
    expect(adelaide.net.additiveMean).toBe(5.2);
    expect(adelaide.net.distribution).toEqual({ mean: 5.2, median: 6, p10: 4, p90: 6 });
    expect(adelaide.finishAheadProbability).toBe(1);
    expect(adelaide.grade).toMatchObject({ grade: 'A+', state: 'provisional' });

    const current = result.document.views.find(({ view }) => view === 'current')!;
    const currentAsset = current.clubs.find(({ aflClubId }) => aflClubId === 'afl-club:adelaide')!
      .received.assets[0]!;
    expect(currentAsset).toMatchObject({
      additiveMean: 7.2,
      currentComponents: { realizedMean: 2, remainingMean: 5.2 },
      layers: {
        grossMean: 7.2,
        listSpotAdjustedMean: 7.2,
        scarcityAdjustedMean: 7.2,
        listSpotDelta: 0,
        scarcityDelta: 0,
      },
    });
    expect(currentAsset.additiveMean).toBe(
      currentAsset.currentComponents!.realizedMean + currentAsset.currentComponents!.remainingMean
    );
  });

  it('derives practical-equivalence mass from aligned draws before applying the grade policy', () => {
    const scenario = preparedScenario();
    const input = explanationInput(scenario);
    const content = {
      ...scenario.assumptionSet.content,
      explanationPolicy: {
        ...scenario.assumptionSet.content.explanationPolicy,
        practicalEquivalenceBandByView: {
          ...scenario.assumptionSet.content.explanationPolicy.practicalEquivalenceBandByView,
          at_trade: 9,
        },
      },
    };
    const assumptionSetId = createAflTradeContentAddress('artifact', content);
    const result = createAflTradeValuationExplanation({
      ...input,
      admittedAssumptionSetId: assumptionSetId,
      directionEvidence: {
        assumptionSetId,
        content,
      },
    });

    expect(result.state).toBe('available');
    if (result.state !== 'available') throw new Error('Expected an available explanation.');
    const atTrade = result.document.views.find(({ view }) => view === 'at_trade')!;
    const competitiveMass = atTrade.clubs.reduce(
      (sum, club) => sum + club.finishAheadProbability,
      0
    );
    expect(atTrade.practicalEquivalenceProbability).toBeGreaterThan(0);
    expect(atTrade.practicalEquivalenceProbability).toBeLessThan(1);
    expect(competitiveMass + atTrade.practicalEquivalenceProbability).toBeCloseTo(1, 10);
  });

  it('fails closed when calculation ancestry does not match the valuation case', () => {
    const scenario = preparedScenario();
    const input = explanationInput(scenario);

    expect(() =>
      createAflTradeValuationExplanation({
        ...input,
        valuationCalculation: {
          ...scenario.calculation,
          content: {
            ...scenario.calculation.content,
            valuationCaseId: `valuation-case:${'f'.repeat(64)}`,
          },
        },
      })
    ).toThrow('EXPLANATION_CONTRACT_VIOLATION');
  });

  it('fails closed when an authenticated direction artifact changes a sender', () => {
    const scenario = preparedScenario();
    const input = explanationInput(scenario);
    const transfer = scenario.assumptionSet.content.transferDirections[0]!;
    const content = {
      ...scenario.assumptionSet.content,
      transferDirections: [
        { ...transfer, fromClubId: transfer.toClubId },
        ...scenario.assumptionSet.content.transferDirections.slice(1),
      ],
    };

    expect(() =>
      createAflTradeValuationExplanation({
        ...input,
        directionEvidence: {
          assumptionSetId: createAflTradeContentAddress('artifact', content),
          content,
        },
      })
    ).toThrow('EXPLANATION_CONTRACT_VIOLATION');
  });

  it('rejects a valid-looking alternative sender cycle outside the deterministic mapping policy', () => {
    const scenario = preparedScenario(threePartyTradeDetail());
    const input = explanationInput(scenario);
    const partyIds = scenario.valuationCase.content.parties.map(({ aflClubId }) => aflClubId);
    const content = {
      ...scenario.assumptionSet.content,
      transferDirections: scenario.assumptionSet.content.transferDirections.map((transfer) => {
        const receiverIndex = partyIds.indexOf(transfer.toClubId);
        return {
          ...transfer,
          fromClubId: partyIds[(receiverIndex + 1) % partyIds.length]!,
        };
      }),
    };
    const assumptionSetId = createAflTradeContentAddress('artifact', content);

    expect(() =>
      createAflTradeValuationExplanation({
        ...input,
        admittedAssumptionSetId: assumptionSetId,
        directionEvidence: { assumptionSetId, content },
      })
    ).toThrow('EXPLANATION_CONTRACT_VIOLATION');
  });

  it('fails closed when assumption timing is not the exact valuation-case window', () => {
    const scenario = preparedScenario();
    const input = explanationInput(scenario);
    const content = {
      ...scenario.assumptionSet.content,
      effectiveThrough: '2026-08-06T04:30:00.000Z',
    };
    const assumptionSetId = createAflTradeContentAddress('artifact', content);

    expect(() =>
      createAflTradeValuationExplanation({
        ...input,
        admittedAssumptionSetId: assumptionSetId,
        directionEvidence: { assumptionSetId, content },
      })
    ).toThrow('EXPLANATION_CONTRACT_VIOLATION');
  });

  it('fails closed when a calculation draw contains a root outside the valuation case', () => {
    const scenario = preparedScenario();
    const input = explanationInput(scenario);
    const calculationContent = {
      ...scenario.calculation.content,
      draws: scenario.calculation.content.draws.map((draw) => ({
        ...draw,
        parties: draw.parties.map((party, partyIndex) => ({
          ...party,
          views: party.views.map((view) => {
            if (partyIndex !== 0) return view;
            const originalRoot = view.roots[0]!;
            const zeroRoot = {
              ...structuredClone(originalRoot),
              assetId: 'asset:unexpected-root',
              universal: {
                status: 'available' as const,
                layers: { gross: 0, listSpotAdjusted: 0, scarcityAdjusted: 0 },
              },
            };
            return {
              ...view,
              roots: [...view.roots, zeroRoot].sort((left, right) =>
                left.assetId.localeCompare(right.assetId)
              ),
            };
          }),
        })),
      })),
    };
    const valuationCalculation = {
      valuationCalculationId: createAflTradeContentAddress(
        'valuation-calculation',
        calculationContent
      ),
      content: calculationContent,
    };
    const directionContent = {
      ...scenario.assumptionSet.content,
      valuationCalculationId: valuationCalculation.valuationCalculationId,
    };
    const assumptionSetId = createAflTradeContentAddress('artifact', directionContent);

    expect(() =>
      createAflTradeValuationExplanation({
        ...input,
        valuationCalculation,
        admittedAssumptionSetId: assumptionSetId,
        directionEvidence: { assumptionSetId, content: directionContent },
      })
    ).toThrow('EXPLANATION_CONTRACT_VIOLATION');
  });

  it('fails closed when a calculation draw contains a party outside the valuation case', () => {
    const scenario = preparedScenario();
    const input = explanationInput(scenario);
    const calculationContent = {
      ...scenario.calculation.content,
      draws: scenario.calculation.content.draws.map((draw) => ({
        ...draw,
        parties: [
          ...draw.parties,
          {
            ...structuredClone(draw.parties[0]!),
            aflClubId: 'afl-club:brisbane',
          },
        ].sort((left, right) => left.aflClubId.localeCompare(right.aflClubId)),
      })),
    };
    const valuationCalculation = {
      valuationCalculationId: createAflTradeContentAddress(
        'valuation-calculation',
        calculationContent
      ),
      content: calculationContent,
    };
    const directionContent = {
      ...scenario.assumptionSet.content,
      valuationCalculationId: valuationCalculation.valuationCalculationId,
    };
    const assumptionSetId = createAflTradeContentAddress('artifact', directionContent);

    expect(() =>
      createAflTradeValuationExplanation({
        ...input,
        valuationCalculation,
        admittedAssumptionSetId: assumptionSetId,
        directionEvidence: {
          assumptionSetId,
          content: directionContent,
        },
      })
    ).toThrow('EXPLANATION_CONTRACT_VIOLATION');
  });
});
