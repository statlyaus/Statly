import { z } from 'zod';

import type { AflTradeValueSummary } from '@/types/aflTradeIntelligence';
import { aflTradeValueSummarySchema } from '@/types/aflTradeIntelligence';

import {
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import {
  aflTradeDevelopmentGradeDatasetSchema,
  eligibleAflTradeHistoricalOutcomes,
  type AflTradeDevelopmentGradeDataset,
} from './developmentTradeGradeDataset';

const isoInstantSchema = z.iso.datetime({ offset: true });
const idSchema = z.string().trim().min(1).max(200);
const selectionSchema = z
  .object({
    nominalNumber: z.number().int().positive().max(500).nullable(),
    round: z.number().int().positive().max(30).nullable(),
  })
  .strict();
const assetSchema = z
  .object({
    assetId: idSchema,
    kind: z.enum(['player', 'pick', 'future_pick']),
    lineageState: z.enum(['resolved', 'unresolved']),
    acquisitionId: idSchema.nullable(),
    selection: selectionSchema,
  })
  .strict();
const tradeCaseSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-development-grade-case/v1'),
    tradeId: idSchema,
    effectiveAt: isoInstantSchema,
    asOf: isoInstantSchema,
    parties: z
      .array(
        z
          .object({
            aflClubId: idSchema,
            clubName: z.string().trim().min(1).max(120),
            assets: z.array(assetSchema).min(1).max(100),
          })
          .strict()
      )
      .min(2)
      .max(18),
  })
  .strict()
  .superRefine((trade, context) => {
    const clubIds = trade.parties.map(({ aflClubId }) => aflClubId);
    const assetIds = trade.parties.flatMap(({ assets }) => assets.map(({ assetId }) => assetId));
    if (new Set(clubIds).size !== clubIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['parties'],
        message: 'Trade clubs must be unique.',
      });
    }
    if (new Set(assetIds).size !== assetIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['parties'],
        message: 'Trade assets must be unique.',
      });
    }
    if (Date.parse(trade.effectiveAt) > Date.parse(trade.asOf)) {
      context.addIssue({ code: 'custom', path: ['asOf'], message: 'As-of must follow the trade.' });
    }
  });

const modelConfigSchema = z
  .object({
    createdAt: isoInstantSchema,
    minimumCohortSize: z.number().int().min(2).max(500),
    practicalEquivalenceTolerance: z.number().finite().nonnegative().max(1_000),
  })
  .strict();

export interface AflTradeDevelopmentGradeModel {
  modelId: string;
  content: {
    schemaVersion: 'afl-trade-development-grade-model/v1';
    datasetId: string;
    createdAt: string;
    minimumCohortSize: number;
    practicalEquivalenceTolerance: number;
    outcomeWeights: {
      games: number;
      goals: number;
      coachesVotes: number;
      brownlowVotes: number;
    };
    providerFeatureTreatment: 'reconciled_point_in_time_when_available_else_selection_demographic';
    historicalEligibility: 'fixed_horizon_matured_strictly_before_prediction';
    sourceRecordedGradeTreatment: 'prohibited';
    publicationEligible: false;
  };
}

export interface AflTradeDevelopmentGradeAssetResult {
  assetId: string;
  state:
    | 'valued'
    | 'right_censored'
    | 'outcome_unresolved'
    | 'lineage_unresolved'
    | 'insufficient_cohort';
  featureProviders: readonly ('afl_tables' | 'footywire' | 'fryzigg')[];
  atTradeSampleCount: number;
}

export interface AflTradeDevelopmentTradeValueResult {
  calculationId: string;
  tradeId: string;
  datasetId: string;
  modelId: string;
  summaries: {
    at_trade: AflTradeValueSummary;
    realized: AflTradeValueSummary;
    remaining: AflTradeValueSummary;
    current: AflTradeValueSummary;
  };
  assets: readonly AflTradeDevelopmentGradeAssetResult[];
  publicationEligible: false;
}

type DatasetRow = AflTradeDevelopmentGradeDataset['content']['rows'][number];
type TradeAsset = z.infer<typeof assetSchema>;
type View = keyof AflTradeDevelopmentTradeValueResult['summaries'];

const OUTCOME_WEIGHTS = Object.freeze({
  games: 1,
  goals: 0.5,
  coachesVotes: 1.5,
  brownlowVotes: 2,
});
const VALUE_UNIT = Object.freeze({
  id: 'statly-development-career-contribution-index',
  label: 'Career contribution index',
  description:
    'A development-only empirical AFL contribution index combining games, goals and reconciled vote outcomes.',
  direction: 'higher_is_better' as const,
});
const METHODOLOGY_HREF = '/draft/trades/methodology';
const SIMULATION_SIZE = 256;
const DEVELOPMENT_PREVIEW_WARNING = Object.freeze({
  code: 'development-workbook-preview',
  severity: 'warning' as const,
  message:
    'This provisional grade is calculated from the pinned development workbook and is not a published Statly valuation.',
});

function metricValue(metric: DatasetRow['outcome']['games']): number | null {
  if (metric.state === 'observed') return metric.value;
  if (metric.state === 'partial') return metric.observedValue;
  return null;
}

function outcomeScore(row: DatasetRow): number | null {
  const games = metricValue(row.outcome.games);
  const goals = metricValue(row.outcome.goals);
  const coachesVotes = metricValue(row.outcome.coachesVotes);
  const brownlowVotes = metricValue(row.outcome.brownlowVotes);
  if ([games, goals, coachesVotes, brownlowVotes].some((value) => value === null)) return null;
  return (
    games! * OUTCOME_WEIGHTS.games +
    goals! * OUTCOME_WEIGHTS.goals +
    coachesVotes! * OUTCOME_WEIGHTS.coachesVotes +
    brownlowVotes! * OUTCOME_WEIGHTS.brownlowVotes
  );
}

function providerFeature(dataset: AflTradeDevelopmentGradeDataset, row: DatasetRow): number | null {
  const observations = dataset.content.providerSeasons.filter(({ observationId }) =>
    row.atTradeProviderObservationIds.includes(observationId)
  );
  if (observations.length === 0) return null;
  return (
    observations.reduce(
      (sum, { stats }) =>
        sum + stats.games + stats.goals * 0.5 + stats.coachesVotes * 1.5 + stats.brownlowVotes * 2,
      0
    ) / observations.length
  );
}

function rowProviders(
  dataset: AflTradeDevelopmentGradeDataset,
  row: DatasetRow | undefined
): AflTradeDevelopmentGradeAssetResult['featureProviders'] {
  if (!row) return [];
  return [
    ...new Set(
      dataset.content.providerSeasons
        .filter(({ observationId }) => row.atTradeProviderObservationIds.includes(observationId))
        .flatMap(({ sourceProviders }) => sourceProviders)
    ),
  ].sort();
}

function pickBucket(number: number | null): number | null {
  if (number === null) return null;
  if (number <= 10) return 1;
  if (number <= 20) return 2;
  if (number <= 40) return 3;
  return 4;
}

function historicalSamples(input: {
  dataset: AflTradeDevelopmentGradeDataset;
  asset: TradeAsset;
  linkedRow: DatasetRow | undefined;
  cutoffAt: string;
  minimumCohortSize: number;
}): number[] {
  const targetFeature = input.linkedRow ? providerFeature(input.dataset, input.linkedRow) : null;
  const targetNumber = input.asset.selection.nominalNumber;
  const targetRound = input.asset.selection.round;
  const eligible = eligibleAflTradeHistoricalOutcomes(input.dataset, input.cutoffAt)
    .filter(
      (row) =>
        row.player.identityState === 'resolved' &&
        Object.values(row.outcome).every(({ state }) => state === 'observed')
    )
    .map((row) => ({ row, score: outcomeScore(row), feature: providerFeature(input.dataset, row) }))
    .filter((entry): entry is typeof entry & { score: number } => entry.score !== null);

  const bySelection = eligible.filter(({ row }) => {
    if (targetNumber !== null && row.selection.nominalNumber !== null) {
      return pickBucket(row.selection.nominalNumber) === pickBucket(targetNumber);
    }
    if (targetRound !== null) return row.selection.round === targetRound;
    return input.asset.kind === 'player' && row.mechanism === 'trade';
  });
  const cohort = bySelection.length >= input.minimumCohortSize ? bySelection : eligible;
  return cohort
    .sort((left, right) => {
      const leftDistance =
        targetFeature === null || left.feature === null
          ? 0
          : Math.abs(left.feature - targetFeature);
      const rightDistance =
        targetFeature === null || right.feature === null
          ? 0
          : Math.abs(right.feature - targetFeature);
      return (
        leftDistance - rightDistance ||
        left.row.acquisitionId.localeCompare(right.row.acquisitionId)
      );
    })
    .slice(0, Math.max(input.minimumCohortSize, 40))
    .map(({ score }) => score);
}

function viewSamples(input: {
  view: View;
  atTradeSamples: readonly number[];
  linkedRow: DatasetRow | undefined;
  asOf: string;
}): number[] {
  if (input.view === 'at_trade') return [...input.atTradeSamples];
  if (!input.linkedRow) {
    return input.view === 'realized' ? [] : [...input.atTradeSamples];
  }
  const score = input.linkedRow ? outcomeScore(input.linkedRow) : null;
  if (score === null) return [];
  const isPartial = Object.values(input.linkedRow!.outcome).some(
    ({ state }) => state === 'partial'
  );
  if (!isPartial) {
    if (input.view === 'remaining') return [0];
    return [score];
  }
  if (input.view === 'realized') return [score];
  const effectiveAt = Date.parse(input.linkedRow!.effectiveAt);
  const maturityAt = Date.parse(input.linkedRow!.outcomeMaturedAt);
  const asOf = Math.min(Date.parse(input.asOf), maturityAt);
  const remainingFraction = Math.max(0, (maturityAt - asOf) / (maturityAt - effectiveAt));
  const remaining = input.atTradeSamples.map(
    (sample) => Math.max(0, sample - score) * remainingFraction
  );
  if (input.view === 'remaining') return remaining;
  return remaining.map((value) => score + value);
}

function quantile(values: readonly number[], probability: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(probability * sorted.length)));
  return sorted[index] ?? 0;
}

function summarizePartySamples(
  partySamples: readonly { aflClubId: string; clubName: string; samples: readonly number[] }[],
  tolerance: number
) {
  const expanded = [...partySamples]
    .sort((left, right) => left.aflClubId.localeCompare(right.aflClubId))
    .map((party, partyIndex) => ({
      ...party,
      samples: Array.from({ length: SIMULATION_SIZE }, (_, index) => {
        const source = party.samples;
        return source[(index * 17 + partyIndex * 7) % source.length] ?? 0;
      }),
    }));
  const wins = new Map(expanded.map(({ aflClubId }) => [aflClubId, 0]));
  let equivalences = 0;
  for (let index = 0; index < SIMULATION_SIZE; index += 1) {
    const values = expanded.map(({ samples }) => samples[index] ?? 0);
    const maximum = Math.max(...values);
    const minimum = Math.min(...values);
    if (maximum - minimum <= tolerance) {
      equivalences += 1;
      continue;
    }
    const leaders = expanded.filter((_, partyIndex) => maximum - values[partyIndex]! <= tolerance);
    const winShare = 1 / leaders.length;
    for (const leader of leaders) {
      wins.set(leader.aflClubId, (wins.get(leader.aflClubId) ?? 0) + winShare);
    }
  }
  return {
    clubValues: expanded.map((party) => ({
      aflClubId: party.aflClubId,
      clubName: party.clubName,
      expectedValue: party.samples.reduce((sum, value) => sum + value, 0) / party.samples.length,
      medianValue: quantile(party.samples, 0.5),
      interval: {
        lower: quantile(party.samples, 0.1),
        upper: quantile(party.samples, 0.9),
        level: 0.8,
      },
      finishesAheadProbability: (wins.get(party.aflClubId) ?? 0) / SIMULATION_SIZE,
    })),
    practicalEquivalenceProbability: equivalences / SIMULATION_SIZE,
  };
}

function assessment(
  clubValues: readonly { aflClubId: string; finishesAheadProbability: number }[],
  coverageComplete: boolean
) {
  const maximumProbability = Math.max(
    ...clubValues.map(({ finishesAheadProbability }) => finishesAheadProbability)
  );
  const leaders = clubValues.filter(
    ({ finishesAheadProbability }) =>
      Math.abs(maximumProbability - finishesAheadProbability) <= Number.EPSILON
  );
  const leader = leaders[0]!;
  const baseline = 1 / clubValues.length;
  const advantage = leader.finishesAheadProbability - baseline;
  if (leaders.length !== 1 || advantage < 0.1) {
    return {
      interpretation: 'balanced_within_uncertainty' as const,
      favouredAflClubId: null,
      scope: coverageComplete ? ('complete_trade' as const) : ('included_assets_only' as const),
    };
  }
  return {
    interpretation:
      advantage >= 0.35 ? ('strongly_leans_to_club' as const) : ('leans_to_club' as const),
    favouredAflClubId: leader.aflClubId,
    scope: coverageComplete ? ('complete_trade' as const) : ('included_assets_only' as const),
  };
}

function confidence(level: 'low' | 'moderate' | 'high') {
  return {
    level,
    dimensions: [
      {
        kind: 'model_calibration' as const,
        level,
        reasonCode: `development-empirical-${level}`,
        explanation:
          level === 'low'
            ? 'The current view contains right-censored outcomes or limited empirical evidence.'
            : 'The development result uses fixed-horizon empirical cohorts and reconciled point-in-time features.',
      },
    ],
  };
}

function unavailableSummary(view: View, availability: 'insufficient_data' | 'lineage_unresolved') {
  return aflTradeValueSummarySchema.parse({
    availability,
    view,
    modelVintage: view === 'at_trade' ? 'historical_restatement' : 'current',
    temporalContext: null,
    reasonCode: availability,
    message: 'No defensible numerical comparison is available for the included trade assets.',
    nextAction: {
      kind: availability === 'lineage_unresolved' ? 'resolve_lineage' : 'collect_more_evidence',
      label:
        availability === 'lineage_unresolved' ? 'Resolve asset lineage' : 'Collect more evidence',
      href: null,
      expectedAfter: null,
    },
    warnings: [DEVELOPMENT_PREVIEW_WARNING],
    methodologyHref: METHODOLOGY_HREF,
  });
}

export function createAflTradeDevelopmentGradeModel(
  unparsedDataset: unknown,
  unparsedConfig: unknown
): AflTradeDevelopmentGradeModel {
  const dataset = aflTradeDevelopmentGradeDatasetSchema.parse(unparsedDataset);
  const config = modelConfigSchema.parse(unparsedConfig);
  if (Date.parse(config.createdAt) < Date.parse(dataset.content.createdAt)) {
    throw new TypeError('Model creation cannot predate its development dataset.');
  }
  const content: AflTradeDevelopmentGradeModel['content'] = {
    schemaVersion: 'afl-trade-development-grade-model/v1',
    datasetId: dataset.datasetId,
    createdAt: config.createdAt,
    minimumCohortSize: config.minimumCohortSize,
    practicalEquivalenceTolerance: config.practicalEquivalenceTolerance,
    outcomeWeights: OUTCOME_WEIGHTS,
    providerFeatureTreatment: 'reconciled_point_in_time_when_available_else_selection_demographic',
    historicalEligibility: 'fixed_horizon_matured_strictly_before_prediction',
    sourceRecordedGradeTreatment: 'prohibited',
    publicationEligible: false,
  };
  return Object.freeze({
    modelId: createAflTradeContentAddress('development-grade-model', content),
    content: Object.freeze(content),
  });
}

export function valueAflTradeDevelopmentTrade(unparsedInput: {
  dataset: unknown;
  model: AflTradeDevelopmentGradeModel;
  trade: unknown;
}): AflTradeDevelopmentTradeValueResult {
  const dataset = aflTradeDevelopmentGradeDatasetSchema.parse(unparsedInput.dataset);
  const trade = tradeCaseSchema.parse(unparsedInput.trade);
  const model = unparsedInput.model;
  if (model.content.datasetId !== dataset.datasetId) {
    throw new TypeError('Development grade model and dataset do not match.');
  }
  const rowById = new Map(dataset.content.rows.map((row) => [row.acquisitionId, row]));
  const assetEvidence = new Map<
    string,
    {
      linkedRow: DatasetRow | undefined;
      atTradeSamples: number[];
      result: AflTradeDevelopmentGradeAssetResult;
    }
  >();
  for (const party of trade.parties) {
    for (const asset of party.assets) {
      const linkedRow = asset.acquisitionId ? rowById.get(asset.acquisitionId) : undefined;
      const atTradeSamples =
        asset.lineageState === 'resolved'
          ? historicalSamples({
              dataset,
              asset,
              linkedRow,
              cutoffAt: trade.effectiveAt,
              minimumCohortSize: model.content.minimumCohortSize,
            })
          : [];
      const isRightCensored =
        linkedRow && Object.values(linkedRow.outcome).some(({ state }) => state === 'partial');
      const hasUnresolvedSelectionOutcome =
        !linkedRow &&
        (asset.kind === 'pick' || asset.kind === 'future_pick') &&
        (asset.selection.nominalNumber !== null || asset.selection.round !== null);
      const state: AflTradeDevelopmentGradeAssetResult['state'] =
        asset.lineageState === 'unresolved'
          ? 'lineage_unresolved'
          : atTradeSamples.length < model.content.minimumCohortSize
            ? 'insufficient_cohort'
            : isRightCensored
              ? 'right_censored'
              : hasUnresolvedSelectionOutcome
                ? 'outcome_unresolved'
                : 'valued';
      assetEvidence.set(asset.assetId, {
        linkedRow,
        atTradeSamples,
        result: {
          assetId: asset.assetId,
          state,
          featureProviders: rowProviders(dataset, linkedRow),
          atTradeSampleCount: atTradeSamples.length,
        },
      });
    }
  }

  const totalAssets = trade.parties.reduce((sum, party) => sum + party.assets.length, 0);
  const summaries = Object.fromEntries(
    (['at_trade', 'realized', 'remaining', 'current'] as const).map((view) => {
      const partySamples = trade.parties.map((party) => {
        const assetSamples = party.assets
          .map((asset) => {
            const evidence = assetEvidence.get(asset.assetId)!;
            if (
              evidence.result.state === 'lineage_unresolved' ||
              evidence.result.state === 'insufficient_cohort'
            ) {
              return null;
            }
            const samples = viewSamples({
              view,
              atTradeSamples: evidence.atTradeSamples,
              linkedRow: evidence.linkedRow,
              asOf: trade.asOf,
            });
            return samples.length > 0 ? samples : null;
          })
          .filter((samples): samples is number[] => samples !== null);
        if (assetSamples.length === 0) return { ...party, samples: [] as number[] };
        const length = Math.max(...assetSamples.map((samples) => samples.length));
        return {
          ...party,
          samples: Array.from({ length }, (_, index) =>
            assetSamples.reduce((sum, samples) => sum + (samples[index % samples.length] ?? 0), 0)
          ),
        };
      });
      const valuedAssetCount = trade.parties.reduce(
        (sum, party) =>
          sum +
          party.assets.filter((asset) => {
            const evidence = assetEvidence.get(asset.assetId)!;
            if (
              evidence.result.state === 'lineage_unresolved' ||
              evidence.result.state === 'insufficient_cohort'
            ) {
              return false;
            }
            return (
              viewSamples({
                view,
                atTradeSamples: evidence.atTradeSamples,
                linkedRow: evidence.linkedRow,
                asOf: trade.asOf,
              }).length > 0
            );
          }).length,
        0
      );
      if (valuedAssetCount === 0 || partySamples.some(({ samples }) => samples.length === 0)) {
        const hasLineageFailure = [...assetEvidence.values()].some(
          ({ result }) => result.state === 'lineage_unresolved'
        );
        return [
          view,
          unavailableSummary(view, hasLineageFailure ? 'lineage_unresolved' : 'insufficient_data'),
        ];
      }
      const comparison = summarizePartySamples(
        partySamples,
        model.content.practicalEquivalenceTolerance
      );
      const excludedAssetCount = totalAssets - valuedAssetCount;
      const coverageComplete = excludedAssetCount === 0;
      const containsRightCensoring = [...assetEvidence.values()].some(
        ({ result }) => result.state === 'right_censored' || result.state === 'outcome_unresolved'
      );
      const level = containsRightCensoring ? 'low' : valuedAssetCount >= 6 ? 'high' : 'moderate';
      const common = {
        view,
        modelVintage:
          view === 'at_trade' ? ('historical_restatement' as const) : ('current' as const),
        unit: VALUE_UNIT,
        clubValues: comparison.clubValues,
        practicalEquivalenceProbability: comparison.practicalEquivalenceProbability,
        comparisonBasis: coverageComplete
          ? ('complete_trade' as const)
          : ('included_assets_only' as const),
        assessment: assessment(comparison.clubValues, coverageComplete),
        confidence: confidence(level),
        methodologyHref: METHODOLOGY_HREF,
      };
      const summary = coverageComplete
        ? {
            ...common,
            availability: 'available' as const,
            coverage: {
              status: 'complete' as const,
              coverageRatio: 1 as const,
              excludedAssetCount: 0 as const,
            },
            warnings: [DEVELOPMENT_PREVIEW_WARNING],
          }
        : {
            ...common,
            availability: 'available_partial' as const,
            coverage: {
              status: 'partial' as const,
              coverageRatio: valuedAssetCount / totalAssets,
              excludedAssetCount,
            },
            reasonCode: 'excluded-unresolved-assets',
            message:
              'The comparison excludes assets without resolved lineage or sufficient historical evidence.',
            nextAction: {
              kind: 'resolve_lineage' as const,
              label: 'Resolve excluded asset lineage',
              href: null,
              expectedAfter: null,
            },
            warnings: [
              DEVELOPMENT_PREVIEW_WARNING,
              {
                code: 'partial-asset-coverage',
                severity: 'warning' as const,
                message:
                  'Statly grades reflect included assets only until excluded asset evidence is resolved.',
              },
            ],
          };
      return [view, aflTradeValueSummarySchema.parse(summary)];
    })
  ) as AflTradeDevelopmentTradeValueResult['summaries'];
  const content = {
    tradeId: trade.tradeId,
    datasetId: dataset.datasetId,
    modelId: model.modelId,
    tradeCaseSha256: sha256AflTradeCanonicalJson(trade),
    summaries,
    assets: [...assetEvidence.values()].map(({ result }) => result),
    publicationEligible: false as const,
  };
  return Object.freeze({
    calculationId: createAflTradeContentAddress('development-trade-value', content),
    ...content,
  });
}
