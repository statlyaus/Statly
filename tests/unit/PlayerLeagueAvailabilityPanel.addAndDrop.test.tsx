import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const AVAILABILITY = {
  success: true,
  data: {
    playerId: 'player-1',
    generatedAt: '2026-07-01T00:00:00.000Z',
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
};

function rosterFull(dropCandidates: unknown[]) {
  return json(
    {
      success: false,
      error: {
        message: 'Your roster is full (2 of 2). Choose a player to drop.',
        code: 'ROSTER_FULL',
        details: { dropCandidates },
      },
    },
    422
  );
}

const CANDIDATES = [
  { playerId: 'keep-1', name: 'Keep Player', position: 'MID', club: 'Carlton' },
  { playerId: 'drop-1', name: 'Drop Player', position: 'FWD', club: 'Geelong' },
];

describe('PlayerLeagueAvailabilityPanel add and drop', () => {
  beforeEach(() => fetchMock.mockReset());

  it('opens a drop picker on a full roster and adds and drops in one request', async () => {
    const addBodies: unknown[] = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (!String(url).includes('/roster/add')) return json(AVAILABILITY);
      const body = JSON.parse(String(init?.body)) as { dropPlayerId?: string };
      addBodies.push(body);
      if (!body.dropPlayerId) return rosterFull(CANDIDATES);
      return json({
        success: true,
        data: {
          leagueId: 'league-1',
          playerId: 'player-1',
          rosterId: 'row-1',
          playerIds: ['keep-1', 'player-1'],
          dropped: { playerId: 'drop-1', actionId: 'action-1', processingAt: '2026-07-02' },
        },
      });
    });

    render(<PlayerLeagueAvailabilityPanel playerId="player-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add in League One' }));

    const picker = await screen.findByRole('group', { name: 'Choose a player to drop' });
    expect(within(picker).getByRole('button', { name: 'Add and drop' })).toBeDisabled();
    fireEvent.click(within(picker).getByRole('radio', { name: /Drop Player/ }));
    fireEvent.click(within(picker).getByRole('button', { name: 'Add and drop Drop Player' }));

    expect(
      await screen.findByText('Added to My Team. Drop Player dropped to waivers.')
    ).toBeInTheDocument();
    expect(addBodies).toEqual([
      { playerId: 'player-1' },
      { playerId: 'player-1', dropPlayerId: 'drop-1' },
    ]);
    expect(screen.queryByRole('group', { name: 'Choose a player to drop' })).toBeNull();
  });

  it('shows the server’s refusal and keeps the picker when the add and drop is refused', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (!String(url).includes('/roster/add')) return json(AVAILABILITY);
      const body = JSON.parse(String(init?.body)) as { dropPlayerId?: string };
      if (!body.dropPlayerId) return rosterFull(CANDIDATES);
      return json(
        {
          success: false,
          error: {
            message: "Drop Player's game has started; he can be dropped after the round ends.",
            code: 'DROP_PLAYER_LOCKED',
          },
        },
        409
      );
    });

    render(<PlayerLeagueAvailabilityPanel playerId="player-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add in League One' }));
    const picker = await screen.findByRole('group', { name: 'Choose a player to drop' });
    fireEvent.click(within(picker).getByRole('radio', { name: /Drop Player/ }));
    fireEvent.click(within(picker).getByRole('button', { name: 'Add and drop Drop Player' }));

    expect(
      await screen.findByText(
        "Drop Player's game has started; he can be dropped after the round ends."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Choose a player to drop' })).toBeInTheDocument();
  });

  it('links to My Team when no player can be dropped', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      !String(url).includes('/roster/add') ? json(AVAILABILITY) : rosterFull([])
    );

    render(<PlayerLeagueAvailabilityPanel playerId="player-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add in League One' }));

    expect(await screen.findByRole('link', { name: 'My Team' })).toHaveAttribute(
      'href',
      '/leagues/league-1?tab=lineup'
    );
  });
});
