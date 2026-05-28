import React from 'react';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import '@testing-library/jest-dom/vitest';
import type { Player } from '@/types/players';

import PlayerStatsTable from './PlayerStatsTable';

vi.mock('./PlayerComparison', () => ({
  default: () => null,
}));

const players: Player[] = [
  {
    id: 'p1',
    name: 'Alpha Mid',
    team: 'Adelaide',
    position: 'MID',
    stats: {},
    avg: 104.3,
    kicks: 14,
    handballs: 16,
    marks: 5,
    tackles: 7,
  },
  {
    id: 'p2',
    name: 'Bravo Defender',
    team: 'Brisbane',
    position: 'DEF',
    stats: {},
    avg: 82.1,
    kicks: 18,
    handballs: 8,
    marks: 9,
    tackles: 4,
  },
];

describe('PlayerStatsTable', () => {
  it('exposes sortable column buttons with aria-sort state', async () => {
    const user = userEvent.setup();

    render(<PlayerStatsTable players={players} />);

    const table = screen.getByRole('table', { name: /player statistics table/i });
    const averageHeader = within(table).getByRole('columnheader', { name: /average/i });
    const averageSortButton = within(averageHeader).getByRole('button', { name: /average/i });

    expect(averageHeader).toHaveAttribute('aria-sort', 'descending');

    averageSortButton.focus();
    await user.keyboard('{Enter}');

    expect(averageHeader).toHaveAttribute('aria-sort', 'ascending');
  });

  it('renders the empty state inside the table body', async () => {
    const user = userEvent.setup();

    render(<PlayerStatsTable players={players} />);

    await user.type(screen.getByPlaceholderText(/search players or teams/i), 'No match');

    const table = screen.getByRole('table', { name: /player statistics table/i });
    const bodyRows = within(table).getAllByRole('row');

    expect(within(table).getByText(/no players match your search criteria/i)).toBeInTheDocument();
    expect(bodyRows).toHaveLength(2);
  });
});
