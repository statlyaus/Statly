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
 * that story and, through the record strip under the hero, to the trade itself; then the trade ladder with years to pick, the biggest wins and each season. Real
 * numbers only, club colours only, original sketches, and no player or club imagery.
 */

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';
const container = 'mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-10';
const sectionTitle = 'font-display text-5xl font-extrabold leading-none sm:text-6xl';
export function TradesFrontPage({ list }: { list: AflTradeStorySampleList }) {
  const { stories } = list;
  const ladderYears = tradeLadderByYear(stories);
  const years = tradeYearSummaries(stories);
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
            <ul className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {nextWins.map((win) => {
                const others = (win.story.results ?? []).filter(
                  (result) => result.clubName !== win.clubName
                );
                return (
                  <li key={win.story.tradeId}>
                    <Link
                      href={tradeStoryHref(win.story.tradeId, 'public')}
                      className={`flex h-full flex-col overflow-hidden border border-border bg-card transition hover:bg-muted ${focusRing}`}
                    >
                      <span className="flex flex-1 flex-col gap-2 px-4 py-4">
                        {/* Club over value in every card, however long the club's name. */}
                        <span className="font-display text-2xl font-bold leading-none">
                          {win.clubName}
                        </span>
                        <b className="font-display text-5xl font-extrabold leading-none tabular-nums text-foreground">
                          {formatSigned(win.net)}
                        </b>
                        <span className="text-sm font-semibold text-muted-foreground">
                          over{' '}
                          {others
                            .map((other) => `${other.clubName} ${formatSigned(other.net)}`)
                            .join(', ')}{' '}
                          · {win.story.year}
                        </span>
                        <span className="text-sm leading-6">got {win.received.join(', ')}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="by-season">
          <h2 id="by-season" className={`border-b-4 border-foreground pb-3 ${sectionTitle}`}>
            Season by season
          </h2>
          <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {years.map(({ year, trades, biggest }) => {
              return (
                <li key={year} className="last:odd:col-span-2 sm:last:odd:col-span-1">
                  <Link
                    href={tradesListHref({ year, club: null, sort: 'newest' })}
                    className={`flex h-full flex-col overflow-hidden border border-border bg-card transition hover:bg-muted ${focusRing}`}
                  >
                    <span className="flex flex-1 flex-col gap-3 px-3 py-3">
                      <span className="font-display text-5xl font-extrabold leading-none tabular-nums">
                        {year}
                      </span>
                      <span className="text-xs text-muted-foreground">{trades} trades</span>
                      {biggest ? (
                        <span className="mt-auto flex items-center gap-2">
                          <ClubBadge clubName={biggest.clubName} />
                          <b className="font-display text-xl font-bold tabular-nums text-foreground">
                            {formatSigned(biggest.net)}
                          </b>
                        </span>
                      ) : (
                        <span className="mt-auto text-sm font-semibold text-muted-foreground">
                          Not played yet
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </>
  );
}
