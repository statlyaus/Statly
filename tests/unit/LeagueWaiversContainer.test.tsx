import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import LeagueWaiversContainer from '@/components/waivers/LeagueWaiversContainer';

const waiverSystemSpy = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({
  user: { uid: 'statly-dev-tester' } as { uid: string } | null,
  loading: false,
}));

vi.mock('@/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('@/components/ui/LoadingSpinner', () => ({
  default: () => <div role="status">Loading</div>,
}));

vi.mock('@/components/waivers/WaiverFAABSystem', () => ({
  default: (props: {
    availablePlayers: Array<{ id: string; name: string }>;
    rosterDropOptions: Array<{ id: string; name: string }>;
    userClaims: Array<{ id: string; playerName: string }>;
    selectedCategories: string[];
    currentBalance?: number;
    onSubmitClaim?: (claim: { playerId: string; bidAmount: number }) => void;
  }) => {
    waiverSystemSpy(props);

    return (
      <section aria-label="Waiver system">
        <span>{props.availablePlayers.length} players</span>
        <button
          type="button"
          onClick={() => props.onSubmitClaim?.({ playerId: 'player-1', bidAmount: 1 })}
        >
          Submit claim
        </button>
      </section>
    );
  },
}));

describe('LeagueWaiversContainer', () => {
  afterEach(() => {
    waiverSystemSpy.mockClear();
    authState.user = { uid: 'statly-dev-tester' };
    authState.loading = false;
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
          rosterDropOptions: [{ id: 'owned-1', name: 'Nick Daicos', team: 'COL', position: 'MID' }],
          userClaims: [expect.objectContaining({ id: 'claim-1', playerName: 'Darcy Cameron' })],
          selectedCategories: ['goals', 'tackles', 'inside50s'],
          currentBalance: 91,
          hasMorePlayers: true,
        })
      );
    });
  });

  it('loads waiver data with the page-level user id when auth context has not hydrated', async () => {
    authState.user = null;
    const player = {
      id: 'player-1',
      name: 'Darcy Cameron',
      team: 'COL',
      position: 'RUC',
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        claims: [],
        roster: {
          id: 'member-1',
          userId: 'statly-dev-tester',
          teamName: 'Robbo Rockers',
          playerIds: [],
          bench: [],
          emergencies: [],
          leagueId: 'league-1',
          updatedAt: '2026-06-22T00:00:00.000Z',
          createdAt: '2026-06-22T00:00:00.000Z',
        },
        activity: [],
        remainingFAAB: 91,
        selectedCategories: ['goals', 'tackles', 'inside50s'],
        availablePlayers: [player],
        playersIndex: {
          'player-1': { id: 'player-1', name: 'Darcy Cameron', team: 'COL', position: 'RUC' },
        },
        nextPlayersCursor: null,
        activityNextCursor: null,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <LeagueWaiversContainer
        leagueId="league-1"
        currentUserId="statly-dev-tester"
        membersIndex={{}}
      />
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/api/leagues/league-1/waivers?playersLimit=100&activityLimit=50',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
    await waitFor(() => {
      expect(waiverSystemSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          availablePlayers: [player],
          currentBalance: 91,
        })
      );
    });
    expect(screen.getByLabelText('Waiver system')).toBeTruthy();
  });

  it('lets users retry waiver loading after a failed snapshot request', async () => {
    const user = userEvent.setup();
    const player = {
      id: 'player-1',
      name: 'Darcy Cameron',
      team: 'COL',
      position: 'RUC',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Waiver data temporarily unavailable' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          claims: [],
          roster: {
            id: 'member-1',
            userId: 'statly-dev-tester',
            teamName: 'Robbo Rockers',
            playerIds: [],
            bench: [],
            emergencies: [],
            leagueId: 'league-1',
            updatedAt: '2026-06-22T00:00:00.000Z',
            createdAt: '2026-06-22T00:00:00.000Z',
          },
          activity: [],
          remainingFAAB: 91,
          selectedCategories: ['goals', 'tackles', 'inside50s'],
          availablePlayers: [player],
          playersIndex: {
            'player-1': { id: 'player-1', name: 'Darcy Cameron', team: 'COL', position: 'RUC' },
          },
          nextPlayersCursor: null,
          activityNextCursor: null,
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<LeagueWaiversContainer leagueId="league-1" membersIndex={{}} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Waiver data temporarily unavailable');
    });

    await user.click(screen.getByRole('button', { name: 'Retry waiver data' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
    expect(waiverSystemSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        availablePlayers: [player],
        currentBalance: 91,
      })
    );
  });

  it('keeps the loaded free-agent table when claim refresh snapshots omit players', async () => {
    const user = userEvent.setup();
    const player = {
      id: 'player-1',
      name: 'Darcy Cameron',
      team: 'COL',
      position: 'RUC',
      statlyZScore: 6.85,
      stats: { goals: 0.2, tackles: 4.8, inside50s: 1.1 },
    };
    const roster = {
      id: 'member-1',
      userId: 'statly-dev-tester',
      teamName: 'Robbo Rockers',
      playerIds: ['owned-1'],
      bench: [],
      emergencies: [],
      leagueId: 'league-1',
      updatedAt: '2026-06-22T00:00:00.000Z',
      createdAt: '2026-06-22T00:00:00.000Z',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          claims: [],
          roster,
          activity: [],
          remainingFAAB: 91,
          selectedCategories: ['goals', 'tackles', 'inside50s'],
          availablePlayers: [player],
          playersIndex: {
            'owned-1': { id: 'owned-1', name: 'Nick Daicos', team: 'COL', position: 'MID' },
            'player-1': { id: 'player-1', name: 'Darcy Cameron', team: 'COL', position: 'RUC' },
          },
          nextPlayersCursor: 'player-1',
          activityNextCursor: null,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      })
      .mockResolvedValueOnce({
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
              bidAmount: 1,
              createdAt: '2026-06-22T00:00:00.000Z',
            },
          ],
          roster,
          activity: [],
          remainingFAAB: 90,
          selectedCategories: ['goals', 'tackles', 'inside50s'],
          availablePlayers: [],
          playersIndex: {
            'player-1': { id: 'player-1', name: 'Darcy Cameron', team: 'COL', position: 'RUC' },
          },
          nextPlayersCursor: null,
          activityNextCursor: null,
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<LeagueWaiversContainer leagueId="league-1" membersIndex={{}} />);

    await waitFor(() => {
      expect(waiverSystemSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ availablePlayers: [player] })
      );
    });

    await user.click(screen.getByRole('button', { name: 'Submit claim' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/leagues/league-1/waivers/submit',
        expect.objectContaining({ method: 'POST' })
      );
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        'http://localhost:3000/api/leagues/league-1/waivers?playersLimit=0&activityLimit=50',
        expect.any(Object)
      );
    });
    await waitFor(() => {
      expect(waiverSystemSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          availablePlayers: [player],
          userClaims: [expect.objectContaining({ id: 'claim-1', playerName: 'Darcy Cameron' })],
          currentBalance: 90,
        })
      );
    });
  });
});
