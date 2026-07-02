'use client';

import { useMemo, useState } from 'react';
import { AlertCircle, Bookmark, Clock, ListPlus, Search, Trash2, Zap } from 'lucide-react';

import type { DraftPlayer } from '@/types/draft';
import { cn } from '@/lib/utils';

interface WatchlistItem {
  playerId: string;
  priority?: number;
  rank?: number;
  addedAt: string;
  notes?: string;
  player?: {
    id: string;
    name: string;
    position: string;
    club: string;
  };
}

interface WatchlistProps {
  players: DraftPlayer[];
  draftedPlayerIds: string[];
  onDraftPlayer: (player: DraftPlayer) => void | Promise<void>;
  canDraft: boolean;
  className?: string;
  watchlistItems: WatchlistItem[];
  onAddToQueue?: (player: DraftPlayer) => void | Promise<void>;
  queuedPlayerIds?: string[];
  pendingWatchlistPlayerIds?: string[];
  onRemoveFromWatchlist: (playerId: string) => void | Promise<void>;
  isLoading?: boolean;
}

type WatchlistRow = {
  item: WatchlistItem;
  player: Pick<DraftPlayer, 'id' | 'name' | 'position' | 'club'> &
    Partial<
      Pick<DraftPlayer, 'avgPoints' | 'averagePoints' | 'adp' | 'injuryStatus' | 'isAvailable'>
    >;
  draftablePlayer: DraftPlayer | null;
  order: number;
  isDrafted: boolean;
  isUnavailable: boolean;
  isQueued: boolean;
};

function getWatchlistOrder(item: WatchlistItem, index: number): number {
  const explicitOrder = item.priority ?? item.rank;

  return typeof explicitOrder === 'number' && Number.isFinite(explicitOrder)
    ? explicitOrder
    : index + 1;
}

function getAvailabilityLabel(row: WatchlistRow): string {
  if (row.isDrafted) return 'Drafted';
  if (row.isUnavailable) return 'Unavailable';

  return 'Available';
}

function getAvailabilityClassName(row: WatchlistRow): string {
  if (row.isDrafted) {
    return 'border-destructive/30 bg-destructive/10 text-destructive';
  }

  if (row.isUnavailable) {
    return 'border-[color:var(--draft-broadcast-yellow)]/50 bg-[color:var(--draft-broadcast-yellow-soft)] text-foreground';
  }

  return 'border-[color:var(--draft-broadcast-green)]/40 bg-[color:var(--draft-broadcast-green-soft)] text-foreground';
}

function getInjuryLabel(player: WatchlistRow['player']): string | null {
  if (player.injuryStatus === 'injured' || player.injuryStatus === 'out') return 'Injured';
  if (player.injuryStatus === 'questionable') return 'Questionable';

  return null;
}

function WatchlistPlayerMeta({ row }: { row: WatchlistRow }) {
  const avgPoints = row.player.avgPoints ?? row.player.averagePoints;

  return (
    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <span className="rounded-md bg-muted px-1.5 py-0.5 font-medium text-muted-foreground">
        {row.player.position}
      </span>
      <span className="truncate">{row.player.club}</span>
      {typeof row.player.adp === 'number' && <span className="shrink-0">ADP {row.player.adp}</span>}
      {typeof avgPoints === 'number' && <span className="shrink-0">{avgPoints.toFixed(1)} avg</span>}
    </div>
  );
}

function WatchlistPlayerSignals({ row }: { row: WatchlistRow }) {
  const injuryLabel = getInjuryLabel(row.player);

  if (!injuryLabel && !row.item.notes) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
      {injuryLabel && (
        <span className="inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-destructive">
          <AlertCircle className="h-3 w-3" aria-hidden="true" />
          {injuryLabel}
        </span>
      )}
      {row.item.notes && (
        <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.5">
          <Clock className="h-3 w-3" aria-hidden="true" />
          {row.item.notes}
        </span>
      )}
    </div>
  );
}

interface WatchlistRowActionsProps {
  row: WatchlistRow;
  canActOnPlayer: boolean;
  canDraft: boolean;
  isLoading: boolean;
  isWatchlistPending: boolean;
  onAddToQueue?: (player: DraftPlayer) => void | Promise<void>;
  onDraftPlayer: (player: DraftPlayer) => void | Promise<void>;
  onRemoveFromWatchlist: (playerId: string) => void | Promise<void>;
}

function WatchlistRowActions({
  row,
  canActOnPlayer,
  canDraft,
  isLoading,
  isWatchlistPending,
  onAddToQueue,
  onDraftPlayer,
  onRemoveFromWatchlist,
}: WatchlistRowActionsProps) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {onAddToQueue && (
        <button
          type="button"
          onClick={() => {
            if (row.draftablePlayer) void onAddToQueue(row.draftablePlayer);
          }}
          disabled={!canActOnPlayer || row.isQueued || isLoading}
          className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-primary/20 bg-primary/10 px-2 text-xs font-medium text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={
            row.isQueued
              ? `${row.player.name} is already in your draft queue`
              : `Add ${row.player.name} to draft queue`
          }
        >
          <ListPlus className="h-3.5 w-3.5" aria-hidden="true" />
          {row.isQueued ? 'Queued' : 'Queue'}
        </button>
      )}

      <button
        type="button"
        onClick={() => {
          if (row.draftablePlayer) void onDraftPlayer(row.draftablePlayer);
        }}
        disabled={!canActOnPlayer || !canDraft || isLoading}
        className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-[color:var(--draft-broadcast-red)] bg-[color:var(--draft-broadcast-red)] px-2 text-xs font-semibold text-white shadow-[0_0_18px_var(--draft-broadcast-red-glow)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={
          canDraft
            ? `Draft ${row.player.name}`
            : `Cannot draft ${row.player.name} until you are on the clock`
        }
      >
        <Zap className="h-3.5 w-3.5" aria-hidden="true" />
        Draft
      </button>

      <button
        type="button"
        onClick={() => {
          void onRemoveFromWatchlist(String(row.item.playerId));
        }}
        disabled={isWatchlistPending}
        className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={`Remove ${row.player.name} from watchlist`}
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

interface WatchlistPlayerRowProps {
  row: WatchlistRow;
  canDraft: boolean;
  isLoading: boolean;
  pendingWatchlistIds: ReadonlySet<string>;
  onAddToQueue?: (player: DraftPlayer) => void | Promise<void>;
  onDraftPlayer: (player: DraftPlayer) => void | Promise<void>;
  onRemoveFromWatchlist: (playerId: string) => void | Promise<void>;
}

function WatchlistPlayerRow({
  row,
  canDraft,
  isLoading,
  pendingWatchlistIds,
  onAddToQueue,
  onDraftPlayer,
  onRemoveFromWatchlist,
}: WatchlistPlayerRowProps) {
  const availabilityLabel = getAvailabilityLabel(row);
  const canActOnPlayer = Boolean(row.draftablePlayer) && !row.isDrafted && !row.isUnavailable;
  const isWatchlistPending = pendingWatchlistIds.has(String(row.item.playerId));

  return (
    <li
      className={cn(
        'rounded-md border border-border bg-card px-3 py-2 text-card-foreground transition-colors',
        canActOnPlayer && 'hover:bg-muted/60',
        !canActOnPlayer && 'opacity-75'
      )}
    >
      <div className="flex items-start gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
          {row.order}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-foreground">{row.player.name}</h3>
              <WatchlistPlayerMeta row={row} />
            </div>

            <span
              className={cn(
                'shrink-0 rounded-md border px-1.5 py-0.5 text-[0.6875rem] font-semibold uppercase',
                getAvailabilityClassName(row)
              )}
            >
              {availabilityLabel}
            </span>
          </div>

          <WatchlistPlayerSignals row={row} />
          <WatchlistRowActions
            row={row}
            canActOnPlayer={canActOnPlayer}
            canDraft={canDraft}
            isLoading={isLoading}
            isWatchlistPending={isWatchlistPending}
            onAddToQueue={onAddToQueue}
            onDraftPlayer={onDraftPlayer}
            onRemoveFromWatchlist={onRemoveFromWatchlist}
          />
        </div>
      </div>
    </li>
  );
}

export default function DraftWatchlist({
  players,
  draftedPlayerIds,
  onDraftPlayer,
  canDraft,
  className,
  watchlistItems,
  onAddToQueue,
  queuedPlayerIds = [],
  pendingWatchlistPlayerIds = [],
  onRemoveFromWatchlist,
  isLoading = false,
}: WatchlistProps) {
  const [showAvailableOnly, setShowAvailableOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const draftedIds = useMemo(
    () => new Set(draftedPlayerIds.map((id) => String(id))),
    [draftedPlayerIds]
  );
  const queuedIds = useMemo(
    () => new Set(queuedPlayerIds.map((id) => String(id))),
    [queuedPlayerIds]
  );
  const pendingWatchlistIds = useMemo(
    () => new Set(pendingWatchlistPlayerIds.map((id) => String(id))),
    [pendingWatchlistPlayerIds]
  );
  const playerById = useMemo(
    () => new Map(players.map((player) => [String(player.id), player])),
    [players]
  );

  const rows = useMemo<WatchlistRow[]>(() => {
    const watchlistRows: WatchlistRow[] = [];

    watchlistItems.forEach((item, index) => {
      const playerId = String(item.playerId);
      const draftablePlayer = playerById.get(playerId) ?? null;
      const fallbackPlayer = item.player;

      if (!draftablePlayer && !fallbackPlayer) return;

      const player: WatchlistRow['player'] = draftablePlayer ?? {
        id: fallbackPlayer?.id ?? playerId,
        name: fallbackPlayer?.name ?? 'Unknown player',
        position: fallbackPlayer?.position ?? 'NA',
        club: fallbackPlayer?.club ?? 'Unknown club',
        isAvailable: false,
      };
      const isDrafted = draftedIds.has(String(player.id)) || Boolean(draftablePlayer?.draftedBy);
      const isUnavailable = !isDrafted && draftablePlayer?.isAvailable === false;

      watchlistRows.push({
        item,
        player,
        draftablePlayer,
        order: getWatchlistOrder(item, index),
        isDrafted,
        isUnavailable,
        isQueued: queuedIds.has(String(player.id)),
      });
    });

    return watchlistRows.sort(
      (a, b) => a.order - b.order || a.player.name.localeCompare(b.player.name)
    );
  }, [draftedIds, playerById, queuedIds, watchlistItems]);

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return rows.filter((row) => {
      if (showAvailableOnly && (row.isDrafted || row.isUnavailable)) return false;
      if (!query) return true;

      return (
        row.player.name.toLowerCase().includes(query) ||
        row.player.position.toLowerCase().includes(query) ||
        row.player.club.toLowerCase().includes(query)
      );
    });
  }, [rows, searchQuery, showAvailableOnly]);

  const availableCount = rows.filter((row) => !row.isDrafted && !row.isUnavailable).length;
  const draftedCount = rows.filter((row) => row.isDrafted).length;
  const unavailableCount = rows.filter((row) => row.isUnavailable).length;
  const emptyTitle = rows.length === 0 ? 'No players in watchlist' : 'No matching players';
  const emptyDetail =
    rows.length === 0
      ? 'Use the player market to add players you want to monitor.'
      : 'Adjust the watchlist search or availability filter.';

  return (
    <section className={cn('flex min-h-0 flex-1 flex-col gap-3', className)} aria-label="Watchlist">
      <div className="rounded-md border border-border bg-background p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Bookmark className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Watchlist
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {rows.length === 0 ? 'Track draft targets.' : `${rows.length} watched players`}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap justify-end gap-1 text-[0.6875rem] font-semibold">
            <span
              className={cn(
                'rounded-md border px-1.5 py-0.5',
                'border-[color:var(--draft-broadcast-green)]/40 bg-[color:var(--draft-broadcast-green-soft)] text-foreground'
              )}
            >
              {availableCount} available
            </span>
            <span className="rounded-md border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-destructive">
              {draftedCount} drafted
            </span>
            {unavailableCount > 0 && (
              <span className="rounded-md border border-[color:var(--draft-broadcast-yellow)]/50 bg-[color:var(--draft-broadcast-yellow-soft)] px-1.5 py-0.5 text-foreground">
                {unavailableCount} unavailable
              </span>
            )}
          </div>
        </div>

        <div className="mt-3 grid gap-2">
          <label className="relative block">
            <span className="sr-only">Search watchlist</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search watchlist..."
              className="h-10 w-full rounded-md border border-input bg-[color:var(--draft-broadcast-field)] py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </label>

          <label className="inline-flex w-fit items-center gap-2 text-xs font-medium text-muted-foreground">
            <input
              type="checkbox"
              checked={showAvailableOnly}
              onChange={(event) => setShowAvailableOnly(event.target.checked)}
              className="h-4 w-4 rounded border-border bg-background text-primary focus:ring-ring"
            />
            Available only
          </label>
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <div className="flex min-h-52 flex-1 flex-col items-center justify-center rounded-md border border-dashed border-border bg-muted/30 px-4 py-8 text-center">
          <Bookmark className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 text-sm font-semibold text-foreground">{emptyTitle}</p>
          <p className="mt-1 max-w-52 text-xs leading-5 text-muted-foreground">{emptyDetail}</p>
        </div>
      ) : (
        <ol
          className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1"
          aria-label="Watchlisted players"
        >
          {filteredRows.map((row) => {
            return (
              <WatchlistPlayerRow
                key={`${row.item.playerId}:${row.order}`}
                row={row}
                canDraft={canDraft}
                isLoading={isLoading}
                pendingWatchlistIds={pendingWatchlistIds}
                onAddToQueue={onAddToQueue}
                onDraftPlayer={onDraftPlayer}
                onRemoveFromWatchlist={onRemoveFromWatchlist}
              />
            );
          })}
        </ol>
      )}
    </section>
  );
}
