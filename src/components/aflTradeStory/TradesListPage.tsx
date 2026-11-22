import Link from 'next/link';

import type {
  AflTradeStorySampleList,
  AflTradeStorySampleSummary,
} from '@/server/aflTradeIntelligence/development/tradeStorySamples';

import './tradeStory.css';
import { ClubBadge } from './ClubBadge';
import { TradePreview } from './TradePreview';
import { TradesRail } from './TradesRail';
import { clubChainsHref, formatSigned, type AflTradePageModel } from './tradePageModel';
import {
  filterTrades,
  tradesListClubs,
  tradesListHref,
  tradesListYears,
  type TradesListQuery,
} from './tradesListQuery';
import { rowSides } from './tradesPreviewModel';

const underline = 'underline underline-offset-2';

/**
 * One trade: the lead side (the chosen club, else the club ahead) against the others, the lead's
 * result and what it got. One line per trade, so a two-club margin is never shown twice.
 */
function TradeRow({
  story,
  query,
  selected,
}: {
  story: AflTradeStorySampleSummary;
  query: TradesListQuery;
  selected: boolean;
}) {
  const sides = rowSides(story, query.club);
  return (
    <li>
      <Link
        href={tradesListHref({ ...query, trade: story.tradeId })}
        prefetch={false}
        aria-current={selected ? 'true' : undefined}
        className="group ts-inset-focus grid min-h-11 gap-1 px-4 py-3 hover:bg-muted lg:aria-[current=true]:bg-warning lg:aria-[current=true]:text-warning-foreground"
      >
        {sides === null ? (
          <span className="ts-body font-medium">{story.clubNames.join(' ⇄ ')}</span>
        ) : (
          <>
            <span className="flex items-center gap-2">
              <ClubBadge clubName={sides.lead.clubName} />
              {sides.others.map(({ clubId, clubName }) => (
                <span key={clubId} className="flex items-center gap-2">
                  <span className="ts-small">v</span>
                  <ClubBadge clubName={clubName} />
                </span>
              ))}
              <b className="ml-auto text-right font-semibold tabular-nums">
                {formatSigned(sides.lead.net)}
                {sides.lead.provisional ? '*' : ''}
              </b>
            </span>
            <span className="truncate ts-small text-muted-foreground lg:group-aria-[current=true]:text-foreground">
              {sides.lead.clubName} got{' '}
              {sides.lead.received.length === 0 ? 'nothing' : sides.lead.received.join(', ')}
              {sides.lead.projected ? ', projected' : ''}
            </span>
          </>
        )}
      </Link>
    </li>
  );
}

/**
 * The public list of graded trades (/afl/trades, owner design F6, 2026-11-22): filters, one row per
 * trade, and the chosen trade open beside them. From 1024px the list and preview sit side by side
 * (with the filter rail from 1280px), each scrolling on its own; narrower, the list, or the preview
 * alone once a trade is chosen.
 */
export function TradesListPage({
  list,
  query,
  preview,
}: {
  list: AflTradeStorySampleList;
  query: TradesListQuery;
  preview: AflTradePageModel | null;
}) {
  const { stories, source } = list;
  const years = tradesListYears(stories);
  const shown = filterTrades(stories, query);
  const club = tradesListClubs(stories).find(({ slug }) => slug === query.club) ?? null;
  const selectedId = preview?.story.trade.id ?? null;
  // Narrow screens show the preview alone only when the address names a trade.
  const previewing = query.trade !== null && selectedId === query.trade;
  const heading = [
    club?.name,
    query.year ?? `${years.at(-1)} to ${years[0]}`,
    `${shown.length} trade${shown.length === 1 ? '' : 's'}`,
  ]
    .filter(Boolean)
    .join(' · ');
  const anyProvisional = shown.some((story) =>
    story.results?.some(({ provisional }) => provisional)
  );
  const anyProjected = shown.some((story) => story.results?.some(({ projected }) => projected));

  return (
    <div
      className="afl-trade-story grid min-h-screen lg:h-[calc(100dvh-4rem)] lg:min-h-0 lg:grid-cols-[20rem_minmax(0,1fr)] lg:grid-rows-[auto_minmax(0,1fr)] xl:grid-cols-[14rem_20rem_minmax(0,1fr)] xl:grid-rows-[minmax(0,1fr)]"
      data-surface="paper"
    >
      <div className="lg:col-span-2 xl:col-span-1 xl:flex xl:min-h-0 xl:flex-col">
        <TradesRail stories={stories} query={query} />
      </div>

      <section
        aria-labelledby="results-heading"
        className={`bg-card lg:min-h-0 lg:overflow-y-auto lg:border-r lg:border-border ${previewing ? 'max-lg:hidden' : ''}`}
      >
        <div className="px-4 pt-4 pb-3">
          <h1 className="font-display ts-head font-extrabold tracking-tight">AFL trades, valued</h1>
          <p className="mt-1 ts-small text-muted-foreground">
            Each club’s result so far, in PAV. {source.label}.{' '}
            <Link href="/afl/trades/method" prefetch={false} className={underline}>
              How this works
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 border-y-[1.5px] border-foreground px-4 py-3">
          <h2 id="results-heading" className="font-display ts-body font-extrabold">
            {heading}
          </h2>
          {club ? (
            <Link
              href={clubChainsHref(club.clubId, 'public')}
              prefetch={false}
              className={`ts-small ${underline}`}
            >
              {club.name}’s trade chains
            </Link>
          ) : null}
        </div>
        {shown.length === 0 ? (
          <p className="px-4 py-5 ts-body">
            No trades match. {club?.name ?? 'No club'} made no graded trade in {query.year}.{' '}
            <Link
              href={tradesListHref({ ...query, year: null, trade: null })}
              prefetch={false}
              className={underline}
            >
              Show every year
            </Link>
          </p>
        ) : (
          <ul className="divide-y divide-border border-b border-border">
            {shown.map((story) => (
              <TradeRow
                key={story.tradeId}
                story={story}
                query={query}
                selected={story.tradeId === selectedId}
              />
            ))}
          </ul>
        )}
        {anyProvisional ? (
          <p className="px-4 pt-4 ts-small text-muted-foreground">
            * A value is not in yet, so this result will change.
          </p>
        ) : null}
        {anyProjected ? (
          <p className="px-4 pt-2 pb-4 ts-small text-muted-foreground">
            Projected: no season has been played since the trade, so each player is valued from his
            PAV before it and each pick from its slot.
          </p>
        ) : null}
      </section>

      {preview ? (
        <div
          className={`px-4 py-4 lg:min-h-0 lg:overflow-y-auto lg:px-6 ${previewing ? '' : 'max-lg:hidden'}`}
        >
          {previewing ? (
            <Link
              href={tradesListHref({ ...query, trade: null })}
              prefetch={false}
              className={`mb-3 inline-flex min-h-11 items-center ts-body lg:hidden ${underline}`}
            >
              ← All trades
            </Link>
          ) : null}
          <TradePreview model={preview} stories={stories} query={query} />
        </div>
      ) : null}
    </div>
  );
}
