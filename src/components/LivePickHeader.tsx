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
import {
  toDraftPickTrainStateFromHeaderData,
  type LivePickHeaderData,
} from '@/lib/mappers/draftUiMappers';
import {
  buildDraftRoomSequence,
  getDraftRoomTimerState,
  type DraftRoomStatus,
} from '@/lib/draftRoomSequencing';

interface LivePickHeaderProps {
  draftData: LivePickHeaderData;
  timePerPick?: number; // seconds
  isYourTurn: boolean;
  yourSlot?: number;
  onAudioAlert?: (type: 'warning' | 'your-turn' | 'next-up') => void;
  className?: string;
}

export default function LivePickHeader({
  draftData,
  timePerPick = 120,
  isYourTurn,
  yourSlot,
  onAudioAlert,
  className = '',
}: LivePickHeaderProps): ReactElement {
  const [timeLeft, setTimeLeft] = useState(timePerPick);
  const [isFlashing, setIsFlashing] = useState(false);
  const [hasAlerted, setHasAlerted] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const onAudioAlertRef = useRef(onAudioAlert);

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
        draftType: draftData.draftType,
      }),
    [draftData, normalizedStatus, timePerPick, yourSlot]
  );
  const nextUserPick = sequence.nextUserPick;
  const picksUntilYourTurn = nextUserPick?.picksUntil ?? 0;

  const getTimerState = useMemo(
    () => () => {
      return getDraftRoomTimerState({
        status: normalizedStatus,
        timePerPick,
        pickDeadlineAt: draftData.pickDeadlineAt,
        clock: draftData.clock,
        clockReceivedAt: draftData.clockReceivedAt,
      });
    },
    [
      draftData.clock,
      draftData.clockReceivedAt,
      draftData.pickDeadlineAt,
      normalizedStatus,
      timePerPick,
    ]
  );
  const timerState = getTimerState();

  // The browser interpolates a persisted deadline for display only. Expiry actions remain server-owned.
  useEffect(() => {
    const initialTimerState = getTimerState();
    setTimeLeft(initialTimerState.remainingSeconds);

    if (!initialTimerState.isRunning) {
      return;
    }

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    intervalRef.current = setInterval(() => {
      const nextTimerState = getTimerState();
      setTimeLeft(nextTimerState.remainingSeconds);
      if (!nextTimerState.isRunning && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [draftData.currentPick, getTimerState]);

  useEffect(() => {
    setTimeLeft(getTimerState().remainingSeconds);
  }, [getTimerState]);

  // Alert effects for upcoming turn
  useEffect(() => {
    if (timerState.phase !== 'LIVE') return;

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
  }, [picksUntilYourTurn, isYourTurn, hasAlerted, timerState.phase]);

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

  const timerPercent = timerState.percentRemaining;
  const timerTone =
    timerState.tone === 'urgent'
      ? {
          badge:
            'border-[color:var(--draft-broadcast-red)] bg-[color:var(--draft-broadcast-red)] text-white shadow-[0_0_24px_var(--draft-broadcast-red-glow)]',
          bar: 'bg-[color:var(--draft-broadcast-red)]',
          rail: 'bg-[color:var(--draft-broadcast-red-soft)]',
          label: timerState.label,
        }
      : timerState.tone === 'warning'
        ? {
            badge:
              'border-[color:var(--draft-broadcast-yellow)] bg-[color:var(--draft-broadcast-yellow)] text-[color:var(--draft-broadcast-yellow-text)]',
            bar: 'bg-[color:var(--draft-broadcast-yellow)]',
            rail: 'bg-[color:var(--draft-broadcast-yellow-soft)]',
            label: timerState.label,
          }
        : timerState.tone === 'complete'
          ? {
              badge:
                'border-[color:var(--draft-broadcast-green)] bg-[color:var(--draft-broadcast-green)] text-white',
              bar: 'bg-[color:var(--draft-broadcast-green)]',
              rail: 'bg-[color:var(--draft-broadcast-green-soft)]',
              label: timerState.label,
            }
          : timerState.tone === 'neutral'
            ? {
                badge:
                  'border-[color:var(--draft-broadcast-border)] bg-[color:var(--draft-broadcast-panel-strong)] text-[color:var(--draft-broadcast-muted)]',
                bar: 'bg-[color:var(--draft-broadcast-muted)]',
                rail: 'bg-[color:var(--draft-broadcast-panel-strong)]',
                label: timerState.label,
              }
            : {
                badge:
                  'border-[color:var(--draft-broadcast-red)] bg-[color:var(--draft-broadcast-red-soft)] text-white',
                bar: 'bg-[color:var(--draft-broadcast-red)]',
                rail: 'bg-[color:var(--draft-broadcast-red-soft)]',
                label: timerState.label,
              };
  const statusCopyByStatus = {
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
      title: sequence.current
        ? `Pick ${sequence.current.overall}`
        : `Pick ${draftData.currentPick}`,
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
  const statusCopy =
    timerState.phase === 'FINALIZING'
      ? {
          title: 'Finalizing pick',
          detail: 'The deadline has passed. Waiting for the server to persist the selection.',
        }
      : timerState.phase === 'SYNCING'
        ? {
            title: 'Syncing clock',
            detail: 'Refreshing the authoritative draft clock before showing a countdown.',
          }
        : statusCopyByStatus;
  const timerDisplay = timerState.phase === 'SYNCING' ? '—' : formatTime(timeLeft);
  const timerAriaLabel =
    timerState.phase === 'SYNCING'
      ? 'Draft clock is syncing'
      : timerState.phase === 'FINALIZING'
        ? 'Draft pick is being finalized'
        : `Time remaining: ${formatTime(timeLeft)}`;
  const effectiveDuration = draftData.clock?.durationSeconds ?? timePerPick;

  return (
    <section
      className={`w-full px-4 pt-4 sm:px-6 lg:px-8 ${className}`}
      role="banner"
      aria-label="Live draft status"
    >
      <div className="flex min-w-0 flex-col gap-4">
        <div
          className="rounded-2xl border border-t-4 border-[color:var(--draft-broadcast-border)] border-t-[color:var(--draft-broadcast-red)] bg-[color:var(--draft-broadcast-panel)] p-4 text-[color:var(--draft-broadcast-text)] shadow-[0_22px_70px_-48px_var(--draft-broadcast-shadow-deep)]"
          role="region"
          aria-label="Draft clock"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-md border border-[color:var(--draft-broadcast-red)] bg-[color:var(--draft-broadcast-red-soft)] px-2.5 py-1 text-xs font-semibold text-white">
                {statusCopy.title}
              </span>
              <span className="rounded-md border border-[color:var(--draft-broadcast-border)] bg-[color:var(--draft-broadcast-panel-strong)] px-2.5 py-1 text-xs font-medium text-[color:var(--draft-broadcast-muted)]">
                Round {draftData.round} / {draftData.direction}
              </span>
              {isYourTurn && (
                <span
                  className="rounded-md border border-[color:var(--draft-broadcast-red)] bg-[color:var(--draft-broadcast-red)] px-2.5 py-1 text-xs font-semibold text-white shadow-[0_0_24px_var(--draft-broadcast-red-glow)]"
                  role="alert"
                  aria-label="It is your turn to pick"
                >
                  Your turn
                </span>
              )}
            </div>

            <span
              className={`rounded-md border px-2 py-1 text-xs font-semibold ${timerTone.badge}`}
            >
              {timerTone.label}
            </span>
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-normal text-[color:var(--draft-broadcast-muted)]">
                Live pick clock
              </p>
              <p className="mt-1 max-w-2xl text-sm text-[color:var(--draft-broadcast-muted)]">
                {statusCopy.detail}
              </p>
              <div
                className="mt-2 flex items-baseline gap-2 font-mono text-5xl font-semibold tracking-normal text-[color:var(--draft-broadcast-text)]"
                role="timer"
                aria-label={timerAriaLabel}
                aria-live="polite"
              >
                <ClockIcon
                  className={`h-6 w-6 ${timerState.phase === 'LIVE' && timeLeft <= 10 ? 'animate-spin text-[color:var(--draft-broadcast-red)]' : 'text-[color:var(--draft-broadcast-muted)]'}`}
                  aria-hidden="true"
                />
                <span
                  className={timerState.phase === 'LIVE' && timeLeft <= 10 ? 'animate-pulse' : ''}
                >
                  {timerDisplay}
                </span>
              </div>
            </div>

            {!isYourTurn && picksUntilYourTurn > 0 && (
              <div
                className={`inline-flex rounded-md border px-3 py-2 text-sm font-medium transition-opacity ${
                  picksUntilYourTurn === 1
                    ? `border-[color:var(--draft-broadcast-yellow)] bg-[color:var(--draft-broadcast-yellow)] text-[color:var(--draft-broadcast-yellow-text)] ${isFlashing ? 'opacity-100' : 'opacity-80'} animate-pulse`
                    : 'border-[color:var(--draft-broadcast-border)] bg-[color:var(--draft-broadcast-panel-strong)] text-[color:var(--draft-broadcast-muted)]'
                }`}
                role="status"
                aria-live="polite"
                aria-label={`Your next pick is pick ${nextUserPick?.overall}`}
              >
                Your next pick: Pick {nextUserPick?.overall}
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
              aria-valuemax={effectiveDuration}
              aria-label={`Pick timer: ${timerPercent}% remaining`}
            />
          </div>
        </div>

        <DraftPickTrain state={pickTrainState} timeLeft={timeLeft} />
      </div>
    </section>
  );
}
