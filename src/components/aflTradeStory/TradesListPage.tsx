import Link from 'next/link';

import type {
  AflTradeStorySampleList,
  AflTradeStorySampleSummary,
} from '@/server/aflTradeIntelligence/development/tradeStorySamples';

import './tradeStory.css';
import { ClubBadge } from './ClubBadge';
import { clubChainsHref, formatSigned, netTone, tradeStoryHref } from './tradePageModel';

const underline = 'underline underline-offset-2';

/** One trade in the list: each club's result so far and what it got, or just the clubs. */
function TradeRow({ story }: { story: AflTradeStorySampleSummary }) {
  const results = story.results ?? [];
  return (
    <li>
      <Link
        href={tradeStoryHref(story.tradeId, 'public')}
        className="block min-h-12 px-4 py-3 hover:bg-(--ts-bg2)"
      >
        {results.length === 0 ? (
          <span className="ts-body font-medium">{story.clubNames.join(' ⇄ ')}</span>
        ) : (
          <ul className="grid gap-2">
            {results.map((result) => (
              <li key={result.clubId} className="flex items-start gap-2.5">
                <span className="mt-0.5">
                  <ClubBadge clubName={result.clubName} named />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="ts-body font-medium">{result.clubName}</span>{' '}
                  <span className="ts-small text-(--ts-ink2)">
                    got {result.received.length === 0 ? 'nothing' : result.received.join(', ')}
                  </span>
                </span>
                <b className={`ts-body font-semibold tabular-nums ${netTone(result.net)}`}>
                  {formatSigned(result.net)}
                  {result.provisional ? '*' : ''}
                </b>
              </li>
            ))}
          </ul>
        )}
      </Link>
    </li>
  );
}

/**
 * The public list of graded trades (/afl/trades): every trade by year, newest first, with each
 * club's result so far, and a link to each club's chains.
 */
export function TradesListPage({ list }: { list: AflTradeStorySampleList }) {
  const { stories, source } = list;
  const clubs = [
    ...new Map(
      stories.flatMap((story) =>
        story.clubIds.map((id, index) => [id, story.clubNames[index]!] as const)
      )
    ),
  ].sort(([, left], [, right]) => left.localeCompare(right));
  const years = [...new Set(stories.map(({ year }) => year))].sort((a, b) => b - a);
  const anyProvisional = stories.some((story) =>
    story.results?.some(({ provisional }) => provisional)
  );

  return (
    <div className="afl-trade-story min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-4 pt-5 pb-16 sm:px-6">
        <nav aria-label="Breadcrumb" className="mb-3 ts-small text-(--ts-ink2)">
          <Link href="/afl" className={underline}>
            AFL
          </Link>{' '}
          / Trades
        </nav>
        <h1 className="ts-head font-semibold text-balance">AFL trades, valued</h1>
        <p className="mt-2 max-w-[65ch] ts-body text-(--ts-ink2)">
          {stories.length} trades, each valued by what the players and picks went on to do for the
          club that got them. The number beside each club is its result so far, in PAV.{' '}
          {source.label}.{' '}
          <Link href="/afl/trades/method" className={underline}>
            How this works
          </Link>
        </p>

        <nav aria-label="Jump to a year" className="mt-5">
          <ul className="flex flex-wrap gap-2">
            {years.map((year) => (
              <li key={year}>
                <a
                  href={`#year-${year}`}
                  className="inline-flex min-h-11 items-center rounded-full border border-(--ts-line) bg-(--ts-surface) px-4 ts-body font-medium hover:bg-(--ts-bg2)"
                >
                  {year}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <section aria-labelledby="clubs-heading" className="mt-8">
          <h2 id="clubs-heading" className="ts-body font-semibold">
            By club
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {clubs.map(([clubId, clubName]) => (
              <li key={clubId}>
                <Link
                  href={clubChainsHref(clubId, 'public')}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-(--ts-line) bg-(--ts-surface) py-1 pr-4 pl-2 ts-body hover:bg-(--ts-bg2)"
                >
                  <ClubBadge clubName={clubName} named />
                  {clubName}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {years.map((year) => {
          const inYear = stories.filter((story) => story.year === year);
          return (
            <section key={year} aria-labelledby={`year-${year}`} className="mt-10 scroll-mt-24">
              <h2 id={`year-${year}`} className="ts-head font-semibold">
                {year}{' '}
                <span className="ts-small font-normal text-(--ts-ink2)">
                  {inYear.length} trade{inYear.length === 1 ? '' : 's'}
                </span>
              </h2>
              <ul className="mt-3 divide-y divide-(--ts-line) overflow-hidden rounded-xl border border-(--ts-line) bg-(--ts-surface)">
                {inYear.map((story) => (
                  <TradeRow key={story.tradeId} story={story} />
                ))}
              </ul>
            </section>
          );
        })}

        {anyProvisional ? (
          <p className="mt-8 ts-small text-(--ts-ink2)">
            * A value is not in yet, so this result will change.
          </p>
        ) : null}
      </div>
    </div>
  );
}
