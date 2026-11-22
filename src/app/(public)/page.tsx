import type { Metadata } from 'next';
import type { ReactElement } from 'react';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import { StatlyWordmark } from '@/components/brand/StatlyWordmark';
import { TradesFrontPage } from '@/components/aflTradesHome/TradesFrontPage';
import { publicTradeStoryReads } from '@/server/aflTradeIntelligence/publication/publicTradeStoryReads';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Statly | AFL trades, valued',
  description:
    'Every AFL trade Statly has graded: what each club gave and got, valued by what the players and picks went on to do.',
};

const draftRecord = [
  {
    href: '/draft/trades',
    title: 'Trade archive',
    description: 'Historical trades and what moved between clubs.',
  },
  {
    href: '/draft/drafts',
    title: 'Draft history',
    description: 'Every draft class, pick by pick.',
  },
  {
    href: '/draft/clubs',
    title: 'Club histories',
    description: 'Each club’s trades and selections over time.',
  },
] as const;

/**
 * The brand masthead, copied from the approved design system (`ds2/a-core.html`, owner 2026-11-21):
 * a cobalt band with the giant wordmark, the sun, the promise and the hand note. The sun disc is a
 * drawing, so it sits in `data-illustration` and may be round.
 */
function Masthead() {
  return (
    <section
      aria-label="Statly"
      data-illustration
      className="ground-cobalt relative overflow-hidden px-4 sm:px-6 lg:px-10"
    >
      <span
        aria-hidden="true"
        className="absolute right-[6%] top-[16%] aspect-square w-[clamp(70px,12vw,150px)] rounded-full bg-warning"
      />
      <div className="relative mx-auto grid max-w-6xl gap-4 py-8">
        <p className="m-0 justify-self-start pt-[0.3em] pb-[0.2em]">
          <StatlyWordmark size="mast" />
        </p>
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <p className="m-0 max-w-[56ch] font-sans text-base leading-normal">
            Every AFL trade, valued by what the players and picks went on to do for the club that
            got them.
          </p>
          <p className="m-0 font-hand text-[clamp(1.8rem,4vw,2.6rem)] font-bold leading-none text-warning">
            counted to the last kick.
          </p>
        </div>
      </div>
    </section>
  );
}

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

/**
 * The public home page. Statly is AFL trades for now; the fantasy app is not linked from here. While
 * the trade pages are being served it is their front page: the trade ladder, the biggest win and each
 * season. Otherwise it is a plain heading and the links that still work.
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
      {trades.available ? <TradesFrontPage list={trades.value} /> : null}
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
        {trades.available ? null : (
          <header className="max-w-3xl">
            <h1 className="text-balance font-display text-4xl font-bold leading-tight text-foreground sm:text-5xl">
              AFL trades, valued by what happened next
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
              What each club gave and got, valued by what the players and picks went on to do for
              the club that got them.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1">
              <Link
                href="/afl/trades"
                className={`inline-flex min-h-11 items-center gap-2 rounded-md bg-brand-bar px-4 text-sm font-semibold text-brand-bar-foreground transition hover:bg-brand-bar/90 ${focusRing}`}
              >
                See every trade
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/afl/trades/method"
                className={`inline-flex min-h-11 items-center rounded-md text-sm font-semibold text-foreground underline decoration-muted-foreground/50 underline-offset-4 transition hover:decoration-foreground ${focusRing}`}
              >
                How this works
              </Link>
            </div>
          </header>
        )}

        <section aria-labelledby="draft-record-heading">
          <h2 id="draft-record-heading" className="font-display text-xl font-bold text-foreground">
            The draft and trade record
          </h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-3">
            {draftRecord.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`block h-full border border-border bg-card px-4 py-4 transition hover:bg-accent ${focusRing}`}
                >
                  <span className="font-semibold text-foreground">{item.title}</span>
                  <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                    {item.description}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
