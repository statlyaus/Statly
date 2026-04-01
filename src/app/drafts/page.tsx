import Link from 'next/link';

import { AppLayout } from '@/components/navigation';

export default function DraftsPage() {
  return (
    <AppLayout>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <section className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-slate-950 px-6 py-8 text-white shadow-2xl sm:px-8">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.28),_transparent_36%),radial-gradient(circle_at_bottom_left,_rgba(16,185,129,0.2),_transparent_32%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(15,23,42,0.92),rgba(15,23,42,0.72))]" />
          <div className="relative">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-200">
                Draft center
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-5xl">
                One place for live drafts, history, and league setup.
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                Jump into a live room, review completed drafts, or tune your default settings
                before the next league starts.
              </p>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/drafts/create"
                className="inline-flex items-center rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-slate-100"
              >
                Create New Draft
              </Link>
              <Link
                href="/drafts/history"
                className="inline-flex items-center rounded-full border border-white/20 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                View History
              </Link>
              <Link
                href="/drafts/settings"
                className="inline-flex items-center rounded-full border border-white/20 bg-transparent px-5 py-3 text-sm font-semibold text-slate-200 transition-colors hover:bg-white/10 hover:text-white"
              >
                Draft Settings
              </Link>
            </div>
          </div>
        </section>

        <section className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Active Drafts</h2>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                Live
              </span>
            </div>
            <p className="text-sm leading-6 text-slate-600">
              Get back to the room you are drafting in, check the current pick, and keep up with
              the live board.
            </p>
            <Link
              href="/drafts/create"
              className="mt-5 inline-flex items-center rounded-full bg-slate-950 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            >
              Start a draft
            </Link>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Draft History</h2>
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                Archived
              </span>
            </div>
            <p className="text-sm leading-6 text-slate-600">
              Revisit previous drafts, check roster builds, and compare how your league changed
              over time.
            </p>
            <Link
              href="/drafts/history"
              className="mt-5 inline-flex items-center rounded-full bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-200"
            >
              Open history
            </Link>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Draft Settings</h2>
              <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                Defaults
              </span>
            </div>
            <p className="text-sm leading-6 text-slate-600">
              Tune pick timers, auto-pick behavior, and notification preferences before your next
              league draft.
            </p>
            <Link
              href="/drafts/settings"
              className="mt-5 inline-flex items-center rounded-full bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-200"
            >
              Manage settings
            </Link>
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Quick Actions</h2>
              <p className="mt-1 text-sm text-slate-600">
                Move between the player pool, rankings, and supporting data without leaving the
                draft workflow.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/players"
                className="inline-flex items-center rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50"
              >
                View Player Pool
              </Link>
              <Link
                href="/rankings"
                className="inline-flex items-center rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50"
              >
                Player Rankings
              </Link>
              <Link
                href="/stats"
                className="inline-flex items-center rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50"
              >
                Season Stats
              </Link>
            </div>
          </div>
        </section>
      </main>
    </AppLayout>
  );
}
