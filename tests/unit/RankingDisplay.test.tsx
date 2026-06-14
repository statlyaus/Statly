import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import RankingDisplay from '@/components/RankingDisplay';

const fetchApiMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  fetchApi: fetchApiMock,
}));

describe('RankingDisplay', () => {
  it('renders Statly Z from the wrapped rankings API response', async () => {
    fetchApiMock.mockResolvedValue({
      success: true,
      data: {
        players: [
          {
            id: 'player-1',
            name: 'Darcy Cameron',
            rank: 3,
            totalValue: 14.67,
          },
        ],
      },
    });

    render(<RankingDisplay playerId="player-1" variant="chip" />);

    expect(await screen.findByText('#3')).toBeInTheDocument();
    expect(screen.getByText('Z 14.67')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAccessibleName('Rank 3, Statly Z 14.67');
  });
});
