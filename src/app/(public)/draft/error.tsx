'use client';

import { useEffect } from 'react';

import { captureError } from '@/lib/sentry-utils';

// Renders inside the draft hub layout, so the public header and section navigation stay usable
// when one outcomes page fails instead of the root layout being replaced by global-error.
export default function DraftRouteError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    captureError(error, { boundary: 'draft-route', digest: error.digest });
  }, [error]);

  return (
    <section
      role="alert"
      aria-live="assertive"
      className="rounded-lg border border-border bg-card p-8 text-card-foreground shadow-sm"
    >
      <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
        <span className="inline-flex rounded-full bg-destructive px-3 py-1 text-xs font-semibold text-destructive-foreground">
          Load issue
        </span>
        <h2 className="mt-4 text-2xl font-semibold tracking-tight text-card-foreground">
          This page could not load
        </h2>
        {/* Raw error text can expose internals; it is reported, not shown. */}
        <p className="mt-2 text-sm leading-6 text-muted-foreground md:text-base">
          The AFL draft and trade records are temporarily unavailable. Try again, or open another
          section above.
        </p>
        {error.digest ? (
          <p className="mt-2 font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>
        ) : null}
        <button
          type="button"
          onClick={() => retry()}
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Try again
        </button>
      </div>
    </section>
  );
}
