import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { DraftStatus } from '@prisma/client';
import { History, Trophy } from 'lucide-react';

import { getAuthenticatedUserIdFromServerContext } from '@/lib/serverAuth';
import {
  listMemberLeagueDrafts,
  type MemberLeagueDraft,
} from '@/server/draft/readModels/memberLeagueDraftsReadModel';

export const dynamic = 'force-dynamic';

const STATUS_LABELS: Record<DraftStatus, string> = {
  SCHEDULED: 'Scheduled',
  LIVE: 'Live',
  PAUSED: 'Paused',
  COMPLETED: 'Completed',
};

function formatStart(draft: MemberLeagueDraft): string {
  if (!draft.startAt) return 'Start time not set';
  try {
    return new Intl.DateTimeFormat('en-AU', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: draft.timeZone,
    }).format(draft.startAt);
  } catch {
    return draft.startAt.toISOString();
  }
}

/**
 * The viewer's league drafts. Drafts are created and run from a league's Draft tab, so every row
 * links there; there is no standalone draft outside a league.
 */
export default async function DraftsPage() {
  const userId = await getAuthenticatedUserIdFromServerContext();
  if (!userId) redirect(`/login?next=${encodeURIComponent('/drafts')}`);

  const drafts = await listMemberLeagueDrafts(userId);

  return (
    <div className="min-h-screen bg-[color:var(--league-page)] text-[color:var(--league-text)]">
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Your drafts</h1>
            <p className="mt-2 text-sm text-[color:var(--league-text-muted)]">
              Drafts in the leagues you play in. Open one to go to that league&apos;s Draft tab.
            </p>
          </div>
          <Link
            href="/drafts/history"
            className="inline-flex h-10 items-center gap-2 self-start rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-4 text-sm font-semibold transition hover:bg-[color:var(--league-surface-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
          >
            <History className="h-4 w-4" aria-hidden="true" />
            Draft history
          </Link>
        </header>

        {drafts.length === 0 ? (
          <section className="rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-6 text-center">
            <Trophy
              className="mx-auto h-8 w-8 text-[color:var(--league-text-muted)]"
              aria-hidden="true"
            />
            <h2 className="mt-3 text-lg font-semibold">You&apos;re not in any league drafts yet</h2>
            <p className="mt-2 text-sm text-[color:var(--league-text-muted)]">
              Join or create a league; its commissioner schedules the draft from the league&apos;s
              Draft tab.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Link
                href="/leagues/join"
                className="inline-flex h-10 items-center rounded-full bg-[color:var(--league-primary)] px-4 text-sm font-semibold text-[color:var(--league-primary-foreground)] transition hover:bg-[color:var(--league-primary-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] focus-visible:ring-offset-2"
              >
                Join a league
              </Link>
              <Link
                href="/leagues/new"
                className="inline-flex h-10 items-center rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-4 text-sm font-semibold transition hover:bg-[color:var(--league-surface-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
              >
                Create a league
              </Link>
            </div>
          </section>
        ) : (
          <ul className="flex flex-col gap-3" aria-label="Your league drafts">
            {drafts.map((draft) => (
              <li key={draft.id}>
                <Link
                  href={`/leagues/${encodeURIComponent(draft.leagueId)}?tab=draft`}
                  className="flex flex-col gap-1 rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-4 transition hover:bg-[color:var(--league-surface-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="font-semibold">{draft.leagueName}</span>
                  <span className="flex items-center gap-3 text-sm text-[color:var(--league-text-muted)]">
                    <span>{formatStart(draft)}</span>
                    <span className="rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-2.5 py-0.5 text-xs font-semibold text-[color:var(--league-text)]">
                      {STATUS_LABELS[draft.status]}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
