'use client';

import type { KeyboardEvent } from 'react';
import React, { useMemo, useCallback, useState, useDeferredValue, useRef, useEffect } from 'react';

import Link from 'next/link';

import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';

import DraftWatchlist from '@/components/DraftWatchlist';
import LivePickHeader from '@/components/LivePickHeader';
import PickFeed from '@/components/PickFeed';
import { useConfirmation } from '@/components/ui';
import DraftErrorBoundary from '@/components/ui/ErrorBoundary';
import { useDraft } from '@/contexts/DraftContext';
import {
  toLivePickHeaderData,
  toFeedPicks,
  toFeedParticipants,
} from '@/lib/mappers/draftUiMappers';
import type { DraftPlayer, DraftParticipant, DraftPick } from '@/types/draft';

import ConnectionStatus from './ConnectionStatus';
import DraftAnalytics from './DraftAnalytics';
import DraftControls from './DraftControls';
import DraftQueue from './DraftQueue';
import DraftStatusBanner from './DraftStatusBanner';
import PlayerGrid from './PlayerGrid';

interface UnifiedDraftRoomProps {
  draftId: string;
  userId: string;
}

export default function UnifiedDraftRoom({ draftId, userId }: UnifiedDraftRoomProps) {
  const draft = useDraft();
  const { confirm, ConfirmationModal } = useConfirmation();

  const [activeTab, setActiveTab] = useState<'players' | 'shortlist' | 'analytics'>('players');
  const [searchQuery, setSearchQuery] = useState('');
  const deferredQuery = useDeferredValue(searchQuery);
  const [positionFilter, setPositionFilter] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<'name' | 'position' | 'club' | 'adp'>('adp');
  const [isPickFeedOpen, setIsPickFeedOpen] = useState(false);
  const reduceMotion = useReducedMotion();

  // Desktop FAB ref + modal focus mgmt refs
  const openFeedBtnRef = useRef<HTMLButtonElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  // Participants/picks/players are guaranteed arrays by DraftContext
  const participants = draft.participants as DraftParticipant[];
  const picks = draft.picks as DraftPick[];
  const playersList = draft.availablePlayers as DraftPlayer[];
  const watchlistItems = draft.watchlistItems || [];
  const selectedCategories = draft.selectedCategories || [];

  // Derive "me", ownership, and your slot once
  const me = useMemo(() => participants.find((p) => p.userId === userId), [participants, userId]);
  const yourSlot = me?.draftOrder;
  const isOwner = (me as any)?.role === 'OWNER' || (yourSlot ?? 0) === 1;

  // Filter + sort available players (efficient & stable)
  const filteredPlayers = useMemo(() => {
    let players = playersList;

    // Search (deferred for typing responsiveness)
    if (deferredQuery) {
      const q = deferredQuery.toLowerCase();
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
      adp: (p: DraftPlayer) => p.adp ?? 999, // ADP: lower is better; keep ascending
    } as const;

    const sortKey = sortKeyMap[sortBy];
    if (sortKey) {
      // Create a copy to avoid mutating context state
      const arr = [...players];
      arr.sort((a, b) => {
        const aVal = sortKey(a);
        const bVal = sortKey(b);
        if (typeof aVal === 'string' && typeof bVal === 'string') {
          return aVal.localeCompare(bVal);
        }
        return Number(aVal ?? 0) - Number(bVal ?? 0);
      });
      return arr;
    }

    return players;
  }, [playersList, deferredQuery, positionFilter, sortBy]);

  // Unique positions for the filter dropdown
  const availablePositions = useMemo(() => {
    const positions = new Set(playersList.map((p) => p.position));
    return ['ALL', ...Array.from(positions).sort()];
  }, [playersList]);

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

  const handlePlayerSelectById = useCallback(
    async (playerId: string) => {
      if (!draft.canMakePick) return;
      try {
        await draft.makePick(playerId);
      } catch (error) {
        console.error('Failed to make pick:', error);
      }
    },
    [draft]
  );

  const handleAddToQueue = useCallback(
    async (player: DraftPlayer) => {
      const nextQueue = Array.isArray(me?.queue) ? me.queue : [];
      if (nextQueue.includes(player.id)) return;

      try {
        await draft.updateQueue([...nextQueue, player.id]);
      } catch (error) {
        console.error('Failed to add player to queue:', error);
      }
    },
    [draft, me?.queue]
  );

  const handleAddWatchlistPlayerToQueue = useCallback(
    async (player: { id: string }) => {
      const draftPlayer = playersList.find((entry) => String(entry.id) === String(player.id));
      if (!draftPlayer) return;
      await handleAddToQueue(draftPlayer);
    },
    [handleAddToQueue, playersList]
  );

  const queuePlayerIds = me?.queue || [];
  const handleToggleWatchlist = useCallback(
    async (player: DraftPlayer) => {
      try {
        await draft.toggleWatchlist(player.id);
      } catch (error) {
        console.error('Failed to toggle watchlist:', error);
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

  // Memoized feed props (perf + stability)
  const feedPicks = useMemo(() => toFeedPicks(picks), [picks]);
  const feedParticipants = useMemo(() => toFeedParticipants(participants), [participants]);
  const userMemberId = me?.id || '';
  const draftState = draft.draft;
  const draftStatus = draftState?.status ?? 'LOBBY';
  const draftProgress = draftState ? (draftState.currentPick / draftState.totalPicks) * 100 : 0;
  const isYourTurn = Boolean(draft.liveState?.isYourTurn);
  const statusTone =
    {
      SCHEDULED: 'bg-indigo-500/15 text-indigo-100 ring-1 ring-indigo-400/30',
      LOBBY: 'bg-slate-500/20 text-slate-100 ring-1 ring-slate-300/30',
      COUNTDOWN: 'bg-amber-500/20 text-amber-100 ring-1 ring-amber-300/30',
      LIVE: 'bg-emerald-500/20 text-emerald-100 ring-1 ring-emerald-300/30',
      PAUSED: 'bg-amber-500/20 text-amber-100 ring-1 ring-amber-300/30',
      COMPLETED: 'bg-slate-500/20 text-slate-100 ring-1 ring-slate-300/30',
      CANCELLED: 'bg-rose-500/20 text-rose-100 ring-1 ring-rose-300/30',
    }[draftStatus] ?? 'bg-white/10 text-white';

  // A11y: full keyboard navigation for tabs (Left/Right)
  const tabs = useMemo(
    () =>
      [
        { id: 'players', label: 'Available Players', count: filteredPlayers.length },
        {
          id: 'shortlist',
          label: 'Queue & Watchlist',
          count: (me?.queue?.length ?? 0) + (watchlistItems?.length || 0),
        },
        { id: 'analytics', label: 'Draft Analytics', count: 0 },
      ] as const,
    [filteredPlayers.length, me?.queue?.length, watchlistItems?.length]
  );
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const onTabsKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const idx = tabs.findIndex((t) => t.id === activeTab);
    if (idx === -1) return;
    const nextIdx =
      e.key === 'ArrowRight' ? (idx + 1) % tabs.length : (idx - 1 + tabs.length) % tabs.length;
    const next = tabs[nextIdx].id as typeof activeTab;
    setActiveTab(next);
    // move focus to the newly selected tab
    tabRefs.current[`tab-${next}`]?.focus();
  };

  // Modal focus management
  useEffect(() => {
    if (isPickFeedOpen) {
      // Save last focused element & move focus into dialog
      lastFocusedRef.current = (document.activeElement as HTMLElement) ?? null;
      // Delay to end of paint so ref exists
      requestAnimationFrame(() => {
        closeBtnRef.current?.focus();
      });
    } else {
      // Restore focus to the element that opened the feed, or fallback to the FAB.
      requestAnimationFrame(() => {
        (lastFocusedRef.current || openFeedBtnRef.current)?.focus();
      });
    }
  }, [isPickFeedOpen]);

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

  const activeDraft = draft.draft;
  const derivedTotalRounds =
    activeDraft.totalPicks > 0 && participants.length > 0
      ? Math.ceil(activeDraft.totalPicks / participants.length)
      : null;
  const totalRounds = activeDraft.settings?.totalRounds ?? derivedTotalRounds;
  const hasPlaceholderDraftName =
    !activeDraft.name ||
    activeDraft.name === activeDraft.id ||
    activeDraft.name === `Draft ${activeDraft.id}`;
  const displayDraftTitle = hasPlaceholderDraftName ? 'League Draft' : activeDraft.name;
  const displayDraftSubtitle =
    totalRounds && totalRounds > 0
      ? `Round ${activeDraft.round} of ${totalRounds}. Pick ${activeDraft.currentPick} of ${activeDraft.totalPicks}.`
      : `Pick ${activeDraft.currentPick} of ${activeDraft.totalPicks}.`;
  const turnDescription = draft.liveState?.isYourTurn
    ? 'Your server deadline is active. Queue order is the auto-pick fallback if you time out.'
    : activeDraft.status === 'PAUSED'
      ? 'Draft is paused. The server clock and auto-pick are both suppressed.'
      : activeDraft.status === 'LIVE'
        ? 'Waiting for your turn. Queue players now to control any timeout auto-pick.'
        : `Connection: ${draft.connection.status}`;

  return (
    <DraftErrorBoundary>
      <div className="min-h-screen bg-gray-50">
        {/* Connection Status */}
        <ConnectionStatus status={draft.connection.status} onRefresh={() => draft.forceRefresh()} />

        <div className="mx-auto w-full max-w-[1780px] px-3 pb-6 pt-2 sm:px-5 lg:px-8">
          <div className="grid items-start gap-4 lg:gap-5 xl:gap-6 md:grid-cols-[minmax(0,1fr)_21.5rem] xl:grid-cols-[minmax(0,1fr)_23.5rem]">
            <div className="min-w-0 space-y-4 lg:space-y-5">
              <div className="space-y-3">
                {/* Draft Controls (for league owners) */}
                {activeDraft.status !== 'LIVE' && (
                  <DraftControls
                    draftId={draftId}
                    draftStatus={activeDraft.status}
                    isLeagueOwner={isOwner}
                    onStatusChange={() => draft.forceRefresh()}
                  />
                )}

                {/* Draft Status Banner */}
                {activeDraft.status !== 'LIVE' && (
                  <DraftStatusBanner
                    status={activeDraft.status}
                    onStartDraft={() => draft.forceRefresh()}
                    isLoading={draft.isSaving}
                  />
                )}

                {/* Live Pick Header */}
                {activeDraft.status === 'LIVE' && (
                  <LivePickHeader
                    draftData={toLivePickHeaderData(activeDraft, participants, picks)}
                    timePerPick={activeDraft.settings?.timePerPick ?? 120}
                    liveTimeRemaining={draft.liveState?.timeRemaining}
                    onClockMemberId={draft.liveState?.onClockTeamId}
                    isYourTurn={Boolean(draft.liveState?.isYourTurn)}
                    yourSlot={yourSlot}
                    ownerControls={
                      <DraftControls
                        draftId={draftId}
                        draftStatus={activeDraft.status}
                        isLeagueOwner={isOwner}
                        onStatusChange={() => draft.forceRefresh()}
                        variant="inline"
                      />
                    }
                  />
                )}
              </div>

              <div className="grid items-start gap-4 xl:gap-5 lg:grid-cols-[16.5rem_minmax(0,1fr)]">
                <aside className="hidden min-w-0 lg:block">
                  <div className="sticky top-24 space-y-3">
                    <section className="rounded-3xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                            Your draft rail
                          </p>
                          <h2 className="mt-1 text-lg font-semibold text-slate-900">
                            Manage your board
                          </h2>
                        </div>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                          Desktop rail
                        </span>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-600">
                        Keep your queue ready for timeout auto-pick and track watchlist candidates
                        you may promote next.
                      </p>
                    </section>

                    <DraftQueue
                      queue={me?.queue || []}
                      availablePlayers={playersList}
                      onQueueUpdate={handleQueueUpdate}
                      isLoading={draft.isSaving}
                      confirm={confirm}
                      variant="rail"
                    />

                    <DraftWatchlist
                      players={playersList}
                      draftedPlayerIds={picks.map((p) => p.player?.id).filter(Boolean) as string[]}
                      onDraftPlayer={(player) => {
                        void handlePlayerSelectById(player.id);
                      }}
                      canDraft={draft.canMakePick}
                      watchlistItems={watchlistItems}
                      onAddToQueue={handleAddWatchlistPlayerToQueue}
                      queuedPlayerIds={queuePlayerIds}
                      onRemoveFromWatchlist={draft.removeFromWatchlist}
                      isLoading={draft.isSaving}
                      variant="rail"
                    />
                  </div>
                </aside>

                {/* Main Content */}
                <main className="min-w-0 space-y-4">
                  <section className="rounded-3xl border border-slate-200 bg-white px-4 py-4 shadow-sm sm:px-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-3">
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${statusTone}`}
                          >
                            {draftStatus}
                          </span>
                          <span className="text-sm font-semibold text-slate-900">
                            {displayDraftTitle}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-slate-600">{displayDraftSubtitle}</p>
                      </div>

                      <div className="flex flex-wrap gap-3">
                        <Link
                          href="/drafts"
                          className="inline-flex items-center rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
                        >
                          Back to drafts
                        </Link>
                        <Link
                          href="/drafts/history"
                          className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100"
                        >
                          History
                        </Link>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(260px,0.9fr)]">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Progress
                          </span>
                          <span className="text-base font-semibold text-slate-900">
                            {draftProgress.toFixed(1)}%
                          </span>
                        </div>
                        <div className="mt-2 h-2 rounded-full bg-slate-200">
                          <div
                            className="h-2 rounded-full bg-emerald-500"
                            style={{ width: `${Math.min(100, Math.max(0, draftProgress))}%` }}
                          />
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Round
                          </div>
                          <div className="mt-1.5 text-lg font-semibold text-slate-900">
                            {activeDraft.round}
                            <span className="ml-2 text-sm font-medium text-slate-500">
                              / {totalRounds ?? '—'}
                            </span>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Pick
                          </div>
                          <div className="mt-1.5 text-lg font-semibold text-slate-900">
                            {activeDraft.currentPick}
                            <span className="ml-2 text-sm font-medium text-slate-500">
                              / {activeDraft.totalPicks}
                            </span>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Turn
                          </div>
                          <div className="mt-1.5 text-lg font-semibold text-slate-900">
                            {isYourTurn ? 'Your turn' : 'Waiting'}
                          </div>
                        </div>
                      </div>
                    </div>

                    <p className="mt-3 text-xs leading-5 text-slate-600">{turnDescription}</p>
                  </section>

                  {/* Tabs */}
                  <div>
                    <nav
                      className="bg-white rounded-2xl border border-slate-200 p-1 shadow-sm"
                      aria-label="Draft room sections"
                    >
                      <div
                        className="flex flex-col gap-1 sm:flex-row"
                        role="tablist"
                        aria-orientation="horizontal"
                        onKeyDown={onTabsKeyDown}
                      >
                        {tabs.map((tab) => {
                          const selected = activeTab === tab.id;
                          const tabId = `tab-${tab.id}`;
                          const panelId = `panel-${tab.id}`;
                          return (
                            <button
                              key={tab.id}
                              ref={(el) => {
                                tabRefs.current[tabId] = el;
                              }}
                              type="button"
                              role="tab"
                              id={tabId}
                              aria-selected={selected}
                              aria-controls={panelId}
                              tabIndex={selected ? 0 : -1}
                              onClick={() => setActiveTab(tab.id as typeof activeTab)}
                              className={`flex-1 px-4 py-2.5 text-sm font-medium rounded-xl transition-colors ${
                                selected
                                  ? 'bg-blue-600 text-white shadow-sm'
                                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                              }`}
                            >
                              {tab.label}
                              {tab.count > 0 && (
                                <span
                                  className={`ml-2 px-2 py-0.5 text-xs rounded-full ${
                                    selected
                                      ? 'bg-blue-100 text-blue-800'
                                      : 'bg-gray-100 text-gray-600'
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
                      transition={{ duration: reduceMotion ? 0 : 0.2 }}
                      className="space-y-4"
                    >
                      {activeTab === 'players' && (
                        <PlayerGrid
                          players={filteredPlayers}
                          totalPlayers={playersList.length}
                          onPlayerSelect={handlePlayerSelect}
                          onAddToQueue={handleAddToQueue}
                          onToggleWatchlist={handleToggleWatchlist}
                          canMakePick={draft.canMakePick}
                          queuedPlayerIds={me?.queue || []}
                          watchedPlayerIds={watchlistItems.map((item) => item.playerId)}
                          selectedCategories={selectedCategories}
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

                      {activeTab === 'shortlist' && (
                        <div className="space-y-5">
                          <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4 sm:px-5 lg:hidden">
                            <h2 className="text-lg font-semibold text-slate-900">
                              Shortlist management
                            </h2>
                            <p className="mt-1 text-sm text-slate-600">
                              Use your queue for live timeout order and your watchlist for scouting
                              candidates you may promote next.
                            </p>
                          </div>

                          <div className="hidden rounded-3xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm leading-6 text-slate-600 lg:block">
                            Your queue and watchlist now live in the left management rail on
                            desktop, so this tab is reserved for mobile and smaller layouts.
                          </div>

                          <section className="rounded-3xl border border-slate-200 bg-white px-4 py-4 shadow-sm sm:px-5 lg:hidden">
                            <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                              <div>
                                <h3 className="text-lg font-semibold text-slate-900">
                                  Draft queue
                                </h3>
                                <p className="text-sm text-slate-600">
                                  Ordered execution list for timeout auto-pick.
                                </p>
                              </div>
                              <div className="text-sm text-slate-500">
                                {me?.queue?.length ?? 0} queued
                              </div>
                            </div>
                            <DraftQueue
                              queue={me?.queue || []}
                              availablePlayers={playersList}
                              onQueueUpdate={handleQueueUpdate}
                              isLoading={draft.isSaving}
                              confirm={confirm}
                            />
                          </section>

                          <section className="rounded-3xl border border-slate-200 bg-white px-4 py-4 shadow-sm sm:px-5 lg:hidden">
                            <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                              <div>
                                <h3 className="text-lg font-semibold text-slate-900">Watchlist</h3>
                                <p className="text-sm text-slate-600">
                                  Scout players here, then move the best options straight into your
                                  queue.
                                </p>
                              </div>
                              <div className="text-sm text-slate-500">
                                {watchlistItems?.length || 0} watched
                              </div>
                            </div>
                            <DraftWatchlist
                              players={playersList}
                              draftedPlayerIds={
                                picks.map((p) => p.player?.id).filter(Boolean) as string[]
                              }
                              onDraftPlayer={(player) => {
                                void handlePlayerSelectById(player.id);
                              }}
                              canDraft={draft.canMakePick}
                              watchlistItems={watchlistItems}
                              onAddToQueue={handleAddWatchlistPlayerToQueue}
                              queuedPlayerIds={queuePlayerIds}
                              onRemoveFromWatchlist={draft.removeFromWatchlist}
                              isLoading={draft.isSaving}
                            />
                          </section>
                        </div>
                      )}

                      {activeTab === 'analytics' && (
                        <DraftAnalytics
                          draft={draft.draft}
                          picks={picks}
                          participants={participants}
                        />
                      )}
                    </motion.div>
                  </AnimatePresence>
                </main>
              </div>
            </div>

            <aside className="hidden min-w-0 md:block">
              <div className="sticky top-24">
                <PickFeed
                  picks={feedPicks}
                  participants={feedParticipants}
                  userMemberId={userMemberId}
                  watchlistPlayerIds={watchlistItems.map((item) => item.playerId)}
                />
              </div>
            </aside>
          </div>
        </div>

        {/* Mobile Pick Feed Toggle */}
        <button
          ref={openFeedBtnRef}
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

        {/* Mobile Pick Feed Modal */}
        {isPickFeedOpen && (
          <div
            className="md:hidden fixed inset-0 z-50 bg-black bg-opacity-50"
            role="presentation"
            onClick={() => setIsPickFeedOpen(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
                setIsPickFeedOpen(false);
              }
            }}
          >
            <div
              className="absolute right-0 top-0 h-full w-80 overflow-y-auto bg-slate-50 p-4 shadow-lg"
              onMouseDown={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="pickFeedTitle"
              tabIndex={-1}
            >
              <div className="mb-3 flex justify-end">
                <button
                  ref={closeBtnRef}
                  onClick={() => setIsPickFeedOpen(false)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Close Pick Feed"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
              <div id="pickFeedTitle" className="sr-only">
                Pick Feed
              </div>
              <div>
                <PickFeed
                  picks={feedPicks}
                  participants={feedParticipants}
                  userMemberId={userMemberId}
                  watchlistPlayerIds={watchlistItems.map((item) => item.playerId)}
                  className="border-0 shadow-none"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </DraftErrorBoundary>
  );
}
