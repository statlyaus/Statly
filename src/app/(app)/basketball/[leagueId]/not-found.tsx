'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';

import { basketballLeagueHref } from '@/components/basketball/shell/basketballFormat';
import { buttonStyles } from '@/components/ui/controlStyles';

// A missing page inside a league the user owns: the league header and tabs stay above it. A missing
// or someone else's league is the basketball-level not-found, raised by the league layout.
export default function BasketballLeaguePageNotFound() {
  const leagueId = useParams<{ leagueId: string }>()?.leagueId ?? '';
  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h1 className="font-display text-xl font-bold text-foreground">Page not found</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        This league has no page at that address. Pick a section above.
      </p>
      <Link
        href={leagueId ? basketballLeagueHref(leagueId) : '/basketball'}
        className={buttonStyles({ variant: 'primary', className: 'mt-4' })}
      >
        Back to the overview
      </Link>
    </div>
  );
}
