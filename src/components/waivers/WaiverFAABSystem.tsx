'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CheckCircle2, CircleAlert, CircleX, Clock, Minus, Plus, Search } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

import LeagueViewHeader from '@/components/league/LeagueViewHeader';
import { TeamLogo } from '@/components/TeamLogo';
import { formatInTimezone, getBrowserTimeZone } from '@/lib/timezone';
import { cn } from '@/lib/utils';
import { type LeagueActivityItem } from '@/services/leagueDataService';
import { leagueStatusTonePatterns, leagueSurfacePatterns } from '@/styles/leagueDesignSystem';

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
  onProcessClaims?: () => void;
  canProcessClaims?: boolean;
  processingClaims?: boolean;
  processResult?: string | null;
  activityItems?: ActivityFeedItem[];
  onLoadMorePlayers?: () => void;
  loadingMorePlayers?: boolean;
  hasMorePlayers?: boolean;
  preselectedClaimPlayerId?: string;
}

const DEFAULT_MIN_BID = 1;
const textMuted = 'text-[color:var(--league-text-muted)]';
const textStrong = 'text-[color:var(--league-text)]';
const borderToken = 'border-[color:var(--league-border)]';
const surface = 'bg-[color:var(--league-surface)]';
const surfaceMuted = 'bg-[color:var(--league-surface-muted)]';
const pageSurface = 'bg-[color:var(--league-page)]';
const primarySurface = 'bg-[color:var(--league-primary)]';
const primaryText = 'text-[color:var(--league-primary)]';
const primaryForeground = 'text-[color:var(--league-primary-foreground)]';
const accentSurface = 'bg-[color:var(--league-accent-soft)]';
const accentText = 'text-[color:var(--league-accent)]';
const dangerTone = leagueStatusTonePatterns.danger;
const warningTone = leagueStatusTonePatterns.warning;
const successTone = leagueStatusTonePatterns.success;
const neutralTone = leagueStatusTonePatterns.neutral;
const subtleChip = cn(
  'rounded-full px-3 py-1 text-xs font-semibold',
  'bg-[color:var(--league-surface-muted)] text-[color:var(--league-text-muted)]'
);
const fieldClass = cn(
  'rounded-2xl border px-4 py-3 text-sm outline-none transition focus:border-[color:var(--league-accent)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
  borderToken,
  pageSurface,
  textStrong
);
const sectionClass = cn('overflow-hidden', leagueSurfacePatterns.panel);
const sectionHeaderClass = cn(
  'flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between',
  'border-b',
  borderToken
);

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
  onProcessClaims,
  canProcessClaims = false,
  processingClaims = false,
  processResult,
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
        return <Clock className="h-5 w-5 text-[color:var(--league-warning)]" aria-hidden />;
      case 'successful':
        return <CheckCircle2 className="h-5 w-5 text-[color:var(--league-success)]" aria-hidden />;
      case 'failed':
        return <CircleX className="h-5 w-5 text-[color:var(--league-danger)]" aria-hidden />;
      case 'outbid':
        return <CircleAlert className="h-5 w-5 text-[color:var(--league-warning)]" aria-hidden />;
      default:
        return <Clock className={cn('h-5 w-5', textMuted)} aria-hidden />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return warningTone;
      case 'successful':
        return successTone;
      case 'failed':
        return dangerTone;
      case 'outbid':
        return warningTone;
      default:
        return neutralTone;
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
                className={cn(
                  'rounded-full px-5 py-2.5 text-sm font-semibold transition hover:bg-[color:var(--league-primary-hover)]',
                  primarySurface,
                  primaryForeground
                )}
              >
                Build claim
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('waiver-order')}
                className={cn(
                  'rounded-full border px-5 py-2.5 text-sm font-semibold transition hover:border-[color:var(--league-accent)] hover:bg-[color:var(--league-accent-soft)] hover:text-[color:var(--league-text)]',
                  borderToken,
                  surface,
                  textMuted
                )}
              >
                Review order
              </button>
              {canProcessClaims ? (
                <button
                  type="button"
                  onClick={onProcessClaims}
                  disabled={processingClaims || pendingClaimCount === 0}
                  className={cn(
                    'rounded-full border px-5 py-2.5 text-sm font-semibold transition hover:bg-[color:var(--league-primary)] hover:text-[color:var(--league-primary-foreground)] disabled:cursor-not-allowed disabled:bg-[color:var(--league-surface-muted)] disabled:text-[color:var(--league-text-muted)]',
                    'border-[color:var(--league-primary)] bg-[color:var(--league-primary-soft)]',
                    primaryText,
                    'disabled:border-[color:var(--league-border)]'
                  )}
                >
                  {processingClaims ? 'Processing claims...' : 'Process claims'}
                </button>
              ) : null}
            </>
          }
          aside={
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className={cn('rounded-2xl border px-4 py-3', borderToken, surface)}>
                <div className={cn('text-xs uppercase tracking-[0.2em]', textMuted)}>FAAB live</div>
                <div className={cn('mt-1 text-lg font-semibold', textStrong)}>
                  ${currentBalance ?? totalBudget ?? 0}
                </div>
                <div className={cn('mt-1 text-sm', textMuted)}>${pendingBids || 0} pending</div>
              </div>
              <div className={cn('rounded-2xl border px-4 py-3', borderToken, surface)}>
                <div className={cn('text-xs uppercase tracking-[0.2em]', textMuted)}>
                  Open claims
                </div>
                <div className={cn('mt-1 text-lg font-semibold', textStrong)}>
                  {pendingClaimCount}
                </div>
                <div className={cn('mt-1 text-sm', textMuted)}>
                  {leagueClaims.filter((claim) => claim.status === 'pending').length} league-wide
                  pending
                </div>
              </div>
              <div className={cn('rounded-2xl border px-4 py-3', borderToken, surface)}>
                <div className={cn('text-xs uppercase tracking-[0.2em]', textMuted)}>
                  Market size
                </div>
                <div className={cn('mt-1 text-lg font-semibold', textStrong)}>
                  {availablePlayers.length}
                </div>
                <div className={cn('mt-1 text-sm', textMuted)}>players currently loaded</div>
              </div>
              <div className={cn('rounded-2xl border px-4 py-3', borderToken, surface)}>
                <div className={cn('text-xs uppercase tracking-[0.2em]', textMuted)}>
                  Waiver cadence
                </div>
                <div className={cn('mt-1 text-lg font-semibold', textStrong)}>
                  {timeUntilProcessing}
                </div>
                <div className={cn('mt-1 text-sm', textMuted)}>
                  {waiverSettings?.processTime || 'Next processing window'}
                </div>
              </div>
            </div>
          }
        />
      ) : (
        <div
          className={cn(
            'overflow-hidden rounded-[28px] border bg-[linear-gradient(135deg,var(--league-primary),var(--league-text),var(--league-success))] shadow-2xl',
            borderToken,
            primaryForeground
          )}
        >
          <div className="grid gap-6 px-6 py-7 lg:grid-cols-[1.4fr_0.9fr] lg:px-8">
            <div className="space-y-4">
              <div
                className={cn(
                  'inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em]',
                  'border-[color:var(--league-primary-soft)] bg-[color:var(--league-primary-soft)]',
                  primaryText
                )}
              >
                League Waivers
              </div>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                  Run claims with league context on screen.
                </h1>
                <p
                  className={cn(
                    'mt-2 max-w-2xl text-sm opacity-75 sm:text-base',
                    primaryForeground
                  )}
                >
                  Review your queue, track the live waiver order, and compare claim targets before
                  you commit FAAB.
                  {userTeamName ? ` Managing ${userTeamName}.` : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setActiveTab('claim-centre')}
                  className="rounded-full bg-[color:var(--league-accent-soft)] px-5 py-2.5 text-sm font-semibold text-[color:var(--league-accent)] transition hover:bg-[color:var(--league-surface)]"
                >
                  Build claim
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('waiver-order')}
                  className={cn(
                    'rounded-full border px-5 py-2.5 text-sm font-semibold transition hover:bg-[color:var(--league-primary-soft)] hover:text-[color:var(--league-primary)]',
                    'border-[color:var(--league-primary-soft)]',
                    primaryForeground
                  )}
                >
                  Review order
                </button>
                {canProcessClaims ? (
                  <button
                    type="button"
                    onClick={onProcessClaims}
                    disabled={processingClaims || pendingClaimCount === 0}
                    className={cn(
                      'rounded-full border px-5 py-2.5 text-sm font-semibold transition hover:bg-[color:var(--league-primary-soft)] hover:text-[color:var(--league-primary)] disabled:cursor-not-allowed disabled:opacity-50',
                      'border-[color:var(--league-primary-soft)] bg-[color:var(--league-primary-soft)]',
                      primaryText
                    )}
                  >
                    {processingClaims ? 'Processing claims...' : 'Process claims'}
                  </button>
                ) : null}
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
        className={cn(
          'rounded-3xl border p-6',
          borderToken,
          embedded
            ? cn(surface, 'shadow-sm')
            : 'bg-[linear-gradient(90deg,var(--league-accent-soft),var(--league-surface),var(--league-primary-soft))]'
        )}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className={cn('text-lg font-semibold', textStrong)}>Current waiver settings</h2>
            <p className={cn('text-sm', textMuted)}>
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
        {processResult ? (
          <div
            className="mt-4 rounded-2xl border border-[color:var(--league-success-soft)] bg-[color:var(--league-success-soft)] px-4 py-3 text-sm font-semibold text-[color:var(--league-success)]"
            role="status"
          >
            {processResult}
          </div>
        ) : null}
      </div>

      <div
        className={cn(
          'flex flex-wrap gap-2 rounded-2xl border p-2 shadow-sm',
          borderToken,
          surface
        )}
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
                ? 'bg-[color:var(--league-primary)] text-[color:var(--league-primary-foreground)] shadow-sm'
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
            className={sectionClass}
          >
            <div className={sectionHeaderClass}>
              <div>
                <h3 className={cn('text-lg font-semibold', textStrong)}>My current waivers</h3>
                <p className={cn('text-sm', textMuted)}>
                  Track your pending bids and final outcomes before processing runs.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('claim-centre')}
                className={cn(
                  'rounded-full px-4 py-2 text-sm font-semibold transition hover:bg-[color:var(--league-primary-hover)]',
                  primarySurface,
                  primaryForeground
                )}
              >
                Create claim
              </button>
            </div>

            {userClaims.length === 0 ? (
              <div className={cn('p-10 text-center', textMuted)}>
                <Clock className={cn('mx-auto mb-4 h-12 w-12', textMuted)} aria-hidden />
                <p>No current waiver claims.</p>
              </div>
            ) : (
              <div className="divide-y divide-[color:var(--league-border)]">
                {userClaims.map((claim) => (
                  <div
                    key={claim.id}
                    className="flex flex-col gap-4 p-6 xl:flex-row xl:items-center xl:justify-between"
                  >
                    <div className="flex items-start gap-4">
                      {getStatusIcon(claim.status)}
                      <div>
                        <div className={cn('font-semibold', textStrong)}>{claim.playerName}</div>
                        <div className={cn('flex flex-wrap items-center gap-2 text-sm', textMuted)}>
                          {claim.playerTeam ? (
                            <TeamLogo team={claim.playerTeam} size={16} withCircle decorative />
                          ) : null}
                          <span>
                            {[claim.playerPosition, claim.playerTeam].filter(Boolean).join(' • ')}
                            {claim.dropPlayerName ? ` • Drop ${claim.dropPlayerName}` : ''}
                          </span>
                        </div>
                        <div className={cn('mt-1 text-xs', textMuted)}>
                          Submitted {formatInTimezone(claim.submittedAt, timeZone, 'PP p')}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className={cn('rounded-2xl px-4 py-3 text-right', surfaceMuted)}>
                        <div className={cn('font-bold', textStrong)}>${claim.bidAmount ?? 0}</div>
                        <div className={cn('text-sm', textMuted)}>Priority {claim.priority}</div>
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
                          className="text-sm font-medium text-[color:var(--league-danger)] hover:text-[color:var(--league-text)]"
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
            <section className={sectionClass}>
              <div className={cn('border-b px-6 py-5', borderToken)}>
                <h3 className={cn('text-lg font-semibold', textStrong)}>
                  Live league waiver order
                </h3>
                <p className={cn('text-sm', textMuted)}>
                  Priority position, pending claim pressure, and FAAB posture in one list.
                </p>
              </div>
              <div className="divide-y divide-[color:var(--league-border)]">
                {waiverOrder.map((entry, index) => (
                  <div
                    key={entry.userId}
                    className="flex items-center justify-between gap-4 px-6 py-4"
                  >
                    <div className="flex items-center gap-4">
                      <div
                        className={cn(
                          'flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold',
                          neutralTone
                        )}
                      >
                        {entry.currentPriority ?? index + 1}
                      </div>
                      <div>
                        <div className={cn('font-semibold', textStrong)}>
                          {entry.teamName || 'League team'}
                        </div>
                        <div className={cn('text-sm', textMuted)}>
                          {entry.pendingClaims || 0} pending
                          {typeof entry.pendingBidTotal === 'number'
                            ? ` • $${entry.pendingBidTotal} pending`
                            : ''}
                        </div>
                      </div>
                    </div>
                    {typeof entry.remainingFAAB === 'number' && (
                      <div className="text-right">
                        <div className={cn('text-sm font-semibold', textStrong)}>
                          ${entry.remainingFAAB}
                        </div>
                        <div className={cn('text-xs', textMuted)}>FAAB left</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className={sectionClass}>
              <div className={cn('border-b px-6 py-5', borderToken)}>
                <h3 className={cn('text-lg font-semibold', textStrong)}>League queue</h3>
                <p className={cn('text-sm', textMuted)}>
                  Every active claim in the order it currently sits.
                </p>
              </div>
              {leagueClaims.length === 0 ? (
                <div className={cn('p-8 text-sm', textMuted)}>No live waiver activity.</div>
              ) : (
                <div className="max-h-[42rem] divide-y divide-[color:var(--league-border)] overflow-y-auto">
                  {leagueClaims.map((claim) => (
                    <div
                      key={claim.id}
                      className="flex items-center justify-between gap-4 px-6 py-4"
                    >
                      <div className="min-w-0">
                        <div className={cn('truncate font-semibold', textStrong)}>
                          {claim.playerName}
                        </div>
                        <div className={cn('text-sm', textMuted)}>
                          {claim.userName}
                          {claim.dropPlayerName ? ` • Drop ${claim.dropPlayerName}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right text-sm">
                          <div className={cn('font-semibold', textStrong)}>
                            ${claim.bidAmount ?? 0}
                          </div>
                          <div className={textMuted}>Prio {claim.priority}</div>
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
            className={sectionClass}
          >
            <div className={cn('border-b px-6 py-5', borderToken)}>
              <h3 className={cn('text-lg font-semibold', textStrong)}>Claim centre</h3>
              <p className={cn('text-sm', textMuted)}>
                Review the player pool, inspect production signals, and submit without leaving the
                page.
              </p>
            </div>

            <div className="grid gap-6 p-6 xl:grid-cols-[1.25fr_0.75fr]">
              <div className="space-y-5">
                <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
                  <label className="relative block">
                    <span className="sr-only">Search available players</span>
                    <Search
                      className={cn(
                        'pointer-events-none absolute left-4 top-3.5 h-5 w-5',
                        textMuted
                      )}
                      aria-hidden
                    />
                    <input
                      type="search"
                      value={playerSearch}
                      onChange={(event) => setPlayerSearch(event.target.value)}
                      placeholder="Search available players"
                      className={cn('w-full pl-11 pr-4', fieldClass)}
                    />
                  </label>
                  <select
                    aria-label="Filter available players by position"
                    value={positionFilter}
                    onChange={(event) => setPositionFilter(event.target.value)}
                    className={fieldClass}
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

                <div className={cn('rounded-3xl border', borderToken, surfaceMuted)}>
                  <div className={cn('border-b px-5 py-4', borderToken)}>
                    <h4 className={cn('font-semibold', textStrong)}>Available players</h4>
                    <p className={cn('text-sm', textMuted)}>
                      Every loaded claim target, with quick production context.
                    </p>
                  </div>

                  {filteredAvailablePlayers.length === 0 ? (
                    <div className={cn('px-5 py-12 text-center text-sm', textMuted)}>
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
                            aria-pressed={isSelected}
                            onClick={() => selectAddPlayer(player.id)}
                            className={cn(
                              'w-full rounded-2xl border p-4 text-left transition',
                              isSelected
                                ? cn(
                                    'border-[color:var(--league-primary)] shadow-lg shadow-[color:var(--league-primary)]/10',
                                    primarySurface,
                                    primaryForeground
                                  )
                                : cn(
                                    borderToken,
                                    surface,
                                    'hover:border-[color:var(--league-accent)] hover:bg-[color:var(--league-accent-soft)]'
                                  )
                            )}
                          >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <div className="text-base font-semibold">{player.name}</div>
                                <div
                                  className={cn(
                                    'flex flex-wrap items-center gap-2 text-sm',
                                    isSelected ? cn(primaryForeground, 'opacity-75') : textMuted
                                  )}
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
                                    className={cn(
                                      'rounded-full px-3 py-1 text-xs font-semibold',
                                      isSelected
                                        ? cn(accentSurface, accentText)
                                        : cn(accentSurface, accentText)
                                    )}
                                  >
                                    Avg {player.avg.toFixed(1)}
                                  </span>
                                )}
                                <span
                                  className={cn(
                                    'rounded-full px-3 py-1 text-xs font-semibold',
                                    isSelected
                                      ? cn(accentSurface, accentText)
                                      : cn(surfaceMuted, textMuted)
                                  )}
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
                                      className={cn(
                                        'rounded-full px-3 py-1 text-xs',
                                        isSelected
                                          ? cn(accentSurface, accentText)
                                          : cn(surfaceMuted, textMuted)
                                      )}
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
                            className={cn(
                              'rounded-full border px-4 py-2 text-sm font-medium',
                              loadingMorePlayers
                                ? cn('cursor-not-allowed', borderToken, textMuted)
                                : cn(
                                    borderToken,
                                    textStrong,
                                    'hover:bg-[color:var(--league-accent-soft)]'
                                  )
                            )}
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
                <section className={cn('rounded-3xl border p-5 shadow-sm', borderToken, surface)}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className={cn('text-base font-semibold', textStrong)}>Player review</h4>
                      <p className={cn('text-sm', textMuted)}>
                        Stat snapshot for the current claim target.
                      </p>
                    </div>
                    <span
                      className={cn(
                        'rounded-full px-3 py-1 text-xs font-semibold',
                        accentSurface,
                        accentText
                      )}
                    >
                      Priority {newClaim.priority}
                    </span>
                  </div>

                  <div className={cn('mt-5 rounded-2xl p-4', primarySurface, primaryForeground)}>
                    <div
                      className={cn(
                        'text-xs uppercase tracking-[0.18em] opacity-[0.65]',
                        primaryForeground
                      )}
                    >
                      Target add
                    </div>
                    <div className="mt-2 text-xl font-semibold">
                      {selectedAddPlayer?.name || 'Select a player from the market'}
                    </div>
                    <div
                      className={cn(
                        'mt-1 flex flex-wrap items-center gap-2 text-sm opacity-70',
                        primaryForeground
                      )}
                    >
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
                      <div
                        className={cn(
                          'mt-4 inline-flex rounded-full px-3 py-1 text-sm font-semibold',
                          accentSurface,
                          accentText
                        )}
                      >
                        Avg {selectedAddPlayer.avg.toFixed(1)}
                      </div>
                    )}
                  </div>

                  {statChips.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {statChips.map((chip) => (
                        <span key={chip.label} className={subtleChip}>
                          {chip.label} {chip.value}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="mt-5 space-y-4">
                    <div>
                      <label
                        htmlFor="dropPlayerSelect"
                        className={cn('mb-2 block text-sm font-medium', textStrong)}
                      >
                        Player to drop
                      </label>
                      <select
                        id="dropPlayerSelect"
                        value={newClaim.dropPlayerId}
                        onChange={(event) => selectDropPlayer(event.target.value)}
                        className={cn('w-full', fieldClass)}
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
                        className={cn('mb-2 block text-sm font-medium', textStrong)}
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
                          className={cn(
                            'rounded-2xl border p-3 hover:bg-[color:var(--league-accent-soft)]',
                            borderToken
                          )}
                          aria-label="Decrease FAAB bid"
                        >
                          <Minus className="h-4 w-4" aria-hidden />
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
                          className={cn('flex-1 text-center text-lg font-semibold', fieldClass)}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setNewClaim((previous) => ({
                              ...previous,
                              bidAmount: previous.bidAmount + 1,
                            }))
                          }
                          className={cn(
                            'rounded-2xl border p-3 hover:bg-[color:var(--league-accent-soft)]',
                            borderToken
                          )}
                          aria-label="Increase FAAB bid"
                        >
                          <Plus className="h-4 w-4" aria-hidden />
                        </button>
                      </div>
                      <p className={cn('mt-2 text-xs', textMuted)}>
                        Minimum bid: ${effectiveMinimumBid}
                      </p>
                    </div>
                  </div>
                </section>

                <section className={cn('rounded-3xl border p-5', borderToken, surfaceMuted)}>
                  <h4 className={cn('text-base font-semibold', textStrong)}>Claim summary</h4>
                  <div className="mt-4 space-y-3 text-sm">
                    <SummaryRow label="Add" value={newClaim.playerName || 'Unselected'} />
                    <SummaryRow label="Drop" value={selectedDropPlayer?.name || 'None'} />
                    <SummaryRow label="Bid" value={`$${newClaim.bidAmount}`} />
                    {typeof projectedBalance === 'number' && (
                      <SummaryRow
                        label="Projected FAAB"
                        value={`$${projectedBalance}`}
                        valueClassName={
                          bidWouldExceedBalance ? 'text-[color:var(--league-danger)]' : textStrong
                        }
                      />
                    )}
                  </div>

                  {bidWouldExceedBalance && (
                    <div className={cn('mt-4 rounded-2xl px-4 py-3 text-sm', dangerTone)}>
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
                    className={cn(
                      'mt-5 w-full rounded-2xl px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed',
                      primarySurface,
                      primaryForeground,
                      'hover:bg-[color:var(--league-primary-hover)] disabled:bg-[color:var(--league-surface-muted)] disabled:text-[color:var(--league-text-muted)]'
                    )}
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
            className={cn('rounded-3xl border p-6 shadow-sm', borderToken, surface)}
          >
            <h3 className={cn('mb-2 text-lg font-semibold', textStrong)}>League activity</h3>
            {activityItems.length === 0 ? (
              <p className={cn('text-sm', textMuted)}>No recent activity.</p>
            ) : (
              <ul className="divide-y divide-[color:var(--league-border)]">
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
                        <div className={cn('text-sm', textStrong)}>
                          <span className="font-medium">
                            {item.teamName || item.userId || 'Team'}
                          </span>{' '}
                          {describeActivity(item)}
                        </div>
                        <div className={cn('text-xs', textMuted)}>
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
    <div
      className={cn(
        'rounded-2xl border p-4 backdrop-blur',
        'border-[color:var(--league-primary-soft)] bg-[color:var(--league-primary-soft)]',
        primaryText
      )}
    >
      <div className={cn('text-xs uppercase tracking-[0.2em] opacity-70', primaryText)}>
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold">{value}</div>
      <div className={cn('mt-1 text-sm opacity-70', primaryText)}>{sublabel}</div>
    </div>
  );
}

function MetricInset({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn('rounded-2xl px-4 py-3', surface)}>
      <div className={cn('text-xs uppercase tracking-[0.18em]', textMuted)}>{label}</div>
      <div className={cn('mt-1 truncate text-xl font-semibold', textStrong)}>{value}</div>
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
      <span className={textMuted}>{label}</span>
      <span className={cn('font-medium', valueClassName || textStrong)}>{value}</span>
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
