// src/app/dashboard/page.tsx
import * as React from 'react';
import Link from 'next/link';

export const metadata = {
  title: 'Dashboard • Statly',
  description: 'Your AFL fantasy overview, shortcuts, and quick actions.',
};

export default function DashboardPage() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      {/* Header */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">
            Snapshot of your league, team, and latest player signals.
          </p>
        </div>
      </header>

      {/* Quick Actions */}
      <nav
        aria-label="Primary actions"
        className="mb-8 grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5"
      >
        <Link
          href="/rankings"
          className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          View Rankings
        </Link>

        <Link
          href="/tradecentre"
          className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-900 transition hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          Trade Centre
        </Link>

        <Link
          href="/myteam"
          className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-900 transition hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          My Team
        </Link>

        <Link
          href="/players"
          className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-900 transition hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          Players
        </Link>

        <Link
          href="/stats"
          className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-900 transition hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          Stats
        </Link>
      </nav>

      {/* Dashboard content */}
      <section aria-label="Overview" className="grid gap-6 md:grid-cols-2">
        <article className="rounded-xl border border-gray-200 p-4">
          <h2 className="mb-2 text-sm font-semibold">Team Overview</h2>
          <p className="text-sm text-gray-500">
            Add your existing cards/widgets here. This is a placeholder panel.
          </p>
        </article>

        <article className="rounded-xl border border-gray-200 p-4">
          <h2 className="mb-2 text-sm font-semibold">Latest Activity</h2>
          <p className="text-sm text-gray-500">
            Recent waivers, trades, injuries, and news.
          </p>
        </article>
      </section>
    </main>
  );
}