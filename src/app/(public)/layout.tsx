import type { ReactNode } from 'react';

import Image from 'next/image';
import Link from 'next/link';

import { PublicNavigation } from '@/components/navigation/PublicNavigation';

const footerLinks = [
  { href: '/draft/outcomes/methodology', label: 'Outcomes methodology' },
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/terms', label: 'Terms of Service' },
  { href: '/data-deletion', label: 'Data deletion' },
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
      <header className="sticky top-0 z-40 border-b border-brand-bar bg-brand-bar text-brand-bar-foreground">
        <nav
          aria-label="Primary"
          className="mx-auto grid min-h-16 max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-2 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:px-6 sm:py-3 lg:px-10"
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
              priority
              className="h-auto w-28 sm:w-32"
            />
          </Link>
          <PublicNavigation />
          <Link
            href="/login"
            className="col-start-2 row-start-1 inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-md bg-white px-3 py-2 text-sm font-semibold text-brand-bar transition hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-bar sm:col-start-3 sm:ml-2"
          >
            Sign in
          </Link>
        </nav>
      </header>
      <main id="main-content" tabIndex={-1} className="w-full min-w-0 outline-none">
        {children}
      </main>
      <footer className="border-t border-border bg-card">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-10">
          <nav aria-label="Footer">
            <ul className="flex flex-wrap gap-x-1 gap-y-1">
              {footerLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="inline-flex min-h-11 items-center rounded-md px-2 font-medium text-foreground underline-offset-4 transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <p className="px-2">&copy; {new Date().getFullYear()} Statly</p>
        </div>
      </footer>
    </>
  );
}
