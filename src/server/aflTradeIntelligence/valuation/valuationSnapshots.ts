import { z } from 'zod';

import { AFL_TRADE_VALUATION_VIEWS } from '@/types/aflTradeIntelligence';
import {
  aflTradeIsoDateTimeSchema,
  aflTradePublicIdSchema,
} from '@/types/aflTradeIntelligence/shared';

import { aflTradeArtifactRefSchema } from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { aflTradeValuationViewContextSchema } from '../artifacts/valuationBundleManifest';
import {
  aflTradeValuationCalculationSchema,
  type AflTradeValuationCalculation,
} from './tradeValuationCalculation';
import { aflTradeValuationCaseSchema, type AflTradeValuationCase } from './valuationCaseContracts';

const FLOAT_TOLERANCE = 1e-8;
const finiteNumberSchema = z.number().finite();
const probabilitySchema = finiteNumberSchema.min(0).max(1);
const universalLayerSchema = z.enum(['gross', 'list_spot_adjusted', 'scarcity_adjusted']);

const availableConfidenceSchema = z
  .object({
    status: z.literal('available'),
    score: probabilitySchema,
    band: z.enum(['low', 'medium', 'high']),
    evidenceArtifact: aflTradeArtifactRefSchema,
  })
  .strict();
const unavailableConfidenceSchema = z
  .object({
    status: z.literal('unavailable'),
    reasonCode: aflTradePublicIdSchema,
    explanation: z.string().trim().min(1).max(500),
  })
  .strict();
const confidenceSchema = z.discriminatedUnion('status', [
  availableConfidenceSchema,
  unavailableConfidenceSchema,
]);

const exactSamplingUncertaintySchema = z
  .object({
    mode: z.literal('exact'),
    monteCarloStandardError: z.literal(0),
  })
  .strict();
const sampledAvailableUncertaintySchema = z
  .object({
    mode: z.literal('sampled_available'),
    maximumReportedStandardError: finiteNumberSchema.nonnegative(),
    evidenceArtifact: aflTradeArtifactRefSchema,
  })
  .strict();
const sampledUnavailableUncertaintySchema = z
  .object({
    mode: z.literal('sampled_unavailable'),
    reasonCode: aflTradePublicIdSchema,
    explanation: z.string().trim().min(1).max(500),
  })
  .strict();
const samplingUncertaintySchema = z.discriminatedUnion('mode', [
  exactSamplingUncertaintySchema,
  sampledAvailableUncertaintySchema,
  sampledUnavailableUncertaintySchema,
]);

export const aflTradeValuationSnapshotDefinitionsSchema = z
  .object({
    quantileMethod: z.literal('weighted_inverse_cdf_left_continuous'),
    centralIntervalLevel: z.literal(0.8),
    downsideQuantile: z.literal(0.1),
    upsideQuantile: z.literal(0.9),
    lowReturnThreshold: finiteNumberSchema,
    eliteOutcomeThreshold: finiteNumberSchema,
    practicalEquivalenceTolerance: finiteNumberSchema.nonnegative(),
    lowReturnDefinitionArtifact: aflTradeArtifactRefSchema,
    eliteOutcomeDefinitionArtifact: aflTradeArtifactRefSchema,
    practicalEquivalenceDefinitionArtifact: aflTradeArtifactRefSchema,
    confidence: confidenceSchema,
    samplingUncertainty: samplingUncertaintySchema,
  })
  .strict()
  .superRefine((definitions, context) => {
    if (definitions.eliteOutcomeThreshold <= definitions.lowReturnThreshold) {
      context.addIssue({
        code: 'custom',
        path: ['eliteOutcomeThreshold'],
        message: 'The elite-outcome threshold must exceed the low-return threshold.',
      });
    }
  });

export type AflTradeValuationSnapshotDefinitions = z.infer<
  typeof aflTradeValuationSnapshotDefinitionsSchema
>;

const distributionStatisticsSchema = z
  .object({
    mean: finiteNumberSchema,
    median: finiteNumberSchema,
    centralInterval: z
      .object({ level: z.literal(0.8), lower: finiteNumberSchema, upper: finiteNumberSchema })
      .strict(),
    downside: z.object({ quantile: z.literal(0.1), value: finiteNumberSchema }).strict(),
    upside: z.object({ quantile: z.literal(0.9), value: finiteNumberSchema }).strict(),
    lowReturnProbability: probabilitySchema,
    eliteOutcomeProbability: probabilitySchema,
  })
  .strict()
  .superRefine((statistics, context) => {
    if (
      statistics.centralInterval.lower > statistics.median ||
      statistics.median > statistics.centralInterval.upper ||
      statistics.downside.value > statistics.upside.value
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Distribution quantiles must be monotonically ordered.',
      });
    }
  });

const availableDistributionSchema = z
  .object({
    status: z.literal('available'),
    availableProbabilityMass: z.literal(1),
    statistics: distributionStatisticsSchema,
    conditionalOnAvailableStatistics: z.null(),
    reasonCodes: z.array(aflTradePublicIdSchema).length(0),
  })
  .strict();
const unavailableDistributionSchema = z
  .object({
    status: z.literal('unavailable'),
    availableProbabilityMass: probabilitySchema,
    statistics: z.null(),
    conditionalOnAvailableStatistics: distributionStatisticsSchema.nullable(),
    reasonCodes: z.array(aflTradePublicIdSchema).min(1).max(100),
  })
  .strict();
const distributionSummarySchema = z.discriminatedUnion('status', [
  availableDistributionSchema,
  unavailableDistributionSchema,
]);

const comparisonProbabilitiesSchema = z
  .object({
    leftAhead: probabilitySchema,
    practicallyEquivalent: probabilitySchema,
    rightAhead: probabilitySchema,
  })
  .strict()
  .superRefine((probabilities, context) => {
    if (
      Math.abs(
        probabilities.leftAhead + probabilities.practicallyEquivalent + probabilities.rightAhead - 1
      ) > FLOAT_TOLERANCE
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Comparison probabilities must sum to one.',
      });
    }
  });

const availableComparisonSchema = z
  .object({
    status: z.literal('available'),
    availableProbabilityMass: z.literal(1),
    probabilities: comparisonProbabilitiesSchema,
    conditionalOnAvailableProbabilities: z.null(),
    reasonCodes: z.array(aflTradePublicIdSchema).length(0),
  })
  .strict();
const unavailableComparisonSchema = z
  .object({
    status: z.literal('unavailable'),
    availableProbabilityMass: probabilitySchema,
    probabilities: z.null(),
    conditionalOnAvailableProbabilities: comparisonProbabilitiesSchema.nullable(),
    reasonCodes: z.array(aflTradePublicIdSchema).min(1).max(100),
  })
  .strict();
const comparisonSummarySchema = z.discriminatedUnion('status', [
  availableComparisonSchema,
  unavailableComparisonSchema,
]);

const partySnapshotSchema = z
  .object({
    aflClubId: aflTradePublicIdSchema,
    universal: z
      .array(
        z.object({ layer: universalLayerSchema, distribution: distributionSummarySchema }).strict()
      )
      .length(universalLayerSchema.options.length),
    clubUtility: distributionSummarySchema,
  })
  .strict();

const pairwiseComparisonSchema = z
  .object({
    leftAflClubId: aflTradePublicIdSchema,
    rightAflClubId: aflTradePublicIdSchema,
    universal: z
      .array(
        z.object({ layer: universalLayerSchema, comparison: comparisonSummarySchema }).strict()
      )
      .length(universalLayerSchema.options.length),
    clubUtility: comparisonSummarySchema,
  })
  .strict();

export const aflTradeValuationSnapshotContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-valuation-snapshot/v1'),
    publicAssetBoundary: z.literal('source_native_afl_assets_no_user_or_fantasy_ownership'),
    valuationCaseId: aflTradeContentAddressedIdSchema('valuation-case'),
    valuationCalculationId: aflTradeContentAddressedIdSchema('valuation-calculation'),
    valuationBundleId: aflTradeContentAddressedIdSchema('valuation-bundle'),
    valueUnitId: aflTradePublicIdSchema,
    viewContext: aflTradeValuationViewContextSchema,
    snapshotCreatedAt: aflTradeIsoDateTimeSchema,
    definitions: aflTradeValuationSnapshotDefinitionsSchema,
    parties: z.array(partySnapshotSchema).min(2).max(18),
    pairwiseComparisons: z.array(pairwiseComparisonSchema).min(1).max(153),
    limitation: z.literal(
      'Immutable source-independent summary only; conditional partial statistics are not complete-trade results and the snapshot is not source approval, Gate approval, or publication readiness.'
    ),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const clubIds = snapshot.parties.map((party) => party.aflClubId);
    if (
      new Set(clubIds).size !== clubIds.length ||
      clubIds.some((clubId, index) => clubId !== [...clubIds].sort()[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['parties'],
        message: 'Snapshot parties must use unique AFL clubs in canonical order.',
      });
    }
    for (const [partyIndex, party] of snapshot.parties.entries()) {
      if (
        party.universal.some((entry, index) => entry.layer !== universalLayerSchema.options[index])
      ) {
        context.addIssue({
          code: 'custom',
          path: ['parties', partyIndex, 'universal'],
          message: 'Universal snapshot layers must use canonical order.',
        });
      }
    }
    const expectedPairs: string[] = [];
    for (let leftIndex = 0; leftIndex < clubIds.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < clubIds.length; rightIndex += 1) {
        expectedPairs.push(`${clubIds[leftIndex]}|${clubIds[rightIndex]}`);
      }
    }
    const actualPairs = snapshot.pairwiseComparisons.map(
      (pair) => `${pair.leftAflClubId}|${pair.rightAflClubId}`
    );
    if (
      actualPairs.length !== expectedPairs.length ||
      actualPairs.some((pair, index) => pair !== expectedPairs[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['pairwiseComparisons'],
        message: 'A snapshot requires every AFL-club pair exactly once in canonical order.',
      });
    }
  });

export const aflTradeValuationSnapshotSchema = z
  .object({
    valuationSnapshotId: aflTradeContentAddressedIdSchema('valuation-snapshot'),
    content: aflTradeValuationSnapshotContentSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    addAflTradeContentAddressIssue(
      'valuation-snapshot',
      snapshot.valuationSnapshotId,
      snapshot.content,
      context,
      ['valuationSnapshotId']
    );
  });

export const aflTradeValuationSnapshotSetContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-valuation-snapshot-set/v1'),
    valuationCaseId: aflTradeContentAddressedIdSchema('valuation-case'),
    valuationCalculationId: aflTradeContentAddressedIdSchema('valuation-calculation'),
    snapshots: z.array(aflTradeValuationSnapshotSchema).length(AFL_TRADE_VALUATION_VIEWS.length),
  })
  .strict()
  .superRefine((set, context) => {
    if (
      set.snapshots.some(
        (snapshot, index) => snapshot.content.viewContext.view !== AFL_TRADE_VALUATION_VIEWS[index]
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['snapshots'],
        message: 'Snapshot sets must contain every valuation view in canonical order.',
      });
    }
    if (
      set.snapshots.some(
        (snapshot) =>
          snapshot.content.valuationCaseId !== set.valuationCaseId ||
          snapshot.content.valuationCalculationId !== set.valuationCalculationId
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['snapshots'],
        message: 'Every snapshot must reference its containing case and calculation.',
      });
    }
  });

export const aflTradeValuationSnapshotSetSchema = z
  .object({
    valuationSnapshotSetId: aflTradeContentAddressedIdSchema('valuation-snapshot-set'),
    content: aflTradeValuationSnapshotSetContentSchema,
  })
  .strict()
  .superRefine((set, context) => {
    addAflTradeContentAddressIssue(
      'valuation-snapshot-set',
      set.valuationSnapshotSetId,
      set.content,
      context,
      ['valuationSnapshotSetId']
    );
  });

export type AflTradeValuationSnapshot = z.infer<typeof aflTradeValuationSnapshotSchema>;
export type AflTradeValuationSnapshotSet = z.infer<typeof aflTradeValuationSnapshotSetSchema>;

interface WeightedValue {
  value: number;
  weight: number;
}

interface ValueObservation {
  status: 'available' | 'unavailable';
  value: number | null;
  weight: number;
  reasonCodes: string[];
}

function weightedQuantile(values: readonly WeightedValue[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left.value - right.value);
  const threshold = quantile * sorted.reduce((sum, item) => sum + item.weight, 0);
  let cumulative = 0;
  for (const item of sorted) {
    cumulative += item.weight;
    if (cumulative + FLOAT_TOLERANCE >= threshold) return item.value;
  }
  return sorted[sorted.length - 1].value;
}

function distributionStatistics(
  unnormalizedValues: readonly WeightedValue[],
  definitions: AflTradeValuationSnapshotDefinitions
) {
  const totalWeight = unnormalizedValues.reduce((sum, item) => sum + item.weight, 0);
  const values = unnormalizedValues.map((item) => ({
    value: item.value,
    weight: item.weight / totalWeight,
  }));
  return {
    mean: values.reduce((sum, item) => sum + item.value * item.weight, 0),
    median: weightedQuantile(values, 0.5),
    centralInterval: {
      level: 0.8 as const,
      lower: weightedQuantile(values, 0.1),
      upper: weightedQuantile(values, 0.9),
    },
    downside: { quantile: 0.1 as const, value: weightedQuantile(values, 0.1) },
    upside: { quantile: 0.9 as const, value: weightedQuantile(values, 0.9) },
    lowReturnProbability: values
      .filter((item) => item.value <= definitions.lowReturnThreshold)
      .reduce((sum, item) => sum + item.weight, 0),
    eliteOutcomeProbability: values
      .filter((item) => item.value >= definitions.eliteOutcomeThreshold)
      .reduce((sum, item) => sum + item.weight, 0),
  };
}

function summarizeDistribution(
  observations: readonly ValueObservation[],
  definitions: AflTradeValuationSnapshotDefinitions
): z.infer<typeof distributionSummarySchema> {
  const available = observations.filter(
    (item): item is ValueObservation & { value: number } =>
      item.status === 'available' && item.value !== null
  );
  const availableProbabilityMass = available.reduce((sum, item) => sum + item.weight, 0);
  const statistics =
    available.length === 0
      ? null
      : distributionStatistics(
          available.map((item) => ({ value: item.value, weight: item.weight })),
          definitions
        );
  if (Math.abs(availableProbabilityMass - 1) <= FLOAT_TOLERANCE) {
    return {
      status: 'available',
      availableProbabilityMass: 1,
      statistics: statistics!,
      conditionalOnAvailableStatistics: null,
      reasonCodes: [],
    };
  }
  return {
    status: 'unavailable',
    availableProbabilityMass,
    statistics: null,
    conditionalOnAvailableStatistics: statistics,
    reasonCodes: [
      ...new Set(
        observations
          .filter((item) => item.status === 'unavailable')
          .flatMap((item) => item.reasonCodes)
      ),
    ].sort(),
  };
}

function comparisonProbabilities(
  values: readonly { left: number; right: number; weight: number }[],
  tolerance: number
) {
  const totalWeight = values.reduce((sum, item) => sum + item.weight, 0);
  const normalized = values.map((item) => ({ ...item, weight: item.weight / totalWeight }));
  return {
    leftAhead: normalized
      .filter((item) => item.left - item.right > tolerance)
      .reduce((sum, item) => sum + item.weight, 0),
    practicallyEquivalent: normalized
      .filter((item) => Math.abs(item.left - item.right) <= tolerance)
      .reduce((sum, item) => sum + item.weight, 0),
    rightAhead: normalized
      .filter((item) => item.right - item.left > tolerance)
      .reduce((sum, item) => sum + item.weight, 0),
  };
}

function summarizeComparison(
  left: readonly ValueObservation[],
  right: readonly ValueObservation[],
  definitions: AflTradeValuationSnapshotDefinitions
): z.infer<typeof comparisonSummarySchema> {
  const available = left.flatMap((leftItem, index) => {
    const rightItem = right[index];
    return leftItem.status === 'available' &&
      leftItem.value !== null &&
      rightItem.status === 'available' &&
      rightItem.value !== null
      ? [{ left: leftItem.value, right: rightItem.value, weight: leftItem.weight }]
      : [];
  });
  const availableProbabilityMass = available.reduce((sum, item) => sum + item.weight, 0);
  const probabilities =
    available.length === 0
      ? null
      : comparisonProbabilities(available, definitions.practicalEquivalenceTolerance);
  if (Math.abs(availableProbabilityMass - 1) <= FLOAT_TOLERANCE) {
    return {
      status: 'available',
      availableProbabilityMass: 1,
      probabilities: probabilities!,
      conditionalOnAvailableProbabilities: null,
      reasonCodes: [],
    };
  }
  return {
    status: 'unavailable',
    availableProbabilityMass,
    probabilities: null,
    conditionalOnAvailableProbabilities: probabilities,
    reasonCodes: [
      ...new Set(
        [...left, ...right]
          .filter((item) => item.status === 'unavailable')
          .flatMap((item) => item.reasonCodes)
      ),
    ].sort(),
  };
}

function universalObservation(
  calculation: AflTradeValuationCalculation,
  drawIndex: number,
  clubId: string,
  view: (typeof AFL_TRADE_VALUATION_VIEWS)[number],
  layer: z.infer<typeof universalLayerSchema>
): ValueObservation {
  const draw = calculation.content.draws[drawIndex];
  const result = draw.parties
    .find((party) => party.aflClubId === clubId)!
    .views.find((candidate) => candidate.view === view)!.universal;
  const layers = result.status === 'available' ? result.layers : result.partialLayers;
  const value =
    layer === 'gross'
      ? layers.gross
      : layer === 'list_spot_adjusted'
        ? layers.listSpotAdjusted
        : layers.scarcityAdjusted;
  return {
    status: result.status,
    value,
    weight: draw.probabilityWeight,
    reasonCodes: result.status === 'available' ? [] : result.reasonCodes,
  };
}

function utilityObservation(
  calculation: AflTradeValuationCalculation,
  drawIndex: number,
  clubId: string,
  view: (typeof AFL_TRADE_VALUATION_VIEWS)[number]
): ValueObservation {
  const draw = calculation.content.draws[drawIndex];
  const result = draw.parties
    .find((party) => party.aflClubId === clubId)!
    .views.find((candidate) => candidate.view === view)!.clubUtility;
  return {
    status: result.status,
    value: result.status === 'available' ? result.value : result.partialValue,
    weight: draw.probabilityWeight,
    reasonCodes: result.status === 'available' ? [] : result.reasonCodes,
  };
}

export function createAflTradeValuationSnapshotSet(
  unparsedCalculation: AflTradeValuationCalculation,
  unparsedValuationCase: AflTradeValuationCase,
  unparsedDefinitions: AflTradeValuationSnapshotDefinitions,
  snapshotCreatedAt: string
): AflTradeValuationSnapshotSet {
  const calculation = aflTradeValuationCalculationSchema.parse(unparsedCalculation);
  const valuationCase = aflTradeValuationCaseSchema.parse(unparsedValuationCase);
  const definitions = aflTradeValuationSnapshotDefinitionsSchema.parse(unparsedDefinitions);
  const parsedCreatedAt = aflTradeIsoDateTimeSchema.parse(snapshotCreatedAt);
  if (calculation.content.valuationCaseId !== valuationCase.valuationCaseId) {
    throw new TypeError('The calculation and valuation case references do not match.');
  }
  if (
    calculation.content.execution.mode === 'exact_joint_mixture' &&
    definitions.samplingUncertainty.mode !== 'exact'
  ) {
    throw new TypeError('Exact joint mixtures require exact zero Monte Carlo uncertainty.');
  }
  if (
    calculation.content.execution.mode === 'deterministic_counter_sample' &&
    definitions.samplingUncertainty.mode === 'exact'
  ) {
    throw new TypeError('Sampled calculations cannot claim exact Monte Carlo uncertainty.');
  }

  const clubIds = valuationCase.content.parties.map((party) => party.aflClubId);
  const snapshots = AFL_TRADE_VALUATION_VIEWS.map((view, viewIndex) => {
    const observationsByClub = new Map(
      clubIds.map((clubId) => [
        clubId,
        {
          universal: new Map(
            universalLayerSchema.options.map((layer) => [
              layer,
              calculation.content.draws.map((_draw, drawIndex) =>
                universalObservation(calculation, drawIndex, clubId, view, layer)
              ),
            ])
          ),
          clubUtility: calculation.content.draws.map((_draw, drawIndex) =>
            utilityObservation(calculation, drawIndex, clubId, view)
          ),
        },
      ])
    );
    const parties = clubIds.map((clubId) => {
      const observations = observationsByClub.get(clubId)!;
      return {
        aflClubId: clubId,
        universal: universalLayerSchema.options.map((layer) => ({
          layer,
          distribution: summarizeDistribution(observations.universal.get(layer)!, definitions),
        })),
        clubUtility: summarizeDistribution(observations.clubUtility, definitions),
      };
    });
    const pairwiseComparisons = [];
    for (let leftIndex = 0; leftIndex < clubIds.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < clubIds.length; rightIndex += 1) {
        const leftAflClubId = clubIds[leftIndex];
        const rightAflClubId = clubIds[rightIndex];
        const left = observationsByClub.get(leftAflClubId)!;
        const right = observationsByClub.get(rightAflClubId)!;
        pairwiseComparisons.push({
          leftAflClubId,
          rightAflClubId,
          universal: universalLayerSchema.options.map((layer) => ({
            layer,
            comparison: summarizeComparison(
              left.universal.get(layer)!,
              right.universal.get(layer)!,
              definitions
            ),
          })),
          clubUtility: summarizeComparison(left.clubUtility, right.clubUtility, definitions),
        });
      }
    }
    const content = aflTradeValuationSnapshotContentSchema.parse({
      schemaVersion: 'afl-trade-valuation-snapshot/v1',
      publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership',
      valuationCaseId: valuationCase.valuationCaseId,
      valuationCalculationId: calculation.valuationCalculationId,
      valuationBundleId: calculation.content.valuationBundleId,
      valueUnitId: calculation.content.valueUnitId,
      viewContext: valuationCase.content.viewContexts[viewIndex],
      snapshotCreatedAt: parsedCreatedAt,
      definitions,
      parties,
      pairwiseComparisons,
      limitation:
        'Immutable source-independent summary only; conditional partial statistics are not complete-trade results and the snapshot is not source approval, Gate approval, or publication readiness.',
    });
    return aflTradeValuationSnapshotSchema.parse({
      valuationSnapshotId: createAflTradeContentAddress('valuation-snapshot', content),
      content,
    });
  });
  const content = aflTradeValuationSnapshotSetContentSchema.parse({
    schemaVersion: 'afl-trade-valuation-snapshot-set/v1',
    valuationCaseId: valuationCase.valuationCaseId,
    valuationCalculationId: calculation.valuationCalculationId,
    snapshots,
  });
  return aflTradeValuationSnapshotSetSchema.parse({
    valuationSnapshotSetId: createAflTradeContentAddress('valuation-snapshot-set', content),
    content,
  });
}
