'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { AnimatePresence, motion } from 'framer-motion';

import { useAuth } from '@/AuthContext';
import PlayerSearch from '@/components/PlayerSearch';
import { AlertContainer, useAlert } from '@/components/ui';
import { TeamProvider } from '@/contexts/TeamContext';
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

const publicNavigationItems: NavigationItem[] = [
  {
    name: 'Home',
    href: '/',
    description: 'Product overview and primary entry points',
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3"
        />
      </svg>
    ),
  },
  {
    name: 'Fantasy',
    href: '/fantasy',
    description: 'Public overview of the fantasy platform',
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 10V3L4 14h7v7l9-11h-7z"
        />
      </svg>
    ),
  },
  {
    name: 'Players',
    href: '/players',
    description: 'Browse player data and rankings',
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
        />
      </svg>
    ),
  },
  {
    name: 'Help',
    href: '/help',
    description: 'Documentation and support',
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  },
];

const primaryNavigationItems: NavigationItem[] = [
  {
    name: 'Dashboard',
    href: '/dashboard',
    description: 'Your product home and recent activity',
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
        />
      </svg>
    ),
  },
  {
    name: 'Leagues',
    href: '/leagues',
    description: 'League workspaces and history',
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
        />
      </svg>
    ),
  },
  {
    name: 'Players',
    href: '/players',
    description: 'Player pool, rankings, and ownership',
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
        />
      </svg>
    ),
  },
  {
    name: 'Draft Hub',
    href: '/drafts',
    description: 'Draft rooms, history, and settings',
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
        />
      </svg>
    ),
  },
];

const toolsNavigationItem: NavigationItem = {
  name: 'Tools',
  href: '/live-scoring',
  description: 'Secondary analysis and league utilities',
  icon: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 6h16M4 12h16M4 18h16"
      />
    </svg>
  ),
  submenu: [
    {
      name: 'Match Centre',
      href: '/live-scoring',
      description: 'Live scoring and matchup monitoring',
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"
          />
        </svg>
      ),
    },
    {
      name: 'Trade Centre',
      href: '/tradecentre',
      description: 'Offers, counters, and review workflow',
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
          />
        </svg>
      ),
    },
    {
      name: 'Waivers',
      href: '/waivers',
      description: 'Claims, order, and processing',
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8c-3.314 0-6 1.79-6 4s2.686 4 6 4 6-1.79 6-4-2.686-4-6-4zm0 0V4m0 12v4"
          />
        </svg>
      ),
    },
    {
      name: 'Rankings',
      href: '/rankings',
      description: 'Standings, ladders, and projections',
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
          />
        </svg>
      ),
    },
    {
      name: 'Team Analytics',
      href: '/team-analytics',
      description: 'Your roster and team performance',
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      ),
    },
    {
      name: 'Commissioner',
      href: '/commissioner',
      description: 'League manager and admin tools',
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      ),
    },
    {
      name: 'Help',
      href: '/help',
      description: 'Documentation and support',
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      ),
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
  if (href === '/live-scoring') return p.startsWith('/live-scoring') || p.startsWith('/matches');
  if (href === '/tradecentre') return p.startsWith('/tradecentre');
  if (href === '/waivers') return p.startsWith('/waivers');
  if (href === '/rankings') return p.startsWith('/rankings') || p.startsWith('/leaderboard');
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
    p.startsWith('/players') ||
    p.startsWith('/live-scoring') ||
    p.startsWith('/waivers') ||
    p.startsWith('/tradecentre') ||
    p.startsWith('/team-analytics') ||
    p.startsWith('/rankings') ||
    p.startsWith('/leaderboard') ||
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
  const isActive =
    isNavActive(pathname, item.href) ||
    (item.submenu?.some((subItem) => isNavActive(pathname, subItem.href)) ?? false);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] ${
          isActive
            ? 'bg-[color:var(--league-primary)] text-white'
            : 'text-[color:var(--league-text-muted)] hover:bg-[color:var(--league-surface-muted)] hover:text-[color:var(--league-text)]'
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
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-[24px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] shadow-[0_24px_60px_-35px_rgba(23,34,48,0.22)]"
          >
            <div className="border-b border-[color:var(--league-border)] bg-[color:var(--league-page)] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--league-text-muted)]">
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
                    className={`flex items-start gap-3 rounded-2xl px-3 py-3 transition ${
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

export default function MainNavigation(): ReactNode {
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
    } catch (error) {
      logger.error('Logout failed', error);
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'An unexpected error occurred';
      showError('Sign out failed', message, { variant: 'light', autoHideDuration: 7000 });
    } finally {
      setIsLoggingOut(false);
    }
  };

  const brandHref = user ? '/dashboard' : '/';
  const accountLabel = user?.displayName || user?.email || 'Account';
  const accountInitial = accountLabel.charAt(0).toUpperCase() || 'S';
  const showLeagueSwitcher = Boolean(user) && shouldShowLeagueSwitcher(pathname);
  const desktopNavigationItems = user ? primaryNavigationItems : publicNavigationItems;
  const brandDescriptor = user ? 'Fantasy AFL workspace' : 'AFL fantasy platform';

  if (isDraftHubPath(pathname)) {
    return null;
  }

  return (
    <TeamProvider enabled={showLeagueSwitcher}>
      <>
        <AlertContainer alerts={alerts} onRemove={removeAlert} position="top-right" />

        <header
          className={`sticky top-0 z-50 border-b border-[color:var(--league-border)] bg-[color:var(--league-surface)]/95 backdrop-blur ${
            scrolled ? 'shadow-[0_16px_40px_-32px_rgba(23,34,48,0.28)]' : ''
          }`}
          role="banner"
        >
          <div className="mx-auto grid h-16 w-full max-w-[var(--app-shell-max-width)] grid-cols-[minmax(0,max-content)_minmax(0,1fr)_minmax(0,max-content)] items-center gap-3 px-4 sm:px-6 lg:px-8">
            <div className="min-w-0">
              <Link href={brandHref} className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] shadow-sm lg:h-11 lg:w-11">
                  <Image
                    src="/logo-statly-shield.svg"
                    alt="Statly logo"
                    width={28}
                    height={28}
                    priority
                    className="object-contain"
                  />
                </div>
                <div className="min-w-0 max-w-[12rem] xl:max-w-[14rem]">
                  <div className="truncate text-sm font-semibold tracking-tight text-[color:var(--league-text)] xl:text-base">
                    Statly
                  </div>
                  <div className="hidden truncate text-[11px] font-medium uppercase tracking-[0.18em] text-[color:var(--league-text-muted)] 2xl:block">
                    {brandDescriptor}
                  </div>
                </div>
              </Link>
            </div>

            <div className="hidden min-w-0 items-center justify-center lg:flex">
              <div className="inline-flex min-w-0 max-w-full items-center gap-1 overflow-x-auto rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-page)] p-1 [scrollbar-width:none]">
                {desktopNavigationItems.map((item) => {
                  const isActive = isNavActive(pathname, item.href);
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      aria-current={isActive ? 'page' : undefined}
                      className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] ${
                        isActive
                          ? 'bg-[color:var(--league-primary)] text-white'
                          : 'text-[color:var(--league-text-muted)] hover:bg-white hover:text-[color:var(--league-text)]'
                      }`}
                    >
                      <span className="hidden sm:block">{item.icon}</span>
                      <span>{item.name}</span>
                    </Link>
                  );
                })}
                {user ? <NavDropdown item={toolsNavigationItem} pathname={pathname} /> : null}
              </div>
            </div>

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
                    className="inline-flex items-center gap-3 rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-2.5 py-1.5 text-sm font-medium text-[color:var(--league-text)] transition hover:bg-[color:var(--league-surface-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
                    aria-haspopup="menu"
                    aria-expanded={isAccountMenuOpen}
                    aria-controls="account-menu"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[color:var(--league-primary)] text-xs font-semibold text-white">
                      {accountInitial}
                    </span>
                    <span className="hidden max-w-[160px] truncate 2xl:block">{accountLabel}</span>
                    <svg
                      className="h-4 w-4 text-[color:var(--league-text-muted)]"
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
                      role="menu"
                      className="absolute right-0 mt-2 w-56 overflow-hidden rounded-[24px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] shadow-[0_24px_60px_-35px_rgba(23,34,48,0.22)]"
                    >
                      <div className="border-b border-[color:var(--league-border)] bg-[color:var(--league-page)] px-4 py-3 text-sm">
                        <p className="font-semibold text-[color:var(--league-text)]">Signed in</p>
                        <p className="truncate text-[color:var(--league-text-muted)]">
                          {accountLabel}
                        </p>
                      </div>
                      <div className="p-2" role="none">
                        <Link
                          href="/dashboard"
                          role="menuitem"
                          className="flex rounded-2xl px-3 py-2 text-sm text-[color:var(--league-text-muted)] transition hover:bg-[color:var(--league-surface-muted)] hover:text-[color:var(--league-text)]"
                          onClick={() => setIsAccountMenuOpen(false)}
                        >
                          Dashboard
                        </Link>
                        <Link
                          href="/help"
                          role="menuitem"
                          className="flex rounded-2xl px-3 py-2 text-sm text-[color:var(--league-text-muted)] transition hover:bg-[color:var(--league-surface-muted)] hover:text-[color:var(--league-text)]"
                          onClick={() => setIsAccountMenuOpen(false)}
                        >
                          Help
                        </Link>
                        <button
                          type="button"
                          role="menuitem"
                          className="flex w-full rounded-2xl px-3 py-2 text-left text-sm text-[color:var(--league-text-muted)] transition hover:bg-[color:var(--league-surface-muted)] hover:text-[color:var(--league-text)]"
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
                  className="rounded-full bg-[color:var(--league-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[color:var(--league-primary-hover)]"
                >
                  Sign in
                </Link>
              )}
            </div>

            <button
              type="button"
              onClick={() => setIsMobileOpen((open) => !open)}
              className="ml-auto inline-flex items-center justify-center rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-page)] p-2 text-[color:var(--league-text-muted)] transition hover:bg-[color:var(--league-surface-muted)] hover:text-[color:var(--league-text)] lg:hidden"
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
              <motion.div
                id="mobile-main-navigation"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="border-t border-[color:var(--league-border)] bg-[color:var(--league-surface)] lg:hidden"
              >
                <div className="space-y-4 px-4 py-4">
                  {user ? (
                    <>
                      <div className="rounded-[24px] border border-[color:var(--league-border)] bg-[color:var(--league-page)] p-4">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--league-text-muted)]">
                          Quick actions
                        </p>
                        <div className="mt-3 space-y-3">
                          <PlayerSearch placeholder="Search players" size="md" variant="default" />
                          {showLeagueSwitcher ? <LeagueSwitcher /> : null}
                        </div>
                      </div>

                      <div className="rounded-[24px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-2">
                        <p className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--league-text-muted)]">
                          Navigate
                        </p>
                        <div className="mt-2 space-y-1">
                          {primaryNavigationItems.map((item) => {
                            const isActive = isNavActive(pathname, item.href);
                            return (
                              <Link
                                key={item.name}
                                href={item.href}
                                onClick={() => setIsMobileOpen(false)}
                                aria-current={isActive ? 'page' : undefined}
                                className={`flex items-start gap-3 rounded-2xl px-3 py-3 transition ${
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

                      <div className="rounded-[24px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-2">
                        <p className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--league-text-muted)]">
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
                                className={`flex items-start gap-3 rounded-2xl px-3 py-3 transition ${
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

                      <div className="rounded-[24px] border border-[color:var(--league-border)] bg-[color:var(--league-page)] p-4">
                        <div className="flex items-center gap-3">
                          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--league-primary)] text-sm font-semibold text-white">
                            {accountInitial}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-[color:var(--league-text)]">
                              {accountLabel}
                            </p>
                            <p className="text-xs text-[color:var(--league-text-muted)]">
                              Signed in
                            </p>
                          </div>
                        </div>
                        <div className="mt-4 grid gap-2">
                          <Link
                            href="/dashboard"
                            onClick={() => setIsMobileOpen(false)}
                            className="rounded-2xl border border-[color:var(--league-border)] bg-white px-4 py-3 text-sm font-medium text-[color:var(--league-text-muted)] transition hover:bg-[color:var(--league-surface-muted)] hover:text-[color:var(--league-text)]"
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
                            className="rounded-2xl bg-[color:var(--league-primary)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[color:var(--league-primary-hover)] disabled:opacity-50"
                          >
                            {isLoggingOut ? 'Signing out…' : 'Sign out'}
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-[24px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-2">
                      {publicNavigationItems.map((item) => {
                        const isActive = isNavActive(pathname, item.href);
                        return (
                          <Link
                            key={item.name}
                            href={item.href}
                            onClick={() => setIsMobileOpen(false)}
                            aria-current={isActive ? 'page' : undefined}
                            className={`flex items-start gap-3 rounded-2xl px-3 py-3 transition ${
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
                          href="/fantasy"
                          onClick={() => setIsMobileOpen(false)}
                          className="mb-2 block rounded-2xl border border-[color:var(--league-border)] bg-white px-4 py-3 text-center text-sm font-semibold text-[color:var(--league-text)] transition hover:bg-[color:var(--league-surface-muted)]"
                        >
                          Open Fantasy
                        </Link>
                        <Link
                          href="/login"
                          onClick={() => setIsMobileOpen(false)}
                          className="block rounded-2xl bg-[color:var(--league-primary)] px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-[color:var(--league-primary-hover)]"
                        >
                          Sign in
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </header>
      </>
    </TeamProvider>
  );
}
