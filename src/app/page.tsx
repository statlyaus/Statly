import type { ReactElement } from 'react';

import Link from 'next/link';

import { ArrowRightIcon } from '@heroicons/react/24/outline';

export default function HomePage(): ReactElement {
  return (
    <div className="min-h-[calc(100vh-80px)] bg-slate-950 text-slate-100">
      <section className="relative overflow-hidden border-b border-slate-800">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_30%,rgba(56,189,248,0.16),transparent_55%),radial-gradient(circle_at_80%_10%,rgba(16,185,129,0.12),transparent_45%)]" />
        <div className="relative mx-auto max-w-6xl px-6 py-16 lg:px-10">
          <div className="max-w-3xl space-y-5">
            <p className="inline-flex items-center rounded-full border border-cyan-300/30 bg-cyan-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">
              Statly Product Gateway
            </p>
            <h1 className="text-4xl font-black leading-tight text-white sm:text-5xl">
              Choose your Statly experience
            </h1>
            <p className="text-base text-slate-300 sm:text-lg">
              Statly now has two dedicated products: Fantasy AFL gameplay and a separate public AFL Draft &amp; Trade Hub.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-6 py-12 md:grid-cols-2 lg:px-10">
        <article className="rounded-xl border border-slate-800 bg-slate-900/70 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-300">Statly Fantasy</p>
          <h2 className="mt-2 text-2xl font-bold text-white">Build your squad. Win your league.</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-300">
            Build your squad, join leagues, and climb rankings with live scoring, waivers, trades, and draft operations.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/fantasy"
              className="inline-flex items-center gap-2 rounded-md bg-blue-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-400"
            >
              Play Fantasy
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
            <Link
              href="/leagues"
              className="inline-flex items-center rounded-md border border-slate-600 px-4 py-3 text-sm font-medium text-slate-200 transition hover:border-blue-300 hover:text-blue-200"
            >
              Leagues
            </Link>
          </div>
        </article>

        <article className="rounded-xl border border-slate-800 bg-slate-900/70 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-300">
            AFL Draft &amp; Trade Hub
          </p>
          <h2 className="mt-2 text-2xl font-bold text-white">Explore every trade and pick path</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-300">
            Search historical AFL trades, inspect parties and assets, and browse club-by-club movement in a public data-first hub.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/draft/trades"
              className="inline-flex items-center gap-2 rounded-md bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
            >
              Explore Draft &amp; Trades
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
            <Link
              href="/draft"
              className="inline-flex items-center rounded-md border border-slate-600 px-4 py-3 text-sm font-medium text-slate-200 transition hover:border-emerald-300 hover:text-emerald-200"
            >
              Open Hub
            </Link>
          </div>
        </article>
      </section>
    </div>
  );
}
