'use client';

import React, { useEffect, useRef, useState } from 'react';

type DraftBannerProps = {
  title?: string;
  round: number;
  pick: number;
  yourPickIndex: number;
  timeLeft: number; // in seconds
  totalPicks?: number;
  isYourTurn?: boolean;
  participantsOnline?: number;
  draftType?: 'snake' | 'linear';
  onTimeExpired?: () => void;
  currentPickerName?: string;
  className?: string;
};

function getTeamName(pick: number): string {
  if (pick < 1) return '—';
  // For picks 1-26: A-Z, then AA, AB, etc.
  let name = '';
  let n = pick;
  while (n > 0) {
    n--; // 0-based
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26);
  }
  return name;
}

const DraftBanner: React.FC<DraftBannerProps> = ({
  title = 'Statly Draft Room',
  round,
  pick,
  yourPickIndex,
  timeLeft,
  totalPicks = 100,
  isYourTurn = false,
  participantsOnline = 0,
  draftType = 'snake',
  onTimeExpired,
  currentPickerName,
  className = '',
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [soundEnabled] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [lastAnnouncedThreshold, setLastAnnouncedThreshold] = useState<number | null>(null);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);

  const picksUntil = Math.max(yourPickIndex - pick, 0);

  // Enhanced time calculations
  const isTimeUrgent = timeLeft <= 10;
  const isTimeCritical = timeLeft <= 5;
  const timePercentage = Math.max(0, Math.min(100, (timeLeft / 120) * 100)); // Assuming 120s per pick

  // Audio alert effect with better error handling
  useEffect(() => {
    if (soundEnabled && !reducedMotion && isTimeCritical && timeLeft > 0) {
      const playAudio = async () => {
        try {
          if (audioRef.current) {
            audioRef.current.currentTime = 0; // Reset to start
            await audioRef.current.play();
          }
        } catch (err) {
          console.warn('Failed to play draft alert audio:', err);
        }
      };
      playAudio();
    }
  }, [isTimeCritical, timeLeft, soundEnabled, reducedMotion]);

  // Announce threshold changes exactly once
  useEffect(() => {
    if (timeLeft <= 5 && lastAnnouncedThreshold !== 5) {
      setLastAnnouncedThreshold(5);
    } else if (timeLeft <= 10 && lastAnnouncedThreshold !== 10 && lastAnnouncedThreshold !== 5) {
      setLastAnnouncedThreshold(10);
    }
  }, [timeLeft, lastAnnouncedThreshold]);

  // Time expiry callback
  useEffect(() => {
    if (timeLeft <= 0 && onTimeExpired) {
      onTimeExpired();
    }
  }, [timeLeft, onTimeExpired]);

  // Format time display
  const formatTime = (seconds: number): string => {
    if (seconds <= 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div
      className={`relative w-full overflow-hidden ${className}`}
      role="banner"
      aria-label="Draft status banner"
    >
      {/* Main Banner Container */}
      <div
        className="relative flex flex-col lg:flex-row justify-between items-center p-6 lg:py-8 lg:px-8"
        style={{
          background: isYourTurn
            ? 'linear-gradient(135deg, var(--success) 0%, var(--success) 50%, color-mix(in oklab, var(--success) 75%, white) 100%)'
            : 'linear-gradient(135deg, var(--league-primary) 0%, var(--league-text) 50%, var(--league-primary-hover) 100%)',
          minHeight: 120,
          borderRadius: 20,
          boxShadow: isYourTurn
            ? '0 20px 40px rgba(16, 185, 129, 0.3), 0 8px 16px rgba(16, 185, 129, 0.2)'
            : '0 20px 40px rgba(0, 0, 0, 0.3), 0 8px 16px rgba(0, 0, 0, 0.1)',
          border: isYourTurn ? '3px solid var(--success)' : '2px solid var(--league-primary-hover)',
        }}
      >
        {/* Animated Background Pattern */}
        <div className="absolute inset-0 opacity-10">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                'radial-gradient(circle at 20% 80%, rgba(255,255,255,0.1) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(255,255,255,0.1) 0%, transparent 50%)',
            }}
            aria-hidden="true"
          />
        </div>

        {/* Left Section: Title and Status */}
        <div className="flex-1 text-center lg:text-left relative z-10">
          <h1 className="text-2xl lg:text-4xl font-black uppercase tracking-wide text-white mb-2 drop-shadow-lg">
            {title}
          </h1>

          <div className="flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-6 text-sm lg:text-base font-medium text-white/90">
            <div className="flex items-center justify-center lg:justify-start gap-4">
              <span className="flex items-center gap-1">
                📊 Round <span className="font-bold text-white">{round}</span>
              </span>

              <span className="flex items-center gap-1">
                🎯 Pick <span className="font-bold text-white">{pick}</span>
                {totalPicks && <span className="text-white/70">of {totalPicks}</span>}
              </span>
            </div>

            <div className="flex items-center justify-center lg:justify-start gap-4">
              <span
                className={`flex items-center gap-1 ${isYourTurn ? 'text-success' : 'text-white/80'}`}
              >
                {isYourTurn
                  ? '🔥 YOUR TURN!'
                  : `⏳ ${picksUntil} pick${picksUntil !== 1 ? 's' : ''} until you`}
              </span>

              {participantsOnline > 0 && (
                <span className="flex items-center gap-1 text-white/70">
                  <div className="w-2 h-2 bg-success rounded-full animate-pulse"></div>
                  {participantsOnline} online
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Center: Current Picker Card */}
        <div className="relative z-10 my-4 lg:my-0 lg:mx-8">
          <div
            className="relative px-6 py-4 min-w-[240px] text-center"
            style={{
              background: isYourTurn
                ? 'linear-gradient(135deg, var(--card) 0%, var(--success) 100%)'
                : 'linear-gradient(135deg, var(--warning) 0%, var(--warning) 100%)',
              borderRadius: 16,
              boxShadow: isYourTurn
                ? '0 12px 24px rgba(16, 185, 129, 0.25), 0 4px 8px rgba(16, 185, 129, 0.1)'
                : '0 12px 24px rgba(245, 158, 11, 0.25), 0 4px 8px rgba(245, 158, 11, 0.1)',
              border: isYourTurn ? '2px solid var(--success)' : '2px solid var(--warning)',
              transform: 'scale(1.05)',
            }}
          >
            {/* Status Icon */}
            <div className="mb-2">
              {isYourTurn ? (
                <div className={`text-2xl ${reducedMotion ? '' : 'animate-bounce'}`}>🎯</div>
              ) : (
                <div className="text-2xl">👤</div>
              )}
            </div>

            {/* Picker Name */}
            <div className={`text-lg font-black ${isYourTurn ? 'text-success' : 'text-warning'}`}>
              {isYourTurn ? 'YOUR TURN' : `Team ${getTeamName(pick)}`}
            </div>

            {currentPickerName && !isYourTurn && (
              <div className="text-sm font-medium text-warning mt-1">{currentPickerName}</div>
            )}

            {draftType === 'snake' && (
              <div className={`text-xs mt-1 ${isYourTurn ? 'text-success' : 'text-warning'}`}>
                🐍 Snake Draft
              </div>
            )}
          </div>
        </div>

        {/* Right Section: Timer and Progress */}
        <div className="flex-1 text-center lg:text-right relative z-10">
          {/* Timer */}
          <div className="mb-4">
            <div
              className={`text-3xl lg:text-4xl font-black mb-1 ${
                isTimeCritical
                  ? 'text-destructive animate-pulse'
                  : isTimeUrgent
                    ? 'text-warning'
                    : 'text-white'
              }`}
            >
              {formatTime(timeLeft)}
            </div>

            <div className="text-sm text-white/80 font-medium">
              {timeLeft <= 0 ? 'Time Expired' : 'Time Remaining'}
            </div>

            {/* Time Progress Bar */}
            <div className="w-32 lg:w-40 h-2 bg-white/20 rounded-full mx-auto lg:mx-0 lg:ml-auto mt-2 overflow-hidden">
              <div
                className={`h-full transition-all duration-1000 ease-linear ${
                  isTimeCritical ? 'bg-destructive' : isTimeUrgent ? 'bg-warning' : 'bg-success'
                }`}
                style={{ width: `${timePercentage}%` }}
              />
            </div>
          </div>

          {/* Additional Status */}
          {isYourTurn && (
            <div className="bg-white/10 rounded-lg px-3 py-2 backdrop-blur-sm">
              <div className="text-success text-sm font-semibold">🚀 Make Your Pick!</div>
              <div className="text-success text-xs mt-1">Select a player to continue the draft</div>
            </div>
          )}
        </div>

        {/* Urgent Alert Overlay */}
        {isTimeCritical && (
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute inset-0 bg-destructive animate-pulse rounded-[20px]" />
            <div className="absolute top-4 right-4 bg-destructive text-white px-3 py-1 rounded-full text-sm font-bold animate-bounce">
              ⚠️ TIME RUNNING OUT!
            </div>
          </div>
        )}
      </div>

      {/* Live region for critical time announcements */}
      <div className="sr-only" aria-live="assertive" aria-atomic="true">
        {lastAnnouncedThreshold === 5 ? '5 seconds remaining' : ''}
        {lastAnnouncedThreshold === 10 ? '10 seconds remaining' : ''}
      </div>

      {/* Audio Element - Draft Alert Sound */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} preload="auto" aria-label="Draft timer alert sound">
        <source src="/beep.mp3" type="audio/mpeg" />
        <source src="/beep.wav" type="audio/wav" />
      </audio>
    </div>
  );
};

export default DraftBanner;
