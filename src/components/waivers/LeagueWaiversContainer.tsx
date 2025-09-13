'use client';

import React, { useEffect, useMemo, useState } from 'react';

import { type DocumentSnapshot } from 'firebase/firestore';

import { useAuth } from '@/AuthContext';
import { LoadingSpinner } from '@/components/ui';
import WaiverFAABSystem from '@/components/waivers/WaiverFAABSystem';
import {
  leagueDataService,
  type LeagueWaiverClaim,
  type LeagueRoster,
  type LeagueActivityItem,
} from '@/services/leagueDataService';

interface Props {
  leagueId: string;
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
    waiverSettings?: { faabBudget?: number };
  };
  availablePlayers?: Array<{
    id: string;
    name: string;
    team?: string;
    position?: string;
    ownership?: number;
  }>;
  playersIndex?: Record<string, { id: string; name: string; team?: string; position?: string }>;
  membersIndex?: Record<string, { userId: string; teamId?: string; teamName?: string }>;
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

export default function LeagueWaiversContainer({
  leagueId,
  initialClaims,
  initialSettings: _initialSettings,
  availablePlayers: _availablePlayers,
  playersIndex,
  membersIndex,
  initialPlayersCursor,
}: Props) {
  const { user, loading } = useAuth();
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
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Activity paging state
  const ACTIVITY_PAGE_SIZE = 50;
  const [activityLastDoc, setActivityLastDoc] = useState<DocumentSnapshot | null>(null);
  const [activityHasMore, setActivityHasMore] = useState<boolean>(true);
  const [loadingMoreActivity, setLoadingMoreActivity] = useState<boolean>(false);
  const [hasLoadedMoreActivity, setHasLoadedMoreActivity] = useState<boolean>(false);

  useEffect(() => {
    if (!user?.uid) return;

    const subKey = leagueDataService.subscribeToLeagueWaivers(
      leagueId,
      (c) => setClaims(c),
      user.uid,
      (err) => console.error('Waivers sub error', err)
    );

    const rosterKey = leagueDataService.subscribeToUserRoster(
      leagueId,
      user.uid,
      (r) => setRoster(r),
      (err) => console.error('Roster sub error', err)
    );

    const activityKey = leagueDataService.subscribeToLeagueActivity(
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
      (err) => console.error('Activity sub error', err)
    );

    const faabKey = leagueDataService.subscribeToWaiverPriority(
      leagueId,
      user.uid,
      (remaining) => setRemainingFAAB(remaining),
      (err) => console.error('Waiver priority sub error', err)
    );

    return () => {
      leagueDataService.unsubscribe(subKey);
      leagueDataService.unsubscribe(rosterKey);
      leagueDataService.unsubscribe(activityKey);
      leagueDataService.unsubscribe(faabKey);
    };
  }, [leagueId, user?.uid, hasLoadedMoreActivity]);

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
        ? playersIdx?.[it.playerId]?.name || `Player ${it.playerId}`
        : undefined,
      dropPlayerName: it.dropPlayerId
        ? playersIdx?.[it.dropPlayerId]?.name || `Player ${it.dropPlayerId}`
        : undefined,
      teamName: it.userId ? membersIndex?.[it.userId]?.teamName : undefined,
    }));
  }, [activity, playersIdx, membersIndex]);

  const handleSubmitClaim = async (claim: Partial<UIWaiverClaim>) => {
    if (!user?.uid || !leagueId) return;

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
      const res = await fetch(`/api/leagues/${leagueId}/waivers/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          teamId: roster.id,
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
        console.error('[handleSubmitClaim] Failed:', j);
        return;
      }
    } catch (err) {
      setSubmitError('Failed to submit waiver claim');
      console.error('[handleSubmitClaim] Error:', err);
    }
  };

  const handleCancelClaim = async (id: string) => {
    if (!user?.uid || !leagueId) return;
    try {
      const res = await fetch(`/api/leagues/${leagueId}/waivers/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, claimId: id }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        console.error('Cancel claim failed', j);
      }
    } catch (err) {
      console.error('Failed to cancel waiver claim', err);
    }
  };

  const handleLoadMorePlayers = async () => {
    if (!hasMorePlayers || !playersCursor || loadingMorePlayers) return;
    try {
      setLoadingMorePlayers(true);
      const url = new URL(`/api/leagues/${leagueId}/players`, window.location.origin);
      url.searchParams.set('limit', '100');
      url.searchParams.set('cursor', playersCursor);
      url.searchParams.set('owned', 'false'); // only fetch unowned players
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 5000);
      const res = await fetch(url.toString(), { signal: ac.signal });
      clearTimeout(t);
      if (!res.ok) {
        console.error('Players page fetch failed', await res.text());
        setHasMorePlayers(false);
        return;
      }
      const data = (await res.json()) as {
        items: Array<{
          id: string;
          name: string;
          team?: string;
          position?: string;
          ownership?: number;
        }>;
        nextCursor?: string | null;
      };
      if (Array.isArray(data.items) && data.items.length) {
        // Filter out owned players defensively (should already be unowned via API)
        const incoming = data.items.filter((p) =>
          typeof p.ownership === 'number' ? p.ownership < 100 : true
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
      console.error('Load more players error', err);
      setHasMorePlayers(false);
    } finally {
      setLoadingMorePlayers(false);
    }
  };

  if (loading) return <LoadingSpinner />;
  if (!user) return null;

  return (
    <>
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
        onLoadMorePlayers={hasMorePlayers ? handleLoadMorePlayers : undefined}
        loadingMorePlayers={loadingMorePlayers}
        hasMorePlayers={hasMorePlayers}
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
