import React, { useEffect, useRef } from 'react';

type DraftBannerProps = {
  title?: string; // Add this optional prop
  round: number;
  pick: number;
  yourPickIndex: number;
  timeLeft: number; // in seconds
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
  title = 'Statly Draft Room', // Add default value
  round,
  pick,
  yourPickIndex,
  timeLeft,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const picksUntil = Math.max(yourPickIndex - pick, 0);

  useEffect(() => {
    if (timeLeft <= 5 && timeLeft > 0) {
      audioRef.current?.play().catch((err) => {
        console.error('Failed to play audio:', err);
      });
    }
  }, [timeLeft]);

  return (
    <div
      className="relative w-full flex justify-center items-center py-8"
      style={{
        background: 'linear-gradient(135deg, #181c24 0%, #23293a 100%)',
        minHeight: 120,
        borderRadius: 24,
        boxShadow: '0 8px 32px 0 rgba(0,0,0,0.45), 0 1.5px 0 0 #222 inset',
        border: '2px solid #23293a',
        marginBottom: 32,
        position: 'relative',
        overflow: 'visible',
      }}
    >
      {/* 3D Card effect for the current pick */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{
          zIndex: 2,
          minWidth: 220,
          minHeight: 90,
          background: 'linear-gradient(135deg, #2d3748 60%, #f7c948 100%)',
          borderRadius: 16,
          boxShadow: '0 6px 24px 0 rgba(247,201,72,0.25), 0 2px 0 0 #f7c948 inset',
          border: '3px solid #f7c948',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          transform: 'scale(1.08)',
        }}
      >
        <div
          className="text-2xl font-black text-yellow-700 drop-shadow"
          style={{ letterSpacing: 2 }}
        >
          Team {getTeamName(pick)}
        </div>
      </div>

      {/* Banner content */}
      <div
        className="flex flex-col items-center justify-center w-full"
        style={{ zIndex: 1, gap: 8 }}
      >
        <div className="text-4xl font-black uppercase tracking-wide text-white mb-2 drop-shadow-lg">
          {title}
        </div>
        <div className="flex flex-wrap gap-8 justify-center items-center text-base font-medium tracking-wide text-gray-200">
          <span>
            Round <span className="font-bold text-white">{round}</span>
          </span>
          <span>
            {picksUntil} pick{picksUntil !== 1 ? 's' : ''} until your turn
          </span>
          <span
            className={
              typeof timeLeft === 'number' && timeLeft < 5 ? 'text-red-400 animate-pulse' : ''
            }
          >
            Time Left: {typeof timeLeft === 'number' ? `${timeLeft.toFixed(2)}s` : '—'}
          </span>
        </div>
      </div>
      <audio ref={audioRef} src="/beep.mp3" preload="auto" />
    </div>
  );
};

export default DraftBanner;
