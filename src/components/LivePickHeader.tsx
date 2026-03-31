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
  isYourTurn: boolean;
  yourSlot?: number;
  onTimeExpired?: () => void;
  onAudioAlert?: (type: 'warning' | 'your-turn' | 'next-up') => void;
  className?: string;
}

export default function LivePickHeader({
  draftData,
  timePerPick = 120,
  isYourTurn,
  yourSlot,
  onTimeExpired,
  onAudioAlert,
  className = '',
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

    const currentTeam = draftData.participants.find((p) => p.slot === currentSlot);
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
  }, [draftData, yourSlot, isYourTurn, timePerPick, normalizedStatus]);
  const picksUntilYourTurn = yourPickInfo?.picksUntilYourTurn ?? 0;
  const estimatedTimeUntilYourTurn = yourPickInfo?.estimatedTimeUntilYourTurn ?? 0;

  const getRemainingSeconds = useMemo(
    () => () => {
      if (normalizedStatus !== 'LIVE') return timePerPick;
      if (!deadlineMs) return timePerPick;
      return Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));
    },
    [deadlineMs, normalizedStatus, timePerPick]
  );

  // Timer effect with proper cleanup and callbacks
  useEffect(() => {
    if (normalizedStatus !== 'LIVE') {
      setTimeLeft(timePerPick);
      hasExpiredRef.current = false;
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
      <div className={`mx-auto w-full max-w-[1400px] px-4 pt-4 sm:px-6 lg:px-8 ${className}`}>
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
      <div className={`mx-auto w-full max-w-[1400px] px-4 pt-4 sm:px-6 lg:px-8 ${className}`}>
        <div className="rounded-3xl border border-amber-500/20 bg-amber-500/5 px-5 py-4 text-center">
          <h2 className="text-lg font-semibold text-foreground">Draft paused</h2>
          <p className="text-sm text-muted-foreground">
            The live clock is stopped until the league owner resumes the room.
          </p>
        </div>
      </div>
    );
  }

  if (normalizedStatus === 'WAITING') {
    return (
      <div className={`mx-auto w-full max-w-[1400px] px-4 pt-4 sm:px-6 lg:px-8 ${className}`}>
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
      <div className={`mx-auto w-full max-w-[1400px] px-4 pt-4 sm:px-6 lg:px-8 ${className}`}>
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
    <section
      className={`mx-auto w-full max-w-[1400px] px-4 pt-4 sm:px-6 lg:px-8 ${className}`}
      role="banner"
      aria-label="Live draft status"
    >
      <div className="rounded-[32px] border border-slate-800/80 bg-[linear-gradient(135deg,#2253d8_0%,#4b2be0_52%,#6b2fc8_100%)] px-5 py-5 text-white shadow-[0_18px_60px_rgba(30,41,59,0.22)] sm:px-6">
        {/* Main Status Row */}
        <div
          className="grid grid-cols-1 gap-5 lg:grid-cols-3 lg:items-center"
          role="region"
          aria-label="Draft status overview"
        >
          {/* Current Pick (Left) */}
          <div
            className="text-center lg:text-left"
            role="region"
            aria-label="Current pick information"
          >
            <div className="flex items-center justify-center gap-3 lg:justify-start">
              <div
                className={`h-3 w-3 rounded-full animate-pulse ${isYourTurn ? 'bg-amber-300' : 'bg-emerald-300'}`}
                role="status"
                aria-label={isYourTurn ? 'Your turn indicator' : 'Draft in progress indicator'}
              />
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/70">
                  On the clock
                </p>
                <p className={`text-lg font-semibold ${isYourTurn ? 'text-amber-200' : 'text-white'}`}>
                  {currentTeam?.member.displayName || 'Unknown'}
                  {isYourTurn && ' · You'}
                </p>
              </div>
            </div>

            {/* Countdown Timer */}
            <div className="mt-2">
              <div
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-mono ${
                  timeLeft <= 30 ? 'bg-red-500/85' : timeLeft <= 60 ? 'bg-amber-500/85' : 'bg-emerald-500/85'
                }`}
                role="timer"
                aria-label={`Time remaining: ${formatTime(timeLeft)}`}
                aria-live="polite"
              >
                <ClockIcon className={`w-4 h-4 ${timeLeft <= 10 ? 'animate-spin' : ''}`} />
                <span className={timeLeft <= 10 ? 'animate-pulse' : ''}>
                  {formatTime(timeLeft)}
                </span>
              </div>

              {/* Progress Bar */}
              <div className="mx-auto mt-2 h-1 w-32 overflow-hidden rounded-full bg-white/20 lg:mx-0">
                <div
                  className={`h-full transition-all duration-1000 ${
                    timeLeft <= 30
                      ? 'bg-red-300'
                      : timeLeft <= 60
                        ? 'bg-amber-300'
                        : 'bg-emerald-300'
                  }`}
                  style={{ width: `${(timeLeft / timePerPick) * 100}%` }}
                  role="progressbar"
                  aria-valuenow={timeLeft}
                  aria-valuemin={0}
                  aria-valuemax={timePerPick}
                  aria-label={`Pick timer: ${Math.round((timeLeft / timePerPick) * 100)}% remaining`}
                />
              </div>
            </div>
          </div>

          {/* Draft Progress (Center) */}
          <div className="text-center" role="region" aria-label="Draft progress information">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/70">
              Pick progress
            </p>
            <p className="text-xl font-semibold lg:text-2xl">
              #{draftData.currentPick}{' '}
              <span className="text-base text-white/70 lg:text-lg">of {draftData.totalPicks}</span>
            </p>
            <p className="text-xs text-white/70 lg:text-sm">
              Round {draftData.round} • {draftData.direction}
            </p>

            {/* Your Turn Info */}
            {!isYourTurn && picksUntilYourTurn > 0 && (
              <div
                className={`mt-2 rounded-full px-2 py-1 text-xs transition-all lg:px-3 lg:text-sm ${
                  picksUntilYourTurn === 1
                    ? `bg-amber-400 text-slate-950 ${isFlashing ? 'opacity-100' : 'opacity-80'} animate-pulse ring-2 ring-amber-200/70`
                    : picksUntilYourTurn <= 3
                      ? 'bg-orange-400/85'
                      : 'bg-white/15'
                }`}
                role="status"
                aria-live="polite"
                aria-label={`Your turn status: ${picksUntilYourTurn === 1 ? 'You are up next' : `${picksUntilYourTurn} picks until your turn`}`}
              >
                {picksUntilYourTurn === 1
                  ? "You're up next"
                  : picksUntilYourTurn <= 3
                    ? `${picksUntilYourTurn} picks until your turn`
                    : `Your pick in ${picksUntilYourTurn} turn${picksUntilYourTurn > 1 ? 's' : ''}`}
              </div>
            )}

            {/* Your Turn Indicator */}
            {isYourTurn && (
              <div
                className="mt-2 rounded-full bg-amber-300 px-2 py-1 text-xs font-semibold text-slate-950 animate-pulse lg:px-3 lg:text-sm"
                role="alert"
                aria-label="It is your turn to pick"
              >
                Your turn to pick
              </div>
            )}
          </div>

          {/* Next Up (Right) */}
          <div className="text-center lg:text-right">
            {nextTeam && draftData.currentPick < draftData.totalPicks ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/70">
                  Up next
                </p>
                <p className="text-lg font-semibold">
                  {nextTeam.member.displayName}
                  {nextTeam.slot === yourSlot && ' · You'}
                </p>
                <p className="text-sm text-white/70">Pick #{draftData.currentPick + 1}</p>
              </div>
            ) : (
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/70">
                  Final pick
                </p>
                <p className="text-lg font-semibold">Draft ending</p>
              </div>
            )}

            {/* Estimated Time to Your Turn */}
            {!isYourTurn && estimatedTimeUntilYourTurn > 0 && (
              <div className="mt-2 text-xs text-white/70">
                ~{formatTime(estimatedTimeUntilYourTurn)} until your turn
              </div>
            )}
          </div>
        </div>

        {/* Draft Order Visualization */}
        <div
          className="mt-4 border-t border-white/15 pt-4"
          role="region"
          aria-label="Draft order visualization"
        >
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            {/* Left: Draft Order */}
            <div className="flex items-center gap-1 overflow-x-auto lg:gap-2">
              <span className="mr-2 whitespace-nowrap text-xs text-white/70">Draft order</span>
              {draftOrder.map((team, index) => (
                <div key={team.slot} className="flex items-center">
                  <div
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold transition-all lg:h-8 lg:w-8 ${
                      team.isCurrent
                        ? 'bg-amber-300 text-slate-950 animate-pulse ring-2 ring-amber-100/80'
                        : team.isNext
                          ? 'bg-orange-300 text-slate-950 ring-2 ring-orange-100/80'
                          : team.isYou
                            ? 'bg-emerald-300 text-slate-950 ring-2 ring-emerald-100/80'
                            : 'bg-white/15 text-white'
                    }`}
                    title={team.name}
                    role="button"
                    tabIndex={0}
                    aria-label={`Team ${team.slot}: ${team.name}${team.isCurrent ? ' (currently picking)' : ''}${team.isNext ? ' (next to pick)' : ''}${team.isYou ? ' (your team)' : ''}`}
                  >
                    {team.slot}
                  </div>
                  {index < draftOrder.length - 1 && <div className="mx-1 h-px w-2 bg-white/20" />}
                </div>
              ))}
              {draftData.participants.length > 8 && (
                <span className="ml-2 text-xs text-white/70">
                  +{draftData.participants.length - 8} more
                </span>
              )}
            </div>

            {/* Right: Recent Activity */}
            {draftData.picks.length > 0 && (
              <div className="hidden lg:block text-right">
                <p className="mb-1 text-xs text-white/70">Latest pick</p>
                <div className="text-sm">
                  <span className="font-semibold">
                    {draftData.picks[draftData.picks.length - 1]?.player.name}
                  </span>
                  <span className="ml-1 text-white/70">
                    ({draftData.picks[draftData.picks.length - 1]?.player.position})
                  </span>
                </div>
                <div className="text-xs text-white/60">
                  to {draftData.picks[draftData.picks.length - 1]?.member.displayName}
                </div>
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="mt-2 flex items-center justify-center gap-4 text-xs text-white/70">
            <div className="flex items-center gap-1">
              <div className="h-3 w-3 rounded-full bg-amber-300"></div>
              <span>Current</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="h-3 w-3 rounded-full bg-orange-300"></div>
              <span>Next</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="h-3 w-3 rounded-full bg-emerald-300"></div>
              <span>You</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
