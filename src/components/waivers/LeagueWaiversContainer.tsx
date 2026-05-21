'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { type DocumentSnapshot } from 'firebase/firestore';

import { useAuth } from '@/AuthContext';
import { LoadingSpinner } from '@/components/ui';
import WaiverFAABSystem from '@/components/waivers/WaiverFAABSystem';
import { cn } from '@/lib/utils';
import {
  LeagueDataService,
  type LeagueWaiverClaim,
  type LeagueRoster,
  type LeagueActivityItem,
  type LeagueWaiverPriorityEntry,
} from '@/services/leagueDataService';

interface Props {
  leagueId: string;
  embedded?: boolean;
  disableRealtime?: boolean;
  preselectedClaimPlayerId?: string;
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
  }>;
  initialSettings?: {
    waiverSettings?: {
      faabBudget?: number;
      minimumBid?: number;
      system?: string;
      processTime?: string;
      waiverPeriod?: number;
    };
  };
  availablePlayers?: Array<{
    id: string;
    name: string;
    team?: string;
    position?: string;
    ownership?: number;
    avg?: number;
    statsSummary?: {
      disposals?: number;
      tackles?: number;
      marks?: number;
      goals?: number;
    };
  }>;
  playersIndex?: Record<
    string,
    {
      id: string;
      name: string;
      team?: string;
      position?: string;
      avg?: number;
      statsSummary?: {
        disposals?: number;
        tackles?: number;
        marks?: number;
        goals?: number;
      };
    }
  >;
  membersIndex?: Record<
    string,
    { userId: string; teamId?: string; teamName?: string; role?: string }
  >;
  initialWaiverOrder?: Array<{
    userId: string;
    teamId?: string;
    teamName?: string;
    currentPriority?: number;
    remainingFAAB?: number;
  }>;
  initialPlayersCursor?: string | null;
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

type PlayerRow = {
  id: string;
  name: string;
  team?: string;
  position?: string;
  ownership?: number;
  avg?: number;
  statsSummary?: {
    disposals?: number;
    tackles?: number;
    marks?: number;
    goals?: number;
  };
};
type PlayerIndex = Record<
  string,
  {
    id: string;
    name: string;
    team?: string;
    position?: string;
    avg?: number;
    statsSummary?: {
      disposals?: number;
      tackles?: number;
      marks?: number;
      goals?: number;
    };
  }
>;

function formatDisplayPlayerName(rawName: string | undefined, fallbackId: string): string {
  const source = (rawName || fallbackId || '').trim();
  if (!source) return 'Unknown Player';
  if (!source.includes('_')) return source;
  return source
    .replace(/_/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizePlayers(list: PlayerRow[]): PlayerRow[] {
  return list.map((player) => ({
    ...player,
    name: formatDisplayPlayerName(player.name, player.id),
  }));
}

function normalizePlayersIndex(index: PlayerIndex): PlayerIndex {
  const next: PlayerIndex = {};
  Object.entries(index).forEach(([id, player]) => {
    next[id] = {
      ...player,
      name: formatDisplayPlayerName(player?.name, id),
    };
  });
  return next;
}

function isAbortLikeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const maybeError = error as { name?: string; message?: string };
  if (maybeError.name === 'AbortError' || maybeError.name === 'TimeoutError') return true;
  return (
    typeof maybeError.message === 'string' && maybeError.message.toLowerCase().includes('aborted')
  );
}

function isNetworkFetchError(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  return error.message.toLowerCase().includes('failed to fetch');
}

type PlayersApiResponse = {
  items: Array<{
    id: string;
    name: string;
    team?: string;
    position?: string;
    ownership?: number;
  }>;
  nextCursor?: string | null;
};

type WaiversSnapshotResponse = {
  claims?: Array<{
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
  priorities?: Array<{
    userId: string;
    teamId?: string;
    teamName?: string;
    currentPriority?: number;
    remainingFAAB?: number;
    pendingBidTotal?: number;
  }>;
};

type ProcessWaiversResponse = {
  processed?: number;
  results?: Array<{ id: string; status: string; reason?: string }>;
};

export default function LeagueWaiversContainer({
  leagueId,
  embedded = false,
  disableRealtime = false,
  preselectedClaimPlayerId,
  initialClaims,
  initialSettings: _initialSettings,
  availablePlayers: _availablePlayers,
  playersIndex,
  membersIndex,
  initialWaiverOrder,
  initialPlayersCursor,
}: Props) {
  const { user, loading } = useAuth();
  const leagueDataService = useMemo(() => new LeagueDataService(), []);
  // Local player paging state
  const [availablePlayers, setAvailablePlayers] = useState(() =>
    normalizePlayers((_availablePlayers || []) as PlayerRow[])
  );
  const [playersIdx, setPlayersIdx] = useState(() =>
    normalizePlayersIndex((playersIndex || {}) as PlayerIndex)
  );
  const [playersCursor, setPlayersCursor] = useState<string | null | undefined>(
    initialPlayersCursor
  );
  const [hasMorePlayers, setHasMorePlayers] = useState<boolean>(
    () => !!initialPlayersCursor || (_availablePlayers?.length ?? 0) === 0
  );
  const [loadingMorePlayers, setLoadingMorePlayers] = useState<boolean>(false);
  const [claims, setClaims] = useState<LeagueWaiverClaim[]>(() => {
    if (!initialClaims) return [] as LeagueWaiverClaim[];
    return initialClaims.map((c) => ({
      id: c.id,
      leagueId,
      userId: c.userId,
      teamId: c.teamId,
      playerId: c.playerId,
      dropPlayerId: c.dropPlayerId,
      priority: c.priority,
      status: c.status,
      // processingAt is the server-side scheduled processing time; fall back to createdAt if absent
      processingAt: c.processingAt ? new Date(c.processingAt) : new Date(c.createdAt),
      processedAt: c.processedAt ? new Date(c.processedAt) : undefined,
      createdAt: new Date(c.createdAt),
      bidAmount: undefined,
    })) as LeagueWaiverClaim[];
  });
  const [roster, setRoster] = useState<LeagueRoster | null>(null);
  const [activity, setActivity] = useState<LeagueActivityItem[]>([]);
  const [remainingFAAB, setRemainingFAAB] = useState<number | undefined>(undefined);
  const [waiverPriorities, setWaiverPriorities] = useState<LeagueWaiverPriorityEntry[]>(
    () =>
      (initialWaiverOrder || []).map((entry) => ({
        userId: entry.userId,
        leagueId,
        currentPriority: entry.currentPriority,
        remainingFAAB: entry.remainingFAAB,
      })) as LeagueWaiverPriorityEntry[]
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [dataRefreshError, setDataRefreshError] = useState<string | null>(null);
  const [processingClaims, setProcessingClaims] = useState(false);
  const [processResult, setProcessResult] = useState<string | null>(null);
  const [realtimeFallbackEnabled, setRealtimeFallbackEnabled] = useState(false);

  // Activity paging state
  const ACTIVITY_PAGE_SIZE = 50;
  const [activityLastDoc, setActivityLastDoc] = useState<DocumentSnapshot | null>(null);
  const [activityHasMore, setActivityHasMore] = useState<boolean>(true);
  const [loadingMoreActivity, setLoadingMoreActivity] = useState<boolean>(false);
  const [hasLoadedMoreActivity, setHasLoadedMoreActivity] = useState<boolean>(false);
  const refreshAbortRef = useRef<AbortController | null>(null);
  const refreshInFlightRef = useRef(false);
  const loadMorePlayersAbortRef = useRef<AbortController | null>(null);

  const refreshApiOnlyState = useCallback(async () => {
    if (!user?.uid) return;
    if (refreshInFlightRef.current) return;
    refreshAbortRef.current?.abort(new DOMException('Superseded refresh request', 'AbortError'));
    const abortController = new AbortController();
    refreshAbortRef.current = abortController;
    refreshInFlightRef.current = true;
    try {
      const [rosterRes, waiversRes] = await Promise.all([
        fetch(`/api/leagues/${leagueId}/roster/${user.uid}`, {
          credentials: 'include',
          signal: abortController.signal,
        }),
        fetch(`/api/leagues/${leagueId}/waivers`, {
          credentials: 'include',
          signal: abortController.signal,
        }),
      ]);

      if (!rosterRes.ok || !waiversRes.ok) {
        const failedResponse = !rosterRes.ok ? rosterRes : waiversRes;
        const payload = (await failedResponse.json().catch(() => ({}))) as { error?: string };
        const reason =
          payload?.error || `HTTP ${failedResponse.status}`;
        throw new Error(
          `Waiver data is temporarily unavailable. Showing the last loaded state. ${reason}`
        );
      }

      if (rosterRes.ok) {
        const payload = (await rosterRes.json()) as {
          data?: {
            roster?: {
              id?: string;
              memberId?: string;
              teamName?: string;
              players?: Array<{ id: string }>;
            };
          };
          roster?: {
            id?: string;
            memberId?: string;
            teamName?: string;
            players?: Array<{ id: string }>;
          };
        };
        const rosterRaw = payload?.data?.roster ?? payload?.roster;
        if (rosterRaw) {
          const playerIds = Array.isArray(rosterRaw.players)
            ? rosterRaw.players.map((player) => String(player.id))
            : [];
          setRoster({
            id: String(rosterRaw.id ?? ''),
            memberId: rosterRaw.memberId ? String(rosterRaw.memberId) : undefined,
            userId: user.uid,
            teamName: String(rosterRaw.teamName ?? ''),
            playerIds,
            bench: [],
            emergencies: [],
            leagueId,
            updatedAt: new Date(),
            createdAt: new Date(),
          });
        }
      }

      if (waiversRes.ok) {
        const payload = (await waiversRes.json()) as WaiversSnapshotResponse;
        const nextClaims = Array.isArray(payload.claims)
          ? payload.claims.map((claim) => ({
              id: claim.id,
              leagueId,
              userId: claim.userId,
              teamId: claim.teamId,
              playerId: claim.playerId,
              dropPlayerId: claim.dropPlayerId,
              priority: claim.priority,
              status: claim.status,
              processingAt: claim.processingAt
                ? new Date(claim.processingAt)
                : new Date(claim.createdAt),
              processedAt: claim.processedAt ? new Date(claim.processedAt) : undefined,
              createdAt: new Date(claim.createdAt),
              bidAmount: claim.bidAmount,
            }))
          : [];
        setClaims(nextClaims);

        const nextPriorities = Array.isArray(payload.priorities)
          ? payload.priorities.map((entry) => ({
              userId: entry.userId,
              leagueId,
              currentPriority: entry.currentPriority,
              remainingFAAB: entry.remainingFAAB,
              pendingBidTotal: entry.pendingBidTotal,
            }))
          : [];
        setWaiverPriorities(nextPriorities);
      }
      setDataRefreshError(null);
    } catch (error) {
      if (isAbortLikeError(error)) {
        return;
      }
      const message = isNetworkFetchError(error)
        ? 'Waiver data is temporarily unavailable. Showing the last loaded state.'
        : error instanceof Error
          ? error.message
          : 'Waiver data is temporarily unavailable. Showing the last loaded state.';
      setDataRefreshError(message);
      console.error('Failed to refresh API-only waiver state', error);
    } finally {
      if (refreshAbortRef.current === abortController) {
        refreshAbortRef.current = null;
      }
      refreshInFlightRef.current = false;
    }
  }, [leagueId, user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    if (disableRealtime || realtimeFallbackEnabled) {
      let active = true;
      void refreshApiOnlyState();
      const intervalId = window.setInterval(() => {
        if (!active) return;
        void refreshApiOnlyState();
      }, 15000);
      return () => {
        active = false;
        refreshAbortRef.current?.abort(new DOMException('Waivers polling stopped', 'AbortError'));
        refreshAbortRef.current = null;
        window.clearInterval(intervalId);
      };
    }
    let subKey: string | null = null;
    let rosterKey: string | null = null;
    let activityKey: string | null = null;
    let faabKey: string | null = null;
    let prioritiesKey: string | null = null;
    let active = true;
    const handleRealtimeError = (label: string, error: Error) => {
      console.error(label, error);
      setRealtimeFallbackEnabled(true);
    };

    void user
      .getIdToken()
      .then(() => {
        if (!active) return;

        try {
          subKey = leagueDataService.subscribeToLeagueWaivers(
            leagueId,
            (c) => setClaims(c),
            undefined,
            (err) => handleRealtimeError('Waivers sub error', err)
          );

          rosterKey = leagueDataService.subscribeToUserRoster(
            leagueId,
            user.uid,
            (r) => setRoster(r),
            (err) => handleRealtimeError('Roster sub error', err)
          );

          activityKey = leagueDataService.subscribeToLeagueActivity(
            leagueId,
            (items, pageMeta) => {
              // Merge latest snapshot with any previously loaded older items (dedupe by id)
              setActivity((prev) => {
                const latestIds = new Set(items.map((i) => i.id));
                const preservedOlder = prev.filter((p) => !latestIds.has(p.id));
                return [...items, ...preservedOlder];
              });
              // Only update the paging cursor if we haven't paged older items yet
              if (!hasLoadedMoreActivity) {
                setActivityLastDoc(pageMeta?.lastDoc ?? null);
              }
              // Heuristic: if we received a full page, likely more exist
              setActivityHasMore((items?.length ?? 0) === ACTIVITY_PAGE_SIZE);
            },
            { pageSize: ACTIVITY_PAGE_SIZE },
            (err) => handleRealtimeError('Activity sub error', err)
          );

          faabKey = leagueDataService.subscribeToWaiverPriority(
            leagueId,
            user.uid,
            (remaining) => setRemainingFAAB(remaining),
            (err) => handleRealtimeError('Waiver priority sub error', err)
          );

          prioritiesKey = leagueDataService.subscribeToLeagueWaiverPriorities(
            leagueId,
            (items) => setWaiverPriorities(items),
            (err) => handleRealtimeError('Waiver priorities sub error', err)
          );
        } catch (error) {
          console.error('Failed to initialize waiver subscriptions', error);
          setDataRefreshError(
            'Realtime waiver updates are unavailable. Falling back to periodic refresh.'
          );
          setRealtimeFallbackEnabled(true);
        }
      })
      .catch((error) => {
        console.error('Failed to prepare waiver realtime auth', error);
        setDataRefreshError(
          'Realtime waiver updates are unavailable. Falling back to periodic refresh.'
        );
        setRealtimeFallbackEnabled(true);
      });

    return () => {
      active = false;
      if (subKey) leagueDataService.unsubscribe(subKey);
      if (rosterKey) leagueDataService.unsubscribe(rosterKey);
      if (activityKey) leagueDataService.unsubscribe(activityKey);
      if (faabKey) leagueDataService.unsubscribe(faabKey);
      if (prioritiesKey) leagueDataService.unsubscribe(prioritiesKey);
    };
  }, [
    leagueId,
    user,
    user?.uid,
    hasLoadedMoreActivity,
    disableRealtime,
    realtimeFallbackEnabled,
    refreshApiOnlyState,
  ]);

  const handleLoadMoreActivity = async () => {
    if (!activityLastDoc || loadingMoreActivity) return;
    try {
      setLoadingMoreActivity(true);
      const page = await leagueDataService.getNextActivityPage(
        leagueId,
        activityLastDoc,
        ACTIVITY_PAGE_SIZE,
        'desc'
      );
      setActivity((prev) => {
        const existing = new Set(prev.map((i) => i.id));
        const toAppend = page.items.filter((i) => !existing.has(i.id));
        return [...prev, ...toAppend];
      });
      setActivityLastDoc(page.lastDoc);
      setHasLoadedMoreActivity(true);
      setActivityHasMore(page.items.length === ACTIVITY_PAGE_SIZE && !!page.lastDoc);
    } catch (err) {
      console.error('Load more activity error', err);
    } finally {
      setLoadingMoreActivity(false);
    }
  };

  const rosterDropOptions = useMemo(() => {
    if (!roster?.playerIds?.length)
      return [] as { id: string; name: string; team?: string; position?: string }[];
    return roster.playerIds.map((id) => ({
      id,
      name: playersIdx?.[id]?.name || formatDisplayPlayerName(undefined, id),
      team: playersIdx?.[id]?.team,
      position: playersIdx?.[id]?.position,
    }));
  }, [roster, playersIdx]);

  const myClaims = useMemo(
    () =>
      claims.filter((claim) => {
        if (claim.userId && claim.userId === user?.uid) return true;
        if (!claim.userId && roster?.id && claim.teamId === roster.id) return true;
        return false;
      }),
    [claims, roster?.id, user?.uid]
  );

  const mappedClaims: UIWaiverClaim[] = useMemo(() => {
    return myClaims.map((c) => ({
      id: c.id,
      playerId: c.playerId,
      playerName: playersIdx?.[c.playerId]?.name || formatDisplayPlayerName(undefined, c.playerId),
      playerPosition: playersIdx?.[c.playerId]?.position || '',
      playerTeam: playersIdx?.[c.playerId]?.team || '',
      action: 'add',
      dropPlayerId: c.dropPlayerId,
      dropPlayerName: c.dropPlayerId
        ? playersIdx?.[c.dropPlayerId]?.name || formatDisplayPlayerName(undefined, c.dropPlayerId)
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
      userName: membersIndex?.[c.userId]?.teamName || 'You',
    }));
  }, [myClaims, playersIdx, membersIndex]);

  const mappedLeagueClaims: UIWaiverClaim[] = useMemo(() => {
    return claims.map((c) => ({
      id: c.id,
      playerId: c.playerId,
      playerName: playersIdx?.[c.playerId]?.name || formatDisplayPlayerName(undefined, c.playerId),
      playerPosition: playersIdx?.[c.playerId]?.position || '',
      playerTeam: playersIdx?.[c.playerId]?.team || '',
      action: 'add',
      dropPlayerId: c.dropPlayerId,
      dropPlayerName: c.dropPlayerId
        ? playersIdx?.[c.dropPlayerId]?.name || formatDisplayPlayerName(undefined, c.dropPlayerId)
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
      userName: membersIndex?.[c.userId]?.teamName || 'League team',
    }));
  }, [claims, playersIdx, membersIndex]);

  const pendingBids = useMemo(() => {
    return myClaims.reduce((sum, c) => {
      if (c.status === 'PENDING' && typeof c.bidAmount === 'number') return sum + c.bidAmount;
      return sum;
    }, 0);
  }, [myClaims]);

  const totalBudget = useMemo(() => {
    const ws = _initialSettings?.waiverSettings;
    return typeof ws?.faabBudget === 'number' ? ws.faabBudget : undefined;
  }, [_initialSettings]);

  const minimumBid = useMemo(() => {
    const ws = _initialSettings?.waiverSettings as { minimumBid?: number } | undefined;
    return typeof ws?.minimumBid === 'number' ? ws.minimumBid : undefined;
  }, [_initialSettings]);

  const namedActivity = useMemo<ActivityFeedItem[]>(() => {
    return activity.map((it) => ({
      ...it,
      playerName: it.playerId
        ? playersIdx?.[it.playerId]?.name || formatDisplayPlayerName(undefined, it.playerId)
        : undefined,
      dropPlayerName: it.dropPlayerId
        ? playersIdx?.[it.dropPlayerId]?.name || formatDisplayPlayerName(undefined, it.dropPlayerId)
        : undefined,
      teamName: it.userId ? membersIndex?.[it.userId]?.teamName : undefined,
    }));
  }, [activity, playersIdx, membersIndex]);

  const waiverOrder = useMemo(() => {
    const memberRows = Object.values(membersIndex || {}).sort((a, b) =>
      (a.teamName || '').localeCompare(b.teamName || '')
    );
    const pendingClaimsByUser = claims.reduce<Record<string, number>>((acc, claim) => {
      if (claim.status === 'PENDING') {
        acc[claim.userId] = (acc[claim.userId] || 0) + 1;
      }
      return acc;
    }, {});

    return memberRows
      .map((member, index) => {
        const priority = waiverPriorities.find((entry) => entry.userId === member.userId);
        return {
          userId: member.userId,
          teamId: member.teamId,
          teamName: member.teamName,
          currentPriority: priority?.currentPriority ?? index + 1,
          remainingFAAB: priority?.remainingFAAB,
          pendingBidTotal: priority?.pendingBidTotal,
          pendingClaims: pendingClaimsByUser[member.userId] || 0,
        };
      })
      .sort((a, b) => (a.currentPriority ?? 9999) - (b.currentPriority ?? 9999));
  }, [claims, membersIndex, waiverPriorities]);

  const canProcessClaims = useMemo(() => {
    const role = user?.uid ? membersIndex?.[user.uid]?.role : undefined;
    if (typeof role !== 'string') return false;
    return ['owner', 'commissioner'].includes(role.toLowerCase());
  }, [membersIndex, user?.uid]);

  const formatProcessResult = (result: ProcessWaiversResponse) => {
    const processed = result.processed ?? result.results?.length ?? 0;
    if (processed === 0) return 'No pending waiver claims to process.';
    const label = processed === 1 ? 'waiver claim' : 'waiver claims';
    return `Processed ${processed} ${label}.`;
  };

  const handleSubmitClaim = async (claim: Partial<UIWaiverClaim>) => {
    if (!user?.uid || !leagueId) return;

    // Validate required fields
    if (!claim.playerId) {
      const msg = 'Please select a player';
      setSubmitError(msg);
      return;
    }
    if (!roster?.id) {
      const msg = 'No roster found for your account';
      setSubmitError(msg);
      return;
    }

    try {
      setSubmitError(null);
      const res = await fetch(`/api/leagues/${leagueId}/waivers/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          teamId: roster.memberId ?? roster.id,
          playerId: String(claim.playerId),
          dropPlayerId: claim.dropPlayerId,
          priority: claim.priority ?? 1,
          bidAmount: claim.bidAmount,
        }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}) as { error?: string });
        const msg = j?.error || 'Failed to submit waiver claim';
        setSubmitError(msg);
        return;
      }
      await refreshApiOnlyState();
    } catch (err) {
      setSubmitError('Failed to submit waiver claim');
      console.error('[handleSubmitClaim] Error:', err);
    }
  };

  const handleCancelClaim = async (id: string) => {
    if (!user?.uid || !leagueId) return;
    try {
      setSubmitError(null);
      const res = await fetch(`/api/leagues/${leagueId}/waivers/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, claimId: id }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        console.error('Cancel claim failed', j);
        setSubmitError(j?.error || 'Failed to cancel waiver claim');
        return;
      }
      await refreshApiOnlyState();
      setSubmitError(null);
    } catch (err) {
      setSubmitError('Failed to cancel waiver claim');
      console.error('Failed to cancel waiver claim', err);
    }
  };

  const handleProcessClaims = async () => {
    if (!user?.uid || !leagueId || !canProcessClaims || processingClaims) return;
    try {
      setProcessingClaims(true);
      setSubmitError(null);
      setProcessResult(null);
      const res = await fetch(`/api/leagues/${leagueId}/waivers/process`, {
        method: 'POST',
      });
      const payload = (await res.json().catch(() => ({}))) as ProcessWaiversResponse & {
        error?: string;
      };
      if (!res.ok) {
        setSubmitError(payload?.error || 'Failed to process waiver claims');
        return;
      }
      setProcessResult(formatProcessResult(payload));
      await refreshApiOnlyState();
    } catch (err) {
      setSubmitError('Failed to process waiver claims');
      console.error('Failed to process waiver claims', err);
    } finally {
      setProcessingClaims(false);
    }
  };

  const handleLoadMorePlayers = useCallback(async () => {
    if (!hasMorePlayers || loadingMorePlayers) return;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    loadMorePlayersAbortRef.current?.abort(
      new DOMException('Superseded players pagination request', 'AbortError')
    );
    const abortController = new AbortController();
    loadMorePlayersAbortRef.current = abortController;
    try {
      setLoadingMorePlayers(true);
      setSubmitError(null);
      const token = user && typeof user.getIdToken === 'function' ? await user.getIdToken() : null;
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
      const buildUrl = (withOwnedFilter: boolean) => {
        const url = new URL(`/api/leagues/${leagueId}/players`, window.location.origin);
        url.searchParams.set('limit', '100');
        if (playersCursor) {
          url.searchParams.set('cursor', playersCursor);
        }
        if (withOwnedFilter) {
          url.searchParams.set('owned', 'false'); // fetch only unowned when supported
        }
        return url.toString();
      };
      const parseResponse = async (response: Response) => {
        const data = (await response.json()) as PlayersApiResponse;
        return {
          items: Array.isArray(data.items) ? data.items : [],
          nextCursor: data.nextCursor ?? null,
        };
      };
      timeoutId = setTimeout(() => {
        abortController.abort(new DOMException('Players request timed out', 'TimeoutError'));
      }, 5000);
      let res = await fetch(buildUrl(true), {
        signal: abortController.signal,
        headers,
        credentials: 'include',
      });
      let data: PlayersApiResponse | null = null;
      if (res.ok) {
        const parsed = await parseResponse(res);
        if (parsed.items.length > 0 || parsed.nextCursor) {
          data = parsed;
        }
      }
      if (!res.ok || !data) {
        // Fallback to unfiltered endpoint and derive claimable players client-side.
        res = await fetch(buildUrl(false), {
          signal: abortController.signal,
          headers,
          credentials: 'include',
        });
      }
      if (!res.ok) {
        console.error('Players page fetch failed', await res.text());
        setSubmitError('Unable to load available players right now. Please try again.');
        return;
      }
      if (!data) {
        data = await parseResponse(res);
      }
      if (Array.isArray(data.items) && data.items.length) {
        // Filter out owned players defensively (should already be unowned via API)
        const incoming = normalizePlayers(
          data.items.filter((p) => (typeof p.ownership === 'number' ? p.ownership < 100 : true))
        );
        setAvailablePlayers((prev) => {
          const seen = new Set(prev.map((p) => p.id));
          const merged = [...prev];
          for (const p of incoming) {
            if (!seen.has(p.id)) merged.push(p);
          }
          return merged;
        });
        setPlayersIdx((prev) => {
          const copy = { ...prev } as Record<
            string,
            { id: string; name: string; team?: string; position?: string }
          >;
          for (const p of incoming)
            copy[p.id] = { id: p.id, name: p.name, team: p.team, position: p.position };
          return copy;
        });
      }
      setPlayersCursor(data.nextCursor ?? null);
      setHasMorePlayers(!!data.nextCursor);
    } catch (err) {
      if (isAbortLikeError(err)) {
        return;
      }
      console.error('Load more players error', err);
      setSubmitError('Unable to load available players right now. Please try again.');
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (loadMorePlayersAbortRef.current === abortController) {
        loadMorePlayersAbortRef.current = null;
      }
      setLoadingMorePlayers(false);
    }
  }, [hasMorePlayers, loadingMorePlayers, user, leagueId, playersCursor]);

  useEffect(() => {
    return () => {
      refreshAbortRef.current?.abort(new DOMException('Waivers container unmounted', 'AbortError'));
      loadMorePlayersAbortRef.current?.abort(
        new DOMException('Waivers container unmounted', 'AbortError')
      );
    };
  }, []);

  useEffect(() => {
    // Prime first page automatically when bootstrapped list is empty.
    if (availablePlayers.length > 0) return;
    if (!hasMorePlayers || loadingMorePlayers) return;
    void handleLoadMorePlayers();
  }, [availablePlayers.length, hasMorePlayers, loadingMorePlayers, handleLoadMorePlayers]);

  if (loading) return <LoadingSpinner />;
  if (!user) return null;

  return (
    <>
      {submitError && (
        <div
          className="mb-4 rounded-md border border-[color:var(--league-danger-soft)] bg-[color:var(--league-danger-soft)] p-3 text-sm text-[color:var(--league-danger)]"
          role="alert"
        >
          {submitError}
        </div>
      )}
      {dataRefreshError && (
        <div
          className="mb-4 rounded-md border border-[color:var(--league-warning-soft)] bg-[color:var(--league-warning-soft)] p-3 text-sm text-[color:var(--league-warning)]"
          role="status"
        >
          {dataRefreshError}
        </div>
      )}
      <WaiverFAABSystem
        embedded={embedded}
        userClaims={mappedClaims}
        leagueClaims={mappedLeagueClaims}
        waiverOrder={waiverOrder}
        availablePlayers={availablePlayers}
        rosterDropOptions={rosterDropOptions}
        onSubmitClaim={handleSubmitClaim}
        onCancelClaim={handleCancelClaim}
        onProcessClaims={handleProcessClaims}
        canProcessClaims={canProcessClaims}
        processingClaims={processingClaims}
        processResult={processResult}
        activityItems={namedActivity}
        currentBalance={remainingFAAB}
        pendingBids={pendingBids}
        totalBudget={totalBudget}
        userTeamName={roster?.teamName}
        minimumBid={minimumBid}
        waiverSettings={_initialSettings?.waiverSettings}
        onLoadMorePlayers={hasMorePlayers ? handleLoadMorePlayers : undefined}
        loadingMorePlayers={loadingMorePlayers}
        hasMorePlayers={hasMorePlayers}
        preselectedClaimPlayerId={preselectedClaimPlayerId}
      />

      {/* Load older activity */}
      {activity.length > 0 && activityHasMore && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={handleLoadMoreActivity}
            disabled={loadingMoreActivity}
            className={cn(
              'rounded-md border border-[color:var(--league-border)] px-4 py-2 text-sm font-medium text-[color:var(--league-text)]',
              loadingMoreActivity
                ? 'cursor-not-allowed opacity-60'
                : 'hover:bg-[color:var(--league-surface-muted)]'
            )}
          >
            {loadingMoreActivity ? 'Loading…' : 'Load older activity'}
          </button>
        </div>
      )}
    </>
  );
}
