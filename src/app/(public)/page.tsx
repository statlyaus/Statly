import type { Metadata } from 'next';
import type { ReactElement } from 'react';

import Link from 'next/link';

import {
  ArrowRight as ArrowRightIcon,
  BarChart3 as ChartBarIcon,
  GitPullRequestArrow as TradeIcon,
  LayoutDashboard as RectangleGroupIcon,
  ListChecks as LineupIcon,
  Radio as LiveIcon,
  ShieldCheck as ShieldCheckIcon,
  Users as UsersIcon,
} from 'lucide-react';

export const metadata: Metadata = {
  title: 'Statly | AFL Fantasy League Management, Player Data & Live Scoring',
  description:
    'Statly is an AFL fantasy workspace for managing leagues, rosters, trades, waivers, player research, and live scoring from one clean dashboard.',
};

const decisionMoments = [
  {
    icon: LineupIcon,
    title: 'Before lockout',
    description: 'Set your lineup with role, injury, form, and matchup context in view.',
  },
  {
    icon: LiveIcon,
    title: 'During the round',
    description: 'Track live matchup swings, player score movement, and the moments that matter.',
  },
  {
    icon: TradeIcon,
    title: 'After teams and news',
    description: 'Compare waiver and trade options before the next fantasy decision closes.',
  },
];

const leagueModules = [
  {
    icon: LineupIcon,
    title: 'Rosters',
    description: 'See starters, bench risk, coverage gaps, and lineup pressure before lockout.',
  },
  {
    icon: ShieldCheckIcon,
    title: 'Waivers',
    description: 'Review claims, priority, and available player signals before the next run.',
  },
  {
    icon: TradeIcon,
    title: 'Trades',
    description: 'Compare incoming and outgoing value with context managers can act on.',
  },
  {
    icon: LiveIcon,
    title: 'Live scoring',
    description: 'Follow matchup movement and player score swings while the round is active.',
  },
  {
    icon: ChartBarIcon,
    title: 'Player research',
    description: 'Compare role, form, injury context, ownership, rankings, and trends.',
  },
  {
    icon: UsersIcon,
    title: 'League activity',
    description: 'Keep roster moves, trade movement, and manager actions visible in one place.',
  },
];

const secondaryProduct = [
  {
    icon: RectangleGroupIcon,
    title: 'Statly Fantasy',
    description: 'Manage your league, team, trades, waivers, lineups, and live rounds.',
    href: '/fantasy',
    action: 'View Fantasy Workspace',
  },
  {
    icon: ChartBarIcon,
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
    <div className="min-h-[calc(100vh-80px)] bg-background text-foreground">
      <section className="border-b border-white/10 bg-[linear-gradient(135deg,var(--league-primary)_0%,var(--league-text)_100%)]">
        <div className="mx-auto max-w-6xl px-6 py-16 lg:px-10 lg:py-20">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)] lg:items-end">
            <div className="max-w-3xl space-y-6">
              <p className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white">
                AFL draft and custom fantasy leagues
              </p>
              <div className="space-y-4">
                <h1 className="max-w-4xl text-balance text-4xl font-black leading-tight text-white sm:text-5xl lg:text-6xl">
                  AFL fantasy league management, without the clutter.
                </h1>
                <p className="max-w-2xl text-base leading-8 text-white/80 sm:text-lg">
                  Run your league, manage your roster, compare players, review trades, submit
                  waiver claims, and track live scores from one AFL-first workspace.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Link
                  href="/fantasy"
                  className="inline-flex items-center gap-2 rounded-xl bg-info px-5 py-3 text-sm font-semibold text-white transition hover:bg-info/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                >
                  <span suppressHydrationWarning>View Fantasy Workspace</span>
                  <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link
                  href="#player-research-preview"
                  className="inline-flex items-center rounded-xl border border-white/20 bg-white/5 px-5 py-3 text-sm font-medium text-white transition hover:border-info/20 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                >
                  <span suppressHydrationWarning>Preview Player Research</span>
                </Link>
              </div>

              <p className="text-sm leading-6 text-white/70">
                Built for draft, keeper, and custom AFL fantasy leagues.
              </p>
            </div>

            <aside
              id="player-research-preview"
              className="rounded-lg border border-white/15 bg-white/10 p-5 text-white shadow-sm backdrop-blur"
              aria-label="Sample Statly player research panel"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-white">Player research preview</p>
                  <p className="mt-1 text-xs leading-5 text-white/70">
                    Example data showing the kind of AFL-first signals managers can compare.
                  </p>
                </div>
                <div className="rounded-md bg-success/20 p-2 text-white">
                  <ShieldCheckIcon className="h-5 w-5" aria-hidden="true" />
                </div>
              </div>

              <div className="mt-5 overflow-hidden rounded-md border border-white/10">
                <div className="grid grid-cols-[1.1fr_0.55fr_0.85fr_0.75fr] bg-black/25 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/55">
                  <span>Player</span>
                  <span>Role</span>
                  <span>Signal</span>
                  <span>Action</span>
                </div>
                {previewRows.map((player) => (
                  <div
                    key={player.name}
                    className="grid grid-cols-[1.1fr_0.55fr_0.85fr_0.75fr] border-t border-white/10 bg-white/5 px-3 py-3 text-xs sm:text-sm"
                  >
                    <span className="font-semibold text-white">{player.name}</span>
                    <span className="text-white/70">{player.role}</span>
                    <span className="font-semibold text-white">{player.signal}</span>
                    <span className="text-white/70">{player.action}</span>
                  </div>
                ))}
              </div>

              <div className="mt-5 grid grid-cols-3 gap-3">
                {[
                  { label: 'Waiver options', value: '18' },
                  { label: 'Live swing', value: '+24' },
                  { label: 'Trade notes', value: '6' },
                ].map((item) => (
                  <div key={item.label} className="rounded-md border border-white/10 bg-black/25 p-3">
                    <p className="text-lg font-black leading-none text-white">{item.value}</p>
                    <p className="mt-2 text-[11px] leading-4 text-white/65">{item.label}</p>
                  </div>
                ))}
              </div>
            </aside>
          </div>
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

          <div className="grid gap-4 lg:grid-cols-3">
            {decisionMoments.map(({ icon: Icon, title, description }) => (
              <article
                key={title}
                className="mt-8 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="rounded-md bg-foreground p-3 text-info">
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
            {secondaryProduct.map(({ icon: Icon, ...product }) => (
              <article
                key={product.title}
                className="rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="rounded-md bg-foreground p-3 text-info">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <h3 className="text-2xl font-bold text-foreground">{product.title}</h3>
                </div>
                <p className="mt-4 text-sm leading-6 text-muted-foreground">
                  {product.description}
                </p>
                <Link
                  href={product.href}
                  className="mt-6 inline-flex items-center gap-2 rounded-xl border border-border bg-muted px-4 py-3 text-sm font-semibold text-foreground transition hover:border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <span suppressHydrationWarning>{product.action}</span>
                  <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
