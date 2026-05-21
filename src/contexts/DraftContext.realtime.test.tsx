import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const socketMocks = vi.hoisted(() => ({
  socket: null as ReturnType<typeof createSocketDouble> | null,
}));

vi.mock('@/contexts/SocketContext', () => ({
  useSocket: () => socketMocks.socket,
}));

vi.mock('@/lib/api', () => ({
  fetchApi: vi.fn(),
}));

import { applyDelta, DraftProvider, useDraft } from './DraftContext';
import type { DraftDelta, DraftState } from './DraftContext';

function createSocketDouble(connected = false) {
  const handlers = new Map<string, (...args: any[]) => void>();
  const managerHandlers = new Map<string, (...args: any[]) => void>();
  return {
    connected,
    handlers,
    managerHandlers,
    emit: vi.fn(),
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      handlers.set(event, handler);
    }),
    off: vi.fn((event: string, handler: (...args: any[]) => void) => {
      if (handlers.get(event) === handler) handlers.delete(event);
    }),
    io: {
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        managerHandlers.set(event, handler);
      }),
      off: vi.fn((event: string, handler: (...args: any[]) => void) => {
        if (managerHandlers.get(event) === handler) managerHandlers.delete(event);
      }),
    },
  };
}

function baseState(): DraftState {
  return {
    draft: null,
    participants: [],
    picks: [],
    availablePlayers: [
      { id: 'player-1', name: 'Player One', position: 'MID', club: 'Carlton', isAvailable: true },
    ],
    selectedCategories: [],
    watchlistItems: [],
    liveState: {},
    connection: { status: 'connected', lastEventAt: 0 },
    isSaving: false,
    isLoading: false,
    error: null,
    appliedEventIds: [],
  };
}

const pickDelta: DraftDelta = {
  type: 'PICK_MADE',
  eventId: 'draft-1:pick:1:player-1',
  ts: 1,
  payload: {
    pick: {
      id: 'pick-1',
      overall: 1,
      round: 1,
      slot: 1,
      player: { id: 'player-1', name: 'Player One', position: 'MID', club: 'Carlton' },
      member: { id: 'member-1', displayName: 'Member One' },
      auto: false,
      madeAt: '2026-05-18T10:00:00.000Z',
      timestamp: new Date('2026-05-18T10:00:00.000Z'),
    },
  },
};

describe('DraftContext realtime idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    socketMocks.socket = null;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  it('applies duplicate PICK_MADE realtime deltas once', () => {
    const once = applyDelta(baseState(), pickDelta);
    const twice = applyDelta(once, pickDelta);

    expect(twice.picks).toHaveLength(1);
    expect(twice.availablePlayers.map((player) => player.id)).not.toContain('player-1');
    expect(twice.appliedEventIds).toEqual(['draft-1:pick:1:player-1']);
  });

  it('joins and requests reconnect backfill from the last known event time on connect', async () => {
    const socket = createSocketDouble(true);
    socketMocks.socket = socket;

    render(
      <DraftProvider
        draftId="draft-1"
        userId="user-1"
        initialSnapshot={{
          draft: null,
          participants: [],
          picks: [],
          availablePlayers: [],
          ts: 123,
        }}
      >
        <DraftStatusProbe />
      </DraftProvider>
    );

    await waitFor(() => {
      expect(socket.emit).toHaveBeenCalledWith('draft:join', { draftId: 'draft-1' });
    });
    expect(socket.emit).toHaveBeenCalledWith('draft:backfill', {
      draftId: 'draft-1',
      since: 123,
    });
    expect(screen.getByTestId('status')).toHaveTextContent('connected');
  });

  it('marks reconnect attempts and removes draft socket listeners on unmount', async () => {
    const socket = createSocketDouble(false);
    socketMocks.socket = socket;

    const { unmount } = render(
      <DraftProvider
        draftId="draft-1"
        userId="user-1"
        initialSnapshot={{
          draft: null,
          participants: [],
          picks: [],
          availablePlayers: [],
          ts: 0,
        }}
      >
        <DraftStatusProbe />
      </DraftProvider>
    );

    act(() => {
      socket.managerHandlers.get('reconnect_attempt')?.();
    });
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('reconnecting');
    });

    unmount();

    expect(socket.off).toHaveBeenCalledWith('connect', expect.any(Function));
    expect(socket.off).toHaveBeenCalledWith('disconnect', expect.any(Function));
    expect(socket.off).toHaveBeenCalledWith('draft:snapshot', expect.any(Function));
    expect(socket.off).toHaveBeenCalledWith('draft:delta', expect.any(Function));
    expect(socket.off).toHaveBeenCalledWith('draft:backfill', expect.any(Function));
    expect(socket.io.off).toHaveBeenCalledWith('reconnect_attempt', expect.any(Function));
    expect(socket.emit).toHaveBeenCalledWith('draft:leave', { draftId: 'draft-1' });
  });
});

function DraftStatusProbe() {
  const draft = useDraft();
  return <div data-testid="status">{draft.connection.status}</div>;
}
