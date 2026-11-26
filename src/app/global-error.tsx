'use client';

import { useEffect } from 'react';
import { ArrowPathIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';

import { buttonStyles } from '@/components/ui/controlStyles';
// global-error replaces the root layout, so it must load the global styles and tokens itself.
import '@/index.css';
import { captureException } from '@/lib/sentry-utils';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureException(error);
  }, [error]);

  return (
    <html lang="en" data-theme="light">
      <body className="font-sans">
        <main className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
          <div className="max-w-md text-center">
            <div className="mx-auto mb-4 h-12 w-12 text-destructive-text">
              <ExclamationTriangleIcon aria-hidden="true" />
            </div>
            <h1 className="mb-2 text-2xl font-semibold">Something went wrong</h1>
            <p className="mb-4 text-muted-foreground">
              We have been notified. Try again, or head back to the home page.
            </p>
            {error.digest && (
              <p className="mb-4 font-mono text-xs text-muted-foreground">
                Reference: {error.digest}
              </p>
            )}
            <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={reset}
                className={buttonStyles({ variant: 'primary' })}
              >
                <ArrowPathIcon aria-hidden="true" className="size-4" />
                Try again
              </button>
              {/* A full page load, because the root layout itself failed. */}
              <a href="/" className={buttonStyles()}>
                Go home
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
