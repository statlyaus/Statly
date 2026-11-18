import type { ReactNode } from 'react';

import Image from 'next/image';
import Link from 'next/link';

import { PublicNavigation } from '@/components/navigation/PublicNavigation';

/** Footer: logo, then secondary navigation, then legal pages, each its own labelled group. */
const footerGroups = [
  {
    label: 'Methods',
    links: [
      { href: '/afl/trades/method', label: 'How trades are valued' },
      { href: '/draft/outcomes/methodology', label: 'Outcomes methodology' },
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
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:inline-flex focus:min-h-11 focus:items-center focus:rounded-md focus:border focus:border-border focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>
      <div className="flex min-h-dvh flex-col">
        <header className="sticky top-0 z-40 border-b border-brand-bar bg-brand-bar text-brand-bar-foreground">
          <nav
            aria-label="Primary"
            className="mx-auto grid min-h-16 max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:px-6 sm:py-0 lg:px-10"
          >
            <Link
              href="/"
              className="col-start-1 row-start-1 inline-flex min-h-11 w-fit shrink-0 items-center rounded-md transition hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              aria-label="Statly home"
            >
              <Image
                src="/brand/statly-hero-logo-overlay.png"
                alt="Statly"
                width={136}
                height={40}
                loading="eager"
                className="h-auto w-28 sm:w-32"
              />
            </Link>
            <PublicNavigation />
          </nav>
        </header>
        <main id="main-content" tabIndex={-1} className="w-full min-w-0 flex-1 outline-none">
          {children}
        </main>
        <footer className="bg-brand-bar pb-[calc(4.5rem+env(safe-area-inset-bottom))] text-brand-bar-foreground sm:pb-0">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-12 sm:px-6 lg:px-10">
            <div className="flex flex-col gap-3">
              <Image
                src="/brand/statly-hero-logo-overlay.png"
                alt="Statly"
                width={136}
                height={40}
                className="h-auto w-28"
              />
              <p className="text-brand-bar-foreground/70">
                &copy; {new Date().getFullYear()} Statly
              </p>
            </div>
            {footerGroups.map((group) => (
              <nav key={group.label} aria-label={group.label}>
                <h2 className="text-xs font-semibold tracking-wide text-brand-bar-foreground/70 uppercase">
                  {group.label}
                </h2>
                <ul className="mt-2 flex flex-col">
                  {group.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="-mx-2 inline-flex min-h-11 items-center rounded-md px-2 font-medium underline-offset-4 transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
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
