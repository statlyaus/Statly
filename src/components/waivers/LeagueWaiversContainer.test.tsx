import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  subscribeToLeagueWaivers: vi.fn(),
  subscribeToUserRoster: vi.fn(),
  subscribeToLeagueActivity: vi.fn(),
  subscribeToWaiverPriority: vi.fn(),
  subscribeToLeagueWaiverPriorities: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock('@/AuthContext', () => ({
  useAuth: mocks.useAuth,
}));

vi.mock('@/components/ui', () => ({
  LoadingSpinner: () => <div data-testid="loading-spinner" />,
}));

vi.mock('@/components/waivers/WaiverFAABSystem', () => ({
  default: ({
    onSubmitClaim,
    onCancelClaim,
    onProcessClaims,
    canProcessClaims,
    processResult,
    rosterDropOptions,
  }: {
    onSubmitClaim: (claim: {
      playerId: string;
      dropPlayerId?: string;
      priority?: number;
      bidAmount?: number;
    }) => void;
    onCancelClaim: (id: string) => void;
    onProcessClaims?: () => void;
    canProcessClaims?: boolean;
    processResult?: string | null;
    rosterDropOptions: Array<{ id: string }>;
  }) => (
    <div>
      <div>drop-options:{rosterDropOptions.length}</div>
      {processResult ? <div role="status">{processResult}</div> : null}
      <button
        type="button"
        onClick={() =>
          onSubmitClaim({
            playerId: 'tom_stewart',
            dropPlayerId: 'aaron-cadman',
            priority: 1,
            bidAmount: 1,
          })
        }
      >
        submit claim
      </button>
      <button type="button" onClick={() => onCancelClaim('claim-1')}>
        cancel claim
      </button>
      {canProcessClaims ? (
        <button type="button" onClick={onProcessClaims}>
          process claims
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock('@/services/leagueDataService', () => ({
  LeagueDataService: vi.fn().mockImplementation(() => ({
    subscribeToLeagueWaivers: mocks.subscribeToLeagueWaivers,
    subscribeToUserRoster: mocks.subscribeToUserRoster,
    subscribeToLeagueActivity: mocks.subscribeToLeagueActivity,
    subscribeToWaiverPriority: mocks.subscribeToWaiverPriority,
    subscribeToLeagueWaiverPriorities: mocks.subscribeToLeagueWaiverPriorities,
    unsubscribe: mocks.unsubscribe,
  })),
}));

import LeagueWaiversContainer from './LeagueWaiversContainer';

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('LeagueWaiversContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useAuth.mockReturnValue({
      user: { uid: 'statly-dev-tester', getIdToken: vi.fn().mockResolvedValue('token') },
      loading: false,
    });
    mocks.subscribeToLeagueWaivers.mockImplementation((_leagueId, onNext) => {
      onNext([]);
      return 'waivers-sub';
    });
    mocks.subscribeToUserRoster.mockImplementation((_leagueId, _userId, onNext) => {
      onNext({
        id: 'member-1',
        userId: 'statly-dev-tester',
        teamName: 'Statly Testers',
        playerIds: ['aaron-cadman'],
        bench: [],
        emergencies: [],
        leagueId: 'league-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return 'roster-sub';
    });
    mocks.subscribeToLeagueActivity.mockImplementation((_leagueId, onNext) => {
      onNext([], { lastDoc: null });
      return 'activity-sub';
    });
    mocks.subscribeToWaiverPriority.mockImplementation((_leagueId, _userId, onNext) => {
      onNext(100);
      return 'faab-sub';
    });
    mocks.subscribeToLeagueWaiverPriorities.mockImplementation((_leagueId, onNext) => {
      onNext([]);
      return 'priorities-sub';
    });
    vi.stubGlobal('fetch', vi.fn());
  });

  it('waits for a Firebase auth token before attaching realtime subscriptions', async () => {
    let resolveToken!: (token: string) => void;
    const getIdToken = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveToken = resolve;
        })
    );
    mocks.useAuth.mockReturnValue({
      user: { uid: 'statly-dev-tester', getIdToken },
      loading: false,
    });

    render(
      <LeagueWaiversContainer
        leagueId="league-1"
        availablePlayers={[{ id: 'tom_stewart', name: 'Tom Stewart' }]}
        playersIndex={{
          'aaron-cadman': { id: 'aaron-cadman', name: 'Aaron Cadman' },
          tom_stewart: { id: 'tom_stewart', name: 'Tom Stewart' },
        }}
      />
    );

    await waitFor(() => {
      expect(getIdToken).toHaveBeenCalledTimes(1);
    });
    expect(mocks.subscribeToLeagueWaivers).not.toHaveBeenCalled();

    resolveToken('token');

    await waitFor(() => {
      expect(mocks.subscribeToLeagueWaivers).toHaveBeenCalledWith(
        'league-1',
        expect.any(Function),
        undefined,
        expect.any(Function)
      );
    });
  });

  it('falls back to API refresh when realtime subscriptions are denied', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((url) => {
      if (String(url).includes('/roster/')) {
        return Promise.resolve(jsonResponse({ data: { roster: null } }));
      }
      return Promise.resolve(jsonResponse({ claims: [], priorities: [] }));
    });
    let onWaiversError!: (error: Error) => void;
    mocks.subscribeToLeagueWaivers.mockImplementation((_leagueId, onNext, _userId, onError) => {
      onNext([]);
      onWaiversError = onError;
      return 'waivers-sub';
    });

    render(
      <LeagueWaiversContainer
        leagueId="league-1"
        availablePlayers={[{ id: 'tom_stewart', name: 'Tom Stewart' }]}
        playersIndex={{
          'aaron-cadman': { id: 'aaron-cadman', name: 'Aaron Cadman' },
          tom_stewart: { id: 'tom_stewart', name: 'Tom Stewart' },
        }}
      />
    );

    await screen.findByText('drop-options:1');
    act(() => {
      onWaiversError(new Error('permission-denied'));
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/leagues/league-1/waivers',
        expect.objectContaining({ credentials: 'include' })
      );
    });
    expect(mocks.unsubscribe).toHaveBeenCalledWith('waivers-sub');
    consoleError.mockRestore();
  });

  it('surfaces API-only refresh failures instead of silently leaving stale waiver state', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    render(
      <LeagueWaiversContainer
        leagueId="league-1"
        disableRealtime
        availablePlayers={[{ id: 'tom_stewart', name: 'Tom Stewart' }]}
        playersIndex={{
          'aaron-cadman': { id: 'aaron-cadman', name: 'Aaron Cadman' },
          tom_stewart: { id: 'tom_stewart', name: 'Tom Stewart' },
        }}
      />
    );

    expect(
      await screen.findByText(
        'Waiver data is temporarily unavailable. Showing the last loaded state.'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('drop-options:0')).toBeInTheDocument();
    consoleError.mockRestore();
  });

  it('wraps non-OK API-only refresh responses in a stale-state message', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse({ error: 'service unavailable' }, { status: 503 }));

    render(
      <LeagueWaiversContainer
        leagueId="league-1"
        disableRealtime
        availablePlayers={[{ id: 'tom_stewart', name: 'Tom Stewart' }]}
        playersIndex={{
          'aaron-cadman': { id: 'aaron-cadman', name: 'Aaron Cadman' },
          tom_stewart: { id: 'tom_stewart', name: 'Tom Stewart' },
        }}
      />
    );

    expect(
      await screen.findByText(
        'Waiver data is temporarily unavailable. Showing the last loaded state. service unavailable'
      )
    ).toBeInTheDocument();
    consoleError.mockRestore();
  });

  it('falls back visibly when realtime auth preparation fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
    mocks.useAuth.mockReturnValue({
      user: {
        uid: 'statly-dev-tester',
        getIdToken: vi.fn().mockRejectedValue(new Error('token unavailable')),
      },
      loading: false,
    });

    render(
      <LeagueWaiversContainer
        leagueId="league-1"
        availablePlayers={[{ id: 'tom_stewart', name: 'Tom Stewart' }]}
        playersIndex={{
          'aaron-cadman': { id: 'aaron-cadman', name: 'Aaron Cadman' },
          tom_stewart: { id: 'tom_stewart', name: 'Tom Stewart' },
        }}
      />
    );

    expect(
      await screen.findByText(
        'Realtime waiver updates are unavailable. Falling back to periodic refresh.'
      )
    ).toBeInTheDocument();
    expect(mocks.subscribeToLeagueWaivers).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('clears a stale submit error after successfully cancelling a claim', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'Not a league member' }, { status: 403 }))
      .mockResolvedValueOnce(jsonResponse({}, { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ data: { roster: null } }, { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ claims: [], priorities: [] }, { status: 200 }));

    render(
      <LeagueWaiversContainer
        leagueId="league-1"
        availablePlayers={[{ id: 'tom_stewart', name: 'Tom Stewart' }]}
        playersIndex={{
          'aaron-cadman': { id: 'aaron-cadman', name: 'Aaron Cadman' },
          tom_stewart: { id: 'tom_stewart', name: 'Tom Stewart' },
        }}
      />
    );

    await screen.findByText('drop-options:1');

    fireEvent.click(screen.getByRole('button', { name: 'submit claim' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not a league member');

    fireEvent.click(screen.getByRole('button', { name: 'cancel claim' }));

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('submits API-only waiver claims with the league member id from the roster payload', async () => {
    const fetchMock = vi.mocked(fetch);
    const rosterPayload = {
      data: {
        roster: {
          id: 'normalized-roster-1',
          memberId: 'member-1',
          teamName: 'Statly Testers',
          players: [{ id: 'aaron-cadman' }],
        },
      },
    };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(rosterPayload, { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ claims: [], priorities: [] }, { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'claim-1' }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse(rosterPayload, { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ claims: [], priorities: [] }, { status: 200 }));

    render(
      <LeagueWaiversContainer
        leagueId="league-1"
        disableRealtime
        availablePlayers={[{ id: 'tom_stewart', name: 'Tom Stewart' }]}
        playersIndex={{
          'aaron-cadman': { id: 'aaron-cadman', name: 'Aaron Cadman' },
          tom_stewart: { id: 'tom_stewart', name: 'Tom Stewart' },
        }}
      />
    );

    await screen.findByText('drop-options:1');

    fireEvent.click(screen.getByRole('button', { name: 'submit claim' }));

    await waitFor(() => {
      const submitCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith('/api/leagues/league-1/waivers/submit') &&
          (init as RequestInit | undefined)?.method === 'POST'
      );
      expect(submitCall).toBeDefined();
      expect(JSON.parse(String((submitCall?.[1] as RequestInit).body))).toEqual(
        expect.objectContaining({
          teamId: 'member-1',
        })
      );
    });
  });

  it('lets league owners process pending claims and refreshes API-only state', async () => {
    const fetchMock = vi.mocked(fetch);
    const rosterPayload = {
      data: {
        roster: {
          id: 'normalized-roster-1',
          memberId: 'member-1',
          teamName: 'Statly Testers',
          players: [{ id: 'aaron-cadman' }],
        },
      },
    };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(rosterPayload, { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            claims: [
              {
                id: 'claim-1',
                userId: 'statly-dev-tester',
                teamId: 'member-1',
                playerId: 'tom_stewart',
                dropPlayerId: 'aaron-cadman',
                priority: 1,
                status: 'PENDING',
                createdAt: new Date().toISOString(),
                bidAmount: 1,
              },
            ],
            priorities: [],
          },
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            processed: 1,
            results: [{ id: 'claim-1', status: 'SUCCESSFUL' }],
          },
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(jsonResponse(rosterPayload, { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            claims: [
              {
                id: 'claim-1',
                userId: 'statly-dev-tester',
                teamId: 'member-1',
                playerId: 'tom_stewart',
                dropPlayerId: 'aaron-cadman',
                priority: 1,
                status: 'SUCCESSFUL',
                createdAt: new Date().toISOString(),
                processedAt: new Date().toISOString(),
                bidAmount: 1,
              },
            ],
            priorities: [],
          },
          { status: 200 }
        )
      );

    render(
      <LeagueWaiversContainer
        leagueId="league-1"
        disableRealtime
        membersIndex={{
          'statly-dev-tester': {
            userId: 'statly-dev-tester',
            teamId: 'member-1',
            teamName: 'Statly Testers',
            role: 'owner',
          },
        }}
        availablePlayers={[{ id: 'tom_stewart', name: 'Tom Stewart' }]}
        playersIndex={{
          'aaron-cadman': { id: 'aaron-cadman', name: 'Aaron Cadman' },
          tom_stewart: { id: 'tom_stewart', name: 'Tom Stewart' },
        }}
      />
    );

    await screen.findByText('drop-options:1');

    fireEvent.click(screen.getByRole('button', { name: 'process claims' }));

    await waitFor(() => {
      const processCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith('/api/leagues/league-1/waivers/process') &&
          (init as RequestInit | undefined)?.method === 'POST'
      );
      expect(processCall).toBeDefined();
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Processed 1 waiver claim');
  });

  it('lets league commissioners see process controls', async () => {
    render(
      <LeagueWaiversContainer
        leagueId="league-1"
        membersIndex={{
          'statly-dev-tester': {
            userId: 'statly-dev-tester',
            teamId: 'member-1',
            teamName: 'Statly Testers',
            role: 'commissioner',
          },
        }}
        availablePlayers={[{ id: 'tom_stewart', name: 'Tom Stewart' }]}
        playersIndex={{
          'aaron-cadman': { id: 'aaron-cadman', name: 'Aaron Cadman' },
          tom_stewart: { id: 'tom_stewart', name: 'Tom Stewart' },
        }}
      />
    );

    await screen.findByRole('button', { name: 'process claims' });
  });

  it('hides process controls from regular league members', async () => {
    render(
      <LeagueWaiversContainer
        leagueId="league-1"
        membersIndex={{
          'statly-dev-tester': {
            userId: 'statly-dev-tester',
            teamId: 'member-1',
            teamName: 'Statly Testers',
            role: 'manager',
          },
        }}
        availablePlayers={[{ id: 'tom_stewart', name: 'Tom Stewart' }]}
        playersIndex={{
          'aaron-cadman': { id: 'aaron-cadman', name: 'Aaron Cadman' },
          tom_stewart: { id: 'tom_stewart', name: 'Tom Stewart' },
        }}
      />
    );

    await screen.findByText('drop-options:1');
    expect(screen.queryByRole('button', { name: 'process claims' })).not.toBeInTheDocument();
  });

  it('refreshes waiver state after processing even when realtime is enabled', async () => {
    const fetchMock = vi.mocked(fetch);
    const rosterPayload = {
      data: {
        roster: {
          id: 'normalized-roster-1',
          memberId: 'member-1',
          teamName: 'Statly Testers',
          players: [{ id: 'tom_stewart' }],
        },
      },
    };
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          {
            processed: 1,
            results: [{ id: 'claim-1', status: 'SUCCESSFUL' }],
          },
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(jsonResponse(rosterPayload, { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            claims: [
              {
                id: 'claim-1',
                userId: 'statly-dev-tester',
                teamId: 'member-1',
                playerId: 'tom_stewart',
                dropPlayerId: 'aaron-cadman',
                priority: 1,
                status: 'SUCCESSFUL',
                createdAt: new Date().toISOString(),
                processedAt: new Date().toISOString(),
                bidAmount: 1,
              },
            ],
            priorities: [],
          },
          { status: 200 }
        )
      );

    render(
      <LeagueWaiversContainer
        leagueId="league-1"
        membersIndex={{
          'statly-dev-tester': {
            userId: 'statly-dev-tester',
            teamId: 'member-1',
            teamName: 'Statly Testers',
            role: 'owner',
          },
        }}
        availablePlayers={[{ id: 'tom_stewart', name: 'Tom Stewart' }]}
        playersIndex={{
          'aaron-cadman': { id: 'aaron-cadman', name: 'Aaron Cadman' },
          tom_stewart: { id: 'tom_stewart', name: 'Tom Stewart' },
        }}
      />
    );

    await screen.findByText('drop-options:1');

    fireEvent.click(screen.getByRole('button', { name: 'process claims' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/leagues/league-1/roster/statly-dev-tester', {
        credentials: 'include',
        signal: expect.any(AbortSignal),
      });
      expect(fetchMock).toHaveBeenCalledWith('/api/leagues/league-1/waivers', {
        credentials: 'include',
        signal: expect.any(AbortSignal),
      });
    });
  });
});
