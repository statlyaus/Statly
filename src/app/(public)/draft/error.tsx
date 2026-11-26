'use client';

import { useEffect } from 'react';

import { buttonStyles } from '@/components/ui/controlStyles';
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
      className="border border-border bg-card p-8 text-card-foreground"
    >
      <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
        <span className="inline-flex rounded-cut bg-destructive px-3 py-1 text-xs font-semibold text-destructive-foreground">
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
          className={buttonStyles({ variant: 'primary', className: 'mt-6' })}
        >
          Try again
        </button>
      </div>
    </section>
  );
}
