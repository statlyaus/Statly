import type { ReactNode } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';

import { DraftHubNav } from '@/components/draft/DraftHubNav';
import { buttonStyles } from '@/components/ui/controlStyles';
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
  // Kept out of search while no reviewed factual release is active and every page is empty. Drop this
  // when one is published (runbook, "Publishing the draft record"). Links are still followed.
  robots: { index: false, follow: true },
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
            <Link href="/draft/outcomes" className={buttonStyles()}>
              Outcome publication status
            </Link>
          </div>
        </div>
        <DraftHubNav />
      </header>
      {children}
    </div>
  );
}
