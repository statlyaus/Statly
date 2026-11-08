import type { Metadata } from 'next';
import Link from 'next/link';

import { buttonStyles } from '@/components/ui/controlStyles';

export const metadata: Metadata = { title: 'Page not found - Statly' };

// Catches notFound() thrown by a layout directly under (app), such as the basketball access gate.
// Without it the error reaches AppLayout's error boundary and shows "Something went wrong" instead
// of a 404. It renders inside the app shell's main landmark, so it is a plain div.
export default function AppNotFound() {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-16 text-center">
      <p className="mb-2 font-mono text-sm text-muted-foreground">404</p>
      <h1 className="mb-2 text-2xl font-semibold text-foreground">Page not found</h1>
      <p className="mb-6 text-muted-foreground">
        This page does not exist, or you do not have access to it.
      </p>
      <Link href="/dashboard" className={buttonStyles({ variant: 'primary' })}>
        Go to your dashboard
      </Link>
    </div>
  );
}
