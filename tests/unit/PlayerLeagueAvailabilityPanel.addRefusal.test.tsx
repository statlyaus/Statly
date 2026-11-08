import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'user-1' }, loading: false }),
}));

vi.mock('@/lib/authenticatedFetch', () => ({
  authenticatedFetch: fetchMock,
}));

import { PlayerLeagueAvailabilityPanel } from '@/components/PlayerLeagueAvailabilityPanel';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('PlayerLeagueAvailabilityPanel add refusal', () => {
  it('shows the server’s reason when the add is refused', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/availability')) {
        return json({
          success: true,
          data: {
            playerId: 'player-1',
            generatedAt: new Date().toISOString(),
            leagues: [
              {
                leagueId: 'league-1',
                leagueName: 'League One',
                teamName: 'My Team',
                status: 'free-agent',
                statusLabel: 'Free agent',
                action: { type: 'add', label: 'Add', href: '/leagues/league-1' },
              },
            ],
          },
        });
      }
      return json(
        {
          success: false,
          error: {
            message: 'Your roster is full (26 of 26). Drop a player first.',
            code: 'ROSTER_FULL',
          },
        },
        422
      );
    });

    render(<PlayerLeagueAvailabilityPanel playerId="player-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add in League One' }));

    expect(
      await screen.findByText('Your roster is full (26 of 26). Drop a player first.')
    ).toBeInTheDocument();
  });
});
