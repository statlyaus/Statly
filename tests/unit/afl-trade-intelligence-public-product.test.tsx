import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/server/aflTradeIntelligence/runtime/publicReadRuntime', () => ({
  getPublicAflTradeReadRuntime: async () => ({
    methodologyReadService: {
      read: async () => ({
        availability: 'unavailable',
        reasonCode: 'no-active-publication',
        message: 'There is no active reviewed AFL trade-value methodology publication yet.',
        methodology: null,
      }),
    },
  }),
}));

import AflTradeMethodologyPage from '../../src/app/(public)/draft/trades/methodology/page';
import { DraftClubTradeHistory } from '@/components/draft/DraftClubTradeHistory';
import { DraftTradeDetail, type DraftTradeDetailView } from '@/components/draft/DraftTradeDetail';
import type { DraftClubTradeRefRow } from '@/lib/draftTrades/contracts';
import {
  AFL_TRADE_PUBLIC_VALUE_SCOPE,
  aflTradePrePublicationValueReadService,
} from '@/server/aflTradeIntelligence/publication/prePublicationValueReadService';
import { type AflTradeValueBearingSummary } from '@/types/aflTradeIntelligence';

const detail: DraftTradeDetailView = {
  trade: {
    tradeId: 'fixture-trade-1',
    year: 2025,
    seqInYear: 1,
    title: 'Fabricated AFL trade',
    clubNames: ['Fabricated Club A'],
  },
  parties: [
    {
      id: 'fixture-party-1',
      clubName: 'Fabricated Club A',
      assetsRaw: 'Fabricated player and pick',
      rowOrder: 1,
      expected: 0,
      actual: null,
    },
  ],
  assets: [
    {
      id: 'fixture-asset-1',
      assetIndex: 0,
      clubName: 'Fabricated Club A',
      assetType: 'player',
      assetText: 'Fabricated player',
      playerName: 'Fabricated Player',
      draftedPlayer: null,
      games: null,
    },
  ],
};

const clubTradeRefs: DraftClubTradeRefRow[] = [
  {
    tradeId: 'fixture-trade-1',
    year: 2025,
    seqInYear: 1,
    title: 'Fabricated AFL trade',
    clubSlug: 'fabricated-club-a',
    clubName: 'Fabricated Club A',
    assetsRaw: '',
    expected: 0,
    actual: null,
  },
];

function numericalSummary(
  view: 'at_trade' | 'current',
  probabilities: readonly [number, number]
): AflTradeValueBearingSummary {
  return {
    availability: 'available_partial',
    view,
    modelVintage: view === 'at_trade' ? 'original_vintage' : 'current',
    unit: {
      id: 'fixture-value-unit',
      label: 'Fixture value',
      description: 'Fabricated unit for component tests.',
      direction: 'higher_is_better',
    },
    clubValues: probabilities.map((finishesAheadProbability, index) => ({
      aflClubId: `club-${index + 1}`,
      clubName: index === 0 ? 'Fabricated Club A' : 'Fabricated Club B',
      expectedValue: 10 - index,
      medianValue: 10 - index,
      interval: { lower: 6 - index, upper: 14 - index, level: 0.8 },
      finishesAheadProbability,
    })),
    practicalEquivalenceProbability: 0.1,
    comparisonBasis: 'included_assets_only',
    assessment: {
      interpretation: 'strongly_leans_to_club',
      favouredAflClubId: 'club-1',
      scope: 'included_assets_only',
    },
    confidence: {
      level: 'low',
      dimensions: [
        {
          kind: 'data_coverage',
          level: 'low',
          reasonCode: 'fixture-active-career',
          explanation: 'The fabricated outcome remains open.',
        },
      ],
    },
    coverage: { status: 'partial', coverageRatio: 0.8, excludedAssetCount: 1 },
    reasonCode: 'fixture-active-career',
    message: 'The outcome remains open.',
    nextAction: null,
    methodologyHref: '/draft/trades/methodology',
    warnings: [
      {
        code: 'fixture-active-career',
        severity: 'warning',
        message: 'The outcome remains open.',
      },
    ],
  };
}

const statlyValues = {
  atTrade: numericalSummary('at_trade', [0.63, 0.27]),
  current: numericalSummary('current', [0.55, 0.35]),
};

function expectDocumentOrder(first: Element, second: Element) {
  expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
}

describe('AFL trade-intelligence public product', () => {
  it.each(['full', 'inline'] as const)(
    'keeps identity, unavailable value, and Statly grades in order in %s detail mode',
    async (mode) => {
      const valueAnalysis = await aflTradePrePublicationValueReadService.detail({
        scopeKey: AFL_TRADE_PUBLIC_VALUE_SCOPE,
        tradeId: detail.trade.tradeId,
        requestedViews: ['at_trade', 'realized', 'remaining', 'current'],
      });
      const { container } = render(
        <DraftTradeDetail
          detail={detail}
          mode={mode}
          valueAnalysis={valueAnalysis}
          statlyValues={statlyValues}
        />
      );

      const summary = container.querySelector('#trade-detail-summary');
      const parties = container.querySelector('#trade-detail-parties');

      expect(summary).not.toBeNull();
      expect(parties).not.toBeNull();
      if (mode === 'full') {
        const availability = screen.getByRole('region', {
          name: 'Current outcome trade value status',
        });
        expectDocumentOrder(summary!, availability);
        expectDocumentOrder(availability, parties!);
        expect(
          screen.getByRole('heading', { level: 3, name: 'Trade value not calculated' })
        ).toBeVisible();
        const partyTable = screen.getByRole('table', {
          name: 'Trade parties grade comparison',
        });
        expect(
          within(partyTable).getByRole('columnheader', { name: 'At-trade grade' })
        ).toBeVisible();
        expect(
          within(partyTable).getByRole('columnheader', { name: 'Current grade' })
        ).toBeVisible();
        const partyRow = within(partyTable).getByRole('row', { name: /Fabricated Club A/ });
        expect(within(partyRow).getAllByText('B+')).toHaveLength(2);
        expect(within(partyRow).getAllByText('Provisional')).toHaveLength(2);
      } else {
        expectDocumentOrder(summary!, parties!);
        expect(screen.queryByRole('region', { name: /trade value status/i })).toBeNull();
        expect(screen.queryByRole('table', { name: 'Trade parties grade comparison' })).toBeNull();
      }

      expect(screen.getByText(/At trade uses information available at the time/)).toBeVisible();
      expect(screen.queryByText(/legacy/i)).not.toBeInTheDocument();

      const compactPartyList = screen.getByRole('list', {
        name: 'Trade parties and grades',
      });
      const compactParty = within(compactPartyList).getByRole('listitem', {
        name: /Fabricated Club A/,
      });
      expect(within(compactParty).getByText('Fabricated player and pick')).toBeVisible();
      expect(within(compactParty).getAllByText('B+')).toHaveLength(2);
      expect(within(compactParty).getAllByText('Provisional')).toHaveLength(2);
    }
  );

  it('shows Statly at-trade and current grades across mobile and desktop club history', () => {
    render(
      <DraftClubTradeHistory
        clubSlug="fabricated-club-a"
        clubName="Fabricated Club A"
        refs={clubTradeRefs}
        exportYear={2025}
        statlyValuesByTradeId={{ 'fixture-trade-1': statlyValues }}
      />
    );

    expect(screen.getByRole('complementary', { name: 'Statly grade note' })).toHaveTextContent(
      'At-trade grades use information available when the deal occurred'
    );
    expect(screen.getByRole('columnheader', { name: 'At-trade grade' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Current grade' })).toBeVisible();
    expect(screen.getAllByText('B+').length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByText('Provisional').length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByText(/No raw club return recorded/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/legacy/i)).not.toBeInTheDocument();
  });

  it('presents the methodology as unavailable when no publication is active', async () => {
    render(await AflTradeMethodologyPage());

    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'How Statly will explain AFL trade value',
      })
    ).toBeVisible();
    expect(screen.getByText('Valuation not yet published')).toBeVisible();
    expect(
      screen.getByText(/availability is determined by the exact active release/)
    ).toBeVisible();
    expect(
      screen.getByText(/A numerical result appears only after its sourced facts/)
    ).toBeVisible();
    expect(screen.queryByText(/workbook/i)).not.toBeInTheDocument();
    expect(screen.getByText('At the trade')).toBeVisible();
    expect(screen.getByText('Current outcome')).toBeVisible();
    expect(
      screen.getByRole('heading', { level: 3, name: 'How Statly assigns a grade' })
    ).toBeVisible();
    expect(screen.getByText(/Grades run from A\+ to D/)).toBeVisible();
    expect(screen.queryByText(/legacy/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Return to trade explorer' })).toHaveAttribute(
      'href',
      '/draft/trades'
    );
    expect(screen.queryByRole('heading', { name: /winner|loser|fairness score/i })).toBeNull();
  });
});
