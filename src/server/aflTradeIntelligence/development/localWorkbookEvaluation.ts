import 'server-only';

import { basename } from 'node:path';

import {
  getDevelopmentWorkbookDraftTradeReadRepository,
  isDevelopmentWorkbookDraftTradeReadEnabled,
  type DevelopmentWorkbookDraftTradeEnvironment,
  type DraftTradeReadRepository,
} from '@/lib/draftTrades/developmentWorkbook';
import type { DraftTradeDetail, DraftTradeListItem } from '@/lib/draftTrades/read';

import { createAflTradeContentAddress } from '../artifacts/contentAddress';
import type { LocalAflTradeValuationReadiness } from './localAflTradeValuationReadiness';
import type { LocalPrivateReviewedTradeCalculation } from './localPrivateReviewedTradeCalculation';
import {
  prepareLocalWorkbookSyntheticValuation,
  type LocalWorkbookSyntheticValuationPreparation,
} from './localWorkbookSyntheticValuation';

const LOCAL_SCENARIO_ASSESSED_AT = '2026-08-15T00:00:00.000Z';

export type LocalWorkbookEvaluationEnvironment = DevelopmentWorkbookDraftTradeEnvironment;
export type LocalWorkbookValuationReadinessInspector = (
  scopeKey: string
) => Promise<LocalAflTradeValuationReadiness>;
export type LocalWorkbookPrivateCalculationLoader = (
  detail: DraftTradeDetail,
  workbookSha256: string
) => Promise<LocalPrivateReviewedTradeCalculation | null>;

export interface LocalWorkbookEvaluationDependencies {
  loadRepository(
    environment: LocalWorkbookEvaluationEnvironment
  ): Promise<DraftTradeReadRepository | null>;
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
  selectedYearTrades: number;
  scenarioReadyTrades: number;
  scenarioUnavailableTrades: number;
}

export interface LocalWorkbookEvaluationArchiveItem {
  trade: DraftTradeListItem;
  scenario: LocalWorkbookSyntheticValuationPreparation;
}

export interface LocalWorkbookBlockedNumericalEvaluation {
  state: 'blocked';
  readiness: LocalAflTradeValuationReadiness;
}

export interface LocalWorkbookPartialNumericalEvaluation {
  state: 'partial';
  readiness: LocalAflTradeValuationReadiness;
  calculation: LocalPrivateReviewedTradeCalculation;
}

export interface LocalWorkbookEvaluationArchive {
  input: LocalWorkbookEvaluationInputIdentity;
  years: readonly number[];
  year: number;
  trades: readonly LocalWorkbookEvaluationArchiveItem[];
  batch: LocalWorkbookEvaluationBatchSummary;
  numericalEvaluation: LocalWorkbookBlockedNumericalEvaluation;
  publicationEligible: false;
}

export interface LocalWorkbookTradeEvaluation {
  input: LocalWorkbookEvaluationInputIdentity;
  detail: DraftTradeDetail;
  scenario: LocalWorkbookSyntheticValuationPreparation;
  numericalEvaluation:
    | LocalWorkbookBlockedNumericalEvaluation
    | LocalWorkbookPartialNumericalEvaluation;
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
    environment: LocalWorkbookEvaluationEnvironment,
    inspectValuationReadiness: LocalWorkbookValuationReadinessInspector
  ): Promise<LocalWorkbookEvaluationArchive | null>;
  loadTrade(
    tradeId: string,
    environment: LocalWorkbookEvaluationEnvironment,
    inspectValuationReadiness: LocalWorkbookValuationReadinessInspector,
    loadPrivateCalculation?: LocalWorkbookPrivateCalculationLoader
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

function summarizeBatch(
  totalTrades: number,
  selectedYearTrades: number,
  scenarios: ReadonlyMap<string, LocalWorkbookSyntheticValuationPreparation>
): LocalWorkbookEvaluationBatchSummary {
  return {
    totalTrades,
    selectedYearTrades,
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
  }
): LocalWorkbookEvaluationService {
  const scenarioCache = new Map<string, LocalWorkbookSyntheticValuationPreparation>();
  return {
    async loadArchive(input, environment, inspectValuationReadiness) {
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
      const readiness = await inspectValuationReadiness(`afl-men:${selectedYear}-trades`);
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
        trades: selectedTrades.map((trade) => ({
          trade,
          scenario: scenarios.get(trade.tradeId)!,
        })),
        batch: summarizeBatch(allTrades.length, selectedYearTrades.length, scenarios),
        numericalEvaluation: { state: 'blocked', readiness },
        publicationEligible: false,
      };
    },

    async loadTrade(tradeId, environment, inspectValuationReadiness, loadPrivateCalculation) {
      const repository = await requireRepository(dependencies, environment);
      if (repository === null) return null;
      const detail = await repository.getById(tradeId);
      if (detail === null) return null;
      const readiness = await inspectValuationReadiness(
        `afl-men:${detail.trade.year}-trades`
      );
      const scenario = (
        await prepareScenarios(dependencies, repository, [detail.trade], environment, scenarioCache)
      ).get(tradeId)!;
      const workbookSha256 = inputIdentity(environment).sha256;
      const privateCalculation = await loadPrivateCalculation?.(detail, workbookSha256);
      return {
        input: inputIdentity(environment),
        detail,
        scenario,
        numericalEvaluation:
          privateCalculation === undefined || privateCalculation === null
            ? { state: 'blocked', readiness }
            : { state: 'partial', readiness, calculation: privateCalculation },
        publicationEligible: false,
      };
    },
  };
}

export const localWorkbookEvaluationService = createLocalWorkbookEvaluationService();
