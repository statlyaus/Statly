'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  Clock3,
  Loader2,
  Search,
  TableProperties,
  Trophy,
  Users,
} from 'lucide-react';

import { useAuth } from '@/AuthContext';
import { fetchApi } from '@/lib/api';
import { buildPreferenceCookie, LAST_LEAGUE_ID_COOKIE } from '@/lib/uiPreferences';
import type {
  DraftHistoryDetail,
  DraftHistoryParticipant,
  DraftHistoryPick,
} from '@/server/draft/readModels/draftHistoryReadModel';

type DetailTab = 'rounds' | 'rosters' | 'timeline';

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

export default function DraftHistoryDetailPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const [draft, setDraft] = useState<DraftHistoryDetail | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>('rounds');
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const queryLeagueId = searchParams?.get('leagueId') ?? '';
  const activeLeagueId = draft?.leagueId ?? queryLeagueId;
  const backToHistoryHref = activeLeagueId
    ? `/drafts/history?leagueId=${encodeURIComponent(activeLeagueId)}`
    : '/drafts/history';

  useEffect(() => {
    const fetchDraftHistoryDetail = async () => {
      if (!user || !params?.id) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);
        const response = await fetchApi(`drafts/history/${params.id}`);

        if (response.success) {
          setDraft(response.data);
        } else {
          setError('Failed to load draft history detail');
        }
      } catch (err) {
        console.error('Error fetching draft history detail:', err);
        setError(getErrorMessage(err));
      } finally {
        setIsLoading(false);
      }
    };

    fetchDraftHistoryDetail();
  }, [params?.id, user]);

  useEffect(() => {
    if (!draft?.leagueId || typeof document === 'undefined') return;
    document.cookie = buildPreferenceCookie(LAST_LEAGUE_ID_COOKIE, draft.leagueId);
  }, [draft?.leagueId]);

  const filteredTimeline = useMemo(() => {
    const timeline = draft?.timeline ?? [];
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) return timeline;

    return timeline.filter((pick) =>
      [
        pick.player.name,
        pick.player.position,
        pick.player.club,
        pick.member.teamName,
        pick.member.displayName,
        String(pick.overall),
        String(pick.round),
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery)
    );
  }, [draft?.timeline, query]);

  if (!user) {
    return (
        <main className="min-h-screen bg-background px-4 py-10 text-foreground">
          <section className="mx-auto max-w-md rounded-lg border border-border bg-card p-6 text-center shadow-sm">
            <Trophy className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">Sign in required</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Sign in to open archived draft boards.
            </p>
            <Link
              href="/login"
              className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Sign in
            </Link>
          </section>
        </main>
    );
  }

  return (
      <main className="min-h-screen bg-background text-foreground">
        <div className="mx-auto flex w-full max-w-[1760px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <Link
              href={backToHistoryHref}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-semibold text-foreground transition hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Draft history
            </Link>

            {draft && (
              <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(520px,0.48fr)] xl:items-end">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    Completed draft
                  </p>
                  <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
                    {draft.name}
                  </h1>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarClock className="h-4 w-4" aria-hidden="true" />
                      Completed {formatDate(draft.completedAt)}
                    </span>
                    <span>{draft.teamCount} teams</span>
                    <span>{draft.totalRounds} rounds</span>
                    <span>{draft.selectedCategories.length} categories</span>
                    <span>League ID {draft.leagueId}</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Metric label="Picks" value={`${draft.picksMade}/${draft.totalPicks}`} />
                  <Metric label="Manual" value={draft.manualPickCount} />
                  <Metric label="Auto" value={draft.autoPickCount} />
                  <Metric label="Complete" value={`${draft.completionPct}%`} />
                </div>
              </div>
            )}
          </section>

          {isLoading && (
            <section className="rounded-lg border border-border bg-card p-8 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" aria-hidden="true" />
              <p className="mt-4 text-sm font-semibold">Loading completed draft</p>
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

          {!isLoading && !error && draft && (
            <>
              <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
                <PickFeature label="First pick" pick={draft.firstPick} />
                <PickFeature label="Final pick" pick={draft.lastPick} />
              </section>

              <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <div
                    className="grid grid-cols-3 gap-1 rounded-md border border-border bg-background p-1"
                    role="tablist"
                    aria-label="Draft history views"
                  >
                    {[
                      { id: 'rounds' as const, label: 'Rounds', icon: TableProperties },
                      { id: 'rosters' as const, label: 'Rosters', icon: Users },
                      { id: 'timeline' as const, label: 'Timeline', icon: Clock3 },
                    ].map((tab) => {
                      const Icon = tab.icon;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          role="tab"
                          aria-selected={activeTab === tab.id}
                          onClick={() => setActiveTab(tab.id)}
                          className={`inline-flex h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                            activeTab === tab.id
                              ? 'bg-primary text-primary-foreground'
                              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                          }`}
                        >
                          <Icon className="h-4 w-4" aria-hidden="true" />
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>
                  <label htmlFor="draft-detail-search" className="sr-only">
                    Search picks
                  </label>
                  <div className="relative xl:w-[420px]">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <input
                      id="draft-detail-search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      className="h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
                      placeholder="Search players, teams, positions, clubs, rounds"
                    />
                  </div>
                </div>
              </section>

              {activeTab === 'rounds' && <RoundsView draft={draft} query={query} />}
              {activeTab === 'rosters' && <RostersView participants={draft.participants} />}
              {activeTab === 'timeline' && <TimelineView picks={filteredTimeline} />}
            </>
          )}
        </div>
      </main>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-border bg-background px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function PickFeature({ label, pick }: { label: string; pick: DraftHistoryPick | null }) {
  if (!pick) {
    return (
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {label}
        </p>
        <p className="mt-3 text-sm text-muted-foreground">No pick recorded</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </p>
      <div className="mt-4 flex items-center gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-primary text-lg font-semibold text-primary-foreground">
          {pick.overall}
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{pick.player.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {pick.player.position} / {pick.player.club} / {pick.member.teamName}
          </p>
        </div>
      </div>
    </section>
  );
}

function RoundsView({ draft, query }: { draft: DraftHistoryDetail; query: string }) {
  const normalizedQuery = query.trim().toLowerCase();

  return (
    <section className="space-y-4">
      {draft.rounds.map((round) => {
        const picks = normalizedQuery
          ? round.picks.filter((pick) =>
              [
                pick.player.name,
                pick.player.position,
                pick.player.club,
                pick.member.teamName,
                String(pick.overall),
              ]
                .join(' ')
                .toLowerCase()
                .includes(normalizedQuery)
            )
          : round.picks;

        if (picks.length === 0) return null;

        return (
          <article key={round.round} className="rounded-lg border border-border bg-card shadow-sm">
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-lg font-semibold">Round {round.round}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {picks.length} of {round.picks.length} selections shown
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] border-collapse text-left text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Pick</th>
                    <th className="px-5 py-3 font-semibold">Player</th>
                    <th className="px-5 py-3 font-semibold">Team</th>
                    <th className="px-5 py-3 font-semibold">Slot</th>
                    <th className="px-5 py-3 font-semibold">Mode</th>
                    <th className="px-5 py-3 font-semibold">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {picks.map((pick) => (
                    <PickRow key={pick.id} pick={pick} />
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        );
      })}
    </section>
  );
}

function RostersView({ participants }: { participants: DraftHistoryParticipant[] }) {
  return (
    <section className="grid gap-4 xl:grid-cols-2">
      {participants.map((participant) => (
        <article key={participant.id} className="rounded-lg border border-border bg-card shadow-sm">
          <div className="flex items-start justify-between gap-4 border-b border-border p-5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold text-muted-foreground">
                {getInitials(participant.teamName)}
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold">{participant.teamName}</h2>
                <p className="truncate text-sm text-muted-foreground">
                  {participant.displayName} / Slot {participant.slot ?? '-'}
                </p>
              </div>
            </div>
            <span className="rounded-md bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
              {participant.pickCount} picks
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-semibold">Pick</th>
                  <th className="px-5 py-3 font-semibold">Player</th>
                  <th className="px-5 py-3 font-semibold">Position</th>
                  <th className="px-5 py-3 font-semibold">Club</th>
                </tr>
              </thead>
              <tbody>
                {participant.picks.map((pick) => (
                  <tr key={pick.id} className="border-t border-border">
                    <td className="px-5 py-3 font-semibold">#{pick.overall}</td>
                    <td className="px-5 py-3">{pick.player.name}</td>
                    <td className="px-5 py-3 text-muted-foreground">{pick.player.position}</td>
                    <td className="px-5 py-3 text-muted-foreground">{pick.player.club}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ))}
    </section>
  );
}

function TimelineView({ picks }: { picks: DraftHistoryPick[] }) {
  return (
    <section className="rounded-lg border border-border bg-card shadow-sm">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-lg font-semibold">Pick timeline</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Showing {picks.length} selections newest first
        </p>
      </div>
      <div className="divide-y divide-border">
        {picks.map((pick) => (
          <div key={pick.id} className="grid gap-3 p-5 md:grid-cols-[96px_minmax(0,1fr)_220px]">
            <div className="text-sm font-semibold">#{pick.overall}</div>
            <div className="min-w-0">
              <p className="truncate font-semibold">{pick.player.name}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Round {pick.round} / {pick.player.position} / {pick.player.club}
              </p>
            </div>
            <div className="text-sm text-muted-foreground md:text-right">
              <p className="font-medium text-foreground">{pick.member.teamName}</p>
              <p>{formatDate(pick.madeAt)}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function PickRow({ pick }: { pick: DraftHistoryPick }) {
  return (
    <tr className="border-t border-border">
      <td className="px-5 py-4 font-semibold">#{pick.overall}</td>
      <td className="px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
            {getInitials(pick.player.club)}
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold">{pick.player.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {pick.player.position} / {pick.player.club}
            </p>
          </div>
        </div>
      </td>
      <td className="px-5 py-4">{pick.member.teamName}</td>
      <td className="px-5 py-4 text-muted-foreground">{pick.slot}</td>
      <td className="px-5 py-4">
        <span className="rounded-md border border-border px-2 py-1 text-xs font-semibold text-muted-foreground">
          {pick.auto ? 'Auto' : 'Manual'}
        </span>
      </td>
      <td className="px-5 py-4 text-muted-foreground">{formatDate(pick.madeAt)}</td>
    </tr>
  );
}
