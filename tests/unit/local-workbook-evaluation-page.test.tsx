import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadArchiveMock, notFoundMock } = vi.hoisted(() => ({
  loadArchiveMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/server/aflTradeIntelligence/development/privateLocalWorkbookReads', () => ({
  privateLocalWorkbookReads: { loadArchive: loadArchiveMock },
}));

vi.mock('next/navigation', () => ({ notFound: notFoundMock }));

import LocalWorkbookEvaluationPage from '../../src/app/dev/afl-trade-evaluation/page';

describe('private local workbook evaluation archive page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadArchiveMock.mockResolvedValue({
      input: {
        originalFilename: 'AFL Drafts Trades.xlsx',
        sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        productionAuthority: 'none',
        publicationAuthority: 'none',
      },
      years: [2025, 2024],
      year: 2025,
      trades: [
        {
          trade: {
            tradeId: 'workbook-2025-real-trade',
            year: 2025,
            seqInYear: 1,
            title: 'Real Carlton and Essendon trade',
            clubSlugs: ['carlton', 'essendon'],
            clubNames: ['Carlton', 'Essendon'],
            partyCount: 2,
            assetCount: 3,
            hasPlayers: true,
            hasPicks: true,
            hasFuturePicks: false,
            receivesByClub: [],
          },
          calculation: {
            calculationId: 'development-trade-value:123',
            availability: 'available_partial',
          },
          scenario: {
            state: 'ready',
            publicationEligible: false,
            summary: {
              scenarioId: 'artifact:scenario-fixture',
              calculationId: 'valuation-calculation:scenario-fixture',
              valueUnitId: 'synthetic-pav',
              views: [
                {
                  view: 'at_trade',
                  parties: [
                    {
                      aflClubId: 'afl-club:carlton',
                      clubName: 'Carlton',
                      received: 10,
                      givenUp: 20,
                      netAdvantage: -10,
                    },
                    {
                      aflClubId: 'afl-club:essendon',
                      clubName: 'Essendon',
                      received: 20,
                      givenUp: 10,
                      netAdvantage: 10,
                    },
                  ],
                },
                {
                  view: 'realized',
                  parties: [
                    {
                      aflClubId: 'afl-club:carlton',
                      clubName: 'Carlton',
                      received: 7,
                      givenUp: 4,
                      netAdvantage: 3,
                    },
                    {
                      aflClubId: 'afl-club:essendon',
                      clubName: 'Essendon',
                      received: 4,
                      givenUp: 7,
                      netAdvantage: -3,
                    },
                  ],
                },
                {
                  view: 'remaining',
                  parties: [
                    {
                      aflClubId: 'afl-club:carlton',
                      clubName: 'Carlton',
                      received: 5,
                      givenUp: 6,
                      netAdvantage: -1,
                    },
                    {
                      aflClubId: 'afl-club:essendon',
                      clubName: 'Essendon',
                      received: 6,
                      givenUp: 5,
                      netAdvantage: 1,
                    },
                  ],
                },
                {
                  view: 'current',
                  parties: [
                    {
                      aflClubId: 'afl-club:carlton',
                      clubName: 'Carlton',
                      received: 8,
                      givenUp: 10,
                      netAdvantage: -2,
                    },
                    {
                      aflClubId: 'afl-club:essendon',
                      clubName: 'Essendon',
                      received: 10,
                      givenUp: 8,
                      netAdvantage: 2,
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
      batch: {
        totalTrades: 975,
        processedTrades: 975,
        availableTrades: 412,
        partialTrades: 301,
        unresolvedTrades: 262,
        assetStates: {
          valued: 1200,
          right_censored: 31,
          outcome_unresolved: 19,
          lineage_unresolved: 280,
          insufficient_cohort: 11,
        },
        datasetId: 'development-grade-dataset:123',
        modelId: 'development-grade-model:456',
        scenarioReadyTrades: 975,
        scenarioUnavailableTrades: 0,
      },
      publicationEligible: false,
    });
  });

  it('shows real archive records and an explicit batch calculation summary', async () => {
    render(
      await LocalWorkbookEvaluationPage({
        searchParams: Promise.resolve({}),
      })
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Private local trade evaluation' })
    ).toBeVisible();
    expect(screen.getByText('Not a factual release')).toBeVisible();
    expect(screen.getByText('975', { selector: '[data-metric="processed"]' })).toBeVisible();
    expect(screen.getByText('412', { selector: '[data-metric="available"]' })).toBeVisible();
    expect(screen.getByText('301', { selector: '[data-metric="partial"]' })).toBeVisible();
    expect(screen.getByText('262', { selector: '[data-metric="unresolved"]' })).toBeVisible();
    expect(screen.getByText('975', { selector: '[data-metric="scenario-ready"]' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Real Carlton and Essendon trade' })).toBeVisible();
    expect(screen.getByText('Partial calculation')).toBeVisible();
    expect(screen.getByText('Synthetic scenario ready')).toBeVisible();
    expect(screen.getByText('At trade')).toBeVisible();
    expect(screen.getByText('Carlton −10.00')).toBeVisible();
    expect(screen.getByText('Essendon +10.00')).toBeVisible();
    expect(screen.getByText('Realized')).toBeVisible();
    expect(screen.getByText('Carlton +3.00')).toBeVisible();
    expect(screen.getByText('Essendon −3.00')).toBeVisible();
    expect(screen.getByText('Remaining')).toBeVisible();
    expect(screen.getByText('Carlton −1.00')).toBeVisible();
    expect(screen.getByText('Essendon +1.00')).toBeVisible();
    expect(screen.getByText('Current')).toBeVisible();
    expect(screen.getByText('Carlton −2.00')).toBeVisible();
    expect(screen.getByText('Essendon +2.00')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Review calculation' })).toHaveAttribute(
      'href',
      '/dev/afl-trade-evaluation/workbook-2025-real-trade'
    );
    expect(loadArchiveMock).toHaveBeenCalledWith({
      year: null,
      clubSlug: undefined,
      type: undefined,
      q: undefined,
    });
  });

  it('returns not found when private workbook evaluation is disabled', async () => {
    loadArchiveMock.mockResolvedValueOnce(null);

    await expect(
      LocalWorkbookEvaluationPage({ searchParams: Promise.resolve({}) })
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFoundMock).toHaveBeenCalledOnce();
  });
});
