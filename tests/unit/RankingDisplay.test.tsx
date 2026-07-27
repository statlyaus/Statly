import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import RankingDisplay from '@/components/RankingDisplay';

const fetchApiMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  fetchApi: fetchApiMock,
}));

describe('RankingDisplay', () => {
  beforeEach(() => {
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
  });

  it('renders Statly Z with accessible, theme-aware chip styling', async () => {
    render(<RankingDisplay playerId="player-1" variant="chip" />);

    const chip = await screen.findByRole('status');

    expect(screen.getByText('#3')).toBeInTheDocument();
    expect(screen.getByText('Z 14.67')).toBeInTheDocument();
    expect(chip).toHaveAccessibleName('Rank 3, Statly Z 14.67');
    expect(chip).toHaveClass('bg-primary/10', 'text-primary', 'ring-primary/20', 'text-xs');
    expect(chip.className).not.toMatch(/text-\[(?:9|10|11)px\]/);
  });

  it('keeps the compact chip on the same semantic 12px treatment', async () => {
    render(<RankingDisplay playerId="player-1" variant="chip" compact />);

    const chip = await screen.findByRole('status');

    expect(chip).toHaveAccessibleName('Rank 3, Statly Z 14.67');
    expect(chip).toHaveClass('bg-primary/10', 'text-primary', 'ring-primary/20', 'text-xs');
    expect(chip.className).not.toMatch(/text-\[(?:9|10|11)px\]/);
    expect(screen.queryByText('Z 14.67')).not.toBeInTheDocument();
  });
});
