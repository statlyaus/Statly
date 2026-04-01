import type { ReactNode } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AFL Draft & Trade Hub | Statly',
  description: 'Public AFL draft and trade records, club movement, and pick analysis.',
};

export default function DraftLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-7xl p-4 md:p-6">
      <header className="mb-6 rounded-2xl border border-base-300 bg-linear-to-br from-base-100 to-base-200/40 p-4 shadow-sm md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold md:text-3xl">AFL Draft & Trade Hub</h1>
            <p className="text-sm text-base-content/70 md:text-base">
              Historical AFL trade intelligence, club movement, and draft asset records.
            </p>
          </div>
          <Link href="/fantasy" className="btn btn-outline btn-sm">
            Go to Fantasy
          </Link>
        </div>
        <nav className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <Link href="/draft/trades" className="btn btn-primary btn-sm">
            Trades
          </Link>
          <Link href="/draft/clubs" className="btn btn-outline btn-sm">
            Clubs
          </Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
