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

import { useState, useEffect, useMemo, useRef, type ReactElement } from 'react';
import { ClockIcon } from '@heroicons/react/24/outline';

import DraftPickTrain from '@/components/draft/DraftPickTrain';
import { toDraftPickTrainStateFromHeaderData } from '@/lib/mappers/draftUiMappers';

interface DraftParticipant {
  slot: number;
  member: {
    id: string;
    userId: string;
    displayName: string;
    email: string;
    teamName?: string;
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
        teamName?: string;
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
}: LivePickHeaderProps): ReactElement {
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
  const { yourPickInfo } = useMemo(() => {
    // Return default values if no valid data
    if (!draftData?.participants?.length) {
      return {
        yourPickInfo: null,
      };
    }

    const teamCount = draftData.participants.length;

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

    return {
      yourPickInfo: {
        picksUntilYourTurn,
        estimatedTimeUntilYourTurn,
        nextPickNumber: draftData.currentPick + picksUntilYourTurn,
      },
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

  const pickTrainState = useMemo(
    () => toDraftPickTrainStateFromHeaderData({ draftData, yourSlot }),
    [draftData, yourSlot]
  );

  // Validation - return error state if no valid data
  if (!draftData?.participants?.length) {
    return (
      <section
        className={`mx-auto w-full max-w-[1400px] px-4 pt-4 sm:px-6 lg:px-8 ${className}`}
        role="banner"
        aria-label="Live draft status"
      >
        <div className="rounded-3xl border border-destructive/20 bg-destructive/5 px-5 py-4 text-center">
          <p className="text-sm font-medium text-destructive">Invalid draft data</p>
        </div>
      </section>
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

  const timerPercent = Math.max(0, Math.min(100, Math.round((timeLeft / timePerPick) * 100)));
  const timerTone =
    timeLeft <= 30
      ? {
          badge: 'border-destructive/30 bg-destructive/10 text-destructive',
          bar: 'bg-destructive',
          rail: 'bg-destructive/15',
          label: 'Urgent',
        }
      : timeLeft <= 60
        ? {
            badge: 'border-warning/40 bg-warning/15 text-warning-foreground',
            bar: 'bg-warning',
            rail: 'bg-warning/20',
            label: 'Short clock',
          }
        : {
            badge: 'border-primary/25 bg-primary/10 text-primary',
            bar: 'bg-primary',
            rail: 'bg-primary/15',
            label: 'On pace',
          };
  const latestPick = draftData.picks[draftData.picks.length - 1];

  // Show paused or waiting state
  if (normalizedStatus === 'PAUSED') {
    return (
      <section
        className={`mx-auto w-full max-w-[1400px] px-4 pt-4 sm:px-6 lg:px-8 ${className}`}
        role="banner"
        aria-label="Live draft status"
      >
        <div className="rounded-3xl border border-amber-500/20 bg-amber-500/5 px-5 py-4 text-center">
          <h2 className="text-lg font-semibold text-foreground">Draft paused</h2>
          <p className="text-sm text-muted-foreground">
            The live clock is stopped until the league owner resumes the room.
          </p>
        </div>
      </section>
    );
  }

  if (normalizedStatus === 'WAITING') {
    return (
      <section
        className={`mx-auto w-full max-w-[1400px] px-4 pt-4 sm:px-6 lg:px-8 ${className}`}
        role="banner"
        aria-label="Live draft status"
      >
        <div className="rounded-3xl border border-border/60 bg-card/95 px-5 py-4 text-center shadow-sm">
          <h2 className="text-lg font-semibold text-foreground">Draft starting soon</h2>
          <p className="text-sm text-muted-foreground">
            Waiting for participants and final room readiness before the draft begins.
          </p>
        </div>
      </section>
    );
  }

  // Show completion state
  if (normalizedStatus === 'COMPLETED') {
    return (
      <section
        className={`mx-auto w-full max-w-[1400px] px-4 pt-4 sm:px-6 lg:px-8 ${className}`}
        role="banner"
        aria-label="Live draft status"
      >
        <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/5 px-5 py-4 text-center">
          <h2 className="text-lg font-semibold text-foreground">Draft complete</h2>
          <p className="text-sm text-muted-foreground">
            All picks are finalized and the room is now in its completed state.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`mx-auto w-full max-w-[1400px] px-4 pt-4 sm:px-6 lg:px-8 ${className}`}
      role="banner"
      aria-label="Live draft status"
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="flex flex-col gap-4">
          <div
            className="rounded-lg border border-border bg-card p-4 text-card-foreground shadow-sm"
            role="region"
            aria-label="Draft clock"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-md border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                  Pick {draftData.currentPick}
                </span>
                <span className="rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
                  Round {draftData.round} / {draftData.direction}
                </span>
                {isYourTurn && (
                  <span
                    className="rounded-md border border-primary bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground"
                    role="alert"
                    aria-label="It is your turn to pick"
                  >
                    Your turn
                  </span>
                )}
              </div>

              <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${timerTone.badge}`}>
                {timerTone.label}
              </span>
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
                  Live pick clock
                </p>
                <div
                  className="mt-1 flex items-baseline gap-2 font-mono text-4xl font-semibold tracking-normal text-foreground"
                  role="timer"
                  aria-label={`Time remaining: ${formatTime(timeLeft)}`}
                  aria-live="polite"
                >
                  <ClockIcon
                    className={`h-6 w-6 ${timeLeft <= 10 ? 'animate-spin text-destructive' : 'text-muted-foreground'}`}
                    aria-hidden="true"
                  />
                  <span className={timeLeft <= 10 ? 'animate-pulse' : ''}>
                    {formatTime(timeLeft)}
                  </span>
                </div>
              </div>

              {!isYourTurn && picksUntilYourTurn > 0 && (
                <div
                  className={`inline-flex rounded-md border px-3 py-2 text-sm font-medium transition-opacity ${
                    picksUntilYourTurn === 1
                      ? `border-primary bg-accent text-accent-foreground ${isFlashing ? 'opacity-100' : 'opacity-80'} animate-pulse`
                      : 'border-border bg-background text-muted-foreground'
                  }`}
                  role="status"
                  aria-live="polite"
                  aria-label={`Your turn status: ${picksUntilYourTurn === 1 ? 'You are up next' : `${picksUntilYourTurn} picks until your turn`}`}
                >
                  {picksUntilYourTurn === 1
                    ? "You're up next"
                    : `${picksUntilYourTurn} pick${picksUntilYourTurn > 1 ? 's' : ''} until your turn`}
                  {estimatedTimeUntilYourTurn > 0 && (
                    <span className="ml-1 text-muted-foreground">
                      / about {formatTime(estimatedTimeUntilYourTurn)}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className={`mt-4 h-2 overflow-hidden rounded-full ${timerTone.rail}`}>
              <div
                className={`h-full transition-all duration-1000 ${timerTone.bar}`}
                style={{ width: `${timerPercent}%` }}
                role="progressbar"
                aria-valuenow={timeLeft}
                aria-valuemin={0}
                aria-valuemax={timePerPick}
                aria-label={`Pick timer: ${timerPercent}% remaining`}
              />
            </div>
          </div>

          <DraftPickTrain state={pickTrainState} timeLeft={timeLeft} />
        </div>

        <aside
          className="rounded-lg border border-border bg-card p-4 text-card-foreground shadow-sm sm:p-5"
          aria-label="Latest draft activity"
        >
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Latest pick
            </p>
            {latestPick ? (
              <div className="mt-3">
                <p className="text-lg font-semibold leading-tight text-foreground">
                  {latestPick.player.name}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span className="rounded-full border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground">
                    {latestPick.player.position}
                  </span>
                  <span>{latestPick.player.club}</span>
                </div>
                <p className="mt-4 text-sm text-muted-foreground">
                  Picked by{' '}
                  <span className="font-medium text-foreground">
                    {latestPick.member.displayName}
                  </span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Round {latestPick.round} / Pick {latestPick.overall}
                  {latestPick.auto && ' / Auto-pick'}
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Selections will appear here as soon as the draft starts moving.
              </p>
            )}
        </aside>
      </div>
    </section>
  );
}
