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
        selectedYearTrades: 783,
        scenarioReadyTrades: 975,
        scenarioUnavailableTrades: 0,
      },
      publicationEligible: false,
      numericalEvaluation: {
        state: 'blocked',
        readiness: {
          state: 'blocked',
          numericalCalculationsAvailable: false,
          qualificationReportCreated: true,
          qualificationReportId: `valuation-source-qualification:${'b'.repeat(64)}`,
          factualReleaseId: `outcome-release:${'c'.repeat(64)}`,
          qualificationEvaluatedAt: '2026-08-15T02:00:00.000Z',
          privateEvaluationAuthorityState: 'not_authorized',
          privateEvaluationDecisionId: null,
          privateEvaluationDecidedAt: null,
          preparedInputSetCreated: false,
          preparedInputSetCount: 0,
          preparedInputSetIds: [],
          scopeKey: 'afl-men:2025-trades',
          blockerCodes: ['source_blocked', 'private_evaluation_not_authorized'],
          sources: ['afl-tables-five-season', 'official-afl-2026'],
          requiredNextAuthority: 'private_nonproduction_derived_calculation_authority',
          explanation:
            'Private non-production derived calculation authority has not been recorded.',
        },
      },
    });
  });

  it('shows factual archive records, the numerical blocker, and isolated synthetic scenarios', async () => {
    render(
      await LocalWorkbookEvaluationPage({
        searchParams: Promise.resolve({}),
      })
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Private local trade evaluation' })
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Numerical valuation preparation is blocked' })
    ).toBeVisible();
    expect(
      screen.getByText(
        'Private non-production derived calculation authority has not been recorded.'
      )
    ).toBeVisible();
    expect(
      screen.getByText(`afl-men:2025-trades · retained for outcome-release:${'c'.repeat(64)}`)
    ).toBeVisible();
    expect(screen.getByText('Required next authority')).toBeVisible();
    expect(screen.getByText('Private non-production calculation authority')).toBeVisible();
    expect(screen.getByText('Not authorized')).toBeVisible();
    expect(screen.getByText('Not a factual release')).toBeVisible();
    expect(
      screen.getByText('783', { selector: '[data-metric="selected-year-trades"]' })
    ).toBeVisible();
    expect(screen.getByText('975', { selector: '[data-metric="all-trades"]' })).toBeVisible();
    expect(screen.getByText('975', { selector: '[data-metric="scenario-ready"]' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Real Carlton and Essendon trade' })).toBeVisible();
    expect(screen.getByText('Factual transaction loaded')).toBeVisible();
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
    expect(screen.getByRole('link', { name: 'Review trade' })).toHaveAttribute(
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
