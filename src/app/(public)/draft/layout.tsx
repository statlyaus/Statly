import type { ReactNode } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';

import { DraftHubNav } from '@/components/draft/DraftHubNav';
import {
  draftHubHeaderDescriptionClass,
  draftHubHeaderShellClass,
  draftHubHeaderTitleClass,
  draftHubPageShellClass,
} from '@/components/draft/draftHubChrome';

export const metadata: Metadata = {
  title: 'AFL Draft & Trade Outcomes | Statly',
  description:
    'Explore public AFL draft and trade records, club movement, and the status of checked numerical outcome publications.',
};

export default function DraftLayout({ children }: { children: ReactNode }) {
  return (
    <div className={draftHubPageShellClass}>
      <header className={`${draftHubHeaderShellClass} mb-6`}>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <h1 className={draftHubHeaderTitleClass}>AFL Draft &amp; Trade Outcomes</h1>
            <p className={draftHubHeaderDescriptionClass}>
              Explore AFL trades, draft selections, pick movement, and club history. Records and
              valuations are each published only after their own review.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <Link
              href="/draft/outcomes"
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Outcome publication status
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Open Statly Fantasy
            </Link>
          </div>
        </div>
        <DraftHubNav />
      </header>
      {children}
    </div>
  );
}
