import type { ReactNode } from 'react';

import Link from 'next/link';

import { StatlyWordmark } from '@/components/brand/StatlyWordmark';
import { PublicNavigation } from '@/components/navigation/PublicNavigation';

/** Footer: logo, then secondary navigation, then legal pages, each its own labelled group. */
const footerGroups = [
  {
    label: 'Methods',
    links: [
      { href: '/afl/trades/method', label: 'How trades are valued' },
      // "Outcomes methodology" (/draft/outcomes/methodology) is hidden with the rest of the draft
      // record until a reviewed factual release is published (runbook, "Publishing the draft record").
    ],
  },
  {
    label: 'Legal',
    links: [
      { href: '/privacy', label: 'Privacy Policy' },
      { href: '/terms', label: 'Terms of Service' },
      { href: '/data-deletion', label: 'Data deletion' },
    ],
  },
] as const;

export default function PublicRouteLayout({ children }: { readonly children: ReactNode }) {
  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:inline-flex focus:min-h-11 focus:items-center focus:rounded-cut focus:border focus:border-border focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>
      <div className="flex min-h-dvh flex-col">
        {/* The cobalt bar with the Sherrin wordmark, the same as the app's (owner, 2026-11-21). */}
        <header className="ground-cobalt sticky top-0 z-40">
          <nav
            aria-label="Primary"
            className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-7 px-4 pt-2 sm:h-16 sm:flex-nowrap sm:px-6 sm:pt-0 lg:px-10"
          >
            <Link
              href="/"
              className="inline-flex min-h-11 shrink-0 items-center transition hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Statly home"
            >
              <StatlyWordmark className="mr-4 py-3" />
            </Link>
            <span aria-hidden="true" className="hidden h-6 w-px bg-border sm:block" />
            <PublicNavigation />
          </nav>
        </header>
        <main id="main-content" tabIndex={-1} className="w-full min-w-0 flex-1 outline-none">
          {children}
        </main>
        <footer className="ground-cobalt pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-12 sm:px-6 lg:px-10">
            <div className="flex flex-col gap-3">
              <p>
                <StatlyWordmark />
              </p>
              <p className="text-muted-foreground">&copy; {new Date().getFullYear()} Statly</p>
            </div>
            {footerGroups.map((group) => (
              <nav key={group.label} aria-label={group.label}>
                <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {group.label}
                </h2>
                <ul className="mt-2 flex flex-col">
                  {group.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="-mx-2 inline-flex min-h-11 items-center rounded-cut px-2 font-medium underline-offset-4 transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </footer>
      </div>
    </>
  );
}
