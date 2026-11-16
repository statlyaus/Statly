import Link from 'next/link';

import type {
  AflTradeStorySampleList,
  AflTradeStorySampleSummary,
} from '@/server/aflTradeIntelligence/development/tradeStorySamples';

import './tradeStory.css';
import { ClubBadge } from './ClubBadge';
import { clubChainsHref, formatSigned, netTone, tradeStoryHref } from './tradePageModel';
import {
  filterTrades,
  tradesListClubs,
  tradesListHref,
  tradesListYears,
  type TradesListQuery,
} from './tradesListQuery';

const underline = 'underline underline-offset-2';
const chip =
  'inline-flex min-h-11 items-center gap-2 rounded-full border px-4 ts-body font-medium transition';
const chipOff = 'border-(--ts-line) bg-(--ts-surface) hover:bg-(--ts-bg2)';
const chipOn = 'border-(--ts-accent) bg-(--ts-accent) text-(--ts-surface)';

/** One trade in a list: each club's result so far and what it got, or just the clubs. */
export function TradeRow({ story }: { story: AflTradeStorySampleSummary }) {
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

/** A filter choice: a link to the list under that choice, marked when it is the current one. */
function Choice({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? 'true' : undefined}
        className={`${chip} ${active ? chipOn : chipOff}`}
      >
        {children}
      </Link>
    </li>
  );
}

/**
 * The public list of graded trades (/afl/trades). Year and club filters combine and live in the
 * address; each row shows every club's result so far and what it got.
 */
export function TradesListPage({
  list,
  query,
}: {
  list: AflTradeStorySampleList;
  query: TradesListQuery;
}) {
  const { stories, source } = list;
  const clubs = tradesListClubs(stories);
  const years = tradesListYears(stories);
  const shown = filterTrades(stories, query);
  const club = clubs.find(({ slug }) => slug === query.club) ?? null;
  const shownYears = [...new Set(shown.map(({ year }) => year))];
  const grouped = query.sort === 'newest' && shownYears.length > 1;
  const anyProvisional = shown.some((story) =>
    story.results?.some(({ provisional }) => provisional)
  );
  const summary = [
    `${shown.length} trade${shown.length === 1 ? '' : 's'}`,
    query.year === null ? `${years.at(-1)} to ${years[0]}` : String(query.year),
    club?.name ?? 'every club',
  ].join(' · ');

  return (
    <div className="afl-trade-story ts-public min-h-screen">
      <div className="mx-auto w-full max-w-4xl px-4 pt-6 pb-16 sm:px-6">
        <nav aria-label="Breadcrumb" className="mb-3 ts-small text-(--ts-ink2)">
          <Link href="/" className={underline}>
            Home
          </Link>{' '}
          / Trades
        </nav>
        <h1 className="ts-net font-display font-bold text-balance">AFL trades, valued</h1>
        <p className="mt-2 max-w-[65ch] ts-body text-(--ts-ink2)">
          Each trade is valued by what the players and picks went on to do for the club that got
          them. The number beside a club is its result so far, in PAV. {source.label}.{' '}
          <Link href="/afl/trades/method" className={underline}>
            How this works
          </Link>
        </p>

        <section aria-label="Filter the trades" className="mt-6 grid gap-5">
          <div>
            <h2 className="ts-small font-semibold text-(--ts-ink2)">Year</h2>
            <ul className="mt-2 flex flex-wrap gap-2">
              {years.map((year) => (
                <Choice
                  key={year}
                  href={tradesListHref({ ...query, year })}
                  active={query.year === year}
                >
                  {year}
                </Choice>
              ))}
              <Choice href={tradesListHref({ ...query, year: null })} active={query.year === null}>
                All years
              </Choice>
            </ul>
          </div>
          <div>
            <h2 className="ts-small font-semibold text-(--ts-ink2)">Club</h2>
            <ul className="mt-2 flex flex-wrap gap-2">
              <Choice href={tradesListHref({ ...query, club: null })} active={query.club === null}>
                All clubs
              </Choice>
              {clubs.map(({ slug, name }) => (
                <Choice
                  key={slug}
                  href={tradesListHref({ ...query, club: slug })}
                  active={query.club === slug}
                >
                  <ClubBadge clubName={name} named />
                  {name}
                </Choice>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="ts-small font-semibold text-(--ts-ink2)">Order</h2>
            <ul className="mt-2 flex flex-wrap gap-2">
              <Choice
                href={tradesListHref({ ...query, sort: 'newest' })}
                active={query.sort === 'newest'}
              >
                Newest first
              </Choice>
              <Choice
                href={tradesListHref({ ...query, sort: 'biggest' })}
                active={query.sort === 'biggest'}
              >
                Biggest result first
              </Choice>
            </ul>
          </div>
        </section>

        <section aria-labelledby="results-heading" className="mt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="results-heading" className="ts-head font-semibold" aria-live="polite">
              {summary}
            </h2>
            {club ? (
              <Link href={clubChainsHref(club.clubId, 'public')} className={`ts-body ${underline}`}>
                {club.name}’s trade chains
              </Link>
            ) : null}
          </div>

          {shown.length === 0 ? (
            <p className="mt-4 rounded-xl border border-(--ts-line) bg-(--ts-surface) px-4 py-5 ts-body">
              No trades match. {club?.name ?? 'No club'} made no graded trade in {query.year}.{' '}
              <Link href={tradesListHref({ ...query, year: null })} className={underline}>
                Show every year
              </Link>
            </p>
          ) : grouped ? (
            shownYears.map((year) => (
              <div key={year} className="mt-6">
                <h3 className="ts-body font-semibold text-(--ts-ink2)">{year}</h3>
                <ul className="mt-2 divide-y divide-(--ts-line) overflow-hidden rounded-xl border border-(--ts-line) bg-(--ts-surface)">
                  {shown
                    .filter((story) => story.year === year)
                    .map((story) => (
                      <TradeRow key={story.tradeId} story={story} />
                    ))}
                </ul>
              </div>
            ))
          ) : (
            <ul className="mt-4 divide-y divide-(--ts-line) overflow-hidden rounded-xl border border-(--ts-line) bg-(--ts-surface)">
              {shown.map((story) => (
                <TradeRow key={story.tradeId} story={story} />
              ))}
            </ul>
          )}
        </section>

        {anyProvisional ? (
          <p className="mt-8 ts-small text-(--ts-ink2)">
            * A value is not in yet, so this result will change.
          </p>
        ) : null}
      </div>
    </div>
  );
}
