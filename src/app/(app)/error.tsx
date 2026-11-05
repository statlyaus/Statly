'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { ArrowPathIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';

import { captureError } from '@/lib/sentry-utils';

// Renders inside the app shell, so navigation stays usable when one page fails.
export default function AppRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureError(error, { boundary: 'app-route', digest: error.digest });
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 h-12 w-12 text-result-loss">
          <ExclamationTriangleIcon aria-hidden="true" />
        </div>
        <h1 className="mb-2 text-2xl font-semibold text-foreground">This page could not load</h1>
        {/* Raw error text can expose internals; it is reported, not shown. */}
        <p className="mb-4 text-muted-foreground">Try again, or head back to your dashboard.</p>
        {error.digest && (
          <p className="mb-4 font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>
        )}
        <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-11 items-center rounded-md bg-brand-bar px-4 text-sm font-semibold text-brand-bar-foreground transition-colors hover:bg-brand-bar/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <ArrowPathIcon aria-hidden="true" className="mr-2 h-4 w-4" />
            Try again
          </button>
          <Link
            href="/dashboard"
            className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
