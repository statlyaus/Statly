import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import LeagueWaiversContainer from '@/components/waivers/LeagueWaiversContainer';

const waiverSystemSpy = vi.hoisted(() => vi.fn());

vi.mock('@/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'statly-dev-tester' },
    loading: false,
  }),
}));

vi.mock('@/components/ui', () => ({
  LoadingSpinner: () => <div role="status">Loading</div>,
}));

vi.mock('@/components/waivers/WaiverFAABSystem', () => ({
  default: (props: {
    availablePlayers: Array<{ id: string; name: string }>;
    rosterDropOptions: Array<{ id: string; name: string }>;
    userClaims: Array<{ id: string; playerName: string }>;
    selectedCategories: string[];
    currentBalance?: number;
  }) => {
    waiverSystemSpy(props);

    return <section aria-label="Waiver system">{props.availablePlayers.length} players</section>;
  },
}));

describe('LeagueWaiversContainer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads waiver tab data through the league waiver API when embedded without bootstrap props', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        claims: [
          {
            id: 'claim-1',
            userId: 'statly-dev-tester',
            teamId: 'member-1',
            playerId: 'player-1',
            priority: 1,
            status: 'PENDING',
            createdAt: '2026-06-22T00:00:00.000Z',
          },
        ],
        roster: {
          id: 'member-1',
          userId: 'statly-dev-tester',
          teamName: 'Robbo Rockers',
          playerIds: ['owned-1'],
          bench: [],
          emergencies: [],
          leagueId: 'league-1',
          updatedAt: '2026-06-22T00:00:00.000Z',
          createdAt: '2026-06-22T00:00:00.000Z',
        },
        activity: [],
        remainingFAAB: 91,
        selectedCategories: ['goals', 'tackles', 'inside50s'],
        availablePlayers: [
          {
            id: 'player-1',
            name: 'Darcy Cameron',
            team: 'COL',
            position: 'RUC',
            statlyZScore: 6.85,
            stats: { goals: 0.2, tackles: 4.8, inside50s: 1.1 },
          },
        ],
        playersIndex: {
          'owned-1': { id: 'owned-1', name: 'Nick Daicos', team: 'COL', position: 'MID' },
          'player-1': { id: 'player-1', name: 'Darcy Cameron', team: 'COL', position: 'RUC' },
        },
        nextPlayersCursor: 'player-1',
        activityNextCursor: null,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<LeagueWaiversContainer leagueId="league-1" membersIndex={{}} />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/api/leagues/league-1/waivers?playersLimit=100&activityLimit=50',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/leagues/league-1/players'),
      expect.anything()
    );
    await waitFor(() => {
      expect(waiverSystemSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          availablePlayers: [
            {
              id: 'player-1',
              name: 'Darcy Cameron',
              team: 'COL',
              position: 'RUC',
              statlyZScore: 6.85,
              stats: { goals: 0.2, tackles: 4.8, inside50s: 1.1 },
            },
          ],
          rosterDropOptions: [
            { id: 'owned-1', name: 'Nick Daicos', team: 'COL', position: 'MID' },
          ],
          userClaims: [expect.objectContaining({ id: 'claim-1', playerName: 'Darcy Cameron' })],
          selectedCategories: ['goals', 'tackles', 'inside50s'],
          currentBalance: 91,
          hasMorePlayers: true,
        })
      );
    });
  });
});
