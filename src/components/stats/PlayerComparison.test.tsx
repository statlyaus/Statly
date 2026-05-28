import React from 'react';

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import '@testing-library/jest-dom/vitest';
import type { Player } from '@/types/players';

import PlayerComparison from './PlayerComparison';

const alpha: Player = {
  id: 'alpha',
  name: 'Alpha Mid',
  team: 'Adelaide',
  position: 'MID',
  stats: {},
  kicks: 14,
  handballs: 16,
};

const bravo: Player = {
  id: 'bravo',
  name: 'Bravo Defender',
  team: 'Brisbane',
  position: 'DEF',
  stats: {},
  kicks: 18,
  handballs: 8,
};

const players = [alpha, bravo];

describe('PlayerComparison', () => {
  it('seeds selected players on reopen without overwriting the open modal', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <PlayerComparison
        players={players}
        isOpen
        onClose={onClose}
        initialPlayers={[alpha]}
      />
    );

    const selectedPlayers = () =>
      screen.getByRole('group', { name: /selected players/i });

    expect(within(selectedPlayers()).getByText('Alpha Mid')).toBeInTheDocument();

    rerender(
      <PlayerComparison
        players={players}
        isOpen
        onClose={onClose}
        initialPlayers={[bravo]}
      />
    );

    expect(within(selectedPlayers()).getByText('Alpha Mid')).toBeInTheDocument();
    expect(within(selectedPlayers()).queryByText('Bravo Defender')).not.toBeInTheDocument();

    rerender(
      <PlayerComparison
        players={players}
        isOpen={false}
        onClose={onClose}
        initialPlayers={[bravo]}
      />
    );
    rerender(
      <PlayerComparison
        players={players}
        isOpen
        onClose={onClose}
        initialPlayers={[bravo]}
      />
    );

    expect(within(selectedPlayers()).getByText('Bravo Defender')).toBeInTheDocument();
    expect(within(selectedPlayers()).queryByText('Alpha Mid')).not.toBeInTheDocument();
  });
});
