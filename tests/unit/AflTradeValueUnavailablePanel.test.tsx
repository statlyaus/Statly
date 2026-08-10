import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AflTradeValueUnavailablePanel } from '@/components/draft/AflTradeValueUnavailablePanel';
import { createAflTradePrePublicationAvailability } from '@/server/aflTradeIntelligence/publication/prePublicationAvailability';
import { AFL_TRADE_METHODOLOGY_HREF } from '@/types/aflTradeIntelligence';

describe('AflTradeValueUnavailablePanel', () => {
  it('renders the compact state as labelled, non-live content with one action', () => {
    render(
      <AflTradeValueUnavailablePanel
        availability={createAflTradePrePublicationAvailability()}
        variant="compact"
      />
    );

    const panel = screen.getByRole('region', {
      name: 'Current outcome trade value status',
    });
    expect(panel).toHaveAttribute('data-afl-trade-value-availability', 'not_calculated');
    expect(
      within(panel).getByRole('heading', { level: 2, name: 'Trade value not calculated' })
    ).toBeVisible();
    expect(within(panel).getByText('No numerical result')).toBeVisible();
    expect(within(panel).getAllByRole('link')).toHaveLength(1);
    expect(within(panel).getByRole('link', { name: 'Await reviewed calculation' })).toHaveAttribute(
      'href',
      AFL_TRADE_METHODOLOGY_HREF
    );
    expect(panel).not.toHaveAttribute('aria-live');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('uses the detail heading level and renders public warnings without outcome claims', () => {
    const availability = {
      ...createAflTradePrePublicationAvailability(),
      warnings: [
        {
          code: 'fixture-warning',
          severity: 'warning' as const,
          message: 'A fabricated warning for presentation testing.',
        },
      ],
    };

    render(<AflTradeValueUnavailablePanel availability={availability} />);

    const panel = screen.getByRole('region', {
      name: 'Current outcome trade value status',
    });
    expect(
      within(panel).getByRole('heading', { level: 3, name: 'Trade value not calculated' })
    ).toBeVisible();
    expect(
      within(panel).getByRole('list', { name: 'Trade value availability warnings' })
    ).toHaveTextContent('A fabricated warning for presentation testing.');
    expect(panel).not.toHaveTextContent(/fair trade|score|winner|loser|probability/i);
  });

  it('falls back to one methodology link when no structured next action is available', () => {
    render(
      <AflTradeValueUnavailablePanel
        availability={{
          ...createAflTradePrePublicationAvailability(),
          nextAction: null,
        }}
      />
    );

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', AFL_TRADE_METHODOLOGY_HREF);
    expect(links[0]).toHaveClass('focus-visible:ring-2');
  });
});
