import type { CSSProperties } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import { ClubBadge } from '@/components/aflTradeStory/ClubBadge';
import { formatSigned, tradeStoryHref } from '@/components/aflTradeStory/tradePageModel';
import {
  biggestWins,
  tradeLadderByYear,
  tradesListHref,
  tradeYearSummaries,
} from '@/components/aflTradeStory/tradesListQuery';
import { generalManagerLadder } from '@/components/aflGeneralManagers/generalManagerLadder';
import {
  CAMERON_STANDFIRST,
  CAMERON_STORY_PATH,
  CameronTitle,
  STORY_COLLAGE_CLASS,
} from '@/components/aflStories/CameronMasthead';
import { GeneralManagerBoard } from './GeneralManagerBoard';
import { TradeLadder } from './TradeLadder';
import { RecordBanner } from './RecordBanner';
import { TradeMarketHero } from './TradeMarketHero';
import { CameronTimeline } from '@/components/aflStories/CameronTimeline';
import type { AflTradeStorySampleList } from '@/server/aflTradeIntelligence/development/tradeStorySamples';

/**
 * The home page while the trade pages are live (owner, 2026-11-16: "a home page that draws someone
 * in"). It opens on the owner's paper collage of one trade, the Jeremy Cameron story, which leads to
 * that story and, through the record strip under the hero, to the trade itself; then the trade ladder with years to pick, the biggest wins as a scoreboard and a chart of each
 * season's biggest win. Real
 * numbers only, club colours only, original sketches, and no player or club imagery.
 */

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';
const container = 'mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-10';
const sectionTitle = 'font-display text-5xl font-extrabold leading-none sm:text-6xl';
export function TradesFrontPage({ list }: { list: AflTradeStorySampleList }) {
  const { stories } = list;
  const ladderYears = tradeLadderByYear(stories);
  // Oldest first, so the season chart reads left to right.
  const seasons = tradeYearSummaries(stories).reverse();
  const tallestSeason = Math.max(
    1,
    ...seasons.map(({ biggest, projectedBiggest }) => (biggest ?? projectedBiggest)?.net ?? 0)
  );
  const nextWins = biggestWins(stories, 6);
  const generalManagers = generalManagerLadder(stories);
  // The trade the lead story is about: the one that sent Jeremy Cameron to Geelong.
  const received = stories.flatMap((story) =>
    (story.results ?? []).map((result) => ({ story, result }))
  );
  const cameron = received.find(({ result }) =>
    result.received.some((name) => name.includes('Jeremy Cameron'))
  );

  return (
    <>
      {/* The hero and the record deal are the story collage exception (style guide, "Owner
          decisions"); data-collage keeps them out of the brand conformance check. */}
      <section
        aria-labelledby="front-heading"
        className={`mh ${STORY_COLLAGE_CLASS.replace(/^sc /u, '')}`}
        data-collage
      >
        <TradeMarketHero headingId="front-heading" />
      </section>

      <section aria-label="The record deal" className={STORY_COLLAGE_CLASS} data-collage>
        <div className="sc-wrap flex flex-col gap-12 pt-4 pb-12">
          {cameron ? (
            <RecordBanner
              href={tradeStoryHref(cameron.story.tradeId, 'public')}
              clubName={cameron.result.clubName}
              result={formatSigned(cameron.result.net)}
            />
          ) : null}
          <div
            id="record-deal"
            className="flex scroll-mt-20 flex-wrap items-end gap-x-12 gap-y-6 pt-8"
          >
            <div className="[--sc-title-size:clamp(44px,4.8vw,78px)]">
              <CameronTitle as="p" />
            </div>
            <div className="flex max-w-xl flex-[1_1_22rem] flex-col gap-4">
              <p className="text-xl/[1.45] italic">{CAMERON_STANDFIRST}</p>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
                <Link href={CAMERON_STORY_PATH} className="sc-more sc-label">
                  Read the story
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
            </div>
          </div>
          <CameronTimeline base={CAMERON_STORY_PATH} hint="Pick a year to read that chapter ↓" />
          <p className="flex flex-wrap gap-x-6 gap-y-1 text-lg">
            <Link href="/afl/trades" className="inline-flex min-h-11 items-center">
              See every trade
            </Link>
            <Link href="/afl/trades/method" className="inline-flex min-h-11 items-center">
              How the numbers work
            </Link>
          </p>
        </div>
      </section>

      <div className={`${container} grid grid-cols-[minmax(0,1fr)] gap-14 py-12 lg:py-16`}>
        {ladderYears.length > 0 ? <TradeLadder years={ladderYears} /> : null}
        <GeneralManagerBoard ladder={generalManagers} titleClassName={sectionTitle} />
        {nextWins.length > 0 ? (
          <section aria-labelledby="next-wins">
            <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-2 border-b-4 border-foreground pb-3">
              <h2 id="next-wins" className={sectionTitle}>
                The next biggest wins
              </h2>
              <Link
                href={tradesListHref({ year: null, club: null, sort: 'biggest' })}
                className={`inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4 ${focusRing}`}
              >
                Every trade, biggest result first
              </Link>
            </div>
            {/* A scoreboard (owner, 2026-11-27): rank, club over result, then what the club got. */}
            <ol className="mt-2">
              {nextWins.map((win, index) => {
                const others = (win.story.results ?? []).filter(
                  (result) => result.clubName !== win.clubName
                );
                return (
                  <li key={win.story.tradeId} className="border-b border-border">
                    <Link
                      href={tradeStoryHref(win.story.tradeId, 'public')}
                      className={`grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-x-4 gap-y-3 py-5 transition hover:bg-muted sm:grid-cols-[7rem_minmax(0,1fr)_minmax(0,1.4fr)] sm:gap-x-6 ${focusRing}`}
                    >
                      <span
                        aria-hidden="true"
                        className={`row-span-2 self-start font-display text-7xl font-extrabold leading-[0.8] tabular-nums sm:row-span-1 sm:self-center sm:text-8xl ${
                          index === 0
                            ? 'text-primary'
                            : 'text-transparent [-webkit-text-stroke:2px_var(--foreground)]'
                        }`}
                      >
                        {index + 1}
                      </span>
                      <span className="flex flex-col gap-2">
                        <span className="flex items-center gap-2.5">
                          <ClubBadge clubName={win.clubName} named />
                          <span className="font-display text-2xl font-bold leading-none">
                            {win.clubName}
                          </span>
                        </span>
                        <b className="font-display text-5xl font-extrabold leading-none tabular-nums text-foreground sm:text-6xl">
                          {formatSigned(win.net)}
                        </b>
                      </span>
                      <span className="col-start-2 text-base leading-relaxed sm:col-start-3">
                        <span className="block text-sm text-muted-foreground">
                          {win.story.year} · over{' '}
                          {others
                            .map((other) => `${other.clubName} ${formatSigned(other.net)}`)
                            .join(', ')}
                        </span>
                        got {win.received.join(', ')}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </section>
        ) : null}

        <section aria-labelledby="by-season">
          <h2 id="by-season" className={`border-b-4 border-foreground pb-3 ${sectionTitle}`}>
            Season by season
          </h2>
          {/* One chart of each year's biggest win, oldest first (owner, 2026-11-27): columns from
              sm up, bars on phones. A year with no season played since draws its biggest
              projected win dashed, the style guide's "not there yet". */}
          <ol className="mt-6 grid gap-4 sm:mt-10 sm:grid-cols-8 sm:gap-0">
            {seasons.map(({ year, trades, biggest, projectedBiggest }) => {
              const win = biggest ?? projectedBiggest;
              const share = win === null ? 0 : Math.max(win.net, 0) / tallestSeason;
              return (
                <li key={year}>
                  <Link
                    href={tradesListHref({ year, club: null, sort: 'newest' })}
                    style={{ '--share': share } as CSSProperties}
                    className={`grid h-full grid-cols-[5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 transition hover:bg-muted sm:flex sm:flex-col sm:justify-end sm:gap-0 ${focusRing}`}
                  >
                    <span className="col-start-1 row-span-2 row-start-1 sm:order-last sm:w-full sm:border-t-4 sm:border-foreground sm:px-1.5 sm:pt-2.5">
                      <span className="block font-display text-3xl font-extrabold leading-none tabular-nums">
                        {year}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {trades} trades
                      </span>
                    </span>
                    {win === null ? (
                      <span className="col-start-2 row-start-1 text-sm text-muted-foreground sm:px-1.5 sm:pb-2">
                        No result yet
                      </span>
                    ) : (
                      <span className="col-start-2 row-start-1 flex flex-wrap items-center gap-x-2 sm:w-full sm:flex-col sm:items-start sm:gap-1 sm:px-1.5 sm:pb-2">
                        {biggest === null ? (
                          <span className="font-hand text-xl leading-none text-primary">
                            projected
                          </span>
                        ) : null}
                        <ClubBadge clubName={win.clubName} />
                        <b className="font-display text-xl font-extrabold leading-none tabular-nums text-foreground">
                          {formatSigned(win.net)}
                        </b>
                      </span>
                    )}
                    <span
                      aria-hidden="true"
                      className={`col-start-2 row-start-2 block h-3 w-[calc(var(--share)*100%)] sm:mx-1.5 sm:h-[calc(var(--share)*14rem)] sm:w-auto sm:self-stretch ${
                        biggest === null
                          ? 'border-2 border-dashed border-primary sm:border-b-0'
                          : 'bg-primary'
                      }`}
                    />
                  </Link>
                </li>
              );
            })}
          </ol>
          <p className="mt-4 text-sm text-muted-foreground">
            Each bar is that year&rsquo;s biggest single win. A dashed bar is a projection: no
            season has been played since those trades.
          </p>
        </section>
      </div>
    </>
  );
}
