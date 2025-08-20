'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Zap, AlertCircle, Clock, TrendingUp } from 'lucide-react';

interface DraftPlayer {
  id: string;
  name: string;
  position: string;
  club: string;
  // Add additional stats that might be available
  avgPoints?: number;
  lastGamePoints?: number;
  byeWeek?: number;
  injuryStatus?: 'healthy' | 'questionable' | 'injured' | 'out';
}

interface WatchlistItem {
  playerId: string;
  rank: number;
  addedAt: string;
  notes?: string;
}

interface WatchlistProps {
  players: DraftPlayer[];
  draftedPlayerIds: string[];
  onDraftPlayer: (player: DraftPlayer) => void;
  canDraft: boolean;
  className?: string;
  // Add watchlist state as props
  watchlistItems: WatchlistItem[];
  onRemoveFromWatchlist: (playerId: string) => void;
}

export default function DraftWatchlist({
  players,
  draftedPlayerIds,
  onDraftPlayer,
  canDraft,
  className = '',
  watchlistItems,
  onRemoveFromWatchlist,
}: WatchlistProps) {
  const [showAvailableOnly, setShowAvailableOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  console.log('DraftWatchlist: Received watchlist items:', watchlistItems);

  // Get watchlisted players with their data (filter out drafted players by default)
  const watchlistedPlayers = watchlistItems
    .map((item) => {
      const player = players.find((p) => p.id === item.playerId);
      if (!player) return null;
      return { ...player, watchlistItem: item };
    })
    .filter(Boolean)
    .filter((player) => {
      // Always filter out drafted players unless explicitly showing all
      const isDrafted = draftedPlayerIds.includes(player!.id);
      if (isDrafted && showAvailableOnly) {
        return false;
      }
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          player!.name.toLowerCase().includes(query) ||
          player!.club.toLowerCase().includes(query) ||
          player!.position.toLowerCase().includes(query)
        );
      }
      return true;
    })
    .sort((a, b) => a!.watchlistItem.rank - b!.watchlistItem.rank);

  // Remove player from watchlist
  const removeFromWatchlist = useCallback(
    (playerId: string) => {
      onRemoveFromWatchlist(playerId);
    },
    [onRemoveFromWatchlist]
  );

  // Get player availability status
  const getAvailabilityStatus = (player: DraftPlayer) => {
    if (draftedPlayerIds.includes(player.id)) {
      return { status: 'drafted', color: 'bg-red-500', label: 'Drafted' };
    }
    return { status: 'available', color: 'bg-green-500', label: 'Available' };
  };

  // Get injury status styling
  const getInjuryStatus = (player: DraftPlayer) => {
    switch (player.injuryStatus) {
      case 'injured':
      case 'out':
        return { color: 'text-red-600', icon: AlertCircle, label: 'Injured' };
      case 'questionable':
        return { color: 'text-orange-600', icon: AlertCircle, label: 'Questionable' };
      default:
        return null;
    }
  };

  // Check if it's bye week
  const isByeWeek = (player: DraftPlayer) => {
    // This would need to be calculated based on current week
    // For now, just using the byeWeek property if available
    return player.byeWeek === 12; // Example current week
  };

  const availableCount = watchlistedPlayers.filter((p) => !draftedPlayerIds.includes(p!.id)).length;
  const draftedCount = watchlistedPlayers.filter((p) => draftedPlayerIds.includes(p!.id)).length;

  return (
    <div className={`bg-white rounded-lg border h-full flex flex-col ${className}`}>
      {/* Header */}
      <div className="p-4 border-b bg-gradient-to-r from-yellow-50 to-amber-50">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-lg flex items-center gap-2">
            <svg
              className="w-5 h-5 text-blue-600"
              fill="currentColor"
              viewBox="0 0 20 20"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-2.5L5 18V4z" />
            </svg>
            My Watchlist
          </h3>
          <div className="flex items-center gap-2 text-sm">
            <span className="bg-green-100 text-green-800 px-2 py-1 rounded-full">
              {availableCount} available
            </span>
            <span className="bg-red-100 text-red-800 px-2 py-1 rounded-full">
              {draftedCount} drafted
            </span>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="flex gap-3">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search watchlist..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-2 border rounded-md text-sm"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showAvailableOnly}
              onChange={(e) => setShowAvailableOnly(e.target.checked)}
              className="rounded"
            />
            Available only
          </label>
        </div>
      </div>

      {/* Watchlist Content */}
      <div className="flex-1 overflow-y-auto">
        {watchlistedPlayers.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <svg
              className="w-12 h-12 mx-auto mb-3 opacity-50"
              fill="currentColor"
              viewBox="0 0 20 20"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-2.5L5 18V4z" />
            </svg>
            <p className="text-lg font-medium mb-1">No players in watchlist</p>
            <p className="text-sm">
              {searchQuery
                ? 'No watchlisted players match your search'
                : 'Add players to your watchlist from the Available Players tab'}
            </p>
          </div>
        ) : (
          <div className="min-h-full">
            {watchlistedPlayers.map((player) => {
              if (!player) return null;

              const availability = getAvailabilityStatus(player);
              const injury = getInjuryStatus(player);
              const isBye = isByeWeek(player);
              const isDrafted = draftedPlayerIds.includes(player.id);

              return (
                <div
                  key={player.id}
                  className={`m-2 p-4 rounded-lg border transition-all ${
                    isDrafted
                      ? 'bg-gray-50 border-gray-300 opacity-75'
                      : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-md'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* Rank Number */}
                    <div
                      className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        isDrafted ? 'bg-gray-300 text-gray-500' : 'bg-blue-100 text-blue-800'
                      }`}
                    >
                      {player.watchlistItem.rank}
                    </div>

                    {/* Player Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4
                          className={`font-bold truncate ${isDrafted ? 'text-gray-500' : 'text-gray-900'}`}
                        >
                          {player.name}
                        </h4>
                        <div className={`w-2 h-2 rounded-full ${availability.color}`} />
                        {injury && <injury.icon className={`w-4 h-4 ${injury.color}`} />}
                        {isBye && <Clock className="w-4 h-4 text-orange-600" />}
                        {isDrafted && (
                          <span className="text-xs bg-red-100 text-red-800 px-2 py-0.5 rounded">
                            DRAFTED
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-4 text-sm text-gray-600 mb-2">
                        <span className="font-medium">{player.position}</span>
                        <span>{player.club}</span>
                        {player.avgPoints && (
                          <span className="flex items-center gap-1">
                            <TrendingUp className="w-3 h-3" />
                            {player.avgPoints.toFixed(1)} avg
                          </span>
                        )}
                      </div>

                      {/* Quick Stats */}
                      {(player.lastGamePoints || player.avgPoints) && (
                        <div className="flex items-center gap-3 text-xs text-gray-500">
                          {player.lastGamePoints && <span>Last: {player.lastGamePoints} pts</span>}
                          {player.byeWeek && <span>Bye: Week {player.byeWeek}</span>}
                        </div>
                      )}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {!isDrafted && canDraft && (
                        <button
                          onClick={() => onDraftPlayer(player)}
                          className="bg-blue-600 text-white px-3 py-1 rounded text-sm font-medium hover:bg-blue-700 transition-colors flex items-center gap-1"
                          title="Draft this player now"
                        >
                          <Zap className="w-3 h-3" />
                          Draft
                        </button>
                      )}

                      <button
                        onClick={() => removeFromWatchlist(player.id)}
                        className="text-gray-400 hover:text-red-600 transition-colors p-1"
                        title="Remove from watchlist"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      {watchlistedPlayers.length > 0 && (
        <div className="p-3 border-t bg-gray-50 text-center text-xs text-gray-500">
          {watchlistedPlayers.length} players • Drag to reorder • Click 🔖 to add more players
        </div>
      )}
    </div>
  );
}

// Export function to add to watchlist from other components
export const useWatchlist = () => {
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem('draft-watchlist');
    if (saved) {
      try {
        setWatchlistItems(JSON.parse(saved));
      } catch (error) {
        console.error('Failed to load watchlist:', error);
      }
    }
  }, []);

  // Auto-save to localStorage whenever watchlistItems changes
  useEffect(() => {
    console.log('useWatchlist hook: Saving to localStorage:', watchlistItems);
    localStorage.setItem('draft-watchlist', JSON.stringify(watchlistItems));
  }, [watchlistItems]);

  const isInWatchlist = useCallback(
    (playerId: string) => {
      const isInList = watchlistItems.some((item) => item.playerId === playerId);
      console.log('useWatchlist: isInWatchlist check for', playerId, ':', isInList);
      return isInList;
    },
    [watchlistItems]
  );

  const addToWatchlist = useCallback(
    (playerId: string) => {
      console.log('useWatchlist: Adding to watchlist:', playerId);
      const isAlreadyWatched = watchlistItems.some((item) => item.playerId === playerId);
      if (isAlreadyWatched) {
        console.log('useWatchlist: Player already in watchlist');
        return false;
      }

      const newRank = Math.max(0, ...watchlistItems.map((item) => item.rank)) + 1;
      const newItem: WatchlistItem = {
        playerId,
        rank: newRank,
        addedAt: new Date().toISOString(),
      };

      console.log('useWatchlist: Adding new item:', newItem);
      setWatchlistItems((prev) => {
        const updated = [...prev, newItem];
        console.log('useWatchlist: Updated watchlist items:', updated);
        return updated;
      });
      return true;
    },
    [watchlistItems]
  );

  const removeFromWatchlist = useCallback((playerId: string) => {
    setWatchlistItems((prev) => prev.filter((item) => item.playerId !== playerId));
    return true;
  }, []);

  const toggleWatchlist = useCallback(
    (playerId: string) => {
      if (isInWatchlist(playerId)) {
        return removeFromWatchlist(playerId);
      } else {
        return addToWatchlist(playerId);
      }
    },
    [isInWatchlist, addToWatchlist, removeFromWatchlist]
  );

  const getWatchlistPlayerIds = useCallback(() => {
    return watchlistItems.map((item) => item.playerId);
  }, [watchlistItems]);

  return {
    watchlistItems,
    isInWatchlist,
    addToWatchlist,
    removeFromWatchlist,
    toggleWatchlist,
    getWatchlistPlayerIds,
  };
};
