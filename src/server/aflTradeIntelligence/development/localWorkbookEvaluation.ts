import 'server-only';

import { basename } from 'node:path';

import {
  getDevelopmentWorkbookDraftTradeReadRepository,
  getDevelopmentWorkbookStatlyTradeEvaluationValues,
  getDevelopmentWorkbookStatlyTradeValues,
  isDevelopmentWorkbookDraftTradeReadEnabled,
  type DevelopmentWorkbookDraftTradeEnvironment,
  type DraftTradeReadRepository,
} from '@/lib/draftTrades/developmentWorkbook';
import type { DraftTradeDetail, DraftTradeListItem } from '@/lib/draftTrades/read';
import type {
  AflTradeDevelopmentWorkbookAssetLink,
  AflTradeDevelopmentWorkbookValueProjection,
} from '@/server/aflTradeIntelligence/modeling/developmentWorkbookValueProjection';
import type { AflTradeDevelopmentTradeValueResult } from '@/server/aflTradeIntelligence/modeling/developmentTradeGradeModel';

import { createAflTradeContentAddress } from '../artifacts/contentAddress';
import {
  prepareLocalWorkbookSyntheticValuation,
  type LocalWorkbookSyntheticValuationPreparation,
} from './localWorkbookSyntheticValuation';

const CALCULATION_BATCH_SIZE = 100;
const LOCAL_SCENARIO_ASSESSED_AT = '2026-08-15T00:00:00.000Z';
const assetStates = [
  'valued',
  'right_censored',
  'outcome_unresolved',
  'lineage_unresolved',
  'insufficient_cohort',
] as const;

type AssetState = (typeof assetStates)[number];
type CalculationAvailability =
  AflTradeDevelopmentTradeValueResult['summaries']['at_trade']['availability'];

export type LocalWorkbookEvaluationEnvironment = DevelopmentWorkbookDraftTradeEnvironment;

export interface LocalWorkbookEvaluationDependencies {
  loadRepository(
    environment: LocalWorkbookEvaluationEnvironment
  ): Promise<DraftTradeReadRepository | null>;
  loadValues(
    tradeIds: readonly string[],
    environment: LocalWorkbookEvaluationEnvironment
  ): Promise<AflTradeDevelopmentWorkbookValueProjection | null>;
  loadArchiveValues?(
    tradeIds: readonly string[],
    environment: LocalWorkbookEvaluationEnvironment
  ): Promise<AflTradeDevelopmentWorkbookValueProjection | null>;
  prepareScenario?: typeof prepareLocalWorkbookSyntheticValuation;
}

export interface LocalWorkbookEvaluationInputIdentity {
  originalFilename: string;
  sha256: string;
  productionAuthority: 'none';
  publicationAuthority: 'none';
}

export interface LocalWorkbookEvaluationBatchSummary {
  totalTrades: number;
  processedTrades: number;
  availableTrades: number;
  partialTrades: number;
  unresolvedTrades: number;
  assetStates: Readonly<Record<AssetState, number>>;
  datasetId: string;
  modelId: string;
  scenarioReadyTrades: number;
  scenarioUnavailableTrades: number;
}

export interface LocalWorkbookEvaluationArchiveItem {
  trade: DraftTradeListItem;
  calculation: {
    calculationId: string;
    availability: CalculationAvailability;
  };
  scenario: LocalWorkbookSyntheticValuationPreparation;
}

export interface LocalWorkbookEvaluationArchive {
  input: LocalWorkbookEvaluationInputIdentity;
  years: readonly number[];
  year: number;
  trades: readonly LocalWorkbookEvaluationArchiveItem[];
  batch: LocalWorkbookEvaluationBatchSummary;
  publicationEligible: false;
}

export interface LocalWorkbookTradeEvaluation {
  input: LocalWorkbookEvaluationInputIdentity;
  detail: DraftTradeDetail;
  calculation: AflTradeDevelopmentTradeValueResult;
  links: readonly AflTradeDevelopmentWorkbookAssetLink[];
  model: AflTradeDevelopmentWorkbookValueProjection['model'];
  scenario: LocalWorkbookSyntheticValuationPreparation;
  publicationEligible: false;
}

export interface LocalWorkbookEvaluationService {
  loadArchive(
    input: {
      year: number | null;
      clubSlug?: string;
      type?: 'player' | 'pick' | 'future_pick';
      q?: string;
    },
    environment?: LocalWorkbookEvaluationEnvironment
  ): Promise<LocalWorkbookEvaluationArchive | null>;
  loadTrade(
    tradeId: string,
    environment?: LocalWorkbookEvaluationEnvironment
  ): Promise<LocalWorkbookTradeEvaluation | null>;
}

function inputIdentity(
  environment: LocalWorkbookEvaluationEnvironment
): LocalWorkbookEvaluationInputIdentity {
  const workbookPath = environment.AFL_OUTCOMES_DEV_WORKBOOK_PATH?.trim();
  const sha256 = environment.AFL_OUTCOMES_DEV_WORKBOOK_SHA256?.trim().toLowerCase();
  if (!workbookPath) {
    throw new Error('AFL_OUTCOMES_DEV_WORKBOOK_PATH is required for local workbook evaluation.');
  }
  if (!sha256 || !/^[a-f0-9]{64}$/u.test(sha256)) {
    throw new Error(
      'AFL_OUTCOMES_DEV_WORKBOOK_SHA256 must pin the local workbook with a SHA-256 digest.'
    );
  }
  return {
    originalFilename: basename(workbookPath),
    sha256,
    productionAuthority: 'none',
    publicationAuthority: 'none',
  };
}

function emptyAssetStateCounts(): Record<AssetState, number> {
  return Object.fromEntries(assetStates.map((state) => [state, 0])) as Record<AssetState, number>;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    result.push(items.slice(offset, offset + size));
  }
  return result;
}

function assertProjectionIdentity(
  current: { datasetId: string; modelId: string } | null,
  projection: AflTradeDevelopmentWorkbookValueProjection
): { datasetId: string; modelId: string } {
  const next = { datasetId: projection.datasetId, modelId: projection.model.modelId };
  if (
    current !== null &&
    (current.datasetId !== next.datasetId || current.modelId !== next.modelId)
  ) {
    throw new Error('Local workbook calculation batches resolved different dataset or model ids.');
  }
  return next;
}

async function calculateAll(
  dependencies: LocalWorkbookEvaluationDependencies,
  trades: readonly DraftTradeListItem[],
  environment: LocalWorkbookEvaluationEnvironment
) {
  const valuesByTradeId = new Map<string, AflTradeDevelopmentTradeValueResult>();
  const linksByTradeId = new Map<string, readonly AflTradeDevelopmentWorkbookAssetLink[]>();
  let identity: { datasetId: string; modelId: string } | null = null;
  const calculationBatches = dependencies.loadArchiveValues
    ? [trades]
    : chunks(trades, CALCULATION_BATCH_SIZE);
  const loadValues = dependencies.loadArchiveValues ?? dependencies.loadValues;

  for (const batch of calculationBatches) {
    const projection = await loadValues(
      batch.map(({ tradeId }) => tradeId),
      environment
    );
    if (projection === null) {
      throw new Error('Local workbook values became unavailable during an evaluation run.');
    }
    identity = assertProjectionIdentity(identity, projection);
    for (const [tradeId, calculation] of projection.valuesByTradeId) {
      if (valuesByTradeId.has(tradeId)) {
        throw new Error(`Local workbook trade ${tradeId} was calculated more than once.`);
      }
      valuesByTradeId.set(tradeId, calculation);
      linksByTradeId.set(tradeId, projection.linksByTradeId.get(tradeId) ?? []);
    }
  }

  if (valuesByTradeId.size !== trades.length || identity === null) {
    throw new Error(
      `Local workbook evaluation processed ${valuesByTradeId.size} of ${trades.length} trades.`
    );
  }
  return { valuesByTradeId, linksByTradeId, identity };
}

function summarizeBatch(
  totalTrades: number,
  calculations: ReadonlyMap<string, AflTradeDevelopmentTradeValueResult>,
  identity: { datasetId: string; modelId: string },
  scenarios: ReadonlyMap<string, LocalWorkbookSyntheticValuationPreparation>
): LocalWorkbookEvaluationBatchSummary {
  const counts = {
    availableTrades: 0,
    partialTrades: 0,
    unresolvedTrades: 0,
  };
  const stateCounts = emptyAssetStateCounts();
  for (const calculation of calculations.values()) {
    const availability = calculation.summaries.at_trade.availability;
    if (availability === 'available') counts.availableTrades += 1;
    else if (availability === 'available_partial') counts.partialTrades += 1;
    else counts.unresolvedTrades += 1;
    for (const asset of calculation.assets) stateCounts[asset.state] += 1;
  }
  return {
    totalTrades,
    processedTrades: calculations.size,
    ...counts,
    assetStates: stateCounts,
    ...identity,
    scenarioReadyTrades: [...scenarios.values()].filter(({ state }) => state === 'ready').length,
    scenarioUnavailableTrades: [...scenarios.values()].filter(
      ({ state }) => state === 'unavailable'
    ).length,
  };
}

function localScenarioBundleId(workbookSha256: string): string {
  return createAflTradeContentAddress('valuation-bundle', {
    schemaVersion: 'local-workbook-synthetic-valuation-bundle/v1',
    workbookSha256,
    evidenceClassification: 'fabricated_test_evidence_not_real_afl_data',
  });
}

async function prepareScenarios(
  dependencies: LocalWorkbookEvaluationDependencies,
  repository: DraftTradeReadRepository,
  trades: readonly DraftTradeListItem[],
  environment: LocalWorkbookEvaluationEnvironment,
  scenarioCache: Map<string, LocalWorkbookSyntheticValuationPreparation>
) {
  const workbookSha256 = inputIdentity(environment).sha256;
  const valuationBundleId = localScenarioBundleId(workbookSha256);
  const prepareScenario = dependencies.prepareScenario ?? prepareLocalWorkbookSyntheticValuation;
  const entries = await Promise.all(
    trades.map(async (trade) => {
      const cacheKey = `${workbookSha256}\0${trade.tradeId}\0${valuationBundleId}\0${LOCAL_SCENARIO_ASSESSED_AT}`;
      const cached = scenarioCache.get(cacheKey);
      if (cached) return [trade.tradeId, cached] as const;
      const detail = await repository.getById(trade.tradeId);
      if (detail === null) {
        throw new Error(`Local workbook trade ${trade.tradeId} has no detail projection.`);
      }
      const prepared = prepareScenario({
        environment: 'test_fixture',
        trade: detail,
        workbookSha256,
        valuationBundleId,
        scenario: 'baseline',
        assessedAt: LOCAL_SCENARIO_ASSESSED_AT,
      });
      scenarioCache.set(cacheKey, prepared);
      return [trade.tradeId, prepared] as const;
    })
  );
  return new Map(entries);
}

async function requireRepository(
  dependencies: LocalWorkbookEvaluationDependencies,
  environment: LocalWorkbookEvaluationEnvironment
): Promise<DraftTradeReadRepository | null> {
  if (!isDevelopmentWorkbookDraftTradeReadEnabled(environment)) return null;
  const repository = await dependencies.loadRepository(environment);
  if (repository === null) {
    throw new Error('Local workbook evaluation is enabled but its repository is unavailable.');
  }
  return repository;
}

export function createLocalWorkbookEvaluationService(
  dependencies: LocalWorkbookEvaluationDependencies = {
    loadRepository: getDevelopmentWorkbookDraftTradeReadRepository,
    loadValues: getDevelopmentWorkbookStatlyTradeValues,
    loadArchiveValues: getDevelopmentWorkbookStatlyTradeEvaluationValues,
  }
): LocalWorkbookEvaluationService {
  const scenarioCache = new Map<string, LocalWorkbookSyntheticValuationPreparation>();
  return {
    async loadArchive(input, environment = process.env) {
      const repository = await requireRepository(dependencies, environment);
      if (repository === null) return null;
      const years = await repository.listYears();
      const selectedYear =
        input.year !== null && years.includes(input.year) ? input.year : years[0];
      if (selectedYear === undefined) {
        throw new Error('The local workbook contains no trade years to evaluate.');
      }
      const allTradesByYear = await Promise.all(
        years.map((year) => repository.listTradesByYear(year))
      );
      const allTrades = allTradesByYear.flat();
      const selectedYearTrades = allTradesByYear[years.indexOf(selectedYear)] ?? [];
      const calculations = await calculateAll(dependencies, selectedYearTrades, environment);
      const scenarios = await prepareScenarios(
        dependencies,
        repository,
        selectedYearTrades,
        environment,
        scenarioCache
      );
      const selectedTrades = await repository.listTradesByYear(selectedYear, {
        clubSlug: input.clubSlug,
        type: input.type,
        q: input.q,
      });
      return {
        input: inputIdentity(environment),
        years,
        year: selectedYear,
        trades: selectedTrades.map((trade) => {
          const calculation = calculations.valuesByTradeId.get(trade.tradeId);
          if (!calculation) {
            throw new Error(`Local workbook trade ${trade.tradeId} has no calculation result.`);
          }
          return {
            trade,
            calculation: {
              calculationId: calculation.calculationId,
              availability: calculation.summaries.at_trade.availability,
            },
            scenario: scenarios.get(trade.tradeId)!,
          };
        }),
        batch: summarizeBatch(
          allTrades.length,
          calculations.valuesByTradeId,
          calculations.identity,
          scenarios
        ),
        publicationEligible: false,
      };
    },

    async loadTrade(tradeId, environment = process.env) {
      const repository = await requireRepository(dependencies, environment);
      if (repository === null) return null;
      const detail = await repository.getById(tradeId);
      if (detail === null) return null;
      const projection = await dependencies.loadValues([tradeId], environment);
      if (projection === null) {
        throw new Error('Local workbook values became unavailable during a trade calculation.');
      }
      const calculation = projection.valuesByTradeId.get(tradeId);
      if (!calculation) {
        throw new Error(`Local workbook trade ${tradeId} has no calculation result.`);
      }
      const scenario = (
        await prepareScenarios(dependencies, repository, [detail.trade], environment, scenarioCache)
      ).get(tradeId)!;
      return {
        input: inputIdentity(environment),
        detail,
        calculation,
        links: projection.linksByTradeId.get(tradeId) ?? [],
        model: projection.model,
        scenario,
        publicationEligible: false,
      };
    },
  };
}

export const localWorkbookEvaluationService = createLocalWorkbookEvaluationService();
