'use client';

import { RouteErrorState } from '@/components/ui/RouteErrorState';

// Renders inside the app shell, so navigation stays usable when one page fails.
export default function AppRouteError({
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
      boundary="app-route"
      homeHref="/dashboard"
      homeLabel="Go to dashboard"
      hint="Try again, or head back to your dashboard."
    />
  );
}
