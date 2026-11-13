'use client';

import { MessageCircle, Minus, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { usePathname, useSearchParams } from 'next/navigation';

import { useSocket } from '@/contexts/SocketContext';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import type { LeagueSocialSummary, SocialMessage, SocialRealtimeEnvelope } from '@/types/social';

import { subscribeLeagueSocialRoom } from './leagueSocialRoom';
import { activityDiscussionContext, useLeagueSocialWidget } from './LeagueSocialWidgetProvider';

type ConnectionNotice = 'hidden' | 'offline' | 'reconnecting';
type UnreadCounts = { chat: number; board: number; activity: number };

const leagueNameCache = new Map<string, string>();
const EMPTY_UNREAD: UnreadCounts = { chat: 0, board: 0, activity: 0 };
/** Badge refresh cadence while no live room is delivering events. */
export const UNREAD_POLL_INTERVAL_MS = 30_000;

function LeagueSocialShellLoading(): React.JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-full min-h-0 flex-1 items-center justify-center gap-2 bg-social-canvas px-4 text-sm text-social-text-muted"
    >
      <MessageCircle
        className="size-5 animate-pulse motion-reduce:animate-none"
        aria-hidden="true"
      />
      <span>Loading league chat…</span>
    </div>
  );
}

const LeagueSocialShell = dynamic(() => import('./LeagueSocialShell'), {
  ssr: false,
  loading: LeagueSocialShellLoading,
});

export function getDraftIdFromPathname(pathname: string | null): string | null {
  const match = pathname?.match(/^\/drafts\/([^/]+)\/?$/);
  if (!match || ['create', 'history', 'settings'].includes(match[1])) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function isLeagueEvent(value: unknown, leagueId: string): boolean {
  if (!value || typeof value !== 'object' || !('leagueId' in value)) return false;
  return (value as Pick<SocialRealtimeEnvelope, 'leagueId'>).leagueId === leagueId;
}

/** Up to two initials for the league crest in the pop-up header. */
function leagueInitials(name: string | undefined): string {
  return (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('');
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
  const [badgeLive, setBadgeLive] = useState(false);
  const unreadRequestRef = useRef<AbortController | null>(null);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const minimizeButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastPanelFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const unread = unreadState.leagueId === leagueId ? unreadState.counts : EMPTY_UNREAD;
  // Posts and Activity have their own league menu items and badges; the chat button counts chat.
  const totalUnread = unread.chat;
  const displayLeagueName = leagueName ?? resolvedLeagueName;
  const isOpen = mode === 'open';
  const searchParams = useSearchParams();
  const socialPageView = searchParams?.get('view');
  // The full chat page replaces the pop-up; the Posts and Activity pages keep it.
  const isDedicatedSocialPage =
    /^\/leagues\/[^/]+\/social(?:\/|$)/.test(pathname ?? '') &&
    socialPageView !== 'board' &&
    socialPageView !== 'activity';
  const draftId = getDraftIdFromPathname(pathname);
  const discussActivity = useCallback(
    (activity: SocialMessage) => {
      open({ view: 'chat', context: activityDiscussionContext(activity) });
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
    // The badge joins the league room itself (shared with chat and the Trade Centre), so it is
    // live before chat has ever been opened. Each `live` follows a join or a reconnect.
    const leaveRoom = subscribeLeagueSocialRoom(socket, leagueId, (status) => {
      setBadgeLive(status === 'live');
      if (status === 'live') void refreshUnread();
    });
    return () => {
      events.forEach((event) => socket.off(event, refreshForLeague));
      leaveRoom();
      setBadgeLive(false);
    };
  }, [leagueId, refreshUnread, socket]);

  useEffect(() => {
    // Without a live room (no Socket.IO process, or a dropped connection) the badge polls.
    if (!leagueId || badgeLive) return;
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshUnread();
    }, UNREAD_POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [badgeLive, leagueId, refreshUnread]);

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
            totalUnread > 0 ? `Open league chat, ${totalUnread} unread` : 'Open league chat'
          }
          aria-expanded="false"
          title="League chat"
          className="league-social fixed bottom-6 right-6 z-[55] inline-flex size-14 items-center justify-center rounded-full border border-social-brand-strong bg-social-brand-strong text-social-brand-foreground shadow-lg transition-colors hover:bg-social-action-hover active:bg-social-action-pressed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus focus-visible:ring-offset-2 focus-visible:ring-offset-social-surface"
        >
          <MessageCircle className="size-7" aria-hidden="true" />
          {totalUnread > 0 ? (
            <span className="absolute -right-1 -top-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-social-action px-1.5 text-xs font-bold text-social-action-foreground ring-2 ring-social-surface">
              <span className="sr-only">{totalUnread} unread</span>
              <span aria-hidden="true">{formatUnread(totalUnread)}</span>
            </span>
          ) : null}
        </button>
      ) : null}

      {hasOpened ? (
        <aside
          ref={panelRef}
          aria-label="League chat panel"
          aria-hidden={!isOpen}
          inert={!isOpen}
          className={`league-social fixed inset-0 z-[60] flex h-[100dvh] min-h-0 w-full flex-col overflow-hidden border-0 bg-social-canvas text-social-text shadow-2xl transition-[translate,scale,opacity] duration-200 motion-reduce:transition-none sm:inset-auto sm:bottom-6 sm:right-6 sm:origin-bottom-right sm:h-[clamp(36.25rem,76dvh,45rem)] sm:max-h-[calc(100dvh-3rem)] sm:w-[clamp(26.25rem,32vw,30rem)] sm:max-w-[calc(100vw-3rem)] sm:rounded-3xl sm:border sm:border-social-border ${
            isOpen
              ? 'translate-y-0 opacity-100 sm:scale-100'
              : 'pointer-events-none translate-y-full opacity-0 sm:translate-y-4 sm:scale-95'
          }`}
        >
          <div className="flex min-h-[4.5rem] shrink-0 items-center gap-3 bg-social-canvas px-4 pt-[env(safe-area-inset-top)] text-social-text">
            <span
              aria-hidden="true"
              className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-social-brand-strong text-sm font-bold tracking-wide text-social-brand-foreground"
            >
              {leagueInitials(displayLeagueName) || <MessageCircle className="size-5" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xl font-semibold leading-tight text-social-text">
                {displayLeagueName ?? 'Current league'}
              </p>
              <div className="flex min-w-0 items-center gap-1.5 text-sm text-social-text-muted">
                <span className="truncate">League chat</span>
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
                className="inline-flex size-10 items-center justify-center rounded-full text-social-text-muted transition-colors hover:bg-social-bubble hover:text-social-text active:bg-social-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus"
                aria-label="Minimize league chat"
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
            view="chat"
            showHeader={false}
            compact
            visible={isOpen}
            composerLabel={`Message the members of ${displayLeagueName ?? 'this league'}`}
            composerSurface={draftId ? { type: 'draft-chat', draftId } : { type: 'league-chat' }}
            composerContext={composerContext}
            onClearComposerContext={clearComposerContext}
            onDiscussActivity={discussActivity}
            title={displayLeagueName ? `${displayLeagueName} chat` : 'League chat'}
            className="h-full !min-h-0 flex-1 rounded-none border-0 shadow-none"
          />
        </aside>
      ) : null}
    </>
  );
}
