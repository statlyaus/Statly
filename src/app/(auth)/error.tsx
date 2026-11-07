'use client';

import { RouteErrorState } from '@/components/ui/RouteErrorState';

// The sign-in group's layout has no landmark of its own, so this page supplies <main>.
export default function AuthRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <RouteErrorState
        error={error}
        reset={reset}
        boundary="auth-route"
        homeHref="/"
        homeLabel="Go home"
        hint="Try again, or head back to the home page."
      />
    </main>
  );
}
