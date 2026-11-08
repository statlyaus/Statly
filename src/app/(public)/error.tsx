'use client';

import { RouteErrorState } from '@/components/ui/RouteErrorState';

// Renders inside the public header and footer, so visitors keep navigation when one page fails.
export default function PublicRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteErrorState
      error={error}
      reset={reset}
      boundary="public-route"
      homeHref="/"
      homeLabel="Go home"
      hint="Try again, or head back to the home page."
    />
  );
}
