import type { Metadata } from 'next';
import Link from 'next/link';

import { clubChainsHref, tradeStoryHref } from '@/components/aflTradeStory/tradePageModel';
import { publicTradeStoryReads } from '@/server/aflTradeIntelligence/publication/publicTradeStoryReads';

import { TradesUnavailable } from './TradesUnavailable';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'AFL trades, valued | Statly',
  description:
    'Every AFL trade Statly has graded: what each club gave and got, valued by what the players went on to do.',
};

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** The public list of graded trades, newest year first, from the owner-approved bundle. */
export default async function PublicTradesPage() {
  const read = await publicTradeStoryReads.listStories();
  if (!read.available) return <TradesUnavailable />;
  const { stories, source } = read.value;
  const clubs = [
    ...new Map(
      stories.flatMap((story) =>
        story.clubIds.map((id, index) => [id, story.clubNames[index]!] as const)
      )
    ),
  ].sort(([, left], [, right]) => left.localeCompare(right));
  const years = [...new Set(stories.map(({ year }) => year))].sort((a, b) => b - a);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-muted-foreground">
        <Link href="/afl" className={`underline underline-offset-2 ${focusRing}`}>
          AFL
        </Link>{' '}
        / Trades
      </nav>
      <h1 className="text-3xl font-semibold text-foreground text-balance">AFL trades, valued</h1>
      <p className="mt-3 max-w-[65ch] text-muted-foreground">
        {stories.length} trades, each valued by what the players and picks went on to do for the
        club that got them. {source.label}.{' '}
        <Link href="/afl/trades/method" className={`underline underline-offset-2 ${focusRing}`}>
          How this works
        </Link>
      </p>

      <section aria-labelledby="clubs-heading" className="mt-8">
        <h2 id="clubs-heading" className="text-lg font-semibold text-foreground">
          By club
        </h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {clubs.map(([clubId, clubName]) => (
            <li key={clubId}>
              <Link
                href={clubChainsHref(clubId, 'public')}
                className={`inline-flex min-h-11 items-center rounded-full border border-border bg-card px-4 text-sm text-foreground hover:bg-accent ${focusRing}`}
              >
                {clubName}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {years.map((year) => (
        <section key={year} aria-labelledby={`year-${year}`} className="mt-8">
          <h2 id={`year-${year}`} className="text-lg font-semibold text-foreground">
            {year}
          </h2>
          <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-card">
            {stories
              .filter((story) => story.year === year)
              .map((story) => (
                <li key={story.tradeId}>
                  <Link
                    href={tradeStoryHref(story.tradeId, 'public')}
                    className={`flex min-h-12 items-center px-4 py-3 font-medium text-foreground hover:bg-accent ${focusRing}`}
                  >
                    {story.clubNames.join(' ⇄ ')}
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
