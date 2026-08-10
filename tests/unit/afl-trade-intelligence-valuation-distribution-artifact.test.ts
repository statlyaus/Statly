// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { AFL_TRADE_PROBABILITY_MEASURE_DEFINITION_VERSION } from '@/server/aflTradeIntelligence/valuation/deterministicProbabilityMeasure';
import {
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_BOUNDS_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_COMPLETENESS_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_CONDITIONAL_MEASURE_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_DISPERSION_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_EVENT_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_INPUT_SCHEMA_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MEASURE_SCOPE,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_NORMALIZATION_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_PUBLIC_ASSET_BOUNDARY,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_QUANTILE_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_STATISTICS_ARITHMETIC_DEFINITION_VERSION,
  type AflTradeStructuralWeightedDistributionObservation,
  type AflTradeStructuralWeightedDistributionPolicy,
} from '@/server/aflTradeIntelligence/valuation/structuralWeightedDistributionContracts';
import { calculateAflTradeStructuralWeightedDistribution } from '@/server/aflTradeIntelligence/valuation/structuralWeightedDistribution';
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
import {
  AFL_TRADE_VALUATION_DISTRIBUTION_LIMITATION,
  AFL_TRADE_VALUATION_DISTRIBUTION_PREDECESSOR_COMPATIBILITY,
  AFL_TRADE_VALUATION_DISTRIBUTION_PREDECESSOR_SCHEMA_VERSION,
  AFL_TRADE_VALUATION_DISTRIBUTION_VALUE_PATHS,
  AFL_TRADE_VALUATION_DISTRIBUTION_VERIFICATION_SCOPE,
  AflTradeValuationDistributionConstructionError,
  aflTradeValuationDistributionContentSchema,
  aflTradeValuationDistributionSchema,
  createAflTradeValuationDistribution,
  isAflTradeValuationDistributionConstructionError,
  verifyAflTradeValuationDistributionCaseCalculationDerivation,
  type AflTradeValuationDistribution,
  type AflTradeValuationDistributionMeasure,
  type AflTradeValuationDistributionSubject,
} from '@/server/aflTradeIntelligence/valuation/valuationDistributionArtifact';
import { AFL_TRADE_VALUATION_VIEWS } from '@/types/aflTradeIntelligence';

const EXTRA_ROOT_ID = 'fixture:synthetic-extra-root';

function policy(): AflTradeStructuralWeightedDistributionPolicy {
  return {
    probabilityMeasureDefinitionVersion: AFL_TRADE_PROBABILITY_MEASURE_DEFINITION_VERSION,
    completenessDefinitionVersion:
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_COMPLETENESS_DEFINITION_VERSION,
    normalizationDefinitionVersion:
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_NORMALIZATION_DEFINITION_VERSION,
    conditionalMeasureDefinitionVersion:
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_CONDITIONAL_MEASURE_DEFINITION_VERSION,
    quantileDefinitionVersion:
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_QUANTILE_DEFINITION_VERSION,
    eventDefinitionVersion: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_EVENT_DEFINITION_VERSION,
    boundsDefinitionVersion: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_BOUNDS_DEFINITION_VERSION,
    dispersionDefinitionVersion:
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_DISPERSION_DEFINITION_VERSION,
    statisticsArithmeticDefinitionVersion:
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_STATISTICS_ARITHMETIC_DEFINITION_VERSION,
    measureScope: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MEASURE_SCOPE,
    quantiles: {
      downside: 0.1,
      median: 0.5,
      upside: 0.9,
      centralIntervalLevel: 0.8,
    },
    lowReturnEvent: { operator: 'less_than_or_equal', threshold: 0 },
    eliteOutcomeEvent: { operator: 'greater_than_or_equal', threshold: 10 },
  };
}

function createInput(
  valuationCase: AflTradeValuationCase,
  valuationCalculation: AflTradeValuationCalculation,
  overrides: Partial<{
    view: unknown;
    subject: unknown;
    measure: unknown;
    policy: unknown;
  }> = {}
): Record<string, unknown> {
  return {
    valuationCase,
    valuationCalculation,
    view: 'current',
    subject: {
      kind: 'afl_club_received_package',
      aflClubId: valuationCase.content.parties[0].aflClubId,
    },
    measure: { kind: 'universal_football_value', layer: 'gross' },
    policy: policy(),
    ...overrides,
  };
}

function expectConstructionError(
  action: () => unknown,
  code: AflTradeValuationDistributionConstructionError['code']
): void {
  try {
    action();
    throw new Error(`Expected ${code}.`);
  } catch (error) {
    expect(error).toBeInstanceOf(AflTradeValuationDistributionConstructionError);
    expect(error).toMatchObject({
      name: 'AflTradeValuationDistributionConstructionError',
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

function readdressDistribution(
  artifact: AflTradeValuationDistribution
): AflTradeValuationDistribution {
  return aflTradeValuationDistributionSchema.parse({
    valuationDistributionId: createAflTradeContentAddress(
      'valuation-distribution',
      artifact.content
    ),
    content: artifact.content,
  });
}

function zeroRoot(
  source: AflTradeValuationCalculation['content']['draws'][number]['parties'][number]['views'][number]['roots'][number]
) {
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
  caseContent.parties[0].receivedRootAssetIds.sort();
  const valuationCase = createAflTradeValuationCase(caseContent);

  const calculationContent = structuredClone(fixture.calculation.content);
  calculationContent.valuationCaseId = valuationCase.valuationCaseId;
  for (const draw of calculationContent.draws) {
    const party = draw.parties[0];
    for (const view of party.views) {
      view.roots.push(zeroRoot(view.roots[0]));
      view.roots.sort((left, right) => left.assetId.localeCompare(right.assetId));
    }
  }
  return { valuationCase, calculation: readdressCalculation(calculationContent) };
}

function expectedValuePath(
  subject: AflTradeValuationDistributionSubject,
  measure: AflTradeValuationDistributionMeasure
): (typeof AFL_TRADE_VALUATION_DISTRIBUTION_VALUE_PATHS)[number] {
  const prefix = subject.kind === 'afl_club_received_package' ? 'package' : 'root';
  if (measure.kind === 'single_afl_club_utility') return `${prefix}.clubUtility.value`;
  const layer =
    measure.layer === 'list_spot_adjusted'
      ? 'listSpotAdjusted'
      : measure.layer === 'scarcity_adjusted'
        ? 'scarcityAdjusted'
        : 'gross';
  return `${prefix}.universal.layers.${layer}`;
}

function independentlyProjectObservations(
  calculation: AflTradeValuationCalculation,
  view: (typeof AFL_TRADE_VALUATION_VIEWS)[number],
  subject: AflTradeValuationDistributionSubject,
  measure: AflTradeValuationDistributionMeasure
): AflTradeStructuralWeightedDistributionObservation[] {
  const projected = calculation.content.draws.map((draw) => {
    const party = draw.parties.find((candidate) => candidate.aflClubId === subject.aflClubId)!;
    const partyView = party.views.find((candidate) => candidate.view === view)!;
    const source =
      subject.kind === 'afl_club_received_package'
        ? partyView
        : partyView.roots.find((root) => root.assetId === subject.rootAssetId)!;

    if (measure.kind === 'single_afl_club_utility') {
      return source.clubUtility.status === 'available'
        ? {
            drawKey: draw.drawKey,
            probabilityWeight: draw.probabilityWeight,
            status: 'available' as const,
            value: source.clubUtility.value,
          }
        : {
            drawKey: draw.drawKey,
            probabilityWeight: draw.probabilityWeight,
            status: 'unavailable' as const,
            reasonCodes: [...new Set(source.clubUtility.reasonCodes)].sort(),
          };
    }

    if (source.universal.status === 'unavailable') {
      return {
        drawKey: draw.drawKey,
        probabilityWeight: draw.probabilityWeight,
        status: 'unavailable' as const,
        reasonCodes: [...new Set(source.universal.reasonCodes)].sort(),
      };
    }
    const value =
      measure.layer === 'list_spot_adjusted'
        ? source.universal.layers.listSpotAdjusted
        : measure.layer === 'scarcity_adjusted'
          ? source.universal.layers.scarcityAdjusted
          : source.universal.layers.gross;
    return {
      drawKey: draw.drawKey,
      probabilityWeight: draw.probabilityWeight,
      status: 'available' as const,
      value,
    };
  });
  return projected.sort((left, right) =>
    left.drawKey < right.drawKey ? -1 : left.drawKey > right.drawKey ? 1 : 0
  );
}

function makeUniversalUnavailable(
  calculation: AflTradeValuationCalculation,
  drawIndexes: readonly number[]
): AflTradeValuationCalculation {
  const content = structuredClone(calculation.content);
  for (const drawIndex of drawIndexes) {
    const party = content.draws[drawIndex].parties[0];
    const view = party.views.find((candidate) => candidate.view === 'at_trade')!;
    const root = view.roots[0];
    if (root.universal.status !== 'available' || view.universal.status !== 'available') {
      throw new Error('The fabricated fixture must begin with available universal values.');
    }
    root.universal = {
      status: 'unavailable',
      partialLayers: { ...root.universal.layers },
      reasonCodes: ['fixture-unavailable'],
    };
    view.universal = {
      status: 'unavailable',
      partialLayers: { ...view.universal.layers },
      reasonCodes: ['fixture-unavailable'],
    };
  }
  return readdressCalculation(content);
}

function makeClubUtilityUnavailable(
  calculation: AflTradeValuationCalculation,
  drawIndexes: readonly number[]
): AflTradeValuationCalculation {
  const content = structuredClone(calculation.content);
  for (const drawIndex of drawIndexes) {
    const party = content.draws[drawIndex].parties[0];
    const view = party.views.find((candidate) => candidate.view === 'at_trade')!;
    const root = view.roots[0];
    if (root.clubUtility.status !== 'available' || view.clubUtility.status !== 'available') {
      throw new Error('The fabricated fixture must begin with available club utility.');
    }
    root.clubUtility = {
      status: 'unavailable',
      partialValue: 999_999,
      reasonCodes: ['fixture-utility-unavailable'],
    };
    view.clubUtility = {
      status: 'unavailable',
      partialValue: 999_999,
      reasonCodes: ['fixture-utility-unavailable'],
    };
  }
  return readdressCalculation(content);
}

function isDeeplyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  if (!Object.isFrozen(value)) return false;
  return Object.values(value).every((child) => isDeeplyFrozen(child, seen));
}

describe('AFL trade valuation-distribution artifact', () => {
  it('derives all views, both subject kinds, all four measures, and all eight value paths', () => {
    const fixture = createFabricatedAflTradeValuationFixture('two_party_player_swap');
    const party = fixture.valuationCase.content.parties[0];
    const subjects: AflTradeValuationDistributionSubject[] = [
      { kind: 'afl_club_received_package', aflClubId: party.aflClubId },
      {
        kind: 'source_native_afl_trade_root',
        aflClubId: party.aflClubId,
        rootAssetId: party.receivedRootAssetIds[0],
      },
    ];
    const measures: AflTradeValuationDistributionMeasure[] = [
      { kind: 'universal_football_value', layer: 'gross' },
      { kind: 'universal_football_value', layer: 'list_spot_adjusted' },
      { kind: 'universal_football_value', layer: 'scarcity_adjusted' },
      { kind: 'single_afl_club_utility' },
    ];
    const paths = new Set<string>();

    for (const view of AFL_TRADE_VALUATION_VIEWS) {
      for (const subject of subjects) {
        for (const measure of measures) {
          const artifact = createAflTradeValuationDistribution(
            createInput(fixture.valuationCase, fixture.calculation, { view, subject, measure })
          );
          const observations = independentlyProjectObservations(
            fixture.calculation,
            view,
            subject,
            measure
          );
          const expectedDistribution = calculateAflTradeStructuralWeightedDistribution({
            inputSchemaVersion: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_INPUT_SCHEMA_VERSION,
            publicAssetBoundary: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_PUBLIC_ASSET_BOUNDARY,
            valueScope:
              measure.kind === 'universal_football_value'
                ? 'universal_football_value_cross_club_comparable'
                : 'single_afl_club_utility_not_cross_club_comparable',
            valueUnitId: fixture.valuationCase.content.valueUnitId,
            policy: policy(),
            drawCount: observations.length,
            observations,
          });
          const drawMeasure = observations.map(({ drawKey, probabilityWeight }) => ({
            drawKey,
            probabilityWeight,
          }));

          paths.add(artifact.content.derivation.valuePath);
          expect(artifact.content.derivation.valuePath).toBe(expectedValuePath(subject, measure));
          expect(artifact.content.derivation.drawMeasureSha256).toBe(
            sha256AflTradeCanonicalJson(drawMeasure)
          );
          expect(artifact.content.derivation.observationSha256).toBe(
            sha256AflTradeCanonicalJson(observations)
          );
          expect(artifact.content.distribution).toEqual(expectedDistribution);
          expect(
            verifyAflTradeValuationDistributionCaseCalculationDerivation({
              valuationDistribution: artifact,
              valuationCase: fixture.valuationCase,
              valuationCalculation: fixture.calculation,
            })
          ).toBe(true);
        }
      }
    }

    expect([...paths].sort()).toEqual([...AFL_TRADE_VALUATION_DISTRIBUTION_VALUE_PATHS].sort());
  });

  it('persists the complete receiving-club root frontier for package and selected-root subjects', () => {
    const { valuationCase, calculation } = createMultiRootFixture();
    const party = valuationCase.content.parties[0];
    expect(party.receivedRootAssetIds).toHaveLength(2);

    const packageArtifact = createAflTradeValuationDistribution(
      createInput(valuationCase, calculation)
    );
    const rootArtifact = createAflTradeValuationDistribution(
      createInput(valuationCase, calculation, {
        subject: {
          kind: 'source_native_afl_trade_root',
          aflClubId: party.aflClubId,
          rootAssetId: EXTRA_ROOT_ID,
        },
      })
    );

    expect(packageArtifact.content.derivation.rootAssetIds).toEqual(party.receivedRootAssetIds);
    expect(rootArtifact.content.derivation.rootAssetIds).toEqual(party.receivedRootAssetIds);
    expect(rootArtifact.content.derivation.rootAssetIds).toContain(EXTRA_ROOT_ID);
    expect(
      verifyAflTradeValuationDistributionCaseCalculationDerivation({
        valuationDistribution: rootArtifact,
        valuationCase,
        valuationCalculation: calculation,
      })
    ).toBe(true);
  });

  it('propagates partial and wholly unavailable observations without substituting partial values', () => {
    const fixture = createFabricatedAflTradeValuationFixture('two_party_player_swap');
    const subject = {
      kind: 'source_native_afl_trade_root' as const,
      aflClubId: fixture.valuationCase.content.parties[0].aflClubId,
      rootAssetId: fixture.valuationCase.content.parties[0].receivedRootAssetIds[0],
    };
    const partialCalculation = makeUniversalUnavailable(fixture.calculation, [0]);
    const partial = createAflTradeValuationDistribution(
      createInput(fixture.valuationCase, partialCalculation, {
        view: 'at_trade',
        subject,
      })
    );
    expect(partial.content.distribution.status).toBe('partial');
    if (partial.content.distribution.status !== 'partial') throw new Error('Expected partial.');
    const availableRoot = partialCalculation.content.draws[1].parties[0].views[0].roots[0];
    if (availableRoot.universal.status !== 'available') throw new Error('Expected available.');
    expect(partial.content.distribution.availableProbabilityMass).toBeCloseTo(0.6);
    expect(partial.content.distribution.conditionalOnAvailableStatistics.mean).toBe(
      availableRoot.universal.layers.gross
    );
    expect(partial.content.distribution.reasonCodes).toEqual(['fixture-unavailable']);

    const unavailableCalculation = makeUniversalUnavailable(fixture.calculation, [0, 1]);
    const unavailable = createAflTradeValuationDistribution(
      createInput(fixture.valuationCase, unavailableCalculation, {
        view: 'at_trade',
        subject,
      })
    );
    expect(unavailable.content.distribution).toMatchObject({
      status: 'unavailable',
      availableDrawCount: 0,
      unavailableDrawCount: 2,
      statistics: null,
      conditionalOnAvailableStatistics: null,
      reasonCodes: ['fixture-unavailable'],
    });
  });

  it('keeps unavailable club-utility partial values outside the structural distribution', () => {
    const fixture = createFabricatedAflTradeValuationFixture('two_party_player_swap');
    const subject = {
      kind: 'source_native_afl_trade_root' as const,
      aflClubId: fixture.valuationCase.content.parties[0].aflClubId,
      rootAssetId: fixture.valuationCase.content.parties[0].receivedRootAssetIds[0],
    };
    const calculation = makeClubUtilityUnavailable(fixture.calculation, [0]);
    const artifact = createAflTradeValuationDistribution(
      createInput(fixture.valuationCase, calculation, {
        view: 'at_trade',
        subject,
        measure: { kind: 'single_afl_club_utility' },
      })
    );
    expect(artifact.content.distribution.status).toBe('partial');
    if (artifact.content.distribution.status !== 'partial') throw new Error('Expected partial.');
    const availableRoot = calculation.content.draws[1].parties[0].views[0].roots[0];
    if (availableRoot.clubUtility.status !== 'available') throw new Error('Expected available.');
    expect(artifact.content.distribution.conditionalOnAvailableStatistics.mean).toBe(
      availableRoot.clubUtility.value
    );
    expect(artifact.content.distribution.conditionalOnAvailableStatistics.mean).not.toBe(999_999);
    expect(artifact.content.distribution.reasonCodes).toEqual(['fixture-utility-unavailable']);
  });

  it('canonicalizes observation semantics while retaining a distinct permuted calculation parent', () => {
    const fixture = createFabricatedAflTradeValuationFixture('two_party_player_swap');
    const original = createAflTradeValuationDistribution(
      createInput(fixture.valuationCase, fixture.calculation)
    );
    const content = structuredClone(fixture.calculation.content);
    content.draws.reverse();
    content.draws.forEach((draw, index) => {
      draw.drawIndex = index;
    });
    const permutedCalculation = readdressCalculation(content);
    const permuted = createAflTradeValuationDistribution(
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
    expect(permuted.content.distribution).toEqual(original.content.distribution);
    expect(permuted.valuationDistributionId).not.toBe(original.valuationDistributionId);
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
      () => createAflTradeValuationDistribution(createInput(fixture.valuationCase, calculation)),
      'CALCULATION_PARENT_LINEAGE_MISMATCH'
    );
  });

  it.each([
    ['valuationCase', null, 'INVALID_VALUATION_CASE'],
    ['valuationCalculation', null, 'INVALID_VALUATION_CALCULATION'],
    ['view', 'future', 'INVALID_VIEW'],
    ['subject', { kind: 'unknown' }, 'INVALID_SUBJECT'],
    ['measure', { kind: 'unknown' }, 'INVALID_MEASURE'],
    ['policy', null, 'INVALID_POLICY'],
  ] as const)(
    'classifies invalid %s input without exposing parser details',
    (field, value, code) => {
      const fixture = createFabricatedAflTradeValuationFixture('two_party_player_swap');
      const input = createInput(fixture.valuationCase, fixture.calculation);
      input[field] = value;
      expectConstructionError(() => createAflTradeValuationDistribution(input), code);
    }
  );

  it('rejects a subject outside the case club and root receipts', () => {
    const fixture = createFabricatedAflTradeValuationFixture('two_party_player_swap');
    expectConstructionError(
      () =>
        createAflTradeValuationDistribution(
          createInput(fixture.valuationCase, fixture.calculation, {
            subject: { kind: 'afl_club_received_package', aflClubId: 'fixture:unknown-club' },
          })
        ),
      'SUBJECT_AFL_CLUB_NOT_IN_CASE'
    );
    expectConstructionError(
      () =>
        createAflTradeValuationDistribution(
          createInput(fixture.valuationCase, fixture.calculation, {
            subject: {
              kind: 'source_native_afl_trade_root',
              aflClubId: fixture.valuationCase.content.parties[0].aflClubId,
              rootAssetId: 'fixture:unknown-root',
            },
          })
        ),
      'SUBJECT_ROOT_NOT_RECEIVED_BY_AFL_CLUB'
    );
  });

  it('rejects schema-valid club and root frontier divergence', () => {
    const fixture = createFabricatedAflTradeValuationFixture('two_party_player_swap');
    const changedCaseContent = structuredClone(fixture.valuationCase.content);
    changedCaseContent.parties[0].receivedRootAssetIds.push(EXTRA_ROOT_ID);
    changedCaseContent.parties[0].receivedRootAssetIds.sort();
    const changedCase = createAflTradeValuationCase(changedCaseContent);
    const changedCalculationContent = structuredClone(fixture.calculation.content);
    changedCalculationContent.valuationCaseId = changedCase.valuationCaseId;
    const changedCalculation = readdressCalculation(changedCalculationContent);
    expectConstructionError(
      () => createAflTradeValuationDistribution(createInput(changedCase, changedCalculation)),
      'CALCULATION_DRAW_FRONTIER_MISMATCH'
    );

    const changedClubCaseContent = structuredClone(fixture.valuationCase.content);
    changedClubCaseContent.parties[0].aflClubId = 'fixture:club:00';
    changedClubCaseContent.parties.sort((left, right) =>
      left.aflClubId.localeCompare(right.aflClubId)
    );
    const changedClubCase = createAflTradeValuationCase(changedClubCaseContent);
    const changedClubCalculationContent = structuredClone(fixture.calculation.content);
    changedClubCalculationContent.valuationCaseId = changedClubCase.valuationCaseId;
    const changedClubCalculation = readdressCalculation(changedClubCalculationContent);
    expectConstructionError(
      () =>
        createAflTradeValuationDistribution(createInput(changedClubCase, changedClubCalculation)),
      'CALCULATION_DRAW_FRONTIER_MISMATCH'
    );
  });

  it('rejects a schema-valid calculation-only root addition and cross-club movement', () => {
    const fixture = createFabricatedAflTradeValuationFixture('two_party_player_swap');
    const multi = createMultiRootFixture();
    const addedContent = structuredClone(multi.calculation.content);
    addedContent.valuationCaseId = fixture.valuationCase.valuationCaseId;
    const calculationOnlyAddition = readdressCalculation(addedContent);
    expectConstructionError(
      () =>
        createAflTradeValuationDistribution(
          createInput(fixture.valuationCase, calculationOnlyAddition)
        ),
      'CALCULATION_DRAW_FRONTIER_MISMATCH'
    );

    const movedContent = structuredClone(multi.calculation.content);
    for (const draw of movedContent.draws) {
      const sourceParty = draw.parties[0];
      const destinationParty = draw.parties[1];
      for (let viewIndex = 0; viewIndex < sourceParty.views.length; viewIndex += 1) {
        const sourceView = sourceParty.views[viewIndex];
        const destinationView = destinationParty.views[viewIndex];
        const rootIndex = sourceView.roots.findIndex((root) => root.assetId === EXTRA_ROOT_ID);
        const [movedRoot] = sourceView.roots.splice(rootIndex, 1);
        destinationView.roots.push(movedRoot);
        destinationView.roots.sort((left, right) => left.assetId.localeCompare(right.assetId));
      }
    }
    const movedCalculation = readdressCalculation(movedContent);
    expectConstructionError(
      () => createAflTradeValuationDistribution(createInput(multi.valuationCase, movedCalculation)),
      'CALCULATION_DRAW_FRONTIER_MISMATCH'
    );
  });

  it('documents calculation-schema defenses for noncanonical party/root order and boundary changes', () => {
    const fixture = createFabricatedAflTradeValuationFixture('two_party_player_swap');
    const reorderedParties = structuredClone(fixture.calculation.content);
    reorderedParties.draws[0].parties.reverse();
    expect(() => readdressCalculation(reorderedParties)).toThrow();

    const multi = createMultiRootFixture();
    const reorderedRoots = structuredClone(multi.calculation.content);
    reorderedRoots.draws[0].parties[0].views[0].roots.reverse();
    expect(() => readdressCalculation(reorderedRoots)).toThrow();

    const changedBoundary = {
      ...structuredClone(fixture.calculation.content),
      publicAssetBoundary: 'source_native_afl_assets_no_fantasy_ownership',
    };
    expect(
      aflTradeValuationCalculationSchema.safeParse({
        valuationCalculationId: createAflTradeContentAddress(
          'valuation-calculation',
          changedBoundary
        ),
        content: changedBoundary,
      }).success
    ).toBe(false);
  });

  it('rejects independently re-addressable content whose receipt no longer matches its semantics', () => {
    const { valuationCase, calculation } = createMultiRootFixture();
    const party = valuationCase.content.parties[0];
    const rootArtifact = createAflTradeValuationDistribution(
      createInput(valuationCase, calculation, {
        subject: {
          kind: 'source_native_afl_trade_root',
          aflClubId: party.aflClubId,
          rootAssetId: EXTRA_ROOT_ID,
        },
      })
    );
    const mutations: Array<(content: AflTradeValuationDistribution['content']) => void> = [
      (content) => {
        content.valueScope = 'single_afl_club_utility_not_cross_club_comparable';
      },
      (content) => {
        content.distribution.valueUnitId = 'different-value-unit';
      },
      (content) => {
        content.derivation.coordinates.view = 'remaining';
      },
      (content) => {
        content.derivation.coordinates.subject = {
          kind: 'afl_club_received_package',
          aflClubId: party.aflClubId,
        };
      },
      (content) => {
        content.derivation.coordinates.measure = { kind: 'single_afl_club_utility' };
      },
      (content) => {
        content.derivation.valuePath = 'root.universal.layers.scarcityAdjusted';
      },
      (content) => {
        content.derivation.drawCount += 1;
      },
      (content) => {
        content.derivation.rootAssetIds = [
          party.receivedRootAssetIds.find((rootAssetId) => rootAssetId !== EXTRA_ROOT_ID)!,
        ];
      },
      (content) => {
        content.derivation.rootAssetIds = [...content.derivation.rootAssetIds].reverse();
      },
      (content) => {
        content.derivation.rootAssetIds = [
          content.derivation.rootAssetIds[0],
          content.derivation.rootAssetIds[0],
        ];
      },
    ];

    for (const mutate of mutations) {
      const content = structuredClone(rootArtifact.content);
      mutate(content);
      expect(aflTradeValuationDistributionContentSchema.safeParse(content).success).toBe(false);
    }
  });

  it('rejects re-addressed semantic tampering during replay', () => {
    const { valuationCase, calculation } = createMultiRootFixture();
    const artifact = createAflTradeValuationDistribution(createInput(valuationCase, calculation));
    const mutations: Array<(candidate: AflTradeValuationDistribution) => void> = [
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
        candidate.content.derivation.rootAssetIds = [candidate.content.derivation.rootAssetIds[0]];
      },
      (candidate) => {
        candidate.content.viewContext.knowledgeCutoffAt = '2026-08-04T00:00:00.000Z';
      },
    ];

    for (const mutate of mutations) {
      const candidate = structuredClone(artifact);
      mutate(candidate);
      const readdressed = readdressDistribution(candidate);
      expect(
        verifyAflTradeValuationDistributionCaseCalculationDerivation({
          valuationDistribution: readdressed,
          valuationCase,
          valuationCalculation: calculation,
        })
      ).toBe(false);
    }
  });

  it('rejects a schema-valid fabricated statistic after the artifact is re-addressed', () => {
    const fixture = createFabricatedAflTradeValuationFixture('two_party_player_swap');
    const artifact = createAflTradeValuationDistribution(
      createInput(fixture.valuationCase, fixture.calculation)
    );
    const candidate = structuredClone(artifact);
    if (candidate.content.distribution.status !== 'complete') {
      throw new Error('The fabricated baseline must produce a complete distribution.');
    }
    const { statistics } = candidate.content.distribution;
    expect(statistics.minimum).toBeLessThan(statistics.maximum);
    statistics.mean =
      statistics.mean === statistics.minimum ? statistics.maximum : statistics.minimum;
    const readdressed = readdressDistribution(candidate);

    expect(
      verifyAflTradeValuationDistributionCaseCalculationDerivation({
        valuationDistribution: readdressed,
        valuationCase: fixture.valuationCase,
        valuationCalculation: fixture.calculation,
      })
    ).toBe(false);
  });

  it('pins verification and predecessor semantics and rejects altered literals or outer IDs', () => {
    const fixture = createFabricatedAflTradeValuationFixture('two_party_player_swap');
    const artifact = createAflTradeValuationDistribution(
      createInput(fixture.valuationCase, fixture.calculation)
    );

    expect(artifact.content.derivation.verificationScope).toBe(
      AFL_TRADE_VALUATION_DISTRIBUTION_VERIFICATION_SCOPE
    );
    expect(artifact.content.predecessor).toEqual({
      schemaVersion: AFL_TRADE_VALUATION_DISTRIBUTION_PREDECESSOR_SCHEMA_VERSION,
      compatibility: AFL_TRADE_VALUATION_DISTRIBUTION_PREDECESSOR_COMPATIBILITY,
    });
    expect(artifact.content.limitation).toBe(AFL_TRADE_VALUATION_DISTRIBUTION_LIMITATION);

    const mutations: Array<(content: AflTradeValuationDistribution['content']) => void> = [
      (content) => {
        Object.assign(content.derivation, { verificationScope: 'tampered-scope' });
      },
      (content) => {
        Object.assign(content.predecessor, { compatibility: 'tampered-compatibility' });
      },
      (content) => {
        Object.assign(content, { limitation: 'tampered-limitation' });
      },
    ];
    for (const mutate of mutations) {
      const content = structuredClone(artifact.content);
      mutate(content);
      expect(aflTradeValuationDistributionContentSchema.safeParse(content).success).toBe(false);
    }
    expect(
      aflTradeValuationDistributionSchema.safeParse({
        ...artifact,
        valuationDistributionId: `valuation-distribution:${'0'.repeat(64)}`,
      }).success
    ).toBe(false);
  });

  it('rejects ownership, fantasy, roster, and unknown fields at exact envelopes', () => {
    const fixture = createFabricatedAflTradeValuationFixture('two_party_player_swap');
    for (const forbiddenKey of [
      'userId',
      'fantasyLeagueId',
      'fantasyTeamId',
      'ownerId',
      'rosterOwnerId',
      'unknownField',
    ]) {
      expectConstructionError(
        () =>
          createAflTradeValuationDistribution({
            ...createInput(fixture.valuationCase, fixture.calculation),
            [forbiddenKey]: 'forbidden',
          }),
        'INVALID_INPUT_ENVELOPE'
      );
    }

    expectConstructionError(
      () =>
        createAflTradeValuationDistribution(
          createInput(fixture.valuationCase, fixture.calculation, {
            subject: {
              kind: 'afl_club_received_package',
              aflClubId: fixture.valuationCase.content.parties[0].aflClubId,
              ownerId: 'forbidden',
            },
          })
        ),
      'INVALID_SUBJECT'
    );

    const artifact = createAflTradeValuationDistribution(
      createInput(fixture.valuationCase, fixture.calculation)
    );
    const keys: string[] = [];
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (value === null || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        keys.push(key);
        visit(child);
      }
    };
    visit(artifact);
    expect(keys).not.toEqual(
      expect.arrayContaining([
        'userId',
        'fantasyLeagueId',
        'fantasyTeamId',
        'ownerId',
        'rosterOwnerId',
      ])
    );
  });

  it('rejects symbol and non-enumerable extras in creator and verifier envelopes', () => {
    const fixture = createFabricatedAflTradeValuationFixture('two_party_player_swap');
    const symbolInput = createInput(fixture.valuationCase, fixture.calculation);
    Object.defineProperty(symbolInput, Symbol('owner'), { value: 'forbidden' });
    expectConstructionError(
      () => createAflTradeValuationDistribution(symbolInput),
      'INVALID_INPUT_ENVELOPE'
    );

    const hiddenInput = createInput(fixture.valuationCase, fixture.calculation);
    Object.defineProperty(hiddenInput, 'hiddenFantasyOwnerId', { value: 'forbidden' });
    expectConstructionError(
      () => createAflTradeValuationDistribution(hiddenInput),
      'INVALID_INPUT_ENVELOPE'
    );

    const artifact = createAflTradeValuationDistribution(
      createInput(fixture.valuationCase, fixture.calculation)
    );
    for (const key of [Symbol('owner'), 'hiddenFantasyOwnerId']) {
      const verifierInput = {
        valuationDistribution: artifact,
        valuationCase: fixture.valuationCase,
        valuationCalculation: fixture.calculation,
      };
      Object.defineProperty(verifierInput, key, { value: 'forbidden' });
      expect(verifyAflTradeValuationDistributionCaseCalculationDerivation(verifierInput)).toBe(
        false
      );
    }
  });

  it('sanitizes hostile envelopes, accessors, and forged construction errors', () => {
    const ownKeysFailure = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('secret-own-keys-cause');
        },
      }
    );
    expectConstructionError(
      () => createAflTradeValuationDistribution(ownKeysFailure),
      'INVALID_INPUT_ENVELOPE'
    );

    const forged = Object.assign(
      Object.create(AflTradeValuationDistributionConstructionError.prototype) as object,
      { code: 'INVALID_SUBJECT', message: 'secret-forged-message' }
    );
    const fixture = createFabricatedAflTradeValuationFixture('two_party_player_swap');
    const hostile = createInput(fixture.valuationCase, fixture.calculation);
    Object.defineProperty(hostile, 'valuationCase', {
      enumerable: true,
      get() {
        throw forged;
      },
    });
    expectConstructionError(
      () => createAflTradeValuationDistribution(hostile),
      'INVALID_INPUT_ENVELOPE'
    );

    const hostileSubject = new Proxy(
      {},
      {
        get() {
          throw new Error('secret-subject-parser-cause');
        },
      }
    );
    expectConstructionError(
      () =>
        createAflTradeValuationDistribution(
          createInput(fixture.valuationCase, fixture.calculation, {
            subject: hostileSubject,
          })
        ),
      'INVALID_SUBJECT'
    );

    const trusted = new AflTradeValuationDistributionConstructionError('INVALID_SUBJECT');
    expect(isAflTradeValuationDistributionConstructionError(trusted)).toBe(true);
    expect(trusted.toJSON()).toEqual({
      name: 'AflTradeValuationDistributionConstructionError',
      code: 'INVALID_SUBJECT',
      message: 'The valuation-distribution subject is invalid.',
    });
    expect(Object.isFrozen(trusted.toJSON())).toBe(true);
  });

  it('recognizes only trusted construction errors without inspecting hostile prototypes', () => {
    const forged = Object.create(
      AflTradeValuationDistributionConstructionError.prototype
    ) as object;
    const throwingPrototype = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('secret-prototype-trap');
        },
      }
    );
    const revocable = Proxy.revocable({}, {});
    revocable.revoke();

    expect(isAflTradeValuationDistributionConstructionError(forged)).toBe(false);
    expect(isAflTradeValuationDistributionConstructionError(throwingPrototype)).toBe(false);
    expect(isAflTradeValuationDistributionConstructionError(revocable.proxy)).toBe(false);
  });

  it('makes the scoped replay verifier fail closed for malformed and hostile envelopes', () => {
    const fixture = createFabricatedAflTradeValuationFixture('two_party_player_swap');
    const artifact = createAflTradeValuationDistribution(
      createInput(fixture.valuationCase, fixture.calculation)
    );
    expect(verifyAflTradeValuationDistributionCaseCalculationDerivation(null)).toBe(false);
    expect(
      verifyAflTradeValuationDistributionCaseCalculationDerivation({
        valuationDistribution: artifact,
        valuationCase: fixture.valuationCase,
        valuationCalculation: fixture.calculation,
        ownerId: 'forbidden',
      })
    ).toBe(false);
    expect(
      verifyAflTradeValuationDistributionCaseCalculationDerivation({
        valuationDistribution: null,
        valuationCase: fixture.valuationCase,
        valuationCalculation: fixture.calculation,
      })
    ).toBe(false);
    expect(
      verifyAflTradeValuationDistributionCaseCalculationDerivation(
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
    const hostile = {
      valuationDistribution: artifact,
      valuationCase: fixture.valuationCase,
      valuationCalculation: fixture.calculation,
    };
    Object.defineProperty(hostile, 'valuationDistribution', {
      enumerable: true,
      get() {
        throw new Error('secret-verifier-getter');
      },
    });
    expect(verifyAflTradeValuationDistributionCaseCalculationDerivation(hostile)).toBe(false);

    const hostileArtifact = new Proxy(
      {},
      {
        get() {
          throw new Error('secret-artifact-parser-cause');
        },
      }
    );
    expect(
      verifyAflTradeValuationDistributionCaseCalculationDerivation({
        valuationDistribution: hostileArtifact,
        valuationCase: fixture.valuationCase,
        valuationCalculation: fixture.calculation,
      })
    ).toBe(false);
  });

  it('returns a deeply frozen artifact with no aliases to caller-owned inputs', () => {
    const fixture = createFabricatedAflTradeValuationFixture('two_party_player_swap');
    const valuationCase = structuredClone(fixture.valuationCase);
    const calculation = structuredClone(fixture.calculation);
    const subject = {
      kind: 'afl_club_received_package' as const,
      aflClubId: valuationCase.content.parties[0].aflClubId,
    };
    const inputPolicy = policy();
    const artifact = createAflTradeValuationDistribution({
      valuationCase,
      valuationCalculation: calculation,
      view: 'current',
      subject,
      measure: { kind: 'universal_football_value', layer: 'gross' },
      policy: inputPolicy,
    });
    const canonicalBefore = canonicalizeAflTradeJson(artifact);

    subject.aflClubId = 'mutated-club';
    inputPolicy.lowReturnEvent.threshold = -100;
    valuationCase.content.tradeId = 'mutated-trade';
    calculation.content.draws[0].drawKey = 'mutated-draw';

    expect(canonicalizeAflTradeJson(artifact)).toBe(canonicalBefore);
    expect(isDeeplyFrozen(artifact)).toBe(true);
    expect(artifact.content.subject).not.toBe(subject);
    expect(artifact.content.distribution.policy).not.toBe(inputPolicy);
  });

  it('composes distribution replay with the Stage 5 provenance validator', () => {
    const fixture = createFabricatedAflTradeValuationFixture('two_party_player_swap');
    const report = validateAflTradeValuationArtifactChain(fixture);
    expect(report.structurallyValid).toBe(true);

    const artifact = createAflTradeValuationDistribution(
      createInput(fixture.valuationCase, fixture.calculation)
    );
    expect(
      verifyAflTradeValuationDistributionCaseCalculationDerivation({
        valuationDistribution: artifact,
        valuationCase: fixture.valuationCase,
        valuationCalculation: fixture.calculation,
      })
    ).toBe(true);

    const forgedCalculation = makeUniversalUnavailable(fixture.calculation, [0]);
    const forgedArtifact = createAflTradeValuationDistribution(
      createInput(fixture.valuationCase, forgedCalculation, { view: 'at_trade' })
    );
    expect(
      verifyAflTradeValuationDistributionCaseCalculationDerivation({
        valuationDistribution: forgedArtifact,
        valuationCase: fixture.valuationCase,
        valuationCalculation: forgedCalculation,
      })
    ).toBe(true);
    expect(
      validateAflTradeValuationArtifactChain({
        ...fixture,
        calculation: forgedCalculation,
      }).structurallyValid
    ).toBe(false);
  });
});
