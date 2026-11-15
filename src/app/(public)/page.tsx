import type { Metadata } from 'next';
import type { ReactElement } from 'react';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

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

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

/** The public home page. Statly is AFL trades for now; the fantasy app is not linked from here. */
export default function HomePage(): ReactElement {
  return (
    <div className="bg-muted text-foreground">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
        <header className="max-w-3xl">
          <h1 className="text-balance font-display text-4xl font-bold leading-tight text-foreground sm:text-5xl">
            AFL trades, valued by what happened next
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
            What each club gave and got, valued by what the players and picks went on to do for the
            club that got them.
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

        <section aria-labelledby="draft-record-heading">
          <h2 id="draft-record-heading" className="font-display text-xl font-bold text-foreground">
            The draft and trade record
          </h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-3">
            {draftRecord.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`block h-full rounded-lg border border-border bg-card px-4 py-4 transition hover:bg-accent ${focusRing}`}
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
