import type { ReactNode } from 'react';

import Image from 'next/image';
import Link from 'next/link';

const publicLinks = [
  { href: '/', label: 'Home' },
  { href: '/dashboard', label: 'Fantasy' },
  { href: '/draft/trades', label: 'AFL Archive' },
];

export default function PublicRouteLayout({ children }: { readonly children: ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <nav
          aria-label="Primary"
          className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:flex-nowrap sm:px-6 lg:px-10"
        >
          <Link
            href="/"
            className="shrink-0 rounded-md transition hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Statly home"
          >
            <Image
              src="/brand/statly-wordmark-logo.png"
              alt="Statly"
              width={182}
              height={60}
              priority
              className="h-auto w-36"
            />
          </Link>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1 sm:flex-nowrap">
            {publicLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="whitespace-nowrap rounded-md px-2.5 py-2 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-3"
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/login"
              className="ml-1 shrink-0 whitespace-nowrap rounded-md border border-border bg-foreground px-3 py-2 text-sm font-semibold text-background transition hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:ml-2"
            >
              Sign in
            </Link>
          </div>
        </nav>
      </header>
      <div id="main-content" tabIndex={-1} className="outline-none">
        {children}
      </div>
    </>
  );
}
