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
  title: 'AFL Draft & Trade Hub | Statly',
  description: 'Public AFL draft and trade records, club movement, and pick analysis.',
};

export default function DraftLayout({ children }: { children: ReactNode }) {
  return (
    <div className={draftHubPageShellClass}>
      <header className={`${draftHubHeaderShellClass} mb-6`}>
        <div className={draftHubHeroTopAccentClass} />
        <div className="flex flex-col gap-5 border-b border-sky-900/10 pb-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className={draftHubHeaderKickerClass}>Statly Public Research Hub</p>
            <h1 className={draftHubHeaderTitleClass}>AFL Draft &amp; Trade Hub</h1>
            <p className={draftHubHeaderDescriptionClass}>
              A public research workspace for historical AFL trade intelligence, club movement, and
              draft asset records. Use it to scan the market quickly, compare club patterns, and
              keep detail in view while you explore.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className={draftHubSectionPillClass}>Historical trade records</span>
              <span className={draftHubSectionPillClass}>Club movement analysis</span>
              <span className={draftHubSectionPillClass}>Public draft asset research</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <Link href="/fantasy" className="btn btn-outline btn-sm bg-white/85">
              Return to Fantasy
            </Link>
          </div>
        </div>
        <DraftHubNav />
      </header>
      {children}
    </div>
  );
}
