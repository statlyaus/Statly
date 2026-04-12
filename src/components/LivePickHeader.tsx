'use client';

/**
 * LivePickHeader Component - Optimized for Performance, Accessibility & UX
 *
 * This component displays real-time draft status information including:
 * - Current pick timer with visual progress bar
 * - Draft progress and team order visualization
 * - Turn notifications and status updates
 * - Responsive design optimized for mobile and desktop
 *
 * Key Features:
 * - ⚡ Performance: Memoized calculations, optimized re-renders
 * - ♿ Accessibility: ARIA labels, roles, live regions, keyboard navigation
 * - 📱 Responsive: Mobile-first design with adaptive layouts
 * - 🔊 Audio Integration: Callback support for sound alerts
 * - ⏱️ Real-time Updates: Live timer with visual feedback
 * - 🎨 Visual Feedback: Status indicators, animations, color coding
 * - 🛡️ Type Safety: Handles various status types with validation
 *
 * Props:
 * @param draftData - Complete draft state and participant information
 * @param timePerPick - Seconds allowed per pick (default: 120)
 * @param isYourTurn - Whether current user is actively picking
 * @param yourSlot - Current user's draft slot position
 * @param onTimeExpired - Callback when pick timer expires
 * @param onAudioAlert - Callback for audio notifications
 * @param className - Additional CSS classes for styling
 *
 * Status Handling:
 * - LIVE: Active draft with timer and real-time updates
 * - COMPLETED: Shows completion message with celebration
 * - PAUSED: Shows paused state with appropriate messaging
 * - WAITING: Shows waiting state for draft start
 * - Invalid/Unknown: Defaults to WAITING state for safety
 */

import type { ReactNode } from 'react';
import { useState, useEffect, useMemo, useRef } from 'react';

import { ClockIcon } from '@heroicons/react/24/outline';

interface DraftParticipant {
  slot: number;
  member: {
    id: string;
    userId: string;
    displayName: string;
    email: string;
  };
}

interface LivePickHeaderProps {
  draftData: {
    id: string;
    currentPick: number;
    totalPicks: number;
    round: number;
    direction: string;
    status: string; // Accept any string, validate internally
    pickDeadlineAt?: string | null;
    participants: DraftParticipant[];
    picks: Array<{
      id: string;
      overall: number;
      round: number;
      slot: number;
      player: {
        id: string;
        name: string;
        position: string;
        club: string;
      };
      member: {
        id: string;
        displayName: string;
      };
      auto: boolean;
      madeAt: string;
    }>;
  };
  timePerPick?: number; // seconds
  liveTimeRemaining?: number;
  onClockMemberId?: string;
  isYourTurn: boolean;
  yourSlot?: number;
  onTimeExpired?: () => void;
  onAudioAlert?: (type: 'warning' | 'your-turn' | 'next-up') => void;
  className?: string;
  ownerControls?: ReactNode;
}

export default function LivePickHeader({
  draftData,
  timePerPick = 120,
  liveTimeRemaining,
  onClockMemberId,
  isYourTurn,
  yourSlot,
  onTimeExpired,
  onAudioAlert,
  className = '',
  ownerControls,
}: LivePickHeaderProps) {
  const [timeLeft, setTimeLeft] = useState(timePerPick);
  const [isFlashing, setIsFlashing] = useState(false);
  const [hasAlerted, setHasAlerted] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const onTimeExpiredRef = useRef(onTimeExpired);
  const onAudioAlertRef = useRef(onAudioAlert);
  const hasExpiredRef = useRef(false);

  useEffect(() => {
    onTimeExpiredRef.current = onTimeExpired;
  }, [onTimeExpired]);

  useEffect(() => {
    onAudioAlertRef.current = onAudioAlert;
  }, [onAudioAlert]);

  // Helper function to check if status is a valid draft status
  const isValidDraftStatus = (
    status: string
  ): status is 'LIVE' | 'COMPLETED' | 'PAUSED' | 'WAITING' => {
    return ['LIVE', 'COMPLETED', 'PAUSED', 'WAITING'].includes(status);
  };

  // Get normalized status with fallback
  const normalizedStatus = isValidDraftStatus(draftData?.status) ? draftData.status : 'WAITING';
  const deadlineMs = useMemo(() => {
    if (!draftData?.pickDeadlineAt) return null;
    const parsed = new Date(draftData.pickDeadlineAt).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }, [draftData?.pickDeadlineAt]);
  const normalizedLiveTimeRemaining =
    typeof liveTimeRemaining === 'number' && Number.isFinite(liveTimeRemaining)
      ? Math.max(0, liveTimeRemaining)
      : null;

  // Memoized calculations - moved before any early returns
  const { currentTeam, nextTeam, yourPickInfo, draftOrder } = useMemo(() => {
    // Return default values if no valid data
    if (!draftData?.participants?.length) {
      return {
        currentTeam: null,
        nextTeam: null,
        yourPickInfo: null,
        draftOrder: [],
      };
    }

    const teamCount = draftData.participants.length;
    const round = Math.ceil(draftData.currentPick / teamCount);
    const direction = round % 2 === 1 ? 'FORWARD' : 'REVERSE';

    // Calculate current slot
    let currentSlot: number;
    if (direction === 'FORWARD') {
      currentSlot = ((draftData.currentPick - 1) % teamCount) + 1;
    } else {
      currentSlot = teamCount - ((draftData.currentPick - 1) % teamCount);
    }

    // Calculate next slot
    let nextSlot: number;
    if (draftData.currentPick >= draftData.totalPicks) {
      nextSlot = 0; // Draft complete
    } else {
      const nextRound = Math.ceil((draftData.currentPick + 1) / teamCount);
      const nextDirection = nextRound % 2 === 1 ? 'FORWARD' : 'REVERSE';

      if (nextDirection === 'FORWARD') {
        nextSlot = (draftData.currentPick % teamCount) + 1;
      } else {
        nextSlot = teamCount - (draftData.currentPick % teamCount);
      }
    }

    const currentTeam =
      (onClockMemberId
        ? draftData.participants.find((p) => p.member.id === onClockMemberId)
        : null) ?? draftData.participants.find((p) => p.slot === currentSlot);
    const nextTeam = draftData.participants.find((p) => p.slot === nextSlot);

    // Calculate when it's your turn next
    let picksUntilYourTurn = 0;
    let estimatedTimeUntilYourTurn = 0;

    if (!isYourTurn && normalizedStatus === 'LIVE') {
      // Simulate the snake draft to find next occurrence of your slot
      let tempPick = draftData.currentPick + 1;
      while (tempPick <= draftData.totalPicks && picksUntilYourTurn === 0) {
        const tempRound = Math.ceil(tempPick / teamCount);
        const tempDirection = tempRound % 2 === 1 ? 'FORWARD' : 'REVERSE';

        let tempSlot: number;
        if (tempDirection === 'FORWARD') {
          tempSlot = ((tempPick - 1) % teamCount) + 1;
        } else {
          tempSlot = teamCount - ((tempPick - 1) % teamCount);
        }

        if (tempSlot === yourSlot) {
          picksUntilYourTurn = tempPick - draftData.currentPick;
          estimatedTimeUntilYourTurn = picksUntilYourTurn * timePerPick;
          break;
        }
        tempPick++;
      }
    }

    // Generate draft order visualization
    const orderSlots = [];
    for (let i = 1; i <= Math.min(teamCount, 8); i++) {
      // Show max 8 teams
      const participant = draftData.participants.find((p) => p.slot === i);
      orderSlots.push({
        slot: i,
        name: participant?.member.displayName || `Team ${i}`,
        isCurrent: i === currentSlot,
        isNext: i === nextSlot,
        isYou: i === yourSlot,
      });
    }

    return {
      currentTeam,
      nextTeam,
      yourPickInfo: {
        picksUntilYourTurn,
        estimatedTimeUntilYourTurn,
        nextPickNumber: draftData.currentPick + picksUntilYourTurn,
      },
      draftOrder: orderSlots,
    };
  }, [draftData, yourSlot, isYourTurn, timePerPick, normalizedStatus, onClockMemberId]);
  const picksUntilYourTurn = yourPickInfo?.picksUntilYourTurn ?? 0;
  const estimatedTimeUntilYourTurn = yourPickInfo?.estimatedTimeUntilYourTurn ?? 0;
  const hasLiveClock =
    normalizedStatus === 'LIVE' && (deadlineMs !== null || normalizedLiveTimeRemaining !== null);
  const timerAuthorityLabel = hasLiveClock ? 'Pick clock live' : 'Pick clock syncing';
  const autoPickSupportLabel = isYourTurn
    ? 'If your time expires, your highest-ranked valid queued player will be auto-picked.'
    : 'Queue players now to control any timeout auto-pick.';

  const getRemainingSeconds = useMemo(
    () => () => {
      if (normalizedStatus !== 'LIVE') return timePerPick;
      if (deadlineMs) return Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));
      if (normalizedLiveTimeRemaining !== null) return normalizedLiveTimeRemaining;
      return 0;
    },
    [deadlineMs, normalizedLiveTimeRemaining, normalizedStatus, timePerPick]
  );

  // Timer effect with proper cleanup and callbacks
  useEffect(() => {
    if (normalizedStatus !== 'LIVE') {
      setTimeLeft(timePerPick);
      hasExpiredRef.current = false;
      return;
    }

    if (!deadlineMs) {
      setTimeLeft(0);
      hasExpiredRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      return;
    }

    const nextRemaining = getRemainingSeconds();
    setTimeLeft(nextRemaining);
    hasExpiredRef.current = false;

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    intervalRef.current = setInterval(() => {
      const remaining = getRemainingSeconds();
      setTimeLeft(remaining);

      if (remaining <= 0 && !hasExpiredRef.current) {
        hasExpiredRef.current = true;
        onTimeExpiredRef.current?.();
      } else if (remaining > 0) {
        hasExpiredRef.current = false;
      }
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [draftData.currentPick, deadlineMs, getRemainingSeconds, normalizedStatus, timePerPick]);

  useEffect(() => {
    setTimeLeft(getRemainingSeconds());
  }, [getRemainingSeconds]);

  // Alert effects for upcoming turn
  useEffect(() => {
    if (normalizedStatus !== 'LIVE') return;

    if (picksUntilYourTurn === 1 && !hasAlerted) {
      setIsFlashing(true);
      setHasAlerted(true);
      onAudioAlertRef.current?.('next-up');

      const flashInterval = setInterval(() => {
        setIsFlashing((prev) => !prev);
      }, 1000);

      return () => clearInterval(flashInterval);
    } else if (isYourTurn && !hasAlerted) {
      setIsFlashing(false);
      setHasAlerted(true);
      onAudioAlertRef.current?.('your-turn');
    } else if (picksUntilYourTurn > 1) {
      setHasAlerted(false);
      setIsFlashing(false);
    }
  }, [picksUntilYourTurn, isYourTurn, hasAlerted, normalizedStatus]);

  // Validation - return error state if no valid data
  if (!draftData?.participants?.length) {
    return (
      <div className={`w-full ${className}`}>
        <div className="rounded-3xl border border-destructive/20 bg-destructive/5 px-5 py-4 text-center">
          <p className="text-sm font-medium text-destructive">Invalid draft data</p>
        </div>
      </div>
    );
  }

  // Format time display helper
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return `${mins}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  };

  // Show paused or waiting state
  if (normalizedStatus === 'PAUSED') {
    return (
      <div className={`w-full ${className}`}>
        <div className="rounded-3xl border border-amber-500/20 bg-amber-500/5 px-5 py-4 text-center">
          <h2 className="text-lg font-semibold text-foreground">Draft paused</h2>
          <p className="text-sm text-muted-foreground">
            The server clock and auto-pick are both stopped until the league owner resumes the room.
          </p>
        </div>
      </div>
    );
  }

  if (normalizedStatus === 'WAITING') {
    return (
      <div className={`w-full ${className}`}>
        <div className="rounded-3xl border border-border/60 bg-card/95 px-5 py-4 text-center shadow-sm">
          <h2 className="text-lg font-semibold text-foreground">Draft starting soon</h2>
          <p className="text-sm text-muted-foreground">
            Waiting for participants and final room readiness before the draft begins.
          </p>
        </div>
      </div>
    );
  }

  // Show completion state
  if (normalizedStatus === 'COMPLETED') {
    return (
      <div className={`w-full ${className}`}>
        <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/5 px-5 py-4 text-center">
          <h2 className="text-lg font-semibold text-foreground">Draft complete</h2>
          <p className="text-sm text-muted-foreground">
            All picks are finalized and the room is now in its completed state.
          </p>
        </div>
      </div>
    );
  }

  return (
    <section className={`w-full ${className}`} role="banner" aria-label="Live draft status">
      <div className="overflow-hidden rounded-[32px] border border-border/70 bg-card shadow-sm">
        <div className="border-b border-border/70 bg-muted/30 px-5 py-5 sm:px-6">
          {ownerControls ? <div className="mb-4">{ownerControls}</div> : null}
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.55fr)_minmax(260px,320px)] xl:items-start">
            <div className="min-w-0 rounded-[28px] border border-border bg-background px-5 py-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700">
                    Live engine
                  </span>
                  <span className="inline-flex items-center rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
                    {timerAuthorityLabel}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="rounded-2xl border border-border bg-muted/40 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Pick
                    </p>
                    <p className="mt-1 text-lg font-semibold text-foreground">
                      {draftData.currentPick}
                      <span className="ml-2 text-xs font-medium text-muted-foreground">
                        / {draftData.totalPicks}
                      </span>
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border bg-muted/40 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Round
                    </p>
                    <p className="mt-1 text-lg font-semibold text-foreground">{draftData.round}</p>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(228px,272px)] lg:items-start">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    On the clock
                  </p>
                  <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-2">
                    <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                      {currentTeam?.member.displayName || 'Unknown'}
                    </h2>
                    {isYourTurn && (
                      <span className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
                        You
                      </span>
                    )}
                  </div>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                    {autoPickSupportLabel}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-border bg-muted/40 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      Your draft status
                    </p>
                    {isYourTurn ? (
                      <div
                        className="mt-2 inline-flex rounded-full bg-amber-300 px-3 py-1 text-sm font-semibold text-slate-950"
                        role="alert"
                        aria-label="It is your turn to pick"
                      >
                        Your turn to pick
                      </div>
                    ) : (
                      <div
                        className={`mt-2 inline-flex rounded-full px-3 py-1 text-sm font-semibold ${
                          picksUntilYourTurn === 1
                            ? `bg-amber-100 text-amber-900 ring-1 ring-amber-200 ${isFlashing ? 'opacity-100' : 'opacity-80'}`
                            : picksUntilYourTurn <= 3
                              ? 'bg-orange-100 text-orange-900 ring-1 ring-orange-200'
                              : 'bg-slate-100 text-slate-700'
                        }`}
                        role="status"
                        aria-live="polite"
                      >
                        {picksUntilYourTurn === 1
                          ? "You're up next"
                          : picksUntilYourTurn > 0
                            ? `Your pick in ${picksUntilYourTurn} turn${picksUntilYourTurn > 1 ? 's' : ''}`
                            : 'Waiting for your slot'}
                      </div>
                    )}
                    {!isYourTurn && estimatedTimeUntilYourTurn > 0 && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Estimated wait: ~{formatTime(estimatedTimeUntilYourTurn)}
                      </p>
                    )}
                  </div>

                  <div className="rounded-2xl border border-border bg-muted/40 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      Next up
                    </p>
                    <p className="mt-2 text-base font-semibold text-foreground">
                      {nextTeam && draftData.currentPick < draftData.totalPicks
                        ? `${nextTeam.member.displayName}${nextTeam.slot === yourSlot ? ' · You' : ''}`
                        : 'Draft ending'}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {nextTeam && draftData.currentPick < draftData.totalPicks
                        ? `Pick #${draftData.currentPick + 1}`
                        : 'Final live slot'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div
              className={`self-start rounded-[28px] border px-4 py-4 shadow-sm ${
                hasLiveClock
                  ? 'border-border bg-foreground text-background'
                  : 'border-border bg-background text-foreground'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p
                    className={`text-[11px] font-semibold uppercase tracking-[0.22em] ${
                      hasLiveClock ? 'text-background/70' : 'text-muted-foreground'
                    }`}
                  >
                    {hasLiveClock ? 'Active pick clock' : 'Clock syncing'}
                  </p>
                  {hasLiveClock ? (
                    <div
                      className={`mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-mono sm:text-base ${
                        timeLeft <= 30
                          ? 'bg-red-500/90'
                          : timeLeft <= 60
                            ? 'bg-amber-500/90'
                            : 'bg-emerald-500/90'
                      }`}
                      role="timer"
                      aria-label={`Time remaining: ${formatTime(timeLeft)}`}
                      aria-live="polite"
                    >
                      <ClockIcon className={`h-4 w-4 ${timeLeft <= 10 ? 'animate-spin' : ''}`} />
                      <span className={timeLeft <= 10 ? 'animate-pulse' : ''}>
                        {formatTime(timeLeft)}
                      </span>
                    </div>
                  ) : (
                    <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1.5 text-sm font-semibold text-foreground">
                      <ClockIcon className="h-4 w-4" />
                      Clock syncing
                    </div>
                  )}
                </div>

                {draftData.picks.length > 0 && (
                  <div className="min-w-0 text-left sm:text-right">
                    <p
                      className={`text-[11px] font-semibold uppercase tracking-[0.22em] ${
                        hasLiveClock ? 'text-background/70' : 'text-muted-foreground'
                      }`}
                    >
                      Latest pick
                    </p>
                    <p className="mt-2 text-sm font-semibold text-current">
                      {draftData.picks[draftData.picks.length - 1]?.player.name}
                    </p>
                    <p
                      className={`mt-1 text-xs ${hasLiveClock ? 'text-background/70' : 'text-muted-foreground'}`}
                    >
                      {draftData.picks[draftData.picks.length - 1]?.member.displayName}
                    </p>
                  </div>
                )}
              </div>

              {hasLiveClock ? (
                <>
                  <p className="mt-4 text-sm leading-6 text-background/80">
                    This pick is on the live clock now. If no manual selection is made, the queue
                    fallback will resolve the timeout automatically.
                  </p>
                  {deadlineMs ? (
                    <p className="mt-3 text-xs text-background/70">
                      Deadline{' '}
                      {new Date(deadlineMs).toLocaleTimeString([], {
                        hour: 'numeric',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </p>
                  ) : (
                    <p className="mt-3 text-xs text-background/70">
                      Clock attached from live sync and waiting for the next deadline refresh.
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-4 text-sm leading-6 text-muted-foreground">
                  The room is live, but the current pick clock is still syncing. It should attach
                  shortly.
                </p>
              )}

              <div className="mt-4">
                {hasLiveClock ? (
                  <div className="h-2 overflow-hidden rounded-full bg-slate-200/20">
                    <div
                      className={`h-full transition-all duration-1000 ${
                        timeLeft <= 30
                          ? 'bg-red-500'
                          : timeLeft <= 60
                            ? 'bg-amber-500'
                            : 'bg-emerald-500'
                      }`}
                      style={{
                        width: `${Math.min(100, Math.max(0, (timeLeft / Math.max(1, timePerPick)) * 100))}%`,
                      }}
                      role="progressbar"
                      aria-valuenow={timeLeft}
                      aria-valuemin={0}
                      aria-valuemax={timePerPick}
                      aria-label={`Pick timer: ${Math.round((timeLeft / timePerPick) * 100)}% remaining`}
                    />
                  </div>
                ) : (
                  <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full w-1/3 rounded-full bg-slate-300" />
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[28px] border border-border bg-muted/40 p-4 shadow-sm xl:col-span-2">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    Draft order
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Secondary turn context for the current snake cycle.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-slate-950" />
                    Current
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                    Next
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                    You
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 md:gap-2.5">
                {draftOrder.map((team) => (
                  <div
                    key={team.slot}
                    className={`flex min-w-[40px] flex-col items-center rounded-2xl px-2.5 py-2 text-center transition-all ${
                      team.isCurrent
                        ? 'bg-slate-950 text-white shadow-lg shadow-slate-900/15'
                        : team.isNext
                          ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-200'
                          : team.isYou
                            ? 'bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200'
                            : 'bg-slate-100 text-slate-600'
                    }`}
                    aria-label={`Team ${team.slot}: ${team.name}${team.isCurrent ? ' (currently picking)' : ''}${team.isNext ? ' (next to pick)' : ''}${team.isYou ? ' (your team)' : ''}`}
                  >
                    <span className="text-xs font-semibold">{team.slot}</span>
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                  </div>
                ))}
                {draftData.participants.length > 8 && (
                  <span className="whitespace-nowrap pl-1 text-xs font-medium text-slate-500">
                    +{draftData.participants.length - 8} more
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
