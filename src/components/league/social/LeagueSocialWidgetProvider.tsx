'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';

import { LAST_LEAGUE_ID_COOKIE, readCookieValue } from '@/lib/uiPreferences';
import type { SocialDiscussionContext } from '@/types/social';

import type { LeagueSocialView } from './LeagueSocialShell';

export interface OpenLeagueSocialWidgetOptions {
  leagueId?: string;
  view?: LeagueSocialView;
  context?: SocialDiscussionContext;
}

export type LeagueSocialWidgetMode = 'closed' | 'open' | 'minimized';

interface LeagueContext {
  leagueId: string;
  name?: string;
}

interface LeagueBoundComposerContext {
  leagueId: string;
  context: SocialDiscussionContext;
}

export interface LeagueSocialWidgetController {
  leagueId: string | null;
  leagueName?: string;
  mode: LeagueSocialWidgetMode;
  hasOpened: boolean;
  view: LeagueSocialView;
  composerContext: SocialDiscussionContext | null;
  open: (options?: OpenLeagueSocialWidgetOptions) => void;
  close: () => void;
  minimize: () => void;
  setLeagueContext: (leagueId: string | null, name?: string) => void;
  clearComposerContext: () => void;
}

const LeagueSocialWidgetContext = createContext<LeagueSocialWidgetController | null>(null);
LeagueSocialWidgetContext.displayName = 'LeagueSocialWidgetContext';

const RESERVED_LEAGUE_ROUTES = new Set(['join', 'new']);

export function getLeagueIdFromPathname(pathname: string | null | undefined): string | null {
  const match = (pathname ?? '').match(/^\/leagues\/([^/]+)(?:\/|$)/);
  if (!match || RESERVED_LEAGUE_ROUTES.has(match[1])) return null;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function resolveLeagueSocialLeagueId({
  pathname,
  registeredLeagueId,
  requestedLeagueId,
  cookieLeagueId,
}: {
  pathname: string | null | undefined;
  registeredLeagueId: string | null;
  requestedLeagueId: string | null;
  cookieLeagueId: string | null;
}): string | null {
  return (
    getLeagueIdFromPathname(pathname) ?? registeredLeagueId ?? requestedLeagueId ?? cookieLeagueId
  );
}

export function LeagueSocialWidgetProvider({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  const pathname = usePathname();
  const [registeredLeague, setRegisteredLeague] = useState<LeagueContext | null>(null);
  const [requestedLeagueId, setRequestedLeagueId] = useState<string | null>(null);
  const [cookieLeagueId, setCookieLeagueId] = useState<string | null>(null);
  const [mode, setMode] = useState<LeagueSocialWidgetMode>('closed');
  const [hasOpened, setHasOpened] = useState(false);
  const [view, setView] = useState<LeagueSocialView>('chat');
  const [boundComposerContext, setBoundComposerContext] =
    useState<LeagueBoundComposerContext | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    setCookieLeagueId(readCookieValue(document.cookie, LAST_LEAGUE_ID_COOKIE) ?? null);
  }, [pathname]);

  const leagueId = resolveLeagueSocialLeagueId({
    pathname,
    registeredLeagueId: registeredLeague?.leagueId ?? null,
    requestedLeagueId,
    cookieLeagueId,
  });
  const leagueName = registeredLeague?.leagueId === leagueId ? registeredLeague.name : undefined;
  const composerContext =
    boundComposerContext?.leagueId === leagueId ? boundComposerContext.context : null;

  const open = useCallback(
    (options: OpenLeagueSocialWidgetOptions = {}) => {
      if (options.leagueId) setRequestedLeagueId(options.leagueId);
      if (options.context) {
        const contextLeagueId = options.leagueId ?? leagueId;
        setBoundComposerContext(
          contextLeagueId ? { leagueId: contextLeagueId, context: options.context } : null
        );
        setView('chat');
      } else if (options.view) {
        setView(options.view);
      }
      setHasOpened(true);
      setMode('open');
    },
    [leagueId]
  );

  const close = useCallback(() => setMode('closed'), []);
  const minimize = useCallback(() => setMode('minimized'), []);
  const clearComposerContext = useCallback(() => setBoundComposerContext(null), []);
  const setLeagueContext = useCallback((nextLeagueId: string | null, name?: string) => {
    setRegisteredLeague(nextLeagueId ? { leagueId: nextLeagueId, name } : null);
  }, []);

  useEffect(() => {
    if (!leagueId && mode !== 'closed') setMode('closed');
  }, [leagueId, mode]);

  useEffect(() => {
    setBoundComposerContext((current) => (current?.leagueId === leagueId ? current : null));
  }, [leagueId]);

  const value = useMemo<LeagueSocialWidgetController>(
    () => ({
      leagueId,
      leagueName,
      mode,
      hasOpened,
      view,
      composerContext,
      open,
      close,
      minimize,
      setLeagueContext,
      clearComposerContext,
    }),
    [
      clearComposerContext,
      close,
      composerContext,
      hasOpened,
      leagueId,
      leagueName,
      minimize,
      mode,
      open,
      setLeagueContext,
      view,
    ]
  );

  return (
    <LeagueSocialWidgetContext.Provider value={value}>
      {children}
    </LeagueSocialWidgetContext.Provider>
  );
}

export function useLeagueSocialWidget(): LeagueSocialWidgetController {
  const context = useContext(LeagueSocialWidgetContext);
  if (!context) {
    throw new Error('useLeagueSocialWidget must be used within a LeagueSocialWidgetProvider');
  }
  return context;
}
