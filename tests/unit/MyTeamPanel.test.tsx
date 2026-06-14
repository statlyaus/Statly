import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import MyTeamPanel from '@/components/MyTeamPanel';

const useRankingsMock = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useRankings', () => ({
  useRankings: useRankingsMock,
}));

describe('MyTeamPanel', () => {
  it('renders a statistics-led roster review table with Statly Z and compact actions', async () => {
    useRankingsMock.mockReturnValue({
      rankings: [
        { id: 'player-1', rank: 3, totalValue: 14.67, valueOverReplacement: 14.67 },
        { id: 'player-2', rank: 18, totalValue: 8.4, valueOverReplacement: 8.4 },
      ],
      loading: false,
      error: null,
    });

    render(
      <MyTeamPanel
        team={{ id: 'team-1', name: 'Robbo Rockers', players: ['player-1', 'player-2'] }}
        players={[
          {
            id: 'player-1',
            name: 'Darcy Cameron',
            position: 'RUC',
            team: 'Collingwood',
            averageScore: 102,
            projectedScore: 108,
            form: 91,
          },
          {
            id: 'player-2',
            name: 'Hayden Young',
            position: 'MID',
            team: 'Fremantle',
            averageScore: 95,
            projectedScore: 99,
            form: 88,
          },
        ]}
        showAdvancedFeatures
      />
    );

    expect(screen.getByRole('heading', { name: 'Robbo Rockers' })).toBeInTheDocument();
    expect(screen.getByText('2 / 22')).toBeInTheDocument();
    expect(screen.getByText('11.54')).toBeInTheDocument();
    expect(screen.getByText('Avg Statly Z')).toBeInTheDocument();
    expect(screen.getByText('RUC 1')).toBeInTheDocument();
    expect(screen.getByText('MID 1')).toBeInTheDocument();

    const table = screen.getByRole('table', { name: 'Robbo Rockers roster table' });
    expect(within(table).getByRole('columnheader', { name: 'Player' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Statly Z' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Avg' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();
    expect(within(table).getByText('Darcy Cameron')).toBeInTheDocument();
    expect(within(table).getByText('#3')).toBeInTheDocument();
    expect(within(table).getByText('14.67')).toBeInTheDocument();

    expect(screen.queryByText('No Team Selected')).not.toBeInTheDocument();
    expect(screen.queryByText('Optimize Lineup')).not.toBeInTheDocument();
  });

  it('renders zero Statly Z and scoring metrics as real values', () => {
    useRankingsMock.mockReturnValue({
      rankings: [{ id: 'player-zero', rank: 99, totalValue: 0, valueOverReplacement: 0 }],
      loading: false,
      error: null,
    });

    render(
      <MyTeamPanel
        team={{ id: 'team-1', name: 'Zero Squad', players: ['player-zero'] }}
        players={[
          {
            id: 'player-zero',
            name: 'Zero Value',
            position: 'MID',
            team: 'Sydney',
            averageScore: 0,
            projectedScore: 0,
            form: 0,
          },
        ]}
      />
    );

    expect(screen.getAllByText('0.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('0.0').length).toBeGreaterThan(0);
    expect(screen.getByText('Projection 0.0')).toBeInTheDocument();
  });

  it('does not crash when rankings are returned in a non-array shape', () => {
    useRankingsMock.mockReturnValue({
      rankings: { entries: [] },
      loading: false,
      error: null,
    });

    render(
      <MyTeamPanel
        team={{ id: 'team-1', name: 'Safe Rankings', players: ['player-1'] }}
        players={[
          {
            id: 'player-1',
            name: 'Fallback Player',
            position: 'MID',
            team: 'Essendon',
          },
        ]}
      />
    );

    expect(screen.getByRole('heading', { name: 'Safe Rankings' })).toBeInTheDocument();
    expect(screen.getByText('Fallback Player')).toBeInTheDocument();
    expect(screen.getByText('0 rankings loaded')).toBeInTheDocument();
  });
});
