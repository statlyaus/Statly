import type { ReactElement } from 'react';

import Link from 'next/link';

import {
  ArrowRightIcon,
  ChartBarIcon,
  ClockIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';

const trustSignals = [
  'Decision-first dashboards for roster moves, waivers, and lineup pressure',
  'AFL-specific depth without the clutter that slows down weekly decisions',
  'Mobile-ready workflows for checking scores, claims, and trade action quickly',
];

const workflowCards = [
  {
    eyebrow: 'Roster Control',
    title: 'See the next move before the deadline hits',
    description:
      'Prioritise starters, bench risk, and injury impact from one clear fantasy workspace.',
    points: ['Lineup context first', 'Status and trend signals', 'Fast path into team actions'],
  },
  {
    eyebrow: 'Live Matchups',
    title: 'Track scoring momentum without losing the story',
    description:
      'Follow deltas, contributors, and matchup pressure in a format built for repeat checking.',
    points: ['Glanceable live changes', 'High-trust timestamps', 'Mobile-friendly score review'],
  },
  {
    eyebrow: 'Waivers & Trades',
    title: 'Move from analysis to action with less friction',
    description:
      'Make claims, compare options, and review trade decisions with clearer hierarchy and less noise.',
    points: ['Action-led flows', 'Clear risk states', 'Structured decision support'],
  },
];

const productPillars = [
  {
    icon: ChartBarIcon,
    title: 'Structured Like ESPN',
    description:
      'Statly should make league, roster, and player information easier to scan and compare.',
  },
  {
    icon: SparklesIcon,
    title: 'AFL-Smart Like SuperCoach',
    description:
      'Depth matters, but advanced stats should support decisions instead of overwhelming the screen.',
  },
  {
    icon: ClockIcon,
    title: 'Fast Like Yahoo',
    description:
      'Key actions should stay obvious on desktop and mobile, especially during live or deadline moments.',
  },
];

export default function FantasyEntryPage(): ReactElement {
  return (
    <div className="min-h-[calc(100vh-80px)] bg-[linear-gradient(180deg,#081325_0%,#0c1a31_44%,#f5f0e6_44%,#f5efe5_100%)] text-slate-950">
      <section className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.16),transparent_34%),radial-gradient(circle_at_80%_18%,rgba(34,197,94,0.14),transparent_30%)]" />
        <div className="relative mx-auto max-w-6xl px-6 py-16 lg:px-10 lg:py-20">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] lg:items-end">
            <div className="max-w-3xl space-y-6">
              <p className="inline-flex items-center rounded-full border border-cyan-300/35 bg-cyan-400/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100">
                Statly Fantasy
              </p>
              <div className="space-y-4">
                <h1 className="max-w-4xl text-balance text-4xl font-black leading-tight text-white sm:text-5xl lg:text-6xl">
                  AFL fantasy for people who want faster decisions, not noisier screens.
                </h1>
                <p className="max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
                  Statly combines structured roster management, AFL-specific depth, and mobile-ready
                  live workflows so you can manage your team with more confidence during the week
                  and under pressure on game day.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Link
                  href="/dashboard"
                  className="inline-flex items-center gap-2 rounded-xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                >
                  Open Dashboard
                  <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link
                  href="/players"
                  className="inline-flex items-center rounded-xl border border-white/20 bg-white/5 px-5 py-3 text-sm font-medium text-white transition hover:border-cyan-200/60 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                >
                  Explore Players
                </Link>
                <Link
                  href="/leagues"
                  className="inline-flex items-center rounded-xl border border-white/20 bg-white/5 px-5 py-3 text-sm font-medium text-white transition hover:border-cyan-200/60 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                >
                  Browse Leagues
                </Link>
              </div>
            </div>

            <aside className="rounded-[1.75rem] border border-white/10 bg-white/8 p-6 text-white shadow-[0_24px_80px_-44px_rgba(8,19,37,0.8)] backdrop-blur">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-emerald-400/18 p-2 text-emerald-200">
                  <ShieldCheckIcon className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">Design Goal</p>
                  <p className="text-sm text-slate-300">
                    Trustworthy, high-clarity, AFL-first fantasy management.
                  </p>
                </div>
              </div>
              <div className="mt-6 space-y-3">
                {trustSignals.map((signal) => (
                  <div
                    key={signal}
                    className="rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-4"
                  >
                    <p className="text-sm leading-6 text-slate-200">{signal}</p>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-12 lg:px-10 lg:py-16">
        <div className="grid gap-4 lg:grid-cols-3">
          {productPillars.map(({ icon: Icon, title, description }) => (
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

      <section className="mx-auto max-w-6xl px-6 pb-16 lg:px-10 lg:pb-20">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Core Workflows
            </p>
            <h2 className="text-balance text-3xl font-black text-slate-950 sm:text-4xl">
              The product should guide the next fantasy decision, not bury it.
            </h2>
            <p className="text-sm leading-7 text-slate-600 sm:text-base">
              Every high-value Statly surface should reduce time-to-action while keeping the data
              trustworthy, structured, and readable on both desktop and mobile.
            </p>
          </div>
          <Link
            href="/live-scoring"
            className="inline-flex items-center gap-2 self-start rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition hover:border-slate-950 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
          >
            Review Live Tools
            <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>

        <div className="mt-8 grid gap-5 lg:grid-cols-3">
          {workflowCards.map((card, index) => (
            <article
              key={card.title}
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
                {card.eyebrow}
              </p>
              <h3 className="mt-3 text-2xl font-bold leading-tight">{card.title}</h3>
              <p
                className={`mt-4 text-sm leading-6 ${
                  index === 0 ? 'text-slate-300' : 'text-slate-600'
                }`}
              >
                {card.description}
              </p>
              <ul className="mt-6 space-y-3">
                {card.points.map((point) => (
                  <li
                    key={point}
                    className={`rounded-2xl px-4 py-3 text-sm ${
                      index === 0 ? 'bg-white/8 text-slate-200' : 'bg-slate-50 text-slate-700'
                    }`}
                  >
                    {point}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
