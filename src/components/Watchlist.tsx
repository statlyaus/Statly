'use client';

import { useState, useEffect, useCallback } from 'react';

import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { Star, X, Zap, AlertCircle, Clock, TrendingUp } from 'lucide-react';

import { TeamLogo } from '@/components/TeamLogo';

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
}

export default function Watchlist({
  players,
  draftedPlayerIds,
  onDraftPlayer,
  canDraft,
  className = '',
}: WatchlistProps) {
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>([]);
  const [showAvailableOnly, setShowAvailableOnly] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Load watchlist from localStorage
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

  // Save watchlist to localStorage
  useEffect(() => {
    localStorage.setItem('draft-watchlist', JSON.stringify(watchlistItems));
  }, [watchlistItems]);

  // Get watchlisted players with their data
  const watchlistedPlayers = watchlistItems
    .map((item) => {
      const player = players.find((p) => p.id === item.playerId);
      if (!player) return null;
      return { ...player, watchlistItem: item };
    })
    .filter(Boolean)
    .filter((player) => {
      if (showAvailableOnly && draftedPlayerIds.includes(player!.id)) {
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
  const removeFromWatchlist = useCallback((playerId: string) => {
    setWatchlistItems((prev) => prev.filter((item) => item.playerId !== playerId));
  }, []);

  // Handle drag and drop reordering
  const handleDragEnd = useCallback(
    (result: DropResult) => {
      if (!result.destination) return;

      const items = Array.from(watchlistItems);
      const [reorderedItem] = items.splice(result.source.index, 1);
      items.splice(result.destination.index, 0, reorderedItem);

      // Update ranks based on new order
      const updatedItems = items.map((item, index) => ({
        ...item,
        rank: index + 1,
      }));

      setWatchlistItems(updatedItems);
    },
    [watchlistItems]
  );

  // Get player availability status
  const getAvailabilityStatus = (player: DraftPlayer) => {
    if (draftedPlayerIds.includes(player.id)) {
      return { status: 'drafted', color: 'bg-destructive', label: 'Drafted' };
    }
    return { status: 'available', color: 'bg-success', label: 'Available' };
  };

  // Get injury status styling
  const getInjuryStatus = (player: DraftPlayer) => {
    switch (player.injuryStatus) {
      case 'injured':
      case 'out':
        return { color: 'text-destructive', icon: AlertCircle, label: 'Injured' };
      case 'questionable':
        return { color: 'text-warning', icon: AlertCircle, label: 'Questionable' };
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
      <div className="p-4 border-b bg-gradient-to-r from-warning/10 to-warning/10">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-lg flex items-center gap-2">
            <Star className="w-5 h-5 text-warning" />
            My Watchlist
          </h3>
          <div className="flex items-center gap-2 text-sm">
            <span className="bg-success/10 text-success px-2 py-1 rounded-full">
              {availableCount} available
            </span>
            <span className="bg-destructive/10 text-destructive px-2 py-1 rounded-full">
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
          <div className="p-8 text-center text-muted-foreground">
            <Star className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="text-lg font-medium mb-1">No players in watchlist</p>
            <p className="text-sm">
              {searchQuery
                ? 'No watchlisted players match your search'
                : 'Add players to your watchlist from the Available Players tab'}
            </p>
          </div>
        ) : (
          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="watchlist">
              {(provided, snapshot) => (
                <div
                  {...provided.droppableProps}
                  ref={provided.innerRef}
                  className={`min-h-full ${snapshot.isDraggingOver ? 'bg-info/10' : ''}`}
                >
                  {watchlistedPlayers.map((player, index) => {
                    if (!player) return null;

                    const availability = getAvailabilityStatus(player);
                    const injury = getInjuryStatus(player);
                    const isBye = isByeWeek(player);
                    const isDrafted = draftedPlayerIds.includes(player.id);

                    return (
                      <Draggable
                        key={player.id}
                        draggableId={player.id}
                        index={index}
                        isDragDisabled={isDrafted}
                      >
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            className={`m-2 p-4 rounded-lg border transition-all ${
                              snapshot.isDragging
                                ? 'shadow-lg bg-white border-info/20'
                                : isDrafted
                                  ? 'bg-muted border-border opacity-75'
                                  : 'bg-white border-border hover:border-border hover:shadow-md'
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              {/* Drag Handle */}
                              <div
                                {...provided.dragHandleProps}
                                className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                                  isDrafted
                                    ? 'bg-muted text-muted-foreground'
                                    : 'bg-info/10 text-info'
                                }`}
                              >
                                {player.watchlistItem.rank}
                              </div>

                              {/* Player Info */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <h4
                                    className={`font-bold truncate ${isDrafted ? 'text-muted-foreground' : 'text-foreground'}`}
                                  >
                                    {player.name}
                                  </h4>
                                  <div className={`w-2 h-2 rounded-full ${availability.color}`} />
                                  {injury && (
                                    <div title={injury.label}>
                                      <injury.icon className={`w-4 h-4 ${injury.color}`} />
                                    </div>
                                  )}
                                  {isBye && (
                                    <div title="Bye week">
                                      <Clock className="w-4 h-4 text-warning" />
                                    </div>
                                  )}
                                  {isDrafted && (
                                    <span className="text-xs bg-destructive/10 text-destructive px-2 py-0.5 rounded">
                                      DRAFTED
                                    </span>
                                  )}
                                </div>

                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground mb-2">
                                  <span className="font-medium">{player.position}</span>
                                  <span className="inline-flex items-center gap-1">
                                    <TeamLogo team={player.club} size={14} withCircle decorative />
                                    {player.club}
                                  </span>
                                  {player.avgPoints && (
                                    <span className="flex items-center gap-1">
                                      <TrendingUp className="w-3 h-3" />
                                      {player.avgPoints.toFixed(1)} avg
                                    </span>
                                  )}
                                </div>

                                {/* Quick Stats */}
                                {(player.lastGamePoints || player.avgPoints) && (
                                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                    {player.lastGamePoints && (
                                      <span>Last: {player.lastGamePoints} pts</span>
                                    )}
                                    {player.byeWeek && <span>Bye: Week {player.byeWeek}</span>}
                                  </div>
                                )}
                              </div>

                              {/* Action Buttons */}
                              <div className="flex items-center gap-2 flex-shrink-0">
                                {!isDrafted && canDraft && (
                                  <button
                                    onClick={() => onDraftPlayer(player)}
                                    className="bg-success text-white px-3 py-1 rounded text-sm font-medium hover:bg-success transition-colors flex items-center gap-1"
                                    title="Draft this player now"
                                  >
                                    <Zap className="w-3 h-3" />
                                    Draft
                                  </button>
                                )}

                                <button
                                  onClick={() => removeFromWatchlist(player.id)}
                                  className="text-muted-foreground hover:text-destructive transition-colors p-1"
                                  title="Remove from watchlist"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </Draggable>
                    );
                  })}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        )}
      </div>

      {/* Footer */}
      {watchlistedPlayers.length > 0 && (
        <div className="p-3 border-t bg-muted text-center text-xs text-muted-foreground">
          {watchlistedPlayers.length} players • Drag to reorder • Click ⭐ to add more players
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

  const isInWatchlist = useCallback(
    (playerId: string) => {
      return watchlistItems.some((item) => item.playerId === playerId);
    },
    [watchlistItems]
  );

  const addToWatchlist = useCallback(
    (playerId: string) => {
      const isAlreadyWatched = watchlistItems.some((item) => item.playerId === playerId);
      if (isAlreadyWatched) return false;

      const newRank = Math.max(0, ...watchlistItems.map((item) => item.rank)) + 1;
      const newItem: WatchlistItem = {
        playerId,
        rank: newRank,
        addedAt: new Date().toISOString(),
      };

      const updatedItems = [...watchlistItems, newItem];
      setWatchlistItems(updatedItems);
      localStorage.setItem('draft-watchlist', JSON.stringify(updatedItems));
      return true;
    },
    [watchlistItems]
  );

  const removeFromWatchlist = useCallback(
    (playerId: string) => {
      const updatedItems = watchlistItems.filter((item) => item.playerId !== playerId);
      setWatchlistItems(updatedItems);
      localStorage.setItem('draft-watchlist', JSON.stringify(updatedItems));
      return true;
    },
    [watchlistItems]
  );

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
