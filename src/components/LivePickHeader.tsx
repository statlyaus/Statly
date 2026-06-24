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
import {
  buildDraftRoomSequence,
  getDraftRoomTimerState,
  type DraftRoomStatus,
} from '@/lib/draftRoomSequencing';

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
  ): status is
    | 'SCHEDULED'
    | 'LOBBY'
    | 'COUNTDOWN'
    | 'LIVE'
    | 'COMPLETED'
    | 'PAUSED'
    | 'CANCELLED'
    | 'WAITING' => {
    return [
      'SCHEDULED',
      'LOBBY',
      'COUNTDOWN',
      'LIVE',
      'COMPLETED',
      'PAUSED',
      'CANCELLED',
      'WAITING',
    ].includes(status);
  };

  // Get normalized status with fallback
  const normalizedStatus = isValidDraftStatus(draftData?.status) ? draftData.status : 'WAITING';
  const sequence = useMemo(
    () =>
      buildDraftRoomSequence({
        currentPick: draftData.currentPick,
        totalPicks: draftData.totalPicks,
        participants: draftData.participants,
        picks: draftData.picks,
        yourSlot,
        status: normalizedStatus as DraftRoomStatus,
        timePerPick,
      }),
    [draftData, normalizedStatus, timePerPick, yourSlot]
  );
  const nextUserPick = sequence.nextUserPick;
  const picksUntilYourTurn = nextUserPick?.picksUntil ?? 0;
  const estimatedTimeUntilYourTurn = nextUserPick?.estimatedSecondsUntil ?? 0;

  const getRemainingSeconds = useMemo(
    () => () => {
      return getDraftRoomTimerState({
        status: normalizedStatus,
        timePerPick,
        pickDeadlineAt: draftData.pickDeadlineAt,
      }).remainingSeconds;
    },
    [draftData.pickDeadlineAt, normalizedStatus, timePerPick]
  );

  // Timer effect with proper cleanup and callbacks
  useEffect(() => {
    if (normalizedStatus !== 'LIVE') {
      setTimeLeft(getRemainingSeconds());
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
  }, [draftData.currentPick, getRemainingSeconds, normalizedStatus]);

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
        className={`w-full px-4 pt-4 sm:px-6 lg:px-8 ${className}`}
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

  const timerState = getDraftRoomTimerState({
    status: normalizedStatus,
    timePerPick,
    pickDeadlineAt: draftData.pickDeadlineAt,
  });
  const timerPercent = timerState.percentRemaining;
  const timerTone =
    timerState.tone === 'urgent'
      ? {
          badge: 'border-destructive/30 bg-destructive/10 text-destructive',
          bar: 'bg-destructive',
          rail: 'bg-destructive/15',
          label: timerState.label,
        }
      : timerState.tone === 'warning'
        ? {
            badge: 'border-warning/40 bg-warning/15 text-warning-foreground',
            bar: 'bg-warning',
            rail: 'bg-warning/20',
            label: timerState.label,
          }
        : timerState.tone === 'complete'
          ? {
              badge: 'border-primary/25 bg-primary/10 text-primary',
              bar: 'bg-primary',
              rail: 'bg-primary/15',
              label: timerState.label,
            }
          : timerState.tone === 'neutral'
            ? {
                badge: 'border-border bg-muted text-muted-foreground',
                bar: 'bg-muted-foreground',
                rail: 'bg-muted',
                label: timerState.label,
              }
            : {
                badge: 'border-primary/25 bg-primary/10 text-primary',
                bar: 'bg-primary',
                rail: 'bg-primary/15',
                label: timerState.label,
              };
  const statusCopy =
    {
      SCHEDULED: {
        title: 'Draft scheduled',
        detail:
          'The room is ready. Participants can prepare queues before the league owner starts the draft.',
      },
      LOBBY: {
        title: 'Draft lobby',
        detail: 'The lobby is open for final queue and roster checks.',
      },
      COUNTDOWN: {
        title: 'Draft countdown',
        detail: 'The draft is waiting for its scheduled launch.',
      },
      LIVE: {
        title: sequence.current ? `Pick ${sequence.current.overall}` : `Pick ${draftData.currentPick}`,
        detail: sequence.current
          ? `${sequence.current.displayName} is on the clock.`
          : 'The draft clock is live.',
      },
      PAUSED: {
        title: 'Draft paused',
        detail: 'The clock is stopped until the league owner resumes the room.',
      },
      COMPLETED: {
        title: 'Draft complete',
        detail: 'All picks are finalized and the draft history is available for review.',
      },
      CANCELLED: {
        title: 'Draft cancelled',
        detail: 'This draft is no longer accepting picks.',
      },
      WAITING: {
        title: 'Draft starting soon',
        detail: 'Waiting for participants and final room readiness before the draft begins.',
      },
    }[normalizedStatus] ?? {
      title: 'Draft room',
      detail: 'The room is loading the latest draft state.',
    };

  return (
    <section
      className={`w-full px-4 pt-4 sm:px-6 lg:px-8 ${className}`}
      role="banner"
      aria-label="Live draft status"
    >
      <div className="flex min-w-0 flex-col gap-4">
        <div
          className="rounded-lg border border-border bg-card p-4 text-card-foreground shadow-sm"
          role="region"
          aria-label="Draft clock"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-md border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                {statusCopy.title}
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
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{statusCopy.detail}</p>
              <div
                className="mt-2 flex items-baseline gap-2 font-mono text-4xl font-semibold tracking-normal text-foreground"
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
    </section>
  );
}
