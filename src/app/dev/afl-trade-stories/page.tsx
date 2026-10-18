import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { tradeStoryHref } from '@/components/aflTradeStory/tradePageModel';
import { privateTradeStoryReads } from '@/server/aflTradeIntelligence/development/privateTradeStoryReads';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Private trades | Statly',
  robots: { index: false, follow: false },
};

/** The private trade pages the reader can open. Not found unless the reader admits the request. */
export default async function PrivateTradeStoriesPage() {
  const list = await privateTradeStoryReads.listStories();
  if (list === null) notFound();
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <p className="mb-4 rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground">
        <b>Private pages.</b> Not for publication. {list.source.label}.
      </p>
      <h1 className="text-3xl font-semibold text-foreground">Private trades</h1>
      <ul className="mt-6 divide-y divide-border rounded-xl border border-border bg-card">
        {list.stories.map((story) => (
          <li key={story.tradeId}>
            <Link
              href={tradeStoryHref(story.tradeId)}
              className="flex min-h-12 items-center justify-between gap-4 px-4 py-3 text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="font-medium">{story.clubNames.join(' ⇄ ')}</span>
              <span className="text-sm text-muted-foreground">{story.year}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
