'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { AnimatePresence, motion } from 'framer-motion';

import { useAuth } from '@/AuthContext';
import PlayerSearch from '@/components/PlayerSearch';
import { AlertContainer, useAlert } from '@/components/ui/Alert';
import StatlyIcon from '@/components/ui/StatlyIcon';
import { logger } from '@/lib/logger';

import LeagueSwitcher from './LeagueSwitcher';

interface NavigationItem {
  name: string;
  href: string;
  description: string;
  icon: ReactNode;
  submenu?: Array<{
    name: string;
    href: string;
    description: string;
    icon: ReactNode;
  }>;
}

export const publicNavigationItems: NavigationItem[] = [
  {
    name: 'Home',
    href: '/',
    description: 'Product overview and primary entry points',
    icon: <StatlyIcon name="home" />,
  },
  {
    name: 'Fantasy',
    href: '/dashboard',
    description: 'Open your fantasy workspace and leagues',
    icon: <StatlyIcon name="bolt" />,
  },
  {
    name: 'Players',
    href: '/players',
    description: 'Browse player data and rankings',
    icon: <StatlyIcon name="players" />,
  },
  {
    name: 'Help',
    href: '/help',
    description: 'Documentation and support',
    icon: <StatlyIcon name="help" />,
  },
];

const primaryNavigationItems: NavigationItem[] = [
  {
    name: 'Dashboard',
    href: '/dashboard',
    description: 'Your product home and recent activity',
    icon: <StatlyIcon name="activity" />,
  },
  {
    name: 'Players',
    href: '/players',
    description: 'Player pool, rankings, and ownership',
    icon: <StatlyIcon name="players" />,
  },
  {
    name: 'Draft Hub',
    href: '/drafts',
    description: 'Draft rooms, history, and settings',
    icon: <StatlyIcon name="draft" />,
  },
  {
    name: 'Basketball',
    href: '/basketball',
    description: 'Fantasy basketball league tools',
    icon: <StatlyIcon name="basketball" />,
  },
];

const toolsNavigationItem: NavigationItem = {
  name: 'Tools',
  href: '/live-scoring',
  description: 'Secondary analysis and league utilities',
  icon: <StatlyIcon name="tools" />,
  submenu: [
    {
      name: 'Live Scoring',
      href: '/live-scoring',
      description: 'Focused live matchup scoring',
      icon: <StatlyIcon name="stopwatch" />,
    },
    {
      name: 'AFL Matches',
      href: '/matches',
      description: 'Live matches, top performers, and watched players',
      icon: <StatlyIcon name="footy" />,
    },
    {
      name: 'Waivers & Trades',
      href: '/waivers',
      description: 'Claims, offers, counters, and review workflow',
      icon: <StatlyIcon name="trade" />,
    },
    {
      name: 'Rankings',
      href: '/rankings',
      description: 'Standings, ladders, and projections',
      icon: <StatlyIcon name="ladder" />,
    },
    {
      name: 'Team Analytics',
      href: '/team-analytics',
      description: 'Your roster and team performance',
      icon: <StatlyIcon name="team" />,
    },
    {
      name: 'Commissioner',
      href: '/commissioner',
      description: 'League manager and admin tools',
      icon: <StatlyIcon name="commissioner" />,
    },
    {
      name: 'Help',
      href: '/help',
      description: 'Documentation and support',
      icon: <StatlyIcon name="help" />,
    },
  ],
};

function isNavActive(pathname: string | null | undefined, href: string): boolean {
  const p = pathname ?? '';
  if (p === href) return true;
  if (href === '/dashboard') return p === '/' || p === '/dashboard';
  if (href === '/leagues') return p.startsWith('/leagues');
  if (href === '/players') return p.startsWith('/players');
  if (href === '/drafts') return p.startsWith('/drafts');
  if (href === '/basketball') return p === '/basketball' || p.startsWith('/basketball/');
  if (href === '/matches') return p.startsWith('/matches');
  if (href === '/live-scoring') return p.startsWith('/live-scoring');
  if (href === '/waivers') return p.startsWith('/waivers');
  if (href === '/rankings') return p.startsWith('/rankings');
  if (href === '/team-analytics')
    return p.startsWith('/team-analytics') || p.startsWith('/rosters');
  if (href === '/commissioner') return p.startsWith('/commissioner');
  if (href === '/help') return p.startsWith('/help');
  return false;
}

function isDraftHubPath(pathname: string | null | undefined): boolean {
  const p = pathname ?? '';
  return p === '/draft' || p.startsWith('/draft/');
}

function shouldShowLeagueSwitcher(pathname: string | null | undefined): boolean {
  const p = pathname ?? '';
  return (
    p === '/dashboard' ||
    p === '/' ||
    p.startsWith('/leagues') ||
    p.startsWith('/drafts') ||
    p.startsWith('/players') ||
    p.startsWith('/matches') ||
    p.startsWith('/live-scoring') ||
    p.startsWith('/waivers') ||
    p.startsWith('/team-analytics') ||
    p.startsWith('/rankings') ||
    p.startsWith('/rosters')
  );
}

function NavDropdown({
  item,
  pathname,
}: {
  item: NavigationItem;
  pathname: string | null | undefined;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const isActive =
    isNavActive(pathname, item.href) ||
    (item.submenu?.some((subItem) => isNavActive(pathname, subItem.href)) ?? false);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [isOpen]);

  return (
    <div ref={dropdownRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-controls={menuId}
        className={`inline-flex min-h-10 items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white ${
          isActive
            ? 'bg-white text-brand-bar'
            : 'text-brand-bar-foreground/80 hover:bg-white/10 hover:text-brand-bar-foreground'
        }`}
      >
        <span className="hidden text-current sm:block">{item.icon}</span>
        <span>{item.name}</span>
        <svg
          className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <AnimatePresence>
        {isOpen ? (
          <motion.div
            id={menuId}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-surface)] shadow-md"
          >
            <div className="border-b border-[color:var(--league-border)] bg-[color:var(--league-page)] px-4 py-3">
              <p className="text-xs font-semibold text-[color:var(--league-text-muted)]">
                {item.name}
              </p>
              <p className="mt-1 text-sm text-[color:var(--league-text-muted)]">
                {item.description}
              </p>
            </div>
            <div className="p-2">
              {item.submenu?.map((subItem) => {
                const isSubActive = isNavActive(pathname, subItem.href);
                return (
                  <Link
                    key={subItem.name}
                    href={subItem.href}
                    onClick={() => setIsOpen(false)}
                    aria-current={isSubActive ? 'page' : undefined}
                    className={`flex items-start gap-3 rounded-md px-3 py-3 transition ${
                      isSubActive
                        ? 'bg-[color:var(--league-primary-soft)] text-[color:var(--league-primary)]'
                        : 'text-[color:var(--league-text-muted)] hover:bg-[color:var(--league-surface-muted)] hover:text-[color:var(--league-text)]'
                    }`}
                  >
                    <span className="mt-0.5">{subItem.icon}</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{subItem.name}</span>
                      <span className="mt-1 block text-xs leading-5 opacity-80">
                        {subItem.description}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default function MainNavigation({
  showBasketball = false,
}: {
  /** Fantasy basketball is private to an allow-list; others never see its link. */
  readonly showBasketball?: boolean;
} = {}): ReactNode {
  const pathname = usePathname();
  const { user, logout, loading } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const accountButtonRef = useRef<HTMLButtonElement | null>(null);
  const { alerts, removeAlert, error: showError } = useAlert();

  useEffect(() => {
    const onScroll = () => {
      const isScrolled = window.scrollY > 6;
      setScrolled((prev) => (prev !== isScrolled ? isScrolled : prev));
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!isAccountMenuOpen) return;
      const target = event.target as Node | null;
      if (
        accountMenuRef.current &&
        !accountMenuRef.current.contains(target) &&
        accountButtonRef.current &&
        !accountButtonRef.current.contains(target)
      ) {
        setIsAccountMenuOpen(false);
      }
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsAccountMenuOpen(false);
        accountButtonRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [isAccountMenuOpen]);

  useEffect(() => {
    setIsMobileOpen(false);
    setIsAccountMenuOpen(false);
  }, [pathname]);

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);
      await logout();
      // A full load leaves the protected page and drops its client and router-cached data.
      window.location.assign('/login');
    } catch (error) {
      logger.error('Logout failed', error);
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'An unexpected error occurred';
      showError('Sign out failed', message, { autoHideDuration: 7000 });
    } finally {
      setIsLoggingOut(false);
    }
  };

  const brandHref = user ? '/dashboard' : '/';
  const accountLabel = user?.displayName || user?.email || 'Account';
  const accountInitial = accountLabel.charAt(0).toUpperCase() || 'S';
  const showLeagueSwitcher = Boolean(user) && shouldShowLeagueSwitcher(pathname);
  const signedInNavigationItems = showBasketball
    ? primaryNavigationItems
    : primaryNavigationItems.filter((item) => item.href !== '/basketball');
  const desktopNavigationItems = user ? signedInNavigationItems : publicNavigationItems;
  if (isDraftHubPath(pathname)) {
    return null;
  }

  return (
    <>
      <AlertContainer alerts={alerts} onRemove={removeAlert} />

      <header
        className={`sticky top-0 z-50 border-b border-brand-bar bg-brand-bar text-brand-bar-foreground ${
          scrolled ? 'shadow-md' : ''
        }`}
        role="banner"
      >
        <div
          className={`mx-auto grid h-16 w-full max-w-[var(--app-shell-max-width)] grid-cols-[minmax(0,max-content)_minmax(0,1fr)_minmax(0,max-content)] items-center gap-3 px-4 sm:px-6 lg:px-8 ${
            user
              ? 'lg:grid-cols-[minmax(0,max-content)_minmax(0,1fr)_minmax(0,max-content)_max-content] 2xl:grid-cols-[minmax(0,max-content)_minmax(0,1fr)_minmax(0,max-content)]'
              : ''
          }`}
        >
          <div className="min-w-0">
            <Link href={brandHref} className="flex min-w-0 items-center">
              <Image
                src="/brand/statly-hero-logo-overlay.png"
                alt="Statly"
                width={122}
                height={36}
                loading="eager"
                className="h-auto w-24 sm:w-28"
              />
            </Link>
          </div>

          <nav aria-label="Main" className="hidden min-w-0 items-center justify-center lg:flex">
            <div className="inline-flex min-w-0 max-w-full items-center gap-1 overflow-x-auto [scrollbar-width:none]">
              {desktopNavigationItems.map((item) => {
                const isActive = isNavActive(pathname, item.href);
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                      isActive
                        ? 'bg-white text-brand-bar'
                        : 'text-brand-bar-foreground/80 hover:bg-white/10 hover:text-brand-bar-foreground'
                    }`}
                  >
                    <span className="hidden sm:block">{item.icon}</span>
                    <span>{item.name}</span>
                  </Link>
                );
              })}
              {user ? <NavDropdown item={toolsNavigationItem} pathname={pathname} /> : null}
            </div>
          </nav>

          <div className="hidden min-w-0 items-center justify-self-end gap-2 lg:flex">
            {user ? (
              <div className="hidden 2xl:block">
                <PlayerSearch
                  placeholder="Search players"
                  size="sm"
                  variant="default"
                  className="w-56"
                />
              </div>
            ) : null}

            {showLeagueSwitcher ? (
              <div className="hidden 2xl:block">
                <LeagueSwitcher />
              </div>
            ) : null}

            {user ? (
              <div className="relative" ref={accountMenuRef}>
                <button
                  type="button"
                  ref={accountButtonRef}
                  onClick={() => setIsAccountMenuOpen((open) => !open)}
                  className="inline-flex items-center gap-3 rounded-md border border-white/30 px-2.5 py-1.5 text-sm font-semibold text-brand-bar-foreground transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  aria-expanded={isAccountMenuOpen}
                  aria-controls="account-menu"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-xs font-bold text-brand-bar">
                    {accountInitial}
                  </span>
                  <span className="hidden max-w-[160px] truncate 2xl:block">{accountLabel}</span>
                  <svg
                    className="h-4 w-4 text-brand-bar-foreground/70"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>

                {isAccountMenuOpen ? (
                  <div
                    id="account-menu"
                    className="absolute right-0 mt-2 w-56 overflow-hidden rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-surface)] shadow-md"
                  >
                    <div className="border-b border-[color:var(--league-border)] bg-[color:var(--league-page)] px-4 py-3 text-sm">
                      <p className="font-semibold text-[color:var(--league-text)]">Signed in</p>
                      <p className="truncate text-[color:var(--league-text-muted)]">
                        {accountLabel}
                      </p>
                    </div>
                    <div className="p-2">
                      <Link
                        href="/dashboard"
                        className="flex rounded-md px-3 py-2 text-sm text-[color:var(--league-text-muted)] transition hover:bg-[color:var(--league-surface-muted)] hover:text-[color:var(--league-text)]"
                        onClick={() => setIsAccountMenuOpen(false)}
                      >
                        Dashboard
                      </Link>
                      <Link
                        href="/help"
                        className="flex rounded-md px-3 py-2 text-sm text-[color:var(--league-text-muted)] transition hover:bg-[color:var(--league-surface-muted)] hover:text-[color:var(--league-text)]"
                        onClick={() => setIsAccountMenuOpen(false)}
                      >
                        Help
                      </Link>
                      <button
                        type="button"
                        className="flex w-full rounded-md px-3 py-2 text-left text-sm text-[color:var(--league-text-muted)] transition hover:bg-[color:var(--league-surface-muted)] hover:text-[color:var(--league-text)]"
                        onClick={() => {
                          setIsAccountMenuOpen(false);
                          void handleLogout();
                        }}
                        disabled={isLoggingOut || loading}
                        aria-busy={isLoggingOut || loading}
                      >
                        {isLoggingOut ? 'Signing out…' : 'Sign out'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <Link
                href="/login"
                className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-brand-bar transition hover:bg-white/90"
              >
                Sign in
              </Link>
            )}
          </div>

          <button
            type="button"
            onClick={() => setIsMobileOpen((open) => !open)}
            // Player search and the league switcher join the bar only at 2xl, so signed-in
            // managers keep this toggle (and its quick actions) until then.
            className={`ml-auto inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-white/30 p-2 text-brand-bar-foreground transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white ${
              user ? '2xl:hidden' : 'lg:hidden'
            }`}
            aria-expanded={isMobileOpen}
            aria-controls="mobile-main-navigation"
            aria-label={isMobileOpen ? 'Close navigation' : 'Open navigation'}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {isMobileOpen ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              )}
            </svg>
          </button>
        </div>

        <AnimatePresence>
          {isMobileOpen ? (
            <motion.nav
              id="mobile-main-navigation"
              aria-label="Main"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className={`border-t border-[color:var(--league-border)] bg-[color:var(--league-surface)] ${
                user ? '2xl:hidden' : 'lg:hidden'
              }`}
            >
              <div className="space-y-4 px-4 py-4">
                {user ? (
                  <>
                    <div className="rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-page)] p-4">
                      <p className="text-xs font-semibold text-[color:var(--league-text-muted)]">
                        Quick actions
                      </p>
                      <div className="mt-3 space-y-3">
                        <PlayerSearch placeholder="Search players" size="md" variant="default" />
                        {showLeagueSwitcher ? <LeagueSwitcher /> : null}
                      </div>
                    </div>

                    <div className="rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-2 lg:hidden">
                      <p className="px-3 pt-2 text-xs font-semibold text-[color:var(--league-text-muted)]">
                        Navigate
                      </p>
                      <div className="mt-2 space-y-1">
                        {signedInNavigationItems.map((item) => {
                          const isActive = isNavActive(pathname, item.href);
                          return (
                            <Link
                              key={item.name}
                              href={item.href}
                              onClick={() => setIsMobileOpen(false)}
                              aria-current={isActive ? 'page' : undefined}
                              className={`flex items-start gap-3 rounded-md px-3 py-3 transition ${
                                isActive
                                  ? 'bg-[color:var(--league-primary-soft)] text-[color:var(--league-primary)]'
                                  : 'text-[color:var(--league-text-muted)] hover:bg-[color:var(--league-surface-muted)] hover:text-[color:var(--league-text)]'
                              }`}
                            >
                              <span className="mt-0.5">{item.icon}</span>
                              <span className="min-w-0">
                                <span className="block text-sm font-medium">{item.name}</span>
                                <span className="mt-1 block text-xs leading-5 opacity-80">
                                  {item.description}
                                </span>
                              </span>
                            </Link>
                          );
                        })}
                      </div>
                    </div>

                    <div className="rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-2 lg:hidden">
                      <p className="px-3 pt-2 text-xs font-semibold text-[color:var(--league-text-muted)]">
                        Tools
                      </p>
                      <div className="mt-2 space-y-1">
                        {toolsNavigationItem.submenu?.map((item) => {
                          const isActive = isNavActive(pathname, item.href);
                          return (
                            <Link
                              key={item.name}
                              href={item.href}
                              onClick={() => setIsMobileOpen(false)}
                              aria-current={isActive ? 'page' : undefined}
                              className={`flex items-start gap-3 rounded-md px-3 py-3 transition ${
                                isActive
                                  ? 'bg-[color:var(--league-accent-soft)] text-[color:var(--league-accent)]'
                                  : 'text-[color:var(--league-text-muted)] hover:bg-[color:var(--league-surface-muted)] hover:text-[color:var(--league-text)]'
                              }`}
                            >
                              <span className="mt-0.5">{item.icon}</span>
                              <span className="min-w-0">
                                <span className="block text-sm font-medium">{item.name}</span>
                                <span className="mt-1 block text-xs leading-5 opacity-80">
                                  {item.description}
                                </span>
                              </span>
                            </Link>
                          );
                        })}
                      </div>
                    </div>

                    <div className="rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-page)] p-4 lg:hidden">
                      <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--league-primary)] text-sm font-semibold text-white">
                          {accountInitial}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[color:var(--league-text)]">
                            {accountLabel}
                          </p>
                          <p className="text-xs text-[color:var(--league-text-muted)]">Signed in</p>
                        </div>
                      </div>
                      <div className="mt-4 grid gap-2">
                        <Link
                          href="/dashboard"
                          onClick={() => setIsMobileOpen(false)}
                          className="rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-4 py-3 text-sm font-medium text-[color:var(--league-text-muted)] transition hover:bg-[color:var(--league-surface-muted)] hover:text-[color:var(--league-text)]"
                        >
                          Dashboard
                        </Link>
                        <button
                          type="button"
                          onClick={() => {
                            setIsMobileOpen(false);
                            void handleLogout();
                          }}
                          disabled={isLoggingOut || loading}
                          className="rounded-md bg-[color:var(--league-primary)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[color:var(--league-primary-hover)] disabled:opacity-50"
                        >
                          {isLoggingOut ? 'Signing out…' : 'Sign out'}
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-2">
                    {publicNavigationItems.map((item) => {
                      const isActive = isNavActive(pathname, item.href);
                      return (
                        <Link
                          key={item.name}
                          href={item.href}
                          onClick={() => setIsMobileOpen(false)}
                          aria-current={isActive ? 'page' : undefined}
                          className={`flex items-start gap-3 rounded-md px-3 py-3 transition ${
                            isActive
                              ? 'bg-[color:var(--league-primary-soft)] text-[color:var(--league-primary)]'
                              : 'text-[color:var(--league-text-muted)] hover:bg-[color:var(--league-surface-muted)] hover:text-[color:var(--league-text)]'
                          }`}
                        >
                          <span className="mt-0.5">{item.icon}</span>
                          <span className="min-w-0">
                            <span className="block text-sm font-medium">{item.name}</span>
                            <span className="mt-1 block text-xs leading-5 opacity-80">
                              {item.description}
                            </span>
                          </span>
                        </Link>
                      );
                    })}
                    <div className="px-3 pb-3 pt-2">
                      <Link
                        href="/dashboard"
                        onClick={() => setIsMobileOpen(false)}
                        className="mb-2 block rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-4 py-3 text-center text-sm font-semibold text-[color:var(--league-text)] transition hover:bg-[color:var(--league-surface-muted)]"
                      >
                        Open Fantasy
                      </Link>
                      <Link
                        href="/login"
                        onClick={() => setIsMobileOpen(false)}
                        className="block rounded-md bg-[color:var(--league-primary)] px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-[color:var(--league-primary-hover)]"
                      >
                        Sign in
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            </motion.nav>
          ) : null}
        </AnimatePresence>
      </header>
    </>
  );
}
