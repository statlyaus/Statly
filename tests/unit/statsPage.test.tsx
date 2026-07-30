import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import StatsPage from '@/app/(app)/stats/page';

const statsState = vi.hoisted(() => ({
  value: {
    players: [] as Array<{ id: string; name: string; stats: Record<string, number> }>,
    loading: false,
    error: null as string | null,
  },
}));

vi.mock('@/hooks/usePlayerStats', () => ({
  usePlayerStats: () => statsState.value,
}));

vi.mock('@/components/stats/PlayerStatsTable', () => ({
  default: ({ players }: { players: Array<{ id: string }> }) => (
    <div>{players.length} players loaded</div>
  ),
}));

vi.mock('@/components/StatFilters', () => ({
  default: () => <div>Statistics filters</div>,
}));

vi.mock('@/components/ui/LoadingSpinner', () => ({
  default: () => <div>Loading statistics</div>,
}));

describe('StatsPage', () => {
  beforeEach(() => {
    statsState.value = {
      players: [],
      loading: false,
      error: null,
    };
  });

  it('renders canonical player data without enhanced-match aggregation', () => {
    statsState.value = {
      players: [{ id: 'player-1', name: 'Test Player', stats: { kicks: 12 } }],
      loading: false,
      error: null,
    };

    render(<StatsPage />);

    expect(screen.getByRole('heading', { name: 'Player Statistics' })).toBeVisible();
    expect(screen.getByText('Statistics filters')).toBeVisible();
    expect(screen.getByText('1 players loaded')).toBeVisible();
  });

  it('renders the loading state while canonical players are loading', () => {
    statsState.value = {
      players: [],
      loading: true,
      error: null,
    };

    render(<StatsPage />);

    expect(screen.getByText('Loading statistics')).toBeVisible();
  });

  it('renders the canonical player error state', () => {
    statsState.value = {
      players: [],
      loading: false,
      error: 'Failed to fetch player data',
    };

    render(<StatsPage />);

    expect(screen.getByText('Failed to fetch player data')).toBeVisible();
  });
});
