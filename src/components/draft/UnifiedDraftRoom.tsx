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

  const [activeTab, setActiveTab] = useState<'players' | 'queue' | 'watchlist' | 'analytics'>(
    'players'
  );
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
  const emptyPlayerMessage =
    draft.draftReadiness?.blockers.find((blocker) => blocker.code === 'player_pool_empty')
      ?.message ?? undefined;

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
  const statusTone =
    {
      SCHEDULED: 'bg-primary/10 text-primary ring-1 ring-primary/20',
      LOBBY: 'bg-muted text-muted-foreground ring-1 ring-border',
      COUNTDOWN: 'bg-primary/10 text-primary ring-1 ring-primary/20',
      LIVE: 'bg-primary text-primary-foreground ring-1 ring-primary/30',
      PAUSED: 'bg-muted text-muted-foreground ring-1 ring-border',
      COMPLETED: 'bg-muted text-muted-foreground ring-1 ring-border',
      CANCELLED: 'bg-destructive/10 text-destructive ring-1 ring-destructive/20',
    }[draftStatus] ?? 'bg-muted text-muted-foreground ring-1 ring-border';

  // A11y: full keyboard navigation for tabs (Left/Right)
  const tabs = useMemo(
    () =>
      [
        { id: 'players', label: 'Available Players', count: filteredPlayers.length },
        {
          id: 'queue',
          label: 'Your Queue',
          count: me?.queue?.length ?? 0,
        },
        { id: 'watchlist', label: 'Watchlist', count: watchlistItems?.length || 0 },
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
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div
            className="mx-auto mb-6 h-16 w-16 animate-spin rounded-full border-4 border-muted border-t-primary"
            role="status"
            aria-label="Loading"
          />
          <h2 className="mb-2 text-2xl font-semibold text-foreground">Loading Draft Room</h2>
          <p className="text-muted-foreground">Preparing your draft experience...</p>
        </div>
      </div>
    );
  }

  // Error
  if (draft.error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
            <svg
              className="h-8 w-8 text-destructive"
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
          <h2 className="mb-4 text-2xl font-bold text-foreground">Draft Error</h2>
          <p className="mb-6 text-muted-foreground">{draft.error}</p>
          <button
            onClick={() => draft.forceRefresh()}
            className="mr-2 rounded-md bg-primary px-4 py-2 text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Retry
          </button>
          <button
            onClick={() => window.location.reload()}
            className="rounded-md border border-border bg-background px-4 py-2 text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <h2 className="mb-4 text-2xl font-bold text-foreground">Draft Not Found</h2>
          <p className="text-muted-foreground">
            The draft you&apos;re looking for doesn&apos;t exist.
          </p>
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

  return (
    <DraftErrorBoundary>
      <div className="min-h-screen bg-background text-foreground">
        {/* Connection Status */}
        <ConnectionStatus status={draft.connection.status} onRefresh={() => draft.forceRefresh()} />

        <div className="space-y-4 pb-4 md:pr-[23rem] xl:pr-[25rem]">
          {/* Draft Controls (for league owners) */}
          <DraftControls
            draftId={draftId}
            draftStatus={activeDraft.status}
            isLeagueOwner={isOwner}
            onStatusChange={() => draft.forceRefresh()}
          />

          {/* Draft Status Banner */}
          {activeDraft.status !== 'LIVE' && (
            <DraftStatusBanner
              status={activeDraft.status}
              onStartDraft={draft.startDraft}
              isLoading={draft.isSaving}
            />
          )}

          {/* Live Pick Header */}
          {activeDraft.status === 'LIVE' && (
            <LivePickHeader
              draftData={toLivePickHeaderData(activeDraft, participants, picks)}
              timePerPick={activeDraft.settings?.timePerPick ?? 120}
              isYourTurn={Boolean(draft.liveState?.isYourTurn)}
              yourSlot={yourSlot}
            />
          )}
        </div>

        {/* Main Content */}
        <main className="mx-auto w-full max-w-[1780px] px-3 pb-6 sm:px-5 lg:px-8 md:pr-[23rem] xl:pr-[25rem]">
          <section className="rounded-3xl border border-border bg-card px-4 py-3 text-card-foreground shadow-sm sm:px-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${statusTone}`}
                  >
                    {draftStatus}
                  </span>
                  <span className="text-sm font-semibold text-foreground">{displayDraftTitle}</span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{displayDraftSubtitle}</p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Link
                  href="/drafts"
                  className="inline-flex items-center rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Back to drafts
                </Link>
                <Link
                  href="/drafts/history"
                  className="inline-flex items-center rounded-full border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  History
                </Link>
              </div>
            </div>
          </section>

          {/* Tabs */}
          <div className="mb-6 mt-6">
            <nav
              className="rounded-2xl border border-border bg-card p-1 shadow-sm"
              aria-label="Draft room sections"
            >
              <div
                className="flex flex-col gap-1 sm:flex-row"
                role="tablist"
                aria-orientation="horizontal"
                tabIndex={-1}
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
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      }`}
                    >
                      {tab.label}
                      {tab.count > 0 && (
                        <span
                          className={`ml-2 px-2 py-0.5 text-xs rounded-full ${
                            selected
                              ? 'bg-primary-foreground/20 text-primary-foreground'
                              : 'bg-muted text-muted-foreground'
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
              className="space-y-6"
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
                  emptyStateMessage={emptyPlayerMessage}
                />
              )}

              {activeTab === 'queue' && (
                <DraftQueue
                  queue={me?.queue || []}
                  availablePlayers={playersList}
                  onQueueUpdate={handleQueueUpdate}
                  isLoading={draft.isSaving}
                  confirm={confirm}
                />
              )}

              {activeTab === 'watchlist' && (
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
                />
              )}

              {activeTab === 'analytics' && (
                <DraftAnalytics draft={draft.draft} picks={picks} participants={participants} />
              )}
            </motion.div>
          </AnimatePresence>
        </main>

        {/* Mobile Pick Feed Toggle */}
        <button
          ref={openFeedBtnRef}
          onClick={() => setIsPickFeedOpen(true)}
          className="fixed bottom-4 right-4 z-40 rounded-full bg-primary p-3 text-primary-foreground shadow-lg transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
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
        <div className="fixed right-0 top-0 hidden h-full w-[22rem] overflow-y-auto border-l border-border bg-muted/80 p-4 shadow-lg backdrop-blur md:block xl:w-96">
          <div className="pt-2">
            <PickFeed
              picks={feedPicks}
              participants={feedParticipants}
              userMemberId={userMemberId}
              watchlistPlayerIds={watchlistItems.map((item) => item.playerId)}
              className="border-0 shadow-none"
            />
          </div>
        </div>

        {/* Mobile Pick Feed Modal */}
        {isPickFeedOpen && (
          <div
            className="fixed inset-0 z-50 bg-foreground/50 md:hidden"
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setIsPickFeedOpen(false);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
                setIsPickFeedOpen(false);
              }
            }}
          >
            <div
              className="absolute right-0 top-0 h-full w-80 overflow-y-auto bg-card p-4 text-card-foreground shadow-lg"
              role="dialog"
              aria-modal="true"
              aria-labelledby="pickFeedTitle"
              tabIndex={-1}
            >
              <div className="mb-3 flex justify-end">
                <button
                  ref={closeBtnRef}
                  onClick={() => setIsPickFeedOpen(false)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
      {ConfirmationModal}
    </DraftErrorBoundary>
  );
}
