import type { ReactNode } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AFL Draft & Trade Hub | Statly',
  description: 'Public AFL draft and trade records, club movement, and pick analysis.',
};

export default function DraftLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-6xl p-4 md:p-6">
      <header className="mb-6 border-b border-base-300 pb-4">
        <h1 className="text-2xl font-semibold">Draft Trades</h1>
        <p className="text-sm text-base-content/70">
          Historical AFL trade records (separate from Fantasy gameplay).
        </p>
        <nav className="mt-3">
          <Link href="/draft/trades" className="link link-primary text-sm">
            Browse Trades
          </Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
