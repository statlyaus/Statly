import type { Metadata } from 'next';
import type { ReactElement } from 'react';

import Link from 'next/link';

import {
  Activity as ActivityIcon,
  ArrowRight as ArrowRightIcon,
  BarChart3 as ChartBarIcon,
  ClipboardList as DraftBoardIcon,
  GitPullRequestArrow as TradeIcon,
  ListChecks as RosterIcon,
  Radio as LiveIcon,
  Repeat2 as WaiverIcon,
  ShieldCheck as CategoryIcon,
  Users as LeagueIcon,
} from 'lucide-react';

export const metadata: Metadata = {
  title: 'Statly | AFL Fantasy Draft, Trades, Waivers & Category Matchups',
  description:
    'Statly is an AFL fantasy workspace for drafting players, managing rosters, reviewing trades and waivers, and tracking configurable category matchups.',
};

const selectedCategories = [
  'Goals',
  'Tackles',
  'Inside 50s',
  'Intercepts',
  'Rebound 50s',
  'Score Involvements',
];

const categoryRows = [
  { category: 'Goals', you: 8, opp: 6, edge: '+2' },
  { category: 'Tackles', you: 51, opp: 58, edge: '-7' },
  { category: 'Inside 50s', you: 43, opp: 39, edge: '+4' },
  { category: 'Rebound 50s', you: 31, opp: 31, edge: 'Tie' },
];

const draftedPlayerRows = [
  {
    name: 'N. Daicos',
    aflClub: 'Collingwood',
    eligiblePosition: 'DEF/MID',
    signal: 'Inside 50s edge',
  },
  {
    name: 'M. Bontempelli',
    aflClub: 'Western Bulldogs',
    eligiblePosition: 'MID',
    signal: 'Contested profile',
  },
  {
    name: 'E. Gulden',
    aflClub: 'Sydney',
    eligiblePosition: 'MID',
    signal: 'Score involvement lift',
  },
];

const workflowMoments = [
  {
    icon: DraftBoardIcon,
    title: 'Draft night',
    description:
      'Build a queue around selected categories, roster shape, eligible positions, and live pick context.',
  },
  {
    icon: LiveIcon,
    title: 'League season round',
    description:
      'Track category leads, tied categories, and the roster moves that can still change the matchup.',
  },
  {
    icon: TradeIcon,
    title: 'Trade review',
    description:
      'Compare category impact before accepting a player movement that changes your fantasy roster.',
  },
  {
    icon: WaiverIcon,
    title: 'Waiver run',
    description:
      'Shortlist available players by category fit, fantasy roster need, and the next waiver deadline.',
  },
];

const productModules = [
  {
    icon: DraftBoardIcon,
    title: 'Draft boards',
    description:
      'Rank drafted-player targets by category need, AFL club context, and queue urgency.',
  },
  {
    icon: CategoryIcon,
    title: 'Category matchups',
    description:
      'See categories won, lost, and tied instead of reducing a round to one generic total.',
  },
  {
    icon: TradeIcon,
    title: 'Trade review',
    description:
      'Understand which selected categories improve or weaken before a trade is accepted.',
  },
  {
    icon: WaiverIcon,
    title: 'Waiver claims',
    description:
      'Review claim fit against roster balance and the categories your league actually plays.',
  },
  {
    icon: RosterIcon,
    title: 'Roster balance',
    description: 'Keep eligible positions, drafted depth, and category pressure visible together.',
  },
  {
    icon: LeagueIcon,
    title: 'League activity',
    description: 'Follow draft picks, trade movement, waiver outcomes, and commissioner context.',
  },
];

export default function HomePage(): ReactElement {
  return (
    <div className="min-h-[calc(100vh-80px)] bg-background text-foreground">
      <section className="border-b border-primary-foreground/10 bg-[linear-gradient(135deg,var(--league-text)_0%,var(--league-primary)_58%,var(--league-success)_100%)] text-primary-foreground">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-10 lg:py-16">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,0.92fr)_minmax(520px,1.08fr)] lg:items-center">
            <div className="space-y-6">
              <div className="space-y-4">
                <h1 className="max-w-4xl text-balance text-4xl font-black leading-tight text-primary-foreground sm:text-5xl lg:text-6xl">
                  AFL fantasy command center
                </h1>
                <p className="max-w-2xl text-base leading-8 text-primary-foreground/80 sm:text-lg">
                  Draft, trade, and manage your roster around the categories your league actually
                  plays.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Link
                  href="/fantasy"
                  className="inline-flex items-center gap-2 rounded-lg bg-info px-5 py-3 text-sm font-semibold text-info-foreground transition hover:bg-info/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <span suppressHydrationWarning>Open Fantasy Workspace</span>
                  <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link
                  href="#category-matchups"
                  className="inline-flex items-center rounded-lg border border-primary-foreground/20 bg-primary-foreground/5 px-5 py-3 text-sm font-medium text-primary-foreground transition hover:bg-primary-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <span suppressHydrationWarning>Preview Category Matchups</span>
                </Link>
              </div>

              <div className="grid gap-2 pt-2 sm:grid-cols-3">
                {[
                  { label: 'Selected categories', value: '9' },
                  { label: 'Roster moves tracked', value: 'Drafts / Trades / Waivers' },
                  { label: 'Round focus', value: 'Category edge' },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-lg border border-primary-foreground/15 bg-primary-foreground/10 p-3"
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary-foreground/60">
                      {item.label}
                    </p>
                    <p className="mt-2 text-sm font-semibold text-primary-foreground">
                      {item.value}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <aside
              id="category-matchups"
              className="rounded-xl border border-primary-foreground/15 bg-primary-foreground/10 p-4 shadow-sm backdrop-blur"
              aria-label="Sample Statly category matchup and roster analysis panel"
            >
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-primary-foreground/10 pb-4">
                <div>
                  <p className="text-sm font-semibold text-primary-foreground">
                    League season round command
                  </p>
                  <p className="mt-1 text-xs leading-5 text-primary-foreground/65">
                    Example view showing category matchup state, drafted players, and next roster
                    action.
                  </p>
                </div>
                <span className="rounded-full border border-success/30 bg-success/15 px-3 py-1 text-xs font-semibold text-primary-foreground">
                  Live category matchup
                </span>
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
                <div className="space-y-4">
                  <div className="rounded-lg border border-primary-foreground/10 bg-background/95 p-3 text-foreground">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          Category matchup
                        </p>
                        <p className="mt-1 text-sm font-semibold">R12: 3 categories up, 1 tied</p>
                      </div>
                      <ActivityIcon className="h-5 w-5 text-success" aria-hidden="true" />
                    </div>
                    <div className="mt-3 grid gap-2">
                      {categoryRows.map((row) => (
                        <div
                          key={row.category}
                          className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-md bg-muted px-3 py-2 text-xs"
                        >
                          <span className="font-medium text-foreground">{row.category}</span>
                          <span className="text-muted-foreground">
                            {row.you} - {row.opp}
                          </span>
                          <span className="font-semibold text-foreground">{row.edge}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-lg border border-primary-foreground/10 bg-background/95 text-foreground">
                    <div className="grid grid-cols-[1fr_0.85fr_0.8fr_1fr] bg-muted px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      <span>Drafted player</span>
                      <span>AFL club</span>
                      <span>Eligible</span>
                      <span>Category signal</span>
                    </div>
                    {draftedPlayerRows.map((player) => (
                      <div
                        key={player.name}
                        className="grid grid-cols-[1fr_0.85fr_0.8fr_1fr] border-t border-border px-3 py-3 text-xs"
                      >
                        <span className="font-semibold text-foreground">{player.name}</span>
                        <span className="text-muted-foreground">{player.aflClub}</span>
                        <span className="text-muted-foreground">{player.eligiblePosition}</span>
                        <span className="font-medium text-foreground">{player.signal}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-3">
                  {[
                    { label: 'Roster category balance', value: 'Needs tackles' },
                    { label: 'Trade impact', value: '+Inside 50s' },
                    { label: 'Next waiver run', value: 'Tue 7:30 PM' },
                    { label: 'Activity ticker', value: '2 trade reviews' },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="rounded-lg border border-primary-foreground/10 bg-background/95 p-3 text-foreground"
                    >
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        {item.label}
                      </p>
                      <p className="mt-2 text-sm font-semibold">{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        </div>
      </section>

      <section className="bg-background">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-10 lg:py-16">
          <div className="max-w-3xl space-y-3">
            <h2 className="text-balance text-3xl font-black text-foreground sm:text-4xl">
              One weekly loop: draft context, category matchup, roster movement.
            </h2>
            <p className="text-sm leading-7 text-muted-foreground sm:text-base">
              Statly keeps the important AFL fantasy decisions close together so managers can move
              from selected categories to drafted-player decisions without losing league context.
            </p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {workflowMoments.map(({ icon: Icon, title, description }) => (
              <article
                key={title}
                className="rounded-lg border border-border bg-card p-5 text-card-foreground shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="rounded-md bg-muted p-2 text-foreground">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <h3 className="text-base font-semibold text-foreground">{title}</h3>
                </div>
                <p className="mt-4 text-sm leading-6 text-muted-foreground">{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-muted/35">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-10">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-start">
            <div className="space-y-4">
              <h2 className="text-balance text-3xl font-black text-foreground sm:text-4xl">
                Built around the categories your league selects.
              </h2>
              <p className="text-sm leading-7 text-muted-foreground sm:text-base">
                Keep the category set visible across draft rooms, matchup views, trades, waivers,
                and player research.
              </p>
              <div className="flex flex-wrap gap-2">
                {selectedCategories.map((category) => (
                  <span
                    key={category}
                    className="rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold text-foreground"
                  >
                    {category}
                  </span>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {productModules.map(({ icon: Icon, title, description }) => (
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
        </div>
      </section>

      <section className="border-t border-border bg-background">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-10 lg:py-16">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.45fr)] lg:items-center">
            <div className="space-y-3">
              <h2 className="text-balance text-3xl font-black text-foreground sm:text-4xl">
                AFL-first tools for private fantasy leagues and public draft research.
              </h2>
              <p className="text-sm leading-7 text-muted-foreground sm:text-base">
                Use Statly Fantasy for drafted rosters, category matchups, trades, and waivers. Use
                the Draft &amp; Trade Hub for public AFL draft and player movement research.
              </p>
            </div>

            <div className="grid gap-3">
              {[
                {
                  icon: ChartBarIcon,
                  title: 'Statly Fantasy',
                  description: 'Drafted rosters, category matchups, trades, and waivers.',
                  href: '/fantasy',
                  action: 'Open Fantasy Workspace',
                },
                {
                  icon: TradeIcon,
                  title: 'Draft & Trade Hub',
                  description: 'Historical AFL draft picks, club movement, and trade research.',
                  href: '/draft/trades',
                  action: 'Open Trade Hub',
                },
              ].map(({ icon: Icon, ...product }) => (
                <Link
                  key={product.title}
                  href={product.href}
                  className="group rounded-lg border border-border bg-card p-5 text-card-foreground shadow-sm transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="rounded-md bg-muted p-2 text-foreground">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-foreground">{product.title}</h3>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">
                          {product.description}
                        </p>
                        <p className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                          <span suppressHydrationWarning>{product.action}</span>
                          <ArrowRightIcon
                            className="h-4 w-4 transition group-hover:translate-x-0.5"
                            aria-hidden="true"
                          />
                        </p>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
