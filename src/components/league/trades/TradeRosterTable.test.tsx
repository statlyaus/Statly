import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { TradeTeamDto } from '@/server/leagues/trades/tradeContracts';
import type { LeaguePlayerStatDatasetDto } from '@/types/leaguePlayerStats';

import { TradeRosterTable } from './TradeRosterTable';

vi.mock('next/image', () => ({
  default: ({
    alt = '',
    unoptimized: _unoptimized,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean }) => (
    <img alt={alt} {...props} />
  ),
}));

const team: TradeTeamDto = {
  memberId: 'alpha',
  teamName: 'Alpha FC',
  teamLogoUrl: null,
  isViewer: true,
  players: [
    { id: 'alice', name: 'Alice Able', club: 'Adelaide Crows', position: 'MID' },
    { id: 'bob', name: 'Bob Best', club: 'Western Bulldogs', position: 'FWD' },
    { id: 'charlie', name: 'Charlie Calm', club: 'Carlton', position: 'DEF' },
    { id: 'dana', name: 'Dana Dash', club: 'Essendon', position: 'RUC' },
  ],
};

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
      key: 'inside50s',
      label: 'Inside 50s',
      shortLabel: 'I50',
      format: 'number',
      direction: 'HIGH_WINS',
    },
  ],
  playersById: {
    alice: { gamesPlayed: 10, values: { inside50s: 12 } },
    bob: { gamesPlayed: 10, values: { inside50s: 20 } },
    charlie: { gamesPlayed: 10, values: { inside50s: null } },
  },
};

function Harness({
  initialSelectedIds = [],
  onToggle,
}: {
  initialSelectedIds?: string[];
  onToggle?: (playerId: string) => void;
}) {
  const [selectedIds, setSelectedIds] = useState(initialSelectedIds);

  return (
    <TradeRosterTable
      team={team}
      playerStats={playerStats}
      selectedIds={selectedIds}
      disabled={false}
      onTogglePlayer={(playerId) => {
        onToggle?.(playerId);
        setSelectedIds((current) =>
          current.includes(playerId)
            ? current.filter((selectedId) => selectedId !== playerId)
            : [...current, playerId]
        );
      }}
    />
  );
}

describe('TradeRosterTable', () => {
  it('uses a symmetric team-relative heading and reports the selected count', () => {
    render(<Harness initialSelectedIds={['alice']} />);

    expect(screen.getByRole('heading', { name: 'Alpha FC sends' })).toBeInTheDocument();
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Alice Able/ })).toBeChecked();
    expect(screen.getByRole('row', { name: /Alice Able/ })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  it('toggles exactly once from the row, native checkbox, or player-name label', async () => {
    const user = userEvent.setup();
    const onTogglePlayer = vi.fn();
    render(
      <TradeRosterTable
        team={team}
        playerStats={playerStats}
        selectedIds={[]}
        disabled={false}
        onTogglePlayer={onTogglePlayer}
      />
    );

    await user.click(screen.getByRole('row', { name: /Alice Able/ }));
    expect(onTogglePlayer).toHaveBeenCalledTimes(1);
    expect(onTogglePlayer).toHaveBeenLastCalledWith('alice');

    await user.click(screen.getByRole('checkbox', { name: /Alice Able/ }));
    expect(onTogglePlayer).toHaveBeenCalledTimes(2);
    expect(onTogglePlayer).toHaveBeenLastCalledWith('alice');

    await user.click(screen.getByText('Alice Able').closest('label')!);
    expect(onTogglePlayer).toHaveBeenCalledTimes(3);
    expect(onTogglePlayer).toHaveBeenLastCalledWith('alice');
  });

  it('toggles the native checkbox exactly once with Space and preserves focus after rerender', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<Harness onToggle={onToggle} />);

    const aliceCheckbox = screen.getByRole('checkbox', { name: /Alice Able/ });
    aliceCheckbox.focus();
    expect(aliceCheckbox).toHaveFocus();

    await user.keyboard('[Space]');
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenLastCalledWith('alice');
    expect(screen.getByRole('checkbox', { name: /Alice Able/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Alice Able/ })).toHaveFocus();

    await user.keyboard('[Space]');
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('checkbox', { name: /Alice Able/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Alice Able/ })).toHaveFocus();
  });

  it('prevents row, checkbox, and label toggles while disabled', async () => {
    const user = userEvent.setup();
    const onTogglePlayer = vi.fn();
    render(
      <TradeRosterTable
        team={team}
        playerStats={playerStats}
        selectedIds={[]}
        disabled
        onTogglePlayer={onTogglePlayer}
      />
    );

    const aliceRow = screen.getByRole('row', { name: /Alice Able/ });
    const aliceHeader = within(aliceRow).getByRole('rowheader');
    expect(aliceRow).toHaveClass('cursor-default');
    expect(aliceRow).not.toHaveClass('cursor-pointer');
    expect(aliceHeader).not.toHaveClass('group-hover:bg-[color:var(--trade-surface-subtle)]');
    expect(aliceRow).not.toHaveClass('hover:bg-[color:var(--trade-surface-subtle)]');

    await user.click(aliceRow);
    await user.click(screen.getByRole('checkbox', { name: /Alice Able/ }));
    await user.click(screen.getByText('Alice Able').closest('label')!);

    expect(onTogglePlayer).not.toHaveBeenCalled();
  });

  it('exposes complete category names and explicit visible sort states', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const playerSort = screen.getByRole('button', { name: /Player.*sorted A to Z/i });
    const inside50sSort = screen.getByRole('button', {
      name: /Inside 50s, higher is better.*Not sorted/i,
    });
    expect(within(playerSort).getByText('A–Z')).toHaveClass('text-xs');
    expect(within(inside50sSort).getByText('—')).toBeInTheDocument();

    await user.click(inside50sSort);
    const descendingSort = screen.getByRole('button', {
      name: /Inside 50s, higher is better.*sorted high to low/i,
    });
    expect(within(descendingSort).getByText('High–low')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Player. Not sorted. Activate to sort.' })
    ).toBeInTheDocument();

    await user.click(descendingSort);
    expect(
      within(
        screen.getByRole('button', {
          name: /Inside 50s, higher is better.*sorted low to high/i,
        })
      ).getByText('Low–high')
    ).toBeInTheDocument();
  });

  it('keeps null and absent stats last in both numeric sort directions', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const inside50sSort = screen.getByRole('button', {
      name: /Inside 50s, higher is better.*Not sorted/i,
    });
    await user.click(inside50sSort);

    let rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('Bob Best')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Alice Able')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Charlie Calm')).toBeInTheDocument();
    expect(within(rows[3]).getByText('Dana Dash')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', {
        name: /Inside 50s, higher is better.*sorted high to low/i,
      })
    );

    rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('Alice Able')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Bob Best')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Charlie Calm')).toBeInTheDocument();
    expect(within(rows[3]).getByText('Dana Dash')).toBeInTheDocument();
  });

  it('renders AFL club identity and a neutral position badge', () => {
    render(<Harness />);

    const aliceRow = screen.getByRole('row', { name: /Alice Able/ });
    expect(within(aliceRow).getByRole('img', { name: 'Adelaide logo' })).toHaveAttribute(
      'src',
      '/logos/Adelaide.svg'
    );
    expect(within(aliceRow).getByText('ADL')).toBeInTheDocument();
    expect(within(aliceRow).getByText('MID')).toBeInTheDocument();
  });

  it('uses direct selection tokens for selected rows, checkboxes, and active sort state', () => {
    render(<Harness initialSelectedIds={['alice']} />);

    const aliceRow = screen.getByRole('row', { name: /Alice Able/ });
    const aliceHeader = within(aliceRow).getByRole('rowheader');
    const aliceCheckbox = within(aliceRow).getByRole('checkbox', { name: /Alice Able/ });
    const playerSort = screen.getByRole('button', { name: /Player.*sorted A to Z/i });

    expect(aliceRow).toHaveClass('bg-[color:var(--trade-selection-soft)]');
    expect(aliceHeader).toHaveClass(
      'border-l-[color:var(--trade-selection)]',
      'bg-[color:var(--trade-selection-soft)]'
    );
    expect(aliceCheckbox).toHaveClass('accent-[var(--trade-selection)]');
    expect(within(playerSort).getByText('A–Z')).toHaveClass('text-[color:var(--trade-selection)]');
    expect(playerSort.querySelector('svg')).toHaveClass('text-[color:var(--trade-selection)]');
  });

  it('preserves controlled selection through sorting and filtering', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const alice = screen.getByRole('checkbox', { name: /Alice Able/ });
    await user.click(alice);

    await user.click(
      screen.getByRole('button', { name: /Inside 50s, higher is better.*Not sorted/i })
    );
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('Bob Best')).toBeInTheDocument();

    const search = screen.getByRole('searchbox', { name: 'Search Alpha FC roster' });
    await user.type(search, 'Bob');
    expect(screen.queryByText('Alice Able')).not.toBeInTheDocument();
    await user.clear(search);

    const restoredAlice = screen.getByRole('checkbox', { name: /Alice Able/ });
    expect(restoredAlice).toBeChecked();
    expect(restoredAlice.closest('tr')).toHaveAttribute('aria-selected', 'true');
  });

  it('distinguishes an empty roster from a search with no results', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness />);

    await user.type(screen.getByRole('searchbox', { name: 'Search Alpha FC roster' }), 'zzz');
    expect(screen.getByText('No players match.')).toBeInTheDocument();

    rerender(
      <TradeRosterTable
        team={{ ...team, players: [] }}
        playerStats={playerStats}
        selectedIds={[]}
        disabled={false}
        onTogglePlayer={vi.fn()}
      />
    );
    expect(screen.getByText('No rostered players are available.')).toBeInTheDocument();
  });
});
