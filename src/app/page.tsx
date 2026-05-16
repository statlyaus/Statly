import type { ReactElement } from 'react';

import Link from 'next/link';

import {
  ArrowRightIcon,
  ChartBarIcon,
  ClockIcon,
  RectangleGroupIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';

const homePillars = [
  {
    icon: RectangleGroupIcon,
    title: 'Structured Fantasy Workspace',
    description:
      'League context, roster actions, and player decisions are grouped so serious users can scan fast.',
  },
  {
    icon: ChartBarIcon,
    title: 'AFL-Specific Depth',
    description:
      'Statly should surface the metrics that matter without turning every screen into noise.',
  },
  {
    icon: ClockIcon,
    title: 'Built For Deadline Pressure',
    description:
      'Live scoring, waivers, and trade review should stay clear when users need to act quickly.',
  },
];

const fantasyWorkflows = [
  {
    eyebrow: 'Roster Management',
    title: 'Know what changed and what to do next',
    description:
      'Keep lineup context, injury impact, and next actions visible without digging through disconnected screens.',
  },
  {
    eyebrow: 'Live Scoring',
    title: 'Check matchups without losing the bigger picture',
    description:
      'Momentum, scoring deltas, and contributors should be glanceable on desktop and mobile.',
  },
  {
    eyebrow: 'Waivers & Trades',
    title: 'Move from analysis to action with less friction',
    description:
      'Review options, assess risk, and complete league actions from interfaces that stay structured under pressure.',
  },
];

const secondaryProduct = [
  {
    title: 'Fantasy AFL',
    description:
      'The primary Statly product: an AFL-first fantasy platform focused on clarity, trust, and fast team decisions.',
    href: '/fantasy',
    action: 'Open Fantasy',
  },
  {
    title: 'Draft & Trade Hub',
    description:
      'A separate public research surface for historical AFL trades, club movement, and draft exploration.',
    href: '/draft/trades',
    action: 'Open Trade Hub',
  },
];

export default function HomePage(): ReactElement {
  return (
    <div className="min-h-[calc(100vh-80px)] bg-[linear-gradient(180deg,#081325_0%,#0b1830_42%,#f5efe4_42%,#f8f3ea_100%)] text-slate-950">
      <section className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(34,211,238,0.16),transparent_34%),radial-gradient(circle_at_82%_16%,rgba(16,185,129,0.14),transparent_26%)]" />
        <div className="relative mx-auto max-w-6xl px-6 py-16 lg:px-10 lg:py-20">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] lg:items-end">
            <div className="max-w-3xl space-y-6">
              <p className="inline-flex items-center rounded-full border border-cyan-300/35 bg-cyan-400/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100">
                Statly
              </p>
              <div className="space-y-4">
                <h1 className="max-w-4xl text-balance text-4xl font-black leading-tight text-white sm:text-5xl lg:text-6xl">
                  AFL fantasy built for faster decisions and higher trust.
                </h1>
                <p className="max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
                  Statly combines structured roster management, AFL-specific statistical depth, and
                  mobile-ready live workflows so fantasy users can understand the moment quickly and
                  act with confidence.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Link
                  href="/fantasy"
                  className="inline-flex items-center gap-2 rounded-xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                >
                  <span suppressHydrationWarning>Open Fantasy</span>
                  <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link
                  href="/players"
                  className="inline-flex items-center rounded-xl border border-white/20 bg-white/5 px-5 py-3 text-sm font-medium text-white transition hover:border-cyan-200/60 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                >
                  <span suppressHydrationWarning>Explore Players</span>
                </Link>
              </div>
            </div>

            <aside className="rounded-[1.75rem] border border-white/10 bg-white/8 p-6 text-white shadow-[0_24px_80px_-44px_rgba(8,19,37,0.8)] backdrop-blur">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-emerald-400/18 p-2 text-emerald-200">
                  <ShieldCheckIcon className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">Product Goal</p>
                  <p className="text-sm text-slate-300">
                    Trusted, high-clarity, AFL-first fantasy management.
                  </p>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                {[
                  'Structured like ESPN where comparison and hierarchy matter',
                  'AFL-smart like SuperCoach without the clutter and visual drag',
                  'Fast on mobile like Yahoo when live scoring and deadlines matter',
                ].map((item) => (
                  <div
                    key={item}
                    className="rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-4"
                  >
                    <p className="text-sm leading-6 text-slate-200">{item}</p>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-12 lg:px-10 lg:py-16">
        <div className="grid gap-4 lg:grid-cols-3">
          {homePillars.map(({ icon: Icon, title, description }) => (
            <article
              key={title}
              className="rounded-[1.5rem] border border-slate-200 bg-white/92 p-6 shadow-[0_20px_55px_-42px_rgba(15,23,42,0.35)]"
            >
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-slate-950 p-3 text-cyan-300">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-600">{description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-14 lg:px-10">
        <div className="max-w-2xl space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Core Fantasy Workflows
          </p>
          <h2 className="text-balance text-3xl font-black text-slate-950 sm:text-4xl">
            The platform should help users act, not just show them data.
          </h2>
          <p className="text-sm leading-7 text-slate-600 sm:text-base">
            Statly’s primary product is fantasy team management. Every core surface should reduce
            time-to-action while preserving trust, density, and clarity.
          </p>
        </div>

        <div className="mt-8 grid gap-5 lg:grid-cols-3">
          {fantasyWorkflows.map((workflow, index) => (
            <article
              key={workflow.title}
              className={`rounded-[1.75rem] border p-6 shadow-[0_24px_65px_-44px_rgba(15,23,42,0.35)] ${
                index === 0
                  ? 'border-slate-950 bg-slate-950 text-white'
                  : 'border-slate-200 bg-white text-slate-950'
              }`}
            >
              <p
                className={`text-xs font-semibold uppercase tracking-[0.18em] ${
                  index === 0 ? 'text-cyan-200' : 'text-slate-500'
                }`}
              >
                {workflow.eyebrow}
              </p>
              <h3 className="mt-3 text-2xl font-bold leading-tight">{workflow.title}</h3>
              <p
                className={`mt-4 text-sm leading-6 ${
                  index === 0 ? 'text-slate-300' : 'text-slate-600'
                }`}
              >
                {workflow.description}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-t border-slate-200/80 bg-white/72">
        <div className="mx-auto max-w-6xl px-6 py-14 lg:px-10 lg:py-16">
          <div className="max-w-2xl space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Statly Products
            </p>
            <h2 className="text-balance text-3xl font-black text-slate-950 sm:text-4xl">
              One primary fantasy platform, plus a public research hub.
            </h2>
            <p className="text-sm leading-7 text-slate-600 sm:text-base">
              The fantasy product is the main experience. The AFL Draft &amp; Trade Hub remains a
              separate public utility for historical trade and draft exploration.
            </p>
          </div>

          <div className="mt-8 grid gap-5 md:grid-cols-2">
            {secondaryProduct.map((product) => (
              <article
                key={product.title}
                className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-[0_22px_60px_-44px_rgba(15,23,42,0.28)]"
              >
                <h3 className="text-2xl font-bold text-slate-950">{product.title}</h3>
                <p className="mt-4 text-sm leading-6 text-slate-600">{product.description}</p>
                <Link
                  href={product.href}
                  className="mt-6 inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900 transition hover:border-slate-950 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
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
