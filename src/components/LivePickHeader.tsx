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

  // Helper function to check if status is a valid draft status
  const isValidDraftStatus = (
    status: string
  ): status is 'LIVE' | 'COMPLETED' | 'PAUSED' | 'WAITING' => {
    return ['LIVE', 'COMPLETED', 'PAUSED', 'WAITING'].includes(status);
  };

  // Get normalized status with fallback
  const normalizedStatus = isValidDraftStatus(draftData?.status) ? draftData.status : 'WAITING';

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

  // Timer effect with proper cleanup and callbacks
  useEffect(() => {
    if (normalizedStatus !== 'LIVE') return;

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    intervalRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          // Time expired - call callback if provided
          onTimeExpired?.();
          return timePerPick; // Reset for next pick
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [draftData?.currentPick, normalizedStatus, timePerPick, onTimeExpired]);

  // Alert effects for upcoming turn
  useEffect(() => {
    if (!yourPickInfo || normalizedStatus !== 'LIVE') return;

    if (yourPickInfo.picksUntilYourTurn === 1 && !hasAlerted) {
      setIsFlashing(true);
      setHasAlerted(true);
      onAudioAlert?.('next-up');

      const flashInterval = setInterval(() => {
        setIsFlashing((prev) => !prev);
      }, 1000);

      return () => clearInterval(flashInterval);
    } else if (isYourTurn && !hasAlerted) {
      setIsFlashing(false);
      setHasAlerted(true);
      onAudioAlert?.('your-turn');
    } else if (yourPickInfo.picksUntilYourTurn > 1) {
      setHasAlerted(false);
      setIsFlashing(false);
    }
  }, [yourPickInfo, isYourTurn, hasAlerted, onAudioAlert, normalizedStatus]);

  // Validation - return error state if no valid data
  if (!draftData?.participants?.length) {
    return (
      <div className={`bg-red-100 border-b border-red-200 p-4 ${className}`}>
        <div className="max-w-6xl mx-auto text-center">
          <p className="text-red-800">Error: Invalid draft data</p>
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
      <div className={`bg-yellow-100 border-b border-yellow-200 p-4 ${className}`}>
        <div className="max-w-6xl mx-auto text-center">
          <h2 className="text-2xl font-bold text-yellow-800">⏸️ Draft Paused</h2>
          <p className="text-yellow-700">
            The draft is temporarily paused. Please wait for it to resume.
          </p>
        </div>
      </div>
    );
  }

  if (normalizedStatus === 'WAITING') {
    return (
      <div className={`bg-blue-100 border-b border-blue-200 p-4 ${className}`}>
        <div className="max-w-6xl mx-auto text-center">
          <h2 className="text-2xl font-bold text-blue-800">⏳ Draft Starting Soon</h2>
          <p className="text-blue-700">
            Waiting for all participants to join before starting the draft.
          </p>
        </div>
      </div>
    );
  }

  // Show completion state
  if (normalizedStatus === 'COMPLETED') {
    return (
      <div className={`bg-gray-100 border-b border-gray-200 p-4 ${className}`}>
        <div className="max-w-6xl mx-auto text-center">
          <h2 className="text-2xl font-bold text-gray-800">🏆 Draft Complete!</h2>
          <p className="text-gray-600">All picks have been made. Good luck with your team!</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`bg-gradient-to-r from-blue-600 to-purple-600 text-white border-b shadow-lg ${className}`}
      role="banner"
      aria-label="Live draft status"
    >
      <div className="max-w-6xl mx-auto p-4">
        {/* Main Status Row */}
        <div
          className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-center"
          role="region"
          aria-label="Draft status overview"
        >
          {/* Current Pick (Left) */}
          <div
            className="text-center lg:text-left"
            role="region"
            aria-label="Current pick information"
          >
            <div className="flex items-center justify-center lg:justify-start gap-3">
              <div
                className={`w-3 h-3 rounded-full animate-pulse ${isYourTurn ? 'bg-yellow-400' : 'bg-green-400'}`}
                role="status"
                aria-label={isYourTurn ? 'Your turn indicator' : 'Draft in progress indicator'}
              ></div>
              <div>
                <p className="text-sm font-medium opacity-90">On the Clock</p>
                <p className={`text-lg font-bold ${isYourTurn ? 'text-yellow-300' : 'text-white'}`}>
                  {currentTeam?.member.displayName || 'Unknown'}
                  {isYourTurn && ' (YOU!)'}
                </p>
              </div>
            </div>

            {/* Countdown Timer */}
            <div className="mt-2">
              <div
                className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-mono ${
                  timeLeft <= 30 ? 'bg-red-500' : timeLeft <= 60 ? 'bg-yellow-500' : 'bg-green-500'
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
              <div className="mt-2 w-32 h-1 bg-white/30 rounded-full overflow-hidden mx-auto lg:mx-0">
                <div
                  className={`h-full transition-all duration-1000 ${
                    timeLeft <= 30
                      ? 'bg-red-400'
                      : timeLeft <= 60
                        ? 'bg-yellow-400'
                        : 'bg-green-400'
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
            <p className="text-sm opacity-90">Pick Progress</p>
            <p className="text-xl lg:text-2xl font-bold">
              #{draftData.currentPick}{' '}
              <span className="text-base lg:text-lg opacity-75">of {draftData.totalPicks}</span>
            </p>
            <p className="text-xs lg:text-sm opacity-75">
              Round {draftData.round} • {draftData.direction}
            </p>

            {/* Your Turn Info */}
            {!isYourTurn && yourPickInfo && yourPickInfo.picksUntilYourTurn > 0 && (
              <div
                className={`mt-2 px-2 lg:px-3 py-1 rounded-full text-xs lg:text-sm transition-all ${
                  yourPickInfo.picksUntilYourTurn === 1
                    ? `bg-yellow-500 ${isFlashing ? 'bg-opacity-100' : 'bg-opacity-70'} animate-pulse ring-2 ring-yellow-300`
                    : yourPickInfo.picksUntilYourTurn <= 3
                      ? 'bg-orange-500/80'
                      : 'bg-white/20'
                }`}
                role="status"
                aria-live="polite"
                aria-label={`Your turn status: ${yourPickInfo.picksUntilYourTurn === 1 ? 'You are up next' : `${yourPickInfo.picksUntilYourTurn} picks until your turn`}`}
              >
                {yourPickInfo.picksUntilYourTurn === 1
                  ? "🚨 YOU'RE UP NEXT!"
                  : yourPickInfo.picksUntilYourTurn <= 3
                    ? `⚡ ${yourPickInfo.picksUntilYourTurn} picks until your turn`
                    : `Your pick in ${yourPickInfo.picksUntilYourTurn} turn${yourPickInfo.picksUntilYourTurn > 1 ? 's' : ''}`}
              </div>
            )}

            {/* Your Turn Indicator */}
            {isYourTurn && (
              <div
                className="mt-2 px-2 lg:px-3 py-1 rounded-full text-xs lg:text-sm bg-yellow-400 text-black font-bold animate-pulse"
                role="alert"
                aria-label="It is your turn to pick"
              >
                🔥 YOUR TURN TO PICK!
              </div>
            )}
          </div>

          {/* Next Up (Right) */}
          <div className="text-center lg:text-right">
            {nextTeam && draftData.currentPick < draftData.totalPicks ? (
              <div>
                <p className="text-sm font-medium opacity-90">Up Next</p>
                <p className="text-lg font-bold">
                  {nextTeam.member.displayName}
                  {nextTeam.slot === yourSlot && ' (YOU!)'}
                </p>
                <p className="text-sm opacity-75">Pick #{draftData.currentPick + 1}</p>
              </div>
            ) : (
              <div>
                <p className="text-sm opacity-75">Final Pick!</p>
                <p className="text-lg font-bold">🏁 Draft Ending</p>
              </div>
            )}

            {/* Estimated Time to Your Turn */}
            {!isYourTurn && yourPickInfo && yourPickInfo.estimatedTimeUntilYourTurn > 0 && (
              <div className="mt-2 text-xs opacity-75">
                ~{formatTime(yourPickInfo.estimatedTimeUntilYourTurn)} until your turn
              </div>
            )}
          </div>
        </div>

        {/* Draft Order Visualization */}
        <div
          className="mt-4 pt-4 border-t border-white/20"
          role="region"
          aria-label="Draft order visualization"
        >
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            {/* Left: Draft Order */}
            <div className="flex items-center gap-1 lg:gap-2 overflow-x-auto scrollbar-thin">
              <span className="text-xs opacity-75 mr-2 whitespace-nowrap">Draft Order:</span>
              {draftOrder.map((team, index) => (
                <div key={team.slot} className="flex items-center">
                  <div
                    className={`w-6 h-6 lg:w-8 lg:h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                      team.isCurrent
                        ? 'bg-yellow-400 text-black animate-pulse ring-2 ring-yellow-200'
                        : team.isNext
                          ? 'bg-orange-400 text-white ring-2 ring-orange-200'
                          : team.isYou
                            ? 'bg-green-400 text-black ring-2 ring-green-200'
                            : 'bg-white/20 text-white'
                    }`}
                    title={team.name}
                    role="button"
                    tabIndex={0}
                    aria-label={`Team ${team.slot}: ${team.name}${team.isCurrent ? ' (currently picking)' : ''}${team.isNext ? ' (next to pick)' : ''}${team.isYou ? ' (your team)' : ''}`}
                  >
                    {team.slot}
                  </div>
                  {index < draftOrder.length - 1 && <div className="w-2 h-px bg-white/30 mx-1" />}
                </div>
              ))}
              {draftData.participants.length > 8 && (
                <span className="text-xs opacity-75 ml-2">
                  +{draftData.participants.length - 8} more
                </span>
              )}
            </div>

            {/* Right: Recent Activity */}
            {draftData.picks.length > 0 && (
              <div className="hidden lg:block text-right">
                <p className="text-xs opacity-75 mb-1">Latest Pick:</p>
                <div className="text-sm">
                  <span className="font-medium">
                    {draftData.picks[draftData.picks.length - 1]?.player.name}
                  </span>
                  <span className="opacity-75 ml-1">
                    ({draftData.picks[draftData.picks.length - 1]?.player.position})
                  </span>
                </div>
                <div className="text-xs opacity-60">
                  to {draftData.picks[draftData.picks.length - 1]?.member.displayName}
                </div>
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="flex items-center justify-center gap-4 mt-2 text-xs opacity-75">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 bg-yellow-400 rounded-full"></div>
              <span>Current</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 bg-orange-400 rounded-full"></div>
              <span>Next</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 bg-green-400 rounded-full"></div>
              <span>You</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
