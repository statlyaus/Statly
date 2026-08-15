import { describe, expect, it, vi } from 'vitest';

import {
  createLocalWorkbookEvaluationService,
  type LocalWorkbookEvaluationDependencies,
} from '@/server/aflTradeIntelligence/development/localWorkbookEvaluation';
import type { DraftTradeReadRepository } from '@/lib/draftTrades/read';
import type { AflTradeDevelopmentWorkbookValueProjection } from '@/server/aflTradeIntelligence/modeling/developmentWorkbookValueProjection';
import { prepareLocalWorkbookSyntheticValuation } from '@/server/aflTradeIntelligence/development/localWorkbookSyntheticValuation';

const digest = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const enabledEnvironment = {
  NODE_ENV: 'development',
  AFL_OUTCOMES_DEV_WORKBOOK_READ_ENABLED: 'true',
  AFL_OUTCOMES_DEV_WORKBOOK_PATH: '/outside/workspace/AFL Drafts Trades.xlsx',
  AFL_OUTCOMES_DEV_WORKBOOK_SHA256: digest,
};

function trade(index: number, year: number) {
  return {
    tradeId: `workbook-${year}-${String(index).padStart(4, '0')}`,
    year,
    seqInYear: index,
    title: `${year} real trade ${index}`,
    clubSlugs: ['carlton', 'essendon'],
    clubNames: ['Carlton', 'Essendon'],
    partyCount: 2,
    assetCount: 2,
    hasPlayers: true,
    hasPicks: false,
    hasFuturePicks: false,
    receivesByClub: [],
  };
}

function repository(): DraftTradeReadRepository {
  const trades = [trade(1, 2025), trade(2, 2025), trade(1, 2024)];
  return {
    async listYears() {
      return [2025, 2024];
    },
    async listTradesByYear(year) {
      return trades.filter((item) => item.year === year);
    },
    async getById(tradeId) {
      const selected = trades.find((item) => item.tradeId === tradeId);
      return selected
        ? {
            trade: selected,
            parties: [
              {
                id: `${tradeId}:carlton`,
                tradeId,
                year: selected.year,
                seqInYear: selected.seqInYear,
                tradeTitle: selected.title,
                clubSlug: 'carlton',
                clubName: 'Carlton',
                rowOrder: 1,
                assetsRaw: 'Fixture player',
                expected: null,
                actual: null,
              },
              {
                id: `${tradeId}:essendon`,
                tradeId,
                year: selected.year,
                seqInYear: selected.seqInYear,
                tradeTitle: selected.title,
                clubSlug: 'essendon',
                clubName: 'Essendon',
                rowOrder: 2,
                assetsRaw: '',
                expected: null,
                actual: null,
              },
            ],
            assets: ['carlton', 'essendon'].map((clubSlug, index) => ({
              id: `${tradeId}:asset:${index + 1}`,
              tradeId,
              year: selected.year,
              clubSlug,
              clubName: clubSlug === 'carlton' ? 'Carlton' : 'Essendon',
              assetIndex: index + 1,
              assetType: 'player' as const,
              assetText: `Fixture player ${index + 1}`,
              playerName: `Fixture player ${index + 1}`,
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
            })),
          }
        : null;
    },
    async listRefsByClub() {
      return [];
    },
    async listClubs() {
      return [];
    },
    async searchTrades() {
      return [];
    },
  };
}

function projection(tradeIds: readonly string[]): AflTradeDevelopmentWorkbookValueProjection {
  const valuesByTradeId = new Map(
    tradeIds.map((tradeId, index) => {
      const availability =
        tradeId === 'workbook-2025-0001'
          ? 'available'
          : tradeId === 'workbook-2025-0002'
            ? 'available_partial'
            : 'lineage_unresolved';
      return [
        tradeId,
        {
          calculationId: `calculation:${index}`,
          tradeId,
          datasetId: 'dataset:private-local',
          modelId: 'model:private-local',
          summaries: {
            at_trade: { view: 'at_trade', availability },
            realized: { view: 'realized', availability },
            remaining: { view: 'remaining', availability },
            current: { view: 'current', availability },
          },
          assets: [
            {
              assetId: `${tradeId}:asset`,
              state: availability === 'lineage_unresolved' ? 'lineage_unresolved' : 'valued',
              featureProviders: [],
              atTradeSampleCount: availability === 'lineage_unresolved' ? 0 : 40,
            },
          ],
          publicationEligible: false,
        },
      ];
    })
  );
  return {
    datasetId: 'dataset:private-local',
    model: {
      modelId: 'model:private-local',
      content: {
        schemaVersion: 'afl-trade-development-grade-model/v1',
        datasetId: 'dataset:private-local',
        createdAt: '2026-08-06T08:37:32.121Z',
        minimumCohortSize: 20,
        practicalEquivalenceTolerance: 5,
        outcomeWeights: { games: 1, goals: 0.5, coachesVotes: 1.5, brownlowVotes: 2 },
        providerFeatureTreatment:
          'reconciled_point_in_time_when_available_else_selection_demographic',
        historicalEligibility: 'fixed_horizon_matured_strictly_before_prediction',
        sourceRecordedGradeTreatment: 'prohibited',
        publicationEligible: false,
      },
    },
    valuesByTradeId:
      valuesByTradeId as AflTradeDevelopmentWorkbookValueProjection['valuesByTradeId'],
    gradesByTradeId: new Map(),
    linksByTradeId: new Map(
      tradeIds.map((tradeId) => [
        tradeId,
        [
          {
            assetId: `${tradeId}:asset`,
            state: tradeId.endsWith('0001') ? 'linked' : 'unresolved',
            acquisitionId: tradeId.endsWith('0001') ? 'acquisition:1' : null,
            method: tradeId.endsWith('0001') ? 'player_club_year' : 'none',
          },
        ],
      ])
    ),
    publicationEligible: false,
  };
}

function dependencies(): LocalWorkbookEvaluationDependencies {
  return {
    loadRepository: vi.fn(async () => repository()),
    loadValues: vi.fn(async (tradeIds) => projection(tradeIds)),
  };
}

describe('private local workbook evaluation', () => {
  it('is unavailable by default and in production without reading the workbook', async () => {
    const deps = dependencies();
    const service = createLocalWorkbookEvaluationService(deps);

    await expect(
      service.loadArchive({ year: 2025 }, { NODE_ENV: 'development' })
    ).resolves.toBeNull();
    await expect(
      service.loadArchive({ year: 2025 }, { ...enabledEnvironment, NODE_ENV: 'production' })
    ).resolves.toBeNull();
    expect(deps.loadRepository).not.toHaveBeenCalled();
    expect(deps.loadValues).not.toHaveBeenCalled();
  });

  it('processes every real trade and reports calculated, partial, and unresolved results', async () => {
    const service = createLocalWorkbookEvaluationService(dependencies());

    const result = await service.loadArchive({ year: 2025 }, enabledEnvironment);

    expect(result).toMatchObject({
      input: {
        originalFilename: 'AFL Drafts Trades.xlsx',
        sha256: digest,
        productionAuthority: 'none',
        publicationAuthority: 'none',
      },
      years: [2025, 2024],
      year: 2025,
      trades: [
        expect.objectContaining({
          trade: expect.objectContaining({ tradeId: 'workbook-2025-0001' }),
          calculation: expect.objectContaining({ availability: 'available' }),
          scenario: expect.objectContaining({
            state: 'ready',
            publicationEligible: false,
          }),
        }),
        expect.objectContaining({
          trade: expect.objectContaining({ tradeId: 'workbook-2025-0002' }),
          calculation: expect.objectContaining({ availability: 'available_partial' }),
          scenario: expect.objectContaining({ state: 'ready' }),
        }),
      ],
      batch: {
        totalTrades: 3,
        processedTrades: 2,
        availableTrades: 1,
        partialTrades: 1,
        unresolvedTrades: 0,
        assetStates: {
          valued: 2,
          right_censored: 0,
          outcome_unresolved: 0,
          lineage_unresolved: 0,
          insufficient_cohort: 0,
        },
        datasetId: 'dataset:private-local',
        modelId: 'model:private-local',
        scenarioReadyTrades: 2,
        scenarioUnavailableTrades: 0,
      },
      publicationEligible: false,
    });
  });

  it('uses one bounded archive projection instead of rebuilding the model for every read chunk', async () => {
    const deps = dependencies();
    const loadArchiveValues = vi.fn(async (tradeIds: readonly string[]) => projection(tradeIds));
    const service = createLocalWorkbookEvaluationService({ ...deps, loadArchiveValues });

    await expect(service.loadArchive({ year: 2025 }, enabledEnvironment)).resolves.toMatchObject({
      batch: { totalTrades: 3, processedTrades: 2 },
    });

    expect(loadArchiveValues).toHaveBeenCalledOnce();
    expect(loadArchiveValues).toHaveBeenCalledWith(
      ['workbook-2025-0001', 'workbook-2025-0002'],
      enabledEnvironment
    );
    expect(deps.loadValues).not.toHaveBeenCalled();
  });

  it('returns one calculated trade with its asset links and rejects unknown trade ids', async () => {
    const service = createLocalWorkbookEvaluationService(dependencies());

    await expect(
      service.loadTrade('workbook-2025-0001', enabledEnvironment)
    ).resolves.toMatchObject({
      detail: { trade: { title: '2025 real trade 1' } },
      calculation: {
        tradeId: 'workbook-2025-0001',
        publicationEligible: false,
      },
      links: [
        {
          state: 'linked',
          acquisitionId: 'acquisition:1',
          method: 'player_club_year',
        },
      ],
      scenario: {
        state: 'ready',
        publicationEligible: false,
        scenario: expect.objectContaining({
          authority: {
            kind: 'private_scenario',
            publicationEligible: false,
            publicationProhibited: true,
          },
        }),
      },
      publicationEligible: false,
    });
    await expect(service.loadTrade('workbook-missing', enabledEnvironment)).resolves.toBeNull();
  });

  it('reuses a content-pinned scenario within one local service instance', async () => {
    const prepareScenario = vi.fn(prepareLocalWorkbookSyntheticValuation);
    const service = createLocalWorkbookEvaluationService({
      ...dependencies(),
      prepareScenario,
    });

    await service.loadTrade('workbook-2025-0001', enabledEnvironment);
    await service.loadTrade('workbook-2025-0001', enabledEnvironment);

    expect(prepareScenario).toHaveBeenCalledOnce();
  });
});
