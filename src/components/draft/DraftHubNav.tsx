'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { draftHubSubtlePanelClass } from '@/components/draft/draftHubChrome';

export function DraftHubNav() {
  const pathname = usePathname() ?? '';
  const outcomesActive = pathname === '/draft/outcomes' || pathname.startsWith('/draft/outcomes/');
  const methodologyActive =
    pathname === '/draft/trades/methodology' || pathname.startsWith('/draft/trades/methodology/');
  const tradesActive =
    !methodologyActive && (pathname === '/draft/trades' || pathname.startsWith('/draft/trades/'));
  const draftsActive = pathname === '/draft/drafts' || pathname.startsWith('/draft/drafts/');
  const clubsActive = pathname === '/draft/clubs' || pathname.startsWith('/draft/clubs/');
  const sections = [
    {
      href: '/draft/outcomes',
      label: 'Outcomes',
      active: outcomesActive,
    },
    {
      href: '/draft/trades',
      label: 'Trade archive',
      active: tradesActive,
    },
    {
      href: '/draft/drafts',
      label: 'Draft history',
      active: draftsActive,
    },
    {
      href: '/draft/clubs',
      label: 'Club histories',
      active: clubsActive,
    },
    {
      href: '/draft/trades/methodology',
      label: 'Methodology & status',
      active: methodologyActive,
    },
  ] as const;

  return (
    <nav className="mt-5" aria-label="AFL Draft and Trade Outcomes sections">
      <div
        className={`${draftHubSubtlePanelClass} grid grid-cols-2 gap-1 p-1 sm:grid-cols-3 lg:grid-cols-5`}
      >
        {sections.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className={`flex min-h-11 min-w-0 items-center justify-center rounded-md px-3 py-2 text-center text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
              section.active
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
            aria-current={section.active ? 'page' : undefined}
          >
            {section.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
