'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function DraftHubNav() {
  const pathname = usePathname() ?? '';
  const tradesActive = pathname === '/draft/trades' || pathname.startsWith('/draft/trades/');
  const clubsActive = pathname === '/draft/clubs' || pathname.startsWith('/draft/clubs/');

  return (
    <nav className="mt-4 flex flex-wrap items-center gap-2 text-sm" aria-label="Draft hub sections">
      <Link
        href="/draft/trades"
        className={`btn btn-sm ${tradesActive ? 'btn-primary' : 'btn-outline'}`}
        aria-current={tradesActive ? 'page' : undefined}
      >
        Trades
      </Link>
      <Link
        href="/draft/clubs"
        className={`btn btn-sm ${clubsActive ? 'btn-primary' : 'btn-outline'}`}
        aria-current={clubsActive ? 'page' : undefined}
      >
        Clubs
      </Link>
    </nav>
  );
}
