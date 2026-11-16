import type { CSSProperties } from 'react';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import { ClubBadge } from '@/components/aflTradeStory/ClubBadge';
import { clubStyle, formatSigned, tradeStoryHref } from '@/components/aflTradeStory/tradePageModel';
import {
  biggestWins,
  tradeLadder,
  tradesListHref,
  tradeYearSummaries,
  type TradeLadderRow,
} from '@/components/aflTradeStory/tradesListQuery';
import {
  CAMERON_STANDFIRST,
  CAMERON_STORY_PATH,
  CameronTitle,
  STORY_COLLAGE_CLASS,
} from '@/components/aflStories/CameronMasthead';
import { TradeMarketHero } from './TradeMarketHero';
import { CameronTimeline } from '@/components/aflStories/CameronTimeline';
import type { AflTradeStorySampleList } from '@/server/aflTradeIntelligence/development/tradeStorySamples';

/**
 * The home page while the trade pages are live (owner, 2026-11-16: "a home page that draws someone
 * in"). It opens on the owner's paper collage of one trade, the Jeremy Cameron story, which leads to
 * that story and to the trade itself; then the trade ladder, the biggest wins and each season. Real
 * numbers only, club colours only, original sketches, and no player or club imagery.
 */

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';
const lightRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-bar';
const container = 'mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-10';
const sectionTitle = 'font-display text-5xl font-extrabold leading-none sm:text-6xl';
const tone = (net: number) =>
  Number(Math.abs(net).toFixed(1)) === 0
    ? 'text-foreground'
    : net > 0
      ? 'text-result-win'
      : 'text-result-loss';
const kicker = 'font-display text-sm font-semibold tracking-[0.14em]';

/** One club on the trade ladder: a bar from the middle line, right when ahead, left when behind. */
function LadderRow({ row, place, scale }: { row: TradeLadderRow; place: number; scale: number }) {
  const style = clubStyle(row.name);
  const ahead = row.net >= 0;
  const record = (
    <span className="shrink-0 whitespace-nowrap text-xs font-normal text-white/70 tabular-nums">
      {row.ahead}–{row.behind}
      <span className="sr-only">
        : ahead on {row.ahead} trades, behind on {row.behind}
      </span>
    </span>
  );
  return (
    <li className="border-b border-white/15">
      <Link
        href={tradesListHref({ year: null, club: row.slug, sort: 'newest' })}
        className={`grid grid-cols-[1.75rem_auto_minmax(0,1fr)_auto] items-center gap-x-3 py-2 transition hover:bg-white/10 ${lightRing}`}
      >
        <span className="text-right font-display text-xl font-bold text-white/70 tabular-nums">
          {place}
        </span>
        <ClubBadge clubName={row.name} size="md" named />
        <span className="min-w-0">
          <span className="flex items-baseline justify-between gap-2 sm:hidden">
            <span className="truncate font-semibold">{row.name}</span>
            {record}
          </span>
          <span className="relative mt-1.5 block h-5 sm:mt-0 sm:h-9">
            <span
              aria-hidden="true"
              className="absolute inset-y-0 rounded-sm border-2"
              style={{
                width: `${Math.max(0.5, (Math.abs(row.net) / scale) * 50)}%`,
                background: style.fill,
                borderColor: style.trim,
                ...(ahead ? { left: '50%' } : { right: '50%' }),
              }}
            />
            <span aria-hidden="true" className="absolute inset-y-0 left-1/2 w-px bg-white/70" />
            <span
              className={`absolute inset-y-0 hidden items-center gap-2 font-display text-xl font-bold sm:flex ${ahead ? 'right-[calc(50%+0.75rem)]' : 'left-[calc(50%+0.75rem)]'}`}
            >
              {row.name}
              {record}
            </span>
          </span>
        </span>
        <b className="w-[5.5rem] text-right font-display text-3xl font-bold leading-none tabular-nums">
          {formatSigned(row.net)}
          {row.provisional ? '*' : ''}
        </b>
      </Link>
    </li>
  );
}

export function TradesFrontPage({ list }: { list: AflTradeStorySampleList }) {
  const { stories } = list;
  const ladder = tradeLadder(stories);
  const years = tradeYearSummaries(stories);
  const nextWins = biggestWins(stories, 6);
  // The trade the lead story is about: the one that sent Jeremy Cameron to Geelong.
  const received = stories.flatMap((story) =>
    (story.results ?? []).map((result) => ({ story, result }))
  );
  const cameron = received.find(({ result }) =>
    result.received.some((name) => name.includes('Jeremy Cameron'))
  );
  const scale = Math.max(1, ...ladder.map(({ net }) => Math.abs(net)));
  const firstYear = years.at(-1)?.year;
  const top = ladder[0];
  const bottom = ladder.at(-1);
  const anyProvisional = ladder.some(({ provisional }) => provisional);

  return (
    <>
      <section
        aria-labelledby="front-heading"
        className={`mh ${STORY_COLLAGE_CLASS.replace(/^sc /u, '')}`}
      >
        <TradeMarketHero headingId="front-heading" recordHref="#record-deal" />
      </section>

      <section aria-label="The record deal" className={STORY_COLLAGE_CLASS}>
        <div
          className="sc-wrap"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '2.5rem',
            paddingTop: '1rem',
            paddingBottom: '3rem',
          }}
        >
          <div
            id="record-deal"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'flex-end',
              gap: '1.5rem 3rem',
              paddingTop: '2rem',
              scrollMarginTop: '5rem',
            }}
          >
            <div style={{ '--sc-title-size': 'clamp(44px, 4.8vw, 78px)' } as CSSProperties}>
              <CameronTitle as="p" />
            </div>
            <div
              style={{
                flex: '1 1 22rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
                maxWidth: '36rem',
              }}
            >
              <p style={{ fontStyle: 'italic', fontSize: 21, lineHeight: 1.45, color: '#2A2A2A' }}>
                {CAMERON_STANDFIRST}
              </p>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: '1rem 1.5rem',
                }}
              >
                <Link href={CAMERON_STORY_PATH} className="sc-more sc-label">
                  Read the story
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                {cameron ? (
                  <Link
                    href={tradeStoryHref(cameron.story.tradeId, 'public')}
                    className="sc-hand"
                    style={{
                      textDecoration: 'underline',
                      textDecorationThickness: 2,
                      textUnderlineOffset: 4,
                    }}
                  >
                    {cameron.result.clubName} {formatSigned(cameron.result.net)} so far. Read the
                    whole trade
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
          <CameronTimeline base={CAMERON_STORY_PATH} hint="Pick a year to read that chapter ↓" />
          <p
            style={{
              margin: 0,
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.25rem 1.5rem',
              fontSize: 18,
            }}
          >
            <Link href="/afl/trades" className="inline-flex min-h-11 items-center">
              See every trade
            </Link>
            <Link href="/afl/trades/method" className="inline-flex min-h-11 items-center">
              How the numbers work
            </Link>
          </p>
        </div>
      </section>

      <section aria-labelledby="trade-ladder" className="bg-brand-bar text-white">
        <div className={`${container} py-12 lg:py-16`}>
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
            <h2
              id="trade-ladder"
              className="font-display text-6xl font-extrabold leading-[0.9] sm:text-7xl lg:text-8xl"
            >
              The trade ladder
            </h2>
            <p className="max-w-md text-base leading-7 text-white/80">
              Every club’s combined result from every trade since {firstYear}, in PAV. {top?.name}{' '}
              is {formatSigned(top?.net ?? 0)} in front. {bottom?.name} is{' '}
              {formatSigned(bottom?.net ?? 0)}. Pick a club to see its trades.
            </p>
          </div>
          <p
            aria-hidden="true"
            className={`mt-8 grid grid-cols-2 border-b-4 border-white pb-2 pl-[5.75rem] pr-[6.25rem] ${kicker} text-white/80`}
          >
            <span>← Behind</span>
            <span className="text-right">Ahead →</span>
          </p>
          <ol>
            {ladder.map((row, index) => (
              <LadderRow key={row.clubId} row={row} place={index + 1} scale={scale} />
            ))}
          </ol>
          {anyProvisional ? (
            <p className="mt-3 text-xs text-white/70">
              * Includes a trade with a value not in yet, so this total will move.
            </p>
          ) : null}
        </div>
      </section>

      <div className={`${container} grid gap-14 py-12 lg:py-16`}>
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
            <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {nextWins.map((win) => {
                const others = (win.story.results ?? []).filter(
                  (result) => result.clubName !== win.clubName
                );
                const bands = [win.clubName, win.clubName, ...others.map((o) => o.clubName)];
                return (
                  <li key={win.story.tradeId}>
                    <Link
                      href={tradeStoryHref(win.story.tradeId, 'public')}
                      className={`flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card transition hover:bg-muted ${focusRing}`}
                    >
                      <span aria-hidden="true" className="flex h-3">
                        {bands.map((name, index) => (
                          <span
                            key={index}
                            className="flex-1 border-b-2"
                            style={{
                              background: clubStyle(name).fill,
                              borderColor: clubStyle(name).trim,
                            }}
                          />
                        ))}
                      </span>
                      <span className="flex flex-1 flex-col gap-2 px-4 py-4">
                        <span className="flex items-end justify-between gap-3">
                          <span className="truncate font-display text-3xl font-bold leading-none">
                            {win.clubName}
                          </span>
                          <b
                            className={`font-display text-5xl font-extrabold leading-none tabular-nums ${tone(win.net)}`}
                          >
                            {formatSigned(win.net)}
                          </b>
                        </span>
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
          <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {years.map(({ year, trades, biggest }) => {
              const style = biggest ? clubStyle(biggest.clubName) : null;
              return (
                <li key={year} className="last:odd:col-span-2 sm:last:odd:col-span-1">
                  <Link
                    href={tradesListHref({ year, club: null, sort: 'newest' })}
                    className={`flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card transition hover:bg-muted ${focusRing}`}
                  >
                    <span
                      aria-hidden="true"
                      className="h-2.5 border-b-2"
                      style={
                        style ? { background: style.fill, borderColor: style.trim } : undefined
                      }
                    />
                    <span className="flex flex-1 flex-col gap-3 px-3 py-3">
                      <span className="font-display text-5xl font-extrabold leading-none tabular-nums">
                        {year}
                      </span>
                      <span className="text-xs text-muted-foreground">{trades} trades</span>
                      {biggest ? (
                        <span className="mt-auto flex items-center gap-2">
                          <ClubBadge clubName={biggest.clubName} />
                          <b
                            className={`font-display text-xl font-bold tabular-nums ${tone(biggest.net)}`}
                          >
                            {formatSigned(biggest.net)}
                          </b>
                        </span>
                      ) : null}
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
