'use client';

import { useState, useMemo, useEffect } from 'react';

import { Clock3, Sparkles, User, Star, ChevronRight } from 'lucide-react';

import { TeamLogo } from '@/components/TeamLogo';

interface DraftPlayer {
  id: string;
  name: string;
  position: string;
  club: string;
}

interface Pick {
  id: string;
  overall: number;
  round: number;
  slot: number;
  player: DraftPlayer;
  member: {
    id: string;
    displayName: string;
  };
  auto: boolean;
  madeAt: string;
}

interface DraftParticipant {
  slot: number;
  member: {
    id: string;
    userId: string;
    displayName: string;
    email: string;
  };
}

interface PickFeedProps {
  picks: Pick[];
  participants: DraftParticipant[];
  userMemberId: string;
  watchlistPlayerIds?: string[];
  className?: string;
}

type FilterType = 'all' | 'my-picks' | 'watchlist';

export default function PickFeed({
  picks,
  participants,
  userMemberId,
  watchlistPlayerIds = [],
  className = '',
}: PickFeedProps) {
  const [filter, setFilter] = useState<FilterType>('all');
  const [autoScroll, setAutoScroll] = useState(true);

  // Filter picks based on selected filter
  const filteredPicks = useMemo(() => {
    const sortedPicks = [...picks].sort((a, b) => b.overall - a.overall); // Most recent first

    switch (filter) {
      case 'my-picks':
        return sortedPicks.filter((pick) => pick.member.id === userMemberId);
      case 'watchlist':
        return sortedPicks.filter((pick) => watchlistPlayerIds.includes(pick.player.id));
      default:
        return sortedPicks;
    }
  }, [picks, filter, userMemberId, watchlistPlayerIds]);

  // Get team name for a slot
  const getTeamName = (slot: number) => {
    const participant = participants.find((p) => p.slot === slot);
    return participant?.member.displayName || `Team ${slot}`;
  };

  // Check if pick is mine
  const isMyPick = (pick: Pick) => pick.member.id === userMemberId;

  // Check if pick was from watchlist
  const isWatchlistPick = (pick: Pick) => watchlistPlayerIds.includes(pick.player.id);

  // Format time ago
  const formatTimeAgo = (dateString: string) => {
    const now = new Date();
    const pickTime = new Date(dateString);
    const diffMs = now.getTime() - pickTime.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return pickTime.toLocaleDateString();
  };

  // Auto-scroll to top when new picks come in (if enabled)
  useEffect(() => {
    if (autoScroll && picks.length > 0) {
      // Small delay to ensure DOM is updated
      setTimeout(() => {
        const feedElement = document.getElementById('pick-feed-content');
        if (feedElement) {
          feedElement.scrollTop = 0;
        }
      }, 100);
    }
  }, [picks.length, autoScroll]);

  const filterOptions = [
    { key: 'all' as FilterType, label: 'All', count: picks.length },
    {
      key: 'my-picks' as FilterType,
      label: 'Mine',
      count: picks.filter((pick) => pick.member.id === userMemberId).length,
    },
    {
      key: 'watchlist' as FilterType,
      label: 'Watchlist',
      count: picks.filter((pick) => watchlistPlayerIds.includes(pick.player.id)).length,
    },
  ];

  return (
    <aside
      className={`overflow-hidden rounded-3xl border border-slate-200 bg-white/95 shadow-sm ${className}`}
      aria-label="Pick feed"
    >
      <div className="border-b border-slate-200 bg-slate-50/80 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              <Clock3 className="h-3.5 w-3.5" />
              Activity rail
            </div>
            <h3 className="mt-2 text-base font-semibold text-slate-950">Pick Feed</h3>
            <p className="mt-1 text-sm text-slate-600">
              Recent picks, auto-picks, and watchlist hits.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-right">
            <div className="text-[10px] uppercase tracking-[0.22em] text-slate-400">Visible</div>
            <div className="text-base font-semibold leading-none text-slate-950">
              {filteredPicks.length}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {filterOptions.map(({ key, label, count }) => {
            const selected = filter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`rounded-2xl border px-3 py-2 text-left transition-colors ${
                  selected
                    ? 'border-slate-300 bg-white text-slate-950 shadow-sm'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white'
                }`}
                aria-pressed={selected}
              >
                <div className="text-xs font-medium">{label}</div>
                <div
                  className={`mt-1 text-lg font-semibold leading-none ${
                    selected ? 'text-slate-950' : 'text-slate-700'
                  }`}
                >
                  {count}
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-3 py-2">
          <div>
            <div className="text-xs font-medium text-slate-700">Live rail</div>
            <div className="text-[11px] text-slate-500">
              {autoScroll ? 'Auto-scroll on new picks' : 'Manual scroll mode'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setAutoScroll((value) => !value)}
            className={`inline-flex h-7 w-12 items-center rounded-full px-1 transition-colors ${
              autoScroll ? 'bg-emerald-500' : 'bg-slate-300'
            }`}
            aria-pressed={autoScroll}
            aria-label="Toggle auto-scroll"
          >
            <span
              className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                autoScroll ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      <div id="pick-feed-content" className="max-h-[calc(100vh-220px)] overflow-y-auto">
        {filteredPicks.length === 0 ? (
          <div className="px-6 py-14 text-center text-slate-500">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              <Sparkles className="h-7 w-7" />
            </div>
            <p className="text-lg font-semibold text-slate-900 mb-1">No picks yet</p>
            <p className="text-sm leading-6">
              {filter === 'all'
                ? 'Draft selections will appear here as they happen'
                : filter === 'my-picks'
                  ? 'Your picks will be shown here'
                  : 'Picks from your watchlist will appear here'}
            </p>
          </div>
        ) : (
          <div className="space-y-3 p-3">
            {filteredPicks.map((pick) => (
              <div
                key={pick.id}
                className={`rounded-2xl border p-4 transition-colors ${
                  isMyPick(pick)
                    ? 'border-emerald-200 bg-emerald-50/60'
                    : isWatchlistPick(pick)
                      ? 'border-amber-200 bg-amber-50/60'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-sm font-semibold text-white">
                      {pick.overall}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="truncate text-sm font-semibold text-slate-950">
                          {pick.player.name}
                        </h4>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                          {pick.player.position}
                        </span>
                        {pick.auto && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                            Auto
                          </span>
                        )}
                        {isMyPick(pick) && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                            <User className="h-3 w-3" />
                            Mine
                          </span>
                        )}
                        {isWatchlistPick(pick) && !isMyPick(pick) && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                            <Star className="h-3 w-3" />
                            Watchlist
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                        <span className="font-medium text-slate-700">{getTeamName(pick.slot)}</span>
                        <span>Round {pick.round}</span>
                        <span className="inline-flex items-center gap-1">
                          <TeamLogo team={pick.player.club} size={14} withCircle decorative />
                          {pick.player.club}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-medium text-slate-500">
                      {formatTimeAgo(pick.madeAt)}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-400">
                      {new Date(pick.madeAt).toLocaleTimeString([], {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <span>
                    Slot {pick.slot}
                    <span className="mx-1.5 text-slate-300">•</span>
                    Pick {pick.overall}
                  </span>
                  <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                    View context
                    <ChevronRight className="h-3.5 w-3.5" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {filteredPicks.length > 0 && (
        <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-center text-xs text-slate-500">
          Showing {filteredPicks.length} of {picks.length} total picks
        </div>
      )}
    </aside>
  );
}
