'use client';

import { useState, useMemo, useEffect } from 'react';

import Image from 'next/image';
import { Clock3, Sparkles, User, Star, ChevronRight } from 'lucide-react';

import { getTeamLogo } from '@/lib/teamLogos';
import { cn } from '@/lib/utils';

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
  contentId?: string;
}

type FilterType = 'all' | 'my-picks' | 'watchlist';

export default function PickFeed({
  picks,
  participants,
  userMemberId,
  watchlistPlayerIds = [],
  className = '',
  contentId = 'pick-feed-content',
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

  const getPickCardClasses = (pick: Pick) => {
    if (isMyPick(pick)) {
      return 'border-primary bg-primary/10';
    }

    if (isWatchlistPick(pick)) {
      return 'border-accent bg-accent/40';
    }

    return 'border-border bg-card hover:bg-accent/50';
  };

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
        const feedElement = document.getElementById(contentId);
        if (feedElement) {
          feedElement.scrollTop = 0;
        }
      }, 100);
    }
  }, [picks.length, autoScroll, contentId]);

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
      className={cn(
        'overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-sm',
        className
      )}
      aria-label="Pick feed"
    >
      <div className="border-b border-border bg-muted px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-normal text-muted-foreground">
              <Clock3 className="size-3.5" />
              Draft Flow
            </div>
            <h3 className="mt-2 text-lg font-semibold text-foreground">Pick Feed</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Latest selections, auto-picks, and your watchlist hits.
            </p>
          </div>
          <div className="rounded-lg bg-primary px-3 py-2 text-right text-primary-foreground">
            <div className="text-[10px] uppercase tracking-normal opacity-80">Visible</div>
            <div className="text-lg font-semibold leading-none">{filteredPicks.length}</div>
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
                className={cn(
                  'rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  selected
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-card-foreground hover:bg-accent hover:text-accent-foreground'
                )}
                aria-pressed={selected}
              >
                <div className="text-xs font-medium">{label}</div>
                <div
                  className={cn(
                    'mt-1 text-lg font-semibold leading-none',
                    selected ? 'text-primary-foreground' : 'text-foreground'
                  )}
                >
                  {count}
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
          <div>
            <div className="text-xs font-medium text-card-foreground">Live rail</div>
            <div className="text-[11px] text-muted-foreground">
              {autoScroll ? 'Auto-scroll on new picks' : 'Manual scroll mode'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setAutoScroll((value) => !value)}
            className={cn(
              'inline-flex h-7 w-12 items-center rounded-full px-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              autoScroll ? 'bg-primary' : 'bg-muted'
            )}
            aria-pressed={autoScroll}
            aria-label="Toggle auto-scroll"
          >
            <span
              className={cn(
                'size-5 rounded-full bg-background shadow-sm transition-transform',
                autoScroll ? 'translate-x-5' : 'translate-x-0'
              )}
            />
          </button>
        </div>
      </div>

      <div id={contentId} className="max-h-[calc(100vh-220px)] overflow-y-auto">
        {filteredPicks.length === 0 ? (
          <div className="px-6 py-14 text-center text-muted-foreground">
            <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Sparkles className="size-7" />
            </div>
            <p className="mb-1 text-lg font-semibold text-foreground">No picks yet</p>
            <p className="text-sm leading-6">
              {filter === 'all'
                ? 'Draft selections will appear here as they happen'
                : filter === 'my-picks'
                  ? 'Your picks will be shown here'
                  : 'Picks from your watchlist will appear here'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 p-3">
            {filteredPicks.map((pick) => (
              <div
                key={pick.id}
                className={cn('rounded-lg border p-4 transition-colors', getPickCardClasses(pick))}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex size-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
                      {pick.overall}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <Image
                            src={getTeamLogo(pick.player.club)}
                            alt={`${pick.player.club} logo`}
                            width={24}
                            height={24}
                            className="size-6 shrink-0"
                          />
                          <h4 className="truncate text-sm font-semibold text-foreground">
                            {pick.player.name}
                          </h4>
                        </div>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {pick.player.position}
                        </span>
                        {pick.auto && (
                          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
                            Auto
                          </span>
                        )}
                        {isMyPick(pick) && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">
                            <User className="size-3" />
                            Mine
                          </span>
                        )}
                        {isWatchlistPick(pick) && !isMyPick(pick) && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground">
                            <Star className="size-3" />
                            Watchlist
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{getTeamName(pick.slot)}</span>
                        <span>Round {pick.round}</span>
                        <span>{pick.player.club}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-medium text-muted-foreground">
                      {formatTimeAgo(pick.madeAt)}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {new Date(pick.madeAt).toLocaleTimeString([], {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                  <span>
                    Slot {pick.slot}
                    <span className="mx-1.5 text-muted-foreground">/</span>
                    Pick {pick.overall}
                  </span>
                  <span className="inline-flex items-center gap-1 font-medium text-foreground">
                    View context
                    <ChevronRight className="size-3.5" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {filteredPicks.length > 0 && (
        <div className="border-t border-border bg-muted px-4 py-3 text-center text-xs text-muted-foreground">
          Showing {filteredPicks.length} of {picks.length} total picks
        </div>
      )}
    </aside>
  );
}
