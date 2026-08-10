import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadWorkbookMock } = vi.hoisted(() => ({
  loadWorkbookMock: vi.fn(),
}));

vi.mock('@/server/aflTradeIntelligence/source/developmentWorkbookLoader', () => ({
  loadAflOutcomesDevelopmentWorkbook: loadWorkbookMock,
}));

import {
  clearDevelopmentWorkbookDraftTradeReadCacheForTests,
  getDevelopmentWorkbookAcquisitionPreview,
  getDevelopmentWorkbookDraftTradeReadRepository,
  getDevelopmentWorkbookStatlyTradeValues,
  getDevelopmentWorkbookTradeGradeEvidence,
  isDevelopmentWorkbookDraftTradeReadEnabled,
} from '@/lib/draftTrades/developmentWorkbook';
import { createAflTradeByteArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { AFL_DRAFT_TRADE_ANNUAL_WORKBOOK_HEADER } from '@/server/aflTradeIntelligence/source/draftTradeWorkbookEvaluation';
import { normalizeAflOutcomesDevelopmentWorkbook } from '@/server/aflTradeIntelligence/source/developmentWorkbookStructure';

function fixtureWorkbook() {
  return normalizeAflOutcomesDevelopmentWorkbook({
    sourceArtifact: createAflTradeByteArtifactRef(
      new TextEncoder().encode('repository fixture'),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '2026-08-07T00:00:00.000Z'
    ),
    originalFilename: 'fixture.xlsx',
    sheets: [
      {
        sheet: 'AFL VFL Trades',
        data: [
          ['Full All-Time List of VFL/AFL Trades', null],
          [2024, null],
          ['2024 Trade for Fixture Player', null],
          ['Carlton', 'Fixture Player (12 games)'],
          ['Essendon', '#10 (Drafted Player - 4 games)'],
          [2025, null],
          ['2025 Carlton and GWS Trade for Draft Picks', null],
          ['Carlton', '#2026R2 (GWS) (-)'],
          ['GWS', '#15 (Another Player - 0 games)'],
        ],
      },
      {
        sheet: '2024',
        data: [
          [...AFL_DRAFT_TRADE_ANNUAL_WORKBOOK_HEADER],
          [
            '2024_0001',
            2024,
            null,
            'Trade',
            null,
            'Carlton',
            null,
            'Fixture Player',
            20,
            188,
            null,
            'Original Club',
            'B',
            12,
            2,
            0,
            0,
            null,
          ],
        ],
      },
    ],
  });
}

const enabledEnvironment = {
  NODE_ENV: 'development',
  AFL_OUTCOMES_DEV_WORKBOOK_READ_ENABLED: 'true',
  AFL_OUTCOMES_DEV_WORKBOOK_PATH: '/outside/workspace/fixture.xlsx',
  AFL_OUTCOMES_DEV_WORKBOOK_SHA256: 'a'.repeat(64),
};

describe('development workbook draft-trade repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDevelopmentWorkbookDraftTradeReadCacheForTests();
    loadWorkbookMock.mockResolvedValue(fixtureWorkbook());
  });

  it('is disabled by default and in production even when the opt-in flag is present', async () => {
    expect(isDevelopmentWorkbookDraftTradeReadEnabled({ NODE_ENV: 'development' })).toBe(false);
    expect(
      isDevelopmentWorkbookDraftTradeReadEnabled({
        ...enabledEnvironment,
        NODE_ENV: 'production',
      })
    ).toBe(false);
    await expect(
      getDevelopmentWorkbookDraftTradeReadRepository({
        ...enabledEnvironment,
        NODE_ENV: 'production',
      })
    ).resolves.toBeNull();
    await expect(
      getDevelopmentWorkbookAcquisitionPreview(
        { year: null, club: '', q: '', category: null, limit: 25 },
        { ...enabledEnvironment, NODE_ENV: 'production' }
      )
    ).resolves.toBeNull();
    await expect(
      getDevelopmentWorkbookTradeGradeEvidence('workbook-trade', {
        ...enabledEnvironment,
        NODE_ENV: 'production',
      })
    ).resolves.toBeNull();
    await expect(
      getDevelopmentWorkbookStatlyTradeValues(['workbook-trade'], {
        ...enabledEnvironment,
        NODE_ENV: 'production',
      })
    ).resolves.toBeNull();
    expect(loadWorkbookMock).not.toHaveBeenCalled();
  });

  it('loads once and supports years, filtering, detail, and club reads', async () => {
    const first = await getDevelopmentWorkbookDraftTradeReadRepository(enabledEnvironment);
    const second = await getDevelopmentWorkbookDraftTradeReadRepository(enabledEnvironment);
    const acquisitions = await getDevelopmentWorkbookAcquisitionPreview(
      { year: 2024, club: 'carl', q: 'fixture', category: 'trade', limit: 25 },
      enabledEnvironment
    );

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(loadWorkbookMock).toHaveBeenCalledTimes(1);
    await expect(first?.listYears()).resolves.toEqual([2025, 2024]);
    await expect(first?.listTradesByYear(2024, { type: 'player' })).resolves.toHaveLength(1);
    await expect(first?.listTradesByYear(2025, { type: 'future_pick' })).resolves.toHaveLength(1);
    await expect(first?.listTradesByYear(2025, { clubSlug: 'essendon' })).resolves.toEqual([]);
    const trade = (await first?.listTradesByYear(2024))?.[0];
    const gradeEvidence = await getDevelopmentWorkbookTradeGradeEvidence(
      trade?.tradeId ?? '',
      enabledEnvironment
    );
    const statlyValues = await getDevelopmentWorkbookStatlyTradeValues(
      [trade?.tradeId ?? ''],
      enabledEnvironment
    );
    await expect(first?.getById(trade?.tradeId ?? '')).resolves.toMatchObject({
      trade: { year: 2024 },
      parties: expect.any(Array),
      assets: expect.any(Array),
    });
    await expect(first?.listRefsByClub('carlton')).resolves.toHaveLength(2);
    await expect(first?.listClubs()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ clubSlug: 'carlton', tradeCount: 2 })])
    );
    expect(acquisitions).toMatchObject({
      total: 1,
      items: [
        expect.objectContaining({
          year: 2024,
          category: 'trade',
          clubName: 'Carlton',
          playerName: 'Fixture Player',
        }),
      ],
    });
    expect(gradeEvidence).toMatchObject({
      status: 'partial',
      coverage: { totalAssets: 2, matchedAssets: 1, gradedAssets: 1, unresolvedAssets: 1 },
      assets: expect.arrayContaining([
        expect.objectContaining({
          status: 'graded',
          outcome: expect.objectContaining({ playerName: 'Fixture Player', grade: 'B' }),
        }),
        expect.objectContaining({
          assetType: 'pick',
          status: 'unresolved',
          reasonCode: 'no_acquisition_match',
        }),
      ]),
    });
    expect(statlyValues?.valuesByTradeId.get(trade?.tradeId ?? '')).toMatchObject({
      tradeId: trade?.tradeId,
      summaries: {
        at_trade: { view: 'at_trade' },
        current: { view: 'current' },
      },
      publicationEligible: false,
    });
    expect(statlyValues?.gradesByTradeId.get(trade?.tradeId ?? '')).toMatchObject({
      atTrade: { view: 'at_trade' },
      current: { view: 'current' },
    });
  });

  it('requires the pinned path and digest when enabled', async () => {
    await expect(
      getDevelopmentWorkbookDraftTradeReadRepository({
        NODE_ENV: 'development',
        AFL_OUTCOMES_DEV_WORKBOOK_READ_ENABLED: 'true',
      })
    ).rejects.toThrow(/AFL_OUTCOMES_DEV_WORKBOOK_PATH/);
  });
});
