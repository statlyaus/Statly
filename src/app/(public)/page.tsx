import type { Metadata } from 'next';
import type { ReactElement } from 'react';

import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  CalendarClock,
  GitPullRequestArrow,
  LayoutDashboard,
  ListChecks,
  Radio,
  ShieldCheck,
  Trophy,
} from 'lucide-react';

export const metadata: Metadata = {
  title: 'Statly | AFL Draft & Trade Outcomes and Fantasy',
  description:
    'Explore public AFL draft and trade records, follow checked outcome publication status, or manage your Statly fantasy league.',
};

const publicResearchSignals = [
  'Historical trade records',
  'Club histories',
  'Methodology & status',
];

const decisionMoments = [
  {
    icon: Trophy,
    title: 'Draft night',
    description:
      'Build the queue, read category value, track pick timing, and keep the next best player in view.',
  },
  {
    icon: CalendarClock,
    title: 'Selection week',
    description:
      'Bring injury updates, role movement, roster coverage, and lockout pressure into one decision surface.',
  },
  {
    icon: GitPullRequestArrow,
    title: 'Market movement',
    description:
      'Compare waiver claims, trade offers, live scoring swings, and manager behaviour before the window closes.',
  },
];

const leagueModules = [
  {
    icon: Trophy,
    title: 'Draft room',
    description:
      'Run snake drafts with queue, watchlist, live picks, timer context, and Statly Z sorting.',
  },
  {
    icon: ListChecks,
    title: 'Rosters',
    description: 'See starters, bench risk, position coverage, and lineup pressure before lockout.',
  },
  {
    icon: ShieldCheck,
    title: 'Waivers',
    description: 'Review claims, priority, and available player signals before each waiver run.',
  },
  {
    icon: GitPullRequestArrow,
    title: 'Trades',
    description:
      'Compare incoming and outgoing value with context commissioners and managers can trust.',
  },
  {
    icon: Radio,
    title: 'Live scoring',
    description:
      'Follow matchup movement and player score swings without leaving your league workspace.',
  },
  {
    icon: BarChart3,
    title: 'Player research',
    description:
      'Compare role, form, injury context, ownership, rankings, trends, and category value.',
  },
];

const categorySignals = [
  'Goals',
  'Tackles',
  'Inside 50s',
  'Intercepts',
  'Contested marks',
  'Rebound 50s',
  'Contested possessions',
  'Effective disposals',
  'Score involvements',
];

const products = [
  {
    icon: BarChart3,
    title: 'AFL Draft & Trade Outcomes',
    description:
      'Explore the historical AFL trade archive and club movement. Checked numerical outcome releases are not yet published.',
    href: '/draft/trades',
    action: 'Explore trade archive',
    status: 'Historical archive available · numerical outcomes not published',
    secondaryHref: '/draft/outcomes',
    secondaryAction: 'View outcome status',
  },
  {
    icon: LayoutDashboard,
    title: 'Statly Fantasy',
    description: 'Manage your league, team, trades, waivers, lineups, drafts, and live rounds.',
    href: '/dashboard',
    action: 'View Fantasy Workspace',
    status: 'Separate league-management workspace',
    secondaryHref: null,
    secondaryAction: null,
  },
] as const;

export default function HomePage(): ReactElement {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <section className="relative isolate overflow-hidden border-b border-border bg-foreground text-primary-foreground">
        <Image
          src="/Assets/statly-stadium-hero.png?v=20260705b"
          alt=""
          fill
          unoptimized
          sizes="(max-width: 639px) 100vw, 0px"
          className="absolute inset-0 -z-30 scale-110 object-cover object-top blur-md sm:hidden"
        />
        <Image
          src="/Assets/statly-stadium-hero.png?v=20260705b"
          alt=""
          fill
          priority
          unoptimized
          sizes="100vw"
          className="absolute inset-0 -z-20 object-cover object-top max-sm:object-contain"
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-foreground/80 via-foreground/12 to-transparent" />
        <div
          className="pointer-events-none absolute inset-x-0 top-[7vh] z-0 flex justify-center px-6 max-sm:top-[4vh]"
          aria-hidden="true"
        >
          <Image
            src="/brand/statly-hero-logo-overlay.png?v=20260705"
            alt=""
            width={3020}
            height={882}
            priority
            unoptimized
            sizes="(max-width: 639px) 86vw, 46rem"
            className="h-auto w-[min(66vw,46rem)] max-sm:w-[min(86vw,24rem)]"
          />
        </div>

        <div className="relative z-10 mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl flex-col items-center justify-end px-6 pb-8 pt-40 text-center sm:pb-16 sm:pt-16 lg:px-10 lg:pb-20 lg:pt-20">
          <div className="flex flex-col items-center gap-4 sm:gap-7">
            <div className="max-w-3xl space-y-3">
              <h1 className="text-balance text-3xl font-black tracking-tight text-primary-foreground drop-shadow-sm sm:text-5xl">
                Explore AFL draft trades. Run your fantasy league.
              </h1>
              <p className="mx-auto max-w-2xl text-sm leading-6 text-primary-foreground/85 drop-shadow-sm sm:text-base">
                The public AFL archive is separate from Statly Fantasy. Browse historical trades and
                club movement now; checked numerical outcome releases are not yet published.
              </p>
            </div>

            <div className="flex flex-wrap justify-center gap-3">
              <Link
                href="/draft/trades"
                className="inline-flex items-center gap-2 rounded-md bg-primary-foreground px-5 py-3 text-sm font-semibold text-foreground transition hover:bg-primary-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background focus-visible:ring-offset-2 focus-visible:ring-offset-foreground"
              >
                Explore AFL trade archive
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/dashboard"
                className="inline-flex items-center rounded-md border border-primary-foreground/25 bg-foreground/25 px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-foreground/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background focus-visible:ring-offset-2 focus-visible:ring-offset-foreground"
              >
                Open Fantasy Workspace
              </Link>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 text-xs font-semibold text-primary-foreground/85">
              <span className="rounded-full border border-primary-foreground/25 bg-foreground/25 px-3 py-1.5">
                Historical archive available
              </span>
              <span className="rounded-full border border-primary-foreground/25 bg-foreground/25 px-3 py-1.5">
                Numerical outcomes not published
              </span>
              <Link
                href="/draft/outcomes"
                className="inline-flex min-h-11 items-center rounded-md px-3 underline decoration-primary-foreground/50 underline-offset-4 transition hover:decoration-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background focus-visible:ring-offset-2 focus-visible:ring-offset-foreground"
              >
                Outcome publication status
              </Link>
            </div>

            <div
              className="flex max-w-3xl flex-wrap justify-center gap-2 pt-1"
              aria-label="AFL Draft and Trade Outcomes capabilities"
            >
              {publicResearchSignals.map((item) => (
                <span
                  key={item}
                  className="rounded-md border border-primary-foreground/18 bg-foreground/20 px-3 py-1.5 text-xs font-semibold text-primary-foreground/80 backdrop-blur"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-border bg-background">
        <div className="mx-auto max-w-6xl px-6 py-12 lg:px-10 lg:py-16">
          <div className="max-w-3xl space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Statly Products
            </p>
            <h2 className="text-balance text-3xl font-black text-foreground sm:text-4xl">
              Public AFL research and fantasy, clearly separated.
            </h2>
            <p className="text-sm leading-7 text-muted-foreground sm:text-base">
              AFL Draft &amp; Trade Outcomes is public AFL research: its players, picks, and trades
              are not owned by Statly users or fantasy teams. Statly Fantasy remains the separate
              league-management workspace.
            </p>
          </div>

          <div className="mt-8 grid gap-5 md:grid-cols-2">
            {products.map(({ icon: Icon, ...product }) => (
              <article
                key={product.title}
                className="rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="rounded-md bg-muted p-3 text-foreground">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <h3 className="text-2xl font-bold text-foreground">{product.title}</h3>
                </div>
                <p className="mt-4 inline-flex rounded-full border border-border bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                  {product.status}
                </p>
                <p className="mt-4 text-sm leading-6 text-muted-foreground">
                  {product.description}
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link
                    href={product.href}
                    className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-muted px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    {product.action}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                  {product.secondaryHref && product.secondaryAction ? (
                    <Link
                      href={product.secondaryHref}
                      className="inline-flex min-h-11 items-center rounded-md px-4 py-2 text-sm font-semibold text-foreground underline decoration-muted-foreground/50 underline-offset-4 transition hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      {product.secondaryAction}
                    </Link>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-background">
        <div className="mx-auto max-w-6xl px-6 py-12 lg:px-10 lg:py-16">
          <div className="max-w-2xl space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Pressure Points
            </p>
            <h2 className="text-balance text-3xl font-black text-foreground sm:text-4xl">
              Built for the pressure points of an AFL fantasy season.
            </h2>
            <p className="text-sm leading-7 text-muted-foreground sm:text-base">
              Draft night, selection week, and market movement all ask the same question: who has
              the clearest read before everyone else reacts?
            </p>
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {decisionMoments.map(({ icon: Icon, title, description }) => (
              <article
                key={title}
                className="rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="rounded-md bg-muted p-3 text-foreground">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">{title}</h3>
                </div>
                <p className="mt-4 text-sm leading-6 text-muted-foreground">{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="league-workspace" className="bg-muted/35">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 lg:grid-cols-[0.8fr_1.2fr] lg:px-10">
          <div className="space-y-5">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                League Workspace
              </p>
              <h2 className="text-balance text-3xl font-black text-foreground sm:text-4xl">
                Dense where managers need depth, calm where decisions need clarity.
              </h2>
              <p className="text-sm leading-7 text-muted-foreground sm:text-base">
                The current product source of truth points to one coherent league flow: create a
                league, configure scoring, enter the draft room, compare players, and carry that
                same ownership model into rosters and waivers.
              </p>
            </div>

            <div className="rounded-lg border border-border bg-card p-5 text-card-foreground shadow-sm">
              <p className="text-sm font-semibold text-foreground">Real-data category preset</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {categorySignals.map((category) => (
                  <span
                    key={category}
                    className="rounded-md border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
                  >
                    {category}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {leagueModules.map(({ icon: Icon, title, description }) => (
              <article
                key={title}
                className="rounded-lg border border-border bg-card p-5 text-card-foreground shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <div className="rounded-md bg-muted p-2 text-foreground">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-foreground">{title}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
