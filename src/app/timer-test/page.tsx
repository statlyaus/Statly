'use client'
// Simple timer test page to verify draft timer functionality
import { useEffect, useState } from 'react';

export default function TimerTest() {
  const [timeRemaining, setTimeRemaining] = useState(120);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    let interval: NodeJS.Timeout | undefined;

    if (isActive && timeRemaining > 0) {
      console.log('🎯 Starting timer test, current time remaining:', timeRemaining);
      
      interval = setInterval(() => {
        setTimeRemaining((time) => {
          const newTime = Math.max(0, time - 1);
          
          // Log every 10 seconds or when under 30 seconds
          if (newTime % 10 === 0 || newTime <= 30) {
            console.log('⏰ Timer test update:', newTime, 'seconds remaining');
          }
          
          return newTime;
        });
      }, 1000);
    }

    return () => {
      if (interval) {
        console.log('🛑 Clearing timer test interval');
        clearInterval(interval);
      }
    };
  }, [isActive, timeRemaining]);

  const formatTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Draft Timer Test</h1>
      
      <div className="mb-4">
        <div className="text-4xl font-mono font-bold text-center">
          {formatTime(timeRemaining)}
        </div>
      </div>
      
      <div className="space-x-4">
        <button
          onClick={() => setIsActive(!isActive)}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          {isActive ? 'Pause' : 'Start'} Timer
        </button>
        
        <button
          onClick={() => {
            setTimeRemaining(120);
            setIsActive(false);
          }}
          className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
        >
          Reset
        </button>
        
        <button
          onClick={() => setTimeRemaining(30)}
          className="px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600"
        >
          Set to 30s
        </button>
      </div>
      
      <div className="mt-4 text-sm text-gray-600">
        <p>Timer Status: {isActive ? 'Running' : 'Stopped'}</p>
        <p>Check browser console for timer logs</p>
      </div>
    </div>
  );
}
