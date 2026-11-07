'use client';

import { useEffect } from 'react';

import { buttonStyles } from '@/components/ui/controlStyles';
import { captureError } from '@/lib/sentry-utils';

// Renders under the league header and tabs, so the other sections stay one click away.
export default function BasketballLeagueError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    captureError(error, { boundary: 'basketball-league' });
  }, [error]);

  return (
    <div role="alert" className="rounded-lg border border-border bg-card p-6">
      <h1 className="font-display text-xl font-bold text-foreground">This page could not load</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Try again, or open another section above. Your league is unchanged.
      </p>
      <button
        type="button"
        onClick={() => retry()}
        className={buttonStyles({ variant: 'primary', className: 'mt-4' })}
      >
        Try again
      </button>
    </div>
  );
}
