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
  /** The room would take a pick from this viewer right now (on the clock, board up to date). */
  canMakePick?: boolean;
  /** The league lets a manager auto-pick an overdue pick. */
  autoPickAllowed?: boolean;
  /** Given only to a commissioner: makes the overdue pick; a rejection's message is shown. */
  onMakeOverduePick?: () => Promise<void>;
}

const TIME_UP = 'Time is up.';
const CLOCK_MILESTONES = [
  { at: 0, text: TIME_UP },
  { at: 10, text: '10 seconds left.' },
  { at: 30, text: '30 seconds left.' },
] as const;

/** The most urgent milestone crossed between two observed clock readings, if any. */
function getCrossedClockMilestone(previous: number, current: number): string | null {
  return (
    CLOCK_MILESTONES.find((milestone) => previous > milestone.at && current <= milestone.at)
      ?.text ?? null
  );
}

function formatClock(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

export default function LivePickHeader({
  draftData,
  timePerPick = 120,
  isYourTurn,
  yourSlot,
  onAudioAlert,
  className = '',
  canMakePick = false,
  autoPickAllowed = true,
  onMakeOverduePick,
}: LivePickHeaderProps): ReactElement {
  const [timeLeft, setTimeLeft] = useState(timePerPick);
  // The clock keeps ticking through finalizing so the room notices when the pick becomes overdue.
  const [, setTickedPhase] = useState<string>();
  const [overduePickPending, setOverduePickPending] = useState(false);
  // Kept with its pick so a refusal never shows under a later overdue pick.
  const [overduePickError, setOverduePickError] = useState<{ pick: number; message: string }>();
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
    const keepsTicking = (state: ReturnType<typeof getTimerState>) =>
      state.isRunning || state.phase === 'FINALIZING';
    const initialTimerState = getTimerState();
    setTimeLeft(initialTimerState.remainingSeconds);

    if (!keepsTicking(initialTimerState)) {
      return;
    }

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    intervalRef.current = setInterval(() => {
      const nextTimerState = getTimerState();
      setTimeLeft(nextTimerState.remainingSeconds);
      setTickedPhase(nextTimerState.phase);
      if (!keepsTicking(nextTimerState) && intervalRef.current) {
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
    } else if (!isYourTurn && picksUntilYourTurn > 1) {
      // The on-clock flag and the pick sequence can briefly disagree; resetting while still on the
      // clock would re-alert and reset on every render.
      setHasAlerted(false);
      setIsFlashing(false);
    }
  }, [picksUntilYourTurn, isYourTurn, hasAlerted, timerState.phase]);

  // Screen readers hear the clock when the turn starts and as it crosses 30, 10 and 0 seconds,
  // never every tick. A milestone that passed before the turn was observed is not announced.
  const [clockAnnouncement, setClockAnnouncement] = useState('');
  const announcedRef = useRef<{ pick?: number; lastRemaining?: number }>({});
  useEffect(() => {
    if (announcedRef.current.pick !== draftData.currentPick) {
      announcedRef.current = { pick: draftData.currentPick };
      setClockAnnouncement('');
    }
    // Read the synced clock, not timeLeft, which starts at the full pick time before it syncs.
    const remaining = timerState.remainingSeconds;
    const clockRunning =
      timerState.phase === 'LIVE' || (timerState.phase === 'FINALIZING' && remaining === 0);
    if (!clockRunning || !isYourTurn) return;

    const { lastRemaining } = announcedRef.current;
    announcedRef.current = { ...announcedRef.current, lastRemaining: remaining };
    if (lastRemaining === undefined) {
      setClockAnnouncement(
        remaining === 0
          ? `Your turn to pick. ${TIME_UP}`
          : `Your turn to pick. ${formatClock(remaining)} remaining.`
      );
      return;
    }
    const crossed = getCrossedClockMilestone(lastRemaining, remaining);
    if (crossed) setClockAnnouncement(crossed);
    // timeLeft re-runs this each tick; timerState is recomputed every render.
  }, [draftData.currentPick, isYourTurn, timeLeft, timerState.phase]);

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
        <div className="border border-destructive/20 bg-destructive/5 px-5 py-4 text-center">
          <p className="text-sm font-medium text-destructive-text">Invalid draft data</p>
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
          badge: 'border-destructive bg-destructive text-destructive-foreground',
          bar: 'bg-destructive',
          rail: 'bg-destructive/15',
          label: timerState.label,
        }
      : timerState.tone === 'warning'
        ? {
            badge: 'border-warning bg-warning text-warning-foreground',
            bar: 'bg-warning',
            rail: 'bg-warning/20',
            label: timerState.label,
          }
        : timerState.tone === 'complete'
          ? {
              badge: 'border-success bg-success text-brand-bar-foreground',
              bar: 'bg-success',
              rail: 'bg-success-soft',
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
                badge: 'border-brand-bar bg-accent text-foreground',
                bar: 'bg-brand-bar',
                rail: 'bg-accent',
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
  const overdueDetail =
    canMakePick && isYourTurn
      ? 'Your pick is still open. Choose a player now.'
      : onMakeOverduePick
        ? 'This pick is overdue.'
        : autoPickAllowed
          ? 'This pick is overdue. The commissioner can make it.'
          : 'This pick is overdue. Waiting for the manager on the clock to pick.';
  const showOverduePickButton =
    timerState.phase === 'OVERDUE' && Boolean(onMakeOverduePick) && !(canMakePick && isYourTurn);
  const makeOverduePick = async () => {
    if (!onMakeOverduePick) return;
    const pick = draftData.currentPick;
    setOverduePickPending(true);
    setOverduePickError(undefined);
    try {
      await onMakeOverduePick();
    } catch (error) {
      setOverduePickError({
        pick,
        message: error instanceof Error ? error.message : 'The pick could not be made.',
      });
    } finally {
      setOverduePickPending(false);
    }
  };
  const statusCopy =
    timerState.phase === 'OVERDUE'
      ? { title: 'Pick overdue', detail: overdueDetail }
      : timerState.phase === 'FINALIZING'
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
        : timerState.phase === 'OVERDUE'
          ? 'Draft pick is overdue'
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
          className={` border border-t-4 border-border p-4 text-foreground ${
            isYourTurn ? 'border-t-warning bg-warning/20' : 'border-t-brand-bar bg-card'
          }`}
          role="region"
          aria-label="Draft clock"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-cut border border-brand-bar bg-accent px-2.5 py-1 text-xs font-semibold text-foreground">
                {statusCopy.title}
              </span>
              <span className="border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                Round {draftData.round} / {draftData.direction}
              </span>
              {isYourTurn && (
                <span className="border border-warning bg-warning px-3 py-1 text-sm font-bold text-warning-foreground">
                  {/* Visual only: the pick clock announcer speaks the turn once. */}
                  Your turn
                </span>
              )}
            </div>

            <span className={` border px-2 py-1 text-xs font-semibold ${timerTone.badge}`}>
              {timerTone.label}
            </span>
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
                Live pick clock
              </p>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{statusCopy.detail}</p>
              {showOverduePickButton && (
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void makeOverduePick()}
                    disabled={overduePickPending}
                    aria-busy={overduePickPending}
                    className="rounded-cut bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60"
                  >
                    Make the pick now
                  </button>
                  {overduePickError?.pick === draftData.currentPick && (
                    <p role="alert" className="text-sm text-destructive-text">
                      {overduePickError.message}
                    </p>
                  )}
                </div>
              )}
              <div
                className="mt-2 flex items-baseline gap-2 font-mono text-5xl font-semibold tracking-normal text-foreground"
                role="timer"
                aria-label={timerAriaLabel}
              >
                <ClockIcon
                  className={`h-6 w-6 ${timerState.phase === 'LIVE' && timeLeft <= 10 ? 'text-destructive-text' : 'text-muted-foreground'}`}
                  aria-hidden="true"
                />
                <span className={timerState.phase === 'LIVE' && timeLeft <= 10 ? 'font-bold' : ''}>
                  {timerDisplay}
                </span>
              </div>
              <p
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className="sr-only"
                data-testid="pick-clock-announcer"
              >
                {clockAnnouncement}
              </p>
            </div>

            {!isYourTurn && picksUntilYourTurn > 0 && (
              <div
                className={`inline-flex rounded-cut border px-3 py-2 text-sm font-medium transition-opacity ${
                  picksUntilYourTurn === 1
                    ? `border-warning bg-warning text-warning-foreground ${isFlashing ? 'opacity-100' : 'opacity-80'}`
                    : 'border-border bg-muted text-muted-foreground'
                }`}
                role="status"
                aria-live="polite"
                aria-label={`Your next pick is pick ${nextUserPick?.overall}`}
              >
                Your next pick: Pick {nextUserPick?.overall}
              </div>
            )}
          </div>

          <div className={`mt-4 h-2 overflow-hidden ${timerTone.rail}`}>
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
