// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { compareAflTradeCodeUnits } from '@/server/aflTradeIntelligence/valuation/deterministicProbabilityMeasure';
import {
  AFL_TRADE_JOINT_OUTCOME_COMPARISON_VALUE_SCOPE,
  AFL_TRADE_JOINT_OUTCOME_DEFINITION_VERSION,
  AFL_TRADE_JOINT_OUTCOME_INPUT_SCHEMA_VERSION,
  AFL_TRADE_JOINT_OUTCOME_PUBLIC_ASSET_BOUNDARY,
  AFL_TRADE_JOINT_OUTCOME_VALUE_SCALE_DEFINITION_VERSION,
  calculateAflTradeJointOutcomeComparison,
  type AflTradeJointOutcomeComparisonInput,
} from '@/server/aflTradeIntelligence/valuation/jointOutcomeComparison';
import {
  AFL_TRADE_VALUATION_COMPARISON_LIMITATION,
  AFL_TRADE_VALUATION_COMPARISON_PREDECESSOR_COMPATIBILITY,
  AFL_TRADE_VALUATION_COMPARISON_PREDECESSOR_SCHEMA_VERSION,
  AFL_TRADE_VALUATION_COMPARISON_VALUE_PATHS,
  AFL_TRADE_VALUATION_COMPARISON_VERIFICATION_SCOPE,
  AflTradeValuationComparisonConstructionError,
  aflTradeValuationComparisonContentSchema,
  aflTradeValuationComparisonSchema,
  createAflTradeValuationComparison,
  isAflTradeValuationComparisonConstructionError,
  verifyAflTradeValuationComparisonCaseCalculationDerivation,
  type AflTradeValuationComparison,
  type AflTradeValuationComparisonMeasure,
} from '@/server/aflTradeIntelligence/valuation/jointOutcomeComparisonArtifact';
import {
  AFL_TRADE_JOINT_OUTCOME_VALUE_QUANTIZATION_DEFINITION_VERSION,
  quantizeAflTradeJointOutcomeValue,
  type AflTradeJointOutcomeValueQuantizationPolicy,
} from '@/server/aflTradeIntelligence/valuation/jointOutcomeValueQuantization';
import {
  aflTradeValuationCalculationSchema,
  type AflTradeValuationCalculation,
} from '@/server/aflTradeIntelligence/valuation/tradeValuationCalculation';
import { createFabricatedAflTradeValuationFixture } from '@/server/aflTradeIntelligence/valuation/tradeValuationFixtures';
import { validateAflTradeValuationArtifactChain } from '@/server/aflTradeIntelligence/valuation/tradeValuationValidation';
import {
  createAflTradeValuationCase,
  type AflTradeValuationCase,
} from '@/server/aflTradeIntelligence/valuation/valuationCaseContracts';
import { AFL_TRADE_VALUATION_VIEWS } from '@/types/aflTradeIntelligence';

const EXTRA_ROOT_ID = 'fixture:synthetic-comparison-extra-root';

function quantizationPolicy(decimalPlaces = 2): AflTradeJointOutcomeValueQuantizationPolicy {
  return {
    definitionVersion: AFL_TRADE_JOINT_OUTCOME_VALUE_QUANTIZATION_DEFINITION_VERSION,
    decimalPlaces,
  };
}

function createInput(
  valuationCase: AflTradeValuationCase,
  valuationCalculation: AflTradeValuationCalculation,
  overrides: Partial<{
    view: unknown;
    measure: unknown;
    quantizationPolicy: unknown;
    clearLeaderToleranceQuanta: unknown;
  }> = {}
): Record<string, unknown> {
  return {
    valuationCase,
    valuationCalculation,
    view: 'current',
    measure: { kind: 'universal_football_value', layer: 'gross' },
    quantizationPolicy: quantizationPolicy(),
    clearLeaderToleranceQuanta: 0,
    ...overrides,
  };
}

function expectConstructionError(
  action: () => unknown,
  code: AflTradeValuationComparisonConstructionError['code']
): void {
  try {
    action();
    throw new Error(`Expected ${code}.`);
  } catch (error) {
    expect(error).toBeInstanceOf(AflTradeValuationComparisonConstructionError);
    expect(error).toMatchObject({
      name: 'AflTradeValuationComparisonConstructionError',
      code,
    });
    expect(Object.isFrozen(error)).toBe(true);
  }
}

function readdressCalculation(
  content: AflTradeValuationCalculation['content']
): AflTradeValuationCalculation {
  return aflTradeValuationCalculationSchema.parse({
    valuationCalculationId: createAflTradeContentAddress('valuation-calculation', content),
    content,
  });
}

function readdressComparison(artifact: AflTradeValuationComparison): AflTradeValuationComparison {
  return aflTradeValuationComparisonSchema.parse({
    valuationComparisonId: createAflTradeContentAddress('valuation-comparison', artifact.content),
    content: artifact.content,
  });
}

type CalculationDraw = AflTradeValuationCalculation['content']['draws'][number];
type UniversalLayers = Extract<
  CalculationDraw['parties'][number]['views'][number]['universal'],
  { status: 'available' }
>['layers'];

function setAtTradeLayers(
  draw: CalculationDraw,
  partyIndex: number,
  layers: UniversalLayers
): void {
  const atTrade = draw.parties[partyIndex].views[0];
  if (atTrade.roots.length !== 1) throw new Error('Controlled fixtures require one root per club.');
  atTrade.roots[0].universal = { status: 'available', layers: { ...layers } };
  atTrade.universal = { status: 'available', layers: { ...layers } };
}

function setAtTradeUnavailable(
  draw: CalculationDraw,
  partyIndex: number,
  partialLayers: UniversalLayers,
  reasonCodes: string[]
): void {
  const atTrade = draw.parties[partyIndex].views[0];
  if (atTrade.roots.length !== 1) throw new Error('Controlled fixtures require one root per club.');
  atTrade.roots[0].universal = {
    status: 'unavailable',
    partialLayers: { ...partialLayers },
    reasonCodes: [...reasonCodes],
  };
  atTrade.universal = {
    status: 'unavailable',
    partialLayers: { ...partialLayers },
    reasonCodes: [...reasonCodes],
  };
}

function createControlledThreePartyCalculation(): {
  valuationCase: AflTradeValuationCase;
  calculation: AflTradeValuationCalculation;
} {
  const fixture = createFabricatedAflTradeValuationFixture('three_party_exchange');
  const content = structuredClone(fixture.calculation.content);
  const templates = [content.draws[0], content.draws[1], content.draws[0]].map((draw) =>
    structuredClone(draw)
  );
  const weights = [0.2, 0.3, 0.5];
  const values = [
    [1.005, 1.004, 0],
    [0, 2.005, 2.004],
    [5, 5, 0],
  ];
  content.draws = templates.map((draw, drawIndex) => {
    draw.drawIndex = drawIndex;
    draw.drawKey = `fixture-controlled-draw:${drawIndex}`;
    draw.probabilityWeight = weights[drawIndex];
    values[drawIndex].forEach((value, partyIndex) => {
      setAtTradeLayers(draw, partyIndex, {
        gross: value,
        listSpotAdjusted: value,
        scarcityAdjusted: value,
      });
    });
    return draw;
  });
  return {
    valuationCase: fixture.valuationCase,
    calculation: readdressCalculation(content),
  };
}

function zeroRoot(source: CalculationDraw['parties'][number]['views'][number]['roots'][number]) {
  return {
    ...structuredClone(source),
    assetId: EXTRA_ROOT_ID,
    universal: {
      status: 'available' as const,
      layers: { gross: 0, listSpotAdjusted: 0, scarcityAdjusted: 0 },
    },
    clubUtility: { status: 'available' as const, value: 0 },
  };
}

function createMultiRootFixture(): {
  valuationCase: AflTradeValuationCase;
  calculation: AflTradeValuationCalculation;
} {
  const fixture = createFabricatedAflTradeValuationFixture('two_party_player_swap');
  const caseContent = structuredClone(fixture.valuationCase.content);
  caseContent.parties[0].receivedRootAssetIds.push(EXTRA_ROOT_ID);
  caseContent.parties[0].receivedRootAssetIds.sort(compareAflTradeCodeUnits);
  const valuationCase = createAflTradeValuationCase(caseContent);

  const calculationContent = structuredClone(fixture.calculation.content);
  calculationContent.valuationCaseId = valuationCase.valuationCaseId;
  for (const draw of calculationContent.draws) {
    for (const view of draw.parties[0].views) {
      view.roots.push(zeroRoot(view.roots[0]));
      view.roots.sort((left, right) => compareAflTradeCodeUnits(left.assetId, right.assetId));
    }
  }
  return { valuationCase, calculation: readdressCalculation(calculationContent) };
}

function selectedValue(
  layers: UniversalLayers,
  measure: AflTradeValuationComparisonMeasure
): number {
  return measure.layer === 'list_spot_adjusted'
    ? layers.listSpotAdjusted
    : measure.layer === 'scarcity_adjusted'
      ? layers.scarcityAdjusted
      : layers.gross;
}

function independentlyProjectDraws(
  calculation: AflTradeValuationCalculation,
  view: (typeof AFL_TRADE_VALUATION_VIEWS)[number],
  measure: AflTradeValuationComparisonMeasure,
  policy: AflTradeJointOutcomeValueQuantizationPolicy
): AflTradeJointOutcomeComparisonInput['draws'] {
  return calculation.content.draws
    .map((draw) => ({
      drawKey: draw.drawKey,
      probabilityWeight: draw.probabilityWeight,
      parties: draw.parties.map((party) => {
        const universal = party.views.find((candidate) => candidate.view === view)!.universal;
        return {
          aflClubId: party.aflClubId,
          observation:
            universal.status === 'available'
              ? {
                  status: 'available' as const,
                  valueQuanta: quantizeAflTradeJointOutcomeValue(
                    selectedValue(universal.layers, measure),
                    policy
                  ),
                }
              : {
                  status: 'unavailable' as const,
                  reasonCodes: [...new Set(universal.reasonCodes)].sort(compareAflTradeCodeUnits),
                },
        };
      }),
    }))
    .sort((left, right) => compareAflTradeCodeUnits(left.drawKey, right.drawKey));
}

function independentlyCalculateComparison(
  valuationCase: AflTradeValuationCase,
  calculation: AflTradeValuationCalculation,
  view: (typeof AFL_TRADE_VALUATION_VIEWS)[number],
  measure: AflTradeValuationComparisonMeasure,
  policy: AflTradeJointOutcomeValueQuantizationPolicy,
  tolerance: number
) {
  const draws = independentlyProjectDraws(calculation, view, measure, policy);
  return {
    draws,
    comparison: calculateAflTradeJointOutcomeComparison({
      inputSchemaVersion: AFL_TRADE_JOINT_OUTCOME_INPUT_SCHEMA_VERSION,
      publicAssetBoundary: AFL_TRADE_JOINT_OUTCOME_PUBLIC_ASSET_BOUNDARY,
      comparisonValueScope: AFL_TRADE_JOINT_OUTCOME_COMPARISON_VALUE_SCOPE,
      outcomeDefinitionVersion: AFL_TRADE_JOINT_OUTCOME_DEFINITION_VERSION,
      valueUnitId: valuationCase.content.valueUnitId,
      valueScale: {
        definitionVersion: AFL_TRADE_JOINT_OUTCOME_VALUE_SCALE_DEFINITION_VERSION,
        decimalPlaces: policy.decimalPlaces,
      },
      aflClubIds: valuationCase.content.parties.map((party) => party.aflClubId),
      clearLeaderToleranceQuanta: tolerance,
      draws,
    }),
  };
}

function isDeeplyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  if (!Object.isFrozen(value)) return false;
  return Object.values(value).every((child) => isDeeplyFrozen(child, seen));
}

function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((child) => collectKeys(child, keys));
    return keys;
  }
  if (value === null || typeof value !== 'object') return keys;
  for (const [key, child] of Object.entries(value)) {
    keys.push(key);
    collectKeys(child, keys);
  }
  return keys;
}

describe('AFL trade valuation-comparison artifact', () => {
  it('derives every valuation view and universal layer from calculation-owned package values', () => {
    const fixture = createFabricatedAflTradeValuationFixture('two_party_player_swap');
    const policy = quantizationPolicy(2);
    const measures: AflTradeValuationComparisonMeasure[] = [
      { kind: 'universal_football_value', layer: 'gross' },
      { kind: 'universal_football_value', layer: 'list_spot_adjusted' },
      { kind: 'universal_football_value', layer: 'scarcity_adjusted' },
    ];
    const paths = new Set<string>();

    for (const view of AFL_TRADE_VALUATION_VIEWS) {
      for (const measure of measures) {
        const artifact = createAflTradeValuationComparison(
          createInput(fixture.valuationCase, fixture.calculation, {
            view,
            measure,
            quantizationPolicy: policy,
          })
        );
        const expected = independentlyCalculateComparison(
          fixture.valuationCase,
          fixture.calculation,
          view,
          measure,
          policy,
          0
        );
        const drawMeasure = expected.draws.map(({ drawKey, probabilityWeight }) => ({
          drawKey,
          probabilityWeight,
        }));

        paths.add(artifact.content.derivation.valuePath);
        expect(artifact.content.comparison).toEqual(expected.comparison);
        expect(artifact.content.derivation.drawMeasureSha256).toBe(
          sha256AflTradeCanonicalJson(drawMeasure)
        );
        expect(artifact.content.derivation.observationSha256).toBe(
          sha256AflTradeCanonicalJson(expected.draws)
        );
        expect(artifact.content.derivation.quantizationPolicySha256).toBe(
          sha256AflTradeCanonicalJson(policy)
        );
        expect(artifact.content.derivation.partyRootFrontiers).toEqual(
          fixture.valuationCase.content.parties.map((party) => ({
            aflClubId: party.aflClubId,
            rootAssetIds: party.receivedRootAssetIds,
          }))
        );
        expect(artifact.valuationComparisonId).toBe(
          createAflTradeContentAddress('valuation-comparison', artifact.content)
        );
        expect(
          verifyAflTradeValuationComparisonCaseCalculationDerivation({
            valuationComparison: artifact,
            valuationCase: fixture.valuationCase,
            valuationCalculation: fixture.calculation,
          })
        ).toBe(true);
      }
    }

    expect([...paths].sort()).toEqual([...AFL_TRADE_VALUATION_COMPARISON_VALUE_PATHS].sort());
  });

  it('selects only the requested universal layer and never exposes club utility as comparable', () => {
    const fixture = createFabricatedAflTradeValuationFixture('three_party_exchange');
    const content = structuredClone(fixture.calculation.content);
    for (const draw of content.draws) {
      setAtTradeLayers(draw, 0, {
        gross: 11,
        listSpotAdjusted: 7,
        scarcityAdjusted: 3,
      });
      setAtTradeLayers(draw, 1, {
        gross: 10,
        listSpotAdjusted: 8,
        scarcityAdjusted: 4,
      });
      setAtTradeLayers(draw, 2, {
        gross: -100,
        listSpotAdjusted: -100,
        scarcityAdjusted: -100,
      });
    }
    const calculation = readdressCalculation(content);
    const clubIds = fixture.valuationCase.content.parties.map((party) => party.aflClubId);

    for (const [layer, expectedLeader] of [
      ['gross', clubIds[0]],
      ['list_spot_adjusted', clubIds[1]],
      ['scarcity_adjusted', clubIds[1]],
    ] as const) {
      const artifact = createAflTradeValuationComparison(
        createInput(fixture.valuationCase, calculation, {
          view: 'at_trade',
          measure: { kind: 'universal_football_value', layer },
          quantizationPolicy: quantizationPolicy(0),
        })
      );
      expect(artifact.content.comparison.status).toBe('available');
      if (artifact.content.comparison.status !== 'available')
        throw new Error('Expected available.');
      expect(
        artifact.content.comparison.probabilities.clubClearLeaderProbabilities.find(
          (item) => item.aflClubId === expectedLeader
        )?.probability
      ).toBe(1);
    }

    expectConstructionError(
      () =>
        createAflTradeValuationComparison(
          createInput(fixture.valuationCase, calculation, {
            measure: { kind: 'single_afl_club_utility' },
          })
        ),
      'INVALID_MEASURE'
    );
  });

  it('quantizes exactly before applying tolerance and returns all available outcome classes', () => {
    const { valuationCase, calculation } = createControlledThreePartyCalculation();
    const artifact = createAflTradeValuationComparison(
      createInput(valuationCase, calculation, { view: 'at_trade' })
    );
    const clubIds = valuationCase.content.parties.map((party) => party.aflClubId);

    expect(artifact.content.derivation.quantizationPolicy).toEqual(quantizationPolicy(2));
    expect(artifact.content.comparison).toMatchObject({
      status: 'available',
      drawCount: 3,
      availableDrawCount: 3,
      unavailableDrawCount: 0,
      availableProbabilityMass: 1,
      unavailableProbabilityMass: 0,
      probabilities: {
        clubClearLeaderProbabilities: [
          { aflClubId: clubIds[0], probability: 0.2 },
          { aflClubId: clubIds[1], probability: 0.3 },
          { aflClubId: clubIds[2], probability: 0 },
        ],
        noClearLeaderProbability: 0.5,
      },
    });

    const projected = independentlyProjectDraws(
      calculation,
      'at_trade',
      { kind: 'universal_football_value', layer: 'gross' },
      quantizationPolicy(2)
    );
    expect(projected[0].parties.map((party) => party.observation)).toEqual([
      { status: 'available', valueQuanta: 101 },
      { status: 'available', valueQuanta: 100 },
      { status: 'available', valueQuanta: 0 },
    ]);

    const toleranceOne = createAflTradeValuationComparison(
      createInput(valuationCase, calculation, {
        view: 'at_trade',
        clearLeaderToleranceQuanta: 1,
      })
    );
    expect(toleranceOne.content.comparison.status).toBe('available');
    if (toleranceOne.content.comparison.status !== 'available') {
      throw new Error('Expected available.');
    }
    expect(toleranceOne.content.comparison.probabilities).toEqual({
      clubClearLeaderProbabilities: clubIds.map((aflClubId) => ({
        aflClubId,
        probability: 0,
      })),
      noClearLeaderProbability: 1,
    });
    expect(toleranceOne.content.derivation.observationSha256).toBe(
      artifact.content.derivation.observationSha256
    );

    const negativeContent = structuredClone(calculation.content);
    setAtTradeLayers(negativeContent.draws[0], 0, {
      gross: -1.005,
      listSpotAdjusted: -1.005,
      scarcityAdjusted: -1.005,
    });
    setAtTradeLayers(negativeContent.draws[0], 1, {
      gross: -0.995,
      listSpotAdjusted: -0.995,
      scarcityAdjusted: -0.995,
    });
    const negative = readdressCalculation(negativeContent);
    const negativeDraws = independentlyProjectDraws(
      negative,
      'at_trade',
      { kind: 'universal_football_value', layer: 'gross' },
      quantizationPolicy(2)
    );
    expect(negativeDraws[0].parties.slice(0, 2).map((party) => party.observation)).toEqual([
      { status: 'available', valueQuanta: -101 },
      { status: 'available', valueQuanta: -100 },
    ]);
  });

  it('propagates partial and wholly unavailable outcomes without substituting partial layers', () => {
    const { valuationCase, calculation } = createControlledThreePartyCalculation();
    const partialContent = structuredClone(calculation.content);
    setAtTradeUnavailable(
      partialContent.draws[2],
      2,
      { gross: 999_999, listSpotAdjusted: 999_999, scarcityAdjusted: 999_999 },
      ['reason-z', 'reason-a', 'reason-z']
    );
    const partialCalculation = readdressCalculation(partialContent);
    const partial = createAflTradeValuationComparison(
      createInput(valuationCase, partialCalculation, { view: 'at_trade' })
    );
    const clubIds = valuationCase.content.parties.map((party) => party.aflClubId);

    expect(partial.content.comparison).toMatchObject({
      status: 'unavailable',
      availableDrawCount: 2,
      unavailableDrawCount: 1,
      availableProbabilityMass: 0.5,
      unavailableProbabilityMass: 0.5,
      probabilities: null,
      reasonCodes: ['reason-a', 'reason-z'],
      conditionalOnAvailableProbabilities: {
        clubClearLeaderProbabilities: [
          { aflClubId: clubIds[0], probability: 0.4 },
          { aflClubId: clubIds[1], probability: 0.6 },
          { aflClubId: clubIds[2], probability: 0 },
        ],
        noClearLeaderProbability: 0,
      },
      unconditionalBounds: {
        clubClearLeaderBounds: [
          { aflClubId: clubIds[0], lower: 0.2, upper: 0.7 },
          { aflClubId: clubIds[1], lower: 0.3, upper: 0.8 },
          { aflClubId: clubIds[2], lower: 0, upper: 0.5 },
        ],
        noClearLeaderBounds: { lower: 0, upper: 0.5 },
      },
    });
    expect(canonicalizeAflTradeJson(partial.content.comparison)).not.toContain('999999');

    const unavailableContent = structuredClone(calculation.content);
    for (const [drawIndex, draw] of unavailableContent.draws.entries()) {
      setAtTradeUnavailable(
        draw,
        0,
        { gross: 999_999, listSpotAdjusted: 999_999, scarcityAdjusted: 999_999 },
        [`reason-wholly-${drawIndex}`]
      );
    }
    const unavailableCalculation = readdressCalculation(unavailableContent);
    const unavailable = createAflTradeValuationComparison(
      createInput(valuationCase, unavailableCalculation, { view: 'at_trade' })
    );
    expect(unavailable.content.comparison).toMatchObject({
      status: 'unavailable',
      availableDrawCount: 0,
      unavailableDrawCount: 3,
      availableProbabilityMass: 0,
      unavailableProbabilityMass: 1,
      probabilities: null,
      conditionalOnAvailableProbabilities: null,
    });
    expect(unavailable.content.comparison.unconditionalBounds).toEqual({
      clubClearLeaderBounds: clubIds.map((aflClubId) => ({
        aflClubId,
        lower: 0,
        upper: 1,
      })),
      noClearLeaderBounds: { lower: 0, upper: 1 },
    });
  });

  it.each([
    ['valuationCaseId', `valuation-case:${'a'.repeat(64)}`],
    ['valuationBundleId', `valuation-bundle:${'b'.repeat(64)}`],
    ['componentDrawSetId', `component-draw-set:${'c'.repeat(64)}`],
    ['realizedContributionLedgerId', `realized-contribution-ledger:${'d'.repeat(64)}`],
    ['packagePolicyId', `package-policy:${'e'.repeat(64)}`],
    ['valueUnitId', 'different-football-value-unit'],
  ] as const)('rejects a schema-valid calculation parent mismatch in %s', (field, value) => {
    const fixture = createFabricatedAflTradeValuationFixture('two_party_player_swap');
    const content = structuredClone(fixture.calculation.content);
    content[field] = value;
    const calculation = readdressCalculation(content);
    expectConstructionError(
      () => createAflTradeValuationComparison(createInput(fixture.valuationCase, calculation)),
      'CALCULATION_PARENT_LINEAGE_MISMATCH'
    );
  });

  it('persists complete multi-root frontiers and rejects every schema-valid frontier divergence', () => {
    const multi = createMultiRootFixture();
    const artifact = createAflTradeValuationComparison(
      createInput(multi.valuationCase, multi.calculation)
    );
    expect(artifact.content.derivation.partyRootFrontiers).toEqual(
      multi.valuationCase.content.parties.map((party) => ({
        aflClubId: party.aflClubId,
        rootAssetIds: party.receivedRootAssetIds,
      }))
    );
    expect(artifact.content.derivation.partyRootFrontiers[0].rootAssetIds).toContain(EXTRA_ROOT_ID);

    const base = createFabricatedAflTradeValuationFixture('two_party_player_swap');
    const caseWithRootContent = structuredClone(base.valuationCase.content);
    caseWithRootContent.parties[0].receivedRootAssetIds.push(EXTRA_ROOT_ID);
    caseWithRootContent.parties[0].receivedRootAssetIds.sort(compareAflTradeCodeUnits);
    const caseWithRoot = createAflTradeValuationCase(caseWithRootContent);
    const calculationMissingRootContent = structuredClone(base.calculation.content);
    calculationMissingRootContent.valuationCaseId = caseWithRoot.valuationCaseId;
    const calculationMissingRoot = readdressCalculation(calculationMissingRootContent);
    expectConstructionError(
      () => createAflTradeValuationComparison(createInput(caseWithRoot, calculationMissingRoot)),
      'CALCULATION_DRAW_FRONTIER_MISMATCH'
    );

    const changedClubContent = structuredClone(base.valuationCase.content);
    changedClubContent.parties[0].aflClubId = 'fixture-club-00';
    const changedClubCase = createAflTradeValuationCase(changedClubContent);
    const oldClubCalculationContent = structuredClone(base.calculation.content);
    oldClubCalculationContent.valuationCaseId = changedClubCase.valuationCaseId;
    const oldClubCalculation = readdressCalculation(oldClubCalculationContent);
    expectConstructionError(
      () => createAflTradeValuationComparison(createInput(changedClubCase, oldClubCalculation)),
      'CALCULATION_DRAW_FRONTIER_MISMATCH'
    );

    const calculationOnlyContent = structuredClone(multi.calculation.content);
    calculationOnlyContent.valuationCaseId = base.valuationCase.valuationCaseId;
    const calculationOnlyRoot = readdressCalculation(calculationOnlyContent);
    expectConstructionError(
      () => createAflTradeValuationComparison(createInput(base.valuationCase, calculationOnlyRoot)),
      'CALCULATION_DRAW_FRONTIER_MISMATCH'
    );

    const movedContent = structuredClone(multi.calculation.content);
    const draw = movedContent.draws[1];
    for (let viewIndex = 0; viewIndex < draw.parties[0].views.length; viewIndex += 1) {
      const sourceRoots = draw.parties[0].views[viewIndex].roots;
      const destinationRoots = draw.parties[1].views[viewIndex].roots;
      const rootIndex = sourceRoots.findIndex((root) => root.assetId === EXTRA_ROOT_ID);
      const [moved] = sourceRoots.splice(rootIndex, 1);
      destinationRoots.push(moved);
      destinationRoots.sort((left, right) => compareAflTradeCodeUnits(left.assetId, right.assetId));
    }
    const movedCalculation = readdressCalculation(movedContent);
    expectConstructionError(
      () => createAflTradeValuationComparison(createInput(multi.valuationCase, movedCalculation)),
      'CALCULATION_DRAW_FRONTIER_MISMATCH'
    );
  });

  it('documents lower calculation-schema defenses for ordering, draw, and boundary corruption', () => {
    const fixture = createFabricatedAflTradeValuationFixture('two_party_player_swap');
    const reorderedParties = structuredClone(fixture.calculation.content);
    reorderedParties.draws[0].parties.reverse();
    expect(() => readdressCalculation(reorderedParties)).toThrow();

    const multi = createMultiRootFixture();
    const reorderedRoots = structuredClone(multi.calculation.content);
    reorderedRoots.draws[0].parties[0].views[0].roots.reverse();
    expect(() => readdressCalculation(reorderedRoots)).toThrow();

    const duplicateDrawKey = structuredClone(fixture.calculation.content);
    duplicateDrawKey.draws[1].drawKey = duplicateDrawKey.draws[0].drawKey;
    expect(() => readdressCalculation(duplicateDrawKey)).toThrow();

    const brokenIndex = structuredClone(fixture.calculation.content);
    brokenIndex.draws[1].drawIndex = 5;
    expect(() => readdressCalculation(brokenIndex)).toThrow();

    const brokenMass = structuredClone(fixture.calculation.content);
    brokenMass.draws[0].probabilityWeight = 0.3;
    expect(() => readdressCalculation(brokenMass)).toThrow();

    const changedBoundary = {
      ...structuredClone(fixture.calculation.content),
      publicAssetBoundary: 'source_native_afl_assets_with_fantasy_ownership',
    };
    const boundaryCandidate = {
      valuationCalculationId: createAflTradeContentAddress(
        'valuation-calculation',
        changedBoundary
      ),
      content: changedBoundary,
    };
    expectConstructionError(
      () =>
        createAflTradeValuationComparison({
          ...createInput(fixture.valuationCase, fixture.calculation),
          valuationCalculation: boundaryCandidate,
        }),
      'INVALID_VALUATION_CALCULATION'
    );
  });

  it.each([
    ['valuationCase', null, 'INVALID_VALUATION_CASE'],
    ['valuationCalculation', null, 'INVALID_VALUATION_CALCULATION'],
    ['view', 'future', 'INVALID_VIEW'],
    ['measure', { kind: 'unknown' }, 'INVALID_MEASURE'],
    ['quantizationPolicy', null, 'INVALID_QUANTIZATION_POLICY'],
    ['clearLeaderToleranceQuanta', -1, 'INVALID_CLEAR_LEADER_TOLERANCE'],
    ['clearLeaderToleranceQuanta', 0.5, 'INVALID_CLEAR_LEADER_TOLERANCE'],
    ['clearLeaderToleranceQuanta', Number.MAX_SAFE_INTEGER + 1, 'INVALID_CLEAR_LEADER_TOLERANCE'],
    ['clearLeaderToleranceQuanta', Number.NaN, 'INVALID_CLEAR_LEADER_TOLERANCE'],
    ['clearLeaderToleranceQuanta', Number.POSITIVE_INFINITY, 'INVALID_CLEAR_LEADER_TOLERANCE'],
  ] as const)('classifies invalid %s input without parser leakage', (field, value, code) => {
    const fixture = createFabricatedAflTradeValuationFixture('two_party_player_swap');
    const input = createInput(fixture.valuationCase, fixture.calculation);
    input[field] = value;
    expectConstructionError(() => createAflTradeValuationComparison(input), code);
  });

  it('rejects exact-envelope extras, caller-selected observations, and ownership concepts', () => {
    const fixture = createFabricatedAflTradeValuationFixture('two_party_player_swap');
    for (const forbiddenKey of [
      'subject',
      'aflClubIds',
      'draws',
      'observations',
      'userId',
      'fantasyLeagueId',
      'fantasyTeamId',
      'ownerId',
      'rosterOwnerId',
      'unknownField',
      '__proto__',
    ]) {
      const input = createInput(fixture.valuationCase, fixture.calculation);
      Object.defineProperty(input, forbiddenKey, {
        enumerable: true,
        configurable: true,
        value: 'forbidden',
      });
      expectConstructionError(
        () => createAflTradeValuationComparison(input),
        'INVALID_INPUT_ENVELOPE'
      );
    }

    const missing = createInput(fixture.valuationCase, fixture.calculation);
    delete missing.measure;
    expectConstructionError(
      () => createAflTradeValuationComparison(missing),
      'INVALID_INPUT_ENVELOPE'
    );

    expectConstructionError(
      () =>
        createAflTradeValuationComparison(
          createInput(fixture.valuationCase, fixture.calculation, {
            measure: {
              kind: 'universal_football_value',
              layer: 'gross',
              ownerId: 'forbidden',
            },
          })
        ),
      'INVALID_MEASURE'
    );

    const artifact = createAflTradeValuationComparison(
      createInput(fixture.valuationCase, fixture.calculation)
    );
    expect(collectKeys(artifact)).not.toEqual(
      expect.arrayContaining([
        'userId',
        'fantasyLeagueId',
        'fantasyTeamId',
        'ownerId',
        'rosterOwnerId',
        'clubUtility',
        'partialValue',
      ])
    );
    expect(artifact.content.limitation).toBe(AFL_TRADE_VALUATION_COMPARISON_LIMITATION);
    expect(artifact.content.derivation.verificationScope).toBe(
      AFL_TRADE_VALUATION_COMPARISON_VERIFICATION_SCOPE
    );
    expect(artifact.content.predecessor).toEqual({
      schemaVersion: AFL_TRADE_VALUATION_COMPARISON_PREDECESSOR_SCHEMA_VERSION,
      compatibility: AFL_TRADE_VALUATION_COMPARISON_PREDECESSOR_COMPATIBILITY,
    });
  });

  it('rejects symbol and non-enumerable extras in creator and verifier envelopes', () => {
    const fixture = createFabricatedAflTradeValuationFixture('two_party_player_swap');
    const symbolInput = createInput(fixture.valuationCase, fixture.calculation);
    Object.defineProperty(symbolInput, Symbol('owner'), { value: 'forbidden' });
    expectConstructionError(
      () => createAflTradeValuationComparison(symbolInput),
      'INVALID_INPUT_ENVELOPE'
    );

    const hiddenInput = createInput(fixture.valuationCase, fixture.calculation);
    Object.defineProperty(hiddenInput, 'hiddenFantasyOwnerId', { value: 'forbidden' });
    expectConstructionError(
      () => createAflTradeValuationComparison(hiddenInput),
      'INVALID_INPUT_ENVELOPE'
    );

    const inherited = Object.create({
      valuationCase: fixture.valuationCase,
      valuationCalculation: fixture.calculation,
      view: 'current',
      measure: { kind: 'universal_football_value', layer: 'gross' },
      quantizationPolicy: quantizationPolicy(),
      clearLeaderToleranceQuanta: 0,
    });
    expectConstructionError(
      () => createAflTradeValuationComparison(inherited),
      'INVALID_INPUT_ENVELOPE'
    );

    const artifact = createAflTradeValuationComparison(
      createInput(fixture.valuationCase, fixture.calculation)
    );
    for (const key of [Symbol('owner'), 'hiddenFantasyOwnerId']) {
      const verifierInput = {
        valuationComparison: artifact,
        valuationCase: fixture.valuationCase,
        valuationCalculation: fixture.calculation,
      };
      Object.defineProperty(verifierInput, key, { value: 'forbidden' });
      expect(verifyAflTradeValuationComparisonCaseCalculationDerivation(verifierInput)).toBe(false);
    }
  });

  it('sanitizes hostile inputs and recognizes only genuinely constructed errors', () => {
    const ownKeysFailure = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('secret-own-keys-cause');
        },
      }
    );
    expectConstructionError(
      () => createAflTradeValuationComparison(ownKeysFailure),
      'INVALID_INPUT_ENVELOPE'
    );

    const forged = Object.assign(
      Object.create(AflTradeValuationComparisonConstructionError.prototype) as object,
      { code: 'INVALID_MEASURE', message: 'secret-forged-message' }
    );
    const fixture = createFabricatedAflTradeValuationFixture('two_party_player_swap');
    const hostileEnvelope = createInput(fixture.valuationCase, fixture.calculation);
    Object.defineProperty(hostileEnvelope, 'valuationCase', {
      enumerable: true,
      get() {
        throw forged;
      },
    });
    expectConstructionError(
      () => createAflTradeValuationComparison(hostileEnvelope),
      'INVALID_INPUT_ENVELOPE'
    );

    const hostilePolicy = new Proxy(
      {},
      {
        get() {
          throw new Error('secret-policy-parser-cause');
        },
      }
    );
    expectConstructionError(
      () =>
        createAflTradeValuationComparison(
          createInput(fixture.valuationCase, fixture.calculation, {
            quantizationPolicy: hostilePolicy,
          })
        ),
      'INVALID_QUANTIZATION_POLICY'
    );

    const trusted = new AflTradeValuationComparisonConstructionError('INVALID_MEASURE');
    expect(isAflTradeValuationComparisonConstructionError(trusted)).toBe(true);
    expect(trusted.toJSON()).toEqual({
      name: 'AflTradeValuationComparisonConstructionError',
      code: 'INVALID_MEASURE',
      message: 'The valuation-comparison measure is invalid.',
    });
    expect(Object.isFrozen(trusted.toJSON())).toBe(true);
    expect(isAflTradeValuationComparisonConstructionError(forged)).toBe(false);
    expect(
      isAflTradeValuationComparisonConstructionError(
        Object.create(AflTradeValuationComparisonConstructionError.prototype)
      )
    ).toBe(false);

    let getPrototypeOfCalled = false;
    const hostilePrototype = new Proxy(
      {},
      {
        getPrototypeOf() {
          getPrototypeOfCalled = true;
          throw new Error('secret-get-prototype-of-cause');
        },
      }
    );
    expect(() => isAflTradeValuationComparisonConstructionError(hostilePrototype)).not.toThrow();
    expect(isAflTradeValuationComparisonConstructionError(hostilePrototype)).toBe(false);
    expect(getPrototypeOfCalled).toBe(false);
  });

  it('makes the scoped verifier fail closed for malformed and hostile envelopes', () => {
    const fixture = createFabricatedAflTradeValuationFixture('two_party_player_swap');
    const artifact = createAflTradeValuationComparison(
      createInput(fixture.valuationCase, fixture.calculation)
    );
    expect(verifyAflTradeValuationComparisonCaseCalculationDerivation(null)).toBe(false);
    expect(
      verifyAflTradeValuationComparisonCaseCalculationDerivation({
        valuationComparison: artifact,
        valuationCase: fixture.valuationCase,
        valuationCalculation: fixture.calculation,
        ownerId: 'forbidden',
      })
    ).toBe(false);
    expect(
      verifyAflTradeValuationComparisonCaseCalculationDerivation({
        valuationComparison: null,
        valuationCase: fixture.valuationCase,
        valuationCalculation: fixture.calculation,
      })
    ).toBe(false);
    expect(
      verifyAflTradeValuationComparisonCaseCalculationDerivation(
        new Proxy(
          {},
          {
            ownKeys() {
              throw new Error('secret-verifier-own-keys');
            },
          }
        )
      )
    ).toBe(false);

    const hostileEnvelope = {
      valuationComparison: artifact,
      valuationCase: fixture.valuationCase,
      valuationCalculation: fixture.calculation,
    };
    Object.defineProperty(hostileEnvelope, 'valuationComparison', {
      enumerable: true,
      get() {
        throw new Error('secret-verifier-getter');
      },
    });
    expect(verifyAflTradeValuationComparisonCaseCalculationDerivation(hostileEnvelope)).toBe(false);

    const hostileArtifact = new Proxy(
      {},
      {
        get() {
          throw new Error('secret-artifact-parser-cause');
        },
      }
    );
    expect(
      verifyAflTradeValuationComparisonCaseCalculationDerivation({
        valuationComparison: hostileArtifact,
        valuationCase: fixture.valuationCase,
        valuationCalculation: fixture.calculation,
      })
    ).toBe(false);
  });

  it('rejects internally inconsistent receipt and comparison content before addressing', () => {
    const multi = createMultiRootFixture();
    const artifact = createAflTradeValuationComparison(
      createInput(multi.valuationCase, multi.calculation)
    );
    const mutations: Array<(content: AflTradeValuationComparison['content']) => void> = [
      (content) => {
        content.derivation.coordinates.view = 'remaining';
      },
      (content) => {
        content.derivation.coordinates.measure.layer = 'scarcity_adjusted';
      },
      (content) => {
        content.derivation.valuePath = 'package.universal.layers.scarcityAdjusted';
      },
      (content) => {
        content.comparison.valueUnitId = 'different-value-unit';
      },
      (content) => {
        content.derivation.drawCount += 1;
      },
      (content) => {
        content.derivation.clearLeaderToleranceQuanta += 1;
      },
      (content) => {
        content.derivation.quantizationPolicySha256 = 'f'.repeat(64);
      },
      (content) => {
        content.derivation.partyRootFrontiers.reverse();
      },
      (content) => {
        content.derivation.partyRootFrontiers[0].rootAssetIds.reverse();
      },
      (content) => {
        content.derivation.partyRootFrontiers[0].rootAssetIds = [
          content.derivation.partyRootFrontiers[0].rootAssetIds[0],
          content.derivation.partyRootFrontiers[0].rootAssetIds[0],
        ];
      },
    ];

    for (const mutate of mutations) {
      const content = structuredClone(artifact.content);
      mutate(content);
      expect(aflTradeValuationComparisonContentSchema.safeParse(content).success).toBe(false);
    }

    expect(
      aflTradeValuationComparisonSchema.safeParse({
        ...artifact,
        valuationComparisonId: `valuation-comparison:${'0'.repeat(64)}`,
      }).success
    ).toBe(false);
    expect(
      aflTradeValuationComparisonContentSchema.safeParse({
        ...artifact.content,
        unknownField: 'forbidden',
      }).success
    ).toBe(false);
    expect(
      aflTradeValuationComparisonContentSchema.safeParse({
        ...artifact.content,
        derivation: { ...artifact.content.derivation, unknownField: 'forbidden' },
      }).success
    ).toBe(false);
    const tamperedPredecessor = {
      ...artifact.content,
      predecessor: {
        ...artifact.content.predecessor,
        compatibility: 'implicit_snapshot_upcast_permitted',
      },
    };
    expect(
      aflTradeValuationComparisonSchema.safeParse({
        valuationComparisonId: createAflTradeContentAddress(
          'valuation-comparison',
          tamperedPredecessor
        ),
        content: tamperedPredecessor,
      }).success
    ).toBe(false);
  });

  it('rejects re-addressed semantic forgery, including an internally valid probability swap', () => {
    const { valuationCase, calculation } = createControlledThreePartyCalculation();
    const artifact = createAflTradeValuationComparison(
      createInput(valuationCase, calculation, { view: 'at_trade' })
    );
    const mutations: Array<(candidate: AflTradeValuationComparison) => void> = [
      (candidate) => {
        candidate.content.tradeId = 'fabricated-trade:tampered';
      },
      (candidate) => {
        candidate.content.derivation.observationSha256 = 'f'.repeat(64);
      },
      (candidate) => {
        candidate.content.derivation.drawMeasureSha256 = 'e'.repeat(64);
      },
      (candidate) => {
        candidate.content.derivation.partyRootFrontiers[0].rootAssetIds = [
          'fixture:synthetic-forged-root',
        ];
      },
      (candidate) => {
        candidate.content.viewContext.knowledgeCutoffAt = '2026-08-04T00:00:00.000Z';
      },
    ];

    for (const mutate of mutations) {
      const candidate = structuredClone(artifact);
      mutate(candidate);
      const readdressed = readdressComparison(candidate);
      expect(
        verifyAflTradeValuationComparisonCaseCalculationDerivation({
          valuationComparison: readdressed,
          valuationCase,
          valuationCalculation: calculation,
        })
      ).toBe(false);
    }

    const probabilityForgery = structuredClone(artifact);
    if (probabilityForgery.content.comparison.status !== 'available') {
      throw new Error('Expected available comparison fixture.');
    }
    const probabilities =
      probabilityForgery.content.comparison.probabilities.clubClearLeaderProbabilities;
    [probabilities[0].probability, probabilities[1].probability] = [
      probabilities[1].probability,
      probabilities[0].probability,
    ];
    probabilityForgery.content.comparison.unconditionalBounds.clubClearLeaderBounds.forEach(
      (bound, index) => {
        bound.lower = probabilities[index].probability;
        bound.upper = probabilities[index].probability;
      }
    );
    const readdressedForgery = readdressComparison(probabilityForgery);
    expect(
      verifyAflTradeValuationComparisonCaseCalculationDerivation({
        valuationComparison: readdressedForgery,
        valuationCase,
        valuationCalculation: calculation,
      })
    ).toBe(false);
  });

  it('canonicalizes semantic draw order while retaining the distinct calculation parent', () => {
    const fixture = createFabricatedAflTradeValuationFixture('two_party_player_swap');
    const original = createAflTradeValuationComparison(
      createInput(fixture.valuationCase, fixture.calculation)
    );
    const content = structuredClone(fixture.calculation.content);
    content.draws.reverse();
    content.draws.forEach((draw, index) => {
      draw.drawIndex = index;
    });
    const permutedCalculation = readdressCalculation(content);
    const permuted = createAflTradeValuationComparison(
      createInput(fixture.valuationCase, permutedCalculation)
    );

    expect(permutedCalculation.valuationCalculationId).not.toBe(
      fixture.calculation.valuationCalculationId
    );
    expect(permuted.content.derivation.drawMeasureSha256).toBe(
      original.content.derivation.drawMeasureSha256
    );
    expect(permuted.content.derivation.observationSha256).toBe(
      original.content.derivation.observationSha256
    );
    expect(permuted.content.comparison).toEqual(original.content.comparison);
    expect(permuted.valuationComparisonId).not.toBe(original.valuationComparisonId);

    const changedDrawContent = structuredClone(fixture.calculation.content);
    changedDrawContent.draws[0].drawKey = 'fixture-draw:changed';
    changedDrawContent.draws[0].probabilityWeight = 0.5;
    changedDrawContent.draws[1].probabilityWeight = 0.5;
    const changedDrawCalculation = readdressCalculation(changedDrawContent);
    const changedDrawArtifact = createAflTradeValuationComparison(
      createInput(fixture.valuationCase, changedDrawCalculation)
    );
    expect(changedDrawArtifact.content.derivation.drawMeasureSha256).not.toBe(
      original.content.derivation.drawMeasureSha256
    );
    expect(changedDrawArtifact.content.derivation.observationSha256).not.toBe(
      original.content.derivation.observationSha256
    );
    expect(
      verifyAflTradeValuationComparisonCaseCalculationDerivation({
        valuationComparison: changedDrawArtifact,
        valuationCase: fixture.valuationCase,
        valuationCalculation: fixture.calculation,
      })
    ).toBe(false);
  });

  it('is deterministic, deeply frozen, and isolated from every caller-owned alias', () => {
    const fixture = createFabricatedAflTradeValuationFixture('two_party_player_swap');
    const valuationCase = structuredClone(fixture.valuationCase);
    const calculation = structuredClone(fixture.calculation);
    const measure: AflTradeValuationComparisonMeasure = {
      kind: 'universal_football_value',
      layer: 'gross',
    };
    const policy = quantizationPolicy(2);
    const input = {
      valuationCase,
      valuationCalculation: calculation,
      view: 'current',
      measure,
      quantizationPolicy: policy,
      clearLeaderToleranceQuanta: 0,
    };
    const first = createAflTradeValuationComparison(input);
    const repeated = createAflTradeValuationComparison(input);
    const canonicalBefore = canonicalizeAflTradeJson(first);

    expect(repeated).toEqual(first);
    expect(repeated.valuationComparisonId).toBe(first.valuationComparisonId);
    valuationCase.content.tradeId = 'fabricated-trade:mutated';
    calculation.content.draws[0].drawKey = 'fixture-draw:mutated';
    measure.layer = 'scarcity_adjusted';
    policy.decimalPlaces = 7;

    expect(canonicalizeAflTradeJson(first)).toBe(canonicalBefore);
    expect(isDeeplyFrozen(first)).toBe(true);
    expect(first.content.measure).not.toBe(measure);
    expect(first.content.derivation.quantizationPolicy).not.toBe(policy);
    expect(first.content.derivation.partyRootFrontiers).not.toBe(valuationCase.content.parties);
  });

  it('maps quantization overflow and excessive unavailable reason union to sanitized errors', () => {
    const fixture = createFabricatedAflTradeValuationFixture('two_party_player_swap');
    const overflowContent = structuredClone(fixture.calculation.content);
    setAtTradeLayers(overflowContent.draws[0], 0, {
      gross: Number.MAX_SAFE_INTEGER,
      listSpotAdjusted: Number.MAX_SAFE_INTEGER,
      scarcityAdjusted: Number.MAX_SAFE_INTEGER,
    });
    const overflowCalculation = readdressCalculation(overflowContent);
    expectConstructionError(
      () =>
        createAflTradeValuationComparison(
          createInput(fixture.valuationCase, overflowCalculation, {
            view: 'at_trade',
            quantizationPolicy: quantizationPolicy(1),
          })
        ),
      'VALUE_QUANTIZATION_FAILURE'
    );

    const excessiveContent = structuredClone(fixture.calculation.content);
    for (const [drawIndex, draw] of excessiveContent.draws.entries()) {
      setAtTradeUnavailable(
        draw,
        0,
        { gross: 0, listSpotAdjusted: 0, scarcityAdjusted: 0 },
        Array.from({ length: 60 }, (_, reasonIndex) => `fixture-reason-${drawIndex}-${reasonIndex}`)
      );
    }
    const excessiveCalculation = readdressCalculation(excessiveContent);
    expectConstructionError(
      () =>
        createAflTradeValuationComparison(
          createInput(fixture.valuationCase, excessiveCalculation, { view: 'at_trade' })
        ),
      'JOINT_OUTCOME_COMPARISON_CALCULATION_FAILURE'
    );
  });

  it('distinguishes scoped comparison replay from the separate Stage 5 provenance chain', () => {
    const fixture = createFabricatedAflTradeValuationFixture('two_party_player_swap');
    const baselineReport = validateAflTradeValuationArtifactChain(fixture);
    expect(baselineReport.structurallyValid).toBe(true);
    expect(baselineReport.publicationReady).toBe(false);

    const forgedContent = structuredClone(fixture.calculation.content);
    setAtTradeUnavailable(
      forgedContent.draws[0],
      0,
      { gross: 999_999, listSpotAdjusted: 999_999, scarcityAdjusted: 999_999 },
      ['fixture-forged-unavailable']
    );
    const forgedCalculation = readdressCalculation(forgedContent);
    const comparison = createAflTradeValuationComparison(
      createInput(fixture.valuationCase, forgedCalculation, { view: 'at_trade' })
    );

    expect(
      verifyAflTradeValuationComparisonCaseCalculationDerivation({
        valuationComparison: comparison,
        valuationCase: fixture.valuationCase,
        valuationCalculation: forgedCalculation,
      })
    ).toBe(true);
    const upstreamReport = validateAflTradeValuationArtifactChain({
      ...fixture,
      calculation: forgedCalculation,
    });
    expect(upstreamReport.structurallyValid).toBe(false);
    expect(upstreamReport.publicationReady).toBe(false);
    expect(upstreamReport.externalBlockers).toEqual(
      expect.arrayContaining([
        'lawful_source_rights_unproven',
        'real_historical_data_not_run',
        'model_calibration_exit_criteria_unproven',
        'gate_approvals_unproven',
        'production_storage_and_release_unproven',
      ])
    );
  });
});
