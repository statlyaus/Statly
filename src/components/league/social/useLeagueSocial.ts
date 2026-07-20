'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useSocket } from '@/contexts/SocketContext';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import type {
  CreateSocialMessageInput,
  CreateSocialPostInput,
  CreateSocialReplyInput,
  LeagueSocialSummary,
  SocialChannel,
  SocialCursorPage,
  SocialMessage,
  SocialNotificationPreferences,
  SocialPost,
  SocialPostThread,
  SocialRealtimeEnvelope,
  SocialReportReason,
  SocialReply,
} from '@/types/social';

type ThreadState = SocialCursorPage<SocialReply> & {
  loading: boolean;
  error: string | null;
};

export type SocialPostSort = 'latestActivity' | 'createdAt';

interface LeagueSocialState {
  summary: LeagueSocialSummary | null;
  messages: SocialMessage[];
  activity: SocialMessage[];
  posts: SocialPost[];
  threads: Record<string, ThreadState>;
  messagesCursor: string | null;
  activityCursor: string | null;
  postsCursor: string | null;
  loading: boolean;
  loadingEarlierMessages: boolean;
  loadingEarlierActivity: boolean;
  loadingMorePosts: boolean;
  sendingMessage: boolean;
  creatingPost: boolean;
  error: string | null;
  submitError: string | null;
}

const initialState: LeagueSocialState = {
  summary: null,
  messages: [],
  activity: [],
  posts: [],
  threads: {},
  messagesCursor: null,
  activityCursor: null,
  postsCursor: null,
  loading: true,
  loadingEarlierMessages: false,
  loadingEarlierActivity: false,
  loadingMorePosts: false,
  sendingMessage: false,
  creatingPost: false,
  error: null,
  submitError: null,
};

function createIdempotencyKey(prefix: string): string {
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${id}`;
}

async function readApiData<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as {
    success?: boolean;
    data?: T;
    error?: string | { message?: string };
  } | null;

  if (!response.ok || body?.success !== true || body.data === undefined) {
    const errorMessage =
      typeof body?.error === 'string'
        ? body.error
        : body?.error?.message || `Request failed (${response.status})`;
    throw new Error(errorMessage);
  }

  return body.data;
}

function sortMessages(messages: SocialMessage[]): SocialMessage[] {
  return [...messages].sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  );
}

function memberMessagesOnly(messages: SocialMessage[]): SocialMessage[] {
  return messages.filter((message) => message.type !== 'system');
}

function activityMessagesOnly(messages: SocialMessage[]): SocialMessage[] {
  return messages.filter((message) => message.type === 'system');
}

function sortPosts(posts: SocialPost[]): SocialPost[] {
  return [...posts].sort((left, right) => {
    if (left.isPinned !== right.isPinned) return left.isPinned ? -1 : 1;
    return new Date(right.latestActivityAt).getTime() - new Date(left.latestActivityAt).getTime();
  });
}

function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  return [...items.filter((candidate) => candidate.id !== item.id), item];
}

function reconcileById<T extends { id: string }>(
  current: T[],
  snapshot: T[],
  preferCurrent: boolean
): T[] {
  const reconciled = new Map<string, T>();
  const first = preferCurrent ? snapshot : current;
  const second = preferCurrent ? current : snapshot;
  first.forEach((item) => reconciled.set(item.id, item));
  second.forEach((item) => reconciled.set(item.id, item));
  return [...reconciled.values()];
}

function reconcileSummary(
  current: LeagueSocialSummary | null,
  snapshot: LeagueSocialSummary
): LeagueSocialSummary {
  if (
    !current ||
    current.leagueId !== snapshot.leagueId ||
    current.seasonId !== snapshot.seasonId
  ) {
    return snapshot;
  }

  const channels: SocialChannel[] = ['chat', 'board', 'activity'];
  return channels.reduce<LeagueSocialSummary>((result, channel) => {
    if (current.latestSequence[channel] <= snapshot.latestSequence[channel]) return result;
    return {
      ...result,
      latestSequence: {
        ...result.latestSequence,
        [channel]: current.latestSequence[channel],
      },
      unread: {
        ...result.unread,
        [channel]: current.unread[channel],
      },
    };
  }, snapshot);
}

function getRealtimePayload<T>(value: T | SocialRealtimeEnvelope, leagueId: string): T | null {
  if (!value || typeof value !== 'object') return null;
  if ('leagueId' in value && value.leagueId !== leagueId) return null;
  if ('payload' in value && 'event' in value) return value.payload as T;
  return value as T;
}

function getRealtimeSequence(
  value: SocialMessage | SocialPost | SocialReply | SocialRealtimeEnvelope
): number | null {
  return 'sequence' in value && Number.isInteger(value.sequence) ? value.sequence : null;
}

function updateRealtimeSummary(
  summary: LeagueSocialSummary | null,
  channel: SocialChannel,
  sequence: number | null,
  isOwn: boolean
): LeagueSocialSummary | null {
  if (!summary || sequence === null || sequence <= summary.latestSequence[channel]) {
    return summary;
  }

  return {
    ...summary,
    latestSequence: {
      ...summary.latestSequence,
      [channel]: sequence,
    },
    unread: {
      ...summary.unread,
      [channel]: isOwn ? summary.unread[channel] : summary.unread[channel] + 1,
    },
  };
}

export interface LeagueSocialController extends LeagueSocialState {
  clearSubmitError: () => void;
  retry: () => Promise<void>;
  loadEarlierMessages: () => Promise<void>;
  loadEarlierActivity: () => Promise<void>;
  loadMorePosts: () => Promise<void>;
  sendMessage: (input: CreateSocialMessageInput) => Promise<void>;
  createPost: (input: Omit<CreateSocialPostInput, 'idempotencyKey'>) => Promise<SocialPost>;
  updatePost: (
    postId: string,
    input: { isPinned?: boolean; isLocked?: boolean }
  ) => Promise<SocialPost>;
  deletePost: (postId: string) => Promise<SocialPost>;
  updatePreferences: (
    preferences: SocialNotificationPreferences
  ) => Promise<SocialNotificationPreferences>;
  acceptStandards: () => Promise<void>;
  reportContent: (
    contentType: 'message' | 'post' | 'reply',
    contentId: string,
    reason: SocialReportReason,
    details?: string
  ) => Promise<void>;
  moderateContent: (
    contentType: 'message' | 'post' | 'reply',
    contentId: string,
    reason: string
  ) => Promise<void>;
  loadReplies: (postId: string, loadMore?: boolean) => Promise<void>;
  createReply: (postId: string, body: string, idempotencyKey: string) => Promise<void>;
  markRead: (channel: SocialChannel) => Promise<void>;
  postSort: SocialPostSort;
  setPostSort: (sort: SocialPostSort) => void;
}

export function useLeagueSocial(leagueId: string, currentUserId?: string): LeagueSocialController {
  const socket = useSocket();
  const [state, setState] = useState<LeagueSocialState>(initialState);
  const [postSort, setPostSort] = useState<SocialPostSort>('latestActivity');
  const inFlightReadSequences = useRef<Partial<Record<SocialChannel, number>>>({});
  const resyncPromiseRef = useRef<Promise<void> | null>(null);
  const basePath = useMemo(() => `/api/leagues/${encodeURIComponent(leagueId)}/social`, [leagueId]);

  const apiRequest = useCallback(
    async <T>(path: string, init: RequestInit = {}): Promise<T> => {
      const response = await authenticatedFetch(`${basePath}${path}`, init, currentUserId);
      return readApiData<T>(response);
    },
    [basePath, currentUserId]
  );

  const clearSubmitError = useCallback((): void => {
    setState((current) =>
      current.submitError === null ? current : { ...current, submitError: null }
    );
  }, []);

  const loadSummary = useCallback(async (): Promise<void> => {
    const summary = await apiRequest<LeagueSocialSummary>('/summary');
    setState((current) => ({ ...current, summary }));
  }, [apiRequest]);

  const loadInitial = useCallback(async (): Promise<void> => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const [summary, messagePage, activityPage, postPage] = await Promise.all([
        apiRequest<LeagueSocialSummary>('/summary'),
        apiRequest<SocialCursorPage<SocialMessage>>('/messages?limit=50'),
        apiRequest<SocialCursorPage<SocialMessage>>('/activity?limit=50'),
        apiRequest<SocialCursorPage<SocialPost>>(`/posts?limit=30&sort=${postSort}`),
      ]);
      setState((current) => {
        const reconciledSummary = reconcileSummary(current.summary, summary);
        const sameScope =
          current.summary?.leagueId === summary.leagueId &&
          current.summary.seasonId === summary.seasonId;
        const chatAdvanced =
          sameScope &&
          current.summary !== null &&
          current.summary.latestSequence.chat > summary.latestSequence.chat;
        const activityAdvanced =
          sameScope &&
          current.summary !== null &&
          current.summary.latestSequence.activity > summary.latestSequence.activity;
        const boardAdvanced =
          sameScope &&
          current.summary !== null &&
          current.summary.latestSequence.board > summary.latestSequence.board;

        return {
          ...current,
          summary: reconciledSummary,
          messages: sortMessages(
            reconcileById(
              sameScope ? current.messages : [],
              memberMessagesOnly(messagePage.items),
              chatAdvanced
            )
          ),
          activity: sortMessages(
            reconcileById(
              sameScope ? current.activity : [],
              activityMessagesOnly(activityPage.items),
              activityAdvanced
            )
          ),
          posts: sortPosts(
            reconcileById(sameScope ? current.posts : [], postPage.items, boardAdvanced)
          ),
          messagesCursor: messagePage.nextCursor,
          activityCursor: activityPage.nextCursor,
          postsCursor: postPage.nextCursor,
          loading: false,
          error: null,
        };
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to load league social activity.',
      }));
    }
  }, [apiRequest, postSort]);

  const resync = useCallback((): Promise<void> => {
    if (resyncPromiseRef.current) return resyncPromiseRef.current;

    const request = loadInitial().finally(() => {
      if (resyncPromiseRef.current === request) {
        resyncPromiseRef.current = null;
      }
    });
    resyncPromiseRef.current = request;
    return request;
  }, [loadInitial]);

  useEffect(() => {
    void resync();
  }, [resync]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && (!socket || socket.connected)) {
        void resync();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [resync, socket]);

  useEffect(() => {
    if (!socket || !leagueId) return;

    let cancelled = false;
    let joinPromise: Promise<boolean> | null = null;
    let joinTimeoutId: number | null = null;

    const joinLeagueSocial = (): Promise<boolean> => {
      if (joinPromise) return joinPromise;

      const request = new Promise<boolean>((resolve) => {
        joinTimeoutId = window.setTimeout(() => {
          joinTimeoutId = null;
          resolve(false);
        }, 5_000);
        socket.emit(
          'social:join',
          { leagueId },
          (acknowledgement: { ok?: boolean } | undefined) => {
            if (joinTimeoutId !== null) {
              window.clearTimeout(joinTimeoutId);
              joinTimeoutId = null;
            }
            resolve(acknowledgement?.ok === true);
          }
        );
      }).finally(() => {
        if (joinPromise === request) joinPromise = null;
      });
      joinPromise = request;
      return request;
    };
    const rejoinAndResync = async () => {
      const authorized = await joinLeagueSocial();
      if (cancelled) return;
      if (!authorized) {
        setState((current) => ({
          ...current,
          loading: false,
          error: 'League social realtime authorization failed.',
        }));
        return;
      }

      const preAuthorizationResync = resyncPromiseRef.current;
      if (preAuthorizationResync) {
        await preAuthorizationResync;
      }
      if (cancelled) return;
      await resync();
    };

    const handleMessage = (value: SocialMessage | SocialRealtimeEnvelope) => {
      const payload = getRealtimePayload<SocialMessage>(value, leagueId);
      if (!payload?.id || !payload.createdAt || payload.type === 'system') return;
      const sequence = getRealtimeSequence(value);
      const isOwn = Boolean(currentUserId && payload.author?.userId === currentUserId);
      const message = { ...payload, isOwn };
      setState((current) => ({
        ...current,
        summary: updateRealtimeSummary(current.summary, 'chat', sequence, isOwn),
        messages: sortMessages(upsertById(current.messages, message)),
      }));
    };
    const handleActivity = (value: SocialMessage | SocialRealtimeEnvelope) => {
      const payload = getRealtimePayload<SocialMessage>(value, leagueId);
      if (!payload?.id || !payload.createdAt || payload.type !== 'system') return;
      const sequence = getRealtimeSequence(value);
      setState((current) => ({
        ...current,
        summary: updateRealtimeSummary(current.summary, 'activity', sequence, false),
        activity: sortMessages(upsertById(current.activity, { ...payload, isOwn: false })),
      }));
    };
    const handlePost = (value: SocialPost | SocialRealtimeEnvelope) => {
      const payload = getRealtimePayload<SocialPost>(value, leagueId);
      if (!payload?.id || !payload.latestActivityAt) return;
      const sequence = getRealtimeSequence(value);
      const isOwn = Boolean(currentUserId && payload.author?.userId === currentUserId);
      const post = { ...payload, isOwn };
      setState((current) => ({
        ...current,
        summary: updateRealtimeSummary(current.summary, 'board', sequence, isOwn),
        posts: sortPosts(upsertById(current.posts, post)),
      }));
    };
    const handleReply = (value: SocialReply | SocialRealtimeEnvelope) => {
      const payload = getRealtimePayload<SocialReply>(value, leagueId);
      if (!payload?.id || !payload.postId) return;
      const sequence = getRealtimeSequence(value);
      const isOwn = Boolean(currentUserId && payload.author?.userId === currentUserId);
      const reply = { ...payload, isOwn };
      setState((current) => {
        const thread = current.threads[reply.postId];
        const replyAlreadyLoaded = Boolean(
          thread?.items.some((candidate) => candidate.id === reply.id)
        );
        return {
          ...current,
          summary: updateRealtimeSummary(current.summary, 'board', sequence, isOwn),
          threads: thread
            ? {
                ...current.threads,
                [reply.postId]: {
                  ...thread,
                  items: upsertById(thread.items, reply),
                },
              }
            : current.threads,
          posts: current.posts.map((post) =>
            post.id === reply.postId
              ? {
                  ...post,
                  replyCount: replyAlreadyLoaded ? post.replyCount : post.replyCount + 1,
                  latestActivityAt: reply.createdAt,
                }
              : post
          ),
        };
      });
    };
    const handleModeration = () => {
      void loadInitial();
    };
    const handleReadState = (value: SocialRealtimeEnvelope) => {
      const readState = getRealtimePayload<{
        userId: string;
        channel: SocialChannel;
        sequence: number;
      }>(value, leagueId);
      if (!readState || readState.userId !== currentUserId) return;
      setState((current) => ({
        ...current,
        summary: current.summary
          ? {
              ...current.summary,
              unread: {
                ...current.summary.unread,
                [readState.channel]:
                  readState.sequence >= current.summary.latestSequence[readState.channel]
                    ? 0
                    : current.summary.unread[readState.channel],
              },
            }
          : current.summary,
      }));
    };

    socket.on('social:message', handleMessage);
    socket.on('social:activity', handleActivity);
    socket.on('social:post', handlePost);
    socket.on('social:reply', handleReply);
    socket.on('social:moderation', handleModeration);
    socket.on('social:read-state', handleReadState);
    socket.on('connect', rejoinAndResync);
    void rejoinAndResync();

    return () => {
      cancelled = true;
      if (joinTimeoutId !== null) {
        window.clearTimeout(joinTimeoutId);
        joinTimeoutId = null;
      }
      socket.off('connect', rejoinAndResync);
      socket.off('social:message', handleMessage);
      socket.off('social:activity', handleActivity);
      socket.off('social:post', handlePost);
      socket.off('social:reply', handleReply);
      socket.off('social:moderation', handleModeration);
      socket.off('social:read-state', handleReadState);
      socket.emit('social:leave', { leagueId });
    };
  }, [currentUserId, leagueId, loadInitial, resync, socket]);

  const loadEarlierMessages = useCallback(async (): Promise<void> => {
    if (!state.messagesCursor || state.loadingEarlierMessages) return;
    setState((current) => ({ ...current, loadingEarlierMessages: true }));
    try {
      const page = await apiRequest<SocialCursorPage<SocialMessage>>(
        `/messages?limit=50&cursor=${encodeURIComponent(state.messagesCursor)}`
      );
      setState((current) => ({
        ...current,
        messages: sortMessages([
          ...page.items,
          ...current.messages.filter(
            (message) => !page.items.some((candidate) => candidate.id === message.id)
          ),
        ]),
        messagesCursor: page.nextCursor,
        loadingEarlierMessages: false,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        loadingEarlierMessages: false,
        error: error instanceof Error ? error.message : 'Failed to load earlier messages.',
      }));
    }
  }, [apiRequest, state.loadingEarlierMessages, state.messagesCursor]);

  const loadEarlierActivity = useCallback(async (): Promise<void> => {
    if (!state.activityCursor || state.loadingEarlierActivity) return;
    setState((current) => ({ ...current, loadingEarlierActivity: true }));
    try {
      const page = await apiRequest<SocialCursorPage<SocialMessage>>(
        `/activity?limit=50&cursor=${encodeURIComponent(state.activityCursor)}`
      );
      setState((current) => ({
        ...current,
        activity: sortMessages([
          ...activityMessagesOnly(page.items),
          ...current.activity.filter(
            (message) => !page.items.some((candidate) => candidate.id === message.id)
          ),
        ]),
        activityCursor: page.nextCursor,
        loadingEarlierActivity: false,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        loadingEarlierActivity: false,
        error: error instanceof Error ? error.message : 'Failed to load earlier league activity.',
      }));
    }
  }, [apiRequest, state.activityCursor, state.loadingEarlierActivity]);

  const loadMorePosts = useCallback(async (): Promise<void> => {
    if (!state.postsCursor || state.loadingMorePosts) return;
    setState((current) => ({ ...current, loadingMorePosts: true }));
    try {
      const page = await apiRequest<SocialCursorPage<SocialPost>>(
        `/posts?limit=30&sort=${postSort}&cursor=${encodeURIComponent(state.postsCursor)}`
      );
      setState((current) => ({
        ...current,
        posts: sortPosts([
          ...current.posts,
          ...page.items.filter(
            (post) => !current.posts.some((candidate) => candidate.id === post.id)
          ),
        ]),
        postsCursor: page.nextCursor,
        loadingMorePosts: false,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        loadingMorePosts: false,
        error: error instanceof Error ? error.message : 'Failed to load more posts.',
      }));
    }
  }, [apiRequest, postSort, state.loadingMorePosts, state.postsCursor]);

  const sendMessage = useCallback(
    async (input: CreateSocialMessageInput): Promise<void> => {
      setState((current) => ({ ...current, sendingMessage: true, submitError: null }));
      try {
        const message = await apiRequest<SocialMessage>('/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
        setState((current) => ({
          ...current,
          messages: sortMessages(upsertById(current.messages, message)),
          sendingMessage: false,
        }));
      } catch (error) {
        setState((current) => ({
          ...current,
          sendingMessage: false,
          submitError: error instanceof Error ? error.message : 'Failed to send message.',
        }));
        throw error;
      }
    },
    [apiRequest]
  );

  const createPost = useCallback(
    async (input: Omit<CreateSocialPostInput, 'idempotencyKey'>): Promise<SocialPost> => {
      setState((current) => ({ ...current, creatingPost: true, submitError: null }));
      try {
        const post = await apiRequest<SocialPost>('/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...input,
            idempotencyKey: createIdempotencyKey('post'),
          } satisfies CreateSocialPostInput),
        });
        setState((current) => ({
          ...current,
          posts: sortPosts(upsertById(current.posts, post)),
          creatingPost: false,
        }));
        return post;
      } catch (error) {
        setState((current) => ({
          ...current,
          creatingPost: false,
          submitError: error instanceof Error ? error.message : 'Failed to create post.',
        }));
        throw error;
      }
    },
    [apiRequest]
  );

  const updatePost = useCallback(
    async (
      postId: string,
      input: { isPinned?: boolean; isLocked?: boolean }
    ): Promise<SocialPost> => {
      const post = await apiRequest<SocialPost>(`/posts/${encodeURIComponent(postId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      setState((current) => ({
        ...current,
        posts: sortPosts(upsertById(current.posts, post)),
      }));
      return post;
    },
    [apiRequest]
  );

  const deletePost = useCallback(
    async (postId: string): Promise<SocialPost> => {
      const post = await apiRequest<SocialPost>(`/posts/${encodeURIComponent(postId)}`, {
        method: 'DELETE',
      });
      setState((current) => ({
        ...current,
        posts: sortPosts(upsertById(current.posts, post)),
      }));
      return post;
    },
    [apiRequest]
  );

  const updatePreferences = useCallback(
    async (preferences: SocialNotificationPreferences): Promise<SocialNotificationPreferences> => {
      const updated = await apiRequest<SocialNotificationPreferences>('/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preferences),
      });
      setState((current) => ({
        ...current,
        summary: current.summary
          ? {
              ...current.summary,
              preferences: updated,
            }
          : current.summary,
      }));
      return updated;
    },
    [apiRequest]
  );

  const acceptStandards = useCallback(async (): Promise<void> => {
    await apiRequest<{ acceptedAt: string }>('/standards', { method: 'POST' });
    setState((current) => ({
      ...current,
      summary: current.summary
        ? {
            ...current.summary,
            standardsAccepted: true,
            canPublish: !current.summary.mutedUntil,
          }
        : current.summary,
      submitError: null,
    }));
  }, [apiRequest]);

  const reportContent = useCallback(
    async (
      contentType: 'message' | 'post' | 'reply',
      contentId: string,
      reason: SocialReportReason,
      details?: string
    ): Promise<void> => {
      await apiRequest('/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType, contentId, reason, details }),
      });
    },
    [apiRequest]
  );

  const moderateContent = useCallback(
    async (
      contentType: 'message' | 'post' | 'reply',
      contentId: string,
      reason: string
    ): Promise<void> => {
      const updated = await apiRequest<SocialMessage | SocialPost | SocialReply>('/moderation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', contentType, contentId, reason }),
      });
      setState((current) => {
        if (contentType === 'message') {
          return {
            ...current,
            messages: sortMessages(upsertById(current.messages, updated as SocialMessage)),
          };
        }
        if (contentType === 'post') {
          return {
            ...current,
            posts: sortPosts(upsertById(current.posts, updated as SocialPost)),
          };
        }
        const reply = updated as SocialReply;
        const thread = current.threads[reply.postId];
        return {
          ...current,
          threads: thread
            ? {
                ...current.threads,
                [reply.postId]: {
                  ...thread,
                  items: upsertReplies(thread.items, [reply]),
                },
              }
            : current.threads,
        };
      });
    },
    [apiRequest]
  );

  const loadReplies = useCallback(
    async (postId: string, loadMore = false): Promise<void> => {
      const thread = state.threads[postId];
      if (thread?.loading || (loadMore && !thread?.nextCursor)) return;
      setState((current) => ({
        ...current,
        threads: {
          ...current.threads,
          [postId]: {
            items: current.threads[postId]?.items ?? [],
            nextCursor: current.threads[postId]?.nextCursor ?? null,
            loading: true,
            error: null,
          },
        },
      }));
      try {
        const cursor =
          loadMore && thread?.nextCursor ? `&cursor=${encodeURIComponent(thread.nextCursor)}` : '';
        const response = await apiRequest<SocialCursorPage<SocialReply> | SocialPostThread>(
          `/posts/${encodeURIComponent(postId)}/replies?limit=50${cursor}`
        );
        const page = 'post' in response ? response.replies : response;
        setState((current) => {
          const existing = loadMore ? (current.threads[postId]?.items ?? []) : [];
          return {
            ...current,
            posts:
              'post' in response
                ? sortPosts(upsertById(current.posts, response.post))
                : current.posts,
            threads: {
              ...current.threads,
              [postId]: {
                items: upsertReplies(existing, page.items),
                nextCursor: page.nextCursor,
                loading: false,
                error: null,
              },
            },
          };
        });
      } catch (error) {
        setState((current) => ({
          ...current,
          threads: {
            ...current.threads,
            [postId]: {
              items: current.threads[postId]?.items ?? [],
              nextCursor: current.threads[postId]?.nextCursor ?? null,
              loading: false,
              error: error instanceof Error ? error.message : 'Failed to load replies.',
            },
          },
        }));
      }
    },
    [apiRequest, state.threads]
  );

  const createReply = useCallback(
    async (postId: string, body: string, idempotencyKey: string): Promise<void> => {
      setState((current) => ({ ...current, submitError: null }));
      try {
        const input: CreateSocialReplyInput = {
          body,
          idempotencyKey,
        };
        const reply = await apiRequest<SocialReply>(
          `/posts/${encodeURIComponent(postId)}/replies`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
          }
        );
        setState((current) => {
          const thread = current.threads[postId] ?? {
            items: [],
            nextCursor: null,
            loading: false,
            error: null,
          };
          return {
            ...current,
            threads: {
              ...current.threads,
              [postId]: { ...thread, items: upsertReplies(thread.items, [reply]) },
            },
          };
        });
      } catch (error) {
        setState((current) => ({
          ...current,
          submitError: error instanceof Error ? error.message : 'Failed to send reply.',
        }));
        throw error;
      }
    },
    [apiRequest]
  );

  const markRead = useCallback(
    async (channel: SocialChannel): Promise<void> => {
      const summary = state.summary;
      if (!summary || summary.unread[channel] === 0) return;

      const sequence = summary.latestSequence[channel];
      if ((inFlightReadSequences.current[channel] ?? -1) >= sequence) return;
      inFlightReadSequences.current[channel] = sequence;

      setState((current) => {
        if (!current.summary || current.summary.latestSequence[channel] > sequence) return current;
        return {
          ...current,
          summary: {
            ...current.summary,
            unread: { ...current.summary.unread, [channel]: 0 },
          },
        };
      });

      try {
        const readState = await apiRequest<{ channel: SocialChannel; sequence: number }>(
          '/read-state',
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel, sequence }),
          }
        );
        setState((current) => {
          if (
            !current.summary ||
            readState.sequence < current.summary.latestSequence[readState.channel]
          ) {
            return current;
          }
          return {
            ...current,
            summary: {
              ...current.summary,
              unread: { ...current.summary.unread, [readState.channel]: 0 },
            },
          };
        });
      } catch {
        void loadSummary();
      } finally {
        if (inFlightReadSequences.current[channel] === sequence) {
          delete inFlightReadSequences.current[channel];
        }
      }
    },
    [apiRequest, loadSummary, state.summary]
  );

  return {
    ...state,
    clearSubmitError,
    retry: loadInitial,
    loadEarlierMessages,
    loadEarlierActivity,
    loadMorePosts,
    sendMessage,
    createPost,
    updatePost,
    deletePost,
    updatePreferences,
    acceptStandards,
    reportContent,
    moderateContent,
    loadReplies,
    createReply,
    markRead,
    postSort,
    setPostSort,
  };
}

function upsertReplies(existing: SocialReply[], incoming: SocialReply[]): SocialReply[] {
  const byId = new Map(existing.map((reply) => [reply.id, reply]));
  incoming.forEach((reply) => byId.set(reply.id, reply));
  return [...byId.values()].sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  );
}
