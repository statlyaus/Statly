'use client';

import { useState, useMemo, useEffect } from 'react';
import { Clock, Filter, Eye, User, Star } from 'lucide-react';

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
type ViewType = 'compact' | 'expanded';

export default function PickFeed({
  picks,
  participants,
  userMemberId,
  watchlistPlayerIds = [],
  className = '',
}: PickFeedProps) {
  const [filter, setFilter] = useState<FilterType>('all');
  const [viewType, setViewType] = useState<ViewType>('compact');
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

  return (
    <div className={`bg-white rounded-lg border h-full flex flex-col ${className}`}>
      {/* Header with filters and view controls */}
      <div className="p-4 border-b bg-gray-50">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-lg flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Pick Feed
          </h3>
          <div className="text-sm text-gray-500">
            {filteredPicks.length}{' '}
            {filter === 'all' ? 'picks' : filter === 'my-picks' ? 'my picks' : 'watchlist picks'}
          </div>
        </div>

        {/* Filter Buttons */}
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-gray-500" />
          <div className="flex gap-1">
            {[
              { key: 'all' as FilterType, label: 'All Picks', count: picks.length },
              {
                key: 'my-picks' as FilterType,
                label: 'My Picks',
                count: picks.filter((p) => p.member.id === userMemberId).length,
              },
              {
                key: 'watchlist' as FilterType,
                label: 'Watchlist',
                count: picks.filter((p) => watchlistPlayerIds.includes(p.player.id)).length,
              },
            ].map(({ key, label, count }) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                  filter === key
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {label} ({count})
              </button>
            ))}
          </div>
        </div>

        {/* View Controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-gray-500" />
            <div className="flex gap-1">
              {[
                { key: 'compact' as ViewType, label: 'Compact' },
                { key: 'expanded' as ViewType, label: 'Expanded' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setViewType(key)}
                  className={`px-2 py-1 text-xs rounded border transition-colors ${
                    viewType === key
                      ? 'bg-gray-600 text-white border-gray-600'
                      : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-1 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded"
            />
            Auto-scroll
          </label>
        </div>
      </div>

      {/* Pick Feed Content */}
      <div id="pick-feed-content" className="flex-1 overflow-y-auto">
        {filteredPicks.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Clock className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="text-lg font-medium mb-1">No picks yet</p>
            <p className="text-sm">
              {filter === 'all'
                ? 'Draft selections will appear here as they happen'
                : filter === 'my-picks'
                  ? 'Your picks will be shown here'
                  : 'Picks from your watchlist will appear here'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredPicks.map((pick) => (
              <div
                key={pick.id}
                className={`p-4 transition-colors hover:bg-gray-50 ${
                  isMyPick(pick) ? 'bg-green-50 border-l-4 border-green-500' : ''
                } ${
                  isWatchlistPick(pick) && !isMyPick(pick)
                    ? 'bg-orange-50 border-l-4 border-orange-500'
                    : ''
                }`}
              >
                {viewType === 'compact' ? (
                  /* Compact View */
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="flex-shrink-0">
                        <span className="inline-flex items-center justify-center w-8 h-8 bg-blue-100 text-blue-800 text-sm font-bold rounded-full">
                          {pick.overall}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900 truncate">
                            {pick.player.name}
                          </span>
                          <span className="text-sm text-gray-500">({pick.player.position})</span>
                          {isMyPick(pick) && <User className="w-4 h-4 text-green-600" />}
                          {isWatchlistPick(pick) && !isMyPick(pick) && (
                            <Star className="w-4 h-4 text-orange-600" />
                          )}
                          {pick.auto && (
                            <span className="text-xs bg-orange-100 text-orange-800 px-2 py-0.5 rounded">
                              AUTO
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-gray-600">
                          <span className="font-medium">{getTeamName(pick.slot)}</span>
                          <span className="mx-2">•</span>
                          <span>R{pick.round}</span>
                          <span className="mx-2">•</span>
                          <span>{pick.player.club}</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-gray-500 flex-shrink-0 ml-2">
                      {formatTimeAgo(pick.madeAt)}
                    </div>
                  </div>
                ) : (
                  /* Expanded View */
                  <div className="space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center justify-center w-10 h-10 bg-blue-100 text-blue-800 text-lg font-bold rounded-full">
                          {pick.overall}
                        </span>
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-bold text-lg text-gray-900">{pick.player.name}</h4>
                            {isMyPick(pick) && <User className="w-5 h-5 text-green-600" />}
                            {isWatchlistPick(pick) && !isMyPick(pick) && (
                              <Star className="w-5 h-5 text-orange-600" />
                            )}
                            {pick.auto && (
                              <span className="text-xs bg-orange-100 text-orange-800 px-2 py-1 rounded">
                                AUTO PICK
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-gray-600">
                            <span className="font-medium">{pick.player.position}</span>
                            <span className="mx-2">•</span>
                            <span>{pick.player.club}</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right text-xs text-gray-500">
                        <div>{formatTimeAgo(pick.madeAt)}</div>
                        <div>{new Date(pick.madeAt).toLocaleTimeString()}</div>
                      </div>
                    </div>

                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="flex items-center justify-between text-sm">
                        <div>
                          <span className="font-medium text-gray-900">
                            {getTeamName(pick.slot)}
                          </span>
                          <span className="text-gray-500 ml-2">(Slot {pick.slot})</span>
                        </div>
                        <div className="text-gray-600">
                          Round {pick.round}, Pick {pick.overall}
                        </div>
                      </div>
                    </div>

                    {/* Placeholder for player stats card in expanded view */}
                    <div className="bg-blue-50 rounded-lg p-3 text-sm">
                      <div className="text-blue-800 font-medium mb-1">Quick Stats</div>
                      <div className="text-blue-700 text-xs">
                        Position: {pick.player.position} | Club: {pick.player.club}
                        {/* Add more stats here when available */}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer with pick count */}
      {filteredPicks.length > 0 && (
        <div className="p-3 border-t bg-gray-50 text-center text-xs text-gray-500">
          Showing {filteredPicks.length} of {picks.length} total picks
        </div>
      )}
    </div>
  );
}
