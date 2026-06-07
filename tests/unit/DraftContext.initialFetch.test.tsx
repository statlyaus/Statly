import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchApi, socketState } = vi.hoisted(() => ({
  fetchApi: vi.fn(),
  socketState: {
    current: null as any,
  },
}));

vi.mock('@/contexts/SocketContext', () => ({
  useSocket: () => socketState.current,
}));

vi.mock('@/lib/api', () => ({
  fetchApi,
}));

import { DraftProvider, useDraft } from '@/contexts/DraftContext';

function DraftStateProbe() {
  const draft = useDraft();

  return (
    <div>
      <div data-testid="loading">{String(draft.isLoading)}</div>
      <div data-testid="draft-name">{draft.draft?.name ?? 'missing'}</div>
      <div data-testid="current-pick">{draft.draft?.currentPick ?? 'missing'}</div>
      <div data-testid="player-count">{draft.availablePlayers.length}</div>
      <div data-testid="pick-order">{draft.picks.map((pick) => pick.id).join(',')}</div>
      <button type="button" onClick={() => void draft.makePick('player-1')}>
        Pick player 1
      </button>
    </div>
  );
}

describe('DraftProvider initial hydration', () => {
  beforeEach(() => {
    fetchApi.mockReset();
    socketState.current = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches the draft snapshot on mount when no initial or socket snapshot is available', async () => {
    fetchApi.mockImplementation(async (endpoint: string) => {
      if (endpoint === 'drafts/cmevh14aq001lux1gottrhp3a') {
        return {
          success: true,
          data: {
            id: 'cmevh14aq001lux1gottrhp3a',
            name: 'Test AFL Champions League - LIVE',
            leagueId: 'league-1',
            status: 'LIVE',
            currentPick: 1,
            totalPicks: 264,
            round: 1,
            direction: 'FORWARD',
            participants: [
              {
                slot: 1,
                member: {
                  id: 'member-1',
                  userId: 'user-1',
                  displayName: 'Robbo Rockers',
                },
              },
            ],
            selectedCategories: [],
            draftReadiness: null,
            liveState: {},
          },
        };
      }

      if (endpoint === 'drafts/cmevh14aq001lux1gottrhp3a/players?page=1&pageSize=100') {
        return {
          success: true,
          data: {
            players: [
              {
                id: 'caleb_daniel',
                name: 'Caleb Daniel',
                position: 'DEF',
                club: 'North Melbourne',
              },
            ],
            pagination: {
              hasMore: false,
            },
          },
        };
      }

      throw new Error(`Unexpected endpoint: ${endpoint}`);
    });

    render(
      <DraftProvider draftId="cmevh14aq001lux1gottrhp3a" userId="user-1">
        <DraftStateProbe />
      </DraftProvider>
    );

    await waitFor(() => {
      expect(fetchApi).toHaveBeenCalledWith('drafts/cmevh14aq001lux1gottrhp3a');
    });

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
      expect(screen.getByTestId('draft-name')).toHaveTextContent(
        'Test AFL Champions League - LIVE'
      );
      expect(screen.getByTestId('player-count')).toHaveTextContent('1');
    });
  });

  it('keeps hydrated players and does not rejoin when socket snapshots omit the player pool', async () => {
    const handlers = new Map<string, (...args: any[]) => void>();
    const emit = vi.fn();
    socketState.current = {
      connected: true,
      emit,
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        handlers.set(event, handler);
      }),
      off: vi.fn(),
      io: {
        on: vi.fn(),
        off: vi.fn(),
      },
    };

    fetchApi.mockImplementation(async (endpoint: string) => {
      if (endpoint === 'drafts/cmevh14aq001lux1gottrhp3a') {
        return {
          success: true,
          data: {
            id: 'cmevh14aq001lux1gottrhp3a',
            name: 'Test AFL Champions League - LIVE',
            leagueId: 'league-1',
            status: 'LIVE',
            currentPick: 1,
            totalPicks: 264,
            round: 1,
            direction: 'FORWARD',
            participants: [],
          },
        };
      }

      if (endpoint === 'drafts/cmevh14aq001lux1gottrhp3a/players?page=1&pageSize=100') {
        return {
          success: true,
          data: {
            players: [
              {
                id: 'caleb_daniel',
                name: 'Caleb Daniel',
                position: 'DEF',
                club: 'North Melbourne',
              },
            ],
            pagination: {
              hasMore: false,
            },
          },
        };
      }

      throw new Error(`Unexpected endpoint: ${endpoint}`);
    });

    render(
      <DraftProvider draftId="cmevh14aq001lux1gottrhp3a" userId="user-1">
        <DraftStateProbe />
      </DraftProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('player-count')).toHaveTextContent('1');
    });

    const joinCountBeforeSnapshot = emit.mock.calls.filter((call) => call[0] === 'draft:join').length;

    act(() => {
      handlers.get('draft:snapshot')?.({
        draft: {
          id: 'cmevh14aq001lux1gottrhp3a',
          name: 'Test AFL Champions League - LIVE',
          leagueId: 'league-1',
          status: 'LIVE',
          currentPick: 1,
          totalPicks: 264,
          round: 1,
          direction: 'FORWARD',
        },
        participants: [],
        picks: [],
        liveState: { currentPick: 1 },
        ts: 123,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('player-count')).toHaveTextContent('1');
    });

    expect(emit.mock.calls.filter((call) => call[0] === 'draft:join')).toHaveLength(
      joinCountBeforeSnapshot
    );
  });

  it('orders initial snapshot picks by overall number', () => {
    render(
      <DraftProvider
        draftId="draft-1"
        userId="user-1"
        initialSnapshot={{
          draft: {
            id: 'draft-1',
            name: 'Ordered Draft',
            leagueId: 'league-1',
            status: 'LIVE',
            currentPick: 3,
            totalPicks: 24,
            round: 1,
            direction: 'FORWARD',
          } as any,
          participants: [],
          availablePlayers: [
            {
              id: 'player-3',
              name: 'Available Player',
              position: 'MID',
              club: 'Test',
            },
          ],
          picks: [
            { id: 'pick-2', overall: 2, player: { id: 'player-2' } },
            { id: 'pick-1', overall: 1, player: { id: 'player-1' } },
          ] as any,
          ts: 200,
        }}
      >
        <DraftStateProbe />
      </DraftProvider>
    );

    expect(screen.getByTestId('pick-order')).toHaveTextContent('pick-1,pick-2');
  });

  it('ignores stale socket snapshots after newer state is loaded', async () => {
    const handlers = new Map<string, (...args: any[]) => void>();
    socketState.current = {
      connected: false,
      emit: vi.fn(),
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        handlers.set(event, handler);
      }),
      off: vi.fn(),
      io: {
        on: vi.fn(),
        off: vi.fn(),
      },
    };

    render(
      <DraftProvider
        draftId="draft-1"
        userId="user-1"
        initialSnapshot={{
          draft: {
            id: 'draft-1',
            name: 'Fresh Draft',
            leagueId: 'league-1',
            status: 'LIVE',
            currentPick: 2,
            totalPicks: 24,
            round: 1,
            direction: 'FORWARD',
          } as any,
          participants: [],
          availablePlayers: [
            {
              id: 'player-1',
              name: 'Available Player',
              position: 'MID',
              club: 'Test',
            },
          ],
          picks: [],
          ts: 200,
        }}
      >
        <DraftStateProbe />
      </DraftProvider>
    );

    expect(screen.getByTestId('current-pick')).toHaveTextContent('2');

    act(() => {
      handlers.get('draft:snapshot')?.({
        draft: {
          id: 'draft-1',
          name: 'Stale Draft',
          leagueId: 'league-1',
          status: 'LIVE',
          currentPick: 1,
          totalPicks: 24,
          round: 1,
          direction: 'FORWARD',
        },
        participants: [],
        picks: [],
        ts: 100,
      });
    });

    expect(screen.getByTestId('draft-name')).toHaveTextContent('Fresh Draft');
    expect(screen.getByTestId('current-pick')).toHaveTextContent('2');
  });

  it('advances visible draft state from a successful pick command response', async () => {
    fetchApi.mockImplementation(async (endpoint: string, init?: { method?: string }) => {
      if (endpoint === 'drafts/draft-1/picks' && init?.method === 'POST') {
        return {
          success: true,
          data: {
            currentPick: 2,
            isComplete: false,
            pick: {
              id: 'pick-1',
              overall: 1,
              round: 1,
              slot: 1,
              player: {
                id: 'player-1',
                name: 'First Player',
                position: 'MID',
                club: 'Sydney',
              },
              member: {
                id: 'member-1',
                userId: 'user-1',
                displayName: 'Tester',
              },
              auto: false,
              madeAt: '2026-06-07T00:00:00.000Z',
            },
          },
        };
      }

      throw new Error(`Unexpected endpoint: ${endpoint}`);
    });

    render(
      <DraftProvider
        draftId="draft-1"
        userId="user-1"
        initialSnapshot={{
          draft: {
            id: 'draft-1',
            name: 'Live Draft',
            leagueId: 'league-1',
            status: 'LIVE',
            currentPick: 1,
            totalPicks: 2,
            round: 1,
            direction: 'FORWARD',
          } as any,
          participants: [
            {
              id: 'member-1',
              memberId: 'member-1',
              userId: 'user-1',
              displayName: 'Tester',
              slot: 1,
              queue: ['player-1'],
            },
          ] as any,
          availablePlayers: [
            {
              id: 'player-1',
              name: 'First Player',
              position: 'MID',
              club: 'Sydney',
            },
          ],
          picks: [],
          ts: 200,
        }}
      >
        <DraftStateProbe />
      </DraftProvider>
    );

    expect(screen.getByTestId('current-pick')).toHaveTextContent('1');

    fireEvent.click(screen.getByRole('button', { name: 'Pick player 1' }));

    await waitFor(() => {
      expect(screen.getByTestId('pick-order')).toHaveTextContent('pick-1');
      expect(screen.getByTestId('player-count')).toHaveTextContent('0');
      expect(screen.getByTestId('current-pick')).toHaveTextContent('2');
    });
  });

  it('backfills persisted picks when an open room misses the realtime delta', async () => {
    vi.useFakeTimers();

    fetchApi.mockImplementation(async (endpoint: string) => {
      if (
        endpoint ===
        'drafts/draft-1/picks?since=2026-06-07T00%3A00%3A00.000Z&pageSize=100'
      ) {
        return {
          success: true,
          data: {
            picks: [
              {
                id: 'pick-1',
                overall: 1,
                round: 1,
                slot: 1,
                player: {
                  id: 'player-1',
                  name: 'First Player',
                  position: 'MID',
                  club: 'Sydney',
                },
                member: {
                  id: 'member-1',
                  displayName: 'Tester',
                },
                auto: false,
                madeAt: '2026-06-07T00:00:05.000Z',
              },
            ],
          },
        };
      }

      if (endpoint === 'drafts/draft-1') {
        return {
          success: true,
          data: {
            id: 'draft-1',
            name: 'Live Draft',
            leagueId: 'league-1',
            status: 'LIVE',
            currentPick: 2,
            totalPicks: 2,
            round: 1,
            direction: 'FORWARD',
            participants: [
              {
                slot: 1,
                member: {
                  id: 'member-1',
                  userId: 'user-1',
                  displayName: 'Tester',
                },
              },
            ],
            picks: [
              {
                id: 'pick-1',
                overall: 1,
                round: 1,
                slot: 1,
                player: {
                  id: 'player-1',
                  name: 'First Player',
                  position: 'MID',
                  club: 'Sydney',
                },
                member: {
                  id: 'member-1',
                  userId: 'user-1',
                  displayName: 'Tester',
                },
                auto: false,
                madeAt: '2026-06-07T00:00:05.000Z',
              },
            ],
            liveState: { currentPick: 2 },
            ts: Date.parse('2026-06-07T00:00:05.000Z'),
          },
        };
      }

      throw new Error(`Unexpected endpoint: ${endpoint}`);
    });

    render(
      <DraftProvider
        draftId="draft-1"
        userId="user-1"
        initialSnapshot={{
          draft: {
            id: 'draft-1',
            name: 'Live Draft',
            leagueId: 'league-1',
            status: 'LIVE',
            currentPick: 1,
            totalPicks: 2,
            round: 1,
            direction: 'FORWARD',
          } as any,
          participants: [
            {
              id: 'member-1',
              memberId: 'member-1',
              userId: 'user-1',
              displayName: 'Tester',
              slot: 1,
              queue: ['player-1'],
            },
          ] as any,
          availablePlayers: [
            {
              id: 'player-1',
              name: 'First Player',
              position: 'MID',
              club: 'Sydney',
            },
          ],
          picks: [],
          liveState: { currentPick: 1 },
          ts: Date.parse('2026-06-07T00:00:00.000Z'),
        }}
      >
        <DraftStateProbe />
      </DraftProvider>
    );

    expect(screen.getByTestId('pick-order')).toHaveTextContent('');
    expect(screen.getByTestId('current-pick')).toHaveTextContent('1');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchApi).toHaveBeenCalledWith(
      'drafts/draft-1/picks?since=2026-06-07T00%3A00%3A00.000Z&pageSize=100'
    );
    expect(screen.getByTestId('pick-order')).toHaveTextContent('pick-1');
    expect(screen.getByTestId('player-count')).toHaveTextContent('0');
    expect(screen.getByTestId('current-pick')).toHaveTextContent('2');
  });

  it('loads persisted picks without a since cursor when a live draft opens after picks exist', async () => {
    vi.useFakeTimers();

    fetchApi.mockImplementation(async (endpoint: string) => {
      if (endpoint === 'drafts/draft-1/picks?pageSize=100') {
        return {
          success: true,
          data: {
            picks: [
              {
                id: 'pick-1',
                overall: 1,
                round: 1,
                slot: 1,
                player: {
                  id: 'player-1',
                  name: 'First Player',
                  position: 'MID',
                  club: 'Sydney',
                },
                member: {
                  id: 'member-1',
                  displayName: 'Tester',
                },
                auto: false,
                madeAt: '2026-06-07T00:00:05.000Z',
              },
            ],
          },
        };
      }

      if (endpoint === 'drafts/draft-1') {
        return {
          success: true,
          data: {
            id: 'draft-1',
            name: 'Live Draft',
            leagueId: 'league-1',
            status: 'LIVE',
            currentPick: 2,
            totalPicks: 2,
            round: 1,
            direction: 'FORWARD',
            participants: [
              {
                slot: 1,
                member: {
                  id: 'member-1',
                  userId: 'user-1',
                  displayName: 'Tester',
                },
              },
            ],
            liveState: { currentPick: 2 },
            ts: Date.parse('2026-06-07T00:00:10.000Z'),
          },
        };
      }

      throw new Error(`Unexpected endpoint: ${endpoint}`);
    });

    render(
      <DraftProvider
        draftId="draft-1"
        userId="user-1"
        initialSnapshot={{
          draft: {
            id: 'draft-1',
            name: 'Live Draft',
            leagueId: 'league-1',
            status: 'LIVE',
            currentPick: 2,
            totalPicks: 2,
            round: 1,
            direction: 'FORWARD',
          } as any,
          participants: [
            {
              id: 'member-1',
              memberId: 'member-1',
              userId: 'user-1',
              displayName: 'Tester',
              slot: 1,
              queue: ['player-1'],
            },
          ] as any,
          availablePlayers: [
            {
              id: 'player-2',
              name: 'Second Player',
              position: 'MID',
              club: 'Sydney',
            },
          ],
          picks: [],
          liveState: { currentPick: 2 },
          ts: Date.parse('2026-06-07T00:00:10.000Z'),
        }}
      >
        <DraftStateProbe />
      </DraftProvider>
    );

    expect(screen.getByTestId('pick-order')).toHaveTextContent('');
    expect(screen.getByTestId('current-pick')).toHaveTextContent('2');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchApi).toHaveBeenCalledWith('drafts/draft-1/picks?pageSize=100');
    expect(screen.getByTestId('pick-order')).toHaveTextContent('pick-1');
    expect(screen.getByTestId('player-count')).toHaveTextContent('1');
    expect(screen.getByTestId('current-pick')).toHaveTextContent('2');
  });
});
