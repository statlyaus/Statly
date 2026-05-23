import type { Metadata } from 'next';
import type { ReactElement } from 'react';

import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  GitPullRequestArrow,
  LayoutDashboard,
  ListChecks,
  Radio,
  ShieldCheck,
  Users,
} from 'lucide-react';

export const metadata: Metadata = {
  title: 'Statly | AFL Fantasy League Management, Player Data & Live Scoring',
  description:
    'Statly is an AFL fantasy workspace for managing leagues, rosters, trades, waivers, player research, and live scoring from one clean dashboard.',
};

const decisionMoments = [
  {
    icon: ListChecks,
    title: 'Before lockout',
    description: 'Set your lineup with role, injury, form, and matchup context in view.',
  },
  {
    icon: Radio,
    title: 'During the round',
    description: 'Track live matchup swings, player score movement, and the moments that matter.',
  },
  {
    icon: GitPullRequestArrow,
    title: 'After teams and news',
    description: 'Compare waiver and trade options before the next fantasy decision closes.',
  },
];

const leagueModules = [
  {
    icon: ListChecks,
    title: 'Rosters',
    description: 'See starters, bench risk, coverage gaps, and lineup pressure before lockout.',
  },
  {
    icon: ShieldCheck,
    title: 'Waivers',
    description: 'Review claims, priority, and available player signals before the next run.',
  },
  {
    icon: GitPullRequestArrow,
    title: 'Trades',
    description: 'Compare incoming and outgoing value with context managers can act on.',
  },
  {
    icon: Radio,
    title: 'Live scoring',
    description: 'Follow matchup movement and player score swings while the round is active.',
  },
  {
    icon: BarChart3,
    title: 'Player research',
    description: 'Compare role, form, injury context, ownership, rankings, and trends.',
  },
  {
    icon: Users,
    title: 'League activity',
    description: 'Keep roster moves, trade movement, and manager actions visible in one place.',
  },
];

const products = [
  {
    icon: LayoutDashboard,
    title: 'Statly Fantasy',
    description: 'Manage your league, team, trades, waivers, lineups, and live rounds.',
    href: '/dashboard',
    action: 'View Fantasy Workspace',
  },
  {
    icon: BarChart3,
    title: 'Draft & Trade Hub',
    description: 'Research historical AFL trades, draft picks, club movement, and player deals.',
    href: '/draft/trades',
    action: 'Open Trade Hub',
  },
];

const previewRows = [
  { name: 'N. Daicos', role: 'DEF/MID', signal: 'Role up', action: 'Compare' },
  { name: 'M. Bontempelli', role: 'MID', signal: 'Captain tier', action: 'Shortlist' },
  { name: 'E. Gulden', role: 'MID', signal: 'Stable role', action: 'Track live' },
];

export default function HomePage(): ReactElement {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="border-b border-border bg-primary text-primary-foreground">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)] lg:items-end lg:px-10 lg:py-20">
          <div className="max-w-3xl space-y-6">
            <p className="inline-flex items-center rounded-full border border-primary-foreground/25 bg-primary-foreground/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.18em]">
              AFL draft and custom fantasy leagues
            </p>

            <div className="space-y-4">
              <h1 className="max-w-4xl text-balance text-4xl font-black leading-tight sm:text-5xl lg:text-6xl">
                AFL fantasy league management, without the clutter.
              </h1>
              <p className="max-w-2xl text-base leading-8 text-primary-foreground/80 sm:text-lg">
                Run your league, manage your roster, compare players, review trades, submit waiver
                claims, and track live scores from one AFL-first workspace.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 rounded-lg bg-background px-5 py-3 text-sm font-semibold text-foreground transition hover:bg-background/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background focus-visible:ring-offset-2 focus-visible:ring-offset-primary"
              >
                View Fantasy Workspace
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="#player-research-preview"
                className="inline-flex items-center rounded-lg border border-primary-foreground/25 bg-primary-foreground/10 px-5 py-3 text-sm font-medium text-primary-foreground transition hover:bg-primary-foreground/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background focus-visible:ring-offset-2 focus-visible:ring-offset-primary"
              >
                Preview Player Research
              </Link>
            </div>

            <p className="text-sm leading-6 text-primary-foreground/75">
              Built for draft, keeper, and custom AFL fantasy leagues.
            </p>
          </div>

          <aside
            id="player-research-preview"
            className="rounded-lg border border-primary-foreground/20 bg-background/10 p-5 shadow-sm backdrop-blur"
            aria-label="Sample Statly player research panel"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold">Player research preview</p>
                <p className="mt-1 text-xs leading-5 text-primary-foreground/75">
                  Example AFL-first signals managers can compare before lockout.
                </p>
              </div>
              <div className="rounded-md bg-primary-foreground/10 p-2">
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              </div>
            </div>

            <div className="mt-5 overflow-hidden rounded-md border border-primary-foreground/15">
              <div className="grid grid-cols-[1.1fr_0.55fr_0.85fr_0.75fr] bg-foreground/25 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary-foreground/65">
                <span>Player</span>
                <span>Role</span>
                <span>Signal</span>
                <span>Action</span>
              </div>
              {previewRows.map((player) => (
                <div
                  key={player.name}
                  className="grid grid-cols-[1.1fr_0.55fr_0.85fr_0.75fr] border-t border-primary-foreground/15 bg-background/10 px-3 py-3 text-xs sm:text-sm"
                >
                  <span className="font-semibold">{player.name}</span>
                  <span className="text-primary-foreground/75">{player.role}</span>
                  <span className="font-semibold">{player.signal}</span>
                  <span className="text-primary-foreground/75">{player.action}</span>
                </div>
              ))}
            </div>

            <div className="mt-5 grid grid-cols-3 gap-3">
              {[
                { label: 'Waiver options', value: '18' },
                { label: 'Live swing', value: '+24' },
                { label: 'Trade notes', value: '6' },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-md border border-primary-foreground/15 bg-foreground/20 p-3"
                >
                  <p className="text-lg font-black leading-none">{item.value}</p>
                  <p className="mt-2 text-[11px] leading-4 text-primary-foreground/70">
                    {item.label}
                  </p>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </section>

      <section className="bg-background">
        <div className="mx-auto max-w-6xl px-6 py-12 lg:px-10 lg:py-16">
          <div className="max-w-2xl space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Weekly Decisions
            </p>
            <h2 className="text-balance text-3xl font-black text-foreground sm:text-4xl">
              Built for weekly AFL fantasy decisions.
            </h2>
            <p className="text-sm leading-7 text-muted-foreground sm:text-base">
              Move from team news to lineup, live scoring, waiver, and trade decisions without
              losing the league context around each call.
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

      <section className="bg-muted/35">
        <div className="mx-auto max-w-6xl px-6 py-14 lg:px-10">
          <div className="max-w-2xl space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              League Workspace
            </p>
            <h2 className="text-balance text-3xl font-black text-foreground sm:text-4xl">
              Everything your league needs in one place.
            </h2>
            <p className="text-sm leading-7 text-muted-foreground sm:text-base">
              Keep the core fantasy modules close together so managers can see the next action
              instead of hunting through disconnected tools.
            </p>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {leagueModules.map(({ icon: Icon, title, description }) => (
              <div
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
              </div>
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
              Use Statly Fantasy for league management and fantasy gameplay. Use the Draft &amp;
              Trade Hub for public AFL research and historical player movement.
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
                  className="mt-6 inline-flex items-center gap-2 rounded-lg border border-border bg-muted px-4 py-3 text-sm font-semibold text-foreground transition hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
