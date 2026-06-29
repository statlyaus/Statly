'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/AuthContext';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { cn } from '@/lib/utils';
import { LoadingSpinner } from './ui';

type AvailabilityStatus = 'owned' | 'your-roster' | 'waiver' | 'free-agent';
type AvailabilityActionType = 'trade' | 'waiver' | 'add' | 'roster';
type LeagueAvailabilitySource = 'prisma' | 'firestore';

interface PlayerLeagueAvailability {
  leagueId: string;
  leagueName: string;
  teamName: string;
  source?: LeagueAvailabilitySource;
  status: AvailabilityStatus;
  statusLabel: string;
  statusDetail?: string;
  owner?: {
    memberId: string;
    userId: string;
    teamName: string;
    isCurrentUser: boolean;
  };
  waiver?: {
    processingAt?: string;
    pendingClaims: number;
  };
  action: {
    type: AvailabilityActionType;
    label: string;
    href: string;
  };
}

interface AvailabilityResponse {
  success: true;
  data: {
    playerId: string;
    leagues: PlayerLeagueAvailability[];
    generatedAt: string;
  };
}

interface PlayerLeagueAvailabilityPanelProps {
  playerId: string;
}

function isAvailabilityResponse(value: unknown): value is AvailabilityResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { success?: unknown }).success === true &&
    typeof (value as { data?: unknown }).data === 'object' &&
    Array.isArray(((value as { data: { leagues?: unknown } }).data).leagues)
  );
}

function formatProcessingAt(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function getStatusClass(status: AvailabilityStatus): string {
  if (status === 'owned') return 'text-amber-700';
  if (status === 'your-roster') return 'text-sky-700';
  if (status === 'waiver') return 'text-violet-700';
  return 'text-emerald-700';
}

function getActionClass(type: AvailabilityActionType): string {
  if (type === 'trade') return 'border-border bg-foreground text-background hover:bg-foreground/90';
  if (type === 'waiver') return 'border-primary/30 bg-primary text-primary-foreground hover:bg-primary/90';
  if (type === 'add') return 'border-emerald-200 bg-background text-emerald-800 hover:border-emerald-300 hover:bg-emerald-50';
  return 'border-border bg-background text-foreground hover:bg-muted';
}

function getStatusDotClass(status: AvailabilityStatus): string {
  if (status === 'owned') return 'bg-amber-500';
  if (status === 'your-roster') return 'bg-sky-500';
  if (status === 'waiver') return 'bg-violet-500';
  return 'bg-emerald-500';
}

function getActionLabel(type: AvailabilityActionType, fallback: string): string {
  if (type === 'trade') return 'Trade';
  if (type === 'waiver') return 'Claim';
  if (type === 'add') return 'Add';
  if (type === 'roster') return 'Roster';
  return fallback;
}

export function PlayerLeagueAvailabilityPanel({
  playerId,
}: PlayerLeagueAvailabilityPanelProps): React.JSX.Element {
  const { user, loading: authLoading } = useAuth();
  const [rows, setRows] = useState<PlayerLeagueAvailability[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingActionLeagueId, setPendingActionLeagueId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const isSignedOut = !authLoading && !user?.uid;

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();

    async function loadAvailability() {
      if (authLoading) return;

      if (!user?.uid) {
        setLoading(false);
        setRows([]);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const response = await authenticatedFetch(
          `/api/players/${encodeURIComponent(playerId)}/availability`,
          { signal: controller.signal },
          user.uid
        );
        const body = (await response.json()) as unknown;

        if (!response.ok) {
          const message =
            typeof (body as { error?: unknown })?.error === 'string'
              ? ((body as { error: string }).error as string)
              : 'Failed to load league availability.';
          throw new Error(message);
        }

        if (!isAvailabilityResponse(body)) {
          throw new Error('Unexpected availability response.');
        }

        if (mounted) setRows(body.data.leagues);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (mounted) setError(err instanceof Error ? err.message : 'Failed to load availability.');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void loadAvailability();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [authLoading, playerId, user?.uid]);

  const refreshAvailability = async () => {
    if (!user?.uid) return;
    const response = await authenticatedFetch(
      `/api/players/${encodeURIComponent(playerId)}/availability`,
      {},
      user.uid
    );
    const body = (await response.json()) as unknown;
    if (!response.ok || !isAvailabilityResponse(body)) {
      throw new Error('Failed to refresh availability.');
    }
    setRows(body.data.leagues);
  };

  const handleAddPlayer = async (row: PlayerLeagueAvailability) => {
    if (!user?.uid) return;

    try {
      setPendingActionLeagueId(row.leagueId);
      setActionMessage(null);
      const response = await authenticatedFetch(
        `/api/leagues/${encodeURIComponent(row.leagueId)}/roster/add`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerId }),
        },
        user.uid
      );
      const body = (await response.json().catch(() => ({}))) as unknown;

      if (!response.ok) {
        const message =
          typeof (body as { error?: unknown })?.error === 'string'
            ? ((body as { error: string }).error as string)
            : 'Failed to add player.';
        throw new Error(message);
      }

      await refreshAvailability();
      setActionMessage(`Added to ${row.teamName}.`);
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Failed to add player.');
    } finally {
      setPendingActionLeagueId(null);
    }
  };

  const summary = useMemo(() => {
    const addable = rows.filter((row) => row.status === 'free-agent').length;
    const waiver = rows.filter((row) => row.status === 'waiver').length;
    const owned = rows.length - addable - waiver;
    return { addable, waiver, owned, total: rows.length };
  }, [rows]);

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)]">
      <div className="shrink-0 border-b border-border bg-foreground px-4 py-4 text-background">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-tight text-background">
              League Availability
            </h2>
            <p className="mt-1 max-w-64 text-xs leading-5 text-background/70">
              Roster status and next action by league.
            </p>
          </div>
          {loading || authLoading ? (
            <span className="shrink-0 rounded-md border border-background/15 bg-background/10 px-2.5 py-1 text-xs font-medium text-background/80">
              Checking
            </span>
          ) : summary.total > 0 ? (
            <div className="shrink-0 text-right">
              <div className="text-sm font-semibold tabular-nums text-background">
                {summary.addable} available
              </div>
              <div className="mt-1 text-[11px] font-medium uppercase tracking-wide text-background/60">
                {summary.waiver} waiver / {summary.owned} owned
              </div>
            </div>
          ) : (
            <span className="shrink-0 rounded-md border border-background/15 bg-background/10 px-2.5 py-1 text-xs font-medium text-background/80">
              No leagues
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <LoadingSpinner />
        </div>
      ) : error ? (
        <div className="m-5 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : rows.length === 0 ? (
        <div className="p-5 text-sm text-muted-foreground">
          {isSignedOut
            ? 'Sign in to see this player across your leagues.'
            : 'No league memberships found for your account.'}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {actionMessage && (
            <div className="mx-4 mt-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
              {actionMessage}
            </div>
          )}
          <div className="divide-y divide-border">
            {rows.map((row) => {
            const processingAt = formatProcessingAt(row.waiver?.processingAt);
            const detail = row.statusDetail
              ? row.statusDetail
              : row.owner
              ? row.owner.isCurrentUser
                ? row.owner.teamName
                : `Owner: ${row.owner.teamName}`
              : processingAt
                ? `Processes ${processingAt}`
                : row.status === 'waiver'
                  ? `${row.waiver?.pendingClaims ?? 0} pending claim${
                      row.waiver?.pendingClaims === 1 ? '' : 's'
                    }`
                  : 'Available now';

            return (
              <article
                key={row.leagueId}
                className="group px-4 py-3 transition-colors hover:bg-muted/20"
              >
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <span
                      className={cn(
                        'mt-2 h-2 w-2 shrink-0 rounded-full',
                        getStatusDotClass(row.status)
                      )}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-baseline gap-2">
                        <h3
                          className="truncate text-sm font-semibold leading-5 text-foreground"
                          title={row.leagueName}
                        >
                          {row.leagueName}
                        </h3>
                        <span
                          className={cn(
                            'shrink-0 text-[11px] font-semibold uppercase tracking-wide',
                            getStatusClass(row.status)
                          )}
                        >
                          {row.statusLabel}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs leading-4 text-muted-foreground" title={row.teamName}>
                        {row.teamName}
                      </p>
                      <p className="mt-1 truncate text-xs leading-4 text-muted-foreground" title={detail}>
                        {detail}
                      </p>
                    </div>
                  </div>

                  {row.action.type === 'add' ? (
                    <button
                      type="button"
                      onClick={() => void handleAddPlayer(row)}
                      disabled={pendingActionLeagueId === row.leagueId}
                      className={cn(
                        'inline-flex h-8 min-w-16 shrink-0 items-center justify-center rounded-md border px-2.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
                        getActionClass(row.action.type)
                      )}
                      aria-label={`${row.action.label} in ${row.leagueName}`}
                    >
                      {pendingActionLeagueId === row.leagueId
                        ? 'Adding'
                        : getActionLabel(row.action.type, row.action.label)}
                    </button>
                  ) : (
                    <Link
                      href={row.action.href}
                      className={cn(
                        'inline-flex h-8 min-w-16 shrink-0 items-center justify-center rounded-md border px-2.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        getActionClass(row.action.type)
                      )}
                      aria-label={`${row.action.label} in ${row.leagueName}`}
                    >
                      {getActionLabel(row.action.type, row.action.label)}
                    </Link>
                  )}
                </div>
              </article>
            );
          })}
          </div>
        </div>
      )}
    </section>
  );
}
