'use client';

import { useMemo, useCallback, useState, useDeferredValue, useRef, useEffect } from 'react';

import Link from 'next/link';

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
import type { DraftPlayer, DraftParticipant, DraftPick, DraftSettings } from '@/types/draft';
import type { FantasyCategoryKey } from '@/types/fantasyCategories';

import ConnectionStatus from './ConnectionStatus';
import DraftControls from './DraftControls';
import DraftLeftRail, { type DraftLeftRailRosterSlot } from './DraftLeftRail';
import DraftQueue from './DraftQueue';
import DraftStatusBanner from './DraftStatusBanner';
import PlayerGrid from './PlayerGrid';

interface UnifiedDraftRoomProps {
  draftId: string;
  userId: string;
}

type PlayerSortKey =
  | 'statlyZ'
  | 'name'
  | 'position'
  | 'club'
  | 'adp'
  | `category:${FantasyCategoryKey}`;

function getPositiveInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function getCategorySortValue(player: DraftPlayer, sortBy: PlayerSortKey): number | null {
  if (!sortBy.startsWith('category:')) return null;

  const category = sortBy.slice('category:'.length) as FantasyCategoryKey;
  const value = player.stats?.[category];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function compareNullableScoreDesc(
  aValue: number | null,
  bValue: number | null,
  aName: string,
  bName: string
): number {
  if (aValue === null && bValue === null) return aName.localeCompare(bName);
  if (aValue === null) return 1;
  if (bValue === null) return -1;
  return bValue - aValue || aName.localeCompare(bName);
}

function filterDraftPlayers(
  players: DraftPlayer[],
  query: string,
  positionFilter: string
): DraftPlayer[] {
  const normalizedQuery = query.toLowerCase();

  return players.filter((player) => {
    const matchesQuery =
      !normalizedQuery ||
      player.name.toLowerCase().includes(normalizedQuery) ||
      player.club.toLowerCase().includes(normalizedQuery) ||
      player.position.toLowerCase().includes(normalizedQuery);
    const matchesPosition = positionFilter === 'ALL' || player.position === positionFilter;

    return matchesQuery && matchesPosition;
  });
}

function sortDraftPlayers(players: DraftPlayer[], sortBy: PlayerSortKey): DraftPlayer[] {
  return [...players].sort((a, b) => {
    if (sortBy === 'statlyZ') {
      const aScore = typeof a.statlyZScore === 'number' ? a.statlyZScore : null;
      const bScore = typeof b.statlyZScore === 'number' ? b.statlyZScore : null;
      return compareNullableScoreDesc(aScore, bScore, a.name, b.name);
    }

    if (sortBy === 'adp') {
      return (a.adp ?? Number.MAX_SAFE_INTEGER) - (b.adp ?? Number.MAX_SAFE_INTEGER);
    }

    if (sortBy.startsWith('category:')) {
      return compareNullableScoreDesc(
        getCategorySortValue(a, sortBy),
        getCategorySortValue(b, sortBy),
        a.name,
        b.name
      );
    }

    const textSort = sortBy as 'name' | 'position' | 'club';
    return a[textSort].localeCompare(b[textSort]);
  });
}

function buildRosterSlots({
  settings,
  picks,
  userMemberId,
  userId,
  fallbackRosterSize,
}: {
  settings?: Partial<DraftSettings> | null;
  picks: DraftPick[];
  userMemberId: string;
  userId: string;
  fallbackRosterSize: number;
}): DraftLeftRailRosterSlot[] {
  const userPicks = picks
    .filter((pick) => {
      const pickMemberId = String(pick.member?.id ?? '');
      const pickUserId = String(pick.member?.userId ?? '');

      return (
        (userMemberId && pickMemberId === String(userMemberId)) ||
        (userId && pickUserId === String(userId))
      );
    })
    .sort((a, b) => a.overall - b.overall);

  const slots: DraftLeftRailRosterSlot[] = [];
  const startingLineup =
    settings?.startingLineup && typeof settings.startingLineup === 'object'
      ? settings.startingLineup
      : null;

  if (startingLineup) {
    Object.entries(startingLineup).forEach(([position, count]) => {
      const slotCount = getPositiveInteger(count);

      for (let index = 1; index <= slotCount; index += 1) {
        slots.push({
          id: `starter-${position}-${index}`,
          label: `${position} ${index}`,
          position,
        });
      }
    });
  }

  const benchSize = getPositiveInteger(settings?.benchSize);
  for (let index = 1; index <= benchSize; index += 1) {
    slots.push({
      id: `bench-${index}`,
      label: `Bench ${index}`,
    });
  }

  const minimumSlotCount = Math.max(userPicks.length, fallbackRosterSize);
  if (slots.length === 0) {
    for (let index = 1; index <= minimumSlotCount; index += 1) {
      slots.push({
        id: `roster-${index}`,
        label: `Roster ${index}`,
      });
    }
  }

  while (slots.length < userPicks.length) {
    const nextIndex = slots.length + 1;
    slots.push({
      id: `roster-${nextIndex}`,
      label: `Roster ${nextIndex}`,
    });
  }

  return slots.map((slot, index) => {
    const player = userPicks[index]?.player;

    if (!player) return slot;

    return {
      ...slot,
      player: {
        id: player.id,
        name: player.name,
        club: player.club,
        position: player.position,
      },
    };
  });
}

export default function UnifiedDraftRoom({ draftId, userId }: UnifiedDraftRoomProps) {
  const draft = useDraft();
  const { confirm, ConfirmationModal } = useConfirmation();

  const [searchQuery, setSearchQuery] = useState('');
  const deferredQuery = useDeferredValue(searchQuery);
  const [positionFilter, setPositionFilter] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<PlayerSortKey>('statlyZ');
  const [isPickFeedOpen, setIsPickFeedOpen] = useState(false);

  // Desktop FAB ref + modal focus mgmt refs
  const openFeedBtnRef = useRef<HTMLButtonElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const hasOpenedPickFeedRef = useRef(false);

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
    return sortDraftPlayers(filterDraftPlayers(playersList, deferredQuery, positionFilter), sortBy);
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
  const rosterSlots = useMemo(() => {
    const settings = draftState?.settings;
    const derivedRosterSize =
      draftState && draftState.totalPicks > 0 && participants.length > 0
        ? Math.ceil(draftState.totalPicks / participants.length)
        : 0;
    const fallbackRosterSize = Math.max(
      getPositiveInteger(settings?.rosterSize),
      getPositiveInteger(settings?.totalRounds),
      derivedRosterSize
    );

    return buildRosterSlots({
      settings,
      picks,
      userMemberId,
      userId,
      fallbackRosterSize,
    });
  }, [draftState, participants.length, picks, userId, userMemberId]);
  const statusTone =
    {
      SCHEDULED:
        'bg-[color:var(--draft-broadcast-yellow)] text-[color:var(--draft-broadcast-yellow-text)] ring-1 ring-[color:var(--draft-broadcast-yellow)]',
      LOBBY:
        'bg-[color:var(--draft-broadcast-panel-strong)] text-[color:var(--draft-broadcast-muted)] ring-1 ring-[color:var(--draft-broadcast-border)]',
      COUNTDOWN:
        'bg-[color:var(--draft-broadcast-yellow)] text-[color:var(--draft-broadcast-yellow-text)] ring-1 ring-[color:var(--draft-broadcast-yellow)]',
      LIVE: 'bg-[color:var(--draft-broadcast-red)] text-white ring-1 ring-[color:var(--draft-broadcast-red)]',
      PAUSED:
        'bg-[color:var(--draft-broadcast-yellow)] text-[color:var(--draft-broadcast-yellow-text)] ring-1 ring-[color:var(--draft-broadcast-yellow)]',
      COMPLETED:
        'bg-[color:var(--draft-broadcast-green)] text-white ring-1 ring-[color:var(--draft-broadcast-green)]',
      CANCELLED:
        'bg-[color:var(--draft-broadcast-red-soft)] text-[color:var(--draft-broadcast-text)] ring-1 ring-[color:var(--draft-broadcast-red)]',
    }[draftStatus] ??
    'bg-[color:var(--draft-broadcast-panel-strong)] text-[color:var(--draft-broadcast-muted)] ring-1 ring-[color:var(--draft-broadcast-border)]';

  // Modal focus management
  useEffect(() => {
    if (isPickFeedOpen) {
      hasOpenedPickFeedRef.current = true;
      // Save last focused element & move focus into dialog
      lastFocusedRef.current = (document.activeElement as HTMLElement) ?? null;
      // Delay to end of paint so ref exists
      requestAnimationFrame(() => {
        closeBtnRef.current?.focus();
      });
    } else if (hasOpenedPickFeedRef.current) {
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
  const isCompletedDraft = String(activeDraft.status).toUpperCase() === 'COMPLETED';
  const derivedTotalRounds =
    activeDraft.totalPicks > 0 && participants.length > 0
      ? Math.ceil(activeDraft.totalPicks / participants.length)
      : null;
  const totalRounds = activeDraft.settings?.totalRounds ?? derivedTotalRounds;
  const displayCurrentPick = isCompletedDraft
    ? Math.max(1, activeDraft.totalPicks)
    : activeDraft.currentPick;
  const hasPlaceholderDraftName =
    !activeDraft.name ||
    activeDraft.name === activeDraft.id ||
    activeDraft.name === `Draft ${activeDraft.id}`;
  const displayDraftTitle = hasPlaceholderDraftName ? 'League Draft' : activeDraft.name;
  const displayDraftSubtitle = isCompletedDraft
    ? `${displayCurrentPick} of ${activeDraft.totalPicks} picks finalized. Review your roster and every team in the archive.`
    : totalRounds && totalRounds > 0
      ? `Round ${activeDraft.round} of ${totalRounds}. Pick ${displayCurrentPick} of ${activeDraft.totalPicks}.`
      : `Pick ${displayCurrentPick} of ${activeDraft.totalPicks}.`;
  const timePerPick =
    activeDraft.settings?.timePerPick ?? (activeDraft.settings as any)?.pickSeconds ?? 120;
  const leagueHistoryQuery = activeDraft.leagueId
    ? `?leagueId=${encodeURIComponent(activeDraft.leagueId)}`
    : '';
  const leagueHubHref = activeDraft.leagueId
    ? `/leagues/${encodeURIComponent(activeDraft.leagueId)}`
    : '/leagues';
  const rosterHref = activeDraft.leagueId
    ? `/leagues/${encodeURIComponent(activeDraft.leagueId)}?tab=roster`
    : '/rosters';
  const historyHref = isCompletedDraft
    ? `/drafts/history/${encodeURIComponent(activeDraft.id)}${leagueHistoryQuery}`
    : activeDraft.leagueId
      ? `/drafts/history?leagueId=${encodeURIComponent(activeDraft.leagueId)}`
      : '/drafts/history';
  const historyLinkLabel = isCompletedDraft ? 'Review completed draft' : 'History';
  const filledRosterSlots = rosterSlots.filter((slot) => slot.player).length;
  const queuePanel = (
    <DraftQueue
      queue={me?.queue || []}
      availablePlayers={playersList}
      onQueueUpdate={handleQueueUpdate}
      isLoading={draft.isSaving}
      confirm={confirm}
    />
  );
  const watchlistPanel = (
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
      pendingWatchlistPlayerIds={draft.pendingWatchlistPlayerIds}
      onRemoveFromWatchlist={draft.removeFromWatchlist}
      isLoading={draft.isSaving}
    />
  );
  const pickFeedProps = {
    picks: feedPicks,
    participants: feedParticipants,
    userMemberId,
    watchlistPlayerIds: watchlistItems.map((item) => item.playerId),
    className: 'h-full min-h-0 border-0 shadow-none',
  };
  const desktopPickFeed = (
    <PickFeed {...pickFeedProps} contentId={`pick-feed-content:${activeDraft.id}:desktop`} />
  );
  const mobilePickFeed = (
    <PickFeed {...pickFeedProps} contentId={`pick-feed-content:${activeDraft.id}:mobile`} />
  );

  return (
    <DraftErrorBoundary>
      <div className="min-h-screen bg-[color:var(--draft-broadcast-page)] text-[color:var(--draft-broadcast-text)]">
        {/* Connection Status */}
        <ConnectionStatus status={draft.connection.status} onRefresh={() => draft.forceRefresh()} />

        <div
          className={
            isCompletedDraft
              ? 'mx-auto max-w-[2100px] space-y-4 pb-4 opacity-45'
              : 'mx-auto max-w-[2100px] space-y-4 pb-4'
          }
        >
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

          {/* Draft Pick Header */}
          <LivePickHeader
            draftData={toLivePickHeaderData(activeDraft, participants, picks)}
            timePerPick={timePerPick}
            isYourTurn={Boolean(draft.liveState?.isYourTurn)}
            yourSlot={yourSlot}
          />
        </div>

        {/* Main Content */}
        <main className="mx-auto w-full max-w-[2100px] px-4 pb-6 sm:px-6 lg:px-8">
          {isCompletedDraft ? (
            <section
              aria-label="Draft complete next steps"
              className="rounded-3xl border border-[color:var(--draft-broadcast-border)] bg-[color:var(--draft-broadcast-panel)] p-5 text-[color:var(--draft-broadcast-text)] shadow-[0_22px_70px_-46px_var(--draft-broadcast-shadow-deep)] sm:p-6"
            >
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(36rem,48rem)] xl:items-end">
                <div className="min-w-0">
                  <span
                    className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${statusTone}`}
                  >
                    Completed
                  </span>
                  <h1 className="mt-4 text-2xl font-semibold tracking-tight text-[color:var(--draft-broadcast-text)] sm:text-3xl">
                    Draft complete
                  </h1>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--draft-broadcast-muted)] sm:text-base">
                    {displayDraftTitle} is finalized with {displayCurrentPick} of{' '}
                    {activeDraft.totalPicks} picks complete. Choose where to go next; the draft room
                    remains below as a read-only reference.
                  </p>
                  <p className="mt-3 text-sm font-medium text-[color:var(--draft-broadcast-text)]">
                    Your roster: {filledRosterSlots} of {rosterSlots.length} slots filled.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Link
                    href={leagueHubHref}
                    aria-label="Go back to league hub"
                    className="rounded-2xl border border-[color:var(--draft-broadcast-border)] bg-[color:var(--draft-broadcast-panel-strong)] p-4 text-left transition-colors hover:bg-[color:var(--draft-broadcast-border)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="block text-sm font-semibold text-[color:var(--draft-broadcast-text)]">
                      Go back to league hub
                    </span>
                    <span className="mt-2 block text-xs leading-5 text-[color:var(--draft-broadcast-muted)]">
                      Return to league command, settings, fixtures, and season tools.
                    </span>
                  </Link>
                  <Link
                    href={historyHref}
                    aria-label="Review completed draft"
                    className="rounded-2xl border border-[color:var(--draft-broadcast-red)] bg-[color:var(--draft-broadcast-red)] p-4 text-left text-white shadow-[0_0_24px_var(--draft-broadcast-red-glow)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="block text-sm font-semibold">Review completed draft</span>
                    <span className="mt-2 block text-xs leading-5 text-white/80">
                      Open the final pick timeline, round tables, and every team result.
                    </span>
                  </Link>
                  <Link
                    href={rosterHref}
                    aria-label="Review my roster"
                    className="rounded-2xl border border-[color:var(--draft-broadcast-border)] bg-[color:var(--draft-broadcast-panel-strong)] p-4 text-left transition-colors hover:bg-[color:var(--draft-broadcast-border)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="block text-sm font-semibold text-[color:var(--draft-broadcast-text)]">
                      Review my roster
                    </span>
                    <span className="mt-2 block text-xs leading-5 text-[color:var(--draft-broadcast-muted)]">
                      Inspect your drafted squad inside the league roster view.
                    </span>
                  </Link>
                </div>
              </div>
            </section>
          ) : (
            <section className="rounded-3xl border border-[color:var(--draft-broadcast-border)] bg-[color:var(--draft-broadcast-panel)] px-4 py-3 text-[color:var(--draft-broadcast-text)] shadow-[0_22px_70px_-46px_var(--draft-broadcast-shadow-deep)] sm:px-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${statusTone}`}
                    >
                      {draftStatus}
                    </span>
                    <span className="text-sm font-semibold text-[color:var(--draft-broadcast-text)]">
                      {displayDraftTitle}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-[color:var(--draft-broadcast-muted)]">
                    {displayDraftSubtitle}
                  </p>
                </div>

                <div className="flex flex-wrap gap-3">
                  <Link
                    href="/drafts"
                    className="inline-flex items-center rounded-full bg-[color:var(--draft-broadcast-red)] px-4 py-2 text-sm font-semibold text-white shadow-[0_0_24px_var(--draft-broadcast-red-glow)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Back to drafts
                  </Link>
                  <Link
                    href={historyHref}
                    className="inline-flex items-center rounded-full border border-[color:var(--draft-broadcast-border)] bg-[color:var(--draft-broadcast-panel-strong)] px-4 py-2 text-sm font-semibold text-[color:var(--draft-broadcast-text)] transition-colors hover:bg-[color:var(--draft-broadcast-border)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {historyLinkLabel}
                  </Link>
                </div>
              </div>
            </section>
          )}

          <section
            aria-label={isCompletedDraft ? 'Completed draft background' : undefined}
            className={isCompletedDraft ? 'opacity-45 pointer-events-none select-none' : undefined}
            inert={isCompletedDraft ? true : undefined}
          >
            <section
              aria-label="Draft board"
              className="mt-6 grid min-h-[calc(100vh-24rem)] items-stretch gap-4 lg:grid-cols-[minmax(17rem,19rem)_minmax(0,1fr)] xl:min-h-[calc(100vh-20rem)] xl:grid-cols-[minmax(18rem,20rem)_minmax(52rem,1fr)_minmax(20rem,22rem)] 2xl:grid-cols-[20rem_minmax(62rem,1fr)_22rem]"
            >
              <DraftLeftRail
                draftStatus={activeDraft.status}
                storageKey={`draft-left-rail:${activeDraft.id}:${userMemberId || userId}`}
                rosterSlots={rosterSlots}
                queueCount={queuePlayerIds.length}
                watchlistCount={watchlistItems.length}
                queuePanel={queuePanel}
                watchlistPanel={watchlistPanel}
                className="h-full min-h-[30rem] border-[color:var(--draft-broadcast-border)] bg-[color:var(--draft-broadcast-panel)] text-[color:var(--draft-broadcast-text)] shadow-[0_22px_70px_-48px_var(--draft-broadcast-shadow-deep)] [--background:var(--draft-broadcast-panel-strong)] [--border:var(--draft-broadcast-border)] [--card:var(--draft-broadcast-panel)] [--card-foreground:var(--draft-broadcast-text)] [--foreground:var(--draft-broadcast-text)] [--input:var(--draft-broadcast-border)] [--muted:var(--draft-broadcast-muted-surface)] [--muted-foreground:var(--draft-broadcast-muted)] lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)]"
              />

              <div className="flex min-h-0 min-w-0 overflow-x-auto">
                <PlayerGrid
                  className="h-full min-h-[30rem] border-[color:var(--draft-broadcast-border)] bg-[color:var(--draft-broadcast-table)] text-[color:var(--draft-broadcast-text)] shadow-[0_22px_70px_-48px_var(--draft-broadcast-shadow-deep)] [--accent:var(--draft-broadcast-muted-surface)] [--accent-foreground:var(--draft-broadcast-text)] [--background:var(--draft-broadcast-panel-strong)] [--border:var(--draft-broadcast-border)] [--card:var(--draft-broadcast-table)] [--card-foreground:var(--draft-broadcast-text)] [--foreground:var(--draft-broadcast-text)] [--input:var(--draft-broadcast-border)] [--muted:var(--draft-broadcast-muted-surface)] [--muted-foreground:var(--draft-broadcast-muted)] [--primary:var(--draft-broadcast-red)] [--primary-foreground:#fff]"
                  players={filteredPlayers}
                  totalPlayers={playersList.length}
                  onPlayerSelect={handlePlayerSelect}
                  onAddToQueue={handleAddToQueue}
                  onToggleWatchlist={handleToggleWatchlist}
                  canMakePick={draft.canMakePick}
                  queuedPlayerIds={me?.queue || []}
                  watchedPlayerIds={watchlistItems.map((item) => item.playerId)}
                  pendingWatchlistPlayerIds={draft.pendingWatchlistPlayerIds}
                  selectedCategories={selectedCategories}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  positionFilter={positionFilter}
                  onPositionFilterChange={setPositionFilter}
                  availablePositions={availablePositions}
                  sortBy={sortBy}
                  onSortChange={setSortBy}
                  statSeason={draft.statSeason}
                  statSeasons={draft.statSeasons}
                  onStatSeasonChange={(season) => {
                    void draft.setStatSeason(season);
                  }}
                  isLoading={draft.isSaving}
                  emptyStateMessage={emptyPlayerMessage}
                />
              </div>

              <aside className="hidden min-h-0 lg:block" aria-label="Desktop pick feed">
                <div className="sticky top-4 flex h-full min-h-[30rem] max-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-lg border border-[color:var(--draft-broadcast-border)] bg-[color:var(--draft-broadcast-panel)] p-3 text-[color:var(--draft-broadcast-text)] shadow-[0_22px_70px_-48px_var(--draft-broadcast-shadow-deep)] [--background:var(--draft-broadcast-panel-strong)] [--border:var(--draft-broadcast-border)] [--card:var(--draft-broadcast-panel)] [--card-foreground:var(--draft-broadcast-text)] [--foreground:var(--draft-broadcast-text)] [--input:var(--draft-broadcast-border)] [--muted:var(--draft-broadcast-muted-surface)] [--muted-foreground:var(--draft-broadcast-muted)]">
                  {desktopPickFeed}
                </div>
              </aside>
            </section>
          </section>
        </main>

        {/* Mobile Pick Feed Toggle */}
        <button
          ref={openFeedBtnRef}
          onClick={() => setIsPickFeedOpen(true)}
          className="fixed bottom-4 right-4 z-40 rounded-full border border-[color:var(--draft-broadcast-red)] bg-[color:var(--draft-broadcast-red)] p-3 text-white shadow-[0_0_24px_var(--draft-broadcast-red-glow)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
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
            className="fixed inset-0 z-50 bg-[color:var(--draft-broadcast-overlay)] lg:hidden"
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setIsPickFeedOpen(false);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setIsPickFeedOpen(false);
              }
            }}
          >
            <div
              className="absolute right-0 top-0 h-full w-80 overflow-y-auto border-l border-[color:var(--draft-broadcast-border)] bg-[color:var(--draft-broadcast-panel)] p-4 text-[color:var(--draft-broadcast-text)] shadow-[0_22px_70px_-30px_var(--draft-broadcast-shadow-deep)] [--background:var(--draft-broadcast-panel-strong)] [--border:var(--draft-broadcast-border)] [--card:var(--draft-broadcast-panel)] [--card-foreground:var(--draft-broadcast-text)] [--foreground:var(--draft-broadcast-text)] [--muted:var(--draft-broadcast-muted-surface)] [--muted-foreground:var(--draft-broadcast-muted)]"
              role="dialog"
              aria-modal="true"
              aria-labelledby="pickFeedTitle"
              tabIndex={-1}
            >
              <div className="mb-3 flex justify-end">
                <button
                  ref={closeBtnRef}
                  onClick={() => setIsPickFeedOpen(false)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[color:var(--draft-broadcast-border)] bg-[color:var(--draft-broadcast-panel-strong)] text-[color:var(--draft-broadcast-muted)] transition-colors hover:bg-[color:var(--draft-broadcast-border)] hover:text-[color:var(--draft-broadcast-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
              <div>{mobilePickFeed}</div>
            </div>
          </div>
        )}
      </div>
      {ConfirmationModal}
    </DraftErrorBoundary>
  );
}
