'use client';

import { MessageCircle, Minus, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

import { useSocket } from '@/contexts/SocketContext';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import type { LeagueSocialSummary, SocialMessage, SocialRealtimeEnvelope } from '@/types/social';

import LeagueSocialShell from './LeagueSocialShell';
import { useLeagueSocialWidget } from './LeagueSocialWidgetProvider';

type ConnectionNotice = 'hidden' | 'offline' | 'reconnecting';
type UnreadCounts = { chat: number; board: number; activity: number };

const leagueNameCache = new Map<string, string>();
const EMPTY_UNREAD: UnreadCounts = { chat: 0, board: 0, activity: 0 };

function isLeagueEvent(value: unknown, leagueId: string): boolean {
  if (!value || typeof value !== 'object' || !('leagueId' in value)) return false;
  return (value as Pick<SocialRealtimeEnvelope, 'leagueId'>).leagueId === leagueId;
}

function formatUnread(unread: number): string {
  return unread > 99 ? '99+' : String(unread);
}

export default function LeagueSocialWidget({
  currentUserId,
}: {
  currentUserId: string;
}): React.JSX.Element | null {
  const pathname = usePathname();
  const socket = useSocket();
  const {
    leagueId,
    leagueName,
    mode,
    hasOpened,
    view,
    composerContext,
    open,
    minimize,
    clearComposerContext,
  } = useLeagueSocialWidget();
  const [unreadState, setUnreadState] = useState<{
    leagueId: string | null;
    counts: UnreadCounts;
  }>({ leagueId: null, counts: EMPTY_UNREAD });
  const [resolvedLeagueName, setResolvedLeagueName] = useState<string | undefined>(leagueName);
  const [connectionNotice, setConnectionNotice] = useState<ConnectionNotice>('hidden');
  const unreadRequestRef = useRef<AbortController | null>(null);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const minimizeButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastPanelFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const unread = unreadState.leagueId === leagueId ? unreadState.counts : EMPTY_UNREAD;
  const totalUnread = unread.chat + unread.board + unread.activity;
  const displayLeagueName = leagueName ?? resolvedLeagueName;
  const isOpen = mode === 'open';
  const isDedicatedSocialPage = /^\/leagues\/[^/]+\/social(?:\/|$)/.test(pathname ?? '');
  const discussActivity = useCallback(
    (activity: SocialMessage) => {
      open({
        view: 'chat',
        context: activity.context ?? {
          type: 'activity',
          id: activity.relatedEntityId ?? activity.id,
          title: activity.content,
        },
      });
    },
    [open]
  );
  const handleMinimize = useCallback(() => {
    const activeElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (activeElement && panelRef.current?.contains(activeElement)) {
      lastPanelFocusRef.current = activeElement;
    }
    minimize();
  }, [minimize]);

  const refreshUnread = useCallback(async () => {
    unreadRequestRef.current?.abort();
    if (!leagueId) {
      unreadRequestRef.current = null;
      setUnreadState({ leagueId: null, counts: EMPTY_UNREAD });
      return;
    }

    const requestedLeagueId = leagueId;
    const controller = new AbortController();
    unreadRequestRef.current = controller;
    try {
      const response = await authenticatedFetch(
        `/api/leagues/${encodeURIComponent(requestedLeagueId)}/social/summary`,
        { cache: 'no-store', signal: controller.signal },
        currentUserId
      );
      const payload = (await response.json().catch(() => null)) as {
        success?: boolean;
        data?: LeagueSocialSummary;
      } | null;
      if (controller.signal.aborted || unreadRequestRef.current !== controller) return;
      if (!response.ok || payload?.success !== true || !payload.data) return;
      setUnreadState({
        leagueId: requestedLeagueId,
        counts: {
          chat: payload.data.unread.chat ?? 0,
          board: payload.data.unread.board ?? 0,
          activity: payload.data.unread.activity ?? 0,
        },
      });
    } catch {
      // The social shell owns retry UI. A badge refresh failure should stay unobtrusive.
    } finally {
      if (unreadRequestRef.current === controller) unreadRequestRef.current = null;
    }
  }, [currentUserId, leagueId]);

  useEffect(() => {
    void refreshUnread();
    return () => unreadRequestRef.current?.abort();
  }, [refreshUnread]);

  useEffect(() => {
    if (!leagueId) {
      setResolvedLeagueName(undefined);
      return;
    }
    if (leagueName) {
      leagueNameCache.set(leagueId, leagueName);
      setResolvedLeagueName(leagueName);
      return;
    }

    const cachedName = leagueNameCache.get(leagueId);
    if (cachedName) {
      setResolvedLeagueName(cachedName);
      return;
    }

    let cancelled = false;
    setResolvedLeagueName(undefined);
    void authenticatedFetch(
      `/api/leagues/${encodeURIComponent(leagueId)}`,
      { cache: 'no-store' },
      currentUserId
    )
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json().catch(() => null)) as {
          name?: string;
          league?: { name?: string };
          data?: { name?: string; league?: { name?: string } };
        } | null;
        const name =
          payload?.data?.league?.name ??
          payload?.data?.name ??
          payload?.league?.name ??
          payload?.name;
        if (!cancelled && name) {
          leagueNameCache.set(leagueId, name);
          setResolvedLeagueName(name);
        }
      })
      .catch(() => {
        // Keep the generic accessible label if league metadata is temporarily unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, [currentUserId, leagueId, leagueName]);

  useEffect(() => {
    if (!socket || !leagueId) return;
    const refreshForLeague = (event: unknown) => {
      if (isLeagueEvent(event, leagueId)) void refreshUnread();
    };
    const events = [
      'social:message',
      'social:activity',
      'social:post',
      'social:reply',
      'social:moderation',
      'social:read-state',
    ] as const;
    events.forEach((event) => socket.on(event, refreshForLeague));
    return () => {
      events.forEach((event) => socket.off(event, refreshForLeague));
    };
  }, [leagueId, refreshUnread, socket]);

  useEffect(() => {
    const updateForNetwork = () => {
      setConnectionNotice(navigator.onLine ? 'reconnecting' : 'offline');
    };
    const markOffline = () => setConnectionNotice('offline');
    window.addEventListener('online', updateForNetwork);
    window.addEventListener('offline', markOffline);
    if (!navigator.onLine) markOffline();
    return () => {
      window.removeEventListener('online', updateForNetwork);
      window.removeEventListener('offline', markOffline);
    };
  }, []);

  useEffect(() => {
    if (!socket) return;
    const markConnected = () => setConnectionNotice('hidden');
    const markReconnecting = () =>
      setConnectionNotice(navigator.onLine ? 'reconnecting' : 'offline');
    socket.on('connect', markConnected);
    socket.on('disconnect', markReconnecting);
    socket.on('connect_error', markReconnecting);
    socket.io.on('reconnect_attempt', markReconnecting);
    if (socket.connected) markConnected();
    return () => {
      socket.off('connect', markConnected);
      socket.off('disconnect', markReconnecting);
      socket.off('connect_error', markReconnecting);
      socket.io.off('reconnect_attempt', markReconnecting);
    };
  }, [socket]);

  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    let refreshTimeout: number | undefined;
    if (isOpen && !wasOpen) {
      window.requestAnimationFrame(() => {
        const priorPanelFocus = lastPanelFocusRef.current;
        if (priorPanelFocus?.isConnected && panelRef.current?.contains(priorPanelFocus)) {
          priorPanelFocus.focus();
        } else {
          minimizeButtonRef.current?.focus();
        }
      });
      refreshTimeout = window.setTimeout(() => void refreshUnread(), 400);
    } else if (!isOpen && wasOpen) {
      window.requestAnimationFrame(() => launcherRef.current?.focus());
    }
    wasOpenRef.current = isOpen;
    return () => {
      if (refreshTimeout !== undefined) window.clearTimeout(refreshTimeout);
    };
  }, [isOpen, refreshUnread]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleMinimize();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [handleMinimize, isOpen]);

  if (!leagueId || isDedicatedSocialPage) return null;

  return (
    <>
      {!isOpen ? (
        <button
          ref={launcherRef}
          type="button"
          onClick={() => open()}
          aria-label={
            totalUnread > 0 ? `Open league social, ${totalUnread} unread` : 'Open league social'
          }
          aria-expanded="false"
          title="League Social"
          className="fixed bottom-5 right-5 z-[55] inline-flex size-14 items-center justify-center rounded-2xl border border-border bg-primary text-primary-foreground shadow-lg transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <MessageCircle className="size-5" aria-hidden="true" />
          {totalUnread > 0 ? (
            <span className="absolute -right-1 -top-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-bold text-destructive-foreground ring-2 ring-background">
              <span className="sr-only">{totalUnread} unread</span>
              <span aria-hidden="true">{formatUnread(totalUnread)}</span>
            </span>
          ) : null}
        </button>
      ) : null}

      {hasOpened ? (
        <aside
          ref={panelRef}
          aria-label="League social panel"
          aria-hidden={!isOpen}
          inert={!isOpen}
          className={`fixed inset-x-2 bottom-2 z-[60] flex h-[min(80dvh,42rem)] min-h-0 w-auto flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl transition-[transform,opacity] duration-200 sm:inset-x-auto sm:bottom-5 sm:right-5 sm:h-[min(75dvh,42rem)] sm:w-[25rem] lg:h-[min(42rem,calc(100dvh-6rem))] lg:w-[clamp(24rem,29vw,27rem)] ${
            isOpen
              ? 'translate-y-0 opacity-100 sm:translate-x-0'
              : 'pointer-events-none translate-y-full opacity-0 sm:translate-x-[calc(100%+2rem)] sm:translate-y-0'
          }`}
        >
          <div className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">League Social</p>
              <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <span className="truncate">{displayLeagueName ?? 'Current league'}</span>
                {connectionNotice !== 'hidden' ? (
                  <span
                    role="status"
                    className="inline-flex shrink-0 items-center gap-1 font-medium"
                  >
                    <span aria-hidden="true">·</span>
                    <WifiOff className="size-3.5" aria-hidden="true" />
                    {connectionNotice === 'offline' ? 'Offline' : 'Reconnecting…'}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                ref={minimizeButtonRef}
                type="button"
                onClick={handleMinimize}
                className="inline-flex size-10 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Minimize league social"
                title="Minimize"
              >
                <Minus className="size-5" aria-hidden="true" />
              </button>
            </div>
          </div>

          <LeagueSocialShell
            key={leagueId}
            leagueId={leagueId}
            currentUserId={currentUserId}
            initialView={composerContext ? 'chat' : view}
            showHeader={false}
            compact
            visible={isOpen}
            composerContext={composerContext}
            onClearComposerContext={clearComposerContext}
            onDiscussActivity={discussActivity}
            title={displayLeagueName ? `${displayLeagueName} social` : 'League social'}
            className="h-full !min-h-0 flex-1 rounded-none border-0 shadow-none"
          />
        </aside>
      ) : null}
    </>
  );
}
