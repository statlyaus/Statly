'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Archive,
  CalendarClock,
  ChevronLeft,
  Loader2,
  Users,
} from 'lucide-react';

import { useAuth } from '@/AuthContext';
import { fetchApi } from '@/lib/api';
import { AppLayout } from '@/components/navigation';

interface DraftHistory {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  completedAt?: string;
  totalPicks: number;
  participants: Array<{
    id: string;
    displayName: string;
    teamName: string;
    picks: Array<{
      player: {
        name: string;
        position: string;
        club: string;
      };
      overall: number;
      round: number;
    }>;
  }>;
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString('en-AU', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getStatusClasses(status: string) {
  if (status === 'COMPLETED') {
    return 'bg-[color:var(--league-success-soft)] text-[color:var(--league-success)]';
  }
  if (status === 'PAUSED') {
    return 'bg-[color:var(--league-warning-soft)] text-[color:var(--league-warning)]';
  }
  if (status === 'CANCELLED') {
    return 'bg-[color:var(--league-danger-soft)] text-[color:var(--league-danger)]';
  }
  return 'bg-[color:var(--league-primary-soft)] text-[color:var(--league-primary)]';
}

export default function DraftHistoryPage() {
  const { user } = useAuth();
  const [drafts, setDrafts] = useState<DraftHistory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDraftHistory = async () => {
      if (!user) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);
        const response = await fetchApi('drafts/history');

        if (response.success) {
          setDrafts(response.data || []);
        } else {
          setError(response.error || 'Failed to load draft history');
        }
      } catch (err) {
        console.error('Error fetching draft history:', err);
        setError('Failed to load draft history');
      } finally {
        setIsLoading(false);
      }
    };

    fetchDraftHistory();
  }, [user]);

  if (!user) {
    return (
      <AppLayout>
        <main className="min-h-screen bg-[linear-gradient(180deg,var(--league-surface)_0%,var(--league-page)_44%,var(--league-surface-muted)_100%)] px-4 py-10 text-[color:var(--league-text)]">
          <section className="mx-auto max-w-md rounded-[28px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-6 text-center shadow-[0_22px_70px_-46px_rgba(23,34,48,0.35)]">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:var(--league-primary-soft)] text-[color:var(--league-primary)]">
              <Archive className="h-5 w-5" aria-hidden="true" />
            </div>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">Sign in required</h1>
            <p className="mt-2 text-sm leading-6 text-[color:var(--league-text-muted)]">
              Sign in to review completed draft rooms and archived roster outcomes.
            </p>
            <Link
              href="/login"
              className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-full bg-[color:var(--league-primary)] px-5 text-sm font-semibold text-[color:var(--league-primary-foreground)] transition hover:bg-[color:var(--league-primary-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] focus-visible:ring-offset-2"
            >
              Sign in
            </Link>
          </section>
        </main>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <main className="min-h-screen bg-[linear-gradient(180deg,var(--league-surface)_0%,var(--league-page)_44%,var(--league-surface-muted)_100%)] text-[color:var(--league-text)]">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
          <section className="rounded-[28px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-5 shadow-[0_22px_70px_-46px_rgba(23,34,48,0.35)] sm:p-6">
            <Link
              href="/drafts"
              className="inline-flex h-9 items-center gap-2 rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-sm font-semibold text-[color:var(--league-text)] transition hover:bg-[color:var(--league-surface-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Draft center
            </Link>
            <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div className="max-w-3xl">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--league-text-muted)]">
                  Archive
                </p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[color:var(--league-text)] sm:text-4xl">
                  Draft history
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-[color:var(--league-text-muted)] sm:text-base">
                  Review completed drafts, compare roster construction, and audit how each round
                  unfolded.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:min-w-[320px]">
                <div className="rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--league-text-muted)]">
                    Drafts
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-[color:var(--league-text)]">
                    {drafts.length}
                  </p>
                </div>
                <div className="rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--league-text-muted)]">
                    Picks
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-[color:var(--league-text)]">
                    {drafts.reduce((sum, draft) => sum + draft.totalPicks, 0)}
                  </p>
                </div>
              </div>
            </div>
          </section>

          {isLoading && (
            <section className="rounded-[28px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-8 text-center">
              <Loader2
                className="mx-auto h-8 w-8 animate-spin text-[color:var(--league-primary)]"
                aria-hidden="true"
              />
              <p className="mt-4 text-sm font-semibold text-[color:var(--league-text)]">
                Loading draft history
              </p>
            </section>
          )}

          {error && (
            <section className="rounded-[24px] border border-[color:var(--league-danger)]/30 bg-[color:var(--league-danger-soft)] p-5 text-[color:var(--league-danger)]">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                <p className="text-sm font-semibold">{error}</p>
              </div>
            </section>
          )}

          {!isLoading && !error && drafts.length === 0 && (
            <section className="rounded-[28px] border border-dashed border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:var(--league-primary-soft)] text-[color:var(--league-primary)]">
                <Archive className="h-5 w-5" aria-hidden="true" />
              </div>
              <h2 className="mt-4 text-lg font-semibold text-[color:var(--league-text)]">
                No completed drafts yet
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[color:var(--league-text-muted)]">
                Completed rooms will appear here with team rosters, pick counts, and round-by-round
                selection history.
              </p>
              <Link
                href="/drafts/create"
                className="mt-5 inline-flex h-11 items-center justify-center rounded-full bg-[color:var(--league-primary)] px-5 text-sm font-semibold text-[color:var(--league-primary-foreground)] transition hover:bg-[color:var(--league-primary-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] focus-visible:ring-offset-2"
              >
                Create draft
              </Link>
            </section>
          )}

          {!isLoading && !error && drafts.length > 0 && (
            <section className="space-y-5">
              {drafts.map((draft) => (
                <article
                  key={draft.id}
                  className="overflow-hidden rounded-[24px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] shadow-[0_18px_55px_-44px_rgba(23,34,48,0.4)]"
                >
                  <div className="border-b border-[color:var(--league-border)] p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h2 className="text-lg font-semibold tracking-tight text-[color:var(--league-text)]">
                          {draft.name}
                        </h2>
                        <div className="mt-2 flex flex-wrap gap-3 text-sm text-[color:var(--league-text-muted)]">
                          <span className="inline-flex items-center gap-1.5">
                            <CalendarClock className="h-4 w-4" aria-hidden="true" />
                            Created {formatDate(draft.createdAt)}
                          </span>
                          {draft.completedAt && (
                            <span>Completed {formatDate(draft.completedAt)}</span>
                          )}
                          <span>{draft.totalPicks} picks</span>
                        </div>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusClasses(
                          draft.status
                        )}`}
                      >
                        {draft.status}
                      </span>
                    </div>
                  </div>

                  <div className="p-5">
                    <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-[color:var(--league-text)]">
                      <Users
                        className="h-4 w-4 text-[color:var(--league-text-muted)]"
                        aria-hidden="true"
                      />
                      Team rosters
                    </div>
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {draft.participants.map((participant) => (
                        <div
                          key={participant.id}
                          className="rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] p-4"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <h3 className="truncate text-sm font-semibold text-[color:var(--league-text)]">
                              {participant.teamName}
                            </h3>
                            <span className="shrink-0 rounded-full bg-[color:var(--league-primary-soft)] px-2 py-1 text-xs font-semibold text-[color:var(--league-primary)]">
                              {participant.picks.length}
                            </span>
                          </div>
                          <div className="mt-3 space-y-2">
                            {participant.picks
                              .sort((a, b) => a.overall - b.overall)
                              .slice(0, 8)
                              .map((pick) => (
                                <div
                                  key={pick.overall}
                                  className="flex items-center justify-between gap-3 text-xs"
                                >
                                  <div className="min-w-0">
                                    <span className="font-semibold text-[color:var(--league-text)]">
                                      #{pick.overall} {pick.player.name}
                                    </span>
                                    <span className="ml-1 text-[color:var(--league-text-muted)]">
                                      {pick.player.position} / {pick.player.club}
                                    </span>
                                  </div>
                                  <span className="shrink-0 text-[color:var(--league-text-muted)]">
                                    R{pick.round}
                                  </span>
                                </div>
                              ))}
                          </div>
                          {participant.picks.length > 8 && (
                            <p className="mt-3 text-xs font-medium text-[color:var(--league-text-muted)]">
                              +{participant.picks.length - 8} more selections
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </article>
              ))}
            </section>
          )}
        </div>
      </main>
    </AppLayout>
  );
}
