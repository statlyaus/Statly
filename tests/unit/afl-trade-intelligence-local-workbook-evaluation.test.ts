import { describe, expect, it, vi } from 'vitest';

import {
  createLocalWorkbookEvaluationService,
  type LocalWorkbookEvaluationDependencies,
} from '@/server/aflTradeIntelligence/development/localWorkbookEvaluation';
import type { DraftTradeReadRepository } from '@/lib/draftTrades/read';
import { prepareLocalWorkbookSyntheticValuation } from '@/server/aflTradeIntelligence/development/localWorkbookSyntheticValuation';
import type { LocalAflTradeValuationReadiness } from '@/server/aflTradeIntelligence/development/localAflTradeValuationReadiness';

const digest = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const enabledEnvironment = {
  NODE_ENV: 'development',
  AFL_OUTCOMES_DEV_WORKBOOK_READ_ENABLED: 'true',
  AFL_OUTCOMES_DEV_WORKBOOK_PATH: '/outside/workspace/AFL Drafts Trades.xlsx',
  AFL_OUTCOMES_DEV_WORKBOOK_SHA256: digest,
};

const sourceBlockedReadiness: LocalAflTradeValuationReadiness = {
  state: 'blocked',
  numericalCalculationsAvailable: false,
  qualificationReportCreated: true,
  qualificationReportId: `valuation-source-qualification:${'b'.repeat(64)}`,
  factualReleaseId: `outcome-release:${'c'.repeat(64)}`,
  qualificationEvaluatedAt: '2026-08-15T02:00:00.000Z',
  privateEvaluationAuthorityState: 'not_authorized',
  privateEvaluationEvidenceKind: null,
  privateEvaluationDecisionId: null,
  privateEvaluationDecidedAt: null,
  privateEvaluationEvidenceBundleId: null,
  retainedEvidenceCandidateCount: null,
  retainedEvidenceDecisionCount: null,
  retainedEvidenceSourceCaptureCount: null,
  retainedEvidenceSourceRightsCount: null,
  preparedInputSetCreated: false,
  preparedInputSetCount: 0,
  preparedInputSetIds: [],
  scopeKey: 'afl-men:2025-trades',
  blockerCodes: ['source_blocked', 'private_evaluation_not_authorized'],
  sources: ['official-afl-2026'],
  requiredNextAuthority: 'private_nonproduction_derived_calculation_authority',
  explanation: 'Private non-production derived calculation authority has not been recorded.',
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

function dependencies(): LocalWorkbookEvaluationDependencies {
  return {
    loadRepository: vi.fn(async () => repository()),
  };
}

describe('private local workbook evaluation', () => {
  it('is unavailable by default and in production without reading the workbook', async () => {
    const deps = dependencies();
    const service = createLocalWorkbookEvaluationService(deps);

    await expect(
      service.loadArchive(
        { year: 2025 },
        { NODE_ENV: 'development' },
        vi.fn().mockResolvedValue(sourceBlockedReadiness)
      )
    ).resolves.toBeNull();
    await expect(
      service.loadArchive(
        { year: 2025 },
        { ...enabledEnvironment, NODE_ENV: 'production' },
        vi.fn().mockResolvedValue(sourceBlockedReadiness)
      )
    ).resolves.toBeNull();
    expect(deps.loadRepository).not.toHaveBeenCalled();
  });

  it('loads factual trades and isolated synthetic scenarios while real numerical evaluation remains blocked', async () => {
    const service = createLocalWorkbookEvaluationService(dependencies());

    const result = await service.loadArchive(
      { year: 2025 },
      enabledEnvironment,
      vi.fn().mockResolvedValue(sourceBlockedReadiness)
    );

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
          scenario: expect.objectContaining({
            state: 'ready',
            publicationEligible: false,
          }),
        }),
        expect.objectContaining({
          trade: expect.objectContaining({ tradeId: 'workbook-2025-0002' }),
          scenario: expect.objectContaining({ state: 'ready' }),
        }),
      ],
      batch: {
        totalTrades: 3,
        selectedYearTrades: 2,
        scenarioReadyTrades: 2,
        scenarioUnavailableTrades: 0,
      },
      numericalEvaluation: { state: 'blocked', readiness: sourceBlockedReadiness },
      publicationEligible: false,
    });
  });

  it('keeps factual workbook review available without invoking a numerical loader when source policy blocks it', async () => {
    const deps = dependencies();
    const service = createLocalWorkbookEvaluationService(deps);

    const result = await service.loadArchive(
      { year: 2025 },
      enabledEnvironment,
      vi.fn().mockResolvedValue(sourceBlockedReadiness)
    );

    expect(result).toMatchObject({
      year: 2025,
      trades: [
        expect.objectContaining({
          trade: expect.objectContaining({ tradeId: 'workbook-2025-0001' }),
        }),
        expect.objectContaining({
          trade: expect.objectContaining({ tradeId: 'workbook-2025-0002' }),
        }),
      ],
      numericalEvaluation: {
        state: 'blocked',
        readiness: sourceBlockedReadiness,
      },
    });
    expect(deps.loadRepository).toHaveBeenCalledOnce();
  });

  it('returns one factual trade with its synthetic scenario and rejects unknown trade ids', async () => {
    const service = createLocalWorkbookEvaluationService(dependencies());

    await expect(
      service.loadTrade(
        'workbook-2025-0001',
        enabledEnvironment,
        vi.fn().mockResolvedValue(sourceBlockedReadiness)
      )
    ).resolves.toMatchObject({
      detail: { trade: { title: '2025 real trade 1' } },
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
      numericalEvaluation: { state: 'blocked', readiness: sourceBlockedReadiness },
      publicationEligible: false,
    });
    await expect(
      service.loadTrade(
        'workbook-missing',
        enabledEnvironment,
        vi.fn().mockResolvedValue(sourceBlockedReadiness)
      )
    ).resolves.toBeNull();
  });

  it('adds an admitted private reviewed calculation to trade detail without changing archive reads', async () => {
    const service = createLocalWorkbookEvaluationService(dependencies());
    const calculation = {
      projectionId: `local-private-trade-calculation:${'f'.repeat(64)}`,
      tradeId: 'workbook-2025-0001',
      workbookSha256: digest,
      assets: [
        {
          state: 'calculated',
          atTrade: { state: 'available' },
          realized: { state: 'unavailable' },
          remaining: { state: 'unavailable' },
          current: { state: 'unavailable' },
        },
      ],
      publicationEligible: false,
      publicationProhibited: true,
    } as never;
    const loadPrivateCalculation = vi.fn().mockResolvedValue(calculation);

    await expect(
      service.loadTrade(
        'workbook-2025-0001',
        enabledEnvironment,
        vi.fn().mockResolvedValue(sourceBlockedReadiness),
        loadPrivateCalculation
      )
    ).resolves.toMatchObject({
      numericalEvaluation: {
        state: 'partial',
        readiness: sourceBlockedReadiness,
        calculation,
      },
    });
    expect(loadPrivateCalculation).toHaveBeenCalledWith(
      expect.objectContaining({
        trade: expect.objectContaining({ tradeId: 'workbook-2025-0001' }),
      }),
      digest
    );
  });

  it('keeps numerical evaluation blocked when every private asset view is unavailable', async () => {
    const service = createLocalWorkbookEvaluationService(dependencies());
    const calculation = {
      projectionId: `local-private-trade-calculation:${'e'.repeat(64)}`,
      tradeId: 'workbook-2025-0001',
      workbookSha256: digest,
      assets: [
        { state: 'unavailable', reason: 'player_identity_unavailable' },
        {
          state: 'calculated',
          atTrade: { state: 'unavailable' },
          realized: { state: 'unavailable' },
          remaining: { state: 'unavailable' },
          current: { state: 'unavailable' },
        },
      ],
      publicationEligible: false,
      publicationProhibited: true,
    } as never;

    await expect(
      service.loadTrade(
        'workbook-2025-0001',
        enabledEnvironment,
        vi.fn().mockResolvedValue(sourceBlockedReadiness),
        vi.fn().mockResolvedValue(calculation)
      )
    ).resolves.toMatchObject({
      numericalEvaluation: {
        state: 'blocked',
        readiness: sourceBlockedReadiness,
      },
    });
  });

  it('reuses a content-pinned scenario within one local service instance', async () => {
    const prepareScenario = vi.fn(prepareLocalWorkbookSyntheticValuation);
    const service = createLocalWorkbookEvaluationService({
      ...dependencies(),
      prepareScenario,
    });

    await service.loadTrade(
      'workbook-2025-0001',
      enabledEnvironment,
      vi.fn().mockResolvedValue(sourceBlockedReadiness)
    );
    await service.loadTrade(
      'workbook-2025-0001',
      enabledEnvironment,
      vi.fn().mockResolvedValue(sourceBlockedReadiness)
    );

    expect(prepareScenario).toHaveBeenCalledOnce();
  });
});
