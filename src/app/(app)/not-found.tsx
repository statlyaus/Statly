import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Page not found - Statly',
};

// notFound() from an app page renders this inside the app shell, so managers keep their
// navigation and land back on their dashboard rather than the public home page.
export default function AppNotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <div className="max-w-md text-center">
        <p className="mb-2 font-mono text-sm text-muted-foreground">404</p>
        <h1 className="mb-2 text-2xl font-semibold text-foreground">Page not found</h1>
        <p className="mb-6 text-muted-foreground">
          This page does not exist, or you do not have access to it.
        </p>
        <Link
          href="/dashboard"
          className="inline-flex min-h-11 items-center rounded-md bg-brand-bar px-4 text-sm font-semibold text-brand-bar-foreground transition-colors hover:bg-brand-bar/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
