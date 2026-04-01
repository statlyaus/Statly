'use client';

import { useMemo, useState } from 'react';

import { Bookmark, Search, Star, Trash2, Zap } from 'lucide-react';

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

  if (watchlistItems.length === 0) {
    return (
      <div
        className={`rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center ${className}`}
      >
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-amber-600">
          <Bookmark className="h-6 w-6" />
        </div>
        <h3 className="text-xl font-semibold text-slate-950">Watchlist is empty</h3>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">
          Star players from the board to keep a live shortlist of targets and drafted misses in one
          place.
        </p>
      </div>
    );
  }

  return (
    <section className={`overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm ${className}`}>
      <div className="border-b border-slate-200 bg-[linear-gradient(180deg,#fffbeb_0%,#fef3c7_100%)] px-6 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-700">
              Draft Targets
            </div>
            <h3 className="mt-2 text-xl font-semibold text-slate-950">Your Watchlist</h3>
            <p className="mt-1 text-sm text-slate-600">
              Track priority targets, keep drafted players visible, and jump on available value.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-emerald-100 px-3 py-1 font-medium text-emerald-800">
              {availableCount} available
            </span>
            <span className="rounded-full bg-slate-200 px-3 py-1 font-medium text-slate-700">
              {draftedCount} drafted
            </span>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 lg:flex-row">
          <label className="relative flex-1">
            <span className="sr-only">Search watchlist players</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search your watchlist"
              className="w-full rounded-2xl border border-amber-200 bg-white/80 py-2.5 pl-10 pr-4 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-amber-400"
            />
          </label>
          <label className="inline-flex items-center gap-3 rounded-2xl border border-amber-200 bg-white/70 px-4 py-2.5 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={showAvailableOnly}
              onChange={(event) => setShowAvailableOnly(event.target.checked)}
              className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
            />
            Available only
          </label>
        </div>
      </div>

      <div className="max-h-[720px] overflow-y-auto p-4">
        {watchlistEntries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-12 text-center">
            <p className="text-lg font-semibold text-slate-950">No watchlist players match</p>
            <p className="mt-2 text-sm text-slate-600">
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
                    ? 'border-slate-200 bg-slate-50'
                    : 'border-amber-200 bg-white hover:border-amber-300'
                }`}
              >
                <div className="flex items-start gap-4">
                  <div
                    className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl text-sm font-semibold ${
                      drafted ? 'bg-slate-200 text-slate-600' : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    #{item.priority}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="truncate text-sm font-semibold text-slate-950">{player.name}</h4>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                        {player.position}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          drafted
                            ? 'bg-slate-200 text-slate-700'
                            : 'bg-emerald-100 text-emerald-700'
                        }`}
                      >
                        {drafted ? 'Drafted' : 'Available'}
                      </span>
                      {isQueued && (
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                          Queued
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                      <span>{player.club}</span>
                      {typeof player.adp === 'number' && <span>ADP {player.adp}</span>}
                      {typeof player.avgPoints === 'number' && (
                        <span>{player.avgPoints.toFixed(1)} avg</span>
                      )}
                    </div>
                    {item.notes && <p className="mt-2 text-sm text-slate-600">{item.notes}</p>}
                  </div>

                  <div className="flex flex-shrink-0 items-center gap-2">
                    {!drafted && (
                      <button
                        type="button"
                        onClick={() => void onAddToQueue(player)}
                        disabled={isLoading || isQueued}
                        className={`inline-flex items-center gap-1 rounded-2xl px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                          isQueued
                            ? 'border border-blue-200 bg-blue-50 text-blue-700'
                            : 'border border-slate-300 bg-white text-slate-900 hover:bg-slate-50'
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
                        className="inline-flex items-center gap-1 rounded-2xl bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                      >
                        <Zap className="h-4 w-4" />
                        Draft
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void onRemoveFromWatchlist(player.id)}
                      disabled={isLoading}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-2xl text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
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

      <div className="border-t border-slate-200 bg-slate-50 px-6 py-3 text-sm text-slate-600">
        <div className="flex items-center gap-2">
          <Star className="h-4 w-4 text-amber-500" />
          Watchlist updates are saved to this draft and will survive refreshes and reconnects.
        </div>
      </div>
    </section>
  );
}
