import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import type { AflTradeLineageGraph } from '../domain/lineageTypes';
import {
  aflTradePromotionBackedPublicArchiveSchema,
  type AflTradePromotionBackedPublicArchive,
} from '../outcomes/promotionBackedPublicArchiveContracts';
import type { AflTradeComponentDrawSet } from './componentDrawSet';
import type { AflTradePackagePolicy } from './packagePolicy';
import type { AflTradeRealizedContributionLedger } from './realizedContributionLedger';
import {
  calculateAflTradeValuation,
  aflTradeValuationCalculationSchema,
  type AflTradeValuationCalculation,
} from './tradeValuationCalculation';
import { aflTradeValuationCaseSchema, type AflTradeValuationCase } from './valuationCaseContracts';
import { materializeAflTradeValuationCase } from './valuationCaseMaterialization';

export const AFL_TRADE_COMPLETE_ASSESSMENT_SCHEMA_VERSION =
  'afl-trade-complete-assessment/v1' as const;
export const AFL_TRADE_COMPLETE_ASSESSMENT_V2_SCHEMA_VERSION =
  'afl-trade-complete-assessment/v2' as const;
export const AFL_TRADE_COMPLETE_ASSESSMENT_VIEWS = [
  'at_trade',
  'realized',
  'remaining',
  'current',
] as const;

const instantSchema = z.string().datetime({ offset: false, precision: 3 });
const partySchema = z
  .object({
    clubId: z.string().trim().min(1).max(240),
    clubName: z.string().trim().min(1).max(240),
  })
  .strict();
const transferSchema = z
  .object({
    transferId: z.string().trim().min(1).max(240),
    fromClubId: z.string().trim().min(1).max(240),
    toClubId: z.string().trim().min(1).max(240),
    assetId: z.string().trim().min(1).max(240),
    assetKind: z.enum(['player', 'pick', 'future_pick']),
    displayLabel: z.string().trim().min(1).max(500),
    resolution: z.enum(['resolved', 'linked_to_final_selection', 'unresolved']),
    atTradeSamples: z.array(z.number().finite()).min(2).max(100_000),
    currentSamples: z.array(z.number().finite()).min(2).max(100_000),
  })
  .strict();
const inputSchema = z
  .object({
    tradeId: z.string().trim().min(1).max(240),
    valueUnit: z
      .object({
        valueUnitId: z.string().trim().min(1).max(240),
        shortLabel: z.string().trim().min(1).max(160),
        explanation: z.string().trim().min(1).max(1_000),
      })
      .strict(),
    modelVersion: z.string().trim().min(1).max(240),
    sampleCount: z.number().int().min(2).max(100_000),
    assessedAt: instantSchema,
    parties: z.array(partySchema).min(2).max(20),
    transfers: z.array(transferSchema).min(1).max(1_000),
  })
  .strict()
  .superRefine((input, context) => {
    const partyIds = input.parties.map(({ clubId }) => clubId);
    const transferIds = input.transfers.map(({ transferId }) => transferId);
    const assetIds = input.transfers.map(({ assetId }) => assetId);
    if (new Set(partyIds).size !== partyIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['parties'],
        message: 'Trade parties must be unique.',
      });
    }
    if (
      new Set(transferIds).size !== transferIds.length ||
      new Set(assetIds).size !== assetIds.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['transfers'],
        message: 'Transfer and asset identities must be unique within the exchange.',
      });
    }
    const partySet = new Set(partyIds);
    input.transfers.forEach((transfer, index) => {
      if (
        !partySet.has(transfer.fromClubId) ||
        !partySet.has(transfer.toClubId) ||
        transfer.fromClubId === transfer.toClubId
      ) {
        context.addIssue({
          code: 'custom',
          path: ['transfers', index],
          message: 'Every transfer must connect two distinct declared trade parties.',
        });
      }
      if (transfer.resolution === 'unresolved') {
        context.addIssue({
          code: 'custom',
          path: ['transfers', index, 'resolution'],
          message: 'A complete trade assessment cannot value an unresolved asset.',
        });
      }
      if (
        transfer.atTradeSamples.length !== input.sampleCount ||
        transfer.currentSamples.length !== input.sampleCount
      ) {
        context.addIssue({
          code: 'custom',
          path: ['transfers', index],
          message: 'Every asset distribution must use the declared common joint sample count.',
        });
      }
    });
  });

export type CompleteAflTradeAssessmentInput = z.infer<typeof inputSchema>;

function quantile(sorted: readonly number[], probability: number): number {
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function summarize(samples: readonly number[]) {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    median: quantile(sorted, 0.5),
    p10: quantile(sorted, 0.1),
    p90: quantile(sorted, 0.9),
  };
}

function sumSamples(
  transfers: readonly z.infer<typeof transferSchema>[],
  sampleKind: 'atTradeSamples' | 'currentSamples',
  sampleCount: number
): number[] {
  const result = Array<number>(sampleCount).fill(0);
  transfers.forEach((transfer) => {
    transfer[sampleKind].forEach((value, index) => {
      result[index] += value;
    });
  });
  return result;
}

export function assessCompleteAflTrade(unparsedInput: CompleteAflTradeAssessmentInput) {
  const input = inputSchema.parse(unparsedInput);
  const parties = [...input.parties].sort((left, right) => left.clubId.localeCompare(right.clubId));
  const transfers = [...input.transfers].sort((left, right) =>
    left.transferId.localeCompare(right.transferId)
  );
  const distributions = parties.map((party) => {
    const received = transfers.filter(({ toClubId }) => toClubId === party.clubId);
    const givenUp = transfers.filter(({ fromClubId }) => fromClubId === party.clubId);
    const atTradeReceived = sumSamples(received, 'atTradeSamples', input.sampleCount);
    const atTradeGivenUp = sumSamples(givenUp, 'atTradeSamples', input.sampleCount);
    const currentReceived = sumSamples(received, 'currentSamples', input.sampleCount);
    const currentGivenUp = sumSamples(givenUp, 'currentSamples', input.sampleCount);
    return {
      party,
      received,
      givenUp,
      atTrade: {
        received: atTradeReceived,
        givenUp: atTradeGivenUp,
        net: atTradeReceived.map((value, index) => value - atTradeGivenUp[index]),
      },
      current: {
        received: currentReceived,
        givenUp: currentGivenUp,
        net: currentReceived.map((value, index) => value - currentGivenUp[index]),
      },
    };
  });

  const finishAhead = (partyIndex: number, kind: 'atTrade' | 'current'): number => {
    let share = 0;
    for (let sampleIndex = 0; sampleIndex < input.sampleCount; sampleIndex += 1) {
      const values = distributions.map((distribution) => distribution[kind].net[sampleIndex]);
      const maximum = Math.max(...values);
      const leaders = values
        .map((value, index) => ({ value, index }))
        .filter(({ value }) => value === maximum)
        .map(({ index }) => index);
      if (leaders.includes(partyIndex)) share += 1 / leaders.length;
    }
    return share / input.sampleCount;
  };

  const partyAssessments = distributions.map((distribution, partyIndex) => ({
    clubId: distribution.party.clubId,
    clubName: distribution.party.clubName,
    receivedAssets: distribution.received.map(
      ({ assetId, assetKind, displayLabel, resolution }) => ({
        assetId,
        assetKind,
        displayLabel,
        resolution,
      })
    ),
    givenUpAssets: distribution.givenUp.map(({ assetId, assetKind, displayLabel, resolution }) => ({
      assetId,
      assetKind,
      displayLabel,
      resolution,
    })),
    atTrade: {
      received: summarize(distribution.atTrade.received),
      givenUp: summarize(distribution.atTrade.givenUp),
      netAdvantage: summarize(distribution.atTrade.net),
      finishAheadProbability: finishAhead(partyIndex, 'atTrade'),
    },
    current: {
      received: summarize(distribution.current.received),
      givenUp: summarize(distribution.current.givenUp),
      netAdvantage: summarize(distribution.current.net),
      finishAheadProbability: finishAhead(partyIndex, 'current'),
    },
    calculationSummary:
      'Received value minus given-up value equals net advantage; finish-ahead probability compares that net result with every other party in the same simulated outcome.' as const,
  }));
  const highestProbability = Math.max(
    ...partyAssessments.map(({ atTrade }) => atTrade.finishAheadProbability)
  );
  const leaders = partyAssessments
    .filter(({ atTrade }) => atTrade.finishAheadProbability === highestProbability)
    .map(({ clubId }) => clubId);
  const verdict =
    leaders.length === 1
      ? ({ kind: 'favours_club', clubIds: leaders } as const)
      : ({ kind: 'shared_lead', clubIds: leaders } as const);
  const content = {
    schemaVersion: AFL_TRADE_COMPLETE_ASSESSMENT_SCHEMA_VERSION,
    tradeId: input.tradeId,
    valueUnit: input.valueUnit,
    modelVersion: input.modelVersion,
    sampleCount: input.sampleCount,
    definitions: {
      received: 'The total estimated contribution of every asset the club received.',
      givenUp: 'The total estimated contribution of every asset the club surrendered.',
      netAdvantage:
        'Received minus given-up value for the complete trade package; positive values favour the club and negative values indicate it surrendered more modeled value.',
      finishAheadProbability:
        'The share of joint model outcomes in which the club has the best net result; ties split that outcome equally.',
    },
    partyAssessments,
    verdict,
    assessedAt: input.assessedAt,
    publicationEligible: false as const,
  };
  return {
    assessmentId: createAflTradeContentAddress('complete-trade-assessment', content),
    content,
  };
}

const selectedLayerSchema = z.enum(['gross', 'listSpotAdjusted', 'scarcityAdjusted']);

const completeAssessmentValueSummarySchema = z
  .object({
    median: z.number().finite(),
    p10: z.number().finite(),
    p90: z.number().finite(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.p10 > value.median || value.median > value.p90) {
      context.addIssue({
        code: 'custom',
        path: [],
        message: 'Complete-assessment interval bounds must contain the median.',
      });
    }
  });

const completeAssessmentAssetSchema = z
  .object({
    assetId: z.string().trim().min(1).max(240),
    assetKind: z.enum(['player', 'pick', 'future_pick']),
    displayLabel: z.string().trim().min(1).max(500),
    resolution: z.enum(['resolved', 'linked_to_final_selection']),
  })
  .strict();

const completeAssessmentPartyViewSchema = z
  .object({
    view: z.enum(AFL_TRADE_COMPLETE_ASSESSMENT_VIEWS),
    received: completeAssessmentValueSummarySchema,
    givenUp: completeAssessmentValueSummarySchema,
    netAdvantage: completeAssessmentValueSummarySchema,
    finishAheadProbability: z.number().finite().min(0).max(1),
  })
  .strict();

const completeAssessmentPartySchema = z
  .object({
    clubId: z.string().trim().min(1).max(240),
    clubName: z.string().trim().min(1).max(240),
    receivedAssets: z.array(completeAssessmentAssetSchema).min(1).max(1_000),
    givenUpAssets: z.array(completeAssessmentAssetSchema).min(1).max(1_000),
    views: z
      .array(completeAssessmentPartyViewSchema)
      .length(AFL_TRADE_COMPLETE_ASSESSMENT_VIEWS.length),
    calculationSummary: z.literal(
      'Received value minus given-up value equals net advantage; finish-ahead probability compares that net result with every other party in the same weighted joint outcome.'
    ),
  })
  .strict()
  .superRefine((party, context) => {
    const views = party.views.map(({ view }) => view);
    if (views.some((view, index) => view !== AFL_TRADE_COMPLETE_ASSESSMENT_VIEWS[index])) {
      context.addIssue({
        code: 'custom',
        path: ['views'],
        message: 'Complete-assessment views must use canonical temporal order.',
      });
    }
    for (const assetKey of ['receivedAssets', 'givenUpAssets'] as const) {
      const assetIds = party[assetKey].map(({ assetId }) => assetId);
      if (
        new Set(assetIds).size !== assetIds.length ||
        assetIds.some((assetId, index) => assetId !== [...assetIds].sort()[index])
      ) {
        context.addIssue({
          code: 'custom',
          path: [assetKey],
          message: 'Complete-assessment assets must be unique and canonically ordered.',
        });
      }
    }
  });

const completeAssessmentViewVerdictSchema = z
  .object({
    view: z.enum(AFL_TRADE_COMPLETE_ASSESSMENT_VIEWS),
    kind: z.enum(['favours_club', 'shared_lead']),
    clubIds: z.array(z.string().trim().min(1).max(240)).min(1).max(18),
  })
  .strict()
  .superRefine((verdict, context) => {
    if (
      new Set(verdict.clubIds).size !== verdict.clubIds.length ||
      verdict.clubIds.some((clubId, index) => clubId !== [...verdict.clubIds].sort()[index]) ||
      (verdict.kind === 'favours_club' && verdict.clubIds.length !== 1) ||
      (verdict.kind === 'shared_lead' && verdict.clubIds.length < 2)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['clubIds'],
        message: 'View verdict leaders must match the verdict kind in canonical order.',
      });
    }
  });

export const aflTradeCompleteAssessmentV2ContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_COMPLETE_ASSESSMENT_V2_SCHEMA_VERSION),
    publicAssetBoundary: z.literal('source_native_afl_assets_no_user_or_fantasy_ownership'),
    calculationUnit: z.literal('complete_multi_party_received_minus_surrendered_exchange'),
    tradeId: z.string().trim().min(1).max(240),
    valueUnit: inputSchema.shape.valueUnit,
    modelVersion: z.string().trim().min(1).max(240),
    drawCount: z.number().int().min(2).max(100_000),
    probabilityMeasure: z.literal('valuation_calculation_draw_probability_weights'),
    source: z
      .object({
        archiveId: aflTradeContentAddressedIdSchema('public-factual-archive'),
        valuationCaseId: aflTradeContentAddressedIdSchema('valuation-case'),
        valuationCalculationId: aflTradeContentAddressedIdSchema('valuation-calculation'),
        selectedLayer: selectedLayerSchema,
      })
      .strict(),
    definitions: z
      .object({
        received: z.literal('The total modeled contribution of every asset the club received.'),
        givenUp: z.literal('The total modeled contribution of every asset the club surrendered.'),
        netAdvantage: z.literal(
          'Received minus given-up value for the complete directed trade package; positive values favour the club and negative values indicate it surrendered more modeled value.'
        ),
        finishAheadProbability: z.literal(
          'The weighted share of joint model outcomes in which the club has the best net result; ties split that outcome equally.'
        ),
      })
      .strict(),
    partyAssessments: z.array(completeAssessmentPartySchema).min(2).max(18),
    viewVerdicts: z
      .array(completeAssessmentViewVerdictSchema)
      .length(AFL_TRADE_COMPLETE_ASSESSMENT_VIEWS.length),
    assessedAt: instantSchema,
    publicationEligible: z.literal(false),
  })
  .strict()
  .superRefine((content, context) => {
    const partyIds = content.partyAssessments.map(({ clubId }) => clubId);
    if (
      new Set(partyIds).size !== partyIds.length ||
      partyIds.some((partyId, index) => partyId !== [...partyIds].sort()[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['partyAssessments'],
        message: 'Complete-assessment parties must be unique and canonically ordered.',
      });
    }
    const receivedAssets = content.partyAssessments.flatMap(({ receivedAssets }) => receivedAssets);
    const givenUpAssets = content.partyAssessments.flatMap(({ givenUpAssets }) => givenUpAssets);
    const receivedById = new Map(receivedAssets.map((asset) => [asset.assetId, asset] as const));
    const givenUpById = new Map(givenUpAssets.map((asset) => [asset.assetId, asset] as const));
    if (
      receivedById.size !== receivedAssets.length ||
      givenUpById.size !== givenUpAssets.length ||
      receivedById.size !== givenUpById.size ||
      [...receivedById].some(
        ([assetId, asset]) =>
          canonicalizeAflTradeJson(asset) !== canonicalizeAflTradeJson(givenUpById.get(assetId))
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['partyAssessments'],
        message: 'Every directed asset must appear exactly once as received and once as given up.',
      });
    }
    const verdictViews = content.viewVerdicts.map(({ view }) => view);
    if (verdictViews.some((view, index) => view !== AFL_TRADE_COMPLETE_ASSESSMENT_VIEWS[index])) {
      context.addIssue({
        code: 'custom',
        path: ['viewVerdicts'],
        message: 'Complete-assessment verdicts must use canonical temporal order.',
      });
    }
    AFL_TRADE_COMPLETE_ASSESSMENT_VIEWS.forEach((view, viewIndex) => {
      const probabilities = content.partyAssessments.map((party) =>
        party.views.find((candidate) => candidate.view === view)
      );
      if (probabilities.some((candidate) => candidate === undefined)) return;
      const total = probabilities.reduce(
        (sum, candidate) => sum + candidate!.finishAheadProbability,
        0
      );
      const maximum = Math.max(
        ...probabilities.map((candidate) => candidate!.finishAheadProbability)
      );
      const leaders = content.partyAssessments
        .filter(
          (_party, partyIndex) =>
            Math.abs(probabilities[partyIndex]!.finishAheadProbability - maximum) <= 1e-12
        )
        .map(({ clubId }) => clubId);
      const verdict = content.viewVerdicts[viewIndex];
      if (
        Math.abs(total - 1) > 1e-9 ||
        verdict === undefined ||
        verdict.view !== view ||
        canonicalizeAflTradeJson(verdict.clubIds) !== canonicalizeAflTradeJson(leaders) ||
        verdict.kind !== (leaders.length === 1 ? 'favours_club' : 'shared_lead')
      ) {
        context.addIssue({
          code: 'custom',
          path: ['viewVerdicts', viewIndex],
          message: 'View verdicts must authenticate the complete finish-ahead probability result.',
        });
      }
    });
  });

export const aflTradeCompleteAssessmentV2Schema = z
  .object({
    assessmentId: aflTradeContentAddressedIdSchema('complete-trade-assessment'),
    content: aflTradeCompleteAssessmentV2ContentSchema,
  })
  .strict()
  .superRefine((assessment, context) => {
    addAflTradeContentAddressIssue(
      'complete-trade-assessment',
      assessment.assessmentId,
      assessment.content,
      context,
      ['assessmentId']
    );
  });

export type AflTradeCompleteAssessmentV2 = z.infer<typeof aflTradeCompleteAssessmentV2Schema>;

export interface AuthenticatedCompleteAflTradeAssessmentInput {
  archive: AflTradePromotionBackedPublicArchive;
  valuationCase: AflTradeValuationCase;
  lineageGraph: AflTradeLineageGraph;
  componentDrawSet: AflTradeComponentDrawSet;
  realizedContributionLedger: AflTradeRealizedContributionLedger;
  packagePolicy: AflTradePackagePolicy;
  valuationCalculation: AflTradeValuationCalculation;
  selectedLayer: z.infer<typeof selectedLayerSchema>;
  valueUnit: CompleteAflTradeAssessmentInput['valueUnit'];
  assessedAt: string;
}

type ArchiveRecord = AflTradePromotionBackedPublicArchive['content']['records'][number]['record'];
type TransactionRecord = Extract<ArchiveRecord, { recordKind: 'transaction' }>;
type TransferRecord = Extract<ArchiveRecord, { recordKind: 'transfer' }>;
type DraftSelectionRecord = Extract<ArchiveRecord, { recordKind: 'draft_selection' }>;
type PickRealizationRecord = Extract<ArchiveRecord, { recordKind: 'pick_realization' }>;
type SelectedLayer = z.infer<typeof selectedLayerSchema>;
type CompleteAssessmentView = (typeof AFL_TRADE_COMPLETE_ASSESSMENT_VIEWS)[number];

interface WeightedValue {
  drawKey: string;
  probabilityWeight: number;
  value: number;
}

interface AuthenticatedTransfer {
  transferId: string;
  fromClubId: string;
  toClubId: string;
  assetId: string;
  assetKind: 'player' | 'pick' | 'future_pick';
  displayLabel: string;
  resolution: 'resolved' | 'linked_to_final_selection';
  values: Record<CompleteAssessmentView, WeightedValue[]>;
}

function exactStringSet(left: readonly string[], right: readonly string[]): boolean {
  const orderedLeft = [...left].sort();
  const orderedRight = [...right].sort();
  return (
    orderedLeft.length === orderedRight.length &&
    orderedLeft.every((value, index) => value === orderedRight[index])
  );
}

function weightedQuantile(values: readonly WeightedValue[], probability: number): number {
  const ordered = [...values].sort(
    (left, right) => left.value - right.value || left.drawKey.localeCompare(right.drawKey)
  );
  const totalWeight = ordered.reduce((sum, value) => sum + value.probabilityWeight, 0);
  const threshold = probability * totalWeight;
  let cumulative = 0;
  for (const value of ordered) {
    cumulative += value.probabilityWeight;
    if (cumulative + 1e-12 >= threshold) return value.value;
  }
  return ordered.at(-1)!.value;
}

function summarizeWeighted(values: readonly WeightedValue[]) {
  return {
    median: weightedQuantile(values, 0.5),
    p10: weightedQuantile(values, 0.1),
    p90: weightedQuantile(values, 0.9),
  };
}

function sumWeightedTransfers(
  transfers: readonly AuthenticatedTransfer[],
  view: CompleteAssessmentView,
  draws: readonly AflTradeValuationCalculation['content']['draws'][number][]
): WeightedValue[] {
  return draws.map((draw, drawIndex) => ({
    drawKey: draw.drawKey,
    probabilityWeight: draw.probabilityWeight,
    value: transfers.reduce((sum, transfer) => sum + transfer.values[view][drawIndex]!.value, 0),
  }));
}

function subtractWeighted(
  received: readonly WeightedValue[],
  surrendered: readonly WeightedValue[]
): WeightedValue[] {
  return received.map((value, index) => ({
    ...value,
    value: value.value - surrendered[index]!.value,
  }));
}

function selectedTransaction(
  records: readonly ArchiveRecord[],
  tradeId: string
): TransactionRecord {
  const matches = records.filter(
    (record): record is TransactionRecord =>
      record.recordKind === 'transaction' && record.eventId === tradeId
  );
  if (matches.length !== 1) {
    throw new RangeError('Authenticated assessment requires one exact factual transaction.');
  }
  return matches[0]!;
}

function assetKindFor(transfer: TransferRecord): AuthenticatedTransfer['assetKind'] {
  if (transfer.assetKind === 'player') return 'player';
  if (transfer.assetKind === 'current_pick') return 'pick';
  if (transfer.assetKind === 'future_pick') return 'future_pick';
  throw new RangeError('A complete assessment cannot include unsupported consideration.');
}

function pickSelectionFor(
  transfer: TransferRecord,
  records: readonly ArchiveRecord[]
): DraftSelectionRecord | null {
  if (transfer.pick === null) return null;
  const realization = records.find(
    (record): record is PickRealizationRecord =>
      record.recordKind === 'pick_realization' &&
      record.transferAssetVersionId === transfer.assetVersionId &&
      record.pickId === transfer.pick!.pickId
  );
  if (realization === undefined) return null;
  const selection = records.find(
    (record): record is DraftSelectionRecord =>
      record.recordKind === 'draft_selection' &&
      record.selectionId === realization.draftSelectionId &&
      record.pickId === transfer.pick!.pickId
  );
  if (selection === undefined) {
    throw new RangeError('A pick realization must resolve to its exact factual draft selection.');
  }
  return selection;
}

function transferLabel(transfer: TransferRecord, selection: DraftSelectionRecord | null): string {
  if (transfer.player !== null) return transfer.player.displayName;
  if (selection === null) return transfer.rawDescription;
  const nominal = transfer.pick?.nominalPick;
  const prefix = nominal === null || nominal === undefined ? 'Draft pick' : `Pick ${nominal}`;
  return `${prefix} → ${selection.player.displayName} (selected at ${selection.selectionNumber})`;
}

function rootValue(
  calculation: AflTradeValuationCalculation,
  drawIndex: number,
  receivingClubId: string,
  assetId: string,
  view: CompleteAssessmentView,
  layer: SelectedLayer
): number {
  const party = calculation.content.draws[drawIndex]!.parties.find(
    ({ aflClubId }) => aflClubId === receivingClubId
  );
  const root = party?.views
    .find((candidate) => candidate.view === view)
    ?.roots.find((candidate) => candidate.assetId === assetId);
  if (root?.universal.status !== 'available') {
    throw new RangeError('Every assessed transfer requires an available exact root value.');
  }
  return root.universal.layers[layer];
}

function authenticateAssessmentParents(input: AuthenticatedCompleteAflTradeAssessmentInput): {
  archive: AflTradePromotionBackedPublicArchive;
  valuationCase: AflTradeValuationCase;
  calculation: AflTradeValuationCalculation;
} {
  const archive = aflTradePromotionBackedPublicArchiveSchema.parse(input.archive);
  const valuationCase = aflTradeValuationCaseSchema.parse(input.valuationCase);
  const calculation = aflTradeValuationCalculationSchema.parse(input.valuationCalculation);
  const expectedCase = materializeAflTradeValuationCase({
    archive,
    tradeId: valuationCase.content.tradeId,
    lineageGraph: input.lineageGraph,
    componentDrawSet: input.componentDrawSet,
    realizedContributionLedger: input.realizedContributionLedger,
    packagePolicy: input.packagePolicy,
    viewContexts: valuationCase.content.viewContexts,
  });
  if (canonicalizeAflTradeJson(expectedCase) !== canonicalizeAflTradeJson(valuationCase)) {
    throw new RangeError(
      'The valuation case is not the exact materialization of the factual trade.'
    );
  }
  const expectedCalculation = calculateAflTradeValuation(
    valuationCase,
    input.componentDrawSet,
    input.realizedContributionLedger,
    input.packagePolicy
  );
  if (canonicalizeAflTradeJson(expectedCalculation) !== canonicalizeAflTradeJson(calculation)) {
    throw new RangeError(
      'The valuation calculation is not the exact replay of its governed inputs.'
    );
  }
  return { archive, valuationCase, calculation };
}

/**
 * Derives complete-exchange results from authenticated factual direction and replayed valuation
 * artifacts. Unlike the legacy preview helper above, callers cannot supply transfer samples.
 */
export function assessAuthenticatedCompleteAflTrade(
  input: AuthenticatedCompleteAflTradeAssessmentInput
): AflTradeCompleteAssessmentV2 {
  const selectedLayer = selectedLayerSchema.parse(input.selectedLayer);
  const valueUnit = inputSchema.shape.valueUnit.parse(input.valueUnit);
  const assessedAt = instantSchema.parse(input.assessedAt);
  const { archive, valuationCase, calculation } = authenticateAssessmentParents(input);
  if (valueUnit.valueUnitId !== valuationCase.content.valueUnitId) {
    throw new RangeError('Assessment and valuation artifacts must use one exact value unit.');
  }
  if (
    valuationCase.content.viewContexts.some(
      ({ valuationAsOf }) => Date.parse(valuationAsOf) > Date.parse(assessedAt)
    )
  ) {
    throw new RangeError('Assessment custody time cannot predate the valuation evidence.');
  }

  const records = archive.content.records.map(({ record }) => record);
  const transaction = selectedTransaction(records, valuationCase.content.tradeId);
  const transfers = records.filter(
    (record): record is TransferRecord =>
      record.recordKind === 'transfer' && record.eventVersionId === transaction.eventVersionId
  );
  const roots = valuationCase.content.parties.flatMap(
    ({ receivedRootAssetIds }) => receivedRootAssetIds
  );
  if (
    !exactStringSet(
      transfers.map(({ assetVersionId }) => assetVersionId),
      roots
    )
  ) {
    throw new RangeError('Assessment transfers must equal the complete valuation-case root set.');
  }
  const partyById = new Map(
    valuationCase.content.parties.map((party) => [party.aflClubId, party] as const)
  );
  const receivingClubByAsset = new Map(
    valuationCase.content.parties.flatMap((party) =>
      party.receivedRootAssetIds.map((assetId) => [assetId, party.aflClubId] as const)
    )
  );
  const authenticatedTransfers: AuthenticatedTransfer[] = transfers
    .map((transfer) => {
      if (
        !partyById.has(transfer.fromClub.clubId) ||
        !partyById.has(transfer.toClub.clubId) ||
        receivingClubByAsset.get(transfer.assetVersionId) !== transfer.toClub.clubId
      ) {
        throw new RangeError(
          'Every directed transfer must connect and match declared trade parties.'
        );
      }
      const selection = pickSelectionFor(transfer, records);
      const values = Object.fromEntries(
        AFL_TRADE_COMPLETE_ASSESSMENT_VIEWS.map((view) => [
          view,
          calculation.content.draws.map((draw, drawIndex) => ({
            drawKey: draw.drawKey,
            probabilityWeight: draw.probabilityWeight,
            value: rootValue(
              calculation,
              drawIndex,
              transfer.toClub.clubId,
              transfer.assetVersionId,
              view,
              selectedLayer
            ),
          })),
        ])
      ) as Record<CompleteAssessmentView, WeightedValue[]>;
      return {
        transferId: transfer.recordId,
        fromClubId: transfer.fromClub.clubId,
        toClubId: transfer.toClub.clubId,
        assetId: transfer.assetVersionId,
        assetKind: assetKindFor(transfer),
        displayLabel: transferLabel(transfer, selection),
        resolution:
          selection === null ? ('resolved' as const) : ('linked_to_final_selection' as const),
        values,
      };
    })
    .sort((left, right) => left.transferId.localeCompare(right.transferId));

  const distributions = [...valuationCase.content.parties]
    .sort((left, right) => left.aflClubId.localeCompare(right.aflClubId))
    .map((party) => {
      const received = authenticatedTransfers.filter(
        ({ toClubId }) => toClubId === party.aflClubId
      );
      const surrendered = authenticatedTransfers.filter(
        ({ fromClubId }) => fromClubId === party.aflClubId
      );
      if (received.length === 0 || surrendered.length === 0) {
        throw new RangeError('Every complete-exchange party must receive and surrender value.');
      }
      return {
        party,
        received,
        surrendered,
        views: Object.fromEntries(
          AFL_TRADE_COMPLETE_ASSESSMENT_VIEWS.map((view) => {
            const receivedValues = sumWeightedTransfers(received, view, calculation.content.draws);
            const surrenderedValues = sumWeightedTransfers(
              surrendered,
              view,
              calculation.content.draws
            );
            return [
              view,
              {
                received: receivedValues,
                surrendered: surrenderedValues,
                net: subtractWeighted(receivedValues, surrenderedValues),
              },
            ];
          })
        ) as Record<
          CompleteAssessmentView,
          {
            received: WeightedValue[];
            surrendered: WeightedValue[];
            net: WeightedValue[];
          }
        >,
      };
    });

  const finishAhead = (partyIndex: number, view: CompleteAssessmentView) => {
    let probability = 0;
    calculation.content.draws.forEach((draw, drawIndex) => {
      const values = distributions.map(
        (distribution) => distribution.views[view].net[drawIndex]!.value
      );
      const maximum = Math.max(...values);
      const leaders = values
        .map((value, index) => ({ value, index }))
        .filter(({ value }) => Math.abs(value - maximum) <= 1e-12)
        .map(({ index }) => index);
      if (leaders.includes(partyIndex)) probability += draw.probabilityWeight / leaders.length;
    });
    return probability;
  };

  const partyAssessments = distributions.map((distribution, partyIndex) => ({
    clubId: distribution.party.aflClubId,
    clubName: distribution.party.clubName,
    receivedAssets: distribution.received.map(
      ({ assetId, assetKind, displayLabel, resolution }) => ({
        assetId,
        assetKind,
        displayLabel,
        resolution,
      })
    ),
    givenUpAssets: distribution.surrendered.map(
      ({ assetId, assetKind, displayLabel, resolution }) => ({
        assetId,
        assetKind,
        displayLabel,
        resolution,
      })
    ),
    views: AFL_TRADE_COMPLETE_ASSESSMENT_VIEWS.map((view) => ({
      view,
      received: summarizeWeighted(distribution.views[view].received),
      givenUp: summarizeWeighted(distribution.views[view].surrendered),
      netAdvantage: summarizeWeighted(distribution.views[view].net),
      finishAheadProbability: finishAhead(partyIndex, view),
    })),
    calculationSummary:
      'Received value minus given-up value equals net advantage; finish-ahead probability compares that net result with every other party in the same weighted joint outcome.' as const,
  }));
  const viewVerdicts = AFL_TRADE_COMPLETE_ASSESSMENT_VIEWS.map((view) => {
    const probabilities = partyAssessments.map(
      (party) => party.views.find((candidate) => candidate.view === view)!.finishAheadProbability
    );
    const highestProbability = Math.max(...probabilities);
    const leaders = partyAssessments
      .filter(
        (_party, partyIndex) => Math.abs(probabilities[partyIndex]! - highestProbability) <= 1e-12
      )
      .map(({ clubId }) => clubId);
    return {
      view,
      kind: leaders.length === 1 ? ('favours_club' as const) : ('shared_lead' as const),
      clubIds: leaders,
    };
  });
  const content = {
    schemaVersion: AFL_TRADE_COMPLETE_ASSESSMENT_V2_SCHEMA_VERSION,
    publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership' as const,
    calculationUnit: 'complete_multi_party_received_minus_surrendered_exchange' as const,
    tradeId: valuationCase.content.tradeId,
    valueUnit,
    modelVersion: valuationCase.content.valuationBundleId,
    drawCount: calculation.content.draws.length,
    probabilityMeasure: 'valuation_calculation_draw_probability_weights' as const,
    source: {
      archiveId: archive.archiveId,
      valuationCaseId: valuationCase.valuationCaseId,
      valuationCalculationId: calculation.valuationCalculationId,
      selectedLayer,
    },
    definitions: {
      received: 'The total modeled contribution of every asset the club received.',
      givenUp: 'The total modeled contribution of every asset the club surrendered.',
      netAdvantage:
        'Received minus given-up value for the complete directed trade package; positive values favour the club and negative values indicate it surrendered more modeled value.',
      finishAheadProbability:
        'The weighted share of joint model outcomes in which the club has the best net result; ties split that outcome equally.',
    },
    partyAssessments,
    viewVerdicts,
    assessedAt,
    publicationEligible: false as const,
  };
  return aflTradeCompleteAssessmentV2Schema.parse({
    assessmentId: createAflTradeContentAddress('complete-trade-assessment', content),
    content,
  });
}

export interface AflTradeCompleteAssessmentV2VerificationInput {
  assessmentInput: AuthenticatedCompleteAflTradeAssessmentInput;
  output: AflTradeCompleteAssessmentV2;
}

export function verifyAflTradeCompleteAssessmentV2(
  unparsedVerification: AflTradeCompleteAssessmentV2VerificationInput
): boolean {
  try {
    const verification = structuredClone(unparsedVerification);
    const output = aflTradeCompleteAssessmentV2Schema.parse(verification.output);
    const replay = assessAuthenticatedCompleteAflTrade(verification.assessmentInput);
    return canonicalizeAflTradeJson(replay) === canonicalizeAflTradeJson(output);
  } catch {
    return false;
  }
}
