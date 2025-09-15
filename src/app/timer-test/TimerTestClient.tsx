'use client';

import { useEffect, useState } from 'react';

export default function TimerTestClient() {
  const [timeRemaining, setTimeRemaining] = useState(120);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    let interval: any = null;
    if (isActive && timeRemaining > 0) {
      interval = setInterval(() => setTimeRemaining((t) => t - 1), 1000);
    }
    return () => interval && clearInterval(interval);
  }, [isActive, timeRemaining]);

  const toggleTimer = () => setIsActive((prev) => !prev);
  const resetTimer = () => {
    setTimeRemaining(120);
    setIsActive(false);
  };

  const minutes = Math.floor(timeRemaining / 60);
  const seconds = timeRemaining % 60;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-6 rounded-lg shadow-md text-center">
        <h1 className="text-2xl font-bold mb-4">Timer Test</h1>
        <div className="text-5xl font-mono mb-6">
          {minutes}:{seconds.toString().padStart(2, '0')}
        </div>
        <div className="flex gap-4 justify-center">
          <button onClick={toggleTimer} className={`px-4 py-2 rounded ${isActive ? 'bg-yellow-500' : 'bg-green-600'} text-white`}>
            {isActive ? 'Pause' : 'Start'}
          </button>
          <button onClick={resetTimer} className="px-4 py-2 rounded bg-gray-600 text-white">Reset</button>
        </div>
      </div>
    </div>
  );
}

