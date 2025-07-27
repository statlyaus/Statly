import React, { useEffect, useRef } from 'react';

type DraftBannerProps = {
  round: number;
  pick: number;
  yourPickIndex: number;
  timeLeft: number; // in seconds
};

const DraftBanner: React.FC<DraftBannerProps> = ({ round, pick, yourPickIndex, timeLeft }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const picksUntil = Math.max(yourPickIndex - pick + 1, 0);

  useEffect(() => {
    if (timeLeft <= 5 && timeLeft > 0) {
      audioRef.current?.play().catch(() => {});
    }
  }, [timeLeft]);

  return (
    <div className="relative w-full bg-gradient-to-r from-blue-700 to-blue-800 text-white px-6 py-4 shadow-md border-b border-blue-900">
      <div
        className="absolute inset-0 bg-[length:200px] bg-center opacity-10 mix-blend-overlay pointer-events-none"
        style={{ backgroundImage: "url('/death-star.svg')" }}
      />
      <div className="text-5xl font-black tracking-wide uppercase leading-tight mb-1">
        <span className={`block ${timeLeft < 5 ? 'text-red-500 animate-pulse' : ''}`}>Statly</span>
      </div>
      <div className="text-2xl font-semibold uppercase text-white tracking-wide mb-2">Draft Room</div>
      <div className="max-w-screen-xl mx-auto px-4 flex flex-wrap gap-6 text-base font-medium tracking-wide">
        <span>Round {round} - Pick {pick}</span>
        <span>{picksUntil} pick{picksUntil !== 1 ? 's' : ''} until your turn</span>
        <span className={typeof timeLeft === 'number' && timeLeft < 5 ? 'text-red-500 animate-pulse' : ''}>
          Time Left: {typeof timeLeft === 'number' ? `${timeLeft.toFixed(2)}s` : '—'}
        </span>
      </div>
      <audio ref={audioRef} src="/beep.mp3" preload="auto" />
    </div>
  );
};

export default DraftBanner;