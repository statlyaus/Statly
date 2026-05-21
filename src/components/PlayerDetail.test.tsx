import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PlayerDetail } from './PlayerDetail';
import type { Player } from '@/types/players';

const mocks = vi.hoisted(() => ({
  fetchApi: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  fetchApi: mocks.fetchApi,
}));

vi.mock('@/hooks/useLeagueStatColumns', () => ({
  useLeagueStatColumns: () => ({
    visibleKeys: ['kicks'],
    allKeys: ['kicks'],
    toggleKey: vi.fn(),
    defaultKeys: ['kicks'],
    labels: { kicks: { label: 'Kicks', short: 'K' } },
  }),
}));

vi.mock('./PlayerSummaryCard', () => ({
  default: ({ player }: { player: Player }) => <div>{player.name} summary</div>,
}));

vi.mock('./PlayerChart', () => ({
  default: () => <div>Player chart</div>,
}));

const player = {
  id: 'player-1',
  name: 'Player One',
  team: 'Carlton',
  position: 'MID',
} as Player;

describe('PlayerDetail degraded states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the player summary visible and retries failed match history loads', async () => {
    mocks.fetchApi.mockRejectedValueOnce(new Error('HTTP 503 Service Unavailable')).mockResolvedValue({
      data: [
        {
          roundNumber: 1,
          opponent: 'Richmond',
          season: 2026,
          matchId: 'match-1',
          date: '2026-03-20T08:00:00.000Z',
          stats: { kicks: 12 },
        },
      ],
    });

    render(<PlayerDetail player={player} />);

    expect(screen.getByText('Player One summary')).toBeInTheDocument();
    expect(await screen.findAllByRole('alert')).toHaveLength(2);
    expect(screen.getAllByText(/HTTP 503 Service Unavailable/)).toHaveLength(2);
    expect(console.error).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /retry match history/i }));

    await waitFor(() => {
      expect(screen.getByText('Player chart')).toBeInTheDocument();
      expect(screen.getByTitle('Richmond')).toHaveTextContent('RIC');
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
