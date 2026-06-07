import Link from 'next/link';
import {
  BarChart3,
  CalendarClock,
  History,
  Settings2,
  ShieldCheck,
  Trophy,
  Users,
} from 'lucide-react';
import { AppLayout } from '@/components/navigation';

const draftActions = [
  {
    title: 'Active drafts',
    description: 'Open rooms, monitor readiness, and keep live picks moving.',
    href: '/drafts/create',
    action: 'Create draft',
    icon: Trophy,
    metric: 'Ready for setup',
  },
  {
    title: 'Recent drafts',
    description: 'Review completed boards, pick history, and league outcomes.',
    href: '/drafts/history',
    action: 'View history',
    icon: History,
    metric: 'Archive',
  },
  {
    title: 'Draft settings',
    description: 'Tune timers, ordering rules, and room defaults before launch.',
    href: '/drafts/settings',
    action: 'Manage settings',
    icon: Settings2,
    metric: 'Controls',
  },
];

const quickLinks = [
  { label: 'Player pool', href: '/players', icon: Users },
  { label: 'Rankings', href: '/rankings', icon: BarChart3 },
  { label: 'Season stats', href: '/stats', icon: ShieldCheck },
];

export default function DraftsPage() {
  return (
    <AppLayout>
      <main className="min-h-screen bg-[linear-gradient(180deg,var(--league-surface)_0%,var(--league-page)_44%,var(--league-surface-muted)_100%)] text-[color:var(--league-text)]">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
          <section className="rounded-[28px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-5 shadow-[0_22px_70px_-46px_rgba(23,34,48,0.35)] sm:p-6">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div className="max-w-3xl">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--league-text-muted)]">
                  Draft operations
                </p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[color:var(--league-text)] sm:text-4xl">
                  Draft center
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-[color:var(--league-text-muted)] sm:text-base">
                  Prepare league rooms, move into live draft sessions, and keep every setup step in
                  one predictable workspace.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:min-w-[390px]">
                <div className="rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--league-text-muted)]">
                    Active
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-[color:var(--league-text)]">0</p>
                </div>
                <div className="rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--league-text-muted)]">
                    Status
                  </p>
                  <p className="mt-1 text-sm font-semibold text-[color:var(--league-success)]">
                    Setup ready
                  </p>
                </div>
                <div className="col-span-2 rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-4 py-3 sm:col-span-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--league-text-muted)]">
                    Next step
                  </p>
                  <p className="mt-1 text-sm font-semibold text-[color:var(--league-text)]">
                    Create room
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-3">
            {draftActions.map((item) => {
              const Icon = item.icon;
              return (
                <article
                  key={item.title}
                  className="rounded-[24px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-5 shadow-[0_18px_55px_-44px_rgba(23,34,48,0.4)]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[color:var(--league-primary-soft)] text-[color:var(--league-primary)]">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <span className="rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-2.5 py-1 text-xs font-semibold text-[color:var(--league-text-muted)]">
                      {item.metric}
                    </span>
                  </div>
                  <h2 className="mt-5 text-lg font-semibold tracking-tight text-[color:var(--league-text)]">
                    {item.title}
                  </h2>
                  <p className="mt-2 min-h-[48px] text-sm leading-6 text-[color:var(--league-text-muted)]">
                    {item.description}
                  </p>
                  <Link
                    href={item.href}
                    className="mt-5 inline-flex h-10 items-center justify-center rounded-full bg-[color:var(--league-primary)] px-4 text-sm font-semibold text-[color:var(--league-primary-foreground)] transition hover:bg-[color:var(--league-primary-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] focus-visible:ring-offset-2"
                  >
                    {item.action}
                  </Link>
                </article>
              );
            })}
          </section>

          <section className="rounded-[28px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-5 shadow-[0_22px_70px_-48px_rgba(23,34,48,0.28)]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--league-text-muted)]">
                  <CalendarClock className="h-4 w-4" aria-hidden="true" />
                  Quick actions
                </div>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-[color:var(--league-text)]">
                  Prepare the board before you invite managers
                </h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {quickLinks.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="inline-flex h-10 items-center gap-2 rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-4 text-sm font-semibold text-[color:var(--league-text)] transition hover:bg-[color:var(--league-surface-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          </section>
        </div>
      </main>
    </AppLayout>
  );
}
