import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  LeagueSocialSummary,
  SocialMessage,
  SocialPost,
  SocialRealtimeEnvelope,
} from '@/types/social';

import { useLeagueSocial } from './useLeagueSocial';

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (value?: unknown) => void>();
  return {
    handlers,
    socket: {
      connected: false,
      emit: vi.fn(),
      on: vi.fn((event: string, handler: (value?: unknown) => void) => {
        handlers.set(event, handler);
      }),
      off: vi.fn((event: string) => {
        handlers.delete(event);
      }),
    },
    authenticatedFetch: vi.fn(),
  };
});

vi.mock('@/contexts/SocketContext', () => ({
  useSocket: () => mocks.socket,
}));

vi.mock('@/lib/authenticatedFetch', () => ({
  authenticatedFetch: mocks.authenticatedFetch,
}));

const summary: LeagueSocialSummary = {
  leagueId: 'league-1',
  seasonId: 'season-1',
  canManage: false,
  canPublish: true,
  standardsAccepted: true,
  mutedUntil: null,
  unread: { chat: 1, board: 0, activity: 0 },
  latestSequence: { chat: 10, board: 0, activity: 0 },
  preferences: {
    chatInApp: true,
    boardPosts: false,
    ownPostReplies: true,
    announcements: true,
    tradeDiscussions: false,
    mentions: true,
    systemActivityInApp: true,
  },
  categories: [],
};

const memberMessage: SocialMessage = {
  id: 'message-1',
  leagueId: 'league-1',
  seasonId: 'season-1',
  type: 'member',
  content: 'Member message',
  author: {
    userId: 'user-2',
    displayName: 'Other Member',
    teamName: 'Other Team',
  },
  createdAt: '2026-07-19T10:00:00.000Z',
  moderationStatus: 'active',
  isOwn: false,
};

const systemActivity: SocialMessage = {
  ...memberMessage,
  id: 'activity-1',
  type: 'system',
  content: 'Player drafted',
  author: null,
};

function response<T>(data: T): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({ success: true, data }),
  } as unknown as Response;
}

function initialResponse(url: string): Response {
  if (url.endsWith('/summary')) return response(summary);
  if (url.includes('/messages?')) {
    return response({ items: [memberMessage, systemActivity], nextCursor: null });
  }
  if (url.includes('/activity?')) {
    return response({ items: [systemActivity, memberMessage], nextCursor: 'activity-cursor' });
  }
  if (url.includes('/posts?')) return response({ items: [], nextCursor: null });
  throw new Error(`Unexpected request: ${url}`);
}

function envelope(
  event: SocialRealtimeEnvelope['event'],
  channel: SocialRealtimeEnvelope['channel'],
  sequence: number,
  payload: SocialRealtimeEnvelope['payload']
): SocialRealtimeEnvelope {
  return {
    id: `event-${sequence}`,
    sequence,
    leagueId: 'league-1',
    seasonId: 'season-1',
    channel,
    event,
    payload,
    occurredAt: '2026-07-19T10:01:00.000Z',
  };
}

describe('useLeagueSocial', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.socket.emit.mockReset();
    mocks.socket.emit.mockImplementation(
      (event: string, _payload: unknown, acknowledge?: (result: { ok: boolean }) => void) => {
        if (event === 'social:join') acknowledge?.({ ok: true });
      }
    );
    mocks.socket.on.mockClear();
    mocks.socket.off.mockClear();
    mocks.authenticatedFetch.mockReset();
    mocks.authenticatedFetch.mockImplementation((url: string) =>
      Promise.resolve(initialResponse(url))
    );
  });

  it('keeps member chat and system activity separate while receiving both in realtime', async () => {
    const { result, unmount } = renderHook(() => useLeagueSocial('league-1', 'user-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.messages.map((item) => item.id)).toEqual(['message-1']);
    expect(result.current.activity.map((item) => item.id)).toEqual(['activity-1']);
    expect(result.current.activityCursor).toBe('activity-cursor');
    expect(mocks.socket.emit).toHaveBeenCalledWith(
      'social:join',
      { leagueId: 'league-1' },
      expect.any(Function)
    );

    act(() => {
      mocks.handlers.get('social:message')?.(
        envelope('social:message', 'chat', 11, { ...memberMessage, id: 'message-2' })
      );
      mocks.handlers.get('social:activity')?.(
        envelope('social:activity', 'activity', 12, {
          ...systemActivity,
          id: 'activity-2',
        })
      );
    });

    expect(result.current.messages.map((item) => item.id)).toEqual(['message-1', 'message-2']);
    expect(result.current.activity.map((item) => item.id)).toEqual(['activity-1', 'activity-2']);
    expect(result.current.summary?.unread).toEqual({ chat: 2, board: 0, activity: 1 });

    unmount();
    expect(mocks.socket.emit).toHaveBeenCalledWith('social:leave', { leagueId: 'league-1' });
  });

  it('does not let a stale cross-device read event clear newer unread content', async () => {
    const { result } = renderHook(() => useLeagueSocial('league-1', 'user-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      mocks.handlers.get('social:message')?.(
        envelope('social:message', 'chat', 11, { ...memberMessage, id: 'message-2' })
      );
      mocks.handlers.get('social:read-state')?.(
        envelope('social:read-state', 'chat', 12, {
          userId: 'user-1',
          channel: 'chat',
          sequence: 10,
        })
      );
    });

    expect(result.current.summary?.latestSequence.chat).toBe(11);
    expect(result.current.summary?.unread.chat).toBe(2);
  });

  it('preserves unread content that arrives while an older read request is in flight', async () => {
    let resolveReadRequest: ((value: Response) => void) | undefined;
    mocks.authenticatedFetch.mockImplementation((url: string) => {
      if (url.endsWith('/read-state')) {
        return new Promise<Response>((resolve) => {
          resolveReadRequest = resolve;
        });
      }
      return Promise.resolve(initialResponse(url));
    });

    const { result } = renderHook(() => useLeagueSocial('league-1', 'user-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let readPromise: Promise<void> | undefined;
    act(() => {
      readPromise = result.current.markRead('chat');
    });
    await waitFor(() => expect(result.current.summary?.unread.chat).toBe(0));

    act(() => {
      mocks.handlers.get('social:message')?.(
        envelope('social:message', 'chat', 11, { ...memberMessage, id: 'message-2' })
      );
      resolveReadRequest?.(response({ channel: 'chat', sequence: 10 }));
    });
    await act(async () => {
      await readPromise;
    });

    expect(result.current.summary?.latestSequence.chat).toBe(11);
    expect(result.current.summary?.unread.chat).toBe(1);
  });

  it('coalesces visibility restoration with the reconnect catch-up resync', async () => {
    const { result } = renderHook(() => useLeagueSocial('league-1', 'user-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mocks.authenticatedFetch).toHaveBeenCalledTimes(8);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      mocks.handlers.get('connect')?.();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mocks.authenticatedFetch).toHaveBeenCalledTimes(12);
    expect(mocks.socket.emit).toHaveBeenLastCalledWith(
      'social:join',
      {
        leagueId: 'league-1',
      },
      expect.any(Function)
    );
  });

  it('loads authorized REST content while the socket is disconnected', async () => {
    mocks.socket.emit.mockImplementation(() => undefined);

    const { result, unmount } = renderHook(() => useLeagueSocial('league-1', 'user-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mocks.authenticatedFetch).toHaveBeenCalledTimes(4);
    expect(result.current.messages.map((message) => message.id)).toEqual(['message-1']);
    expect(result.current.activity.map((message) => message.id)).toEqual(['activity-1']);
    expect(result.current.error).toBeNull();
    unmount();
  });

  it('always starts a trailing snapshot after join acknowledgement', async () => {
    let acknowledgeJoin: ((result: { ok: boolean }) => void) | undefined;
    const pendingRequests: Array<{
      url: string;
      resolve: (value: Response) => void;
    }> = [];
    mocks.socket.emit.mockImplementation(
      (event: string, _payload: unknown, acknowledge?: (result: { ok: boolean }) => void) => {
        if (event === 'social:join') acknowledgeJoin = acknowledge;
      }
    );
    mocks.authenticatedFetch.mockImplementation(
      (url: string) =>
        new Promise<Response>((resolve) => {
          pendingRequests.push({ url, resolve });
        })
    );

    const { result } = renderHook(() => useLeagueSocial('league-1', 'user-1'));
    await waitFor(() => expect(pendingRequests).toHaveLength(4));
    await waitFor(() => expect(acknowledgeJoin).toBeTypeOf('function'));

    act(() => acknowledgeJoin?.({ ok: true }));
    expect(pendingRequests).toHaveLength(4);

    act(() => {
      pendingRequests.slice(0, 4).forEach(({ url, resolve }) => resolve(initialResponse(url)));
    });
    await waitFor(() => expect(pendingRequests).toHaveLength(8));

    act(() => {
      pendingRequests.slice(4, 8).forEach(({ url, resolve }) => resolve(initialResponse(url)));
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mocks.authenticatedFetch).toHaveBeenCalledTimes(8);
  });

  it('waits for successful room authorization before reconnect catch-up resync', async () => {
    let acknowledgeJoin: ((result: { ok: boolean }) => void) | undefined;
    mocks.socket.emit.mockImplementation(
      (event: string, _payload: unknown, acknowledge?: (result: { ok: boolean }) => void) => {
        if (event === 'social:join') acknowledgeJoin = acknowledge;
      }
    );

    const { result } = renderHook(() => useLeagueSocial('league-1', 'user-1'));
    await waitFor(() => expect(acknowledgeJoin).toBeTypeOf('function'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mocks.authenticatedFetch).toHaveBeenCalledTimes(4);

    act(() => acknowledgeJoin?.({ ok: false }));
    await waitFor(() =>
      expect(result.current.error).toBe('League social realtime authorization failed.')
    );
    expect(mocks.authenticatedFetch).toHaveBeenCalledTimes(4);

    acknowledgeJoin = undefined;
    act(() => {
      void mocks.handlers.get('connect')?.();
    });
    await waitFor(() => expect(acknowledgeJoin).toBeTypeOf('function'));
    expect(mocks.authenticatedFetch).toHaveBeenCalledTimes(4);
    act(() => acknowledgeJoin?.({ ok: true }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mocks.authenticatedFetch).toHaveBeenCalledTimes(8);
  });

  it('reconciles stale reconnect snapshots with realtime events received during resync', async () => {
    const { result } = renderHook(() => useLeagueSocial('league-1', 'user-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const pendingRequests: Array<{
      url: string;
      resolve: (value: Response) => void;
    }> = [];
    mocks.authenticatedFetch.mockImplementation(
      (url: string) =>
        new Promise<Response>((resolve) => {
          pendingRequests.push({ url, resolve });
        })
    );

    act(() => {
      void mocks.handlers.get('connect')?.();
    });
    await waitFor(() => expect(pendingRequests).toHaveLength(4));

    const realtimePost: SocialPost = {
      id: 'post-realtime',
      leagueId: 'league-1',
      seasonId: 'season-1',
      category: { id: 'category-1', key: 'general', name: 'General', position: 1 },
      author: {
        userId: 'user-2',
        displayName: 'Other Member',
        teamName: 'Other Team',
      },
      title: 'Realtime post',
      body: 'Arrived while snapshots were loading.',
      isPinned: false,
      isLocked: false,
      isAnnouncement: false,
      replyCount: 0,
      latestActivityAt: '2026-07-19T10:03:00.000Z',
      createdAt: '2026-07-19T10:03:00.000Z',
      updatedAt: '2026-07-19T10:03:00.000Z',
      moderationStatus: 'active',
      isOwn: false,
    };
    act(() => {
      mocks.handlers.get('social:message')?.(
        envelope('social:message', 'chat', 11, {
          ...memberMessage,
          content: 'Realtime version',
        })
      );
      mocks.handlers.get('social:activity')?.(
        envelope('social:activity', 'activity', 12, {
          ...systemActivity,
          content: 'Realtime activity version',
        })
      );
      mocks.handlers.get('social:post')?.(envelope('social:post', 'board', 13, realtimePost));
      pendingRequests.forEach(({ url, resolve }) => resolve(initialResponse(url)));
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.messages).toEqual([
      expect.objectContaining({ id: 'message-1', content: 'Realtime version' }),
    ]);
    expect(result.current.activity).toEqual([
      expect.objectContaining({
        id: 'activity-1',
        content: 'Realtime activity version',
      }),
    ]);
    expect(result.current.posts).toEqual([expect.objectContaining({ id: 'post-realtime' })]);
    expect(result.current.summary?.latestSequence).toEqual({
      chat: 11,
      activity: 12,
      board: 13,
    });
    expect(result.current.summary?.unread).toEqual({
      chat: 2,
      activity: 1,
      board: 1,
    });
  });
});
