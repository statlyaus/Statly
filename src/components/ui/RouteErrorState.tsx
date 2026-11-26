'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { ArrowPathIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';

import { buttonStyles } from '@/components/ui/controlStyles';
import { captureError } from '@/lib/sentry-utils';

export interface RouteErrorStateProps {
  error: Error & { digest?: string };
  reset: () => void;
  /** Reported with the error so the failing route group is identifiable. */
  boundary: string;
  homeHref: string;
  homeLabel: string;
  hint: string;
}

/**
 * The body of a route group's error.tsx. It renders inside the group's layout, so the header and
 * footer stay usable when one page fails. Raw error text can expose internals; it is reported, not
 * shown.
 */
export function RouteErrorState({
  error,
  reset,
  boundary,
  homeHref,
  homeLabel,
  hint,
}: RouteErrorStateProps) {
  useEffect(() => {
    captureError(error, { boundary, digest: error.digest });
  }, [boundary, error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 h-12 w-12 text-destructive-text">
          <ExclamationTriangleIcon aria-hidden="true" />
        </div>
        <h1 className="mb-2 text-2xl font-semibold text-foreground">This page could not load</h1>
        <p className="mb-4 text-muted-foreground">{hint}</p>
        {error.digest && (
          <p className="mb-4 font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>
        )}
        <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
          <button type="button" onClick={reset} className={buttonStyles({ variant: 'primary' })}>
            <ArrowPathIcon aria-hidden="true" className="size-4" />
            Try again
          </button>
          <Link href={homeHref} className={buttonStyles()}>
            {homeLabel}
          </Link>
        </div>
      </div>
    </div>
  );
}
