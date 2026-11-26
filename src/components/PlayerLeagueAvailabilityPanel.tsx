'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/AuthContext';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { formatLeagueTime } from '@/lib/leagueTime';
import { cn } from '@/lib/utils';
import { Spinner } from './ui/Spinner';
import { alertStyles } from '@/components/ui/controlStyles';

type AvailabilityStatus = 'owned' | 'your-roster' | 'waiver' | 'free-agent';
type AvailabilityActionType = 'trade' | 'waiver' | 'add' | 'roster';

interface PlayerLeagueAvailability {
  leagueId: string;
  leagueName: string;
  teamName: string;
  timeZone?: string;
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

/** A player the add route says the manager could drop to make room (ROSTER_FULL). */
interface DropCandidate {
  playerId: string;
  name: string;
  position: string | null;
  club: string | null;
}

interface DropChoice {
  leagueId: string;
  candidates: DropCandidate[];
  selectedPlayerId: string | null;
}

function readDropCandidates(error: unknown): DropCandidate[] | null {
  const candidates = (error as { details?: { dropCandidates?: unknown } } | undefined)?.details
    ?.dropCandidates;
  if (!Array.isArray(candidates)) return null;
  return candidates.filter(
    (candidate): candidate is DropCandidate =>
      typeof candidate === 'object' &&
      candidate !== null &&
      typeof (candidate as { playerId?: unknown }).playerId === 'string' &&
      typeof (candidate as { name?: unknown }).name === 'string'
  );
}

function myTeamHref(leagueId: string): string {
  return `/leagues/${encodeURIComponent(leagueId)}?tab=lineup`;
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
    Array.isArray((value as { data: { leagues?: unknown } }).data.leagues)
  );
}

function formatProcessingAt(value?: string, timeZone?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return formatLeagueTime(date, timeZone);
}

function getStatusClass(status: AvailabilityStatus): string {
  if (status === 'owned') return 'text-warning-text';
  if (status === 'your-roster') return 'text-primary';
  if (status === 'waiver') return 'text-foreground';
  return 'text-success';
}

function getActionClass(type: AvailabilityActionType): string {
  if (type === 'trade') return 'border-border bg-foreground text-background hover:bg-foreground/90';
  if (type === 'waiver')
    return 'border-primary/30 bg-primary text-primary-foreground hover:bg-primary/90';
  if (type === 'add')
    return 'border-success/30 bg-background text-success hover:border-success/40 hover:bg-success-soft';
  return 'border-border bg-background text-foreground hover:bg-muted';
}

function getStatusDotClass(status: AvailabilityStatus): string {
  if (status === 'owned') return 'bg-warning';
  if (status === 'your-roster') return 'bg-primary';
  if (status === 'waiver') return 'bg-foreground';
  return 'bg-success';
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
  const [dropChoice, setDropChoice] = useState<DropChoice | null>(null);
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

  /** Adds the player; with `drop`, the server drops that player in the same transaction. */
  const handleAddPlayer = async (row: PlayerLeagueAvailability, drop?: DropCandidate) => {
    if (!user?.uid) return;

    try {
      setPendingActionLeagueId(row.leagueId);
      setActionMessage(null);
      const response = await authenticatedFetch(
        `/api/leagues/${encodeURIComponent(row.leagueId)}/roster/add`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(drop ? { playerId, dropPlayerId: drop.playerId } : { playerId }),
        },
        user.uid
      );
      const body = (await response.json().catch(() => ({}))) as unknown;

      if (!response.ok) {
        // The add route answers { error: { message, code } }; show its reason, not a generic one.
        const error = (body as { error?: unknown })?.error;
        const reason =
          typeof error === 'string' ? error : (error as { message?: unknown } | undefined)?.message;
        // A full roster comes with the players the manager could drop: let him choose one.
        const candidates =
          (error as { code?: unknown } | undefined)?.code === 'ROSTER_FULL'
            ? readDropCandidates(error)
            : null;
        if (candidates) {
          setDropChoice({ leagueId: row.leagueId, candidates, selectedPlayerId: null });
        }
        throw new Error(typeof reason === 'string' && reason ? reason : 'Failed to add player.');
      }

      setDropChoice(null);
      // Say only what the server reports it committed.
      const dropped = (body as { data?: { dropped?: { playerId?: unknown } | null } })?.data
        ?.dropped;
      await refreshAvailability().catch(() => undefined);
      setActionMessage(
        drop && dropped?.playerId
          ? `Added to ${row.teamName}. ${drop.name} dropped to waivers.`
          : `Added to ${row.teamName}.`
      );
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
    <section className="flex min-h-0 flex-col overflow-hidden border border-border bg-card lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)]">
      <div className="ground-ink shrink-0 border-b border-border px-4 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-tight">League Availability</h2>
            <p className="mt-1 max-w-64 text-xs leading-5 text-muted-foreground">
              Roster status and next action by league.
            </p>
          </div>
          {loading || authLoading ? (
            <span className="shrink-0 border border-border px-2.5 py-1 text-xs font-medium">
              Checking
            </span>
          ) : summary.total > 0 ? (
            <div className="shrink-0 text-right">
              <div className="text-sm font-semibold tabular-nums">{summary.addable} available</div>
              <div className="mt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {summary.waiver} waiver / {summary.owned} owned
              </div>
            </div>
          ) : (
            <span className="shrink-0 border border-border px-2.5 py-1 text-xs font-medium">
              No leagues
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Spinner label="Loading league availability" />
        </div>
      ) : error ? (
        <div role="alert" className={`m-5 p-4 text-sm ${alertStyles({ tone: 'error' })}`}>
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
              const processingAt = formatProcessingAt(row.waiver?.processingAt, row.timeZone);
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
                        <p
                          className="mt-0.5 truncate text-xs leading-4 text-muted-foreground"
                          title={row.teamName}
                        >
                          {row.teamName}
                        </p>
                        <p
                          className="mt-1 truncate text-xs leading-4 text-muted-foreground"
                          title={detail}
                        >
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
                  {dropChoice?.leagueId === row.leagueId &&
                    renderDropPicker(
                      row,
                      dropChoice,
                      setDropChoice,
                      pendingActionLeagueId,
                      (drop) => void handleAddPlayer(row, drop)
                    )}
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function renderDropPicker(
  row: PlayerLeagueAvailability,
  choice: DropChoice,
  setChoice: (choice: DropChoice | null) => void,
  pendingLeagueId: string | null,
  onConfirm: (drop: DropCandidate) => void
): React.JSX.Element {
  const selected = choice.candidates.find(
    (candidate) => candidate.playerId === choice.selectedPlayerId
  );
  const pending = pendingLeagueId === row.leagueId;
  const myTeamLink = (
    <Link href={myTeamHref(row.leagueId)} className="font-semibold text-primary underline">
      My Team
    </Link>
  );

  if (choice.candidates.length === 0) {
    return (
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        No player on your roster can be dropped right now. Manage your roster in {myTeamLink}.
      </p>
    );
  }

  return (
    <fieldset className="mt-3 border border-border p-3">
      <legend className="px-1 text-xs font-semibold text-foreground">
        Choose a player to drop
      </legend>
      <div className="max-h-56 space-y-1 overflow-y-auto">
        {choice.candidates.map((candidate) => (
          <label
            key={candidate.playerId}
            className="flex cursor-pointer items-center gap-2 text-sm text-foreground"
          >
            <input
              type="radio"
              name={`drop-${row.leagueId}`}
              value={candidate.playerId}
              checked={choice.selectedPlayerId === candidate.playerId}
              onChange={() => setChoice({ ...choice, selectedPlayerId: candidate.playerId })}
            />
            <span className="truncate">{candidate.name}</span>
            {(candidate.position || candidate.club) && (
              <span className="shrink-0 text-xs text-muted-foreground">
                {[candidate.position, candidate.club].filter(Boolean).join(', ')}
              </span>
            )}
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        The dropped player goes on waivers. You can also drop from {myTeamLink}.
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={!selected || pending}
          onClick={() => selected && onConfirm(selected)}
          className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-foreground px-2.5 text-xs font-semibold text-background transition hover:bg-foreground/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Adding' : selected ? `Add and drop ${selected.name}` : 'Add and drop'}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setChoice(null)}
          className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-background px-2.5 text-xs font-semibold text-foreground transition hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </fieldset>
  );
}
