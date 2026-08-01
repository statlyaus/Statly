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

function makeV2Acknowledgement(revision: number, generation: number, name = 'Realtime Draft') {
  const serverNow = '2026-06-07T00:00:00.000Z';
  return {
    ok: true,
    draftId: 'draft-1',
    leagueId: 'league-1',
    protocol: 2,
    generation,
    snapshot: {
      schemaVersion: 2,
      draftId: 'draft-1',
      leagueId: 'league-1',
      revision,
      throughSequence: 0,
      serverNow,
      state: {
        name,
        status: 'LIVE',
        currentPick: 1,
        totalPicks: 2,
        round: 1,
        direction: 'FORWARD',
        clock: {
          status: 'LIVE',
          revision,
          durationSeconds: 120,
          serverNow,
          startedAt: serverNow,
          deadlineAt: '2026-06-07T00:02:00.000Z',
        },
        onClockMemberId: 'member-1',
        participants: [
          {
            id: 'member-1',
            userId: 'user-1',
            displayName: 'Tester',
            draftOrder: 1,
          },
        ],
        picks: [],
      },
    },
    replay: { afterSequence: 0, throughSequence: 0, events: [] },
  };
}

function createV2AcknowledgingEmit(revision: number) {
  return vi.fn((event: string, data?: any, acknowledge?: (value: unknown) => void) => {
    if (event !== 'draft:join:v2' || !acknowledge) return;
    acknowledge(makeV2Acknowledgement(revision, data.generation));
  });
}

function createV1FallbackEmit() {
  return vi.fn((event: string, data?: any, acknowledge?: (value: unknown) => void) => {
    if (event === 'draft:join:v2' && acknowledge) {
      acknowledge({ ok: true, draftId: data.draftId, protocol: 1 });
    }
  });
}

function DraftStateProbe() {
  const draft = useDraft();

  return (
    <div>
      <div data-testid="loading">{String(draft.isLoading)}</div>
      <div data-testid="draft-name">{draft.draft?.name ?? 'missing'}</div>
      <div data-testid="league-id">{draft.draft?.leagueId ?? 'missing'}</div>
      <div data-testid="current-pick">{draft.draft?.currentPick ?? 'missing'}</div>
      <div data-testid="pick-deadline">
        {draft.draft?.pickDeadlineAt?.toISOString?.() ?? 'missing'}
      </div>
      <div data-testid="clock-status">{draft.liveState.clock?.status ?? 'missing'}</div>
      <div data-testid="clock-revision">{draft.liveState.clock?.revision ?? 'missing'}</div>
      <div data-testid="clock-remaining">
        {draft.liveState.clock?.status === 'PAUSED'
          ? draft.liveState.clock.remainingSeconds
          : 'missing'}
      </div>
      <div data-testid="player-count">{draft.availablePlayers.length}</div>
      <div data-testid="pick-count">{draft.picks.length}</div>
      <div data-testid="pick-order">{draft.picks.map((pick) => pick.id).join(',')}</div>
      <div data-testid="watchlist-count">{draft.watchlistItems.length}</div>
      <div data-testid="watchlist-order">
        {draft.watchlistItems.map((item) => item.playerId).join(',')}
      </div>
      <div data-testid="queue-order">
        {draft.participants.flatMap((participant) => participant.queue ?? []).join(',')}
      </div>
      <button type="button" onClick={() => void draft.makePick('player-1')}>
        Pick player 1
      </button>
      <button type="button" onClick={() => void draft.toggleWatchlist('player-2')}>
        Toggle player 2 watchlist
      </button>
      <button type="button" onClick={() => void draft.toggleWatchlist('player-3')}>
        Toggle player 3 watchlist
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
    vi.restoreAllMocks();
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

    const joinCountBeforeSnapshot = emit.mock.calls.filter(
      (call) => call[0] === 'draft:join:v2'
    ).length;
    expect(joinCountBeforeSnapshot).toBe(1);
    expect(emit.mock.calls.find((call) => call[0] === 'draft:join:v2')?.[1]).toEqual({
      draftId: 'cmevh14aq001lux1gottrhp3a',
      generation: 1,
    });

    act(() => {
      handlers.get('draft:snapshot')?.({
        schemaVersion: 1,
        draftId: 'cmevh14aq001lux1gottrhp3a',
        leagueId: 'league-1',
        revision: 3,
        serverNow: '2026-06-13T10:00:00.000Z',
        state: {
          name: 'Test AFL Champions League - LIVE',
          status: 'LIVE',
          currentPick: 1,
          totalPicks: 264,
          round: 1,
          direction: 'FORWARD',
          clock: {
            status: 'LIVE',
            revision: 3,
            durationSeconds: 120,
            serverNow: '2026-06-13T10:00:00.000Z',
            startedAt: '2026-06-13T10:00:00.000Z',
            deadlineAt: '2026-06-13T10:02:00.000Z',
          },
          onClockMemberId: 'member-1',
          participants: [],
          picks: [],
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('player-count')).toHaveTextContent('1');
      expect(screen.getByTestId('league-id')).toHaveTextContent('league-1');
    });

    expect(emit.mock.calls.filter((call) => call[0] === 'draft:join:v2')).toHaveLength(
      joinCountBeforeSnapshot
    );
  });

  it('ignores shared v1 traffic until an explicit fallback owns the connection', async () => {
    const handlers = new Map<string, (...args: any[]) => void>();
    let acknowledgeV2: ((value: unknown) => void) | undefined;
    const emit = vi.fn((event: string, _data?: unknown, acknowledge?: (value: unknown) => void) => {
      if (event === 'draft:join:v2') acknowledgeV2 = acknowledge;
    });
    socketState.current = {
      connected: true,
      emit,
      on: vi.fn((event: string, handler: (...args: any[]) => void) => handlers.set(event, handler)),
      off: vi.fn(),
      io: { on: vi.fn(), off: vi.fn() },
    };
    fetchApi.mockResolvedValue({
      success: true,
      data: { players: [], pagination: { hasMore: false }, queue: [], watchlist: [] },
    });

    render(
      <DraftProvider
        draftId="draft-1"
        userId="user-1"
        initialSnapshot={{
          draft: {
            id: 'draft-1',
            name: 'Initial Draft',
            leagueId: 'league-1',
            status: 'LIVE',
            currentPick: 1,
            totalPicks: 2,
            round: 1,
            direction: 'FORWARD',
          } as any,
          participants: [],
          availablePlayers: [],
          picks: [],
          ts: 1,
        }}
      >
        <DraftStateProbe />
      </DraftProvider>
    );

    expect(acknowledgeV2).toBeDefined();
    act(() => {
      handlers.get('draft:snapshot')?.({
        ...makeV2Acknowledgement(1, 1, 'Stale V1 Draft').snapshot,
        schemaVersion: 1,
        revision: 1,
      });
      handlers.get('draft:delta')?.({
        type: 'STATE_PATCH',
        revision: 2,
        ts: 2,
        payload: { draft: { currentPick: 2 } },
      });
      handlers.get('draft:backfill')?.([
        {
          type: 'STATE_PATCH',
          revision: 3,
          ts: 3,
          payload: { draft: { name: 'Stale Backfill Draft' } },
        },
      ]);
    });

    expect(screen.getByTestId('draft-name')).toHaveTextContent('Initial Draft');
    expect(screen.getByTestId('current-pick')).toHaveTextContent('1');

    act(() => acknowledgeV2?.(makeV2Acknowledgement(4, 1, 'Atomic V2 Draft')));

    await waitFor(() => {
      expect(screen.getByTestId('draft-name')).toHaveTextContent('Atomic V2 Draft');
      expect(screen.getByTestId('clock-revision')).toHaveTextContent('4');
    });
  });

  it('removes a player drafted while offline when the reconnect snapshot owns the pick set', async () => {
    const acknowledgement = makeV2Acknowledgement(4, 1, 'Reconnected Draft') as any;
    acknowledgement.snapshot.state.picks = [
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
    ];
    const emit = vi.fn((event: string, _data?: unknown, acknowledge?: (value: unknown) => void) => {
      if (event === 'draft:join:v2') acknowledge?.(acknowledgement);
    });
    socketState.current = {
      connected: true,
      emit,
      on: vi.fn(),
      off: vi.fn(),
      io: { on: vi.fn(), off: vi.fn() },
    };
    fetchApi.mockResolvedValue({
      success: true,
      data: { players: [], pagination: { hasMore: false }, queue: [], watchlist: [] },
    });

    render(
      <DraftProvider
        draftId="draft-1"
        userId="user-1"
        initialSnapshot={{
          draft: {
            id: 'draft-1',
            name: 'Initial Draft',
            leagueId: 'league-1',
            status: 'LIVE',
            currentPick: 1,
            totalPicks: 2,
            round: 1,
            direction: 'FORWARD',
          } as any,
          participants: [],
          availablePlayers: [
            {
              id: 'player-1',
              name: 'First Player',
              position: 'MID',
              club: 'Sydney',
              statlyZScore: 1,
              isAvailable: true,
            },
          ],
          picks: [],
          ts: 1,
        }}
      >
        <DraftStateProbe />
      </DraftProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('pick-count')).toHaveTextContent('1');
      expect(screen.getByTestId('player-count')).toHaveTextContent('0');
    });
  });

  it('keeps the v2 timeout armed for a wrong-generation ack and ignores its late success', async () => {
    vi.useFakeTimers();
    const handlers = new Map<string, (...args: any[]) => void>();
    let acknowledgeV2: ((value: unknown) => void) | undefined;
    const emit = vi.fn((event: string, _data?: unknown, acknowledge?: (value: unknown) => void) => {
      if (event === 'draft:join:v2') acknowledgeV2 = acknowledge;
    });
    socketState.current = {
      connected: true,
      emit,
      on: vi.fn((event: string, handler: (...args: any[]) => void) => handlers.set(event, handler)),
      off: vi.fn(),
      io: { on: vi.fn(), off: vi.fn() },
    };
    fetchApi.mockResolvedValue({
      success: true,
      data: { players: [], pagination: { hasMore: false }, queue: [], watchlist: [] },
    });

    render(
      <DraftProvider
        draftId="draft-1"
        userId="user-1"
        initialSnapshot={{
          draft: {
            id: 'draft-1',
            name: 'Initial Draft',
            leagueId: 'league-1',
            status: 'LIVE',
            currentPick: 1,
            totalPicks: 2,
            round: 1,
            direction: 'FORWARD',
          } as any,
          participants: [],
          availablePlayers: [],
          picks: [],
          ts: 1,
        }}
      >
        <DraftStateProbe />
      </DraftProvider>
    );

    expect(acknowledgeV2).toBeDefined();
    act(() => acknowledgeV2?.(makeV2Acknowledgement(4, 99, 'Wrong Generation')));
    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(emit).toHaveBeenCalledWith('draft:leave:v2', { draftId: 'draft-1', generation: 1 });
    expect(emit).toHaveBeenCalledWith('draft:join', {
      draftId: 'draft-1',
      realtimeProtocols: [1],
    });

    act(() => {
      acknowledgeV2?.(makeV2Acknowledgement(5, 1, 'Late V2 Draft'));
      handlers.get('draft:snapshot')?.({
        ...makeV2Acknowledgement(3, 1, 'Fallback V1 Draft').snapshot,
        schemaVersion: 1,
      });
    });

    expect(screen.getByTestId('draft-name')).toHaveTextContent('Fallback V1 Draft');
    expect(screen.getByTestId('draft-name')).not.toHaveTextContent('Late V2 Draft');
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
              isAvailable: true,
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

  it('retains existing watchlist items when adding another player', async () => {
    fetchApi.mockImplementation(async (endpoint: string, options?: RequestInit) => {
      if (endpoint === 'drafts/draft-1') {
        return {
          success: true,
          data: {
            id: 'draft-1',
            name: 'Watchlist Draft',
            leagueId: 'league-1',
            status: 'LIVE',
            currentPick: 1,
            totalPicks: 24,
            round: 1,
            direction: 'FORWARD',
            participants: [
              {
                slot: 1,
                member: {
                  id: 'member-1',
                  userId: 'statly-dev-tester',
                  displayName: 'Tester',
                },
              },
            ],
            selectedCategories: [],
            draftReadiness: null,
            liveState: {},
          },
        };
      }

      if (endpoint === 'drafts/draft-1/players?page=1&pageSize=100') {
        return {
          success: true,
          data: {
            players: [
              {
                id: 'player-1',
                name: 'Player One',
                position: 'MID',
                club: 'Sydney',
                statlyZScore: 1,
              },
              {
                id: 'player-2',
                name: 'Player Two',
                position: 'DEF',
                club: 'Richmond',
                statlyZScore: 2,
              },
            ],
            pagination: { hasMore: false },
          },
        };
      }

      if (endpoint === 'drafts/draft-1/watchlist' && !options?.method) {
        return {
          success: true,
          data: {
            watchlist: [
              {
                id: 'watchlist-1',
                playerId: 'player-1',
                priority: 1,
                rank: 1,
                addedAt: '2026-06-13T10:00:00.000Z',
                player: {
                  id: 'player-1',
                  name: 'Player One',
                  position: 'MID',
                  club: 'Sydney',
                },
              },
            ],
          },
        };
      }

      if (endpoint === 'drafts/draft-1/watchlist' && options?.method === 'POST') {
        return {
          success: true,
          data: {
            watchlistItem: {
              id: 'watchlist-2',
              playerId: 'player-2',
              priority: 2,
              createdAt: '2026-06-13T10:01:00.000Z',
              player: {
                id: 'player-2',
                name: 'Player Two',
                position: 'DEF',
                club: 'Richmond',
              },
            },
          },
        };
      }

      throw new Error(`Unexpected endpoint: ${endpoint}`);
    });

    render(
      <DraftProvider draftId="draft-1" userId="statly-dev-tester">
        <DraftStateProbe />
      </DraftProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('watchlist-order')).toHaveTextContent('player-1');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Toggle player 2 watchlist' }));

    await waitFor(() => {
      expect(screen.getByTestId('watchlist-count')).toHaveTextContent('2');
      expect(screen.getByTestId('watchlist-order')).toHaveTextContent('player-1,player-2');
    });
  });

  it('retains rapid watchlist adds resolved from stale render state', async () => {
    let resolvePlayer2Add: (() => void) | undefined;
    let resolvePlayer3Add: (() => void) | undefined;

    fetchApi.mockImplementation(async (endpoint: string, options?: RequestInit) => {
      if (endpoint === 'drafts/draft-1') {
        return {
          success: true,
          data: {
            id: 'draft-1',
            name: 'Watchlist Draft',
            leagueId: 'league-1',
            status: 'LIVE',
            currentPick: 1,
            totalPicks: 24,
            round: 1,
            direction: 'FORWARD',
            participants: [
              {
                slot: 1,
                member: {
                  id: 'member-1',
                  userId: 'statly-dev-tester',
                  displayName: 'Tester',
                },
              },
            ],
            selectedCategories: [],
            draftReadiness: null,
            liveState: {},
          },
        };
      }

      if (endpoint === 'drafts/draft-1/players?page=1&pageSize=100') {
        return {
          success: true,
          data: {
            players: [
              {
                id: 'player-1',
                name: 'Player One',
                position: 'MID',
                club: 'Sydney',
                statlyZScore: 1,
              },
              {
                id: 'player-2',
                name: 'Player Two',
                position: 'DEF',
                club: 'Richmond',
                statlyZScore: 2,
              },
              {
                id: 'player-3',
                name: 'Player Three',
                position: 'FWD',
                club: 'Brisbane',
                statlyZScore: 3,
              },
            ],
            pagination: { hasMore: false },
          },
        };
      }

      if (endpoint === 'drafts/draft-1/watchlist' && !options?.method) {
        return {
          success: true,
          data: {
            watchlist: [
              {
                id: 'watchlist-1',
                playerId: 'player-1',
                priority: 1,
                rank: 1,
                addedAt: '2026-06-13T10:00:00.000Z',
                player: {
                  id: 'player-1',
                  name: 'Player One',
                  position: 'MID',
                  club: 'Sydney',
                },
              },
            ],
          },
        };
      }

      if (endpoint === 'drafts/draft-1/watchlist' && options?.method === 'POST') {
        const payload = JSON.parse(String(options.body ?? '{}')) as { playerId?: string };

        if (payload.playerId === 'player-2') {
          await new Promise<void>((resolve) => {
            resolvePlayer2Add = resolve;
          });
        }

        if (payload.playerId === 'player-3') {
          await new Promise<void>((resolve) => {
            resolvePlayer3Add = resolve;
          });
        }

        return {
          success: true,
          data: {
            watchlistItem: {
              id: `watchlist-${payload.playerId}`,
              playerId: payload.playerId,
              priority: payload.playerId === 'player-2' ? 2 : 3,
              createdAt: '2026-06-13T10:01:00.000Z',
              player:
                payload.playerId === 'player-2'
                  ? {
                      id: 'player-2',
                      name: 'Player Two',
                      position: 'DEF',
                      club: 'Richmond',
                    }
                  : {
                      id: 'player-3',
                      name: 'Player Three',
                      position: 'FWD',
                      club: 'Brisbane',
                    },
            },
          },
        };
      }

      throw new Error(`Unexpected endpoint: ${endpoint}`);
    });

    render(
      <DraftProvider draftId="draft-1" userId="statly-dev-tester">
        <DraftStateProbe />
      </DraftProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('watchlist-order')).toHaveTextContent('player-1');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Toggle player 2 watchlist' }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle player 3 watchlist' }));

    await waitFor(() => {
      expect(resolvePlayer2Add).toBeDefined();
      expect(resolvePlayer3Add).toBeDefined();
    });

    expect(screen.getByTestId('watchlist-count')).toHaveTextContent('3');
    expect(screen.getByTestId('watchlist-order')).toHaveTextContent('player-1,player-2,player-3');

    act(() => {
      resolvePlayer2Add?.();
      resolvePlayer3Add?.();
    });

    await waitFor(() => {
      expect(screen.getByTestId('watchlist-count')).toHaveTextContent('3');
      expect(screen.getByTestId('watchlist-order')).toHaveTextContent('player-1,player-2,player-3');
    });
  });

  it('hydrates an in-progress draft with persisted picks and authoritative deadline after refresh', async () => {
    const pickDeadlineAt = '2026-06-13T10:05:00.000Z';

    fetchApi.mockImplementation(async (endpoint: string) => {
      if (endpoint === 'drafts/draft-1') {
        return {
          success: true,
          data: {
            id: 'draft-1',
            name: 'Live Draft With Picks',
            leagueId: 'league-1',
            status: 'LIVE',
            currentPick: 4,
            totalPicks: 24,
            round: 1,
            direction: 'FORWARD',
            pickDeadlineAt,
            settings: { timePerPick: 120, pickSeconds: 120 },
            participants: [
              {
                slot: 1,
                member: {
                  id: 'member-1',
                  userId: 'statly-dev-tester',
                  displayName: 'Tester',
                },
              },
              {
                slot: 2,
                member: {
                  id: 'member-2',
                  userId: 'bot-1',
                  displayName: 'CPU Team 1',
                },
              },
            ],
            picks: [
              {
                id: 'pick-1',
                overall: 1,
                round: 1,
                slot: 1,
                auto: false,
                madeAt: '2026-06-13T10:00:00.000Z',
                player: {
                  id: 'player-1',
                  name: 'Player One',
                  position: 'MID',
                  club: 'Sydney',
                },
                member: {
                  id: 'member-1',
                  displayName: 'Tester',
                  teamName: 'Your Team',
                },
              },
            ],
            availablePlayers: [],
            selectedCategories: ['goals', 'tackles'],
          },
        };
      }

      if (endpoint === 'drafts/draft-1/players?page=1&pageSize=100') {
        return {
          success: true,
          data: {
            players: [],
            pagination: { hasMore: false },
          },
        };
      }

      throw new Error(`Unexpected endpoint: ${endpoint}`);
    });

    render(
      <DraftProvider draftId="draft-1" userId="statly-dev-tester">
        <DraftStateProbe />
      </DraftProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('draft-name')).toHaveTextContent('Live Draft With Picks');
      expect(screen.getByTestId('current-pick')).toHaveTextContent('4');
      expect(screen.getByTestId('pick-deadline')).toHaveTextContent(pickDeadlineAt);
      expect(screen.getByTestId('pick-order')).toHaveTextContent('pick-1');
    });
  });

  it('hydrates every persisted pick for a completed draft before rendering final roster summaries', async () => {
    const participants = [
      {
        slot: 1,
        member: {
          id: 'member-1',
          userId: 'statly-dev-tester',
          displayName: 'Robbo Rockers',
        },
      },
      {
        slot: 2,
        member: {
          id: 'member-2',
          userId: 'bot-1',
          displayName: 'AFL Legends',
        },
      },
    ];
    const picks = Array.from({ length: 201 }, (_, index) => {
      const overall = index + 1;

      return {
        id: `pick-${overall}`,
        overall,
        round: Math.ceil(overall / participants.length),
        slot: overall % 2 === 1 ? 1 : 2,
        auto: false,
        madeAt: `2026-06-13T10:${String(index).padStart(2, '0')}.000Z`,
        player: {
          id: `player-${overall}`,
          name: `Player ${overall}`,
          position: 'MID',
          club: 'Sydney',
        },
        member: {
          id: overall % 2 === 1 ? 'member-1' : 'member-2',
          displayName: overall % 2 === 1 ? 'Robbo Rockers' : 'AFL Legends',
          teamName: overall % 2 === 1 ? 'Robbo Rockers' : 'AFL Legends',
        },
      };
    });

    fetchApi.mockImplementation(async (endpoint: string) => {
      if (endpoint === 'drafts/completed-draft') {
        return {
          success: true,
          data: {
            id: 'completed-draft',
            name: 'Completed Draft',
            leagueId: 'league-1',
            status: 'COMPLETED',
            currentPick: 202,
            totalPicks: 201,
            round: 101,
            direction: 'REVERSE',
            participants,
            picksSummary: {
              count: picks.length,
              latestOverall: picks.length,
            },
            selectedCategories: [],
            draftReadiness: null,
            liveState: {},
          },
        };
      }

      if (endpoint === 'drafts/completed-draft/players?page=1&pageSize=100') {
        return {
          success: true,
          data: {
            players: [
              {
                id: 'undrafted-player',
                name: 'Undrafted Player',
                position: 'MID',
                club: 'Sydney',
                statlyZScore: 0,
              },
            ],
            pagination: { hasMore: false },
          },
        };
      }

      if (endpoint === 'drafts/completed-draft/picks?page=1&pageSize=200') {
        return {
          success: true,
          data: {
            picks: picks.slice(0, 200),
            pagination: {
              page: 1,
              pageSize: 200,
              totalCount: picks.length,
              hasMore: true,
            },
          },
        };
      }

      if (endpoint === 'drafts/completed-draft/picks?page=2&pageSize=200') {
        return {
          success: true,
          data: {
            picks: picks.slice(200),
            pagination: {
              page: 2,
              pageSize: 200,
              totalCount: picks.length,
              hasMore: false,
            },
          },
        };
      }

      throw new Error(`Unexpected endpoint: ${endpoint}`);
    });

    render(
      <DraftProvider draftId="completed-draft" userId="statly-dev-tester">
        <DraftStateProbe />
      </DraftProvider>
    );

    await waitFor(() => {
      expect(fetchApi).toHaveBeenCalledWith('drafts/completed-draft/picks?page=1&pageSize=200', {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
      expect(fetchApi).toHaveBeenCalledWith('drafts/completed-draft/picks?page=2&pageSize=200', {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('pick-count')).toHaveTextContent('201');
      expect(screen.getByTestId('pick-order')).toHaveTextContent('pick-1');
      expect(screen.getByTestId('pick-order')).toHaveTextContent('pick-201');
    });
  });

  it('ignores stale socket snapshots after newer state is loaded', async () => {
    const handlers = new Map<string, (...args: any[]) => void>();
    socketState.current = {
      connected: true,
      emit: createV1FallbackEmit(),
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
              isAvailable: true,
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

  it('preserves league affiliation when socket snapshot deltas omit league ids', async () => {
    const requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 0;
      });
    const handlers = new Map<string, (...args: any[]) => void>();
    socketState.current = {
      connected: true,
      emit: createV1FallbackEmit(),
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
            name: 'League Affiliated Draft',
            leagueId: 'league-1',
            status: 'LIVE',
            currentPick: 2,
            totalPicks: 24,
            round: 1,
            direction: 'FORWARD',
          } as any,
          participants: [],
          picks: [],
          ts: 200,
        }}
      >
        <DraftStateProbe />
      </DraftProvider>
    );

    expect(screen.getByTestId('league-id')).toHaveTextContent('league-1');

    act(() => {
      handlers.get('draft:delta')?.({
        type: 'SNAPSHOT',
        payload: {
          draft: {
            id: 'draft-1',
            name: 'Socket Delta Snapshot',
            status: 'LIVE',
            currentPick: 3,
            totalPicks: 24,
            round: 1,
            direction: 'FORWARD',
          },
          participants: [],
          picks: [],
          ts: 300,
        },
        ts: 300,
      });
    });

    expect(screen.getByTestId('draft-name')).toHaveTextContent('Socket Delta Snapshot');
    expect(screen.getByTestId('current-pick')).toHaveTextContent('3');
    expect(screen.getByTestId('league-id')).toHaveTextContent('league-1');
    requestAnimationFrameSpy.mockRestore();
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
              isAvailable: true,
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
      if (endpoint === 'drafts/draft-1/picks?since=2026-06-07T00%3A00%3A00.000Z&pageSize=100') {
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
              isAvailable: true,
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

  it('uses persisted pick draft metadata without forcing a full snapshot refresh', async () => {
    vi.useFakeTimers();

    fetchApi.mockImplementation(async (endpoint: string) => {
      if (endpoint === 'drafts/draft-1/picks?since=2026-06-07T00%3A00%3A00.000Z&pageSize=100') {
        return {
          success: true,
          data: {
            draftState: {
              currentPick: 2,
              status: 'LIVE',
              round: 1,
              direction: 'FORWARD',
              schedulingVersion: 2,
              pickDeadlineAt: '2026-06-07T00:02:00.000Z',
              clock: {
                status: 'LIVE',
                revision: 2,
                durationSeconds: 120,
                serverNow: '2026-06-07T00:00:10.000Z',
                startedAt: '2026-06-07T00:00:10.000Z',
                deadlineAt: '2026-06-07T00:02:00.000Z',
              },
            },
            picks: [],
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
            pickDeadlineAt: new Date('2026-06-07T00:01:00.000Z'),
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
              isAvailable: true,
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

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchApi).toHaveBeenCalledWith(
      'drafts/draft-1/picks?since=2026-06-07T00%3A00%3A00.000Z&pageSize=100'
    );
    expect(fetchApi).not.toHaveBeenCalledWith('drafts/draft-1');
    expect(screen.getByTestId('pick-order')).toHaveTextContent('');
    expect(screen.getByTestId('current-pick')).toHaveTextContent('2');
    expect(screen.getByTestId('pick-deadline')).toHaveTextContent('2026-06-07T00:02:00.000Z');
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
              isAvailable: true,
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

  it('recovers a missed resume while paused without clearing the private queue', async () => {
    let persistedReconciliation: (() => void) | undefined;
    vi.spyOn(window, 'setInterval').mockImplementation(((
      handler: TimerHandler,
      timeout?: number
    ) => {
      if (timeout === 5_000 && typeof handler === 'function') {
        persistedReconciliation = () => handler();
      }
      return 1 as unknown as ReturnType<typeof window.setInterval>;
    }) as unknown as typeof window.setInterval);
    vi.spyOn(window, 'clearInterval').mockImplementation(() => undefined);

    fetchApi.mockImplementation(async (endpoint: string) => {
      if (endpoint.startsWith('drafts/draft-1/picks?')) {
        return {
          success: true,
          data: {
            draftState: {
              currentPick: 1,
              status: 'LIVE',
              round: 1,
              direction: 'FORWARD',
              schedulingVersion: 6,
              pickStartedAt: '2026-06-07T00:00:35.000Z',
              pickDeadlineAt: '2026-06-07T00:01:12.000Z',
              pausedRemainingSeconds: null,
              clock: {
                status: 'LIVE',
                revision: 6,
                durationSeconds: 120,
                serverNow: '2026-06-07T00:00:35.000Z',
                startedAt: '2026-06-07T00:00:35.000Z',
                deadlineAt: '2026-06-07T00:01:12.000Z',
              },
            },
            picks: [],
          },
        };
      }

      if (endpoint === 'drafts/draft-1/pre-queue') {
        return {
          success: true,
          data: { queue: [{ playerId: 'private-player', rank: 1 }] },
        };
      }

      if (endpoint === 'drafts/draft-1/watchlist') {
        return { success: true, data: { watchlist: [] } };
      }

      if (endpoint === 'drafts/draft-1/players?page=1&pageSize=100') {
        return {
          success: true,
          data: {
            players: [
              {
                id: 'available-player',
                name: 'Available Player',
                position: 'MID',
                club: 'Sydney',
                statlyZScore: 0,
              },
            ],
            pagination: { hasMore: false },
          },
        };
      }

      throw new Error(`Unexpected endpoint: ${endpoint}`);
    });

    const { unmount } = render(
      <DraftProvider
        draftId="draft-1"
        userId="user-1"
        initialSnapshot={{
          schemaVersion: 1,
          draftId: 'draft-1',
          leagueId: 'league-1',
          revision: 5,
          serverNow: '2026-06-07T00:00:30.000Z',
          state: {
            name: 'Paused Draft',
            status: 'PAUSED',
            currentPick: 1,
            totalPicks: 2,
            round: 1,
            direction: 'FORWARD',
            clock: {
              status: 'PAUSED',
              revision: 5,
              durationSeconds: 120,
              serverNow: '2026-06-07T00:00:30.000Z',
              remainingSeconds: 37,
            },
            onClockMemberId: 'member-1',
            participants: [
              {
                id: 'member-1',
                userId: 'user-1',
                displayName: 'Tester',
                draftOrder: 1,
              },
            ],
            picks: [],
          },
        }}
      >
        <DraftStateProbe />
      </DraftProvider>
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId('queue-order')).toHaveTextContent('private-player');
    expect(persistedReconciliation).toBeTypeOf('function');
    expect(screen.getByTestId('clock-status')).toHaveTextContent('PAUSED');

    await act(async () => {
      persistedReconciliation?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('clock-status')).toHaveTextContent('LIVE');
    expect(screen.getByTestId('clock-revision')).toHaveTextContent('6');
    expect(screen.getByTestId('pick-deadline')).toHaveTextContent('2026-06-07T00:01:12.000Z');
    expect(screen.getByTestId('queue-order')).toHaveTextContent('private-player');

    unmount();
  });

  it('rehydrates private queue and watchlist state after reconnect', async () => {
    const handlers = new Map<string, (...args: any[]) => void>();
    const emit = createV2AcknowledgingEmit(5);
    const off = vi.fn();
    socketState.current = {
      connected: true,
      emit,
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        handlers.set(event, handler);
      }),
      off,
      io: { on: vi.fn(), off: vi.fn() },
    };
    let privateStateRevision = 1;

    fetchApi.mockImplementation(async (endpoint: string) => {
      if (endpoint === 'drafts/draft-1/pre-queue') {
        return {
          success: true,
          data: {
            queue: [{ playerId: `private-player-${privateStateRevision}`, rank: 1 }],
          },
        };
      }

      if (endpoint === 'drafts/draft-1/watchlist') {
        return {
          success: true,
          data: {
            watchlist: [
              {
                id: `watchlist-${privateStateRevision}`,
                playerId: `watchlist-player-${privateStateRevision}`,
                priority: 1,
                rank: 1,
                addedAt: '2026-06-07T00:00:00.000Z',
              },
            ],
          },
        };
      }

      if (endpoint === 'drafts/draft-1/players?page=1&pageSize=100') {
        return {
          success: true,
          data: {
            players: [
              {
                id: 'available-player',
                name: 'Available Player',
                position: 'MID',
                club: 'Sydney',
                statlyZScore: 0,
              },
            ],
            pagination: { hasMore: false },
          },
        };
      }

      throw new Error(`Unexpected endpoint: ${endpoint}`);
    });

    const { unmount } = render(
      <DraftProvider
        draftId="draft-1"
        userId="user-1"
        initialSnapshot={{
          schemaVersion: 1,
          draftId: 'draft-1',
          leagueId: 'league-1',
          revision: 5,
          serverNow: '2026-06-07T00:00:00.000Z',
          state: {
            name: 'Reconnect Draft',
            status: 'LIVE',
            currentPick: 1,
            totalPicks: 2,
            round: 1,
            direction: 'FORWARD',
            clock: {
              status: 'LIVE',
              revision: 5,
              durationSeconds: 120,
              serverNow: '2026-06-07T00:00:00.000Z',
              startedAt: '2026-06-07T00:00:00.000Z',
              deadlineAt: '2026-06-07T00:02:00.000Z',
            },
            onClockMemberId: 'member-1',
            participants: [
              {
                id: 'member-1',
                userId: 'user-1',
                displayName: 'Tester',
                draftOrder: 1,
              },
            ],
            picks: [],
          },
        }}
      >
        <DraftStateProbe />
      </DraftProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('queue-order')).toHaveTextContent('private-player-1');
      expect(screen.getByTestId('watchlist-order')).toHaveTextContent('watchlist-player-1');
    });

    privateStateRevision = 2;
    act(() => handlers.get('disconnect')?.());
    act(() => handlers.get('connect')?.());

    await waitFor(() => {
      expect(screen.getByTestId('queue-order')).toHaveTextContent('private-player-2');
      expect(screen.getByTestId('watchlist-order')).toHaveTextContent('watchlist-player-2');
    });

    privateStateRevision = 3;
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));

    await waitFor(() => {
      expect(screen.getByTestId('queue-order')).toHaveTextContent('private-player-3');
      expect(screen.getByTestId('watchlist-order')).toHaveTextContent('watchlist-player-3');
    });

    expect(
      fetchApi.mock.calls.filter(([endpoint]) => endpoint === 'drafts/draft-1/pre-queue')
    ).toHaveLength(3);
    expect(
      fetchApi.mock.calls.filter(([endpoint]) => endpoint === 'drafts/draft-1/watchlist')
    ).toHaveLength(3);

    unmount();
    expect(off).toHaveBeenCalledWith('connect', expect.any(Function));
    expect(off).toHaveBeenCalledWith('disconnect', expect.any(Function));
    expect(emit).toHaveBeenCalledWith('draft:leave:v2', {
      draftId: 'draft-1',
      generation: 3,
    });
  });

  it('ignores an older private hydration after a visibility rejoin completes', async () => {
    const handlers = new Map<string, (...args: any[]) => void>();
    socketState.current = {
      connected: true,
      emit: createV2AcknowledgingEmit(1),
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        handlers.set(event, handler);
      }),
      off: vi.fn(),
      io: { on: vi.fn(), off: vi.fn() },
    };

    let queueCalls = 0;
    let watchlistCalls = 0;
    let resolveOldQueue: ((value: unknown) => void) | undefined;
    let resolveOldWatchlist: ((value: unknown) => void) | undefined;

    fetchApi.mockImplementation(async (endpoint: string) => {
      if (endpoint === 'drafts/draft-1/pre-queue') {
        queueCalls += 1;
        if (queueCalls === 1) {
          return new Promise((resolve) => {
            resolveOldQueue = resolve;
          });
        }
        return { success: true, data: { queue: [{ playerId: 'new-queue-player', rank: 1 }] } };
      }

      if (endpoint === 'drafts/draft-1/watchlist') {
        watchlistCalls += 1;
        if (watchlistCalls === 1) {
          return new Promise((resolve) => {
            resolveOldWatchlist = resolve;
          });
        }
        return {
          success: true,
          data: {
            watchlist: [
              {
                id: 'new-watchlist',
                playerId: 'new-watchlist-player',
                priority: 1,
                rank: 1,
                addedAt: '2026-06-07T00:00:01.000Z',
              },
            ],
          },
        };
      }

      if (endpoint === 'drafts/draft-1/players?page=1&pageSize=100') {
        return { success: true, data: { players: [], pagination: { hasMore: false } } };
      }

      throw new Error(`Unexpected endpoint: ${endpoint}`);
    });

    render(
      <DraftProvider
        draftId="draft-1"
        userId="user-1"
        initialSnapshot={{
          schemaVersion: 1,
          draftId: 'draft-1',
          leagueId: 'league-1',
          revision: 1,
          serverNow: '2026-06-07T00:00:00.000Z',
          state: {
            name: 'Hydration Race Draft',
            status: 'LIVE',
            currentPick: 1,
            totalPicks: 2,
            round: 1,
            direction: 'FORWARD',
            clock: {
              status: 'LIVE',
              revision: 1,
              durationSeconds: 120,
              serverNow: '2026-06-07T00:00:00.000Z',
              startedAt: '2026-06-07T00:00:00.000Z',
              deadlineAt: '2026-06-07T00:02:00.000Z',
            },
            onClockMemberId: 'member-1',
            participants: [
              {
                id: 'member-1',
                userId: 'user-1',
                displayName: 'Tester',
                draftOrder: 1,
              },
            ],
            picks: [],
          },
        }}
      >
        <DraftStateProbe />
      </DraftProvider>
    );

    await waitFor(() => {
      expect(resolveOldQueue).toBeDefined();
      expect(resolveOldWatchlist).toBeDefined();
    });

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));

    await waitFor(() => {
      expect(screen.getByTestId('queue-order')).toHaveTextContent('new-queue-player');
      expect(screen.getByTestId('watchlist-order')).toHaveTextContent('new-watchlist-player');
    });

    act(() => {
      resolveOldQueue?.({
        success: true,
        data: { queue: [{ playerId: 'old-queue-player', rank: 1 }] },
      });
      resolveOldWatchlist?.({
        success: true,
        data: {
          watchlist: [
            {
              id: 'old-watchlist',
              playerId: 'old-watchlist-player',
              priority: 1,
              rank: 1,
              addedAt: '2026-06-07T00:00:00.000Z',
            },
          ],
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('queue-order')).toHaveTextContent('new-queue-player');
      expect(screen.getByTestId('queue-order')).not.toHaveTextContent('old-queue-player');
      expect(screen.getByTestId('watchlist-order')).toHaveTextContent('new-watchlist-player');
      expect(screen.getByTestId('watchlist-order')).not.toHaveTextContent('old-watchlist-player');
    });
  });

  it('does not let an older hydration overwrite a newer watchlist mutation', async () => {
    let resolveOldWatchlist: ((value: unknown) => void) | undefined;
    let mutationBody: Record<string, unknown> | undefined;

    fetchApi.mockImplementation(async (endpoint: string, options?: RequestInit) => {
      if (endpoint === 'drafts/draft-1/pre-queue') {
        return { success: true, data: { queue: [] } };
      }

      if (endpoint === 'drafts/draft-1/watchlist' && options?.method === 'POST') {
        mutationBody = JSON.parse(String(options.body ?? '{}')) as Record<string, unknown>;
        return {
          success: true,
          data: {
            watchlistItem: {
              id: 'watchlist-player-2',
              playerId: 'player-2',
              priority: 1,
              createdAt: '2026-06-07T00:00:01.000Z',
              player: {
                id: 'player-2',
                name: 'Player Two',
                position: 'MID',
                club: 'Sydney',
              },
            },
          },
        };
      }

      if (endpoint === 'drafts/draft-1/watchlist') {
        return new Promise((resolve) => {
          resolveOldWatchlist = resolve;
        });
      }

      if (endpoint === 'drafts/draft-1/players?page=1&pageSize=100') {
        return {
          success: true,
          data: {
            players: [
              {
                id: 'player-2',
                name: 'Player Two',
                position: 'MID',
                club: 'Sydney',
                statlyZScore: 1,
              },
            ],
            pagination: { hasMore: false },
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
          schemaVersion: 1,
          draftId: 'draft-1',
          leagueId: 'league-1',
          revision: 1,
          serverNow: '2026-06-07T00:00:00.000Z',
          state: {
            name: 'Mutation Race Draft',
            status: 'LIVE',
            currentPick: 1,
            totalPicks: 2,
            round: 1,
            direction: 'FORWARD',
            clock: {
              status: 'LIVE',
              revision: 1,
              durationSeconds: 120,
              serverNow: '2026-06-07T00:00:00.000Z',
              startedAt: '2026-06-07T00:00:00.000Z',
              deadlineAt: '2026-06-07T00:02:00.000Z',
            },
            onClockMemberId: 'member-1',
            participants: [
              {
                id: 'member-1',
                userId: 'user-1',
                displayName: 'Tester',
                draftOrder: 1,
              },
            ],
            picks: [],
          },
        }}
      >
        <DraftStateProbe />
      </DraftProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('player-count')).toHaveTextContent('1');
      expect(resolveOldWatchlist).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Toggle player 2 watchlist' }));

    await waitFor(() => {
      expect(screen.getByTestId('watchlist-order')).toHaveTextContent('player-2');
      expect(mutationBody).toEqual({ playerId: 'player-2', priority: 1 });
    });

    await act(async () => {
      resolveOldWatchlist?.({
        success: true,
        data: {
          watchlist: [
            {
              id: 'old-watchlist',
              playerId: 'old-watchlist-player',
              priority: 1,
              rank: 1,
              addedAt: '2026-06-07T00:00:00.000Z',
            },
          ],
        },
      });
      await Promise.resolve();
    });

    expect(screen.getByTestId('watchlist-order')).toHaveTextContent('player-2');
    expect(screen.getByTestId('watchlist-order')).not.toHaveTextContent('old-watchlist-player');
  });

  it('applies revisioned pause and resume clocks immediately and ignores a stale lifecycle delta', async () => {
    const handlers = new Map<string, (...args: any[]) => void>();
    socketState.current = {
      connected: true,
      emit: createV1FallbackEmit(),
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        handlers.set(event, handler);
      }),
      off: vi.fn(),
      io: { on: vi.fn(), off: vi.fn() },
    };
    fetchApi.mockResolvedValue({
      success: true,
      data: { players: [], pagination: { hasMore: false }, watchlist: [], queue: [] },
    });

    render(
      <DraftProvider
        draftId="draft-1"
        userId="user-1"
        initialSnapshot={{
          schemaVersion: 1,
          draftId: 'draft-1',
          leagueId: 'league-1',
          revision: 4,
          serverNow: '2026-06-07T00:00:00.000Z',
          state: {
            name: 'Lifecycle Draft',
            status: 'LIVE',
            currentPick: 1,
            totalPicks: 2,
            round: 1,
            direction: 'FORWARD',
            clock: {
              status: 'LIVE',
              revision: 4,
              durationSeconds: 120,
              serverNow: '2026-06-07T00:00:00.000Z',
              startedAt: '2026-06-07T00:00:00.000Z',
              deadlineAt: '2026-06-07T00:02:00.000Z',
            },
            onClockMemberId: 'member-1',
            participants: [
              {
                id: 'member-1',
                userId: 'user-1',
                displayName: 'Tester',
                draftOrder: 1,
              },
            ],
            picks: [],
          },
        }}
      >
        <DraftStateProbe />
      </DraftProvider>
    );

    act(() => {
      handlers.get('draft:delta')?.({
        type: 'STATE_PATCH',
        revision: 5,
        ts: Date.parse('2026-06-07T00:00:30.000Z'),
        payload: {
          draft: { status: 'PAUSED', pickDeadlineAt: null },
          liveState: {
            revision: 5,
            clock: {
              status: 'PAUSED',
              revision: 5,
              durationSeconds: 120,
              serverNow: '2026-06-07T00:00:30.000Z',
              remainingSeconds: 37,
            },
          },
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('clock-status')).toHaveTextContent('PAUSED');
      expect(screen.getByTestId('clock-revision')).toHaveTextContent('5');
      expect(screen.getByTestId('clock-remaining')).toHaveTextContent('37');
      expect(screen.getByTestId('pick-deadline')).toHaveTextContent('missing');
    });

    act(() => {
      handlers.get('draft:delta')?.({
        type: 'STATE_PATCH',
        revision: 6,
        ts: Date.parse('2026-06-07T00:01:00.000Z'),
        payload: {
          draft: { status: 'LIVE', pickDeadlineAt: '2026-06-07T00:01:37.000Z' },
          liveState: {
            revision: 6,
            clock: {
              status: 'LIVE',
              revision: 6,
              durationSeconds: 120,
              serverNow: '2026-06-07T00:01:00.000Z',
              startedAt: '2026-06-07T00:01:00.000Z',
              deadlineAt: '2026-06-07T00:01:37.000Z',
            },
          },
        },
      });
      handlers.get('draft:delta')?.({
        type: 'STATE_PATCH',
        revision: 5,
        ts: Date.parse('2026-06-07T00:01:01.000Z'),
        payload: {
          draft: { status: 'PAUSED', pickDeadlineAt: null },
          liveState: {
            revision: 5,
            clock: {
              status: 'PAUSED',
              revision: 5,
              durationSeconds: 120,
              serverNow: '2026-06-07T00:01:01.000Z',
              remainingSeconds: 12,
            },
          },
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('clock-status')).toHaveTextContent('LIVE');
      expect(screen.getByTestId('clock-revision')).toHaveTextContent('6');
      expect(screen.getByTestId('clock-remaining')).toHaveTextContent('missing');
      expect(screen.getByTestId('pick-deadline')).toHaveTextContent('2026-06-07T00:01:37.000Z');
    });
  });
});
