'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  Archive,
  ArrowUpRight,
  CalendarClock,
  ChevronLeft,
  Loader2,
  Search,
  Trophy,
  Users,
} from 'lucide-react';

import { useAuth } from '@/AuthContext';
import { AppLayout } from '@/components/navigation';
import { fetchApi } from '@/lib/api';
import {
  buildPreferenceCookie,
  LAST_LEAGUE_ID_COOKIE,
  parseLeaguePreference,
  readCookieValue,
} from '@/lib/uiPreferences';
import type {
  DraftHistoryListResult,
  DraftHistorySummary,
} from '@/server/draft/readModels/draftHistoryReadModel';

function formatDate(dateString: string | null) {
  if (!dateString) return 'Not recorded';

  return new Date(dateString).toLocaleDateString('en-AU', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatStatus(status: string) {
  return status.toLowerCase().replace(/^\w/, (value) => value.toUpperCase());
}

function getStatusClasses(status: string) {
  if (status === 'COMPLETED') {
    return 'bg-[color:var(--league-success-soft)] text-[color:var(--league-success)]';
  }
  if (status === 'PAUSED') {
    return 'bg-[color:var(--league-warning-soft)] text-[color:var(--league-warning)]';
  }
  return 'bg-[color:var(--league-primary-soft)] text-[color:var(--league-primary)]';
}

function getInitials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Failed to load draft history';
}

export default function DraftHistoryPage() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const [history, setHistory] = useState<DraftHistoryListResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedLeagueId, setSelectedLeagueId] = useState('');

  const queryLeagueId = searchParams?.get('leagueId') ?? '';

  useEffect(() => {
    const fetchDraftHistory = async () => {
      if (!user) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);
        const persistedLeagueId =
          typeof document === 'undefined'
            ? undefined
            : readCookieValue(document.cookie, LAST_LEAGUE_ID_COOKIE);
        const scopedLeagueId = parseLeaguePreference(queryLeagueId || persistedLeagueId);
        setSelectedLeagueId(scopedLeagueId ?? '');

        if (scopedLeagueId && queryLeagueId) {
          document.cookie = buildPreferenceCookie(LAST_LEAGUE_ID_COOKIE, scopedLeagueId);
        }

        const endpoint = scopedLeagueId
          ? `drafts/history?limit=50&leagueId=${encodeURIComponent(scopedLeagueId)}`
          : 'drafts/history?limit=50';
        const response = await fetchApi(endpoint);

        if (response.success) {
          setHistory(response.data);
        } else {
          setError('Failed to load draft history');
        }
      } catch (err) {
        console.error('Error fetching draft history:', err);
        setError(getErrorMessage(err));
      } finally {
        setIsLoading(false);
      }
    };

    fetchDraftHistory();
  }, [queryLeagueId, user]);

  const filteredDrafts = useMemo(() => {
    const drafts = history?.drafts ?? [];
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) return drafts;

    return drafts.filter((draft) => {
      const searchable = [
        draft.name,
        draft.status,
        draft.firstPick?.player.name,
        draft.lastPick?.player.name,
        ...draft.participants.flatMap((participant) => [
          participant.teamName,
          participant.displayName,
          ...participant.picks.slice(0, 6).map((pick) => pick.player.name),
        ]),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return searchable.includes(normalizedQuery);
    });
  }, [history?.drafts, query]);

  if (!user) {
    return (
      <AppLayout>
        <main className="min-h-screen bg-background px-4 py-10 text-foreground">
          <section className="mx-auto max-w-md rounded-lg border border-border bg-card p-6 text-center shadow-sm">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Archive className="h-5 w-5" aria-hidden="true" />
            </div>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">Sign in required</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Sign in to review completed draft rooms and archived roster outcomes.
            </p>
            <Link
              href="/login"
              className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Sign in
            </Link>
          </section>
        </main>
      </AppLayout>
    );
  }

  const metrics = history?.metrics ?? {
    draftCount: 0,
    pickCount: 0,
    teamCount: 0,
    autoPickCount: 0,
    manualPickCount: 0,
  };

  return (
    <AppLayout>
      <main className="min-h-screen bg-background text-foreground">
        <div className="mx-auto flex w-full max-w-[1760px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <Link
              href="/drafts"
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-semibold text-foreground transition hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Draft center
            </Link>
            <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(560px,0.55fr)] xl:items-end">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Archive
                </p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
                  Draft history
                </h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
                  Audit completed drafts, compare roster builds, and replay every selection by
                  round, team, and player.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <Metric label="Drafts" value={metrics.draftCount} />
                <Metric label="Picks" value={metrics.pickCount} />
                <Metric label="Teams" value={metrics.teamCount} />
                <Metric label="Manual" value={metrics.manualPickCount} />
                <Metric label="Auto" value={metrics.autoPickCount} />
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <label htmlFor="draft-history-search" className="sr-only">
              Search draft history
            </label>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="relative md:w-[520px]">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <input
                  id="draft-history-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="h-11 w-full rounded-md border border-input bg-background pl-10 pr-3 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
                  placeholder="Search leagues, teams, managers, or players"
                />
              </div>
              <p className="text-sm font-medium text-muted-foreground">
                Showing {filteredDrafts.length} of {history?.drafts.length ?? 0} completed drafts
              </p>
            </div>
            {selectedLeagueId ? (
              <p className="mt-3 text-sm font-medium text-muted-foreground">
                League scope:{' '}
                <span className="text-foreground">
                  {history?.drafts[0]?.name ?? selectedLeagueId}
                </span>
              </p>
            ) : null}
          </section>

          {isLoading && (
            <section className="rounded-lg border border-border bg-card p-8 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" aria-hidden="true" />
              <p className="mt-4 text-sm font-semibold">Loading draft history</p>
            </section>
          )}

          {error && (
            <section className="rounded-lg border border-destructive/30 bg-destructive/10 p-5 text-destructive">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                <p className="text-sm font-semibold">{error}</p>
              </div>
            </section>
          )}

          {!isLoading && !error && filteredDrafts.length === 0 && (
            <section className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Archive className="h-5 w-5" aria-hidden="true" />
              </div>
              <h2 className="mt-4 text-lg font-semibold">
                {history?.drafts.length ? 'No matching drafts' : 'No completed drafts yet'}
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                Completed rooms will appear here with full rosters, pick counts, and
                round-by-round selection history.
              </p>
            </section>
          )}

          {!isLoading && !error && filteredDrafts.length > 0 && (
            <section className="grid gap-4">
              {filteredDrafts.map((draft) => (
                <DraftHistoryCard key={draft.id} draft={draft} />
              ))}
            </section>
          )}
        </div>
      </main>
    </AppLayout>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-background px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function DraftHistoryCard({ draft }: { draft: DraftHistorySummary }) {
  const leaders = [...draft.participants]
    .sort((a, b) => b.pickCount - a.pickCount || a.teamName.localeCompare(b.teamName))
    .slice(0, 4);

  return (
    <article className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="grid gap-5 border-b border-border p-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${getStatusClasses(
                draft.status
              )}`}
            >
              {formatStatus(draft.status)}
            </span>
            <span className="rounded-md border border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground">
              {draft.teamCount} teams
            </span>
            <span className="rounded-md border border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground">
              {draft.picksMade}/{draft.totalPicks} picks
            </span>
          </div>
          <h2 className="mt-3 text-xl font-semibold tracking-tight">{draft.name}</h2>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="h-4 w-4" aria-hidden="true" />
              Completed {formatDate(draft.completedAt)}
            </span>
            <span>{draft.totalRounds} rounds</span>
            <span>{draft.completionPct}% complete</span>
            <span>{draft.selectedCategories.length} categories</span>
          </div>
        </div>
        <div className="grid gap-2 text-sm">
          <PickSummary label="First pick" pick={draft.firstPick} />
          <PickSummary label="Final pick" pick={draft.lastPick} />
        </div>
      </div>

      <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
        <div>
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Roster snapshot
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {leaders.map((participant) => (
              <div key={participant.id} className="rounded-lg border border-border bg-background p-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
                    {getInitials(participant.teamName)}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{participant.teamName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {participant.pickCount} picks
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {participant.positions.slice(0, 4).map((position) => (
                    <span
                      key={position.position}
                      className="rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground"
                    >
                      {position.position} {position.count}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <Link
          href={`/drafts/history/${draft.id}?leagueId=${encodeURIComponent(draft.leagueId)}`}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Open full history
          <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}

function PickSummary({ label, pick }: { label: string; pick: DraftHistorySummary['firstPick'] }) {
  if (!pick) {
    return (
      <div className="rounded-lg border border-border bg-background p-3 text-muted-foreground">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">{label}</p>
        <p className="mt-1 text-sm font-medium">No pick recorded</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <div className="mt-2 flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Trophy className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            #{pick.overall} {pick.player.name}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {pick.member.teamName} / {pick.player.position} / {pick.player.club}
          </p>
        </div>
      </div>
    </div>
  );
}
