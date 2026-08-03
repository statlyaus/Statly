import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import AflTradeMethodologyPage from '../../src/app/(public)/draft/trades/methodology/page';
import { DraftClubTradeHistory } from '@/components/draft/DraftClubTradeHistory';
import { DraftTradeDetail, type DraftTradeDetailView } from '@/components/draft/DraftTradeDetail';
import type { DraftClubTradeRefRow } from '@/lib/draftTrades/contracts';
import { createAflTradePrePublicationAvailability } from '@/server/aflTradeIntelligence/publication/prePublicationAvailability';
import { AFL_TRADE_METHODOLOGY_HREF } from '@/types/aflTradeIntelligence';

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

function expectDocumentOrder(first: Element, second: Element) {
  expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
}

describe('AFL trade-intelligence public product', () => {
  it.each(['full', 'inline'] as const)(
    'keeps identity, unavailable value, and legacy archive data in order in %s detail mode',
    (mode) => {
      const { container } = render(
        <DraftTradeDetail
          detail={detail}
          mode={mode}
          valueAvailability={createAflTradePrePublicationAvailability()}
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
          screen.getByRole('heading', { level: 3, name: 'Trade value unavailable' })
        ).toBeVisible();
      } else {
        expectDocumentOrder(summary!, parties!);
        expect(screen.queryByRole('region', { name: /trade value status/i })).toBeNull();
      }

      expect(screen.getByRole('columnheader', { name: 'Legacy expected' })).toBeVisible();
      expect(screen.getByRole('columnheader', { name: 'Legacy actual' })).toBeVisible();
      expect(screen.getByText(/Statly has not verified their original definition/)).toBeVisible();

      const partyRow = screen.getByRole('row', { name: /Fabricated Club A/ });
      expect(within(partyRow).getByText('0')).toBeVisible();
      expect(within(partyRow).getByText('Not recorded')).toHaveClass('sr-only');
    }
  );

  it('qualifies legacy values consistently across mobile and desktop club history', () => {
    render(
      <DraftClubTradeHistory
        clubSlug="fabricated-club-a"
        clubName="Fabricated Club A"
        refs={clubTradeRefs}
        exportYear={2025}
      />
    );

    expect(
      screen.getByRole('complementary', { name: 'Legacy archive metric note' })
    ).toHaveTextContent('they are not Statly trade-value results');
    expect(
      screen.getByRole('link', { name: 'Read methodology and current limits' })
    ).toHaveAttribute('href', AFL_TRADE_METHODOLOGY_HREF);
    expect(screen.getByRole('columnheader', { name: 'Legacy expected' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Legacy actual' })).toBeVisible();
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/No raw club return recorded/).length).toBeGreaterThanOrEqual(2);
  });

  it('presents the methodology as planned and unavailable rather than operational', () => {
    render(<AflTradeMethodologyPage />);

    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'How Statly intends to explain AFL trade value',
      })
    ).toBeVisible();
    expect(screen.getByText('Valuation unavailable')).toBeVisible();
    expect(
      screen.getByText(/They are not calculations that are currently operating/)
    ).toBeVisible();
    expect(screen.getByText(/not an approved model methodology/)).toBeVisible();
    expect(screen.getByText('At the trade')).toBeVisible();
    expect(screen.getByText('Current outcome')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Return to trade explorer' })).toHaveAttribute(
      'href',
      '/draft/trades'
    );
    expect(screen.queryByRole('heading', { name: /winner|loser|fairness score/i })).toBeNull();
  });
});
