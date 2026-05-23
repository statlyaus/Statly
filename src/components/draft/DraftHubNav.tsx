'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { draftHubSubtlePanelClass } from '@/components/draft/draftHubChrome';

export function DraftHubNav() {
  const pathname = usePathname() ?? '';
  const tradesActive = pathname === '/draft/trades' || pathname.startsWith('/draft/trades/');
  const clubsActive = pathname === '/draft/clubs' || pathname.startsWith('/draft/clubs/');

  return (
    <nav className="mt-5" aria-label="Draft hub sections">
      <div className={`${draftHubSubtlePanelClass} grid gap-2 p-2 md:grid-cols-2`}>
        <Link
          href="/draft/trades"
          className={`rounded-[1.2rem] border px-4 py-3 text-left transition ${
            tradesActive
              ? 'border-primary/30 bg-primary/10 text-foreground shadow-sm'
              : 'border-transparent bg-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-accent-foreground'
          }`}
          aria-current={tradesActive ? 'page' : undefined}
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary/80">
            Explorer
          </p>
          <p className="mt-1 text-sm font-semibold">Trades</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Scan deals by season, club, and asset profile with a persistent detail rail.
          </p>
        </Link>
        <Link
          href="/draft/clubs"
          className={`rounded-[1.2rem] border px-4 py-3 text-left transition ${
            clubsActive
              ? 'border-primary/30 bg-primary/10 text-foreground shadow-sm'
              : 'border-transparent bg-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-accent-foreground'
          }`}
          aria-current={clubsActive ? 'page' : undefined}
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary/80">
            Directory
          </p>
          <p className="mt-1 text-sm font-semibold">Clubs</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Compare club-level trade activity and open each club&apos;s historical record.
          </p>
        </Link>
      </div>
    </nav>
  );
}
