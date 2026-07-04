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
  title: 'Statly | AFL Fantasy League Management, Player Data & Live Scoring',
  description:
    'Statly is an AFL fantasy workspace for managing leagues, rosters, trades, waivers, player research, and live scoring from one clean dashboard.',
};

const commandMetrics = [
  'Draft rooms',
  'Waiver claims',
  'Trade context',
  'Live scoring',
  'Statly Z',
];

const playerGhosts = [
  {
    src: '/Assets/player-ghost-bontempelli.png',
    className:
      'bottom-[-10%] right-[1%] hidden h-[64%] w-[31%] rotate-[-5deg] opacity-[0.15] md:block',
  },
  {
    src: '/Assets/player-ghost-smith.png',
    className:
      'bottom-[-10%] left-[4%] hidden h-[54%] w-[27%] rotate-[4deg] opacity-[0.12] lg:block',
  },
  {
    src: '/Assets/player-ghost-daicos.png',
    className:
      'bottom-[-8%] right-[30%] hidden h-[52%] w-[23%] rotate-[3deg] opacity-[0.11] xl:block',
  },
  {
    src: '/Assets/player-ghost-butters.png',
    className:
      'bottom-[-15%] left-[28%] hidden h-[64%] w-[28%] rotate-[-2deg] opacity-[0.1] xl:block',
  },
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
    icon: LayoutDashboard,
    title: 'Statly Fantasy',
    description: 'Manage your league, team, trades, waivers, lineups, drafts, and live rounds.',
    href: '/dashboard',
    action: 'View Fantasy Workspace',
  },
  {
    icon: BarChart3,
    title: 'AFL Draft & Trade Archive',
    description: 'Explore public AFL draft picks, historical trades, club movement, and player deals.',
    href: '/draft/trades',
    action: 'Open AFL Archive',
  },
];

export default function HomePage(): ReactElement {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="relative isolate overflow-hidden border-b border-border bg-foreground text-primary-foreground">
        <Image
          src="/Assets/statly-stadium-hero.png"
          alt=""
          fill
          priority
          sizes="100vw"
          className="absolute inset-0 -z-20 object-cover object-center"
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-foreground/88 via-foreground/68 to-foreground/24" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-foreground/88 via-transparent to-primary-foreground/12" />
        <div
          className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
          aria-hidden="true"
        >
          {playerGhosts.map((player) => (
            <Image
              key={player.src}
              src={player.src}
              alt=""
              width={560}
              height={760}
              sizes="32vw"
              className={`${player.className} absolute object-cover object-top grayscale saturate-0 contrast-125 brightness-75 blur-[0.4px] mix-blend-screen [mask-image:radial-gradient(ellipse_at_center,black_32%,transparent_72%)]`}
            />
          ))}
        </div>

        <div className="relative z-10 mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl flex-col items-center px-6 pb-16 pt-16 text-center lg:px-10 lg:pb-20 lg:pt-20">
          <div className="relative flex flex-1 flex-col items-center justify-center">
            <h1 className="relative">
              <span className="sr-only">Statly</span>
              <Image
                src="/brand/statly-primary-logo-hero.svg"
                alt=""
                width={624}
                height={236}
                priority
                className="h-auto w-[min(72vw,34rem)]"
                aria-hidden="true"
              />
            </h1>
          </div>

          <div className="flex translate-y-8 flex-col items-center gap-7 sm:translate-y-10 lg:translate-y-12">
            <div className="flex flex-wrap justify-center gap-3">
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 rounded-md bg-primary-foreground px-5 py-3 text-sm font-semibold text-foreground transition hover:bg-primary-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background focus-visible:ring-offset-2 focus-visible:ring-offset-foreground"
              >
                Open Fantasy Workspace
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/draft/trades"
                className="inline-flex items-center rounded-md border border-primary-foreground/25 bg-foreground/25 px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-foreground/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background focus-visible:ring-offset-2 focus-visible:ring-offset-foreground"
              >
                Explore AFL Archive
              </Link>
            </div>

            <div
              className="flex max-w-3xl flex-wrap justify-center gap-2 pt-1"
              aria-label="Statly fantasy workspace capabilities"
            >
              {commandMetrics.map((item) => (
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

      <section className="border-t border-border bg-background">
        <div className="mx-auto max-w-6xl px-6 py-14 lg:px-10 lg:py-16">
          <div className="max-w-2xl space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Statly Products
            </p>
            <h2 className="text-balance text-3xl font-black text-foreground sm:text-4xl">
              Two workspaces, one AFL-first product family.
            </h2>
            <p className="text-sm leading-7 text-muted-foreground sm:text-base">
              Use Statly Fantasy for league management and fantasy gameplay. Use the AFL Draft
              &amp; Trade Archive for public AFL research and historical player movement.
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
                <p className="mt-4 text-sm leading-6 text-muted-foreground">
                  {product.description}
                </p>
                <Link
                  href={product.href}
                  className="mt-6 inline-flex items-center gap-2 rounded-md border border-border bg-muted px-4 py-3 text-sm font-semibold text-foreground transition hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {product.action}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
