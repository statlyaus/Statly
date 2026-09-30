import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import type { Player } from '@/types/players';

import PlayersPageClient from './PlayersPageClient';

vi.mock('@/components/league/LeagueSocialDiscussButton', () => ({
  LeagueSocialDiscussButton: () => null,
}));

function makePlayers(count: number): Player[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `player-${index + 1}`,
    name: `Player ${String(index + 1).padStart(2, '0')}`,
    team: 'Geelong',
    position: 'MID',
  })) as Player[];
}

describe('PlayersPageClient', () => {
  it('states how many matching players are shown and reveals the rest on request', () => {
    render(<PlayersPageClient players={makePlayers(30)} />);

    expect(screen.getAllByRole('article')).toHaveLength(24);
    expect(screen.getByText('Showing 24 of 30 players')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show 6 more players' }));

    expect(screen.getAllByRole('article')).toHaveLength(30);
    expect(screen.getByText('Showing 30 of 30 players')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /more players/ })).not.toBeInTheDocument();
  });

  it('starts again from the first page when the search changes', () => {
    render(<PlayersPageClient players={makePlayers(60)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Show 24 more players' }));
    expect(screen.getAllByRole('article')).toHaveLength(48);

    fireEvent.change(screen.getByPlaceholderText('Search player or club'), {
      target: { value: 'Player 0' },
    });

    expect(screen.getAllByRole('article')).toHaveLength(9);
    expect(screen.getByText('Showing 9 of 9 players')).toBeInTheDocument();
  });

  it('uses the singular for a single matching player', () => {
    render(<PlayersPageClient players={makePlayers(25)} />);

    expect(screen.getByRole('button', { name: 'Show 1 more player' })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search player or club'), {
      target: { value: 'Player 25' },
    });

    expect(screen.getByText('Showing 1 of 1 player')).toBeInTheDocument();
  });
});
