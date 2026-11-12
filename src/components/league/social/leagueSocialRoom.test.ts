import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LEAGUE_SOCIAL_JOIN_TIMEOUT_MS, subscribeLeagueSocialRoom } from './leagueSocialRoom';

type Handler = (...args: unknown[]) => void;

function createSocket(connected = true) {
  const handlers = new Map<string, Set<Handler>>();
  const socket = {
    connected,
    emit: vi.fn(),
    on: vi.fn((event: string, handler: Handler) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)?.add(handler);
    }),
    off: vi.fn((event: string, handler: Handler) => {
      handlers.get(event)?.delete(handler);
    }),
  };
  const fire = (event: string) => [...(handlers.get(event) ?? [])].forEach((handler) => handler());
  const emitted = (event: string) => socket.emit.mock.calls.filter(([name]) => name === event);
  const answerJoin = (index: number, acknowledgement?: { ok?: boolean }) => {
    const call = emitted('social:join')[index];
    (call?.[2] as (value?: { ok?: boolean }) => void)(acknowledgement);
  };
  return { socket, fire, emitted, answerJoin, handlers };
}

describe('subscribeLeagueSocialRoom', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('joins once for several subscribers and leaves only when the last one goes', () => {
    const { socket, emitted, answerJoin } = createSocket();
    const chat = vi.fn();
    const trades = vi.fn();

    const leaveChat = subscribeLeagueSocialRoom(socket, 'league-1', chat);
    answerJoin(0, { ok: true });
    const leaveTrades = subscribeLeagueSocialRoom(socket, 'league-1', trades);

    expect(emitted('social:join')).toHaveLength(1);
    expect(chat).toHaveBeenLastCalledWith('live');
    expect(trades).toHaveBeenLastCalledWith('live');

    leaveChat();
    expect(emitted('social:leave')).toHaveLength(0);

    leaveTrades();
    expect(emitted('social:leave')).toEqual([['social:leave', { leagueId: 'league-1' }]]);
  });

  it('keeps separate rooms per league', () => {
    const { socket, emitted } = createSocket();
    const leaveOne = subscribeLeagueSocialRoom(socket, 'league-1', vi.fn());
    subscribeLeagueSocialRoom(socket, 'league-2', vi.fn());

    leaveOne();

    expect(emitted('social:join')).toHaveLength(2);
    expect(emitted('social:leave')).toEqual([['social:leave', { leagueId: 'league-1' }]]);
  });

  it('reports a refused join and an unanswered join differently', () => {
    const refused = createSocket();
    const refusedListener = vi.fn();
    subscribeLeagueSocialRoom(refused.socket, 'league-1', refusedListener);
    refused.answerJoin(0, { ok: false });
    expect(refusedListener).toHaveBeenLastCalledWith('refused');

    const silent = createSocket();
    const silentListener = vi.fn();
    subscribeLeagueSocialRoom(silent.socket, 'league-1', silentListener);
    expect(silentListener).toHaveBeenLastCalledWith('joining');
    vi.advanceTimersByTime(LEAGUE_SOCIAL_JOIN_TIMEOUT_MS);
    expect(silentListener).toHaveBeenLastCalledWith('unavailable');
  });

  it('does not join while disconnected, then rejoins and reports live on every connect', () => {
    const { socket, fire, emitted, answerJoin } = createSocket(false);
    const listener = vi.fn();
    subscribeLeagueSocialRoom(socket, 'league-1', listener);

    expect(emitted('social:join')).toHaveLength(0);
    expect(listener).toHaveBeenLastCalledWith('unavailable');

    fire('connect');
    answerJoin(0, { ok: true });
    expect(listener).toHaveBeenLastCalledWith('live');

    fire('disconnect');
    expect(listener).toHaveBeenLastCalledWith('unavailable');

    fire('connect');
    answerJoin(1, { ok: true });
    expect(listener.mock.calls.filter(([status]) => status === 'live')).toHaveLength(2);
  });

  it('ignores a late answer to a join the disconnect abandoned', () => {
    const { socket, fire, answerJoin } = createSocket();
    const listener = vi.fn();
    subscribeLeagueSocialRoom(socket, 'league-1', listener);

    fire('disconnect');
    answerJoin(0, { ok: true });

    expect(listener).toHaveBeenLastCalledWith('unavailable');
  });

  it('removes its socket handlers and ignores a second unsubscribe', () => {
    const { socket, emitted, handlers } = createSocket();
    const leave = subscribeLeagueSocialRoom(socket, 'league-1', vi.fn());

    leave();
    leave();

    expect(emitted('social:leave')).toHaveLength(1);
    expect(handlers.get('connect')?.size).toBe(0);
    expect(handlers.get('disconnect')?.size).toBe(0);
  });
});
