import type { ReactNode } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';

import { DraftHubNav } from '@/components/draft/DraftHubNav';
import {
  draftHubHeaderDescriptionClass,
  draftHubHeaderKickerClass,
  draftHubHeaderShellClass,
  draftHubHeaderTitleClass,
  draftHubHeroTopAccentClass,
  draftHubPageShellClass,
  draftHubSectionPillClass,
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
        <div className={draftHubHeroTopAccentClass} />
        <div className="flex flex-col gap-5 border-b border-info/20 pb-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className={draftHubHeaderKickerClass}>Statly Public Research Hub</p>
            <h1 className={draftHubHeaderTitleClass}>AFL Draft &amp; Trade Outcomes</h1>
            <p className={draftHubHeaderDescriptionClass}>
              Explore the historical AFL trade archive and club movement in a public research
              workspace separate from Statly Fantasy. Checked numerical outcome releases are not yet
              published.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className={draftHubSectionPillClass}>Historical trade archive</span>
              <span className={draftHubSectionPillClass}>Club movement analysis</span>
              <span className={draftHubSectionPillClass}>Outcome methodology</span>
              <span className={draftHubSectionPillClass}>Numerical outcomes not published</span>
            </div>
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
