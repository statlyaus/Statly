'use client';

import React, { useMemo, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDraft } from '@/contexts/DraftContext';
import DraftErrorBoundary from '@/components/ui/ErrorBoundary';
import DraftControls from './DraftControls';
import DraftStatusBanner from './DraftStatusBanner';
import ConnectionStatus from './ConnectionStatus';
import LivePickHeader from '@/components/LivePickHeader';
import PickFeed from '@/components/PickFeed';
import DraftWatchlist, { useWatchlist } from '@/components/DraftWatchlist';
import PlayerGrid from './PlayerGrid';
import DraftQueue from './DraftQueue';
import { useConfirmation } from '@/components/ui';
import DraftAnalytics from './DraftAnalytics';
import {
  toLivePickHeaderData,
  toFeedPicks,
  toFeedParticipants,
} from '@/lib/mappers/draftUiMappers';
import type { DraftPlayer } from '@/types/draft';

interface UnifiedDraftRoomProps {
  draftId: string;
  userId: string;
}

/** Safely coerce unknown values into an array for rendering/sorting. */
function toArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  if (v instanceof Map) return Array.from(v.values()) as T[];
  if (typeof v === 'object') return Object.values(v as Record<string, T>);
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export default function UnifiedDraftRoom({ draftId, userId }: UnifiedDraftRoomProps) {
  const draft = useDraft();
  const { confirm, ConfirmationModal } = useConfirmation();
  const [activeTab, setActiveTab] = useState<'players' | 'queue' | 'watchlist' | 'analytics'>(
    'players'
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [positionFilter, setPositionFilter] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<'name' | 'position' | 'club' | 'adp'>('adp');
  const [isPickFeedOpen, setIsPickFeedOpen] = useState(false);
  const { watchlistItems, removeFromWatchlist } = useWatchlist();

  // Filter and sort available players (robust to non-array inputs)
  const filteredPlayers = useMemo(() => {
    // Start with a safe, cloned array
    const base = toArray<DraftPlayer>(draft.availablePlayers);
    let players = [...base];

    // Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      players = players.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.club.toLowerCase().includes(q) ||
          p.position.toLowerCase().includes(q)
      );
    }

    // Position filter
    if (positionFilter !== 'ALL') {
      players = players.filter((p) => p.position === positionFilter);
    }

    // Sorting
    const sortKeyMap = {
      name: (p: DraftPlayer) => p.name,
      position: (p: DraftPlayer) => p.position,
      club: (p: DraftPlayer) => p.club,
      adp: (p: DraftPlayer) => p.adp ?? 999, // push unknown ADP to the end
    } as const;

    const sortKey = sortKeyMap[sortBy];
    if (sortKey) {
      players.sort((a, b) => {
        const aVal = sortKey(a);
        const bVal = sortKey(b);
        if (typeof aVal === 'string' && typeof bVal === 'string') {
          return aVal.localeCompare(bVal);
        }
        return Number(aVal ?? 0) - Number(bVal ?? 0);
      });
    }

    return players;
  }, [draft.availablePlayers, searchQuery, positionFilter, sortBy]);

  // Unique positions for the filter dropdown
  const availablePositions = useMemo(() => {
    const list = toArray<DraftPlayer>(draft.availablePlayers);
    const positions = new Set(list.map((p) => p.position));
    return ['ALL', ...Array.from(positions).sort()];
  }, [draft.availablePlayers]);

  // Handle player selection
  const handlePlayerSelect = useCallback(
    async (player: DraftPlayer) => {
      if (!draft.canMakePick) return;
      try {
        await draft.makePick(player.id);
      } catch (error) {
        console.error('Failed to make pick:', error);
      }
    },
    [draft]
  );

  // Handle queue update
  const handleQueueUpdate = useCallback(
    async (queue: string[]) => {
      try {
        await draft.updateQueue(queue);
      } catch (error) {
        console.error('Failed to update queue:', error);
      }
    },
    [draft]
  );

  // Loading
  if (draft.isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div
            className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mx-auto mb-6"
            role="status"
            aria-label="Loading"
          />
          <h2 className="text-2xl font-semibold text-gray-900 mb-2">Loading Draft Room</h2>
          <p className="text-gray-600">Preparing your draft experience...</p>
        </div>
      </div>
    );
  }

  // Error
  if (draft.error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-red-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 19c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Draft Error</h2>
          <p className="text-gray-600 mb-6">{draft.error}</p>
          <button
            onClick={() => draft.forceRefresh()}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 mr-2"
          >
            Retry
          </button>
          <button
            onClick={() => window.location.reload()}
            className="bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700"
          >
            Refresh Page
          </button>
        </div>
      </div>
    );
  }

  // No draft
  if (!draft.draft) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Draft Not Found</h2>
          <p className="text-gray-600">The draft you&apos;re looking for doesn&apos;t exist.</p>
        </div>
      </div>
    );
  }

  return (
    <DraftErrorBoundary>
      <div className="min-h-screen bg-gray-50">
        {/* Connection Status */}
        <ConnectionStatus status={draft.connection.status} onRefresh={() => draft.forceRefresh()} />

        {/* Draft Controls (for league owners) */}
        <DraftControls
          draftId={draftId}
          draftStatus={draft.draft.status}
          isLeagueOwner={draft.participants.some((p) => p.userId === userId && p.draftOrder === 1)}
          onStatusChange={() => draft.forceRefresh()}
        />

        {/* Draft Status Banner */}
        <DraftStatusBanner
          status={draft.draft.status}
          onStartDraft={() => draft.forceRefresh()}
          isLoading={draft.isSaving}
        />

        {/* Live Pick Header */}
        {draft.isLive && (
          <LivePickHeader
            draftData={toLivePickHeaderData(draft.draft, draft.participants, draft.picks)}
            timePerPick={draft.draft.settings?.timePerPick ?? 120}
            isYourTurn={draft.liveState.isYourTurn}
            yourSlot={draft.participants.find((p) => p.userId === userId)?.draftOrder}
          />
        )}

        {/* Main Content */}
<main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
  {/* Tabs */}
  <div className="mb-6">
    <nav className="bg-white rounded-lg p-1 shadow-sm" aria-label="Draft room sections">
      <div className="flex space-x-1" role="tablist" aria-orientation="horizontal">
        {[
          { id: 'players', label: 'Available Players', count: filteredPlayers.length },
          {
            id: 'queue',
            label: 'Your Queue',
            count: draft.participants.find((p) => p.userId === userId)?.queue?.length ?? 0,
          },
          { id: 'watchlist', label: 'Watchlist', count: watchlistItems?.length || 0 },
          { id: 'analytics', label: 'Draft Analytics', count: 0 },
        ].map((tab) => {
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                selected
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span
                  className={`ml-2 px-2 py-0.5 text-xs rounded-full ${
                    selected ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600'
                  }`}
                  aria-label={`${tab.count} items`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  </div>

  {/* Tab Content */}
  <AnimatePresence mode="wait">
    <motion.div
      key={activeTab}
      id={`panel-${activeTab}`}
      role="tabpanel"
      aria-labelledby={`tab-${activeTab}`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.2 }}
      className="space-y-6"
    >
      {activeTab === 'players' && (
        <PlayerGrid
          players={filteredPlayers}
          onPlayerSelect={handlePlayerSelect}
          canMakePick={draft.canMakePick}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          positionFilter={positionFilter}
          onPositionFilterChange={setPositionFilter}
          availablePositions={availablePositions}
          sortBy={sortBy}
          onSortChange={setSortBy}
          isLoading={draft.isSaving}
        />
      )}

      {activeTab === 'queue' && (
        <DraftQueue
          queue={draft.participants.find((p) => p.userId === userId)?.queue || []}
          availablePlayers={toArray<DraftPlayer>(draft.availablePlayers)}
          onQueueUpdate={handleQueueUpdate}
          isLoading={draft.isSaving}
          confirm={confirm}
        />
      )}

      {activeTab === 'watchlist' && (
        <DraftWatchlist
          players={toArray<DraftPlayer>(draft.availablePlayers)}
          draftedPlayerIds={draft.picks.map((p) => p.player.id)}
          onDraftPlayer={(player) => {
            const adapted: DraftPlayer = {
              id: player.id,
              name: player.name,
              position: player.position,
              club: player.club,
              isAvailable: true,
              adp: (player as any).adp,
              avgPoints: (player as any).avgPoints,
            };
            void handlePlayerSelect(adapted);
          }}
          canDraft={draft.canMakePick}
          watchlistItems={watchlistItems || []}
          onRemoveFromWatchlist={removeFromWatchlist}
        />
      )}

      {activeTab === 'analytics' && (
        <DraftAnalytics draft={draft.draft} picks={draft.picks} participants={draft.participants} />
      )}
    </motion.div>
  </AnimatePresence>
</main>


          {/* Mobile Pick Feed Toggle */}
          <button
            onClick={() => setIsPickFeedOpen(true)}
            className="md:hidden fixed bottom-4 right-4 z-40 bg-blue-600 text-white p-3 rounded-full shadow-lg hover:bg-blue-700 transition-colors"
            aria-label="Open Pick Feed"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
          </button>

          {/* Sidebar - Pick Feed (desktop) */}
          <div className="hidden md:block fixed right-0 top-0 h-full w-80 bg-white shadow-lg border-l border-gray-200 overflow-y-auto">
            <div className="p-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Activity</h3>
              <PickFeed
                picks={toFeedPicks(draft.picks)}
                participants={toFeedParticipants(draft.participants)}
                userMemberId={draft.participants.find((p) => p.userId === userId)?.id || ''}
              />
            </div>
          </div>

          {/* Mobile Pick Feed Modal */}
          {isPickFeedOpen && (
            <div
              className="md:hidden fixed inset-0 z-50 bg-black bg-opacity-50"
              role="button"
              tabIndex={0}
              aria-label="Close Pick Feed"
              onClick={() => setIsPickFeedOpen(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
                  setIsPickFeedOpen(false);
                }
              }}
            >
              <div
                className="absolute right-0 top-0 h-full w-80 bg-white shadow-lg overflow-y-auto"
                onMouseDown={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
              >
                <div className="p-4 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">Recent Activity</h3>
                    <button
                      onClick={() => setIsPickFeedOpen(false)}
                      className="text-gray-400 hover:text-gray-600"
                      aria-label="Close Pick Feed"
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="p-4">
                  <PickFeed
                    picks={toFeedPicks(draft.picks)}
                    participants={toFeedParticipants(draft.participants)}
                    userMemberId={draft.participants.find((p) => p.userId === userId)?.id || ''}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Global confirmation modal for queue actions */}
          {ConfirmationModal}
      </div>
    </DraftErrorBoundary>
  );
}
