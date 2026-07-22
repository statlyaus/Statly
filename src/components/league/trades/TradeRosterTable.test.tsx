import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import type { TradePlayerDto } from '@/server/leagues/trades/tradeContracts';
import type { LeaguePlayerStatDatasetDto } from '@/types/leaguePlayerStats';

import { TradeRosterTable } from './TradeRosterTable';

const players: TradePlayerDto[] = [
  { id: 'alice', name: 'Alice Able', club: 'AAA', position: 'MID' },
  { id: 'bob', name: 'Bob Best', club: 'BBB', position: 'FWD' },
];

const playerStats: LeaguePlayerStatDatasetDto = {
  context: {
    basis: 'PER_GAME',
    period: 'SEASON',
    season: 2026,
    availableSeasons: [2026],
    dataThrough: null,
  },
  columns: [
    {
      key: 'kicks',
      label: 'Kicks',
      shortLabel: 'K',
      format: 'number',
      direction: 'HIGH_WINS',
    },
  ],
  playersById: {
    alice: { gamesPlayed: 10, values: { kicks: 12 } },
    bob: { gamesPlayed: 10, values: { kicks: 20 } },
  },
};

function Harness(): React.JSX.Element {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  return (
    <TradeRosterTable
      label="You send"
      description="Test team"
      players={players}
      playerStats={playerStats}
      selectedIds={selectedIds}
      disabled={false}
      onSelectionChange={setSelectedIds}
    />
  );
}

describe('TradeRosterTable', () => {
  it('preserves controlled selection through sorting and filtering', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const alice = screen.getByRole('checkbox', { name: /Alice Able/ });
    await user.click(alice);
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(alice.closest('tr')).toHaveAttribute('aria-selected', 'true');

    const kicksSort = screen.getByRole('button', { name: /Kicks, higher is better/ });
    await user.click(kicksSort);
    expect(
      screen.getByRole('button', {
        name: 'Kicks, higher is better, sorted descending. Activate to sort ascending.',
      })
    ).toBeInTheDocument();

    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('Bob Best')).toBeInTheDocument();

    const search = screen.getByRole('searchbox', { name: 'Search roster for you send' });
    await user.type(search, 'Bob');
    expect(screen.queryByText('Alice Able')).not.toBeInTheDocument();
    await user.clear(search);
    const restoredAlice = screen.getByRole('checkbox', { name: /Alice Able/ });
    expect(restoredAlice).toBeChecked();
    expect(restoredAlice.closest('tr')).toHaveAttribute('aria-selected', 'true');
  });
});
