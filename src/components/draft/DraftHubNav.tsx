'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  draftHubNavKickerClass,
  draftHubSubtlePanelClass,
} from '@/components/draft/draftHubChrome';

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
      kicker: 'Status',
      label: 'Outcomes',
      description: 'Check whether a reviewed numerical outcome publication is available.',
      active: outcomesActive,
    },
    {
      href: '/draft/trades',
      kicker: 'Explorer',
      label: 'Trade archive',
      description: 'Scan historical deals by season, club, and asset profile.',
      active: tradesActive,
    },
    {
      href: '/draft/drafts',
      kicker: 'Selections',
      label: 'Draft history',
      description: 'Follow official selections, original clubs, players, and pick movement.',
      active: draftsActive,
    },
    {
      href: '/draft/clubs',
      kicker: 'Directory',
      label: 'Club histories',
      description: 'Compare club-level trade activity and historical movement.',
      active: clubsActive,
    },
    {
      href: '/draft/trades/methodology',
      kicker: 'Evidence',
      label: 'Methodology & status',
      description: 'Read the publication rules, limitations, and current unavailable state.',
      active: methodologyActive,
    },
  ] as const;

  return (
    <nav className="mt-5" aria-label="AFL Draft and Trade Outcomes sections">
      <div
        className={`${draftHubSubtlePanelClass} grid grid-cols-2 gap-2 p-2 lg:grid-cols-3 xl:grid-cols-5`}
      >
        {sections.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className={`flex min-h-16 min-w-0 flex-col justify-center rounded-[1.2rem] border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:px-4 sm:py-3 ${
              section.active
                ? 'border-primary/30 bg-primary/10 text-foreground shadow-sm'
                : 'border-transparent bg-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-accent-foreground'
            }`}
            aria-current={section.active ? 'page' : undefined}
          >
            <p className={draftHubNavKickerClass}>{section.kicker}</p>
            <p className="mt-1 text-sm font-semibold">{section.label}</p>
            <p className="mt-1 hidden text-xs leading-5 text-muted-foreground sm:block">
              {section.description}
            </p>
          </Link>
        ))}
      </div>
    </nav>
  );
}
