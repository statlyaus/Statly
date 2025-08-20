'use client';

import { useState, useEffect, useMemo } from 'react';

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
    status: string;
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
  yourSlot: number;
}

export default function LivePickHeader({
  draftData,
  timePerPick = 120,
  isYourTurn,
  yourSlot = 1,
}: LivePickHeaderProps) {
  const [timeLeft, setTimeLeft] = useState(timePerPick);
  const [isFlashing, setIsFlashing] = useState(false);

  // Calculate current and next picking teams
  const { currentTeam, nextTeam, yourPickInfo, draftOrder } = useMemo(() => {
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

    if (!isYourTurn && draftData.status === 'LIVE') {
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
  }, [draftData, yourSlot, isYourTurn, timePerPick]);

  // Countdown timer effect
  useEffect(() => {
    if (draftData.status !== 'LIVE') return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          // Time's up - could trigger auto-pick here
          return timePerPick; // Reset for next pick
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [draftData.currentPick, draftData.status, timePerPick]);

  // Flashing effect and audio alerts when you're up next
  useEffect(() => {
    if (yourPickInfo.picksUntilYourTurn === 1) {
      const flashInterval = setInterval(() => {
        setIsFlashing((prev) => !prev);
      }, 1000);

      // Optional: Play alert sound (uncomment if you want audio)
      // try {
      //   const audio = new Audio('/sounds/alert.mp3');
      //   audio.play().catch(console.error);
      // } catch (error) {
      //   console.log('Audio not available');
      // }

      return () => clearInterval(flashInterval);
    } else if (isYourTurn) {
      // Stop flashing when it's actually your turn
      setIsFlashing(false);

      // Optional: Play your turn sound (uncomment if you want audio)
      // try {
      //   const audio = new Audio('/sounds/your-turn.mp3');
      //   audio.play().catch(console.error);
      // } catch (error) {
      //   console.log('Audio not available');
      // }
    } else {
      setIsFlashing(false);
    }
  }, [yourPickInfo.picksUntilYourTurn, isYourTurn]);

  // Format time display
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return `${mins}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  };

  if (draftData.status === 'COMPLETED') {
    return (
      <div className="bg-gray-100 border-b border-gray-200 p-4">
        <div className="max-w-6xl mx-auto text-center">
          <h2 className="text-2xl font-bold text-gray-800">🏆 Draft Complete!</h2>
          <p className="text-gray-600">All picks have been made. Good luck with your team!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white border-b shadow-lg">
      <div className="max-w-6xl mx-auto p-4">
        {/* Main Status Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-center">
          {/* Current Pick (Left) */}
          <div className="text-center lg:text-left">
            <div className="flex items-center justify-center lg:justify-start gap-3">
              <div
                className={`w-3 h-3 rounded-full animate-pulse ${isYourTurn ? 'bg-yellow-400' : 'bg-green-400'}`}
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
              >
                <span className={timeLeft <= 10 ? 'animate-pulse' : ''}>
                  ⏱️ {formatTime(timeLeft)}
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
                />
              </div>
            </div>
          </div>

          {/* Draft Progress (Center) */}
          <div className="text-center">
            <p className="text-sm opacity-90">Pick Progress</p>
            <p className="text-2xl font-bold">
              #{draftData.currentPick}{' '}
              <span className="text-lg opacity-75">of {draftData.totalPicks}</span>
            </p>
            <p className="text-sm opacity-75">
              Round {draftData.round} • {draftData.direction}
            </p>

            {/* Your Turn Info */}
            {!isYourTurn && yourPickInfo.picksUntilYourTurn > 0 && (
              <div
                className={`mt-2 px-3 py-1 rounded-full text-sm transition-all ${
                  yourPickInfo.picksUntilYourTurn === 1
                    ? `bg-yellow-500 ${isFlashing ? 'bg-opacity-100' : 'bg-opacity-70'} animate-pulse ring-2 ring-yellow-300`
                    : yourPickInfo.picksUntilYourTurn <= 3
                      ? 'bg-orange-500/80'
                      : 'bg-white/20'
                }`}
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
              <div className="mt-2 px-3 py-1 rounded-full text-sm bg-yellow-400 text-black font-bold animate-pulse">
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
            {!isYourTurn && yourPickInfo.estimatedTimeUntilYourTurn > 0 && (
              <div className="mt-2 text-xs opacity-75">
                ~{formatTime(yourPickInfo.estimatedTimeUntilYourTurn)} until your turn
              </div>
            )}
          </div>
        </div>

        {/* Draft Order Visualization */}
        <div className="mt-4 pt-4 border-t border-white/20">
          <div className="flex items-center justify-between">
            {/* Left: Draft Order */}
            <div className="flex items-center gap-2 overflow-x-auto">
              <span className="text-xs opacity-75 mr-2">Draft Order:</span>
              {draftOrder.map((team, index) => (
                <div key={team.slot} className="flex items-center">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                      team.isCurrent
                        ? 'bg-yellow-400 text-black animate-pulse ring-2 ring-yellow-200'
                        : team.isNext
                          ? 'bg-orange-400 text-white ring-2 ring-orange-200'
                          : team.isYou
                            ? 'bg-green-400 text-black ring-2 ring-green-200'
                            : 'bg-white/20 text-white'
                    }`}
                    title={team.name}
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
