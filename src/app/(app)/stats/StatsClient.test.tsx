import React from 'react';

import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '@testing-library/jest-dom/vitest';
import type { Player } from '@/types/players';

import StatsClient from './StatsClient';

const fetchApiMock = vi.fn();
const playerStatsTableMock = vi.fn();

vi.mock('@/lib/api', () => ({
  fetchApi: (...args: unknown[]) => fetchApiMock(...args),
}));

vi.mock('@/components/StatFilters', () => ({
  default: () => <div data-testid="stat-filters" />,
}));

vi.mock('@/components/ui', () => ({
  LoadingSpinner: () => <div data-testid="loading-spinner" />,
}));

vi.mock('@/components/stats/PlayerStatsTable', () => ({
  default: ({ players }: { players: Player[] }) => {
    playerStatsTableMock(players);
    return (
      <div data-testid="player-stats-table">{players.map((player) => player.name).join(', ')}</div>
    );
  },
}));

describe('StatsClient', () => {
  beforeEach(() => {
    fetchApiMock.mockReset();
    playerStatsTableMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps aggregate player stats into top-level table fields', async () => {
    fetchApiMock.mockResolvedValueOnce({
      success: true,
      data: [
        {
          player_id: 'player-1',
          player_name: 'Ed Richards',
          team: 'Western Bulldogs',
          position: 'MID',
          games: 2,
          fantasy_points: 120,
          averages: {
            kicks: 14.5,
            handballs: 11,
            marks: 6,
            tackles: 5.5,
            goals: 1,
            hitouts: 0,
            clearances: 4,
            inside50s: 3.5,
            rebound50s: 2,
            contestedPossessions: 8,
          },
          totals: {
            kicks: 29,
            handballs: 22,
          },
        },
      ],
    });

    render(<StatsClient />);

    await waitFor(() => expect(playerStatsTableMock).toHaveBeenCalled());

    expect(fetchApiMock).toHaveBeenCalledWith('player-stats/aggregate?limit=1000');
    expect(playerStatsTableMock).toHaveBeenLastCalledWith([
      expect.objectContaining({
        id: 'player-1',
        name: 'Ed Richards',
        team: 'Western Bulldogs',
        position: 'MID',
        games: 2,
        stats: expect.objectContaining({ kicks: 29, handballs: 22 }),
        avg: 120,
        kicks: 14.5,
        handballs: 11,
        marks: 6,
        tackles: 5.5,
        goals: 1,
        hitouts: 0,
        clearances: 4,
        inside50s: 3.5,
        rebound50s: 2,
        contestedPossessions: 8,
      }),
    ]);
    expect(screen.getByTestId('player-stats-table')).toHaveTextContent('Ed Richards');
  });

  it('shows an error state when aggregate stats fail to load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fetchApiMock.mockRejectedValueOnce(new Error('network down'));

    render(<StatsClient />);

    expect(await screen.findByText(/failed to load player stats/i)).toBeInTheDocument();
  });
});
