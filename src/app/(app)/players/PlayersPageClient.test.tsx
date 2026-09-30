import { fireEvent, render, screen, within } from '@testing-library/react';

import type { Player } from '@/types/players';

import PlayersPageClient from './PlayersPageClient';

function makePlayer(index: number, overrides: Partial<Player> = {}): Player {
  return {
    id: `player-${index}`,
    name: `Player ${String(index).padStart(2, '0')}`,
    team: index % 2 ? 'Geelong' : 'Carlton',
    position: 'MID',
    games: 2,
    statsSeason: 2025,
    stats: { goals: index, tackles: 10 },
    ...overrides,
  } as Player;
}

function makePlayers(count: number): Player[] {
  return Array.from({ length: count }, (_, index) => makePlayer(index + 1));
}

const goalsHeader = () => screen.getByRole('button', { name: 'Sort by Goals' }).closest('th');

const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

describe('PlayersPageClient', () => {
  it('lists players in a table of per-game averages for the default categories', () => {
    render(<PlayersPageClient players={[makePlayer(3)]} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Players' })).toBeInTheDocument();
    const header = within(screen.getByRole('table')).getAllByRole('columnheader');
    expect(header.map((cell) => cell.textContent?.replace(/[▲▼]/g, ''))).toEqual([
      'Player',
      'GP',
      'G',
      'T',
      'I50',
      'ITC',
      'CM',
      'R50',
      'CP',
      'ED',
      'SI',
    ]);
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toContain('G Goals');

    const [row] = bodyRows();
    expect(within(row).getByRole('link', { name: 'Player 03' })).toHaveAttribute(
      'href',
      '/players/player-3'
    );
    expect(row).toHaveTextContent('Geelong · MID');
    expect(
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent)
    ).toEqual(['2', '1.5', '5', '–', '–', '–', '–', '–', '–', '–']);
  });

  it('sorts by a category from its column header, best first', () => {
    render(<PlayersPageClient players={makePlayers(3)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sort by Goals' }));

    expect(goalsHeader()).toHaveAttribute('aria-sort', 'descending');
    expect(bodyRows()[0]).toHaveTextContent('Player 03');

    fireEvent.click(screen.getByRole('button', { name: 'Sort by Goals' }));

    expect(goalsHeader()).toHaveAttribute('aria-sort', 'ascending');
    expect(bodyRows()[0]).toHaveTextContent('Player 01');
  });

  it('states how many matching players are shown and reveals the rest on request', () => {
    render(<PlayersPageClient players={makePlayers(60)} />);

    expect(bodyRows()).toHaveLength(50);
    expect(screen.getByText('Showing 50 of 60 players')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show 10 more players' }));

    expect(bodyRows()).toHaveLength(60);
    expect(screen.queryByRole('button', { name: /more player/ })).not.toBeInTheDocument();
  });

  it('starts again from the first page when the search or club changes', () => {
    render(<PlayersPageClient players={makePlayers(120)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Show 50 more players' }));
    expect(bodyRows()).toHaveLength(100);

    fireEvent.change(screen.getByLabelText('Filter by club'), { target: { value: 'Geelong' } });
    expect(screen.getByText('Showing 50 of 60 players')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search players'), { target: { value: 'Player 101' } });
    expect(screen.getByText('Showing 1 of 1 player')).toBeInTheDocument();
  });

  it('explains an empty result', () => {
    render(<PlayersPageClient players={makePlayers(2)} />);

    fireEvent.change(screen.getByLabelText('Search players'), { target: { value: 'nobody' } });

    expect(screen.getByText('No players match those filters')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
