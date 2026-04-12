'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PlusIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { AnimatePresence, motion } from 'framer-motion';

import LeagueViewHeader from '@/components/league/LeagueViewHeader';
import { TeamLogo } from '@/components/TeamLogo';
import { formatInTimezone, getBrowserTimeZone } from '@/lib/timezone';
import { type LeagueActivityItem } from '@/services/leagueDataService';

interface WaiverClaim {
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

interface PlayerOption {
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
}

interface WaiverOrderEntry {
  userId: string;
  teamId?: string;
  teamName?: string;
  currentPriority?: number;
  remainingFAAB?: number;
  pendingBidTotal?: number;
  pendingClaims?: number;
}

type ActivityFeedItem = LeagueActivityItem & {
  playerName?: string;
  dropPlayerName?: string;
  teamName?: string;
};

interface WaiverFAABSystemProps {
  embedded?: boolean;
  currentBalance?: number;
  pendingBids?: number;
  totalBudget?: number;
  userTeamName?: string;
  minimumBid?: number;
  userClaims?: WaiverClaim[];
  leagueClaims?: WaiverClaim[];
  waiverOrder?: WaiverOrderEntry[];
  waiverSettings?: {
    system?: string;
    processTime?: string;
    waiverPeriod?: number;
  };
  availablePlayers?: PlayerOption[];
  rosterDropOptions?: PlayerOption[];
  onSubmitClaim?: (claim: Partial<WaiverClaim>) => void;
  onCancelClaim?: (id: string) => void;
  activityItems?: ActivityFeedItem[];
  onLoadMorePlayers?: () => void;
  loadingMorePlayers?: boolean;
  hasMorePlayers?: boolean;
  preselectedClaimPlayerId?: string;
}

const DEFAULT_MIN_BID = 1;

export default function WaiverFAABSystem({
  embedded = false,
  currentBalance,
  pendingBids,
  totalBudget,
  userTeamName,
  minimumBid,
  userClaims = [],
  leagueClaims = [],
  waiverOrder = [],
  waiverSettings,
  availablePlayers = [],
  rosterDropOptions = [],
  onSubmitClaim,
  onCancelClaim,
  activityItems = [],
  onLoadMorePlayers,
  loadingMorePlayers,
  hasMorePlayers,
  preselectedClaimPlayerId,
}: WaiverFAABSystemProps) {
  const [activeTab, setActiveTab] = useState<
    'my-claims' | 'waiver-order' | 'claim-centre' | 'league-activity'
  >(preselectedClaimPlayerId ? 'claim-centre' : 'my-claims');
  const [playerSearch, setPlayerSearch] = useState('');
  const [positionFilter, setPositionFilter] = useState<'ALL' | string>('ALL');
  const [newClaim, setNewClaim] = useState({
    playerId: '',
    playerName: '',
    playerPosition: '',
    playerTeam: '',
    dropPlayerId: '',
    dropPlayerName: '',
    bidAmount: minimumBid ?? DEFAULT_MIN_BID,
    priority: 1,
  });
  const timeZone = useMemo(() => getBrowserTimeZone(), []);
  const playersSentinelRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<HTMLButtonElement[]>([]);

  useEffect(() => {
    if (!onLoadMorePlayers || !hasMorePlayers) return;
    const node = playersSentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingMorePlayers) {
          onLoadMorePlayers();
        }
      },
      { rootMargin: '240px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [onLoadMorePlayers, hasMorePlayers, loadingMorePlayers]);

  const tabs = useMemo(
    () =>
      [
        { id: 'my-claims', label: 'My Claims' },
        { id: 'waiver-order', label: 'Waiver Order' },
        { id: 'claim-centre', label: 'Claim Centre' },
        { id: 'league-activity', label: 'League Activity' },
      ] as const,
    []
  );

  const onTabKeyDown = useCallback(
    (event: React.KeyboardEvent, index: number) => {
      const last = tabs.length - 1;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        const next = index === last ? 0 : index + 1;
        tabRefs.current[next]?.focus();
        setActiveTab(tabs[next].id);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        const previous = index === 0 ? last : index - 1;
        tabRefs.current[previous]?.focus();
        setActiveTab(tabs[previous].id);
      }
    },
    [tabs]
  );

  const effectiveMinimumBid = minimumBid ?? DEFAULT_MIN_BID;
  const selectedAddPlayer = useMemo(
    () => availablePlayers.find((player) => player.id === newClaim.playerId) ?? null,
    [availablePlayers, newClaim.playerId]
  );
  const selectedDropPlayer = useMemo(
    () => rosterDropOptions.find((player) => player.id === newClaim.dropPlayerId) ?? null,
    [rosterDropOptions, newClaim.dropPlayerId]
  );
  const positionOptions = useMemo(() => {
    const values = new Set<string>();
    availablePlayers.forEach((player) => {
      if (player.position) values.add(player.position);
    });
    return ['ALL', ...Array.from(values).sort()];
  }, [availablePlayers]);

  const filteredAvailablePlayers = useMemo(() => {
    const query = playerSearch.trim().toLowerCase();
    return availablePlayers.filter((player) => {
      if (positionFilter !== 'ALL' && player.position !== positionFilter) return false;
      if (!query) return true;
      const haystack = [player.name, player.team, player.position]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [availablePlayers, playerSearch, positionFilter]);

  const nextProcessing = useMemo(() => {
    const now = new Date();
    const next = new Date(now);
    next.setDate(now.getDate() + 1);
    next.setHours(3, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next;
  }, []);

  const timeUntilProcessing = useMemo(() => {
    const delta = nextProcessing.getTime() - Date.now();
    const hours = Math.max(0, Math.floor(delta / (1000 * 60 * 60)));
    const minutes = Math.max(0, Math.floor((delta % (1000 * 60 * 60)) / (1000 * 60)));
    return `${hours}h ${minutes}m`;
  }, [nextProcessing]);

  const pendingClaimCount = useMemo(
    () => userClaims.filter((claim) => claim.status === 'pending').length,
    [userClaims]
  );
  const projectedSpend = (pendingBids || 0) + (newClaim.bidAmount || 0);
  const bidWouldExceedBalance =
    typeof currentBalance === 'number' &&
    typeof pendingBids === 'number' &&
    projectedSpend > currentBalance;
  const projectedBalance =
    typeof currentBalance === 'number' ? Math.max(0, currentBalance - projectedSpend) : undefined;

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <ClockIcon className="h-5 w-5 text-amber-500" />;
      case 'successful':
        return <CheckCircleIcon className="h-5 w-5 text-emerald-500" />;
      case 'failed':
        return <XCircleIcon className="h-5 w-5 text-red-500" />;
      case 'outbid':
        return <ExclamationTriangleIcon className="h-5 w-5 text-orange-500" />;
      default:
        return <ClockIcon className="h-5 w-5 text-slate-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-amber-100 text-amber-800';
      case 'successful':
        return 'bg-emerald-100 text-emerald-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      case 'outbid':
        return 'bg-orange-100 text-orange-800';
      default:
        return 'bg-slate-100 text-slate-700';
    }
  };

  const selectAddPlayer = (playerId: string) => {
    const player = availablePlayers.find((entry) => entry.id === playerId);
    if (!player) return;
    setNewClaim((previous) => ({
      ...previous,
      playerId: player.id,
      playerName: player.name,
      playerPosition: player.position || '',
      playerTeam: player.team || '',
    }));
  };

  const selectDropPlayer = (playerId: string) => {
    if (!playerId) {
      setNewClaim((previous) => ({ ...previous, dropPlayerId: '', dropPlayerName: '' }));
      return;
    }
    const player = rosterDropOptions.find((entry) => entry.id === playerId);
    setNewClaim((previous) => ({
      ...previous,
      dropPlayerId: playerId,
      dropPlayerName: player?.name || '',
    }));
  };

  const handleSubmitClaim = () => {
    if (!selectedAddPlayer) return;
    if (!newClaim.bidAmount || newClaim.bidAmount < effectiveMinimumBid) return;
    onSubmitClaim?.({
      playerId: selectedAddPlayer.id,
      playerName: selectedAddPlayer.name,
      playerPosition: selectedAddPlayer.position,
      playerTeam: selectedAddPlayer.team,
      action: 'add',
      dropPlayerId: newClaim.dropPlayerId || undefined,
      dropPlayerName: selectedDropPlayer?.name,
      bidAmount: newClaim.bidAmount,
      priority: newClaim.priority,
      status: 'pending',
      submittedAt: new Date(),
    });
    setNewClaim({
      playerId: '',
      playerName: '',
      playerPosition: '',
      playerTeam: '',
      dropPlayerId: '',
      dropPlayerName: '',
      bidAmount: effectiveMinimumBid,
      priority: 1,
    });
    setActiveTab('my-claims');
  };

  useEffect(() => {
    if (!preselectedClaimPlayerId) return;
    const selected = availablePlayers.find((player) => player.id === preselectedClaimPlayerId);
    if (!selected) return;
    setActiveTab('claim-centre');
    selectAddPlayer(selected.id);
  }, [preselectedClaimPlayerId, availablePlayers]);

  const statChips = useMemo(() => {
    if (!selectedAddPlayer?.statsSummary) return [];
    return [
      { label: 'Disp', value: selectedAddPlayer.statsSummary.disposals },
      { label: 'Tack', value: selectedAddPlayer.statsSummary.tackles },
      { label: 'Marks', value: selectedAddPlayer.statsSummary.marks },
      { label: 'Goals', value: selectedAddPlayer.statsSummary.goals },
    ].filter((entry) => typeof entry.value === 'number');
  }, [selectedAddPlayer]);

  return (
    <div className={embedded ? 'space-y-6' : 'mx-auto max-w-[90rem] space-y-6 px-4 py-6 sm:px-6'}>
      {embedded ? (
        <LeagueViewHeader
          eyebrow="Waiver centre"
          title="Claims, order, and FAAB"
          description={`Review your queue, track the waiver order, and compare claim targets before processing runs.${userTeamName ? ` Managing ${userTeamName}.` : ''}`}
          chips={[
            { label: `FAAB $${currentBalance ?? totalBudget ?? 0}`, tone: 'accent' },
            {
              label: `${pendingClaimCount} open claims`,
              tone: pendingClaimCount > 0 ? 'warning' : 'neutral',
            },
            { label: `${availablePlayers.length} players loaded` },
            { label: timeUntilProcessing, tone: 'success' },
          ]}
          actions={
            <>
              <button
                type="button"
                onClick={() => setActiveTab('claim-centre')}
                className="rounded-full bg-[color:var(--league-primary)] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[color:var(--league-primary-hover)]"
              >
                Build claim
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('waiver-order')}
                className="rounded-full border border-[color:var(--league-border)] bg-white px-5 py-2.5 text-sm font-semibold text-[color:var(--league-text-muted)] transition hover:border-[color:var(--league-accent)] hover:bg-[color:var(--league-accent-soft)] hover:text-[color:var(--league-text)]"
              >
                Review order
              </button>
            </>
          }
          aside={
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">FAAB live</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">
                  ${currentBalance ?? totalBudget ?? 0}
                </div>
                <div className="mt-1 text-sm text-slate-500">${pendingBids || 0} pending</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Open claims</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">{pendingClaimCount}</div>
                <div className="mt-1 text-sm text-slate-500">
                  {leagueClaims.filter((claim) => claim.status === 'pending').length} league-wide
                  pending
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Market size</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">
                  {availablePlayers.length}
                </div>
                <div className="mt-1 text-sm text-slate-500">players currently loaded</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  Waiver cadence
                </div>
                <div className="mt-1 text-lg font-semibold text-slate-900">
                  {timeUntilProcessing}
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  {waiverSettings?.processTime || 'Next processing window'}
                </div>
              </div>
            </div>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 text-white shadow-[0_28px_80px_-42px_rgba(15,23,42,0.75)]">
          <div className="grid gap-6 px-6 py-7 lg:grid-cols-[1.4fr_0.9fr] lg:px-8">
            <div className="space-y-4">
              <div className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-100">
                League Waivers
              </div>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                  Run claims with league context on screen.
                </h1>
                <p className="mt-2 max-w-2xl text-sm text-slate-200 sm:text-base">
                  Review your queue, track the live waiver order, and compare claim targets before
                  you commit FAAB.
                  {userTeamName ? ` Managing ${userTeamName}.` : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setActiveTab('claim-centre')}
                  className="rounded-full bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300"
                >
                  Build claim
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('waiver-order')}
                  className="rounded-full border border-white/20 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  Review order
                </button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <MetricCard
                label="FAAB live"
                value={`$${currentBalance ?? totalBudget ?? 0}`}
                sublabel={`$${pendingBids || 0} pending`}
              />
              <MetricCard
                label="Open claims"
                value={`${pendingClaimCount}`}
                sublabel={`${leagueClaims.filter((claim) => claim.status === 'pending').length} league-wide pending`}
              />
              <MetricCard
                label="Market size"
                value={`${availablePlayers.length}`}
                sublabel="players currently loaded"
              />
              <MetricCard
                label="Waiver cadence"
                value={timeUntilProcessing}
                sublabel={waiverSettings?.processTime || 'Next processing window'}
              />
            </div>
          </div>
        </div>
      )}

      <div
        className={`rounded-3xl border border-[color:var(--league-border)] p-6 ${embedded ? 'bg-white shadow-sm' : 'bg-[linear-gradient(90deg,var(--league-accent-soft),var(--league-surface),var(--league-primary-soft))]'}`}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Current waiver settings</h2>
            <p className="text-sm text-slate-600">
              {waiverSettings?.system || 'League waivers'} • Minimum bid ${effectiveMinimumBid}
              {typeof waiverSettings?.waiverPeriod === 'number'
                ? ` • ${waiverSettings.waiverPeriod}h hold`
                : ''}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricInset label="Next run" value={timeUntilProcessing} />
            <MetricInset label="League order" value={`${waiverOrder.length}`} />
            <MetricInset label="Loaded pool" value={`${filteredAvailablePlayers.length}`} />
          </div>
        </div>
      </div>

      <div
        className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm"
        role="tablist"
        aria-label="Waiver sections"
      >
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            id={`waivers-tab-${tab.id}`}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`waivers-panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            ref={(element) => {
              if (element) tabRefs.current[index] = element;
            }}
            onKeyDown={(event) => onTabKeyDown(event, index)}
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-[color:var(--league-primary)] text-white shadow-sm'
                : 'text-[color:var(--league-text-muted)] hover:bg-[color:var(--league-surface-muted)] hover:text-[color:var(--league-text)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'my-claims' && (
          <motion.div
            key="my-claims"
            id="waivers-panel-my-claims"
            role="tabpanel"
            aria-labelledby="waivers-tab-my-claims"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
          >
            <div className="flex flex-col gap-4 border-b border-slate-200 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">My current waivers</h3>
                <p className="text-sm text-slate-600">
                  Track your pending bids and final outcomes before processing runs.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('claim-centre')}
                className="rounded-full bg-[color:var(--league-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[color:var(--league-primary-hover)]"
              >
                Create claim
              </button>
            </div>

            {userClaims.length === 0 ? (
              <div className="p-10 text-center text-slate-500">
                <ClockIcon className="mx-auto mb-4 h-12 w-12 text-slate-300" />
                <p>No current waiver claims.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {userClaims.map((claim) => (
                  <div
                    key={claim.id}
                    className="flex flex-col gap-4 p-6 xl:flex-row xl:items-center xl:justify-between"
                  >
                    <div className="flex items-start gap-4">
                      {getStatusIcon(claim.status)}
                      <div>
                        <div className="font-semibold text-slate-900">{claim.playerName}</div>
                        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                          {claim.playerTeam ? (
                            <TeamLogo team={claim.playerTeam} size={16} withCircle decorative />
                          ) : null}
                          <span>
                            {[claim.playerPosition, claim.playerTeam].filter(Boolean).join(' • ')}
                            {claim.dropPlayerName ? ` • Drop ${claim.dropPlayerName}` : ''}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          Submitted {formatInTimezone(claim.submittedAt, timeZone, 'PP p')}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="rounded-2xl bg-slate-50 px-4 py-3 text-right">
                        <div className="font-bold text-slate-900">${claim.bidAmount ?? 0}</div>
                        <div className="text-sm text-slate-500">Priority {claim.priority}</div>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-sm font-medium ${getStatusColor(claim.status)}`}
                      >
                        {claim.status.charAt(0).toUpperCase() + claim.status.slice(1)}
                      </span>
                      {claim.status === 'pending' && (
                        <button
                          type="button"
                          onClick={() => onCancelClaim?.(claim.id)}
                          className="text-sm font-medium text-red-600 hover:text-red-800"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {activeTab === 'waiver-order' && (
          <motion.div
            key="waiver-order"
            id="waivers-panel-waiver-order"
            role="tabpanel"
            aria-labelledby="waivers-tab-waiver-order"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]"
          >
            <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-6 py-5">
                <h3 className="text-lg font-semibold text-slate-900">Live league waiver order</h3>
                <p className="text-sm text-slate-600">
                  Priority position, pending claim pressure, and FAAB posture in one list.
                </p>
              </div>
              <div className="divide-y divide-slate-100">
                {waiverOrder.map((entry, index) => (
                  <div
                    key={entry.userId}
                    className="flex items-center justify-between gap-4 px-6 py-4"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700">
                        {entry.currentPriority ?? index + 1}
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900">
                          {entry.teamName || 'League team'}
                        </div>
                        <div className="text-sm text-slate-500">
                          {entry.pendingClaims || 0} pending
                          {typeof entry.pendingBidTotal === 'number'
                            ? ` • $${entry.pendingBidTotal} pending`
                            : ''}
                        </div>
                      </div>
                    </div>
                    {typeof entry.remainingFAAB === 'number' && (
                      <div className="text-right">
                        <div className="text-sm font-semibold text-slate-900">
                          ${entry.remainingFAAB}
                        </div>
                        <div className="text-xs text-slate-500">FAAB left</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-6 py-5">
                <h3 className="text-lg font-semibold text-slate-900">League queue</h3>
                <p className="text-sm text-slate-600">
                  Every active claim in the order it currently sits.
                </p>
              </div>
              {leagueClaims.length === 0 ? (
                <div className="p-8 text-sm text-slate-500">No live waiver activity.</div>
              ) : (
                <div className="max-h-[42rem] divide-y divide-slate-100 overflow-y-auto">
                  {leagueClaims.map((claim) => (
                    <div
                      key={claim.id}
                      className="flex items-center justify-between gap-4 px-6 py-4"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-slate-900">
                          {claim.playerName}
                        </div>
                        <div className="text-sm text-slate-600">
                          {claim.userName}
                          {claim.dropPlayerName ? ` • Drop ${claim.dropPlayerName}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right text-sm">
                          <div className="font-semibold text-slate-900">
                            ${claim.bidAmount ?? 0}
                          </div>
                          <div className="text-slate-500">Prio {claim.priority}</div>
                        </div>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${getStatusColor(claim.status)}`}
                        >
                          {claim.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </motion.div>
        )}

        {activeTab === 'claim-centre' && (
          <motion.div
            key="claim-centre"
            id="waivers-panel-claim-centre"
            role="tabpanel"
            aria-labelledby="waivers-tab-claim-centre"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
          >
            <div className="border-b border-slate-200 px-6 py-5">
              <h3 className="text-lg font-semibold text-slate-900">Claim centre</h3>
              <p className="text-sm text-slate-600">
                Review the player pool, inspect production signals, and submit without leaving the
                page.
              </p>
            </div>

            <div className="grid gap-6 p-6 xl:grid-cols-[1.25fr_0.75fr]">
              <div className="space-y-5">
                <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
                  <label className="relative block">
                    <span className="sr-only">Search available players</span>
                    <MagnifyingGlassIcon className="pointer-events-none absolute left-4 top-3.5 h-5 w-5 text-slate-400" />
                    <input
                      type="search"
                      value={playerSearch}
                      onChange={(event) => setPlayerSearch(event.target.value)}
                      placeholder="Search available players"
                      className="w-full rounded-2xl border border-slate-300 bg-white py-3 pl-11 pr-4 text-sm text-slate-900 outline-none transition focus:border-slate-500"
                    />
                  </label>
                  <select
                    value={positionFilter}
                    onChange={(event) => setPositionFilter(event.target.value)}
                    className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-500"
                  >
                    {positionOptions.map((option) => (
                      <option key={option} value={option}>
                        {option === 'ALL' ? 'All positions' : option}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <MetricInset label="Results" value={`${filteredAvailablePlayers.length}`} />
                  <MetricInset label="Selected" value={selectedAddPlayer?.name || 'None'} />
                  <MetricInset label="Roster exits" value={`${rosterDropOptions.length}`} />
                </div>

                <div className="rounded-3xl border border-slate-200 bg-slate-50/70">
                  <div className="border-b border-slate-200 px-5 py-4">
                    <h4 className="font-semibold text-slate-900">Available players</h4>
                    <p className="text-sm text-slate-600">
                      Every loaded claim target, with quick production context.
                    </p>
                  </div>

                  {filteredAvailablePlayers.length === 0 ? (
                    <div className="px-5 py-12 text-center text-sm text-slate-500">
                      No players matched this view.
                    </div>
                  ) : (
                    <div className="max-h-[44rem] space-y-3 overflow-y-auto px-4 py-4">
                      {filteredAvailablePlayers.map((player) => {
                        const isSelected = player.id === newClaim.playerId;
                        return (
                          <button
                            key={player.id}
                            type="button"
                            onClick={() => selectAddPlayer(player.id)}
                            className={`w-full rounded-2xl border p-4 text-left transition ${
                              isSelected
                                ? 'border-[color:var(--league-primary)] bg-[color:var(--league-primary)] text-white shadow-lg shadow-[color:var(--league-primary)]/10'
                                : 'border-slate-200 bg-white hover:border-slate-400 hover:bg-slate-50'
                            }`}
                          >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <div className="text-base font-semibold">{player.name}</div>
                                <div
                                  className={`flex flex-wrap items-center gap-2 text-sm ${isSelected ? 'text-slate-200' : 'text-slate-600'}`}
                                >
                                  {player.team ? (
                                    <TeamLogo team={player.team} size={16} withCircle decorative />
                                  ) : null}
                                  <span>
                                    {[player.position, player.team].filter(Boolean).join(' • ') ||
                                      'Profile pending'}
                                  </span>
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                                {typeof player.avg === 'number' && (
                                  <span
                                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                      isSelected
                                        ? 'bg-white/15 text-white'
                                        : 'bg-[color:var(--league-accent-soft)] text-[color:var(--league-accent)]'
                                    }`}
                                  >
                                    Avg {player.avg.toFixed(1)}
                                  </span>
                                )}
                                <span
                                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                    isSelected
                                      ? 'bg-white/15 text-white'
                                      : 'bg-slate-100 text-slate-700'
                                  }`}
                                >
                                  {typeof player.ownership === 'number'
                                    ? `${player.ownership}% rostered`
                                    : 'Available'}
                                </span>
                              </div>
                            </div>
                            {player.statsSummary && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {Object.entries(player.statsSummary).map(([key, value]) =>
                                  typeof value === 'number' ? (
                                    <span
                                      key={key}
                                      className={`rounded-full px-3 py-1 text-xs ${
                                        isSelected
                                          ? 'bg-white/10 text-slate-100'
                                          : 'bg-slate-100 text-slate-700'
                                      }`}
                                    >
                                      {labelForStat(key)} {value}
                                    </span>
                                  ) : null
                                )}
                              </div>
                            )}
                          </button>
                        );
                      })}
                      {hasMorePlayers && (
                        <div className="flex items-center justify-center gap-3 pt-2">
                          <button
                            type="button"
                            onClick={onLoadMorePlayers}
                            disabled={loadingMorePlayers}
                            className={`rounded-full border px-4 py-2 text-sm font-medium ${
                              loadingMorePlayers
                                ? 'cursor-not-allowed border-slate-200 text-slate-400'
                                : 'border-slate-300 text-slate-700 hover:bg-white'
                            }`}
                          >
                            {loadingMorePlayers ? 'Loading more…' : 'Load more players'}
                          </button>
                          <div ref={playersSentinelRef} className="h-1 w-1" aria-hidden="true" />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4 xl:sticky xl:top-6">
                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-base font-semibold text-slate-900">Player review</h4>
                      <p className="text-sm text-slate-600">
                        Stat snapshot for the current claim target.
                      </p>
                    </div>
                    <span className="rounded-full bg-[color:var(--league-accent-soft)] px-3 py-1 text-xs font-semibold text-[color:var(--league-accent)]">
                      Priority {newClaim.priority}
                    </span>
                  </div>

                  <div className="mt-5 rounded-2xl bg-[color:var(--league-primary)] p-4 text-white">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-300">
                      Target add
                    </div>
                    <div className="mt-2 text-xl font-semibold">
                      {selectedAddPlayer?.name || 'Select a player from the market'}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-300">
                      {selectedAddPlayer?.team ? (
                        <TeamLogo team={selectedAddPlayer.team} size={18} withCircle decorative />
                      ) : null}
                      <span>
                        {[selectedAddPlayer?.position, selectedAddPlayer?.team]
                          .filter(Boolean)
                          .join(' • ') || 'Choose a claimable player to review'}
                      </span>
                    </div>
                    {typeof selectedAddPlayer?.avg === 'number' && (
                      <div className="mt-4 inline-flex rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-white">
                        Avg {selectedAddPlayer.avg.toFixed(1)}
                      </div>
                    )}
                  </div>

                  {statChips.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {statChips.map((chip) => (
                        <span
                          key={chip.label}
                          className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700"
                        >
                          {chip.label} {chip.value}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="mt-5 space-y-4">
                    <div>
                      <label
                        htmlFor="dropPlayerSelect"
                        className="mb-2 block text-sm font-medium text-slate-700"
                      >
                        Player to drop
                      </label>
                      <select
                        id="dropPlayerSelect"
                        value={newClaim.dropPlayerId}
                        onChange={(event) => selectDropPlayer(event.target.value)}
                        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-500"
                      >
                        <option value="">None selected</option>
                        {rosterDropOptions.map((player) => (
                          <option key={player.id} value={player.id}>
                            {player.name} {player.team ? `• ${player.team}` : ''}{' '}
                            {player.position ? `(${player.position})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="bidAmount"
                        className="mb-2 block text-sm font-medium text-slate-700"
                      >
                        FAAB bid
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setNewClaim((previous) => ({
                              ...previous,
                              bidAmount: Math.max(effectiveMinimumBid, previous.bidAmount - 1),
                            }))
                          }
                          className="rounded-2xl border border-slate-300 p-3 hover:bg-slate-50"
                        >
                          <MinusIcon className="h-4 w-4" />
                        </button>
                        <input
                          id="bidAmount"
                          type="number"
                          value={newClaim.bidAmount}
                          onChange={(event) =>
                            setNewClaim((previous) => ({
                              ...previous,
                              bidAmount: parseInt(event.target.value, 10) || 0,
                            }))
                          }
                          min={effectiveMinimumBid}
                          className="flex-1 rounded-2xl border border-slate-300 px-4 py-3 text-center text-lg font-semibold text-slate-900 outline-none transition focus:border-slate-500"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setNewClaim((previous) => ({
                              ...previous,
                              bidAmount: previous.bidAmount + 1,
                            }))
                          }
                          className="rounded-2xl border border-slate-300 p-3 hover:bg-slate-50"
                        >
                          <PlusIcon className="h-4 w-4" />
                        </button>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        Minimum bid: ${effectiveMinimumBid}
                      </p>
                    </div>
                  </div>
                </section>

                <section className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                  <h4 className="text-base font-semibold text-slate-900">Claim summary</h4>
                  <div className="mt-4 space-y-3 text-sm">
                    <SummaryRow label="Add" value={newClaim.playerName || 'Unselected'} />
                    <SummaryRow label="Drop" value={selectedDropPlayer?.name || 'None'} />
                    <SummaryRow label="Bid" value={`$${newClaim.bidAmount}`} />
                    {typeof projectedBalance === 'number' && (
                      <SummaryRow
                        label="Projected FAAB"
                        value={`$${projectedBalance}`}
                        valueClassName={bidWouldExceedBalance ? 'text-red-600' : 'text-slate-900'}
                      />
                    )}
                  </div>

                  {bidWouldExceedBalance && (
                    <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      This bid exceeds your remaining FAAB once pending claims are included.
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleSubmitClaim}
                    disabled={
                      !newClaim.playerId ||
                      newClaim.bidAmount < effectiveMinimumBid ||
                      bidWouldExceedBalance
                    }
                    className="mt-5 w-full rounded-2xl bg-[color:var(--league-primary)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[color:var(--league-primary-hover)] disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    Submit claim
                  </button>
                </section>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'league-activity' && (
          <motion.div
            key="league-activity"
            id="waivers-panel-league-activity"
            role="tabpanel"
            aria-labelledby="waivers-tab-league-activity"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <h3 className="mb-2 text-lg font-semibold text-slate-900">League activity</h3>
            {activityItems.length === 0 ? (
              <p className="text-sm text-slate-600">No recent activity.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {activityItems.map((item) => (
                  <li key={item.id} className="flex items-start justify-between py-3">
                    <div className="flex items-start gap-3">
                      {getStatusIcon(
                        item.type.includes('successful')
                          ? 'successful'
                          : item.type.includes('failed')
                            ? 'failed'
                            : 'pending'
                      )}
                      <div>
                        <div className="text-sm text-slate-900">
                          <span className="font-medium">
                            {item.teamName || item.userId || 'Team'}
                          </span>{' '}
                          {describeActivity(item)}
                        </div>
                        <div className="text-xs text-slate-500">
                          {formatInTimezone(item.timestamp, timeZone, 'PP p')}
                          {typeof item.bidAmount === 'number' ? ` • $${item.bidAmount}` : ''}
                          {item.reason ? ` • ${item.reason}` : ''}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function describeActivity(item: ActivityFeedItem) {
  const playerText = item.playerName || item.playerId || 'a player';
  if (item.type === 'waiver-successful') {
    return (
      <>
        won a claim for <span className="font-medium">{playerText}</span>
      </>
    );
  }
  if (item.type === 'waiver-failed') {
    return (
      <>
        missed on <span className="font-medium">{playerText}</span>
      </>
    );
  }
  if (item.type === 'waiver-cancelled') {
    return (
      <>
        cancelled a claim for <span className="font-medium">{playerText}</span>
      </>
    );
  }
  return (
    <>
      submitted a claim for <span className="font-medium">{playerText}</span>
    </>
  );
}

function MetricCard({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string;
  sublabel: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
      <div className="text-xs uppercase tracking-[0.2em] text-slate-300">{label}</div>
      <div className="mt-2 text-3xl font-semibold">{value}</div>
      <div className="mt-1 text-sm text-slate-300">{sublabel}</div>
    </div>
  );
}

function MetricInset({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/80 px-4 py-3">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-1 truncate text-xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={`font-medium ${valueClassName || 'text-slate-900'}`}>{value}</span>
    </div>
  );
}

function labelForStat(stat: string) {
  switch (stat) {
    case 'disposals':
      return 'Disp';
    case 'tackles':
      return 'Tack';
    case 'marks':
      return 'Marks';
    case 'goals':
      return 'Goals';
    default:
      return stat;
  }
}
