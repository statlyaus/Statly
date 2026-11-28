import type { Metadata } from 'next';
import type { ReactElement } from 'react';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import { StatlyWordmark } from '@/components/brand/StatlyWordmark';
import { TradesFrontPage } from '@/components/aflTradesHome/TradesFrontPage';
import { buttonStyles } from '@/components/ui/controlStyles';
import { publicTradeStoryReads } from '@/server/aflTradeIntelligence/publication/publicTradeStoryReads';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Statly | AFL trades, valued',
  description:
    'Every AFL trade Statly has graded: what each club gave and got, valued by what the players and picks went on to do.',
};

// "The draft and trade record" section (Trade archive, Draft history, Club histories under /draft) is
// hidden while no reviewed factual release is active: those pages are empty. It returns when one is
// published (runbook, "Publishing the draft record").

/**
 * The brand masthead: a cobalt band with the giant wordmark and the promise. Adapted from the design
 * system (`ds2/a-core.html`, owner 2026-11-21); the owner dropped its sun disc and hand note on
 * 2026-11-27 (abstract, no job to do). The wordmark keeps a bottom margin in its own em so the y's
 * descender clears the promise at every width. Behind them sits the MCG scene the owner chose on
 * 2026-11-27 (`public/brand/masthead-mcg.svg`): faint sun-yellow outlines of the ground, the city
 * and the suburb roofline that runs behind the letters. It is a drawing, so it sits in
 * `data-illustration`, cropped from the bottom centre. On phones the whole scene would sit under the
 * promise, so they show its right end (the city and the MCG) behind the wordmark alone (owner,
 * 2026-11-27).
 */
function Masthead() {
  return (
    <section
      aria-label="Statly"
      data-illustration
      className="ground-cobalt relative overflow-hidden px-4 sm:px-6 lg:px-10"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a decorative SVG cropped by CSS */}
      <img
        src="/brand/masthead-mcg.svg"
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 hidden h-full w-full object-cover object-bottom sm:block"
      />
      <div className="relative mx-auto grid max-w-6xl gap-4 py-8">
        {/* Phones get the scene's right end (the city and the MCG) behind the wordmark only, so
            the promise below stays on plain cobalt. */}
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element -- a decorative SVG cropped by CSS */}
          <img
            src="/brand/masthead-mcg.svg"
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute -top-8 bottom-0 -right-4 -left-4 h-[calc(100%+2rem)] w-[calc(100%+2rem)] max-w-none object-cover object-right-bottom sm:hidden"
          />
          <p className="relative m-0 justify-self-start pt-[0.3em]">
            <StatlyWordmark size="mast" className="mb-[0.12em]" />
          </p>
        </div>
        <p className="m-0 max-w-[56ch] font-sans text-base leading-normal">
          Every AFL trade, valued by what the players and picks went on to do for the club that got
          them.
        </p>
      </div>
    </section>
  );
}

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

/**
 * The public home page. Statly is AFL trades for now; the fantasy app is not linked from here. While
 * the trade pages are being served it is their front page: the trade ladder, the biggest win and each
 * season. Otherwise it is a plain heading and the links to the trade pages.
 */
export default async function HomePage(): Promise<ReactElement> {
  const trades = await publicTradeStoryReads.listStories();
  return (
    // The paper surface (style guide, "Grounds") changes only the page and quiet panels; the hero
    // and record deal paint their own story collage grounds over it.
    <div
      className={trades.available ? 'bg-background text-foreground' : 'bg-muted text-foreground'}
      data-surface={trades.available ? 'paper' : undefined}
    >
      <Masthead />
      {trades.available ? (
        <TradesFrontPage list={trades.value} />
      ) : (
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
          <header className="max-w-3xl">
            <h1 className="text-balance font-display text-4xl font-bold leading-tight text-foreground sm:text-5xl">
              AFL trades, valued by what happened next
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
              What each club gave and got, valued by what the players and picks went on to do for
              the club that got them.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1">
              <Link href="/afl/trades" className={buttonStyles({ variant: 'primary' })}>
                See every trade
                <ArrowRight className="size-5" aria-hidden="true" />
              </Link>
              <Link
                href="/afl/trades/method"
                className={`inline-flex min-h-11 items-center rounded-cut text-sm font-semibold text-foreground underline decoration-muted-foreground/50 underline-offset-4 transition hover:decoration-foreground ${focusRing}`}
              >
                How this works
              </Link>
            </div>
          </header>
        </div>
      )}
    </div>
  );
}
