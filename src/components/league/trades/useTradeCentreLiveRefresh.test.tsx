import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TRADE_CATCH_UP_INTERVAL_MS, useTradeCentreLiveRefresh } from './useTradeCentreLiveRefresh';

type Handler = (payload?: unknown) => void;
type Ack = (acknowledgement?: { ok?: boolean }) => void;

const { authenticatedFetch, socketState } = vi.hoisted(() => ({
  authenticatedFetch: vi.fn(),
  socketState: { current: null as unknown },
}));

vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch }));
vi.mock('@/providers/SocketProvider', () => ({ useSocket: () => socketState.current }));

function createSocket(connected = true) {
  const handlers = new Map<string, Set<Handler>>();
  const acks: Ack[] = [];
  return {
    connected,
    acks,
    emit: vi.fn((_event: string, _payload: unknown, ack?: Ack) => {
      if (ack) acks.push(ack);
    }),
    on: vi.fn((event: string, handler: Handler) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    }),
    off: vi.fn((event: string, handler: Handler) => {
      handlers.get(event)?.delete(handler);
    }),
    receive(event: string, payload?: unknown) {
      handlers.get(event)?.forEach((handler) => handler(payload));
    },
  };
}

function revisionResponse(revision: string) {
  return new Response(JSON.stringify({ revision }), { status: 200 });
}

async function tick() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(TRADE_CATCH_UP_INTERVAL_MS);
  });
}

function renderRefresh(onChange: () => void, revision: string | null = '1.1.100') {
  return renderHook(() =>
    useTradeCentreLiveRefresh({ leagueId: 'league-1', currentUserId: 'user-1', revision, onChange })
  );
}

describe('useTradeCentreLiveRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    socketState.current = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls the trade revision without a socket and refreshes only when it changes', async () => {
    const onChange = vi.fn();
    authenticatedFetch
      .mockResolvedValueOnce(revisionResponse('1.1.100'))
      .mockResolvedValueOnce(revisionResponse('2.2.200'))
      .mockResolvedValueOnce(revisionResponse('2.2.200'));
    renderRefresh(onChange);

    await tick();
    expect(authenticatedFetch).toHaveBeenCalledWith(
      '/api/leagues/league-1/trades/revision',
      { cache: 'no-store' },
      'user-1'
    );
    expect(onChange).not.toHaveBeenCalled();

    await tick();
    expect(onChange).toHaveBeenCalledTimes(1);

    // The same new revision again (the refreshed snapshot has not landed yet) is not a second change.
    await tick();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('skips catch-up while the tab is hidden and ignores failed requests', async () => {
    const onChange = vi.fn();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    renderRefresh(onChange);

    await tick();
    expect(authenticatedFetch).not.toHaveBeenCalled();

    visibility.mockReturnValue('visible');
    authenticatedFetch.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    await tick();
    authenticatedFetch.mockRejectedValueOnce(new Error('offline'));
    await tick();
    expect(onChange).not.toHaveBeenCalled();
    visibility.mockRestore();
  });

  it('does not poll while the league room is live, and refreshes on its trade events', async () => {
    const onChange = vi.fn();
    const socket = createSocket();
    socketState.current = socket;
    renderRefresh(onChange);

    expect(socket.emit).toHaveBeenCalledWith(
      'social:join',
      { leagueId: 'league-1' },
      expect.any(Function)
    );
    act(() => socket.acks[0]({ ok: true }));

    await tick();
    expect(authenticatedFetch).not.toHaveBeenCalled();

    act(() => socket.receive('trade:update', { leagueId: 'league-2' }));
    expect(onChange).not.toHaveBeenCalled();
    act(() =>
      socket.receive('trade:update', { leagueId: 'league-1', payload: { threadId: 't-1' } })
    );
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('falls back to polling when the join goes unanswered or the socket disconnects', async () => {
    const onChange = vi.fn();
    authenticatedFetch.mockResolvedValue(revisionResponse('1.1.100'));
    const socket = createSocket();
    socketState.current = socket;
    renderRefresh(onChange);

    // No acknowledgement: after the join timeout the hook treats the room as unavailable.
    await tick();
    await tick();
    expect(authenticatedFetch).toHaveBeenCalled();

    authenticatedFetch.mockClear();
    act(() => socket.receive('connect'));
    expect(onChange).toHaveBeenCalledTimes(1);
    act(() => socket.acks[1]({ ok: true }));
    await tick();
    expect(authenticatedFetch).not.toHaveBeenCalled();

    act(() => socket.receive('disconnect'));
    await tick();
    expect(authenticatedFetch).toHaveBeenCalledTimes(1);
  });
});
