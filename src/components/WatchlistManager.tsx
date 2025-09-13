/**
 * Enhanced Watchlist Manager Component
 * Provides drag-to-reorder functionality, priority management, and draft integration
 */

'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';

import { useUserProfile } from '@/hooks/useUserProfile';
import type { UserWatchlist, LeagueMembership } from '@/services/userProfileService';

interface WatchlistManagerProps {
  userId: string;
  selectedLeagueId?: string;
  leagues: LeagueMembership[];
  onPlayerSelect?: (playerId: string) => void;
  compact?: boolean;
}

interface WatchlistCardProps {
  watchlist: UserWatchlist;
  onEdit: (watchlist: UserWatchlist) => void;
  onDelete: (watchlistId: string) => void;
  onReorder: (watchlistId: string, playerIds: string[]) => void;
  onPlayerSelect?: (playerId: string) => void;
  compact?: boolean;
}

interface WatchlistFormProps {
  watchlist?: UserWatchlist;
  leagues: LeagueMembership[];
  selectedLeagueId?: string;
  onSave: (data: {
    name: string;
    description?: string;
    leagueId?: string;
    isDraftList: boolean;
    priority: number;
    tags: string[];
    playerIds: string[];
  }) => void;
  onCancel: () => void;
  updating: boolean;
}

interface DragState {
  isDragging: boolean;
  dragIndex: number | null;
  hoverIndex: number | null;
}

export function WatchlistManager({
  userId,
  selectedLeagueId,
  leagues,
  onPlayerSelect,
  compact = false,
}: WatchlistManagerProps) {
  const {
    watchlists,
    loading,
    updating,
    error,
    updateWatchlist,
    reorderWatchlist,
    deleteWatchlist,
  } = useUserProfile(userId);

  const [editingWatchlist, setEditingWatchlist] = useState<UserWatchlist | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<'all' | 'draft' | 'league' | 'global'>('all');

  // Filter watchlists based on current selection
  const filteredWatchlists = watchlists
    .filter((watchlist) => {
      if (filter === 'all') return true;
      if (filter === 'draft') return watchlist.isDraftList;
      if (filter === 'league') return watchlist.leagueId === selectedLeagueId;
      if (filter === 'global') return !watchlist.leagueId;
      return true;
    })
    .sort((a, b) => {
      // Sort by priority first, then by last used
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      const aLastUsed = a.lastUsedAt?.getTime() || 0;
      const bLastUsed = b.lastUsedAt?.getTime() || 0;
      return bLastUsed - aLastUsed;
    });

  const handleEditWatchlist = useCallback((watchlist: UserWatchlist) => {
    setEditingWatchlist(watchlist);
    setShowForm(true);
  }, []);

  const handleSaveWatchlist = useCallback(
    async (data: {
      name: string;
      description?: string;
      leagueId?: string;
      isDraftList: boolean;
      priority: number;
      tags: string[];
      playerIds: string[];
    }) => {
      try {
        await updateWatchlist({
          ...data,
          watchlistId: editingWatchlist?.id,
        });

        setShowForm(false);
        setEditingWatchlist(null);
      } catch (err) {
        console.error('Failed to save watchlist:', err);
      }
    },
    [updateWatchlist, editingWatchlist]
  );

  const handleDeleteWatchlist = useCallback(
    async (watchlistId: string) => {
      if (confirm('Are you sure you want to delete this watchlist?')) {
        try {
          await deleteWatchlist(watchlistId);
        } catch (err) {
          console.error('Failed to delete watchlist:', err);
        }
      }
    },
    [deleteWatchlist]
  );

  const handleReorderWatchlist = useCallback(
    async (watchlistId: string, playerIds: string[]) => {
      try {
        await reorderWatchlist(watchlistId, playerIds);
      } catch (err) {
        console.error('Failed to reorder watchlist:', err);
      }
    },
    [reorderWatchlist]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-3 text-gray-600">Loading watchlists...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <h3 className="text-red-800 font-medium">Error Loading Watchlists</h3>
        <p className="text-red-600 text-sm mt-1">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium text-gray-900">Player Watchlists</h2>
          <p className="text-sm text-gray-600">
            Organize and prioritize players for drafts and trades
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Filter */}
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            className="text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="all">All Watchlists</option>
            <option value="draft">Draft Lists</option>
            {selectedLeagueId && <option value="league">League Specific</option>}
            <option value="global">Global Lists</option>
          </select>

          <button
            onClick={() => {
              setEditingWatchlist(null);
              setShowForm(true);
            }}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm font-medium"
          >
            Create Watchlist
          </button>
        </div>
      </div>

      {/* Watchlist Form */}
      {showForm && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <WatchlistForm
            watchlist={editingWatchlist || undefined}
            leagues={leagues}
            selectedLeagueId={selectedLeagueId}
            onSave={handleSaveWatchlist}
            onCancel={() => {
              setShowForm(false);
              setEditingWatchlist(null);
            }}
            updating={updating}
          />
        </div>
      )}

      {/* Watchlist Cards */}
      {filteredWatchlists.length === 0 ? (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
          <h3 className="text-gray-800 font-medium">No Watchlists Found</h3>
          <p className="text-gray-600 text-sm mt-1">
            Create your first watchlist to start organizing players.
          </p>
        </div>
      ) : (
        <div
          className={`grid gap-4 ${compact ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'}`}
        >
          {filteredWatchlists.map((watchlist) => (
            <WatchlistCard
              key={watchlist.id}
              watchlist={watchlist}
              onEdit={handleEditWatchlist}
              onDelete={handleDeleteWatchlist}
              onReorder={handleReorderWatchlist}
              onPlayerSelect={onPlayerSelect}
              compact={compact}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function WatchlistCard({
  watchlist,
  onEdit,
  onDelete,
  onReorder,
  onPlayerSelect,
  compact = false,
}: WatchlistCardProps) {
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    dragIndex: null,
    hoverIndex: null,
  });
  const [playerIds, setPlayerIds] = useState(watchlist.playerIds);
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  // Update local player order when watchlist changes
  useEffect(() => {
    setPlayerIds(watchlist.playerIds);
  }, [watchlist.playerIds]);

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    dragItem.current = index;
    setDragState((prev) => ({ ...prev, isDragging: true, dragIndex: index }));
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    dragOverItem.current = index;
    setDragState((prev) => ({ ...prev, hoverIndex: index }));
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDragEnd = useCallback(async () => {
    if (dragItem.current !== null && dragOverItem.current !== null) {
      const dragItemIndex = dragItem.current;
      const dragOverItemIndex = dragOverItem.current;

      if (dragItemIndex !== dragOverItemIndex) {
        const newPlayerIds = [...playerIds];
        const draggedItem = newPlayerIds[dragItemIndex];

        // Remove dragged item
        newPlayerIds.splice(dragItemIndex, 1);

        // Insert at new position
        newPlayerIds.splice(dragOverItemIndex, 0, draggedItem);

        setPlayerIds(newPlayerIds);

        try {
          await onReorder(watchlist.id, newPlayerIds);
        } catch (err) {
          // Revert on error
          setPlayerIds(watchlist.playerIds);
          console.error('Failed to reorder:', err);
        }
      }
    }

    dragItem.current = null;
    dragOverItem.current = null;
    setDragState({
      isDragging: false,
      dragIndex: null,
      hoverIndex: null,
    });
  }, [playerIds, watchlist.id, watchlist.playerIds, onReorder]);

  const handleDragLeave = useCallback(() => {
    setDragState((prev) => ({ ...prev, hoverIndex: null }));
  }, []);

  const getPriorityColor = (priority: number) => {
    if (priority >= 8) return 'bg-red-100 text-red-800';
    if (priority >= 5) return 'bg-yellow-100 text-yellow-800';
    if (priority >= 2) return 'bg-green-100 text-green-800';
    return 'bg-gray-100 text-gray-800';
  };

  const getPriorityLabel = (priority: number) => {
    if (priority >= 8) return 'High';
    if (priority >= 5) return 'Medium';
    if (priority >= 2) return 'Low';
    return 'Normal';
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-gray-900 truncate">{watchlist.name}</h3>
          <div className="flex items-center gap-2 mt-1">
            {watchlist.isDraftList && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                Draft List
              </span>
            )}
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getPriorityColor(watchlist.priority)}`}
            >
              {getPriorityLabel(watchlist.priority)}
            </span>
            {watchlist.leagueId && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
                League
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 ml-2">
          <button
            onClick={() => onEdit(watchlist)}
            className="text-gray-400 hover:text-gray-600"
            title="Edit watchlist"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
          </button>
          <button
            onClick={() => onDelete(watchlist.id)}
            className="text-gray-400 hover:text-red-600"
            title="Delete watchlist"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Description */}
      {watchlist.description && (
        <p className="text-sm text-gray-600 mb-3">{watchlist.description}</p>
      )}

      {/* Tags */}
      {watchlist.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {watchlist.tags.map((tag, index) => (
            <span
              key={index}
              className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-800"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* Players */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">Players ({playerIds.length})</span>
          {watchlist.isDraftList && (
            <span className="text-xs text-blue-600">Drag to reorder priority</span>
          )}
        </div>

        {playerIds.length === 0 ? (
          <div className="text-center py-4 text-gray-500 text-sm">No players added yet</div>
        ) : (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {playerIds.slice(0, compact ? 5 : playerIds.length).map((playerId, index) => (
              <div
                key={playerId}
                role="button"
                tabIndex={0}
                draggable={watchlist.isDraftList}
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                onDragLeave={handleDragLeave}
                onClick={() => onPlayerSelect?.(playerId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onPlayerSelect?.(playerId);
                  }
                }}
                className={`
                  flex items-center justify-between p-2 rounded text-sm cursor-pointer
                  ${dragState.hoverIndex === index ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 hover:bg-gray-100'}
                  ${dragState.dragIndex === index ? 'opacity-50' : ''}
                  ${watchlist.isDraftList ? 'cursor-grab active:cursor-grabbing' : ''}
                  ${onPlayerSelect ? 'hover:bg-blue-50' : ''}
                `}
              >
                <div className="flex items-center gap-2">
                  {watchlist.isDraftList && (
                    <span className="text-xs text-gray-400 w-4">{index + 1}</span>
                  )}
                  {watchlist.isDraftList && (
                    <svg
                      className="w-3 h-3 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 8h16M4 16h16"
                      />
                    </svg>
                  )}
                  <span className="font-medium text-gray-900">Player {playerId.slice(-4)}</span>
                </div>

                {index === 0 && watchlist.isDraftList && (
                  <span className="text-xs text-blue-600 font-medium">Next Pick</span>
                )}
              </div>
            ))}

            {compact && playerIds.length > 5 && (
              <div className="text-center py-2 text-sm text-gray-500">
                +{playerIds.length - 5} more players
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      {watchlist.lastUsedAt && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-xs text-gray-500">
            Last used: {new Date(watchlist.lastUsedAt).toLocaleDateString()}
          </p>
        </div>
      )}
    </div>
  );
}

function WatchlistForm({
  watchlist,
  leagues,
  selectedLeagueId,
  onSave,
  onCancel,
  updating,
}: WatchlistFormProps) {
  const [name, setName] = useState(watchlist?.name || '');
  const [description, setDescription] = useState(watchlist?.description || '');
  const [leagueId, setLeagueId] = useState(watchlist?.leagueId || selectedLeagueId || '');
  const [isDraftList, setIsDraftList] = useState(watchlist?.isDraftList || false);
  const [priority, setPriority] = useState(watchlist?.priority || 5);
  const [tags, setTags] = useState(watchlist?.tags.join(', ') || '');
  const [playerIds] = useState(watchlist?.playerIds || []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      leagueId: leagueId || undefined,
      isDraftList,
      priority,
      tags: tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      playerIds,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-900">
          {watchlist ? 'Edit Watchlist' : 'Create New Watchlist'}
        </h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700">
            Watchlist Name
          </label>
          <input
            type="text"
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            placeholder="e.g., Top Prospects, Sleepers"
            required
          />
        </div>

        <div>
          <label htmlFor="league" className="block text-sm font-medium text-gray-700">
            League
          </label>
          <select
            id="league"
            value={leagueId}
            onChange={(e) => setLeagueId(e.target.value)}
            className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">Global Watchlist</option>
            {leagues.map((league) => (
              <option key={league.leagueId} value={league.leagueId}>
                {league.league.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium text-gray-700">
          Description (Optional)
        </label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          placeholder="Brief description of this watchlist..."
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="flex items-center">
          <input
            type="checkbox"
            id="isDraftList"
            checked={isDraftList}
            onChange={(e) => setIsDraftList(e.target.checked)}
            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
          />
          <label htmlFor="isDraftList" className="ml-2 text-sm text-gray-700">
            Use for Auto-Draft
          </label>
        </div>

        <div>
          <label htmlFor="priority" className="block text-sm font-medium text-gray-700">
            Priority Level
          </label>
          <select
            id="priority"
            value={priority}
            onChange={(e) => setPriority(parseInt(e.target.value))}
            className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          >
            <option value={10}>Highest (10)</option>
            <option value={8}>High (8)</option>
            <option value={5}>Medium (5)</option>
            <option value={2}>Low (2)</option>
            <option value={0}>Normal (0)</option>
          </select>
        </div>

        <div>
          <label htmlFor="tags" className="block text-sm font-medium text-gray-700">
            Tags (comma-separated)
          </label>
          <input
            type="text"
            id="tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            placeholder="rookies, sleepers, targets"
          />
        </div>
      </div>

      <div className="flex justify-end space-x-3 pt-4">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!name.trim() || updating}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {updating ? 'Saving...' : watchlist ? 'Update' : 'Create'} Watchlist
        </button>
      </div>
    </form>
  );
}

export default WatchlistManager;
