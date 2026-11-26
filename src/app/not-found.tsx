import type { Metadata } from 'next';
import Link from 'next/link';

import { buttonStyles } from '@/components/ui/controlStyles';
export const metadata: Metadata = {
  title: 'Page not found - Statly',
};

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <div className="max-w-md text-center">
        <p className="mb-2 font-mono text-sm text-muted-foreground">404</p>
        <h1 className="mb-2 text-2xl font-semibold">Page not found</h1>
        <p className="mb-6 text-muted-foreground">
          This page does not exist, or you do not have access to it.
        </p>
        <Link href="/" className={buttonStyles({ variant: 'primary' })}>
          Go home
        </Link>
      </div>
    </main>
  );
}
