import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LeaderboardModule from './LeaderboardModule';

const mocks = vi.hoisted(() => ({
  usePlayerStatsAggregate: vi.fn(),
}));

vi.mock('@/hooks/usePlayerStats', () => ({
  usePlayerStatsAggregate: mocks.usePlayerStatsAggregate,
}));

vi.mock('@/components/TeamLogo', () => ({
  TeamLogo: ({ team }: { team: string }) => <span>{team}</span>,
}));

describe('LeaderboardModule degraded states', () => {
  beforeEach(() => {
    mocks.usePlayerStatsAggregate.mockReset();
  });

  it('surfaces aggregate API failures instead of masking them as an empty leaderboard', () => {
    mocks.usePlayerStatsAggregate.mockReturnValue({
      data: [],
      loading: false,
      error: 'HTTP 503 Service Unavailable',
      season: 2026,
      refetch: vi.fn(),
    });

    render(<LeaderboardModule refreshTrigger={0} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Leaderboard unavailable');
    expect(screen.getByText(/HTTP 503 Service Unavailable/)).toBeInTheDocument();
    expect(screen.queryByText('No season leaders yet')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open rankings' })).toHaveAttribute(
      'href',
      '/rankings'
    );
  });

  it('keeps true empty aggregate data distinct from failed aggregate loads', () => {
    mocks.usePlayerStatsAggregate.mockReturnValue({
      data: [],
      loading: false,
      error: null,
      season: 2026,
      refetch: vi.fn(),
    });

    render(<LeaderboardModule refreshTrigger={0} />);

    expect(screen.getByText('No season leaders yet')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
