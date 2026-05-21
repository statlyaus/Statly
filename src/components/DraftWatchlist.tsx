'use client';

import { useMemo, useState } from 'react';

import { Bookmark, Search, Star, Trash2, Zap } from 'lucide-react';

import { TeamLogo } from '@/components/TeamLogo';
import type { DraftWatchlistItem } from '@/contexts/DraftContext';

interface WatchlistPlayer {
  id: string;
  name: string;
  position: string;
  club: string;
  adp?: number;
  avgPoints?: number;
  isAvailable?: boolean;
}

interface WatchlistProps {
  players: WatchlistPlayer[];
  draftedPlayerIds: string[];
  onDraftPlayer: (player: WatchlistPlayer) => void;
  onAddToQueue: (player: WatchlistPlayer) => void | Promise<void>;
  canDraft: boolean;
  variant?: 'default' | 'rail';
  className?: string;
  watchlistItems: DraftWatchlistItem[];
  queuedPlayerIds: string[];
  onRemoveFromWatchlist: (playerId: string) => void | Promise<void>;
  isLoading?: boolean;
}

export default function DraftWatchlist({
  players,
  draftedPlayerIds,
  onDraftPlayer,
  onAddToQueue,
  canDraft,
  variant = 'default',
  className = '',
  watchlistItems,
  queuedPlayerIds,
  onRemoveFromWatchlist,
  isLoading = false,
}: WatchlistProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showAvailableOnly, setShowAvailableOnly] = useState(false);

  const playersById = useMemo(
    () => new Map(players.map((player) => [String(player.id), player] as const)),
    [players]
  );
  const draftedIds = useMemo(() => new Set(draftedPlayerIds.map(String)), [draftedPlayerIds]);
  const queuedIds = useMemo(() => new Set(queuedPlayerIds.map(String)), [queuedPlayerIds]);

  const watchlistEntries = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return watchlistItems
      .map((item) => {
        const livePlayer = playersById.get(String(item.playerId));
        const basePlayer = item.player;
        const player: WatchlistPlayer = livePlayer ?? {
          id: basePlayer.id,
          name: basePlayer.name,
          position: basePlayer.position,
          club: basePlayer.club,
          isAvailable: !draftedIds.has(String(item.playerId)),
        };

        const drafted = draftedIds.has(String(item.playerId));
        return {
          item,
          player,
          drafted,
        };
      })
      .filter(({ player, drafted }) => {
        if (showAvailableOnly && drafted) return false;
        if (!query) return true;

        return (
          player.name.toLowerCase().includes(query) ||
          player.club.toLowerCase().includes(query) ||
          player.position.toLowerCase().includes(query)
        );
      })
      .sort((a, b) => Number(a.item.priority ?? 0) - Number(b.item.priority ?? 0));
  }, [draftedIds, playersById, searchQuery, showAvailableOnly, watchlistItems]);

  const availableCount = watchlistEntries.filter((entry) => !entry.drafted).length;
  const draftedCount = watchlistEntries.filter((entry) => entry.drafted).length;

  if (variant === 'rail') {
    return (
      <section className={`rounded-3xl border border-border bg-white shadow-sm ${className}`}>
        <div className="border-b border-border px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-warning">
                Watchlist
              </div>
              <h3 className="mt-1 text-base font-semibold text-foreground">Scout and promote</h3>
            </div>
            <span className="rounded-full bg-warning/10 px-3 py-1 text-xs font-medium text-warning">
              {availableCount} live
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Track targets here, then move the best options straight into your queue.
          </p>
        </div>

        <div className="p-4">
          {watchlistEntries.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
              Watch players from the board to keep a live shortlist of targets.
            </p>
          ) : (
            <div className="space-y-2">
              {watchlistEntries.slice(0, 6).map(({ item, player, drafted }) => {
                const isQueued = queuedIds.has(String(player.id));

                return (
                  <article
                    key={item.id}
                    className={`rounded-2xl border px-3 py-3 ${
                      drafted ? 'border-border bg-muted' : 'border-warning/20 bg-white'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-2xl text-xs font-semibold ${
                          drafted ? 'bg-muted text-muted-foreground' : 'bg-warning/10 text-warning'
                        }`}
                      >
                        #{item.priority}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="truncate text-sm font-semibold text-foreground">
                            {player.name}
                          </h4>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
                            {player.position}
                          </span>
                        </div>
                        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <TeamLogo team={player.club} size={14} withCircle decorative />
                            {player.club}
                          </span>
                          <span>
                            {drafted ? '· Drafted' : isQueued ? '· Queued' : '· Available'}
                          </span>
                        </p>

                        {!drafted && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void onAddToQueue(player)}
                              disabled={isLoading || isQueued}
                              className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                                isQueued
                                  ? 'border border-info/20 bg-info/10 text-info'
                                  : 'border border-border bg-white text-foreground hover:bg-muted'
                              }`}
                            >
                              {isQueued ? 'Queued' : 'Queue'}
                            </button>
                            {canDraft && (
                              <button
                                type="button"
                                onClick={() => onDraftPlayer(player)}
                                disabled={isLoading}
                                className="inline-flex items-center gap-1 rounded-full bg-info px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-info disabled:opacity-50"
                              >
                                <Zap className="h-3.5 w-3.5" />
                                Draft
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => void onRemoveFromWatchlist(player.id)}
                        disabled={isLoading}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-2xl text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                        aria-label={`Remove ${player.name} from watchlist`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    );
  }

  if (watchlistItems.length === 0) {
    return (
      <div
        className={`rounded-3xl border border-dashed border-border bg-white px-6 py-14 text-center ${className}`}
      >
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-warning/10 text-warning">
          <Bookmark className="h-6 w-6" />
        </div>
        <h3 className="text-xl font-semibold text-foreground">Watchlist is empty</h3>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          Star players from the board to keep a live shortlist of targets and drafted misses in one
          place.
        </p>
      </div>
    );
  }

  return (
    <section
      className={`overflow-hidden rounded-3xl border border-border bg-white shadow-sm ${className}`}
    >
      <div className="border-b border-border bg-[linear-gradient(180deg,var(--warning)_0%,var(--muted)_100%)] px-6 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-warning">
              Draft Targets
            </div>
            <h3 className="mt-2 text-xl font-semibold text-foreground">Your Watchlist</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Track priority targets, keep drafted players visible, and jump on available value.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-success/10 px-3 py-1 font-medium text-success">
              {availableCount} available
            </span>
            <span className="rounded-full bg-muted px-3 py-1 font-medium text-foreground">
              {draftedCount} drafted
            </span>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 lg:flex-row">
          <label className="relative flex-1">
            <span className="sr-only">Search watchlist players</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search your watchlist"
              className="w-full rounded-2xl border border-warning/20 bg-white/80 py-2.5 pl-10 pr-4 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-warning/20"
            />
          </label>
          <label className="inline-flex items-center gap-3 rounded-2xl border border-warning/20 bg-white/70 px-4 py-2.5 text-sm text-foreground">
            <input
              type="checkbox"
              checked={showAvailableOnly}
              onChange={(event) => setShowAvailableOnly(event.target.checked)}
              className="rounded border-border text-warning focus:ring-warning"
            />
            Available only
          </label>
        </div>
      </div>

      <div className="max-h-[720px] overflow-y-auto p-4">
        {watchlistEntries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-muted px-4 py-12 text-center">
            <p className="text-lg font-semibold text-foreground">No watchlist players match</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Change your search or availability filter to bring entries back into view.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {watchlistEntries.map(({ item, player, drafted }) => {
              const isQueued = queuedIds.has(String(player.id));

              return (
                <article
                  key={item.id}
                  className={`rounded-2xl border px-4 py-4 transition-colors ${
                    drafted
                      ? 'border-border bg-muted'
                      : 'border-warning/20 bg-white hover:border-warning/20'
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div
                      className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl text-sm font-semibold ${
                        drafted ? 'bg-muted text-muted-foreground' : 'bg-warning/10 text-warning'
                      }`}
                    >
                      #{item.priority}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="truncate text-sm font-semibold text-foreground">
                          {player.name}
                        </h4>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
                          {player.position}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            drafted ? 'bg-muted text-foreground' : 'bg-success/10 text-success'
                          }`}
                        >
                          {drafted ? 'Drafted' : 'Available'}
                        </span>
                        {isQueued && (
                          <span className="rounded-full bg-info/10 px-2 py-0.5 text-[11px] font-medium text-info">
                            Queued
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <TeamLogo team={player.club} size={14} withCircle decorative />
                          {player.club}
                        </span>
                        {typeof player.adp === 'number' && <span>ADP {player.adp}</span>}
                        {typeof player.avgPoints === 'number' && (
                          <span>{player.avgPoints.toFixed(1)} avg</span>
                        )}
                      </div>
                      {item.notes && (
                        <p className="mt-2 text-sm text-muted-foreground">{item.notes}</p>
                      )}
                    </div>

                    <div className="flex flex-shrink-0 items-center gap-2">
                      {!drafted && (
                        <button
                          type="button"
                          onClick={() => void onAddToQueue(player)}
                          disabled={isLoading || isQueued}
                          className={`inline-flex items-center gap-1 rounded-2xl px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                            isQueued
                              ? 'border border-info/20 bg-info/10 text-info'
                              : 'border border-border bg-white text-foreground hover:bg-muted'
                          }`}
                        >
                          {isQueued ? 'Queued' : 'Queue'}
                        </button>
                      )}
                      {!drafted && canDraft && (
                        <button
                          type="button"
                          onClick={() => onDraftPlayer(player)}
                          disabled={isLoading}
                          className="inline-flex items-center gap-1 rounded-2xl bg-info px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-info disabled:opacity-50"
                        >
                          <Zap className="h-4 w-4" />
                          Draft
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void onRemoveFromWatchlist(player.id)}
                        disabled={isLoading}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-2xl text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                        aria-label={`Remove ${player.name} from watchlist`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-border bg-muted px-6 py-3 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <Star className="h-4 w-4 text-warning" />
          Watchlist updates are saved to this draft and will survive refreshes and reconnects.
        </div>
      </div>
    </section>
  );
}
