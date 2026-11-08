import Link from 'next/link';

import { buttonStyles } from '@/components/ui/controlStyles';

// Catches notFound() from the league layout, which answers the same for a missing league and for
// someone else's, so neither is revealed.
export default function BasketballLeagueNotFound() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-2xl font-bold text-foreground">League not found</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        This basketball league doesn&apos;t exist, or it isn&apos;t one of yours.
      </p>
      <Link href="/basketball" className={buttonStyles({ variant: 'primary', className: 'mt-5' })}>
        Your basketball leagues
      </Link>
    </div>
  );
}
