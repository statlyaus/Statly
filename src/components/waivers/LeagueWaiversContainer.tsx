'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/AuthContext';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import WaiverFAABSystem from '@/components/waivers/WaiverFAABSystem';
import type {
  LeagueWaiverClaim,
  LeagueRoster,
  LeagueActivityItem,
} from '@/services/leagueDataService';
import type { FantasyCategoryKey, PlayerStats } from '@/types/fantasyCategories';

interface Props {
  leagueId: string;
  currentUserId?: string | null;
  initialClaims?: Array<{
    id: string;
    userId: string;
    teamId: string;
    playerId: string;
    dropPlayerId?: string;
    priority: number;
    status: 'PENDING' | 'SUCCESSFUL' | 'FAILED' | 'CANCELLED';
    createdAt: string;
    processedAt?: string;
    processingAt?: string;
    bidAmount?: number;
  }>;
  initialSettings?: {
    waiverSettings?: { faabBudget?: number; minimumBid?: number; system?: string };
  };
  availablePlayers?: Array<{
    id: string;
    name: string;
    team?: string;
    club?: string;
    position?: string;
    ownership?: number;
    avgPoints?: number;
    averagePoints?: number;
    fantasyPoints?: number;
    gamesPlayed?: number;
    stats?: Partial<PlayerStats>;
    statsTotal?: Partial<PlayerStats>;
    statlyZScore?: number;
    statlyZBreakdown?: Array<{ category: FantasyCategoryKey; value: number; zScore: number }>;
    statlyZMissingCategories?: FantasyCategoryKey[];
  }>;
  playersIndex?: Record<string, { id: string; name: string; team?: string; position?: string }>;
  membersIndex?: Record<string, { userId: string; teamId?: string; teamName?: string }>;
  selectedCategories?: FantasyCategoryKey[];
  initialPlayersCursor?: string | null;
  initialPlayerId?: string | null;
}

// Minimal shape matching WaiverFAABSystem's expected userClaims prop
interface UIWaiverClaim {
  id: string;
  playerId: string;
  playerName: string;
  playerPosition: string;
  playerTeam: string;
  action: 'add' | 'drop' | 'trade';
  dropPlayerId?: string;
  dropPlayerName?: string;
  bidAmount?: number;
  priority: number;
  status: 'pending' | 'successful' | 'failed' | 'outbid';
  submittedAt: Date;
  processedAt?: Date;
  userId: string;
  userName: string;
}

type ActivityFeedItem = LeagueActivityItem & {
  playerName?: string;
  dropPlayerName?: string;
  teamName?: string;
};

type WaiverLoadSource = 'snapshot' | 'players';

type SerializedLeagueRoster = Omit<LeagueRoster, 'createdAt' | 'updatedAt'> & {
  createdAt?: string;
  updatedAt?: string;
};

type SerializedLeagueActivityItem = Omit<LeagueActivityItem, 'timestamp'> & {
  timestamp?: string;
};

type SerializedWaiverClaim = NonNullable<Props['initialClaims']>[number];

interface WaiverBootstrapResponse {
  claims?: SerializedWaiverClaim[];
  roster?: SerializedLeagueRoster | null;
  activity?: SerializedLeagueActivityItem[];
  remainingFAAB?: number;
  initialSettings?: Props['initialSettings'];
  availablePlayers?: NonNullable<Props['availablePlayers']>;
  playersIndex?: NonNullable<Props['playersIndex']>;
  selectedCategories?: FantasyCategoryKey[];
  nextPlayersCursor?: string | null;
  activityNextCursor?: string | null;
  activityHasMore?: boolean;
  error?: string;
}

function parseDate(value: Date | string | undefined, fallback = new Date()): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date;
  }
  return fallback;
}

function mapClaim(leagueId: string, claim: SerializedWaiverClaim): LeagueWaiverClaim {
  return {
    id: claim.id,
    leagueId,
    userId: claim.userId,
    teamId: claim.teamId,
    playerId: claim.playerId,
    dropPlayerId: claim.dropPlayerId,
    priority: claim.priority,
    status: claim.status,
    processingAt: claim.processingAt ? parseDate(claim.processingAt) : parseDate(claim.createdAt),
    processedAt: claim.processedAt ? parseDate(claim.processedAt) : undefined,
    createdAt: parseDate(claim.createdAt),
    bidAmount: claim.bidAmount,
  };
}

function mapRoster(roster: SerializedLeagueRoster | null | undefined): LeagueRoster | null {
  if (!roster) return null;

  return {
    ...roster,
    createdAt: parseDate(roster.createdAt),
    updatedAt: parseDate(roster.updatedAt),
  };
}

function mapActivity(item: SerializedLeagueActivityItem): LeagueActivityItem {
  return {
    ...item,
    timestamp: parseDate(item.timestamp),
  };
}

export default function LeagueWaiversContainer({
  leagueId,
  currentUserId,
  initialClaims,
  initialSettings: _initialSettings,
  availablePlayers: _availablePlayers,
  playersIndex,
  membersIndex,
  selectedCategories: _selectedCategories,
  initialPlayersCursor,
  initialPlayerId,
}: Props): React.JSX.Element | null {
  const { user, loading } = useAuth();
  const effectiveUserId = user?.uid ?? currentUserId ?? null;
  const hasInitialPlayerBootstrap =
    _availablePlayers !== undefined ||
    playersIndex !== undefined ||
    initialPlayersCursor !== undefined;
  const shouldRequestInitialPlayers = !hasInitialPlayerBootstrap;
  // Local player paging state
  const [availablePlayers, setAvailablePlayers] = useState(_availablePlayers || []);
  const [playersIdx, setPlayersIdx] = useState(playersIndex || {});
  const [playersCursor, setPlayersCursor] = useState<string | null | undefined>(
    initialPlayersCursor
  );
  const [hasMorePlayers, setHasMorePlayers] = useState<boolean>(!!initialPlayersCursor);
  const [loadingMorePlayers, setLoadingMorePlayers] = useState<boolean>(false);
  const [claims, setClaims] = useState<LeagueWaiverClaim[]>(() => {
    if (!initialClaims) return [] as LeagueWaiverClaim[];
    return initialClaims.map((claim) => mapClaim(leagueId, claim));
  });
  const [selectedCategories, setSelectedCategories] = useState<FantasyCategoryKey[]>(
    _selectedCategories || []
  );
  const [roster, setRoster] = useState<LeagueRoster | null>(null);
  const [activity, setActivity] = useState<LeagueActivityItem[]>([]);
  const [settings, setSettings] = useState(_initialSettings);
  const [remainingFAAB, setRemainingFAAB] = useState<number | undefined>(undefined);
  const [waiverLoadErrors, setWaiverLoadErrors] = useState<
    Partial<Record<WaiverLoadSource, string>>
  >({});
  const waiverLoadError = useMemo(
    () => Object.values(waiverLoadErrors)[0] ?? null,
    [waiverLoadErrors]
  );
  const [retryingWaiverSnapshot, setRetryingWaiverSnapshot] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Activity paging state
  const ACTIVITY_PAGE_SIZE = 50;
  const [activityNextCursor, setActivityNextCursor] = useState<string | null>(null);
  const [activityHasMore, setActivityHasMore] = useState<boolean>(false);
  const [loadingMoreActivity, setLoadingMoreActivity] = useState<boolean>(false);

  const loadWaiverSnapshot = useCallback(
    async ({
      signal,
      includePlayers = false,
      appendPlayers = false,
      appendActivity = false,
      cursor,
      playersCursor,
    }: {
      signal?: AbortSignal;
      includePlayers?: boolean;
      appendPlayers?: boolean;
      appendActivity?: boolean;
      cursor?: string | null;
      playersCursor?: string | null;
    } = {}) => {
      const url = new URL(`/api/leagues/${leagueId}/waivers`, window.location.origin);
      url.searchParams.set('playersLimit', includePlayers ? '100' : '0');
      url.searchParams.set('activityLimit', String(ACTIVITY_PAGE_SIZE));
      if (cursor) {
        url.searchParams.set('activityCursor', cursor);
      }
      if (playersCursor) {
        url.searchParams.set('playersCursor', playersCursor);
      }

      const response = await fetch(url.toString(), { signal });
      const data = (await response.json().catch(() => ({}))) as WaiverBootstrapResponse;
      if (!response.ok) {
        throw new Error(data.error || `Waiver data failed with status ${response.status}`);
      }

      if (Array.isArray(data.claims)) {
        setClaims(data.claims.map((claim) => mapClaim(leagueId, claim)));
      }
      setRoster(mapRoster(data.roster));
      setActivity((prev) => {
        const incoming = Array.isArray(data.activity) ? data.activity.map(mapActivity) : [];
        if (!appendActivity) return incoming;

        const seen = new Set(prev.map((item) => item.id));
        return [...prev, ...incoming.filter((item) => !seen.has(item.id))];
      });
      setActivityNextCursor(data.activityNextCursor ?? null);
      setActivityHasMore(Boolean(data.activityHasMore));
      setRemainingFAAB(typeof data.remainingFAAB === 'number' ? data.remainingFAAB : undefined);
      if (data.initialSettings) {
        setSettings(data.initialSettings);
      }
      if (Array.isArray(data.selectedCategories)) {
        setSelectedCategories(data.selectedCategories);
      }
      if (includePlayers && Array.isArray(data.availablePlayers)) {
        setAvailablePlayers((prev) => {
          if (!appendPlayers) return data.availablePlayers ?? [];

          const seen = new Set(prev.map((player) => player.id));
          const merged = [...prev];
          for (const player of data.availablePlayers ?? []) {
            if (!seen.has(player.id)) merged.push(player);
          }
          return merged;
        });
        setPlayersCursor(data.nextPlayersCursor ?? null);
        setHasMorePlayers(Boolean(data.nextPlayersCursor));
      }
      if (data.playersIndex) {
        setPlayersIdx((prev) => ({ ...prev, ...data.playersIndex }));
      }
      setWaiverLoadErrors((prev) => {
        if (!prev.snapshot) return prev;
        const next = { ...prev };
        delete next.snapshot;
        return next;
      });
    },
    [ACTIVITY_PAGE_SIZE, leagueId]
  );

  useEffect(() => {
    if (!effectiveUserId) return;

    const controller = new AbortController();

    const bootstrapWaivers = async () => {
      try {
        await loadWaiverSnapshot({
          signal: controller.signal,
          includePlayers: shouldRequestInitialPlayers,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        const detail = error instanceof Error ? error.message : 'Waiver data is unavailable';
        setWaiverLoadErrors((prev) => ({ ...prev, snapshot: detail }));
        console.error('Waiver data is unavailable', error);
      }
    };

    void bootstrapWaivers();

    return () => {
      controller.abort();
    };
  }, [effectiveUserId, loadWaiverSnapshot, shouldRequestInitialPlayers]);

  const handleLoadMoreActivity = async () => {
    if (!activityNextCursor || loadingMoreActivity) return;
    try {
      setLoadingMoreActivity(true);
      await loadWaiverSnapshot({
        includePlayers: false,
        appendActivity: true,
        cursor: activityNextCursor,
      });
    } catch (err) {
      console.error('Load more activity error', err);
    } finally {
      setLoadingMoreActivity(false);
    }
  };

  const handleRetryWaiverSnapshot = useCallback(async () => {
    if (retryingWaiverSnapshot) return;

    try {
      setRetryingWaiverSnapshot(true);
      await loadWaiverSnapshot({
        includePlayers: shouldRequestInitialPlayers && availablePlayers.length === 0,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Waiver data is unavailable';
      setWaiverLoadErrors((prev) => ({ ...prev, snapshot: detail }));
      console.error('Waiver data retry failed', error);
    } finally {
      setRetryingWaiverSnapshot(false);
    }
  }, [
    availablePlayers.length,
    loadWaiverSnapshot,
    retryingWaiverSnapshot,
    shouldRequestInitialPlayers,
  ]);

  const rosterDropOptions = useMemo(() => {
    if (!roster?.playerIds?.length)
      return [] as { id: string; name: string; team?: string; position?: string }[];
    return roster.playerIds.map((id) => ({
      id,
      name: playersIdx?.[id]?.name || `Player ${id}`,
      team: playersIdx?.[id]?.team,
      position: playersIdx?.[id]?.position,
    }));
  }, [roster, playersIdx]);

  const mappedClaims: UIWaiverClaim[] = useMemo(() => {
    return claims.map((c) => ({
      id: c.id,
      playerId: c.playerId,
      playerName: playersIdx?.[c.playerId]?.name || `Player ${c.playerId}`,
      playerPosition: playersIdx?.[c.playerId]?.position || '',
      playerTeam: playersIdx?.[c.playerId]?.team || '',
      action: 'add',
      dropPlayerId: c.dropPlayerId,
      dropPlayerName: c.dropPlayerId
        ? playersIdx?.[c.dropPlayerId]?.name || `Player ${c.dropPlayerId}`
        : undefined,
      bidAmount: c.bidAmount,
      priority: c.priority,
      status:
        c.status === 'PENDING'
          ? 'pending'
          : c.status === 'SUCCESSFUL'
            ? 'successful'
            : c.status === 'FAILED'
              ? 'failed'
              : 'failed',
      submittedAt: c.createdAt,
      processedAt: c.processedAt,
      userId: c.userId,
      userName: 'You',
    }));
  }, [claims, playersIdx]);

  const pendingBids = useMemo(() => {
    return claims.reduce((sum, c) => {
      if (c.status === 'PENDING' && typeof c.bidAmount === 'number') return sum + c.bidAmount;
      return sum;
    }, 0);
  }, [claims]);

  const totalBudget = useMemo(() => {
    const ws = settings?.waiverSettings;
    return typeof ws?.faabBudget === 'number' ? ws.faabBudget : undefined;
  }, [settings]);

  const minimumBid = useMemo(() => {
    const ws = settings?.waiverSettings;
    return typeof ws?.minimumBid === 'number' ? ws.minimumBid : undefined;
  }, [settings]);

  const namedActivity = useMemo<ActivityFeedItem[]>(() => {
    return activity.map((it) => ({
      ...it,
      playerName: it.playerId
        ? playersIdx?.[it.playerId]?.name || `Player ${it.playerId}`
        : undefined,
      dropPlayerName: it.dropPlayerId
        ? playersIdx?.[it.dropPlayerId]?.name || `Player ${it.dropPlayerId}`
        : undefined,
      teamName: it.userId ? membersIndex?.[it.userId]?.teamName : undefined,
    }));
  }, [activity, playersIdx, membersIndex]);

  const handleSubmitClaim = async (claim: Partial<UIWaiverClaim>) => {
    if (!effectiveUserId || !leagueId) return;

    // Validate required fields
    if (!claim.playerId) {
      const msg = 'Please select a player';
      setSubmitError(msg);
      console.error('[handleSubmitClaim] Missing required playerId');
      return;
    }
    if (!roster?.id) {
      const msg = 'No roster found for your account';
      setSubmitError(msg);
      console.error('[handleSubmitClaim] No roster found for user');
      return;
    }

    try {
      setSubmitError(null);
      const res = await authenticatedFetch(
        `/api/leagues/${leagueId}/waivers/submit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: effectiveUserId,
            teamId: roster.id,
            playerId: String(claim.playerId),
            dropPlayerId: claim.dropPlayerId,
            priority: claim.priority ?? 1,
            bidAmount: claim.bidAmount,
          }),
        },
        effectiveUserId
      );

      if (!res.ok) {
        const j = await res.json().catch(() => ({}) as { error?: string });
        const msg = j?.error || 'Failed to submit waiver claim';
        setSubmitError(msg);
        console.error('[handleSubmitClaim] Failed:', j);
        return;
      }
      await loadWaiverSnapshot({ includePlayers: false });
    } catch (err) {
      setSubmitError('Failed to submit waiver claim');
      console.error('[handleSubmitClaim] Error:', err);
    }
  };

  const handleCancelClaim = async (id: string) => {
    if (!effectiveUserId || !leagueId) return;
    try {
      const res = await authenticatedFetch(
        `/api/leagues/${leagueId}/waivers/cancel`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: effectiveUserId, claimId: id }),
        },
        effectiveUserId
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        console.error('Cancel claim failed', j);
        return;
      }
      await loadWaiverSnapshot({ includePlayers: false });
    } catch (err) {
      console.error('Failed to cancel waiver claim', err);
    }
  };

  const handleLoadMorePlayers = async () => {
    if (!hasMorePlayers || !playersCursor || loadingMorePlayers) return;
    try {
      setLoadingMorePlayers(true);
      await loadWaiverSnapshot({
        includePlayers: true,
        appendPlayers: true,
        appendActivity: false,
        playersCursor,
      });
    } catch (err) {
      console.error('Load more players error', err);
      setHasMorePlayers(false);
    } finally {
      setLoadingMorePlayers(false);
    }
  };

  if (loading && !effectiveUserId) return <LoadingSpinner />;
  if (!effectiveUserId) {
    return (
      <div
        className="rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground"
        role="status"
      >
        Sign in to manage waiver claims for this league.
      </div>
    );
  }

  return (
    <>
      {waiverLoadError && (
        <div
          className="mb-4 flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
          role="alert"
        >
          <span>{waiverLoadError}</span>
          <button
            type="button"
            onClick={handleRetryWaiverSnapshot}
            disabled={retryingWaiverSnapshot}
            className="inline-flex h-9 items-center justify-center rounded-md border border-destructive/30 bg-background px-3 text-sm font-medium text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Retry waiver data"
          >
            {retryingWaiverSnapshot ? 'Retrying...' : 'Retry'}
          </button>
        </div>
      )}
      {submitError && (
        <div
          className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-red-700 text-sm"
          role="alert"
        >
          {submitError}
        </div>
      )}
      <WaiverFAABSystem
        userClaims={mappedClaims}
        availablePlayers={availablePlayers}
        rosterDropOptions={rosterDropOptions}
        onSubmitClaim={handleSubmitClaim}
        onCancelClaim={handleCancelClaim}
        activityItems={namedActivity}
        currentBalance={remainingFAAB}
        pendingBids={pendingBids}
        totalBudget={totalBudget}
        userTeamName={roster?.teamName}
        minimumBid={minimumBid}
        selectedCategories={selectedCategories}
        onLoadMorePlayers={hasMorePlayers ? handleLoadMorePlayers : undefined}
        loadingMorePlayers={loadingMorePlayers}
        hasMorePlayers={hasMorePlayers}
        initialPlayerId={initialPlayerId}
      />

      {/* Load older activity */}
      {activity.length > 0 && activityHasMore && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={handleLoadMoreActivity}
            disabled={loadingMoreActivity}
            className={`px-4 py-2 rounded-md text-sm font-medium border ${loadingMoreActivity ? 'opacity-60 cursor-not-allowed' : 'hover:bg-gray-50'}`}
          >
            {loadingMoreActivity ? 'Loading…' : 'Load older activity'}
          </button>
        </div>
      )}
    </>
  );
}
